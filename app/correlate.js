'use strict';

/* =====================================================================
   app/correlate.js — Đối chiếu bằng chứng.

   Tầng này KHÔNG gọi AI. Nó làm phần việc mà máy móc chắc chắn đúng:
   gom sự kiện thành từng khối làm việc, quy về dự án, rồi nối các sự kiện
   có quan hệ nhân quả với nhau (một commit thường có một phiên AI ngay
   trước nó; một lỗi thường kéo theo vài lượt tra cứu).

   Kết quả là một "bản đồ bằng chứng" — đầu vào cho tầng tổng hợp.
   ===================================================================== */

const E = require('./events');
const U = require('./util');
const C = require('./config');

/* Ngưỡng thời gian — mỗi con số dưới đây trả lời một câu hỏi KHÁC nhau, nên
   chúng khác nhau có chủ ý, không phải tuỳ tiện. Trước đây chúng nằm rải rác
   trong thân hàm, có chỗ viết thẳng 8 * 60 * 1000 giữa dòng, nên không ai
   đối chiếu được chỗ này với chỗ kia. Giờ tất cả nằm ở đây. */

// Còn làm liền mạch hay đã nghỉ? Quá 25 phút không có sự kiện nào thì khối
// làm việc cũ khép lại và khối mới bắt đầu.
const GAP_MS = 25 * 60 * 1000;

/* Hai sự kiện cách nhau dưới 8 phút vẫn thuộc cùng một quãng ngồi làm việc.
   Đây là ngưỡng để CỘNG THỜI GIAN, khác hẳn ngưỡng chia khối ở trên:
   chia khối hỏi "còn cùng một việc không", còn cộng thời gian hỏi "còn ngồi
   trước máy không". Nghỉ 20 phút giữa hai lượt sửa tệp vẫn là cùng một việc,
   nhưng 20 phút đó không phải thời gian làm việc — nên hai ngưỡng phải khác
   nhau, và trước đây cả hai chỗ dùng lẫn lộn nhau. */
const ACTIVE_GAP_MS = 8 * 60 * 1000;

// Nối nhân quả: làm với AI rồi commit là chuyện của cả tiếng.
const LINK_WINDOW_MS = 45 * 60 * 1000;

// Huynh tự gõ lệnh trong lúc phiên AI đang chạy: phải gần như cùng lúc mới
// đáng nói, chứ cách nhau nửa tiếng thì không còn là "đang chạy".
const COMMAND_LINK_MS = 5 * 60 * 1000;

/* Gán một lượt tra cứu tài liệu vào dự án đang làm. Lượt xem trình duyệt
   không tự biết nó phục vụ dự án nào, nên chỉ gán khi có khối làm việc ĐÃ
   BIẾT dự án ở gần đó — và luôn đánh dấu inferred = true. */
const INFER_WINDOW_MS = 20 * 60 * 1000;

// Một sự kiện không thể "chiếm" quá 2 giờ.
const MAX_SPAN_MS = 2 * 60 * 60 * 1000;

/* Một sự kiện không kèm thời lượng — commit, tệp vừa sửa, lượt xem — vẫn là
   một điểm CÓ THẬT trên trục thời gian, không phải chuyện không xảy ra.
   `activeMinutes` đã tính mỗi điểm như vậy đúng 1 phút; các khoảng hoạt động
   dưới đây dùng cùng con số đó, để hai chỗ không đếm lệch nhau. */
const MIN_EVENT_MS = 60 * 1000;

/* Bằng chứng "mạnh": nói được huynh thực sự làm ở đâu. Lượt xem trình duyệt
   chỉ là ngữ cảnh, không đủ tư cách quyết định dự án của cả một khối. */
const STRONG_SOURCES = { codex: 1, git: 1, github: 1, files: 1, vscode: 1, shell: 1 };

/* Một phiên Codex có thể kéo dài qua nhiều ngày; nếu lấy nguyên thời lượng
   thì "số phút hôm nay" sẽ vống lên vô lý. Cắt trần để con số giữ nghĩa. */
function span(event) {
  const value = Number(event.durationMs) || 0;
  return U.clamp(value, 0, MAX_SPAN_MS);
}

/* Gộp các khoảng chồng nhau hoặc cách nhau dưới `gapMs` thành khoảng lớn hơn.
   Đầu vào là mảng [đầu, cuối] theo milli-giây; đầu ra cũng vậy, đã sắp xếp. */
