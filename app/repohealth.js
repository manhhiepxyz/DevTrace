'use strict';

/* =====================================================================
   app/repohealth.js — Sức khoẻ kho mã, đọc lúc này.

   Vì sao tách khỏi kho bằng chứng: cây làm việc bẩn của hôm nay KHÔNG nói
   được gì về ngày 3 tháng trước. Nếu nhét nó vào `data/events/`, thì mở lại
   bản tổng hợp của một ngày cũ sẽ thấy "còn 12 tệp chưa ghi" — một câu sai
   về ngày đó, vì lúc đó số tệp chưa ghi là con số khác.

   Nên đây là ẢNH CHỤP, một tệp (`data/repohealth.json`), luôn nói về BÂY
   GIỜ, và `alerts.js` chỉ được phát cảnh báo từ nó khi ngày đang xem đúng
   là hôm nay. Xem `isToday` bên đó.

   Quét là việc PHẢI CHỌN, không phải việc tự động: mỗi kho tốn khoảng sáu
   lệnh git, mà cấu hình thật đang có hàng chục kho. Nên có `healthMaxRepos`
   và một nút "làm mới" riêng — không nhét vào đường thu thập, vì đường đó
   chạy đồng bộ và không được phép treo vài chục giây.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const U = require('./util');
const Git = require('./collect/git');

const DEFAULT_MAX_REPOS = 20;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const STALE_BRANCH_DAYS = 30;
const MANY_CHANGES = 20;
const MANY_STASHES = 3;

function healthFile(config) { return path.join(config.dataDir, 'repohealth.json'); }

/* --- Cấu hình, đọc chịu được thiếu khoá ------------------------------ */

/* `healthMaxRepos` và `secretScan` chưa có trong `defaults()` ở bước này.
   Đọc kèm giá trị lui để tệp cấu hình của người dùng cũ vẫn chạy đúng, và
   để bước thêm khoá vào Cài đặt không phải sửa gì ở đây. */
function settingsOf(config) {
  const git = (config.sources && config.sources.git) || {};
  const max = Number(git.healthMaxRepos);
  return {
    maxRepos: isFinite(max) && max > 0 ? Math.round(max) : DEFAULT_MAX_REPOS,
    secretScan: git.secretScan === true,
    repos: Array.isArray(git.repos) ? git.repos : []
  };
}

function repoList(config) {
  const settings = settingsOf(config);
  let repos = settings.repos.slice();
  const auto = (config.sources && config.sources.git && config.sources.git.autoDiscover) || {};
  if (auto.enabled) {
    repos = U.uniq(repos.concat(Git.discoverRepos(auto.roots || [], auto.maxDepth, auto.maxRepos)));
  }
  return repos;
}

/* --- Đọc từng mảnh, mỗi mảnh một lệnh -------------------------------- */

/* Mọi hàm dưới đây nhận `run` là khe cắm kiểm thử, đúng lối
   `detectAuthors(runGit)` / `workingTree(repo, run)` đang có: truyền vào một
   hàm chạy git giả thì đọc được toàn bộ đường này mà không cần kho thật. */

function text(run, repo, args) {
  const out = run(repo, args);
  return out == null ? null : String(out);
}

/* `git rev-list --left-right --count @{upstream}...HEAD` in ra "trái\tphải".
   Trái là commit chỉ có ở remote (chưa kéo về), phải là commit chỉ có ở máy
   (chưa đẩy lên). Nhầm hai cột này là nói ngược hẳn tình hình.

   Khai thành hằng số vì `app/nudges.js` cũng chạy đúng lệnh này, chỉ khác
   là song song cho nhiều kho. Để hai chỗ tự viết lấy thì có ngày một chỗ
   đổi mà chỗ kia không, và hai màn hình nói hai kiểu về cùng một kho. */
const UPSTREAM_ARGS = ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'];

function aheadBehind(run, repo) {
  const out = text(run, repo, UPSTREAM_ARGS);
  if (out == null) return { upstream: false, ahead: null, behind: null };
  const parts = out.trim().split(/\s+/);
  const behind = Number(parts[0]);
  const ahead = Number(parts[1]);
  if (!isFinite(behind) || !isFinite(ahead)) return { upstream: false, ahead: null, behind: null };
  return { upstream: true, ahead, behind };
}

function stashes(run, repo) {
  const out = text(run, repo, ['stash', 'list', '--format=%gd|%ct|%s']);
  if (out == null) return null;
  const list = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    list.push({
      ref: parts[0] || '',
      ts: (Number(parts[1]) || 0) * 1000 || null,
      subject: parts.slice(2).join('|').slice(0, 120)
    });
  }
  return list;
}

