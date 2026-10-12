'use strict';

/* =====================================================================
   app/ai.js — Tầng suy luận bằng AI.

   Đây là chỗ nguyên tắc "thu thập trước, suy luận sau" được thực thi:
   AI KHÔNG bao giờ được đưa ảnh chụp màn hình hay luồng sự kiện thô để
   "đọc cả ngày rồi tóm tắt". Nó chỉ nhận một GÓI BẰNG CHỨNG đã được đối
   chiếu sẵn, mỗi dòng đều kèm mã tham chiếu, và bị buộc phải chỉ về mã đó.

   Nhờ vậy: rẻ hơn, truy vết được, và khi sai thì biết sai ở đâu.
   ===================================================================== */

const path = require('path');
const U = require('./util');
const D = require('./digest');
const R = require('./redact');

const PROMPT_VERSION = 1;

function journalsDir(config) { return U.ensureDir(path.join(config.dataDir, 'journals')); }
function journalPath(config, day) { return path.join(journalsDir(config), day + '.json'); }

/* Gói bằng chứng gửi cho AI: đã nén, đã đánh mã, không chứa dữ liệu thừa.

   Đây cũng là chỗ duy nhất trong luồng AI mà dữ liệu rời khỏi máy, nên đây
   là chỗ che bí mật. Che ở đầu ra của hàm này chứ không che trong digest:
   màn hình vẫn phải hiện đúng thứ huynh đã gõ, còn gói gửi đi thì không. */
function evidencePack(config, day) {
  const digest = D.build(config, day);
  const hm = (ms) => (ms ? U.localTime(ms) : null);
  const raw = {
    kind: 'devtrace-evidence-pack',
    version: PROMPT_VERSION,
    day: digest.day,
    window: digest.window ? { start: hm(digest.window.start), end: hm(digest.window.end) } : null,
    activeMinutes: digest.minutes,
    totals: digest.totals,
    blocks: digest.blocks.map((b, i) => ({
      id: 'B' + (i + 1), start: hm(b.start), end: hm(b.end), minutes: b.minutes,
      project: b.project, sources: b.counts, highlights: b.headline.slice(0, 3)
    })),
    projects: digest.projects.map((p, i) => Object.assign({ id: 'P' + (i + 1) }, p, { minutes: p.minutes })),
    outcomes: {
      commits: digest.outcomes.commits.map((c, i) => ({ id: 'C' + (i + 1), at: hm(c.ts), project: c.project, title: c.title, detail: c.detail })),
      filesChanged: digest.outcomes.files.slice(0, 12).map((f, i) => ({ id: 'F' + (i + 1), at: hm(f.ts), project: f.project, file: f.title, note: f.detail })),
      uncommitted: digest.outcomes.uncommitted
    },
    /* Thời khoá biểu của ngày, kèm phần đối chiếu với thực tế.

       Đây là chữ HUYNH tự viết (tên buổi, mục tiêu), nên đi cùng gói được —
       khác hẳn tiêu đề thư, thứ người khác viết và không bao giờ rời máy.
       Chuyển tiếp cả `note` và `hasEvidence`: thiếu chúng thì AI nhận một
       danh sách buổi trống dấu vết và rất dễ viết thành "hôm đó huynh không
       làm gì", trong khi sự thật là ngày đó máy không đọc được gì. */
    schedule: {
      weekday: digest.schedule.weekdayLabel,
      hasEvidence: digest.schedule.hasEvidence,
      plannedMinutes: digest.schedule.plannedMinutes,
      matchedMinutes: digest.schedule.matchedMinutes,
      unaccountedMinutes: digest.schedule.unaccountedMinutes,
      counts: digest.schedule.counts,
      note: digest.schedule.note,
      sessions: digest.schedule.sessions.map((s, i) => ({
        id: 'S' + (i + 1), start: s.start, end: s.end, title: s.title, kind: s.kind,
        project: s.project, plannedMinutes: s.plannedMinutes,
        matchedMinutes: s.matchedMinutes, status: s.status
      }))
    },
    learning: {
      topSources: digest.learning.docs.map((d, i) => ({ id: 'D' + (i + 1), host: d.host, visits: d.visits, category: d.category, samples: d.titles })),
      categories: digest.learning.categories
    },
    coverage: {
      note: digest.coverage.note,
      contributing: digest.coverage.contributing,
      silent: digest.coverage.silent.map((s) => s.label),
      missing: digest.coverage.rows.filter((r) => r.enabled && r.events === 0 && r.reason)
        .map((r) => ({ source: r.label, reason: r.reason }))
    },
    /* Danh sách cảnh báo đi kèm y nguyên bản mà giao diện đang hiện. Nhờ vậy
       AI không thể viết trơn tru trong khi màn hình đang báo nguồn lỗi. */
    warnings: (digest.warnings || []).map((w) => ({
      level: w.level, kind: w.kind, source: w.source, title: w.title, detail: w.detail
    })),
    frictions: digest.frictions.map((f, i) => Object.assign({ id: 'X' + (i + 1) }, f, { at: hm(f.at) })),
    openQuestions: digest.openQuestions.map((q, i) => Object.assign({ id: 'Q' + (i + 1) }, q, { at: hm(q.at) })),
    hints: digest.nextSteps.map((s, i) => ({ id: 'N' + (i + 1), project: s.project, text: s.text })),
    momentum: {
      streakDays: digest.momentum.streakDays,
      averageMinutes: digest.momentum.averageMinutes,
      averageAiTurns: digest.momentum.averageAiTurns,
      recent: digest.momentum.series.map((s) => ({ day: s.day, minutes: s.minutes, aiTurns: s.aiTurns, files: s.files, commits: s.commits }))
    },
    note: 'Mọi con số ở đây do máy tính từ sự kiện thật. Chỉ các mã B/P/C/F/D/X/Q/N/S là tham chiếu để trích dẫn.'
  };

  const redacted = R.redactValue(raw, R.optionsFrom(config));
  /* Nói thẳng ra khi có che bớt. Che mà im lặng thì bản tổng kết đọc như thể
     ngày hôm đó không có gì bí mật, và huynh không có cách nào biết vì sao
     một dòng trông khác với điều mình nhớ đã làm. */
  if (redacted.hits.length) {
    redacted.value.privacy = {
      note: 'Một số chuỗi đã được che trước khi gửi: ' + R.summarize(redacted.hits) + '.',
      hits: redacted.hits
    };
  }
  return redacted.value;
}