function coalesceIntervals(intervals, gapMs) {
  const gap = gapMs == null ? ACTIVE_GAP_MS : gapMs;
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const pair of sorted) {
    const start = pair[0];
    const end = Math.max(pair[1], pair[0] + MIN_EVENT_MS);
    const last = out[out.length - 1];
    if (last && start - last[1] <= gap) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/* Khoảng thời gian CÓ HOẠT ĐỘNG thật của một tập sự kiện, tách theo dự án.

   Vì sao cần: `blocks[].start..end` là VỎ CHỨA, không phải thời gian đã làm.
   Khối gộp mọi sự kiện cách nhau dưới 25 phút, nên một khối 9:00–12:00 có
   thể chỉ có đúng hai sự kiện ở 9:20 và 11:50. Đem vỏ chứa đi đối chiếu với
   thời khoá biểu thì buổi 9–11 trông như đã làm đủ hai tiếng, trong khi thực
   tế chỉ có vài phút — đúng kiểu nói dối mà cả dự án này tránh.

   Ở đây gộp theo ACTIVE_GAP_MS (ngưỡng cộng-thời-gian, 8 phút) chứ không
   phải GAP_MS (ngưỡng chia khối, 25 phút): câu hỏi ở đây là "còn ngồi làm
   không", không phải "còn cùng một việc không". */
function activitySpans(events, gapMs) {
  const gap = gapMs == null ? ACTIVE_GAP_MS : gapMs;
  const all = [];
  const buckets = {};
  for (const event of events) {
    const pair = [event.ts, event.ts + span(event)];
    all.push(pair);
    if (event.projectKey) (buckets[event.projectKey] = buckets[event.projectKey] || []).push(pair);
  }
  const out = { all: coalesceIntervals(all, gap), byProject: {} };
  for (const key of Object.keys(buckets)) out.byProject[key] = coalesceIntervals(buckets[key], gap);
  return out;
}

// Tổng số phút của một danh sách khoảng.
function spanMinutes(spans) {
  let ms = 0;
  for (const pair of spans || []) ms += Math.max(0, pair[1] - pair[0]);
  return Math.round(ms / 60000);
}

// Khoá để gom nhóm (ổn định) và nhãn để hiển thị (dễ đọc) — tách riêng.
function projectKey(config, projectPath) {
  if (!projectPath) return null;
  const project = C.projectFor(config, projectPath);
  return project ? 'p:' + project.id : U.norm(projectPath);
}

function projectLabel(config, projectPath) {
  if (!projectPath) return null;
  const project = C.projectFor(config, projectPath);
  if (project) return project.name;
  return require('path').basename(String(projectPath).replace(/[\\/]+$/, '')) || projectPath;
}

// Sự kiện có project dạng đường dẫn; quy về khoá + nhãn để dùng về sau.
function decorate(config, events) {
  return events.map((event) => Object.assign({}, event, {
    projectKey: projectKey(config, event.project),
    projectName: projectLabel(config, event.project)
  }));
}

function isInternal(event) {
  return !!(event.meta && event.meta.internal);
}

/* Gom sự kiện thành các khối làm việc liên tục. */
function blocks(config, events, options) {
  const opts = options || {};
  const gap = opts.gapMs || GAP_MS;
  const sorted = events.slice().sort((a, b) => a.ts - b.ts);
  const out = [];
  let current = null;

  for (const event of sorted) {
    const reach = span(event);
    if (!current || event.ts - current.end > gap) {
      current = { start: event.ts, end: event.ts + reach, events: [] };
      out.push(current);
    }
    current.end = Math.max(current.end, event.ts + reach);
    current.events.push(event);
  }

  return out.map((block) => {
    const counts = {};
    const projects = {};
    const labels = {};
    for (const event of block.events) counts[event.source] = (counts[event.source] || 0) + 1;
    // Xếp hạng dự án chỉ dựa trên bằng chứng mạnh; nếu khối không có bằng
    // chứng mạnh nào thì đành dùng tất cả những gì đang có.
    const weighting = block.events.filter((e) => STRONG_SOURCES[e.source]);
    for (const event of (weighting.length ? weighting : block.events)) {
      if (event.projectKey) {
        projects[event.projectKey] = (projects[event.projectKey] || 0) + event.weight;
        labels[event.projectKey] = event.projectName;
      }
    }
    const ranked = Object.keys(projects).sort((a, b) => projects[b] - projects[a]);
    // `spans` là thời gian LÀM THẬT bên trong vỏ chứa `start..end` — xem
    // chú thích của `activitySpans` để biết vì sao phải tách hai thứ này.
    const spans = coalesceIntervals(block.events.map((e) => [e.ts, e.ts + span(e)]), ACTIVE_GAP_MS);
    return {
      start: block.start, end: block.end, ms: block.end - block.start,
      spans, activeMinutes: spanMinutes(spans),
      project: ranked[0] ? labels[ranked[0]] : null,
      projectKey: ranked[0] || null,
      projects: ranked.map((k) => labels[k]),
      counts,
      events: block.events
    };
  });
}

// Thời gian "có hoạt động": cộng dồn các đoạn, gộp đoạn cách nhau dưới ngưỡng.
function activeMinutes(events, gapMs) {
  const gap = gapMs || ACTIVE_GAP_MS;
  const sorted = events.slice().sort((a, b) => a.ts - b.ts);
  let minutes = 0;
  let cursor = null;
  for (const event of sorted) {
    const end = event.ts + span(event);
    if (cursor == null || event.ts - cursor > gap) {
      minutes += Math.max(1, Math.round((end - event.ts) / 60000)) || 1;
      cursor = end;
    } else {
      minutes += Math.max(0, Math.round((end - cursor) / 60000));
      cursor = Math.max(cursor, end);
    }
  }
  return minutes;
}

/* Tổng hợp theo dự án trong ngày. */
function byProject(config, events) {
  const map = new Map();
  const ensure = (key, label) => {
    if (!map.has(key)) {
      map.set(key, {
        key, project: label, minutes: 0, aiSessions: 0, aiTurns: 0, commands: 0, manualCommands: 0,
        commits: [], files: [], docVisits: 0, tokens: 0, events: 0, blocked: 0, timeline: []
      });
    }
    return map.get(key);
  };

  for (const event of events) {
    const key = event.projectKey || 'unknown';
    const entry = ensure(key, event.projectName || 'Không rõ dự án');
    entry.events++;
    entry.timeline.push(event);
    if (event.source === 'codex') {
      if (event.kind === 'session') { entry.aiSessions++; entry.tokens += (event.meta.tokens || 0); }
      if (event.kind === 'turn') { entry.aiTurns++; entry.commands += (event.meta.commands || []).length; if (event.meta.error) entry.blocked++; }
    }
    if (event.source === 'git' && event.kind === 'commit') entry.commits.push(event);
    if (event.source === 'files' && event.kind === 'change') entry.files.push(event);
    if (event.source === 'browser' && event.meta && event.meta.category === 'học') entry.docVisits++;
    if (event.source === 'shell' && event.kind === 'command') entry.manualCommands++;
  }

  for (const entry of map.values()) {
    // Phút của một dự án chỉ tính trên bằng chứng mạnh, tránh việc vài trăm
    // lượt xem trình duyệt thổi phồng thời gian làm việc thật.
    //
    // Dùng ACTIVE_GAP_MS (ngưỡng cộng thời gian) chứ không phải GAP_MS
    // (ngưỡng chia khối). Trước đây chỗ này truyền GAP_MS, nên phút của dự án
    // cộng rộng hơn phút của cả ngày — màn "Dự án" báo nhiều thời gian hơn
    // màn "Hôm nay" cho cùng một ngày, và không có gì giải thích được chênh
    // lệch đó. Hai con số vẫn khác nhau vì tính trên hai tập sự kiện khác
    // nhau (dự án chỉ tính bằng chứng mạnh), nhưng nay khác vì lý do rõ ràng.
    const strong = entry.timeline.filter((e) => STRONG_SOURCES[e.source]);
    entry.minutes = activeMinutes(strong.length ? strong : entry.timeline, ACTIVE_GAP_MS);
    delete entry.timeline;
  }
  return Array.from(map.values()).sort((a, b) => b.events - a.events);
}

/* Nối nhân quả giữa các nguồn: đây là phần "đối chiếu hoạt động với kết quả". */
function links(config, events) {
  const out = [];
  const commits = events.filter((e) => e.source === 'git' && e.kind === 'commit');
  const turns = events.filter((e) => e.source === 'codex' && e.kind === 'turn');
  const docVisits = events.filter((e) => e.source === 'browser' && e.meta && e.meta.category === 'học');
  const manual = events.filter((e) => e.source === 'shell' && e.kind === 'command');

  for (const commit of commits) {
    const near = turns.filter((t) => t.projectKey === commit.projectKey && t.ts <= commit.ts && commit.ts - t.ts < LINK_WINDOW_MS);
    if (near.length) {
      out.push({
        type: 'ai-truoc-commit', from: near[near.length - 1].id, to: commit.id,
        project: commit.projectName, gapMs: commit.ts - near[near.length - 1].ts,
        note: near.length + ' lượt Codex trong ' + Math.round((commit.ts - near[0].ts) / 60000) + ' phút trước commit "' + commit.title.slice(0, 60) + '"'
      });
    }
  }

  for (const turn of turns) {
    const docs = docVisits.filter((d) => Math.abs(d.ts - turn.ts) < LINK_WINDOW_MS);
    if (docs.length) {
      out.push({
        type: 'tra-cuu-quanh-lam-viec', from: docs[0].id, to: turn.id,
        project: turn.projectName, gapMs: Math.abs(docs[0].ts - turn.ts),
        note: docs.length + ' lượt tra cứu tài liệu quanh lượt làm việc cùng lúc'
      });
    }
  }

  for (const command of manual) {
    const near = turns.filter((t) => Math.abs(t.ts - command.ts) < COMMAND_LINK_MS);
    if (near.length) {
      out.push({
        type: 'tu-chay-lenh', from: command.id, to: near[0].id,
        project: command.projectName, gapMs: Math.abs(near[0].ts - command.ts),
        note: 'huynh tự gõ lệnh trong lúc phiên AI đang chạy'
      });
    }
  }

  return out;
}

/* Bản đồ bằng chứng đầy đủ cho một ngày. */
function evidence(config, day, options) {
  const opts = options || {};
  const raw = E.readDay(config, day);
  let events = decorate(config, raw);

  /* Bước suy luận có kiểm soát: lượt tra cứu tài liệu không tự biết nó phục
     vụ dự án nào. Ta chỉ gán khi có một khối làm việc ĐÃ BIẾT dự án trùng
     thời điểm, và luôn đánh dấu inferred = true để giao diện nói thật rằng
     đây là suy ra, không phải dữ liệu gốc. */
  /* Chỉ lấy bằng chứng MẠNH làm neo: phiên Codex, commit, tệp sửa, phiên
     soạn thảo, lệnh tự gõ. Một lượt xem YouTube không đủ tư cách để nói
     huynh đang làm dự án nào. */
  const STRONG = { codex: 1, git: 1, files: 1, vscode: 1, shell: 1 };
  const anchors = events.filter((e) => !isInternal(e) && e.projectKey && STRONG[e.source])
    .sort((a, b) => a.ts - b.ts);
  events = events.map((event) => {
    if (event.projectKey || isInternal(event)) return event;
    let best = null;
    for (const anchor of anchors) {
      const distance = Math.abs(anchor.ts - event.ts);
      if (distance > INFER_WINDOW_MS) continue;
      if (!best || distance < best.distance) best = { anchor, distance };
    }
    if (!best) return event;
    return Object.assign({}, event, {
      projectKey: best.anchor.projectKey, projectName: best.anchor.projectName, inferred: true
    });
  });

  const work = events.filter((e) => (opts.includeInternal ? true : !isInternal(e)));
  const internal = events.filter(isInternal);
  const dayBlocks = blocks(config, work, opts);
  const projects = byProject(config, work);
  const counts = {};
  for (const event of work) {
    const key = event.source + ':' + event.kind;
    counts[key] = (counts[key] || 0) + 1;
  }

  return {
    day,
    events, work, internal,
    blocks: dayBlocks,
    projects,
    links: links(config, work),
    counts,
    minutes: activeMinutes(work, ACTIVE_GAP_MS),
    totals: {
      events: work.length,
      internal: internal.length,
      commits: work.filter((e) => e.source === 'git' && e.kind === 'commit').length,
      files: work.filter((e) => e.source === 'files' && e.kind === 'change').length,
      aiSessions: work.filter((e) => e.source === 'codex' && e.kind === 'session').length,
      aiTurns: work.filter((e) => e.source === 'codex' && e.kind === 'turn').length,
      tokens: U.sum(work.filter((e) => e.source === 'codex' && e.kind === 'session'), (e) => (e.meta.tokens || 0)),
      docs: work.filter((e) => e.source === 'browser' && e.meta && e.meta.category === 'học').length,
      entertainment: work.filter((e) => e.source === 'browser' && e.meta && e.meta.category === 'giải trí').length,
      manualCommands: work.filter((e) => e.source === 'shell' && e.kind === 'command').length
    }
  };
}

module.exports = {
  evidence, blocks, byProject, links, activeMinutes, span,
  coalesceIntervals, activitySpans, spanMinutes,
  projectKey, projectLabel, decorate, isInternal,
  GAP_MS, ACTIVE_GAP_MS, LINK_WINDOW_MS, COMMAND_LINK_MS, INFER_WINDOW_MS, MAX_SPAN_MS, MIN_EVENT_MS
};