/* Nhánh: `for-each-ref` cho biết có bao nhiêu và nhánh nào đã cũ, `branch
   --merged` cho biết nhánh nào đã gộp xong (tức là xoá được). Hai lệnh vì
   git không có một lệnh nào trả lời cả hai. */
function branches(run, repo, now) {
  const out = text(run, repo, ['for-each-ref', '--sort=-committerdate',
    '--format=%(refname:short)|%(committerdate:unix)', 'refs/heads']);
  if (out == null) return null;
  const mergedOut = text(run, repo, ['branch', '--merged']);
  const merged = new Set();
  if (mergedOut != null) {
    for (const line of mergedOut.split('\n')) {
      const name = line.replace(/^[*+]?\s*/, '').trim();
      if (name && name !== '(HEAD detached)') merged.add(name);
    }
  }
  const list = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    const name = parts[0] || '';
    const ts = (Number(parts[1]) || 0) * 1000 || null;
    const ageDays = ts ? Math.floor((now - ts) / 86400000) : null;
    list.push({ name, lastCommitMs: ts, ageDays, merged: merged.has(name) });
  }
  return list;
}

function tags(run, repo) {
  const out = text(run, repo, ['tag', '--sort=-creatordate', '--format=%(refname:short)|%(creatordate:unix)']);
  if (out == null) return null;
  const list = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    list.push({ name: parts[0] || '', ts: (Number(parts[1]) || 0) * 1000 || null });
  }
  return list;
}

/* Tệp lớn: `ls-tree -r -l HEAD` in ra "<mode> <type> <sha> <size>\t<path>".
   Kích thước là ký tự `-` với cây thư mục, nên phải chịu được cả hai. */
function bigFiles(run, repo, minBytes) {
  const out = text(run, repo, ['ls-tree', '-r', '-l', 'HEAD']);
  if (out == null) return null;
  const list = [];
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const meta = line.slice(0, tab).trim().split(/\s+/);
    const size = Number(meta[3]);
    if (!isFinite(size) || size < minBytes) continue;
    list.push({ path: line.slice(tab + 1).slice(0, 200), bytes: size });
  }
  return list.sort((a, b) => b.bytes - a.bytes).slice(0, 20);
}

/* --- Quét bí mật: đắt, và phải chọn mới chạy ------------------------- */

/* Dùng lại `redact.RULES` — cùng bộ quy tắc đang che bí mật trước khi gửi
   dữ liệu đi. Dùng lại chứ không viết bộ mới: hai bộ quy tắc khác nhau thì
   có ngày DevTrace báo "có bí mật" ở chỗ mà đường gửi đi vẫn để lọt.

   ĐIỀU QUAN TRỌNG NHẤT: hàm này KHÔNG BAO GIỜ trả về chuỗi khớp được. Nó
   chỉ nói tệp nào, dòng nào, khớp quy tắc tên gì. Báo "tệp X dòng 12 có thể
   chứa khoá" là đủ để huynh đi kiểm; in cả giá trị ra thì cái bảng báo cáo
   lại thành chỗ phát tán đúng thứ nó đang cảnh báo. */
function scanSecrets(repo, opts) {
  const options = opts || {};
  const run = options.run;
  const readFile = options.readFile || ((full) => {
    try { return fs.readFileSync(full, 'utf8'); } catch (error) { return null; }
  });
  const listOut = text(run, repo, ['ls-files']);
  if (listOut == null) return null;

  const rules = require('./redact').RULES;
  const hits = [];
  let scanned = 0;
  for (const rel of listOut.split('\n')) {
    const name = rel.trim();
    if (!name) continue;
    const content = readFile(path.join(repo, name));
    if (content == null) continue;
    // Tệp nhị phân: NUL ở đầu là dấu hiệu chắc chắn, bỏ qua chứ không quét
    // trên một đống byte vô nghĩa rồi báo nhầm.
    if (content.indexOf('\u0000') !== -1) continue;
    scanned++;
    const lines = content.split('\n');
    for (const rule of rules) {
      rule.re.lastIndex = 0;
      const whole = rule.re.test(content);
      rule.re.lastIndex = 0;
      if (!whole) continue;
      for (let i = 0; i < lines.length; i++) {
        rule.re.lastIndex = 0;
        if (!rule.re.test(lines[i])) continue;
        hits.push({ path: name.slice(0, 200), line: i + 1, rule: rule.name, label: rule.label });
        break;
      }
      if (hits.length >= (options.maxHits || 50)) return { hits, scanned, truncated: true };
    }
  }
  return { hits, scanned, truncated: false };
}

/* --- Ảnh chụp một kho ------------------------------------------------ */

