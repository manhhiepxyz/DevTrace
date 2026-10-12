'use strict';

/* =====================================================================
   app/collect/files.js — Bằng chứng "tệp bị sửa" (nguồn dòng chảy).

   Khác với git, nguồn này bắt được cả những lần huynh sửa tệp mà chưa
   commit — tức là công sức thật đang diễn ra. Vì không có nhật ký sẵn nên
   phải tự chụp ảnh cây thư mục rồi so sánh giữa hai lần thu thập.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const U = require('../util');
const C = require('../config');

const MAX_EVENTS_PER_RUN = 400;
const BACKFILL_DAYS = 3;
const BACKFILL_MAX = 250;

function snapshotPath(config) { return path.join(config.dataDir, 'snapshots', 'files.json'); }

function isIgnored(rel, rules) {
  for (const rule of rules) {
    try { if (new RegExp(rule, 'i').test(rel)) return true; } catch (e) { /* luật sai: bỏ qua */ }
  }
  return false;
}

function scan(config) {
  const settings = config.sources.files;
  const rules = (settings.ignore || []).concat([U.norm(path.join(config.dataDir, '')) + '(^|/)']);
  const snapshot = {};
  const roots = settings.dirs.filter((d) => U.isDir(d));
  for (const root of roots) {
    const files = U.walkFiles(root, { maxDepth: settings.maxDepth == null ? 4 : settings.maxDepth });
    for (const file of files) {
      const rel = U.norm(path.relative(root, file));
      if (isIgnored(rel, rules)) continue;
      const stat = U.safeStat(file);
      if (!stat) continue;
      snapshot[root + '::' + rel] = { mtimeMs: stat.mtimeMs, size: stat.size, path: file, rel };
    }
  }
  return { snapshot, roots };
}

function collect(config) {
  const settings = config.sources.files;
  if (!settings.enabled) return { events: [], notes: ['Tệp tin: đang tắt'] };

  const file = snapshotPath(config);
  const previous = U.readJson(file, null);
  const { snapshot, roots } = scan(config);

  const events = [];
  const now = Date.now();
  const firstRun = !previous;

  for (const key of Object.keys(snapshot)) {
    const entry = snapshot[key];
    const before = previous && previous[key];
    if (!previous) {
      if (now - entry.mtimeMs <= BACKFILL_DAYS * 86400000 && events.length < BACKFILL_MAX) {
        events.push(makeChange(config, entry, 'thay đổi gần đây'));
      }
    } else if (!before) {
      events.push(makeChange(config, entry, 'tệp mới'));
    } else if (before.mtimeMs !== entry.mtimeMs || before.size !== entry.size) {
      events.push(makeChange(config, entry, 'tệp được sửa'));
    }
  }

  if (previous) {
    for (const key of Object.keys(previous)) {
      if (snapshot[key]) continue;
      const gone = previous[key];
      events.push({
        source: 'files', kind: 'change', ts: now, project: null,
        title: 'Đã xoá ' + path.basename(gone.path),
        id: 'files:del:' + U.hash(key + now),
        detail: 'phát hiện lúc thu thập (mốc thời gian chỉ là gần đúng)',
        meta: { path: gone.path, action: 'delete', approximate: true }
      });
    }
  }

  if (events.length > MAX_EVENTS_PER_RUN) events.length = MAX_EVENTS_PER_RUN;
  U.writeJson(file, snapshot);

  const notes = ['Tệp tin: ' + Object.keys(snapshot).length + ' tệp trong ' + roots.length + ' thư mục'];
  if (firstRun) notes.push('Tệp tin: lần chạy đầu — chỉ ghi các tệp sửa trong ' + BACKFILL_DAYS + ' ngày qua');
  return { events, notes };
}

function makeChange(config, entry, action) {
  const ext = path.extname(entry.path).replace('.', '') || 'không đuôi';
  const project = C.projectFor(config, entry.path);
  return {
    source: 'files', kind: 'change', ts: entry.mtimeMs, project: project ? project.path : entry.path,
    title: path.basename(entry.path),
    detail: action + ' · ' + ext + ' · ' + sizeText(entry.size),
    id: 'files:' + U.hash(entry.path + '|' + entry.mtimeMs + '|' + entry.size),
    meta: { path: entry.path, rel: entry.rel, action, ext, size: entry.size, mtimeMs: entry.mtimeMs }
  };
}

function sizeText(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

module.exports = { collect, scan };
