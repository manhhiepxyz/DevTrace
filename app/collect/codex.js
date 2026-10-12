'use strict';

/* =====================================================================
   app/collect/codex.js — Đọc nhật ký phiên của Codex.

   Nguồn: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
   Mỗi tệp là một phiên. Trong đó có: thông tin phiên (thư mục làm việc,
   model), từng lượt (task_started/task_complete), từng lệnh đã gọi
   (function_call) và lượng token đã dùng (token_count).

   Đây là nguồn bằng chứng mạnh nhất cho câu hỏi "huynh đã làm gì", vì nó
   ghi lại cả việc huynh giao cho AI lẫn việc huynh tự chạy lệnh.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const U = require('../util');
const C = require('../config');

// Các khối ngữ cảnh do hệ thống chèn vào, không phải lời huynh gõ.
const CONTEXT_TAGS = [
  'environment_context', 'INSTRUCTIONS', 'skills_instructions', 'permissions instructions',
  'collaboration_mode', 'app-context', 'user_instructions', 'truncated'
];

function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function cleanUserText(text) {
  if (!text) return '';
  let out = String(text);
  for (const tag of CONTEXT_TAGS) {
    const re = new RegExp('<' + escRe(tag) + '>[\\s\\S]*?</' + escRe(tag) + '>', 'g');
    out = out.replace(re, ' ');
  }
  out = out.replace(/<[A-Za-z_-]{0,40}\s*\/>/g, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  if (!out) return '';
  if (/^#+\s*AGENTS\.md instructions/i.test(out)) return '';
  return out;
}

function firstText(content) {
  if (!Array.isArray(content)) return '';
  for (const part of content) {
    if (part && (part.type === 'input_text' || part.type === 'text') && part.text) return part.text;
  }
  return '';
}

function classifyTool(name) {
  if (name === 'exec_command') return 'shell';
  if (name === 'js' || name === 'js_reset') return 'script';
  if (name === 'view_image') return 'image';
  if (name === 'wait' || name === 'write_stdin') return 'wait';
  return 'other';
}

function parseRollout(file, config) {
  const text = U.readText(file);
  if (!text) return null;

  const session = {
    sessionId: null, cwd: null, model: null, originator: null, threadSource: null,
    firstTs: null, lastTs: null, turns: [], tools: {}, commands: [], tokens: 0, aborted: 0
  };
  const turnMap = new Map();
  let promptBuf = '';

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch (e) { continue; }
    const payload = row.payload || {};
    const ts = row.timestamp ? Date.parse(row.timestamp) : null;

    if (row.type === 'session_meta') {
      session.sessionId = payload.id || payload.session_id || null;
      session.cwd = payload.cwd || session.cwd;
      session.model = payload.model || session.model;
      session.originator = payload.originator || null;
      session.threadSource = payload.thread_source || null;
    } else if (row.type === 'turn_context') {
      if (payload.cwd) session.cwd = payload.cwd;
      if (payload.model) session.model = payload.model;
    } else if (row.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
      const clean = cleanUserText(firstText(payload.content));
      if (clean) promptBuf = clean;
    } else if (row.type === 'response_item' && payload.type === 'function_call') {
      const kind = classifyTool(payload.name);
      session.tools[payload.name] = (session.tools[payload.name] || 0) + 1;
      if (payload.name === 'exec_command') {
        let args = null;
        try { args = JSON.parse(payload.arguments || '{}'); } catch (e) { args = null; }
        if (args && args.cmd) {
          session.commands.push({ ts: ts || 0, cmd: String(args.cmd).slice(0, 300), workdir: args.workdir || null });
        }
      } else if (kind === 'script' && session.scripts !== undefined) {
        /* không cần lưu chi tiết script */
      }
    } else if (row.type === 'event_msg' && payload.type === 'task_started') {
      const started = payload.started_at ? payload.started_at * 1000 : ts;
      const turn = { id: payload.turn_id, start: started, end: null, ms: null, prompt: promptBuf || '', error: null };
      promptBuf = '';
      turnMap.set(payload.turn_id, turn);
      session.turns.push(turn);
    } else if (row.type === 'event_msg' && payload.type === 'task_complete') {
      const turn = turnMap.get(payload.turn_id);
      const end = payload.completed_at ? payload.completed_at * 1000 : ts;
      if (turn) { turn.end = end; turn.ms = Number(payload.duration_ms || 0) || (end - turn.start); if (payload.error) turn.error = payload.error.message || String(payload.error); }
    } else if (row.type === 'event_msg' && payload.type === 'turn_aborted') {
      session.aborted++;
      const end = payload.completed_at ? payload.completed_at * 1000 : ts;
      const turn = turnMap.get(payload.turn_id);
      if (turn) { turn.end = end; turn.ms = Number(payload.duration_ms || 0); turn.error = 'bị ngắt: ' + (payload.reason || 'không rõ'); }
    } else if (row.type === 'token_usage_record') {
      const usage = payload.usage || payload.thread_token_usage || {};
      const total = Number(usage.total_tokens || 0);
      if (total > session.tokens) session.tokens = total;
    } else if (row.type === 'event_msg' && payload.type === 'token_count') {
      const usage = (payload.info && payload.info.total_token_usage) || {};
      const total = Number(usage.total_tokens || 0);
      if (total > session.tokens) session.tokens = total;
    }

    if (ts) { if (!session.firstTs || ts < session.firstTs) session.firstTs = ts; if (!session.lastTs || ts > session.lastTs) session.lastTs = ts; }
  }

  if (!session.firstTs) {
    const stat = U.safeStat(file);
    if (!stat) return null;
    session.firstTs = stat.mtimeMs;
    session.lastTs = stat.mtimeMs;
  }
  session.file = path.basename(file);
  return session;
}

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