function buildPrompt(pack) {
  return [
    'Bạn là người phụ trách tổng kết cho một lập trình viên tự học, dùng công cụ DevTrace.',
    'Dưới đây là GÓI BẰNG CHỨNG của một ngày, do máy đối chiếu từ nhiều nguồn (phiên Codex, git, tệp sửa, trình duyệt, terminal, trình soạn thảo).',
    '',
    'QUY TẮC BẮT BUỘC:',
    '1. Chỉ dùng dữ liệu trong gói bằng chứng. Không suy đoán, không thêm chi tiết không có trong đó.',
    '2. Mỗi nhận định phải kèm mã tham chiếu trong ngoặc, ví dụ (B2) hoặc (P1, D3). Không có mã thì không được viết.',
    '3. Nếu bằng chứng không đủ để kết luận, hãy nói thẳng "chưa đủ bằng chứng".',
    '   Mục "coverage" cho biết nguồn nào im lặng trong ngày này. Chỗ nào thiếu dữ liệu thì nói là thiếu, TUYỆT ĐỐI không suy ra là "không làm gì".',
    '   Mục "warnings" là những điều đáng lưu ý mà giao diện cũng đang hiện cho người dùng. Nếu có mục ở mức "bad", phải nhắc tới nó; không được viết như thể mọi thứ đều ổn.',
    '4. Trả lời bằng tiếng Việt, giọng điệu thẳng thắn, không tán dương sáo rỗng.',
    '5. Không đánh giá tiến bộ bằng số dòng code. Đánh giá bằng việc tự giải quyết vấn đề và mức độ phụ thuộc vào AI.',
    '',
    'Hãy trả lời đúng ba mục sau, mỗi mục có tiêu đề rõ ràng:',
    '',
    '### 1. Hôm nay đã làm gì',
    'Tóm tắt theo từng khối làm việc và từng dự án. Nêu dự án nào chiếm nhiều thời gian nhất, làm trong bao lâu.',
    '',
    '### 2. Đã tạo ra kết quả gì',
    'Đối chiếu hoạt động với kết quả: commit, tệp đã sửa, việc còn dở chưa ghi lại. Nói rõ chỗ nào là hoạt động nhưng KHÔNG có kết quả tương ứng.',
    '',
    '### 3. Học được gì và ngày mai làm gì',
    'Nêu các vấn đề chưa giải quyết, điều gì nên làm lại mà không cần AI, và 3 việc cụ thể cho ngày mai. Mỗi việc phải kèm mã tham chiếu.',
    '',
    'GÓI BẰNG CHỨNG (JSON):',
    '```json',
    JSON.stringify(pack, null, 1),
    '```'
  ].join('\n');
}

function readJournal(config, day) { return U.readJson(journalPath(config, day), null); }

/* ---------------------------------------------------------------------
   Kiểm chứng trích dẫn.

   Quy tắc số 2 trong lời nhắc bắt AI phải kèm mã tham chiếu cho mỗi nhận
   định. Nhưng "bắt" mà không "kiểm" thì chỉ là lời hứa: model có thể bịa ra
   (B9) trong khi gói bằng chứng chỉ có B1..B4, và bản tổng kết vẫn được lưu
   nguyên xi — kèm một trích dẫn trông rất đáng tin nhưng không trỏ tới đâu.

   Hai hàm dưới đây khoá chặt vòng đó: dựng bảng mã từ chính gói bằng chứng,
   rồi soi lại văn bản xem mã nào có thật, mã nào bịa. Bảng mã được LƯU KÈM
   nhật ký, vì mã chỉ có nghĩa tại thời điểm viết — hôm sau gói bằng chứng
   đổi thì (P1) có thể đã là dự án khác.
   --------------------------------------------------------------------- */