function repoSnapshot(config, repo, opts) {
  const options = opts || {};
  const run = options.run || Git.git;
  const now = options.now == null ? Date.now() : options.now;
  const minBytes = Number(options.maxFileBytes) || DEFAULT_MAX_FILE_BYTES;

  if (!U.isDir(repo)) {
    return { path: repo, name: path.basename(repo), error: 'không thấy thư mục', notes: [] };
  }
  const info = Git.repoInfo(repo, run);
  if (!info) {
    return { path: repo, name: path.basename(repo), error: 'không phải kho git', notes: [] };
  }

  const notes = [];
  const working = Git.workingTree(repo, run);
  if (working == null) notes.push('Không đọc được cây làm việc.');
  const ab = aheadBehind(run, repo);
  const stashList = stashes(run, repo);
  if (stashList == null) notes.push('Không đọc được danh sách stash.');
  const branchList = branches(run, repo, now);
  if (branchList == null) notes.push('Không đọc được danh sách nhánh.');
  const tagList = tags(run, repo);
  if (tagList == null) notes.push('Không đọc được danh sách thẻ.');
  const large = bigFiles(run, repo, minBytes);
  if (large == null) notes.push('Không đọc được danh sách tệp.');

  return {
    path: repo,
    name: path.basename(repo),
    branch: info.branch,
    remote: info.remote || null,
    working,
    upstream: ab.upstream,
    ahead: ab.ahead,
    behind: ab.behind,
    stashes: stashList,
    branches: branchList,
    tags: tagList,
    bigFiles: large,
    secrets: options.secretScan ? scanSecrets(repo, { run, readFile: options.readFile }) : null,
    notes
  };
}

/* --- Ảnh chụp tất cả các kho ---------------------------------------- */

/* Trả về `{ok, day, updatedAt, repos, scanned, total, skipped, notes}`.

   `scanned` là số kho quét được, `total` là số kho ĐÁNG LẼ phải quét, và
   `skipped` là phần chênh — ba con số này phải nói ra cùng nhau. Chỉ in
   "đã quét 20 kho" trong khi cấu hình có 52 kho là để huynh tin rằng mọi
   thứ đều ổn, trong khi thực tế 32 kho chưa từng được nhìn tới. */
function collect(config, opts) {
  const options = opts || {};
  const settings = settingsOf(config);
  const all = repoList(config);
  const max = Number(options.maxRepos) || settings.maxRepos;
  const chosen = all.slice(0, max);
  const now = options.now == null ? Date.now() : options.now;

  const repos = [];
  for (const repo of chosen) {
    repos.push(repoSnapshot(config, repo, Object.assign({}, options, {
      secretScan: options.secretScan === true || (options.secretScan === undefined && settings.secretScan),
      now
    })));
  }

  const notes = [];
  if (all.length > chosen.length) {
    notes.push('Có ' + all.length + ' kho trong cấu hình nhưng chỉ quét ' + chosen.length
      + ' kho đầu (sources.git.healthMaxRepos = ' + max + '). '
      + 'Muốn quét hết thì nâng số đó trong devtrace.config.json.');
  }
  if (!chosen.length) notes.push('Chưa khai kho nào trong sources.git.repos.');

  return {
    ok: true,
    day: U.dayKey(now, config.dayStartHour),
    updatedAt: now,
    repos,
    scanned: repos.filter((r) => !r.error).length,
    total: all.length,
    skipped: Math.max(0, all.length - chosen.length),
    notes
  };
}

// Quét rồi ghi ảnh chụp. Ghi hỏng thì trả `ok: false` chứ không im lặng.
function snapshot(config, opts) {
  const shot = collect(config, opts);
  try {
    U.writeJson(healthFile(config), Object.assign({ version: 1 }, shot));
  } catch (error) {
    return Object.assign({}, shot, { ok: false, error: 'Không ghi được ảnh chụp: ' + error.message });
  }
  return Object.assign({}, shot, { file: healthFile(config) });
}

/* Đọc ảnh chụp đã lưu. Chưa quét lần nào thì trả null — và trả null chứ
   không phải một ảnh rỗng, vì "chưa từng quét" khác hẳn "đã quét, mọi kho
   đều sạch". Gộp hai thứ đó lại là cách nói dối quen thuộc nhất. */
function read(config) {
  const data = U.readJson(healthFile(config), null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data;
}

/* Kho quét được hay không, dùng cho giao diện khỏi phải tự đoán. */
function isStale(shot, config, now) {
  if (!shot || !shot.day) return true;
  return shot.day !== U.dayKey(now == null ? Date.now() : now, config.dayStartHour);
}

module.exports = {
  healthFile, collect, snapshot, read, isStale, repoSnapshot,
  scanSecrets, settingsOf, repoList, aheadBehind, stashes, branches, tags, bigFiles,
  UPSTREAM_ARGS,
  DEFAULT_MAX_REPOS, DEFAULT_MAX_FILE_BYTES, STALE_BRANCH_DAYS, MANY_CHANGES, MANY_STASHES
};
