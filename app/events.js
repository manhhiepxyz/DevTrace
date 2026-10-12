'use strict';

/* =====================================================================
   app/events.js — Mô hình sự kiện thống nhất + kho lưu append-only.

   Mọi nguồn dữ liệu đều đổ về MỘT hình dạng sự kiện duy nhất. Nhờ vậy
   tầng suy luận không cần biết sự kiện đến từ Codex hay từ Chrome; nó chỉ
   cần biết "bằng chứng loại gì, thuộc dự án nào, lúc nào".

   Nguyên tắc: THU THẬP trước — SUY LUẬN sau. Kho sự kiện là bản ghi bất
   biến để còn truy vết; mọi kết luận của AI đều phải chỉ được về đây.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const U = require('./util');

/* Bảng mô tả nguồn: nhãn hiển thị, loại bằng chứng, màu. */
const SOURCES = {
  codex:   { label: 'Codex',       kind: 'ai',      evidence: 'phiên làm việc với AI', color: '#7c5cff' },
  git:     { label: 'Git',         kind: 'code',    evidence: 'thay đổi mã nguồn',     color: '#e8734a' },
  github:  { label: 'GitHub',      kind: 'code',    evidence: 'hoạt động trên GitHub', color: '#8250df' },
  files:   { label: 'Tệp tin',     kind: 'code',    evidence: 'tệp được sửa',          color: '#4aa8e8' },
  browser: { label: 'Trình duyệt', kind: 'context', evidence: 'nguồn tham khảo',       color: '#3fb98a' },
  shell:   { label: 'Terminal',    kind: 'action',  evidence: 'lệnh đã chạy',          color: '#c9a227' },
  vscode:  { label: 'VS Code',     kind: 'context', evidence: 'phiên soạn thảo',       color: '#2f7fd6' },
  window:  { label: 'Cửa sổ',      kind: 'focus',   evidence: 'thời gian tập trung',   color: '#9c6ade' },
  manual:  { label: 'Tự ghi',      kind: 'manual',  evidence: 'ghi chú của huynh',     color: '#8a8a8a' }
};

/* Nguồn "suy ra được": mỗi lần thu thập sẽ tính lại từ đầu, nên cần xoá
   bản cũ trước khi ghi bản mới để không nhân đôi sự kiện.
   Nguồn "dòng chảy" (files, window, github) chỉ ghi thêm, phải khử trùng
   theo id.

   `github` nằm ở nhóm dòng chảy là một quyết định, không phải mặc định:
   API sự kiện công khai của GitHub chỉ trả về khoảng 90 ngày gần nhất, nên
   nếu tính lại từ đầu thì mỗi lần thu thập lại xoá đi những gì vừa rơi ra
   khỏi cửa sổ đó. Bằng chứng đã thấy một lần thì ở lại. */
const DERIVED_SOURCES = ['codex', 'git', 'browser', 'vscode'];
const STREAM_SOURCES = ['files', 'shell', 'window', 'github', 'manual'];

const DEFAULT_WEIGHT = { codex: 3, git: 3, files: 1, browser: 1, shell: 2, vscode: 1, window: 1, github: 2, manual: 2 };

function dataDir(config) { return U.ensureDir(config.dataDir); }
function eventsDir(config) { return U.ensureDir(path.join(config.dataDir, 'events')); }
function dayFilePath(config, day) { return path.join(eventsDir(config), day + '.jsonl'); }
function healthPath(config) { return path.join(config.dataDir, 'health.json'); }

/* Chuẩn hoá một sự kiện thô do collector tạo ra. */
function makeEvent(config, raw) {
  if (!raw || !raw.source) throw new Error('Sự kiện thiếu trường "source".');
  const ts = Number(raw.ts);
  if (!isFinite(ts)) throw new Error('Sự kiện thiếu mốc thời gian hợp lệ.');
  const source = raw.source;
  const info = SOURCES[source] || { label: source, kind: 'other', evidence: '', color: '#888888' };
  const id = raw.id || (source + ':' + U.hash([source, raw.kind || '', ts, raw.title || '', raw.detail || ''].join('|')));
  return {
    id,
    ts,
    day: U.dayKey(ts, config.dayStartHour),
    source,
    kind: raw.kind || 'event',
    project: raw.project || null,
    title: String(raw.title || info.label),
    detail: raw.detail ? String(raw.detail) : '',
    durationMs: isFinite(Number(raw.durationMs)) ? Number(raw.durationMs) : null,
    weight: isFinite(Number(raw.weight)) ? Number(raw.weight) : (DEFAULT_WEIGHT[source] || 1),
    ref: raw.ref || null,
    meta: raw.meta || {}
  };
}

