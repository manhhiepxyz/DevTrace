'use strict';

/* =====================================================================
   app/collect/git.js — Bằng chứng "kết quả tạo ra".

   Hoạt động nói huynh đã ngồi bao lâu; git nói huynh đã THỰC SỰ đổi được
   gì. Vì vậy mỗi commit là một sự kiện hạng nặng, kèm số tệp và số dòng
   thêm/bớt để lát nữa đối chiếu với phiên AI.
   ===================================================================== */

const { execFileSync } = require('child_process');
const path = require('path');
const U = require('../util');
const C = require('../config');

const MAX_COMMITS = 400;
const SINCE_DAYS = 60;

/* Chạy git và GIỮ LẠI stderr. Giữ stderr không phải để hiện lỗi cho huynh
   đọc, mà để phân biệt hai thứ trông giống hệt nhau nếu chỉ nhìn mã thoát:
   "git đọc không nổi" và "kho này chưa có commit nào". Cái đầu là đọc hụt —
   tầng trên phải giữ nguyên dữ liệu cũ. Cái sau là sự thật về kho, và phải
   được tính là đọc đủ, nếu không thì một kho vừa `git init` sẽ khoá cứng
   đường cập nhật của cả nguồn git. */
function gitFull(repo, args) {
  try {
    const out = execFileSync('git', args, {
      cwd: repo || undefined, encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    return { ok: true, out: out || '', err: '' };
  } catch (e) {
    return { ok: false, out: (e && e.stdout) || '', err: (e && e.stderr) || '' };
  }
}

function git(repo, args) {
  const r = gitFull(repo, args);
  return r.ok ? r.out : null;
}

// Kho mới `git init` nhưng chưa commit lần nào. Git coi đây là lỗi; với
// DevTrace đây là "kho rỗng", một câu trả lời hoàn toàn hợp lệ.
const EMPTY_REPO_RE = /does not have any commits yet|unknown revision or path|bad default revision/i;

/* Danh tính của huynh, đọc từ cấu hình git toàn cục. Trả về mảng rỗng khi
   git không có mặt hoặc chưa khai danh tính — lúc đó KHÔNG lọc gì cả, vì
   lọc bằng một danh sách rỗng sẽ ra bảng commit trắng trơn và người đọc
   tưởng mình không làm gì. Thà hiện thừa còn hơn hiện thiếu mà im lặng. */
function detectAuthors(runGit) {
  const g = runGit || git;
  const name = (g(null, ['config', '--global', 'user.name']) || '').trim();
  const email = (g(null, ['config', '--global', 'user.email']) || '').trim();
  return [name, email].filter(Boolean);
}

// Khớp theo tên hoặc theo thư điện tử, không phân biệt hoa thường. Trùng tên
// với người khác là chuyện có thật, nên thư điện tử được tính ngang hàng.
function matchesAuthor(commit, authors) {
  if (!authors.length) return true;
  const mine = authors.map((a) => a.toLowerCase());
  return mine.indexOf(String(commit.author || '').toLowerCase()) !== -1
    || mine.indexOf(String(commit.email || '').toLowerCase()) !== -1;
}

/* `run` là khe cắm kiểm thử, cùng lối `detectAuthors`/`readCommitsDetailed`
   đang dùng: truyền vào một hàm chạy git giả thì đọc được toàn bộ đường này
   mà không cần một kho thật trên đĩa. Bỏ trống thì rơi về `git` thật. */
function repoInfo(repo, run) {
  const r = run || git;
  if (!U.isDir(path.join(repo, '.git'))) return null;
  const branch = (r(repo, ['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim() || 'không rõ nhánh';
  const remote = (r(repo, ['config', '--get', 'remote.origin.url']) || '').trim();
  return { branch, remote };
}

// Đọc log kèm numstat: một khối "@@" mở đầu mỗi commit, sau đó là các dòng tệp.
// Kèm cờ ok: "git lỗi" (hết thời gian chờ, ổ đĩa mạng rút ra) khác hẳn với
// "kho thật sự chưa có commit nào". Tầng trên cần phân biệt để không xoá sạch
// dữ liệu cũ khi chỉ là đọc hụt.
/* `runGit` là khe cắm để kiểm thử chạy được toàn bộ đường đọc log mà không
   cần một kho git thật trên đĩa — cùng kiểu với `opts.kill` của stop.js. Khe
   cắm trả về chuỗi (đọc được) hoặc null (không đọc được); đây là dạng gọn
   của gitFull dành cho bài kiểm thử. */
function readCommitsDetailed(repo, runGit) {
  const fmt = '@@%H|%ct|%an|%ae|%s';
  if (runGit) {
    const out = runGit(repo, ['log', '--since=' + SINCE_DAYS + ' days ago', '--date=unix',
      '--pretty=format:' + fmt, '--numstat', '-n', String(MAX_COMMITS)]);
    if (out == null) return { ok: false, commits: [], empty: false };
    return { ok: true, commits: parseLog(out), empty: !String(out).trim() };
  }
  const result = gitFull(repo, ['log', '--since=' + SINCE_DAYS + ' days ago', '--date=unix',
    '--pretty=format:' + fmt, '--numstat', '-n', String(MAX_COMMITS)]);
  if (!result.ok) {
    // Kho chưa có commit nào: git báo lỗi, còn DevTrace coi đó là câu trả lời
    // hợp lệ ("kho rỗng"), không phải đọc hụt.
    if (EMPTY_REPO_RE.test(result.err || '')) return { ok: true, commits: [], empty: true };
    return { ok: false, commits: [], empty: false };
  }
  return { ok: true, commits: parseLog(result.out), empty: !result.out.trim() };
}

function parseLog(out) {
  const commits = [];
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('@@')) {
      const parts = line.slice(2).split('|');
      current = {
        sha: parts[0], ts: Number(parts[1]) * 1000, author: parts[2], email: parts[3],
        subject: parts.slice(4).join('|'), files: [], insertions: 0, deletions: 0
      };
      commits.push(current);
    } else if (current && line.trim()) {
      const m = line.split('\t');
      if (m.length >= 3) {
        const ins = m[0] === '-' ? 0 : Number(m[0]) || 0;
        const del = m[1] === '-' ? 0 : Number(m[1]) || 0;
        current.files.push({ path: m[2], ins, del });
        current.insertions += ins;
        current.deletions += del;
      }
    }
  }
  return commits;
}

function readCommits(repo) { return readCommitsDetailed(repo).commits; }

/* Cây làm việc còn bao nhiêu thay đổi chưa ghi, và chúng đang nằm ở đâu.

   `staged`/`unstaged` đọc từ hai ký tự đầu của --porcelain v1: cột X là
   trạng thái ở bản đã-chuẩn-bị, cột Y là trạng thái ở cây làm việc. Tách
   được hai cột này mới nói nổi câu "3 tệp đã chuẩn bị, 5 tệp còn dở" —
   `git status` bản ngắn không cho biết, mà đó lại đúng là thứ quyết định
   "sắp commit được chưa". Ba trường cũ giữ nguyên nghĩa nên chỗ đọc cũ
   không phải sửa.

   `run` là khe cắm kiểm thử, như ở `repoInfo`. */
function workingTree(repo, run) {
  const r = run || git;
  const out = r(repo, ['status', '--porcelain=v1']);
  if (out == null) return null;
  const lines = String(out).split('\n').filter((l) => l.trim());
  let staged = 0;
  let unstaged = 0;
  for (const line of lines) {
    const x = line.charAt(0);
    const y = line.charAt(1);
    if (x !== '?' && x !== ' ') staged++;
    if (x === '?' || y !== ' ') unstaged++;
  }
  const modified = lines.filter((l) => !l.startsWith('??')).length;
  const untracked = lines.filter((l) => l.startsWith('??')).length;
  return { modified, untracked, total: lines.length, staged, unstaged };
}

// Tự tìm thêm kho mã trong các thư mục gốc, có giới hạn độ sâu và số lượng.
function discoverRepos(roots, maxDepth, maxRepos) {
  const found = [];
  for (const root of roots) {
    if (!U.isDir(root)) continue;
    const stack = [{ dir: root, depth: 0 }];
    while (stack.length && found.length < maxRepos) {
      const { dir, depth } = stack.pop();
      if (U.isDir(path.join(dir, '.git'))) { found.push(dir); continue; }
      if (depth >= maxDepth) continue;
      let entries;
      try { entries = require('fs').readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
      }
    }
  }
  return found;
}

function collect(config, opts) {
  const settings = config.sources.git;
  if (!settings.enabled) return { events: [], notes: ['Git: đang tắt'] };
  /* Khe cắm chỉ có khi bài kiểm thử truyền vào. Để null nghĩa là dùng đường
     thật (gitFull) — đường này giữ stderr nên phân biệt được "kho rỗng" với
     "đọc hụt". Truyền đại `git` vào đây là mất khả năng phân biệt đó. */
  const runGit = (opts && opts.runGit) || null;
  const events = [];
  const notes = [];

  let repos = settings.repos.slice();
  if (settings.autoDiscover && settings.autoDiscover.enabled) {
    const extra = discoverRepos(settings.autoDiscover.roots, settings.autoDiscover.maxDepth, settings.autoDiscover.maxRepos);
    repos = U.uniq(repos.concat(extra));
  }

  // Danh sách tên/thư điện tử được tính là "của huynh". Khai trong cấu hình
  // thì dùng; không khai thì hỏi chính git.
  const authors = (settings.authors && settings.authors.length ? settings.authors : detectAuthors(runGit || git));
  if (!authors.length) {
    notes.push('Git: chưa xác định được danh tính của huynh (git config --global user.email trống) nên tạm tính mọi commit.');
  }
  let scanned = 0;
  let incomplete = false;

  for (const repo of repos) {
    // Đường dẫn không tồn tại (ổ mạng rút ra, thư mục đổi tên) là đọc hụt,
    // không phải "kho rỗng" — phải giữ nguyên dữ liệu git cũ.
    if (!U.isDir(repo)) {
      notes.push('Git: không thấy thư mục ' + repo + ' — kiểm tra lại sources.git.repos trong devtrace.config.json.');
      incomplete = true;
      continue;
    }
    const info = repoInfo(repo, runGit);
    if (!info) {
      notes.push('Git: bỏ qua ' + repo + ' — không phải kho git. Thêm đường dẫn kho của huynh vào devtrace.config.json → sources.git.repos, hoặc bật sources.git.autoDiscover.');
      continue;
    }
    scanned++;

    const read = readCommitsDetailed(repo, runGit);
    if (!read.ok) incomplete = true;
    const all = read.commits;
    const commits = all.filter((c) => matchesAuthor(c, authors));
    const others = all.length - commits.length;
    for (const commit of commits) {
      const topFiles = commit.files.slice().sort((a, b) => (b.ins + b.del) - (a.ins + a.del)).slice(0, 5);
      events.push({
        source: 'git', kind: 'commit', ts: commit.ts, project: repo,
        title: commit.subject.slice(0, 120),
        detail: commit.files.length + ' tệp · +' + commit.insertions + '/-' + commit.deletions + ' dòng' +
          (topFiles.length ? ' · ' + topFiles.map((f) => path.basename(f.path)).join(', ') : ''),
        id: 'git:' + commit.sha,
        meta: {
          sha: commit.sha.slice(0, 10), fullSha: commit.sha, author: commit.author, branch: info.branch,
          remote: info.remote, files: commit.files.length, insertions: commit.insertions,
          deletions: commit.deletions, topFiles: topFiles, repo
        }
      });
    }

    const tree = workingTree(repo, runGit);
    if (tree == null) {
      incomplete = true;
    } else if (tree.total > 0) {
      events.push({
        source: 'git', kind: 'worktree', ts: Date.now(), project: repo,
        title: 'Cây làm việc còn thay đổi chưa ghi',
        detail: tree.modified + ' tệp đã sửa · ' + tree.untracked + ' tệp mới chưa theo dõi',
        id: 'git:worktree:' + U.hash(repo),
        meta: Object.assign({ repo, branch: info.branch }, tree)
      });
    }

    notes.push('Git: ' + path.basename(repo) + ' — ' +
      (read.empty ? 'kho chưa có commit nào' : commits.length + ' commit của huynh' +
        (others ? ' (bỏ qua ' + others + ' commit của người khác)' : '')) +
      ', nhánh ' + info.branch +
      (tree ? ', ' + tree.total + ' thay đổi chưa ghi' : ''));
  }

  if (!scanned) notes.push('Git: không có kho nào để quét');
  // Chỉ khẳng định "đã đọc đủ" khi mọi kho đều truy cập được. Nếu không,
  // tầng trên giữ nguyên dữ liệu git cũ thay vì thay bằng một bản thiếu.
  return { events, notes, complete: !incomplete };
}

module.exports = {
  collect, discoverRepos, repoInfo, readCommits, readCommitsDetailed, workingTree,
  detectAuthors, matchesAuthor, parseLog, git, gitFull, EMPTY_REPO_RE
};
