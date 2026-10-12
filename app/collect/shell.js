'use strict';

/* =====================================================================
   app/collect/shell.js — Bằng chứng "tự tay làm" (nguồn dòng chảy).

   File lịch sử của PSReadLine KHÔNG có mốc thời gian. Vì vậy nguồn này chỉ
   ghi những dòng MỚI xuất hiện kể từ lần thu thập trước, lấy thời điểm thu
   thập làm mốc. Nhờ đó bằng chứng luôn trung thực: cái gì không biết thì
   không đoán.

   Lệnh do AI chạy đã được ghi riêng trong nguồn Codex, nên phần ở đây
   chính là phần huynh tự gõ — thước đo tự lực đáng giá nhất.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const U = require('../util');

const MAX_NEW = 300;

function historyFiles() {
  const roaming = path.join(U.HOME, 'AppData', 'Roaming');
  return [
    { name: 'PowerShell 5', file: path.join(roaming, 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt') },
    { name: 'PowerShell 7', file: path.join(roaming, 'Microsoft', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt') }
  ];
}

function checkpointPath(config) { return path.join(config.dataDir, 'snapshots', 'shell.json'); }

function tagsOf(cmd) {
  const tags = [];
  if (/^\s*git\b/.test(cmd)) tags.push('git');
  if (/\b(npm|yarn|pnpm|bun)\b/.test(cmd)) tags.push('js');
  if (/\b(mvn|gradle|java|javac)\b/.test(cmd)) tags.push('java');
  if (/\b(docker|kubectl|helm)\b/.test(cmd)) tags.push('hạ tầng');
  if (/\b(python|pip|conda)\b/.test(cmd)) tags.push('python');
  if (/\b(node|deno)\b/.test(cmd)) tags.push('node');
  if (/\b(ssh|curl|wget|Invoke-WebRequest)\b/.test(cmd)) tags.push('mạng');
  if (/\b(Test-|Get-|Set-|New-|Remove-|Select-|Where-|ForEach-)/.test(cmd)) tags.push('powershell');
  if (/\b(cd|Set-Location|ls|dir|Get-ChildItem)\b/.test(cmd)) tags.push('điều hướng');
  return U.uniq(tags);
}

function collect(config) {
  const settings = config.sources.shell;
  if (!settings.enabled) return { events: [], notes: ['Terminal: đang tắt'] };

  const stateFile = checkpointPath(config);
  const state = U.readJson(stateFile, { files: {} });
  const events = [];
  const notes = [];
  const now = Date.now();

  for (const item of historyFiles()) {
    if (!U.isFile(item.file)) continue;
    const text = U.readText(item.file);
    if (text == null) continue;
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 1);
    const stat = U.safeStat(item.file);
    const before = state.files[item.file];

    if (!before) {
      // Lần đầu: không biết lệnh cũ được gõ lúc nào nên chỉ ghi một mốc tổng hợp.
      events.push({
        source: 'shell', kind: 'history', ts: stat.mtimeMs, project: null,
        title: 'Lịch sử terminal: ' + lines.length + ' lệnh',
        detail: 'nạp lần đầu · từ đây trở đi DevTrace ghi từng lệnh mới kèm thời điểm',
        id: 'shell:seed:' + U.hash(item.file + lines.length),
        weight: 1,
        meta: { shell: item.name, file: item.file, approximate: true, total: lines.length }
      });
      state.files[item.file] = { lines: lines.length, size: stat.size };
      notes.push(item.name + ': nạp ' + lines.length + ' lệnh cũ (không có mốc thời gian)');
      continue;
    }

    if (lines.length > before.lines) {
      const fresh = lines.slice(before.lines).slice(-MAX_NEW);
      for (const cmd of fresh) {
        const tags = tagsOf(cmd);
        events.push({
          source: 'shell', kind: 'command', ts: now, project: null,
          title: cmd.slice(0, 120),
          detail: tags.length ? tags.join(' · ') : 'lệnh terminal',
          id: 'shell:' + U.hash(item.file + '|' + lines.length + '|' + cmd),
          meta: { shell: item.name, cmd, tags, approximate: true }
        });
      }
      notes.push(item.name + ': ' + fresh.length + ' lệnh mới');
      state.files[item.file] = { lines: lines.length, size: stat.size };
    } else if (lines.length < before.lines) {
      // Tệp bị ghi đè: bỏ qua để không ghi nhầm, chỉ cập nhật lại mốc.
      state.files[item.file] = { lines: lines.length, size: stat.size };
      notes.push(item.name + ': lịch sử bị rút gọn, đã đặt lại mốc theo dõi');
    }
  }

  U.writeJson(stateFile, state);
  if (!notes.length) notes.push('Terminal: không có lệnh mới');
  return { events, notes };
}

module.exports = { collect, tagsOf, historyFiles };