function makeMany(config, raws) {
  const out = [];
  for (const raw of raws || []) {
    try { out.push(makeEvent(config, raw)); } catch (e) { /* bỏ sự kiện hỏng, không làm gãy cả mẻ */ }
  }
  return out;
}

function sortEvents(list) {
  return list.slice().sort((a, b) => (a.ts - b.ts) || (a.id < b.id ? -1 : 1));
}

/* --- Đọc / ghi theo ngày ------------------------------------------- */

function readDay(config, day) {
  return U.readJsonl(dayFilePath(config, day));
}

function writeDay(config, day, events) {
  // Ngày không còn sự kiện nào thì xoá hẳn tệp, để danh sách ngày không
  // hiện ra những mục rỗng.
  if (!events.length) {
    const file = dayFilePath(config, day);
    if (U.isFile(file)) { try { fs.unlinkSync(file); } catch (e) { /* bỏ qua */ } }
    return 0;
  }
  U.writeJsonl(dayFilePath(config, day), sortEvents(events));
  return events.length;
}

// Thay toàn bộ sự kiện của một nguồn trong một ngày, giữ nguyên các nguồn khác.
function replaceSource(config, day, source, events) {
  const existing = readDay(config, day).filter((e) => e.source !== source);
  const merged = dedupe(existing.concat(events));
  writeDay(config, day, merged);
  return events.length;
}

// Ghi thêm (dùng cho nguồn dòng chảy), tự khử trùng theo id.
function addEvents(config, day, events) {
  const existing = readDay(config, day);
  const known = new Set(existing.map((e) => e.id));
  let added = 0;
  for (const event of events) {
    if (known.has(event.id)) continue;
    known.add(event.id);
    existing.push(event);
    added++;
  }
  writeDay(config, day, existing);
  return added;
}

/* Nguồn suy ra được là một "hình chiếu" của dữ liệu gốc, nên mỗi lần thu
   thập phải xoá sạch bản cũ trên MỌI ngày rồi ghi lại — nếu chỉ thay theo
   ngày thì những sự kiện gắn với "hiện tại" (ví dụ cây làm việc của git)
   sẽ còn sót lại ở ngày hôm qua. */
function replaceSourceAllDays(config, source, events) {
  for (const day of listDays(config)) {
    const kept = readDay(config, day).filter((e) => e.source !== source);
    const mine = events.filter((e) => e.day === day);
    writeDay(config, day, kept.concat(mine));
  }
  const days = new Set(events.map((e) => e.day));
  for (const day of days) {
    if (listDays(config).indexOf(day) !== -1) continue;
    writeDay(config, day, events.filter((e) => e.day === day));
  }
  return events.length;
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const event of list) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
  }
  return out;
}

/* --- Truy vấn ------------------------------------------------------- */

function listDays(config) {
  const dir = eventsDir(config);
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  return names.filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
    .map((n) => n.slice(0, 10))
    .sort();
}

function readRange(config, fromDay, toDay) {
  const out = [];
  for (const day of listDays(config)) {
    if (fromDay && day < fromDay) continue;
    if (toDay && day > toDay) continue;
    out.push.apply(out, readDay(config, day));
  }
  return sortEvents(out);
}

// Xoá sự kiện của một ngày (dùng khi huynh muốn làm lại từ đầu ngày đó).
function clearDay(config, day) {
  const file = dayFilePath(config, day);
  if (U.isFile(file)) fs.unlinkSync(file);
}

/* --- Sức khoẻ nguồn -------------------------------------------------- */

function readHealth(config) { return U.readJson(healthPath(config), { sources: {} }); }

function writeHealth(config, patch) {
  const current = readHealth(config);
  current.sources = Object.assign({}, current.sources, patch);
  current.updatedAt = Date.now();
  U.writeJson(healthPath(config), current);
  return current;
}

module.exports = {
  SOURCES, DERIVED_SOURCES, STREAM_SOURCES, DEFAULT_WEIGHT,
  dataDir, eventsDir, dayFilePath, healthPath,
  makeEvent, makeMany, sortEvents, dedupe,
  readDay, writeDay, replaceSource, replaceSourceAllDays, addEvents,
  listDays, readRange, clearDay,
  readHealth, writeHealth
};