const CODE_RE = /\b([BPCFDXQNS])(\d{1,2})\b/g;
const CODE_FULL_RE = /^[BPCFDXQNS]\d{1,2}$/;

// Nhãn ngắn để người đọc biết (P3) là cái gì mà không cần mở lại gói bằng chứng.
function labelFor(code, node) {
  switch (code.charAt(0)) {
    case 'B':
      return [node.start, node.end].filter(Boolean).join('–') + (node.project ? ' · ' + node.project : '');
    case 'P': return String(node.project || '');
    case 'C': return String(node.title || '');
    case 'F': return String(node.file || '');
    case 'D': return String(node.host || '');
    // S là buổi trong thời khoá biểu. Nhãn phải kèm giờ, không chỉ tên buổi:
    // hai buổi khác nhau hoàn toàn có thể trùng tên ("Làm Nexus" sáng và
    // chiều), và khi đó (S2) trỏ vào đâu là chuyện không đọc ra được.
    case 'S': return [node.start, node.end].filter(Boolean).join('–') + (node.title ? ' · ' + node.title : '');
    default: return String(node.note || node.text || '');
  }
}

/* Duyệt gói bằng chứng và ghi lại mọi mã nó thật sự cấp. Duyệt theo cấu
   trúc thay vì liệt kê tay từng mảng, để hôm nào thêm loại bằng chứng mới
   thì bảng mã tự có — không phải nhớ sửa hai chỗ. */
function codeIndex(pack) {
  const out = {};
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.id === 'string' && CODE_FULL_RE.test(node.id)) {
      out[node.id] = labelFor(node.id, node);
      return;
    }
    Object.keys(node).forEach((key) => walk(node[key]));
  };
  walk(pack);
  return out;
}

/* Soi văn bản: mã nào có thật, mã nào không. Không ném lỗi, không sửa văn
   bản — chỉ nói sự thật để giao diện hiện lên. */
function checkCitations(text, codes) {
  const known = new Set(Object.keys(codes || {}));
  const seen = new Set();
  const invalid = [];
  let match;
  CODE_RE.lastIndex = 0;
  while ((match = CODE_RE.exec(String(text || '')))) {
    const code = match[1] + match[2];
    if (seen.has(code)) continue;
    seen.add(code);
    if (!known.has(code)) invalid.push(code);
  }
  const cited = seen.size;
  return {
    cited,
    valid: cited - invalid.length,
    invalid,
    // Không có mã nào nghĩa là vi phạm quy tắc số 2 — nhận định không có
    // bằng chứng đỡ lưng.
    uncited: cited === 0,
    known: known.size
  };
}

function saveJournal(config, day, entry) {
  const current = readJournal(config, day) || {};
  const codes = codeIndex(evidencePack(config, day));
  const check = checkCitations(entry && entry.text, codes);
  const next = Object.assign({}, current, entry, {
    day,
    updatedAt: Date.now(),
    // Bảng mã + kết quả soi, lưu cùng văn bản để sau này còn kiểm lại được.
    evidence: { version: PROMPT_VERSION, codes, check }
  });
  U.writeJson(journalPath(config, day), next);
  return next;
}

/* Gọi API nếu huynh cấu hình; không thì trả về lời nhắc để dán tay. */
async function synthesize(config, day) {
  const pack = evidencePack(config, day);
  const prompt = buildPrompt(pack);
  const ai = config.ai || {};
  const key = process.env[ai.apiKeyEnv || 'DEVTRACE_API_KEY'];

  if (ai.provider === 'none' || !ai.baseUrl || !ai.model) {
    return { mode: 'copy-paste', pack, prompt, reason: 'chưa cấu hình nhà cung cấp AI trong devtrace.config.json' };
  }
  if (!key) {
    return { mode: 'copy-paste', pack, prompt, reason: 'thiếu khoá trong biến môi trường ' + (ai.apiKeyEnv || 'DEVTRACE_API_KEY') };
  }

  const url = ai.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: ai.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'Bạn tổng kết bằng chứng và luôn trích dẫn mã tham chiếu. Không bịa.' },
          { role: 'user', content: prompt }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text();
      return { mode: 'error', pack, prompt, reason: 'API trả về ' + response.status + ': ' + body.slice(0, 300) };
    }
    const data = await response.json();
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) return { mode: 'error', pack, prompt, reason: 'API không trả về nội dung' };
    // Lưu nguyên văn, kể cả khi trích dẫn sai. Thà giữ lại kèm lời cảnh báo
    // còn hơn âm thầm sửa chữ của người khác — và còn hơn xoá mất bản nháp
    // duy nhất huynh đang có.
    const saved = saveJournal(config, day, { text, source: 'api', model: ai.model, promptVersion: PROMPT_VERSION });
    return {
      mode: 'api', pack, prompt, text, model: ai.model, usage: data.usage || null,
      check: saved.evidence ? saved.evidence.check : null
    };
  } catch (error) {
    return { mode: 'error', pack, prompt, reason: 'không gọi được API: ' + (error && error.message) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  evidencePack, buildPrompt, synthesize, readJournal, saveJournal, journalPath,
  codeIndex, checkCitations, PROMPT_VERSION
};
