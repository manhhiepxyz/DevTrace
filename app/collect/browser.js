'use strict';

/* =====================================================================
   app/collect/browser.js — Bằng chứng "nguồn tham khảo".

   Trình duyệt cho biết huynh đã TRA CỨU gì: tài liệu chính thức, Stack
   Overflow, hay video giải trí. Đây là mảnh ghép mà git và Codex không
   thể cung cấp.

   Lưu ý kỹ thuật: Chrome/Edge khoá tệp History khi đang mở, nên phải sao
   chép ra tệp tạm rồi mới đọc bằng node:sqlite (có sẵn từ Node 22).
   ===================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../util');
const C = require('../config');

const MAX_VISITS = 600;
const MAX_SEARCHES = 200;
// Bấm F5 liên tục hay mở cùng trang trong hai tab thì không phải hai lần tra cứu.
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

function browserRoots() {
  const local = path.join(U.HOME, 'AppData', 'Local');
  return {
    chrome: path.join(local, 'Google', 'Chrome', 'User Data'),
    edge: path.join(local, 'Microsoft', 'Edge', 'User Data')
  };
}

function findProfiles(root) {
  const out = [];
  if (!U.isDir(root)) return out;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return out; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name !== 'Default' && !/^Profile \d+$/.test(entry.name) && entry.name !== 'Guest Profile') continue;
    const history = path.join(root, entry.name, 'History');
    if (U.isFile(history)) out.push({ profile: entry.name, history });
  }
  return out;
}

/* Phân loại miền: học/lập trình hay giải trí. Chỉ để gợi ý, không phán xét. */
const DEV_HOSTS = /(^|\.)(github\.com|gitlab\.com|stackoverflow\.com|stackexchange\.com|developer\.mozilla\.org|docs\.|devdocs\.io|npmjs\.com|pypi\.org|crates\.io|maven|spring\.io|baeldung\.com|medium\.com|dev\.to|freecodecamp\.org|leetcode\.com|hackerrank\.com|localhost|127\.0\.0\.1|kotlinlang\.org|docs\.oracle\.com|learn\.microsoft\.com|openai\.com|anthropic\.com|huggingface\.co|codepen\.io|jsfiddle\.net|regex101\.com|npm\.io)$/;
const MEDIA_HOSTS = /(^|\.)(youtube\.com|youtu\.be|facebook\.com|tiktok\.com|instagram\.com|netflix\.com|twitch\.tv|spotify\.com|zalo\.me|dailymotion\.com)$/;

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

function categoryOf(host) {
  if (DEV_HOSTS.test(host)) return 'học';
  if (MEDIA_HOSTS.test(host)) return 'giải trí';
  return 'khác';
}

function withSqlite(fn) {
  let sqlite;
  try { sqlite = require('node:sqlite'); } catch (e) { return { error: 'Node này không có node:sqlite' }; }
  return fn(sqlite);
}

/* Lọc bớt những lượt xem liền kề trùng tiêu đề trong một khoảng ngắn.

   Truy vấn SQL trả về theo thứ tự MỚI NHẤT TRƯỚC (ORDER BY visit_time DESC),
   nên vòng lặp đi từ mới tới cũ và ts luôn <= lastTs; khoảng cách thật giữa
   hai lượt là lastTs - ts. Bản cũ viết ts - lastTs — luôn âm, nên điều kiện
   luôn đúng và MỌI lượt xem liền kề cùng tiêu đề đều bị gộp, bất kể cách
   nhau bao lâu. Tách riêng thành hàm thuần để khoá lỗi đó lại bằng kiểm thử.
   Trả về mảng các bản ghi đã bóc sẵn ts/host/key. */
function dedupeVisits(visits, windowMs) {
  const window = windowMs || DEDUPE_WINDOW_MS;
  const out = [];
  let lastKey = null;
  let lastTs = 0;
  for (const visit of visits) {
    const ts = U.webkitTimeToMs(visit.t);
    if (!ts) continue;
    const host = hostOf(visit.url);
    const key = host + '|' + (visit.title || '');
    if (key === lastKey && lastTs - ts < window) continue;
    lastKey = key;
    lastTs = ts;
    out.push({ visit, ts, host, key });
  }
  return out;
}

