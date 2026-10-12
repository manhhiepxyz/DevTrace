#!/usr/bin/env node
'use strict';

/* =====================================================================
   tools/find-repos.js — Tìm kho git trên máy để điền vào cấu hình.

   VÌ SAO CẦN TỆP NÀY
   ------------------
   Git là nguồn bằng chứng mạnh nhất của DevTrace: nó nói huynh đã THỰC SỰ
   tạo ra kết quả gì. Nhưng DevTrace không tự biết kho mã của huynh nằm ở
   đâu, và nó cố tình không đoán bừa — đoán sai thì hoặc là quét nhầm thư
   mục, hoặc là im lặng đóng góp 0 sự kiện mà huynh không hiểu vì sao.

   Công cụ này quét những chỗ khả dĩ rồi in ra sẵn một đoạn JSON để huynh
   dán vào devtrace.config.json. Nó KHÔNG tự sửa cấu hình: huynh xem rồi
   quyết định.

   Chạy:
     node tools/find-repos.js
     node tools/find-repos.js --root D:\Code --root C:\Users\ACER\work
     node tools/find-repos.js --depth 4

   Chỗ nó quét (theo thứ tự):
     1. Mọi --root huynh tự truyền vào.
     2. Những thư mục huynh đã khai trong sources.files.dirs, và thư mục CHA
        của chúng — mã nguồn thường nằm cạnh nhau trong cùng một thư mục mẹ.
     3. Vài thư mục quen thuộc trong hồ sơ người dùng (source\repos, GitHub…).

   Cảnh báo cho đúng: nếu thư mục cha đó là gốc ổ đĩa — dự án này nằm ở
   D:\Dự án ma nên cha của nó là D:\ — thì bước 2 coi như quét cả ổ. Nó vẫn
   bị chặn bởi --depth (mặc định 3 tầng) và bởi trần MAX_REPOS kho, nhưng
   trên ổ nhiều dữ liệu thì nên giảm --depth hoặc chỉ thẳng --root.
   ===================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');

const C = require('../app/config');
const U = require('../app/util');
const git = require('../app/collect/git');

const DEFAULT_DEPTH = 3;
const MAX_REPOS = 60;
const RECENT_DAYS = 30;

/* Những thư mục hay chứa mã nguồn trong hồ sơ người dùng. Chỉ nhận những
   thư mục thật sự tồn tại — không nhận theo tên suông. */
function profileRoots(home) {
  const names = [
    'source/repos', 'source', 'repos', 'projects', 'dev', 'code', 'workspace',
    'Documents/GitHub', 'Documents/Projects', 'Documents/code', 'git'
  ];
  return names.map((name) => path.join(home, ...name.split('/'))).filter(U.isDir);
}

/* Chỗ đáng quét: thư mục huynh đã khai, thư mục cha của chúng, rồi tới
   những thư mục quen thuộc trong hồ sơ. Bỏ trùng và bỏ thư mục lồng nhau
   (đã quét cha thì quét con là thừa). */
function candidateRoots(config, extras) {
  const out = [];
  const push = (dir) => {
    if (!dir || !U.isDir(dir)) return;
    const full = path.resolve(dir);
    if (out.some((seen) => U.norm(seen) === U.norm(full))) return;
    out.push(full);
  };

  for (const dir of (extras || [])) push(dir);
  for (const dir of (config.sources.files.dirs || [])) {
    push(dir);
    push(path.dirname(path.resolve(dir)));
  }
  push(config.root);
  for (const dir of profileRoots(U.HOME)) push(dir);

  // Bỏ những gốc nằm lồng trong một gốc khác đã có: quét cha đã phủ con.
  return out.filter((dir) => !out.some((other) => {
    if (U.norm(other) === U.norm(dir)) return false;
    const rel = U.norm(dir).slice(U.norm(other).length);
    return U.norm(dir).startsWith(U.norm(other) + '/') && rel.length > 0;
  }));
}

/* Đếm commit trong RECENT_DAYS ngày gần đây. Trả về null khi không đọc được
   (git lỗi, ổ mạng rút ra) — khác hẳn 0 commit, và chỗ gọi phải phân biệt
   được: "kho này im lặng" và "không đọc nổi kho này" là hai chuyện khác nhau. */
function inspect(repo) {
  const info = git.repoInfo(repo) || { branch: 'không rõ nhánh', remote: '' };
  const read = git.readCommitsDetailed(repo);
  const since = Date.now() - RECENT_DAYS * 86400000;
  return {
    path: repo,
    branch: info.branch,
    remote: info.remote,
    readable: read.ok,
    recent: read.ok ? read.commits.filter((commit) => commit.ts >= since).length : null,
    total: read.ok ? read.commits.length : null
  };
}

