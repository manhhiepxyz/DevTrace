'use strict';

/* =====================================================================
   app/util.js — Tiện ích dùng chung cho toàn bộ DevTrace.
   Không phụ thuộc thư viện ngoài: chỉ fs, path, os của Node.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();

/* --- Đường dẫn ------------------------------------------------------ */

// Cho phép viết "~/..." hoặc "%APPDATA%/..." trong tệp cấu hình.
function expandPath(p) {
  if (!p || typeof p !== 'string') return p;
  let out = p;
  if (out === '~') return HOME;
  if (out.startsWith('~/') || out.startsWith('~\\')) out = path.join(HOME, out.slice(2));
  out = out.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, name) => process.env[name] || m);
  return path.resolve(out);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeStat(p) {
  try { return fs.statSync(p); } catch (e) { return null; }
}

function isFile(p) { const s = safeStat(p); return !!s && s.isFile(); }
function isDir(p) { const s = safeStat(p); return !!s && s.isDirectory(); }

/* --- Đọc / ghi ------------------------------------------------------ */

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
}

function readJson(file, fallback) {
  const text = readText(file);
  if (text == null) return fallback;
  // Nhiều trình soạn thảo trên Windows (Notepad, VS Code ở chế độ "UTF-8 with
  // BOM") ghi thêm U+FEFF ở đầu tệp. JSON.parse không nhận nó, nên một tệp
  // cấu hình hoàn toàn hợp lệ vẫn bị coi là hỏng — và bị ghi đè bằng mặc định.
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  try { return JSON.parse(clean); } catch (e) { return fallback; }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// Đọc tệp JSONL, bỏ qua dòng hỏng thay vì ném lỗi cả tệp.
function readJsonl(file) {
  const text = readText(file);
  if (!text) return [];
  const rows = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch (e) { /* dòng hỏng: bỏ qua */ }
  }
  return rows;
}

function writeJsonl(file, rows) {
  ensureDir(path.dirname(file));
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, body ? body + '\n' : '', 'utf8');
  fs.renameSync(tmp, file);
}

/* --- Duyệt thư mục -------------------------------------------------- */

// Duyệt cây thư mục có giới hạn độ sâu, trả về danh sách tệp khớp bộ lọc.
function walkFiles(root, options) {
  const opts = options || {};
  const maxDepth = opts.maxDepth == null ? 6 : opts.maxDepth;
  const skipDirs = new Set(opts.skipDirs || [
    'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'target', 'out',
    '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.idea', '.gradle',
    'vendor', 'Pods', '.cache', '.turbo', 'coverage', '.pytest_cache'
  ]);
  const limit = opts.limit == null ? 20000 : opts.limit;
  const out = [];
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length && out.length < limit) {
    const { dir, depth } = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth + 1 > maxDepth) continue;
        if (skipDirs.has(entry.name)) continue;
        if (opts.skipDir && opts.skipDir(full, entry.name)) continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile()) {
        if (opts.match && !opts.match(full, entry.name)) continue;
        out.push(full);
      }
    }
  }
  return out;
}

/* --- Thời gian ------------------------------------------------------ */

function pad2(n) { return String(n).padStart(2, '0'); }

// Khoá ngày theo giờ địa phương, có hỗ trợ "ngày bắt đầu lúc 4h sáng".
function dayKey(ms, dayStartHour) {
  const offset = (dayStartHour || 0) * 3600000;
  const d = new Date(ms - offset);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function dayKeyFromIso(iso, dayStartHour) {
  const ms = Date.parse(iso);
  return isNaN(ms) ? null : dayKey(ms, dayStartHour);
}

// Đổi ngày "YYYY-MM-DD" + số ngày lệch thành khoá ngày khác.
function shiftDay(key, delta) {
  const d = new Date(key + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function localTime(ms) {
  const d = new Date(ms);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// Chrome/Edge lưu thời gian theo "WebKit epoch" = micro-giây kể từ 1601-01-01.
const WEBKIT_EPOCH_OFFSET_MS = 11644473600000;
function webkitTimeToMs(webkitMicros) {
  const micros = Number(webkitMicros);
  if (!isFinite(micros) || micros <= 0) return null;
  return Math.round(micros / 1000) - WEBKIT_EPOCH_OFFSET_MS;
}

/* --- Linh tinh ------------------------------------------------------ */

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function sum(list, pick) {
  let total = 0;
  for (const item of list) total += pick ? pick(item) : item;
  return total;
}

function uniq(list) { return Array.from(new Set(list)); }

function norm(value) {
  return String(value == null ? '' : value).replace(/\\/g, '/').toLowerCase();
}

// Mã băm ngắn, ổn định, dùng để sinh id sự kiện có thể tái tạo nhiều lần.
function hash(input) {
  const text = String(input);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13);
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36));
}

function uid(prefix) {
  return (prefix ? prefix + '-' : '') + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

module.exports = {
  HOME,
  expandPath, ensureDir, safeStat, isFile, isDir,
  readText, readJson, writeJson, readJsonl, writeJsonl,
  walkFiles,
  pad2, dayKey, dayKeyFromIso, shiftDay, localTime, webkitTimeToMs,
  WEBKIT_EPOCH_OFFSET_MS,
  clamp, sum, uniq, norm, hash, uid
};
