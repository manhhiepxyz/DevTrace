'use strict';

/* =====================================================================
   app/collect/window.js — Bằng chứng "thời gian tập trung" (tuỳ chọn).

   Windows không cho biết ứng dụng nào đang mở ở tiền cảnh trừ khi có một
   tiến trình chủ động hỏi. DevTrace không tự cài đặt gì vào máy huynh;
   thay vào đó có sẵn một script nhỏ để huynh tự chạy khi muốn đo:

       powershell -ExecutionPolicy Bypass -File tools/window-sampler.ps1

   Script ghi vào data/window-log.jsonl. Nguồn này chỉ đọc tệp đó, nên khi
   huynh không chạy script thì đơn giản là không có dữ liệu — không đoán.
   ===================================================================== */

const path = require('path');
const U = require('../util');

function logPath(config) { return path.join(config.dataDir, 'window-log.jsonl'); }
function checkpointPath(config) { return path.join(config.dataDir, 'snapshots', 'window.json'); }

function collect(config) {
  const settings = config.sources.window;
  const file = logPath(config);
  if (!settings.enabled) return { events: [], notes: ['Cửa sổ: đang tắt'] };
  if (!U.isFile(file)) {
    return { events: [], notes: ['Cửa sổ: chưa có data/window-log.jsonl — chạy tools/window-sampler.ps1 nếu muốn đo thời gian tập trung'] };
  }

  const rows = U.readJsonl(file);
  const state = U.readJson(checkpointPath(config), { lines: 0 });
  const fresh = rows.slice(state.lines || 0);
  const events = [];

  for (const row of fresh) {
    const ts = Number(row.ts);
    if (!isFinite(ts)) continue;
    const app = String(row.app || 'không rõ');
    const title = String(row.title || '').trim();
    events.push({
      source: 'window', kind: 'focus', ts, project: row.project || null,
      title: app + (title ? ' · ' + title.slice(0, 90) : ''),
      detail: Math.round(Number(row.seconds) || 0) + ' giây ở tiền cảnh',
      durationMs: Math.round((Number(row.seconds) || 0) * 1000),
      id: 'window:' + U.hash([ts, app, title, row.seconds].join('|')),
      meta: { app, title, seconds: Number(row.seconds) || 0 }
    });
  }

  U.writeJson(checkpointPath(config), { lines: rows.length });
  const notes = ['Cửa sổ: ' + fresh.length + ' đoạn tập trung mới'];
  return { events: notes.length ? events : [], notes };
}

module.exports = { collect, logPath };