function readBrowser(name, profile, historyFile, keepDays) {
  const sinceMs = Date.now() - keepDays * 86400000;
  const temp = path.join(os.tmpdir(), 'devtrace-hist-' + name + '-' + U.hash(profile + Date.now()));
  try {
    fs.copyFileSync(historyFile, temp);
  } catch (e) {
    return { error: 'không sao chép được tệp History (' + e.code + ')' , visits: [], searches: [] };
  }
  try {
    return withSqlite((sqlite) => {
      const db = new sqlite.DatabaseSync(temp);
      const sinceWebkit = (sinceMs + U.WEBKIT_EPOCH_OFFSET_MS) * 1000;
      const visits = db.prepare(
        'SELECT u.url AS url, u.title AS title, CAST(v.visit_time AS TEXT) AS t ' +
        'FROM visits v JOIN urls u ON u.id = v.url ' +
        'WHERE v.visit_time >= ? ORDER BY v.visit_time DESC LIMIT ?'
      ).all(String(sinceWebkit), MAX_VISITS);
      let searches = [];
      try {
        searches = db.prepare(
          'SELECT k.term AS term, CAST(u.last_visit_time AS TEXT) AS t ' +
          'FROM keyword_search_terms k JOIN urls u ON u.id = k.url_id ' +
          'WHERE u.last_visit_time >= ? LIMIT ?'
        ).all(String(sinceWebkit), MAX_SEARCHES);
      } catch (e) { searches = []; }
      db.close();
      return { visits, searches };
    });
  } finally {
    try { fs.unlinkSync(temp); } catch (e) { /* không xoá được thì thôi */ }
  }
}

function collect(config) {
  const settings = config.sources.browser;
  if (!settings.enabled) return { events: [], notes: ['Trình duyệt: đang tắt'] };

  const roots = browserRoots();
  const events = [];
  const notes = [];
  const keepDays = settings.keepDays || 30;
  // Đếm số hồ sơ không đọc được. Chrome/Edge khoá tệp History khi đang mở,
  // nên đọc hụt là chuyện thường — và đọc hụt thì KHÔNG được phép thay thế
  // toàn bộ dữ liệu trình duyệt cũ bằng một bản thiếu.
  let failed = 0;

  for (const name of settings.browsers) {
    const root = roots[name];
    if (!root) { failed++; continue; }
    if (!U.isDir(root)) { notes.push(name + ': không thấy thư mục dữ liệu'); failed++; continue; }
    const profiles = findProfiles(root);
    if (!profiles.length) { notes.push(name + ': không thấy hồ sơ nào'); continue; }

    for (const item of profiles) {
      const data = readBrowser(name, item.profile, item.history, keepDays);
      if (data.error) { notes.push(name + '/' + item.profile + ': ' + data.error); failed++; continue; }

      for (const row of dedupeVisits(data.visits)) {
        const visit = row.visit;
        const category = categoryOf(row.host);
        events.push({
          source: 'browser', kind: 'visit', ts: row.ts, project: null,
          title: (visit.title || row.host || 'không tiêu đề').slice(0, 120),
          detail: row.host + ' · ' + category,
          id: 'browser:' + U.hash(name + '|' + item.profile + '|' + visit.url + '|' + row.ts),
          meta: { browser: name, profile: item.profile, url: visit.url, host: row.host, category }
        });
      }

      for (const search of data.searches) {
        const ts = U.webkitTimeToMs(search.t);
        if (!ts || !search.term) continue;
        events.push({
          source: 'browser', kind: 'search', ts, project: null,
          title: 'Tìm: ' + String(search.term).slice(0, 100),
          detail: 'truy vấn tìm kiếm',
          id: 'browser:search:' + U.hash(name + '|' + item.profile + '|' + search.term + '|' + ts),
          meta: { browser: name, profile: item.profile, term: search.term }
        });
      }

      notes.push(name + '/' + item.profile + ': ' + data.visits.length + ' lượt xem, ' + data.searches.length + ' truy vấn');
    }
  }

  if (failed) notes.push('Trình duyệt: ' + failed + ' hồ sơ đọc hụt — giữ nguyên dữ liệu cũ cho tới lần chạy sau.');
  return { events, notes, complete: failed === 0 };
}

module.exports = { collect, hostOf, categoryOf, findProfiles, dedupeVisits, DEDUPE_WINDOW_MS };