function collect(config) {
  const settings = config.sources.codex;
  if (!settings.enabled) return { events: [], notes: ['Codex: đang tắt'] };
  const root = settings.root;
  if (!U.isDir(root)) return { events: [], notes: ['Codex: không thấy thư mục ' + root] };

  const files = U.walkFiles(root, { maxDepth: 5, limit: settings.maxFiles || 600, match: (f) => f.endsWith('.jsonl') })
    .map((f) => ({ file: f, mtime: (U.safeStat(f) || {}).mtimeMs || 0 }))
    .sort((a, b) => b.mtime - a.mtime);

  const raw = [];
  let skippedInternal = 0;

  for (const entry of files) {
    const session = parseRollout(entry.file, config);
    if (!session) continue;
    const project = C.projectFor(config, session.cwd);
    const isInternal = session.threadSource === 'guardian_review' || /guardian/i.test(session.originator || '');
    if (isInternal) skippedInternal++;
    const label = project ? project.name : (session.cwd ? path.basename(session.cwd) : 'không rõ dự án');
    const commandCount = session.commands.length;
    const totalMs = U.sum(session.turns, (t) => t.ms || 0);

    const toolSummary = Object.keys(session.tools)
      .sort((a, b) => session.tools[b] - session.tools[a])
      .map((n) => n + ' ×' + session.tools[n]).join(', ');

    raw.push({
      source: 'codex', kind: 'session', ts: session.firstTs,
      project: session.cwd,
      title: 'Codex · ' + label,
      detail: [session.model || 'không rõ model', session.turns.length + ' lượt', commandCount + ' lệnh', fmtTokens(session.tokens) + ' token'].join(' · '),
      durationMs: totalMs || null,
      meta: {
        sessionId: session.sessionId, file: session.file, cwd: session.cwd, model: session.model,
        originator: session.originator, threadSource: session.threadSource, internal: isInternal,
        turns: session.turns.length, aborted: session.aborted, commands: commandCount,
        tokens: session.tokens, tools: session.tools, toolSummary,
        lastTs: session.lastTs
      }
    });

    const turns = session.turns.slice(0, 40);
    for (const turn of turns) {
      const start = turn.start || session.firstTs;
      const cmds = session.commands.filter((c) => !turn.end || (c.ts >= start && c.ts <= turn.end)).map((c) => c.cmd);
      const prompt = (turn.prompt || '').slice(0, 200);
      raw.push({
        source: 'codex', kind: 'turn', ts: start,
        project: session.cwd,
        title: prompt ? prompt.slice(0, 90) : 'Lượt làm việc không có yêu cầu rõ',
        detail: (cmds.length ? cmds.length + ' lệnh: ' + cmds.slice(0, 3).join(' ; ') : 'không chạy lệnh nào'),
        durationMs: turn.ms || null,
        id: 'codex:turn:' + U.hash(session.sessionId + '|' + turn.id),
        meta: {
          sessionId: session.sessionId, turnId: turn.id, cwd: session.cwd, model: session.model,
          internal: isInternal, prompt: turn.prompt || '', commands: cmds.slice(0, 12), error: turn.error
        }
      });
    }
  }

  const notes = ['Codex: ' + raw.length + ' sự kiện từ ' + files.length + ' tệp phiên'];
  if (skippedInternal) notes.push('Codex: ' + skippedInternal + ' phiên nội bộ (guardian) được đánh dấu riêng');
  return { events: raw, notes };
}

module.exports = { collect, parseRollout, cleanUserText };