function find(config, options) {
  const opts = options || {};
  const roots = candidateRoots(config, opts.roots);
  const depth = Number(opts.depth) > 0 ? Number(opts.depth) : DEFAULT_DEPTH;
  const found = git.discoverRepos(roots, depth, opts.maxRepos || MAX_REPOS);
  const repos = found.map(inspect);
  // Nhiều commit gần đây lên trước; không đọc được thì xuống cuối.
  repos.sort((a, b) => (b.recent === null ? -1 : b.recent) - (a.recent === null ? -1 : a.recent));
  return { roots, repos, depth, recentDays: RECENT_DAYS };
}

/* Chọn kho để đưa vào cấu hình. Kho chưa có commit nào thì gần như chắc chắn
   là thư mục rỗng hoặc mới `git init` — thêm vào chỉ làm mỗi lần thu thập
   chậm thêm mà không đóng góp gì. Kho không đọc được thì để huynh tự xem
   ở bảng phía trên rồi quyết định. */
const MAX_SNIPPET = 24;

function snippetRepos(repos) {
  const usable = repos.filter((repo) => repo.readable && repo.total > 0);
  return {
    list: usable.slice(0, MAX_SNIPPET),
    usable: usable.length,
    skippedEmpty: repos.filter((repo) => repo.readable && repo.total === 0).length,
    skippedUnreadable: repos.filter((repo) => !repo.readable).length,
    truncated: Math.max(0, usable.length - MAX_SNIPPET)
  };
}

/* Đoạn JSON để dán vào devtrace.config.json. Đường dẫn in bằng dấu gạch
   chéo xuôi vì JSON không cần thoát gạch ngược, và như vậy dễ đọc hơn. */
function configSnippet(repos) {
  return '"repos": ' + JSON.stringify(repos.map((r) => r.path.replace(/\\/g, '/')), null, 2).replace(/\n/g, '\n  ');
}

function print(report, out) {
  const write = out || ((line) => process.stdout.write(line + '\n'));

  write('Đã quét ' + report.roots.length + ' thư mục gốc (sâu tối đa ' + report.depth + '):');
  for (const root of report.roots) write('  ' + root);
  write('');

  if (!report.repos.length) {
    write('Không tìm thấy kho git nào.');
    write('');
    write('Nếu huynh biết chỗ để mã, chỉ thẳng cho nó:');
    write('  node tools/find-repos.js --root "D:\\Code"');
    return;
  }

  write('Tìm thấy ' + report.repos.length + ' kho:');
  write('');
  const cells = report.repos.map((repo) => ({
    recent: repo.readable ? String(repo.recent) : 'không đọc được',
    branch: String(repo.branch || '').slice(0, 15),
    path: repo.path
  }));
  const recentWidth = Math.max(12, ...cells.map((c) => c.recent.length));
  write('  ' + ('commit/' + report.recentDays + ' ngày').padEnd(recentWidth + 2) +
    'nhánh'.padEnd(16) + 'đường dẫn');
  for (const cell of cells) {
    write('  ' + cell.recent.padEnd(recentWidth + 2) + cell.branch.padEnd(16) + cell.path);
  }
  write('');
  const pick = snippetRepos(report.repos);
  if (!pick.list.length) {
    write('Không kho nào có commit để đưa vào cấu hình.');
    write('Nếu huynh vừa mới tạo kho và chưa commit lần nào thì đó là lý do.');
    return;
  }
  write('Dán đoạn sau vào devtrace.config.json, thay cho mục sources.git.repos:');
  write('');
  write('  ' + configSnippet(pick.list));
  write('');
  const notes = [];
  if (pick.skippedEmpty) notes.push('bỏ qua ' + pick.skippedEmpty + ' kho chưa có commit nào');
  if (pick.skippedUnreadable) notes.push('bỏ qua ' + pick.skippedUnreadable + ' kho không đọc được');
  if (pick.truncated) notes.push('còn ' + pick.truncated + ' kho nữa, tự thêm nếu muốn');
  if (notes.length) write('  (' + notes.join(' · ') + ')');
  write('');
  write('Xong thì chạy:  npm run collect    (hoặc bấm "Thu thập" trong ứng dụng)');
}

/* --- Lối vào dòng lệnh ----------------------------------------------- */

function parseArgs(argv) {
  const args = argv || [];
  const options = { roots: [], depth: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') { const v = args[++i]; if (v) options.roots.push(U.expandPath(v)); }
    else if (args[i] === '--depth') options.depth = Number(args[++i]);
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv || process.argv.slice(2));
  const report = find(C.load(), options);
  print(report);
  // Không tìm thấy gì cũng không phải lỗi: có thể huynh chưa có kho nào.
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { candidateRoots, profileRoots, inspect, find, snippetRepos, configSnippet, print, parseArgs, main };
