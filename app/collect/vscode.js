'use strict';

/* =====================================================================
   app/collect/vscode.js — Bằng chứng "làm việc trong trình soạn thảo".

   VS Code lưu mỗi không gian làm việc vào một thư mục riêng trong
   workspaceStorage; thời điểm sửa đổi thư mục đó chính là lần cuối huynh
   mở dự án. Ngoài ra số tệp trong chatSessions cho biết huynh có dùng
   trợ lý AI trong editor hay không.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const U = require('../util');
const C = require('../config');

const KEEP_DAYS = 45;

function userDir() {
  return path.join(U.HOME, 'AppData', 'Roaming', 'Code', 'User');
}

function decodeFolder(uri) {
  if (!uri) return null;
  try {
    const stripped = String(uri).replace(/^file:\/\//, '');
    const decoded = decodeURIComponent(stripped);
    if (/^\/[a-zA-Z]:/.test(decoded)) return decoded.slice(1).replace(/\//g, path.sep);
    return decoded.replace(/\//g, path.sep);
  } catch (e) { return null; }
}

function countFiles(dir) {
  try { return fs.readdirSync(dir).length; } catch (e) { return 0; }
}

function collect(config) {
  const settings = config.sources.vscode;
  if (!settings.enabled) return { events: [], notes: ['VS Code: đang tắt'] };

  const base = userDir();
  const storage = path.join(base, 'workspaceStorage');
  if (!U.isDir(storage)) return { events: [], notes: ['VS Code: không thấy workspaceStorage'] };

  const events = [];
  const notes = [];
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  let dirs = [];
  try { dirs = fs.readdirSync(storage, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch (e) { dirs = []; }

  for (const dir of dirs) {
    const full = path.join(storage, dir.name);
    const stat = U.safeStat(full);
    if (!stat || stat.mtimeMs < cutoff) continue;
    const meta = U.readJson(path.join(full, 'workspace.json'), null);
    const folder = decodeFolder(meta && meta.folder);
    if (!folder) continue;
    const chats = countFiles(path.join(full, 'chatSessions'));
    const project = C.projectFor(config, folder);

    events.push({
      source: 'vscode', kind: 'workspace', ts: stat.mtimeMs, project: folder,
      title: 'VS Code · ' + (project ? project.name : path.basename(folder)),
      detail: 'phiên soạn thảo gần nhất' + (chats ? ' · ' + chats + ' phiên trò chuyện AI' : ''),
      id: 'vscode:' + U.hash(folder + '|' + stat.mtimeMs),
      meta: { folder, hash: dir.name, chatSessions: chats }
    });
  }

  // Cửa sổ đang mở hiện tại: bằng chứng "đang làm gì ngay lúc này".
  const state = U.readJson(path.join(base, 'globalStorage', 'storage.json'), null);
  const active = state && state.windowsState && state.windowsState.lastActiveWindow;
  const activeFolder = active && decodeFolder(active.folder);
  if (activeFolder) {
    const project = C.projectFor(config, activeFolder);
    events.push({
      source: 'vscode', kind: 'active', ts: Date.now(), project: activeFolder,
      title: 'Đang mở: ' + (project ? project.name : path.basename(activeFolder)),
      detail: 'cửa sổ VS Code đang hoạt động',
      id: 'vscode:active:' + U.hash(activeFolder),
      weight: 1,
      meta: { folder: activeFolder }
    });
  }

  notes.push('VS Code: ' + events.length + ' không gian làm việc trong ' + KEEP_DAYS + ' ngày');
  return { events, notes };
}

module.exports = { collect, decodeFolder };
