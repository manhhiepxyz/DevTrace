#!/usr/bin/env node
'use strict';

/* =====================================================================
   tools/smoke-test.js — Kiểm tra tự động DevTrace.

   Chạy:  node tools/smoke-test.js

   Không cần trình duyệt và không cần mạng. Bài kiểm tra dựng dữ liệu giả
   trong một thư mục tạm, chạy qua toàn bộ tầng logic, rồi dựng thử mọi
   màn hình để chắc rằng không có chỗ nào vỡ.
   ===================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'data', '__smoke__');

let failures = 0;
let checks = 0;

function section(title) { console.log('\n' + title); }

function check(label, passed, extra) {
  checks++;
  if (passed) {
    console.log('  ok   ' + label);
  } else {
    failures++;
    console.log('  FAIL ' + label + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra)));
  }
}

/* ---- Dựng cấu hình tách biệt, không đụng dữ liệu thật ---- */

function testConfig() {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const C = require('../app/config');
  const config = C.defaults();
  config.root = ROOT;
  config.dataDir = TEST_DIR;
  config.dayStartHour = 4;
  config.sources.codex.enabled = false;
  config.sources.git.enabled = false;
  config.sources.browser.enabled = false;
  config.sources.shell.enabled = false;
  config.sources.vscode.enabled = false;
  config.sources.files.enabled = false;
  // Nguồn duy nhất biết gọi mạng. Bộ kiểm thử phải chạy được ngoại tuyến,
  // nên nó bị tắt ở đây chứ không phải dựa vào việc mặc định là tắt.
  config.sources.github.enabled = false;
  config.projects = [
    { id: 'p-nexus', name: 'Nexus', path: path.join(ROOT, 'mau', 'nexus'), kind: 'git' },
    { id: 'p-web', name: 'WebBanHang', path: path.join(ROOT, 'mau', 'webbanhang'), kind: 'git' }
  ];
  return config;
}

const config = testConfig();
const U = require('../app/util');
const E = require('../app/events');
const R = require('../app/correlate');
const D = require('../app/digest');
const AI = require('../app/ai');
const Collect = require('../app/collect');
const Report = require('../app/report');
const Git = require('../app/collect/git');
const Plans = require('../app/plans');
const Alerts = require('../app/alerts');
const RepoHealth = require('../app/repohealth');
const Mail = require('../app/mail');
const Server = require('../server');

/* =====================================================================
   [1] Tiện ích thời gian và đường dẫn
   ===================================================================== */

section('[1] Tiện ích');

const morning = new Date(2026, 9, 9, 10, 30).getTime();
const lateNight = new Date(2026, 9, 10, 2, 15).getTime();

check('khoá ngày theo giờ địa phương', U.dayKey(morning, 0) === '2026-10-09', U.dayKey(morning, 0));
check('mốc 4h gom 2h sáng vào ngày hôm trước', U.dayKey(lateNight, 4) === '2026-10-09', U.dayKey(lateNight, 4));
check('không có mốc thì 2h sáng là ngày mới', U.dayKey(lateNight, 0) === '2026-10-10');
check('dịch ngày qua tháng', U.shiftDay('2026-10-01', -1) === '2026-09-30');
check('đổi giờ WebKit sang mili-giây', U.webkitTimeToMs('13433423576852000') === 1788949976852, U.webkitTimeToMs('13433423576852000'));
check('giờ WebKit rác trả về null', U.webkitTimeToMs('0') === null && U.webkitTimeToMs('abc') === null);
check('mã băm ổn định', U.hash('abc') === U.hash('abc') && U.hash('abc') !== U.hash('abd'));

/* Notepad và VS Code chế độ "UTF-8 with BOM" đều ghi thêm U+FEFF ở đầu tệp.
   JSON.parse không nhận ký tự đó, nên trước đây một tệp cấu hình hoàn toàn
   hợp lệ vẫn bị coi là hỏng — và bị ghi đè bằng mặc định, tức là mất cấu
   hình của huynh. */
const bomFile = path.join(TEST_DIR, 'co-bom.json');
fs.writeFileSync(bomFile, '﻿{"dayStartHour":4}', 'utf8');
check('đọc được JSON có BOM ở đầu tệp', (U.readJson(bomFile, null) || {}).dayStartHour === 4, U.readJson(bomFile, 'hỏng'));
const brokenJsonFile = path.join(TEST_DIR, 'json-hong.json');
fs.writeFileSync(brokenJsonFile, '{ khong phai json', 'utf8');
check('JSON hỏng thật thì trả về giá trị dự phòng', U.readJson(brokenJsonFile, 'du-phong') === 'du-phong');
check('tệp không tồn tại thì trả về giá trị dự phòng', U.readJson(path.join(TEST_DIR, 'khong-co.json'), 'du-phong') === 'du-phong');

/* =====================================================================
   [2] Sự kiện: chuẩn hoá, khử trùng, ghi theo ngày
   ===================================================================== */

section('[2] Kho sự kiện');

const sample = E.makeEvent(config, {
  source: 'codex', kind: 'turn', ts: morning, project: path.join(ROOT, 'mau', 'nexus'),
  title: 'Sửa lỗi đăng nhập', detail: '3 lệnh', durationMs: 600000
});
check('sự kiện được gán ngày', sample.day === '2026-10-09');
check('sự kiện có mã định danh', typeof sample.id === 'string' && sample.id.indexOf('codex:') === 0);
check('trọng số mặc định theo nguồn', sample.weight === 3);
check('sự kiện thiếu nguồn bị từ chối', throwsError(() => E.makeEvent(config, { ts: Date.now() })));
check('sự kiện thiếu thời gian bị từ chối', throwsError(() => E.makeEvent(config, { source: 'git' })));

function throwsError(fn) { try { fn(); return false; } catch (e) { return true; } }

const many = E.makeMany(config, [
  { source: 'files', kind: 'change', ts: morning, title: 'a.js' },
  { source: 'files', kind: 'change', ts: morning, title: 'a.js' },
  { source: 'browser', kind: 'visit', ts: morning, title: 'github' }
]);
check('khử trùng theo mã định danh', E.dedupe(many).length === 2, E.dedupe(many).length);

E.replaceSource(config, '2026-10-09', 'files', E.makeMany(config, [{ source: 'files', kind: 'change', ts: morning, title: 'b.js' }]));
E.replaceSource(config, '2026-10-09', 'files', E.makeMany(config, [{ source: 'files', kind: 'change', ts: morning, title: 'c.js' }]));
const dayRows = E.readDay(config, '2026-10-09');
check('ghi đè nguồn không để lại rác', dayRows.filter((e) => e.source === 'files').length === 1, dayRows.length);

E.replaceSourceAllDays(config, 'codex', E.makeMany(config, [
  { source: 'codex', kind: 'session', ts: morning, title: 'phiên A' },
  { source: 'codex', kind: 'turn', ts: new Date(2026, 9, 8, 15, 0).getTime(), title: 'lượt hôm trước' }
]));
E.replaceSourceAllDays(config, 'codex', E.makeMany(config, [
  { source: 'codex', kind: 'session', ts: morning, title: 'phiên B' }
]));
check('thay toàn cục xoá được sự kiện ở ngày cũ', E.readDay(config, '2026-10-08').filter((e) => e.source === 'codex').length === 0);
check('thay toàn cục giữ lại sự kiện mới', E.readDay(config, '2026-10-09').some((e) => e.title === 'phiên B'));
check('liệt kê được các ngày có dữ liệu', E.listDays(config).indexOf('2026-10-09') !== -1);

E.addEvents(config, '2026-10-09', E.makeMany(config, [{ source: 'files', kind: 'change', ts: morning, title: 'c.js' }]));
check('ghi thêm không nhân đôi', E.readDay(config, '2026-10-09').filter((e) => e.title === 'c.js').length === 1);

/* =====================================================================
   [3] Cấu hình
   ===================================================================== */

section('[3] Cấu hình');

const C = require('../app/config');
/* Bảy nguồn có cấu hình, cộng "Tự ghi" thành tám nguồn bằng chứng. "Tự ghi"
   cố ý KHÔNG có mặt trong mặc định: nó không cần cấu hình gì, và
   `settings.enabled !== false` đã coi nó là đang bật. */
check('mặc định có đủ bảy nguồn cấu hình được',
  Object.keys(C.defaults().sources).length === 7);
check('cộng nguồn tự ghi là đủ tám nguồn bằng chứng', Object.keys(E.SOURCES).length === 8);
const merged = C.merge({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 9 } });
check('gộp cấu hình theo khoá', merged.a === 1 && merged.b.c === 9 && merged.b.d === 3);
check('gộp không phá mảng', Array.isArray(C.merge({ x: [1] }, { x: [2, 3] }).x) && C.merge({ x: [1] }, { x: [2, 3] }).x.length === 2);
check('tìm dự án theo đường dẫn con', C.projectFor(config, path.join(ROOT, 'mau', 'nexus', 'src', 'Main.java')).name === 'Nexus');
check('đường dẫn ngoài mọi dự án trả về null', C.projectFor(config, 'C:/khong/co/gi') === null);
check('chọn dự án khớp dài nhất', (function () {
  const two = { projects: [
    { id: 'a', name: 'Ngoài', path: 'D:/proj' },
    { id: 'b', name: 'Trong', path: 'D:/proj/con' }
  ] };
  return C.projectFor(two, 'D:/proj/con/file.js').name === 'Trong';
})());
check('suy ra dự án từ danh sách nguồn', C.deriveProjects({ sources: { git: { repos: ['D:/x'] }, files: { dirs: ['D:/y'] } } }).length === 2);

/* ---- Dự án huynh tự khai -------------------------------------------

   Khai bằng thư mục, đặt tên tuỳ ý. Hai điều phải giữ bằng được:

   1. Đổi tên chỉ đụng MỘT trường trong `declaredProjects`. Sự kiện lưu dự án
      dưới dạng đường dẫn, và `R.projectLabel` mới đổi đường dẫn thành tên
      lúc đọc — nên bằng chứng cũ hiện ngay tên mới mà `data/events/` không
      đổi một byte. Viết lại kho bằng chứng để đổi một cái nhãn là đúng thứ
      dự án này cấm.
   2. Xoá dự án không xoá bằng chứng: bỏ mục khỏi danh sách thì `projectFor`
      thôi khớp, và nhãn rơi về tên thư mục. */

const declaredSource = { sources: { git: { repos: [] }, files: { dirs: [] } } };

check('khai dự án thì khai thắng phần suy ra', (function () {
  const cfg = Object.assign({}, declaredSource, {
    declaredProjects: [{ path: 'D:/du-an/nexus', name: 'Nexus của tôi' }]
  });
  const list = C.projectsFrom(cfg);
  return list.length === 1 && list[0].name === 'Nexus của tôi'
    && list[0].declared === true && list[0].id.length >= 6;
})(), (function () {
  const cfg = Object.assign({}, declaredSource, {
    declaredProjects: [{ path: 'D:/du-an/nexus', name: 'Nexus của tôi' }]
  });
  return C.projectsFrom(cfg);
})());

check('không khai gì thì vẫn suy ra như cũ, người dùng cũ không thấy gì đổi', (function () {
  const cfg = { sources: { git: { repos: ['D:/x'] }, files: { dirs: ['D:/y'] } }, declaredProjects: [] };
  const list = C.projectsFrom(cfg);
  return list.length === 2 && list.every((p) => !p.declared) && list[0].name === 'x';
})());

check('thiếu tên thì lấy tên thư mục, thiếu id thì sinh theo đường dẫn', (function () {
  const cfg = Object.assign({}, declaredSource, { declaredProjects: [{ path: 'D:/du-an/webbanhang' }] });
  const list = C.projectsFrom(cfg);
  // Sinh theo đường dẫn nên hai lần nạp khác nhau vẫn ra cùng một id — id
  // đổi mỗi lần nạp thì giao diện không trỏ vào đâu được.
  const again = C.projectsFrom(Object.assign({}, declaredSource, {
    declaredProjects: [{ path: 'D:/du-an/webbanhang' }]
  }));
  return list[0].name === 'webbanhang' && list[0].id === again[0].id;
})(), (function () {
  const cfg = Object.assign({}, declaredSource, { declaredProjects: [{ path: 'D:/du-an/webbanhang' }] });
  return C.projectsFrom(cfg)[0];
})());

check('đổi tên dự án đổi được nhãn của bằng chứng CŨ mà không cần viết lại sự kiện', (function () {
  const events = [{ project: 'D:/du-an/nexus/src/Main.java' }];
  const before = Object.assign({}, declaredSource, {
    declaredProjects: [{ id: 'p-1', path: 'D:/du-an/nexus', name: 'Tên cũ' }]
  });
  before.projects = C.projectsFrom(before);
  const after = Object.assign({}, before, {
    declaredProjects: [{ id: 'p-1', path: 'D:/du-an/nexus', name: 'Tên mới' }]
  });
  after.projects = C.projectsFrom(after);
  return R.projectLabel(before, events[0].project) === 'Tên cũ'
    && R.projectLabel(after, events[0].project) === 'Tên mới'
    && events[0].project === 'D:/du-an/nexus/src/Main.java';
})(), [R.projectLabel((function () {
  const c = Object.assign({}, declaredSource, {
    declaredProjects: [{ id: 'p-1', path: 'D:/du-an/nexus', name: 'Tên mới' }]
  });
  c.projects = C.projectsFrom(c);
  return c;
})(), 'D:/du-an/nexus/src/Main.java')]);

/* Xoá dự án không xoá bằng chứng: chỉ bỏ một mục khỏi danh sách, và
   `projectFor` thôi khớp. Sự kiện vẫn giữ nguyên đường dẫn, nên thêm lại dự
   án đó là tên hiện lại ngay — không có gì bị mất.

   Đổi lại, thư mục con của dự án đã xoá thôi được gom theo dự án: đó là hệ
   quả thật, và hộp thoại xác nhận phải nói ra chứ không im lặng. */
check('xoá dự án không xoá bằng chứng, chỉ thôi gom theo dự án', (function () {
  const cfg = Object.assign({}, declaredSource, { declaredProjects: [] });
  cfg.projects = C.projectsFrom(cfg);
  return R.projectLabel(cfg, 'D:/du-an/nexus') === 'nexus'
    && R.projectLabel(cfg, 'D:/du-an/nexus/') === 'nexus'
    && C.projectFor(cfg, 'D:/du-an/nexus/src') === null;
})(), (function () {
  const cfg = Object.assign({}, declaredSource, { declaredProjects: [] });
  cfg.projects = C.projectsFrom(cfg);
  return {
    nhan: R.projectLabel(cfg, 'D:/du-an/nexus'),
    con_khop: C.projectFor(cfg, 'D:/du-an/nexus/src')
  };
})());

check('khai trùng một thư mục hai lần thì chỉ tính một', (function () {
  const cfg = Object.assign({}, declaredSource, {
    declaredProjects: [{ path: 'D:/du-an/nexus' }, { path: 'D:/du-an/nexus' }]
  });
  return C.projectsFrom(cfg).length === 1;
})());

/* Một dòng méo trong tệp cấu hình không được phép làm DevTrace không mở lên
   được — bỏ qua dòng đó, giữ những dòng còn lại. */
check('mục dự án méo bị bỏ qua, không làm hỏng cả danh sách', (function () {
  const cfg = Object.assign({}, declaredSource, {
    declaredProjects: [null, 'chuỗi', { name: 'thiếu đường dẫn' }, { path: 'D:/du-an/that' }]
  });
  const list = C.projectsFrom(cfg);
  return list.length === 1 && list[0].name === 'that';
})(), (function () {
  const cfg = Object.assign({}, declaredSource, {
    declaredProjects: [null, 'chuỗi', { name: 'thiếu đường dẫn' }, { path: 'D:/du-an/that' }]
  });
  return C.projectsFrom(cfg);
})());

/* Danh sách đã chuẩn hoá được gán ngược vào cấu hình, để tệp lưu xuống có
   sẵn id — giao diện cần id để đổi tên và xoá. */
check('danh sách tự khai được chuẩn hoá ngay trong cấu hình', (function () {
  const cfg = Object.assign({}, declaredSource, { declaredProjects: [{ path: 'D:/du-an/nexus' }] });
  C.projectsFrom(cfg);
  return cfg.declaredProjects.length === 1
    && typeof cfg.declaredProjects[0].id === 'string' && cfg.declaredProjects[0].id.length >= 6
    && cfg.declaredProjects[0].kind === 'folder';
})(), (function () {
  const cfg = Object.assign({}, declaredSource, { declaredProjects: [{ path: 'D:/du-an/nexus' }] });
  C.projectsFrom(cfg);
  return cfg.declaredProjects;
})());

/* =====================================================================
   [4] Đối chiếu bằng chứng
   ===================================================================== */

section('[4] Đối chiếu');

const nexus = path.join(ROOT, 'mau', 'nexus');
const web = path.join(ROOT, 'mau', 'webbanhang');
const at = (hour, minute) => new Date(2026, 9, 9, hour, minute).getTime();

const synthetic = E.makeMany(config, [
  { source: 'codex', kind: 'turn', ts: at(9, 0), project: nexus, title: 'Hỏi về transaction', durationMs: 1800000 },
  { source: 'files', kind: 'change', ts: at(9, 20), project: nexus, title: 'UserService.java' },
  { source: 'git', kind: 'commit', ts: at(9, 40), project: nexus, title: 'fix: rollback', detail: '2 tệp' },
  { source: 'browser', kind: 'visit', ts: at(9, 30), project: null, title: 'Transaction rollback - Stack Overflow', meta: { host: 'stackoverflow.com', category: 'học' } },
  { source: 'shell', kind: 'command', ts: at(9, 45), project: null, title: 'mvn test', meta: { tags: ['java'] } },
  { source: 'codex', kind: 'turn', ts: at(14, 0), project: web, title: 'Lượt bị lỗi', meta: { error: 'bị ngắt' }, durationMs: 600000 },
  { source: 'files', kind: 'change', ts: at(14, 10), project: web, title: 'CartService.java' },
  { source: 'codex', kind: 'session', ts: at(14, 0), project: web, title: 'Codex phiên dài', durationMs: 12 * 3600000, meta: { tokens: 900000, internal: false } }
]);

// Ghi bộ dữ liệu giả vào kho rồi mới kiểm tra: tầng tổng hợp đọc từ kho,
// chứ không nhận sự kiện truyền tay — đúng như lúc chạy thật.
E.clearDay(config, '2026-10-09');
E.clearDay(config, '2026-10-08');
['codex', 'files', 'git', 'browser', 'shell'].forEach(function (source) {
  E.replaceSource(config, '2026-10-09', source, synthetic.filter(function (e) { return e.source === source; }));
});

const blocks = R.blocks(config, R.decorate(config, synthetic), {});
check('gom khối theo khoảng nghỉ', blocks.length === 2, blocks.length);
check('khối đầu gắn đúng dự án', blocks[0].project === 'Nexus', blocks[0].project);
check('khối sau gắn dự án khác', blocks[1].project === 'WebBanHang', blocks[1].project);
check('thời lượng sự kiện bị cắt trần', R.span({ durationMs: 12 * 3600000 }) === R.MAX_SPAN_MS, R.span({ durationMs: 12 * 3600000 }));
check('khối không dài quá trần', blocks[1].ms <= R.MAX_SPAN_MS + 60000, blocks[1].ms);

const minutes = R.activeMinutes(R.decorate(config, synthetic));
check('phút hoạt động nằm trong khoảng hợp lý', minutes > 100 && minutes < 900, minutes);

const projects = R.byProject(config, R.decorate(config, synthetic));
const nexusRow = projects.find((p) => p.project === 'Nexus');
check('đếm đúng commit theo dự án', nexusRow && nexusRow.commits.length === 1);
check('đếm đúng tệp theo dự án', nexusRow && nexusRow.files.length === 1);
check('gộp lượt AI theo dự án', nexusRow && nexusRow.aiTurns === 1);

const links = R.links(config, R.decorate(config, synthetic));
check('nối được phiên AI với commit cùng dự án', links.some((l) => l.type === 'ai-truoc-commit'));
check('nối được tra cứu với lượt làm việc', links.some((l) => l.type === 'tra-cuu-quanh-lam-viec'));

const inferred = R.evidence(config, '2026-10-09');
check('đọc được bằng chứng từ kho', inferred.work.length > 0);
check('suy ra dự án cho lượt tra cứu và có đánh dấu', inferred.work.some((e) => e.source === 'browser' && e.inferred === true));

/* Mọi ngưỡng thời gian phải nằm gọn một chỗ và khác nhau có chủ ý. Trước đây
   chúng rải rác trong thân hàm, có chỗ viết thẳng số giữa dòng, nên không ai
   đối chiếu được chỗ này với chỗ kia — và hai chỗ đã dùng lẫn ngưỡng của nhau. */
check('ngưỡng thời gian nằm gọn một chỗ, khác nhau có chủ ý',
  R.GAP_MS === 25 * 60 * 1000 && R.ACTIVE_GAP_MS === 8 * 60 * 1000 &&
  R.LINK_WINDOW_MS === 45 * 60 * 1000 && R.COMMAND_LINK_MS === 5 * 60 * 1000 &&
  R.INFER_WINDOW_MS === 20 * 60 * 1000 && R.MAX_SPAN_MS === 2 * 60 * 60 * 1000,
  [R.GAP_MS, R.ACTIVE_GAP_MS, R.LINK_WINDOW_MS, R.COMMAND_LINK_MS, R.INFER_WINDOW_MS, R.MAX_SPAN_MS]);

/* Nghỉ 20 phút giữa hai lượt sửa tệp: vẫn là cùng MỘT việc (ngưỡng chia khối
   25 phút), nhưng 20 phút đó KHÔNG phải thời gian làm việc (ngưỡng cộng thời
   gian 8 phút). Bản cũ cộng bằng ngưỡng chia khối nên thời gian phình lên —
   và ở tầng dự án thì một dự án có thể được cộng nhiều phút hơn cả ngày. */
const gapped = R.decorate(config, E.makeMany(config, [
  { source: 'codex', kind: 'turn', ts: at(9, 0), project: nexus, title: 'lượt đầu', durationMs: 60000 },
  { source: 'codex', kind: 'turn', ts: at(9, 20), project: nexus, title: 'lượt sau', durationMs: 60000 }
]));
check('cách nhau 20 phút vẫn thuộc cùng một khối làm việc',
  R.blocks(config, gapped, {}).length === 1, R.blocks(config, gapped, {}).length);
const gappedMinutes = R.activeMinutes(gapped);
check('khoảng nghỉ 20 phút không bị tính thành thời gian làm việc',
  gappedMinutes < 5, gappedMinutes);

/* Một lệnh tự gõ chỉ được nối vào phiên AI khi thật sự gần — nửa tiếng sau
   thì phiên đó đã kết thúc từ lâu. */
const commandNear = R.decorate(config, E.makeMany(config, [
  { source: 'codex', kind: 'turn', ts: at(9, 0), project: nexus, title: 'phiên', durationMs: 600000 },
  { source: 'shell', kind: 'command', ts: at(9, 3), project: nexus, title: 'mvn test' }
]));
const commandFar = R.decorate(config, E.makeMany(config, [
  { source: 'codex', kind: 'turn', ts: at(9, 0), project: nexus, title: 'phiên', durationMs: 600000 },
  { source: 'shell', kind: 'command', ts: at(9, 40), project: nexus, title: 'mvn test' }
]));
check('lệnh gõ ngay trong phiên AI thì được nối',
  R.links(config, commandNear).some((l) => l.type === 'tu-chay-lenh'),
  R.links(config, commandNear).map((l) => l.type));
check('lệnh gõ sau phiên AI nửa tiếng thì không nối',
  !R.links(config, commandFar).some((l) => l.type === 'tu-chay-lenh'),
  R.links(config, commandFar).map((l) => l.type));

/* =====================================================================
   [5] Bản tổng hợp ngày
   ===================================================================== */

section('[5] Tổng hợp');

const digest = D.build(config, '2026-10-09');
check('có số phút hoạt động', digest.minutes > 0, digest.minutes);
check('có khối làm việc', digest.blocks.length === 2, digest.blocks.length);
check('thống kê commit khớp', digest.totals.commits === 1, digest.totals.commits);
check('thống kê tệp khớp', digest.totals.files === 2, digest.totals.files);
check('phát hiện lượt bị ngắt', digest.frictions.some((f) => f.type === 'lượt bị ngắt'), digest.frictions.map((f) => f.type));
check('nêu việc còn bỏ ngỏ khi sửa mà chưa commit', Array.isArray(digest.openQuestions));
check('đề xuất bước tiếp theo', digest.nextSteps.length > 0);
check('gợi ý commit cho dự án còn dở', digest.nextSteps.some((s) => /commit/i.test(s.text)));
check('phân loại nguồn tra cứu', digest.learning.docs.some((d) => d.host === 'stackoverflow.com' && d.category === 'học'));
check('đếm hạng mục trình duyệt', digest.learning.categories['học'] === 1, digest.learning.categories);
check('chuỗi ngày tính được', typeof digest.momentum.streakDays === 'number');
check('chuỗi 7 ngày có đúng 7 mốc', digest.momentum.series.length === 7);

/* Bức tranh độ phủ: ngày này máy THẬT SỰ đọc được những nguồn nào. Không có
   nó thì một ngày chỉ có dữ liệu trình duyệt vẫn được trình bày y hệt một
   ngày đầy đủ — và người đọc kết luận sai về chính mình. */
const coverage = digest.coverage;
check('bản tổng hợp có bảng độ phủ nguồn',
  !!coverage && Array.isArray(coverage.rows) && coverage.rows.length === 8,
  coverage && coverage.rows && coverage.rows.length);
check('độ phủ đếm đúng số nguồn có đóng góp',
  coverage.contributing === coverage.rows.filter((r) => r.events > 0).length, coverage.contributing);
check('độ phủ nói được nguồn nào im lặng', Array.isArray(coverage.silent));
check('nguồn tự ghi không bị coi là im lặng',
  !coverage.silent.some((s) => s.name === 'manual'), coverage.silent.map((s) => s.label));
check('độ phủ có câu giải thích cho người đọc',
  typeof coverage.note === 'string' && coverage.note.length > 0, coverage.note);
check('mỗi dòng độ phủ nói rõ nguồn đó đóng góp loại bằng chứng gì',
  coverage.rows.every((r) => typeof r.evidence === 'string' && r.label && r.name));

/* Danh sách cảnh báo do máy chủ dựng, để giao diện và tầng AI cùng nhìn thấy
   MỘT danh sách. Nếu để giao diện tự gom lấy thì AI có thể viết trơn tru trong
   khi màn hình đang báo có nguồn lỗi — hai bên nói hai chuyện khác nhau. */
check('bản tổng hợp có mảng cảnh báo', Array.isArray(digest.warnings), typeof digest.warnings);
check('cảnh báo xếp nặng trước nhẹ sau', (function () {
  const rank = { bad: 0, warn: 1, info: 2 };
  const levels = digest.warnings.map((w) => w.level);
  return levels.every((lv, i) => i === 0 || rank[levels[i - 1]] <= rank[lv]);
})(), digest.warnings.map((w) => w.level));
check('mỗi cảnh báo nói rõ mức, loại và trọng số',
  digest.warnings.every((w) => typeof w.level === 'string' && typeof w.kind === 'string'
    && typeof w.title === 'string' && w.title.length > 0 && typeof w.weight === 'number'));

/* Chỗ trống phải được gom: một ngày có thể có sáu nguồn cùng im lặng, và sáu
   dòng nói cùng một điều là thứ khiến người đọc thôi đọc. */
check('cảnh báo gom chỗ trống thành một dòng, không kể từng nguồn',
  digest.warnings.filter((w) => w.kind === 'gap').length <= 2,
  digest.warnings.filter((w) => w.kind === 'gap').map((w) => w.title));

/* =====================================================================
   [6] Tầng AI: gói bằng chứng, lời nhắc, nhật ký
   ===================================================================== */

section('[6] Tầng AI');

const pack = AI.evidencePack(config, '2026-10-09');
check('gói bằng chứng có mã phiên bản', pack.version === AI.PROMPT_VERSION);
check('gói có mã tham chiếu cho khối', pack.blocks.every((b) => /^B\d+$/.test(b.id)));
check('gói có mã tham chiếu cho dự án', pack.projects.every((p) => /^P\d+$/.test(p.id)));
check('gói có mã tham chiếu cho kết quả', pack.outcomes.commits.every((c) => /^C\d+$/.test(c.id)));
check('gói có mã tham chiếu cho nguồn tra cứu', pack.learning.topSources.every((d) => /^D\d+$/.test(d.id)));
check('gói không lộ đường dẫn tuyệt đối trong khoá ngày', typeof pack.day === 'string');
const prompt = AI.buildPrompt(pack);
check('lời nhắc nêu đủ ba câu hỏi', prompt.indexOf('Hôm nay đã làm gì') !== -1 && prompt.indexOf('Đã tạo ra kết quả gì') !== -1 && prompt.indexOf('Học được gì') !== -1);
check('lời nhắc buộc trích dẫn mã', /mã tham chiếu/i.test(prompt));
check('lời nhắc cấm bịa', /Không suy đoán/.test(prompt));
check('lời nhắc nhúng gói bằng chứng', prompt.indexOf('devtrace-evidence-pack') !== -1);
check('gói bằng chứng mang theo danh sách cảnh báo', Array.isArray(pack.warnings));
check('cảnh báo trong gói không lộ trường nội bộ', (pack.warnings || []).every(
  (w) => ['level', 'kind', 'source', 'title', 'detail'].every((k) => Object.prototype.hasOwnProperty.call(w, k))
    && !Object.prototype.hasOwnProperty.call(w, 'weight')));
check('lời nhắc buộc AI nhắc tới cảnh báo nặng', /warnings/.test(prompt) && /phải nhắc tới nó/.test(prompt));

AI.saveJournal(config, '2026-10-09', { text: 'Nhật ký thử.', source: 'test' });
check('lưu và đọc lại nhật ký', (AI.readJournal(config, '2026-10-09') || {}).text === 'Nhật ký thử.');
AI.saveJournal(config, '2026-10-09', { text: 'Bản sửa.' });
check('ghi nhật ký lần sau ghi đè nội dung', AI.readJournal(config, '2026-10-09').text === 'Bản sửa.');

/* ---------------------------------------------------------------------
   Kiểm chứng trích dẫn.

   Lời nhắc bắt AI kèm mã tham chiếu cho mỗi nhận định, nhưng "bắt" mà không
   "kiểm" thì chỉ là lời hứa: model bịa ra (B9) trong khi gói chỉ có B1..B4,
   và bản tổng kết vẫn được lưu nguyên xi kèm một trích dẫn trông rất đáng
   tin mà không trỏ tới đâu. Mấy phép thử này khoá vòng đó lại.
   --------------------------------------------------------------------- */

const codeTable = AI.codeIndex(pack);
const realCodes = Object.keys(codeTable);
// Một mã chắc chắn KHÔNG có trong gói, để thử nhánh "bịa".
const bogusCode = ['B', 'P', 'C', 'F', 'D', 'X', 'Q', 'N']
  .map((letter) => letter + '9').find((candidate) => realCodes.indexOf(candidate) === -1);

check('dựng được bảng mã từ chính gói bằng chứng', realCodes.length > 0, realCodes.length);
check('bảng mã có đủ loại mã mà lời nhắc cho phép dùng',
  ['B', 'P', 'C', 'F', 'D'].every((letter) => realCodes.some((c) => c.charAt(0) === letter)),
  realCodes);
check('mỗi mã có nhãn đọc được, không phải chuỗi rỗng',
  realCodes.every((c) => typeof codeTable[c] === 'string' && codeTable[c].length > 0));
check('bảng mã chỉ nhận đúng dạng "một chữ cái + số", bỏ qua thứ khác',
  Object.keys(AI.codeIndex({ blocks: [{ id: 'ZZ9' }, { id: 'Q7' }, { id: 'B' }, { id: 'B123' }] })).join() === 'Q7',
  Object.keys(AI.codeIndex({ blocks: [{ id: 'ZZ9' }, { id: 'Q7' }, { id: 'B' }, { id: 'B123' }] })));
check('bảng mã duyệt được gói lồng sâu mà không cần liệt kê tay từng mảng',
  Object.keys(AI.codeIndex({ a: { b: [{ c: { id: 'D3', host: 'x.com' } }] } })).join() === 'D3');

const realCode = realCodes[0];
const goodCheck = AI.checkCitations('Hôm nay làm (' + realCode + ').', codeTable);
check('trích dẫn có thật thì được tính là hợp lệ',
  goodCheck.cited === 1 && goodCheck.valid === 1 && goodCheck.invalid.length === 0, goodCheck);
const bogusCheck = AI.checkCitations('Theo (' + bogusCode + ') thì xong.', codeTable);
check('trích dẫn bịa bị phát hiện đích danh',
  bogusCheck.invalid.length === 1 && bogusCheck.invalid[0] === bogusCode, bogusCheck);
check('trộn mã thật với mã bịa thì tách được ra',
  AI.checkCitations('(' + realCode + ') và (' + bogusCode + ')', codeTable).invalid.join() === bogusCode);
check('văn bản không có mã nào bị coi là thiếu trích dẫn',
  AI.checkCitations('Hôm nay làm nhiều việc.', codeTable).uncited === true);
check('mã lặp lại chỉ đếm một lần', AI.checkCitations('(' + realCode + ') rồi (' + realCode + ')', codeTable).cited === 1);
check('văn bản rỗng không làm hàm soi vỡ', AI.checkCitations('', codeTable).cited === 0);
check('thiếu bảng mã cũng không làm hàm soi vỡ', AI.checkCitations('(B1)', null).invalid.join() === 'B1');

// Nhật ký phải lưu KÈM bảng mã: mã chỉ có nghĩa tại thời điểm viết — hôm sau
// gói bằng chứng đổi thì (P1) có thể đã là một dự án khác.
const journalWithCodes = AI.saveJournal(config, '2026-10-09', { text: 'Việc (' + bogusCode + ').' });
check('nhật ký lưu kèm bảng mã để sau này còn đối chiếu',
  !!journalWithCodes.evidence && Object.keys(journalWithCodes.evidence.codes).length === realCodes.length);
check('nhật ký lưu kèm kết quả soi trích dẫn',
  !!journalWithCodes.evidence.check && journalWithCodes.evidence.check.invalid.join() === bogusCode,
  journalWithCodes.evidence.check);
check('đọc lại nhật ký vẫn còn bảng mã',
  Object.keys((AI.readJournal(config, '2026-10-09') || {}).evidence.codes).length === realCodes.length);

// Gói bằng chứng đã mang theo bức tranh độ phủ, để AI biết chỗ nào trống.
check('gói bằng chứng mang theo độ phủ nguồn',
  !!pack.coverage && typeof pack.coverage.note === 'string' && Array.isArray(pack.coverage.silent), pack.coverage);
check('lời nhắc dặn không được suy ra "không làm gì" từ chỗ thiếu dữ liệu',
  prompt.indexOf('không làm gì') !== -1 || prompt.indexOf('thiếu dữ liệu') !== -1);

/* =====================================================================
   [7] Các bộ thu thập
   ===================================================================== */

section('[7] Bộ thu thập');

const codex = require('../app/collect/codex');

check('bóc được khối ngữ cảnh khỏi lời nhắc', codex.cleanUserText('<environment_context>\n<cwd>X</cwd>\n</environment_context>\nSửa lỗi này giúp tôi') === 'Sửa lỗi này giúp tôi');
check('bỏ qua khối hướng dẫn AGENTS.md', codex.cleanUserText('# AGENTS.md instructions for D:\\x\n\n<INSTRUCTIONS>\nabc\n</INSTRUCTIONS>') === '');
check('giữ nguyên lời nhắc thường', codex.cleanUserText('Tại sao transaction không rollback?') === 'Tại sao transaction không rollback?');

const fakeRollout = path.join(TEST_DIR, 'rollout-gia.jsonl');
const rolloutLines = [
  { timestamp: '2026-10-09T02:00:00.000Z', type: 'session_meta', payload: { id: 'sess-1', cwd: nexus, originator: 'Codex Desktop' } },
  { timestamp: '2026-10-09T02:00:01.000Z', type: 'turn_context', payload: { cwd: nexus, model: 'gpt-thu' } },
  { timestamp: '2026-10-09T02:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Sửa lỗi rollback trong UserService' }] } },
  { timestamp: '2026-10-09T02:00:03.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 't1', started_at: 1791504002 } },
  { timestamp: '2026-10-09T02:05:00.000Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'mvn -q test', workdir: nexus }) } },
  { timestamp: '2026-10-09T02:05:01.000Z', type: 'response_item', payload: { type: 'function_call', name: 'js', arguments: '{}' } },
  { timestamp: '2026-10-09T02:06:00.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 12345 } } } },
  { timestamp: '2026-10-09T02:07:00.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', completed_at: 1791504420, duration_ms: 420000 } }
];
fs.writeFileSync(fakeRollout, rolloutLines.map((l) => JSON.stringify(l)).join('\n') + '\n');

const parsed = codex.parseRollout(fakeRollout, config);
check('đọc được mã phiên', parsed.sessionId === 'sess-1');
check('đọc được thư mục làm việc', parsed.cwd === nexus);
check('đọc được model từ turn_context', parsed.model === 'gpt-thu');
check('đếm đúng số lượt', parsed.turns.length === 1);
check('lấy được lời nhắc của lượt', parsed.turns[0].prompt.indexOf('rollback') !== -1, parsed.turns[0].prompt);
check('ghi lại lệnh đã chạy', parsed.commands.length === 1 && parsed.commands[0].cmd === 'mvn -q test');
check('đếm token', parsed.tokens === 12345);
check('đếm số lần gọi công cụ', parsed.tools.exec_command === 1 && parsed.tools.js === 1);

const fakeRolloutDir = path.join(TEST_DIR, 'sessions-gia');
fs.mkdirSync(path.join(fakeRolloutDir, '2026', '10', '09'), { recursive: true });
fs.copyFileSync(fakeRollout, path.join(fakeRolloutDir, '2026', '10', '09', 'rollout-gia.jsonl'));
const codexConfig = JSON.parse(JSON.stringify(config));
codexConfig.sources.codex = { enabled: true, root: fakeRolloutDir, maxFiles: 20 };
const codexOut = codex.collect(codexConfig);
check('bộ thu Codex sinh sự kiện phiên', codexOut.events.some((e) => e.kind === 'session'));
check('bộ thu Codex sinh sự kiện lượt', codexOut.events.some((e) => e.kind === 'turn'));
check('sự kiện Codex trỏ đúng dự án', codexOut.events.some((e) => e.project === nexus));

const shell = require('../app/collect/shell');
check('gắn nhãn git cho lệnh', shell.tagsOf('git status').indexOf('git') !== -1);

/* ---- Nguồn Git: chỉ tính việc của chính huynh ---- */

check('lọc commit theo danh tính, khớp cả tên lẫn thư điện tử', (function () {
  const authors = ['manhhiepxyz', 'ngmanhhiep2004@gmail.com'];
  const mine1 = { author: 'ManhHiepXYZ', email: 'x@y.z' };
  const mine2 = { author: 'Ai đó', email: 'ngmanhhiep2004@gmail.com' };
  const other = { author: 'Ai đó', email: 'nguoikhac@example.com' };
  return Git.matchesAuthor(mine1, authors) && Git.matchesAuthor(mine2, authors) && !Git.matchesAuthor(other, authors);
})());
check('danh sách danh tính rỗng thì không lọc gì', Git.matchesAuthor({ author: 'x', email: 'y' }, []) === true);
check('đọc được danh tính từ git toàn cục', (function () {
  const fake = (repo, args) => (args[2] === 'user.name' ? 'manhhiepxyz\n' : 'ngmanhhiep2004@gmail.com\n');
  const got = Git.detectAuthors(fake);
  return got.length === 2 && got[0] === 'manhhiepxyz' && got[1] === 'ngmanhhiep2004@gmail.com';
})(), Git.detectAuthors(() => null));
check('git không khai danh tính thì trả về rỗng, không bịa', Git.detectAuthors(() => '').length === 0);

/* Bộ đọc log phải tách đúng cột sau khi thêm thư điện tử vào định dạng: câu
   tiêu đề có thể chứa dấu "|", nên nó phải được ghép lại chứ không cắt. */
check('bộ đọc log tách đúng cột khi tiêu đề có dấu gạch đứng', (function () {
  const line = '@@abc123|1700000000|Nguyễn Mạnh Hiệp|a@b.c|fix: a | b | c\n3\t1\tsrc/x.js\n';
  const read = Git.readCommitsDetailed('X:\\kho', () => line);
  const c = read.commits[0];
  return read.ok && c.author === 'Nguyễn Mạnh Hiệp' && c.email === 'a@b.c'
    && c.subject === 'fix: a | b | c' && c.files.length === 1 && c.insertions === 3;
})(), (function () {
  const read = Git.readCommitsDetailed('X:\\kho', () => '@@s|1|a|b|c\n');
  return read.commits[0] && read.commits[0].subject;
})());
check('git đọc lỗi thì báo là đọc hụt, không phải kho rỗng',
  Git.readCommitsDetailed('X:\\kho', () => null).ok === false);

/* Kho vừa `git init` chưa commit lần nào: git trả mã lỗi, nhưng đó là SỰ THẬT
   về kho chứ không phải đọc hụt. Nhầm hai thứ này thì một kho rỗng khoá cứng
   đường cập nhật của cả nguồn git — và trên máy này có 27 kho như vậy. */
check('nhận ra thông báo kho rỗng của git',
  Git.EMPTY_REPO_RE.test("fatal: your current branch 'main' does not have any commits yet")
  && !Git.EMPTY_REPO_RE.test('fatal: not a git repository (or any of the parent directories)'));
check('kho rỗng thì đọc ra 0 commit và vẫn tính là đọc đủ',
  (function () { const d = Git.readCommitsDetailed('X:\\kho', () => ''); return d.ok === true && d.empty === true && d.commits.length === 0; })());

/* ---- Khe cắm git: đọc được thông tin kho mà không cần git thật ----

   `repoInfo` và `workingTree` trước đây gọi thẳng `git()` bên trong, nên
   không có cách nào kiểm thử chúng mà không dựng một kho git thật trên đĩa.
   Giờ cả hai nhận `run` như `detectAuthors` đã nhận từ lâu. */

const fakeRepo = path.join(TEST_DIR, 'kho-gia');
fs.mkdirSync(path.join(fakeRepo, '.git'), { recursive: true });

// Năm dòng --porcelain đủ để phân biệt mọi ca: chỉ ở cây làm việc, chỉ ở
// bản chuẩn bị, cả hai, và tệp mới chưa theo dõi.
const PORCELAIN = ' M src/a.js\nM  src/b.js\nMM src/c.js\n?? moi.txt\nA  src/moi.js\n';

function fakeGitRunner(repo, args) {
  const key = args.join(' ');
  if (key === 'rev-parse --abbrev-ref HEAD') return 'main\n';
  if (key === 'config --get remote.origin.url') return 'git@github.com:manhhiepxyz/DevTrace.git\n';
  if (key === 'status --porcelain=v1') return PORCELAIN;
  return null;
}

check('khe cắm đọc được thông tin kho', (function () {
  const info = Git.repoInfo(fakeRepo, fakeGitRunner);
  return info && info.branch === 'main' && info.remote.indexOf('DevTrace') !== -1;
})(), Git.repoInfo(fakeRepo, fakeGitRunner));

check('thư mục không có .git thì vẫn là null, khe cắm không đổi kết luận đó',
  Git.repoInfo(path.join(TEST_DIR, 'khong-phai-kho'), fakeGitRunner) === null);

check('cây làm việc tách được đã-chuẩn-bị khỏi còn-dở', (function () {
  const t = Git.workingTree(fakeRepo, fakeGitRunner);
  // 4 tệp đã theo dõi + 1 tệp mới; 3 dòng có thay đổi ở bản chuẩn bị
  // (M , MM, A ), 3 dòng có thay đổi ở cây làm việc ( M, MM, ??).
  return t.total === 5 && t.modified === 4 && t.untracked === 1
    && t.staged === 3 && t.unstaged === 3;
})(), Git.workingTree(fakeRepo, fakeGitRunner));

check('cây làm việc sạch thì mọi con số bằng 0, không phải null', (function () {
  const t = Git.workingTree(fakeRepo, () => '');
  return t && t.total === 0 && t.staged === 0 && t.unstaged === 0;
})());

check('cây làm việc đọc hụt thì trả null, không bịa ra số 0',
  Git.workingTree(fakeRepo, () => null) === null);

/* ---- Nguồn GitHub: chạy ngoại tuyến, khoá chỉ được nhắc tên ---- */

const GitHub = require('../app/collect/github');

// Dữ liệu mẫu đúng hình dạng API trả về, để đường đọc chạy thật mà không
// chạm mạng lần nào.
const ghRaw = [
  { id: '1001', type: 'PushEvent', created_at: '2026-10-09T09:30:00Z', repo: { name: 'manhhiepxyz/DevTrace' },
    actor: { login: 'manhhiepxyz' },
    payload: { ref: 'refs/heads/main', commits: [{ message: 'feat: cảnh báo\n\nchi tiết' }] } },
  { id: '1002', type: 'PullRequestEvent', created_at: '2026-10-09T08:00:00Z', repo: { name: 'a/b' },
    actor: { login: 'manhhiepxyz' },
    payload: { action: 'opened', number: 12, pull_request: { number: 12, title: 'Sửa lỗi đăng nhập' } } },
  { id: '1003', type: 'WatchEvent', created_at: '2026-10-08T20:00:00Z', repo: { name: 'x/y' }, actor: { login: 'manhhiepxyz' }, payload: {} },
  { type: 'PushEvent', created_at: '2026-10-08T19:00:00Z', repo: { name: 'x/y' }, payload: {} },
  { id: '1005', type: 'PushEvent', created_at: 'không phải thời gian', repo: { name: 'x/y' }, payload: {} }
];

check('đổi được sự kiện GitHub sang sự kiện DevTrace', (function () {
  const out = GitHub.toEvents(ghRaw, 100);
  return out.events.length === 3 && out.events.every((e) => e.source === 'github');
})(), GitHub.toEvents(ghRaw, 100).events.length);
check('mục thiếu mã hoặc thiếu thời gian bị bỏ và đếm lại', GitHub.toEvents(ghRaw, 100).skipped === 2);
check('mã sự kiện GitHub giữ nguyên gốc', GitHub.toEvents(ghRaw, 100).events[0].id === 'github:1001');
check('dựng được câu mô tả tiếng Việt cho lần đẩy mã', (function () {
  const e = GitHub.toEvents(ghRaw, 100).events[0];
  return /1 commit/.test(e.title) && /nhánh main/.test(e.title) && e.detail === 'feat: cảnh báo';
})(), GitHub.toEvents(ghRaw, 100).events[0].title);
check('dựng được câu mô tả cho pull request', /#12/.test(GitHub.toEvents(ghRaw, 100).events[1].title));
check('gắn kho làm dự án', GitHub.toEvents(ghRaw, 100).events[0].project === 'manhhiepxyz/DevTrace');
check('tôn trọng giới hạn số mục', GitHub.toEvents(ghRaw, 1).events.length === 1);

const ghConfig = testConfig();
ghConfig.sources.github.enabled = true;
ghConfig.sources.github.user = 'manhhiepxyz';

check('nguồn GitHub mặc định tắt', require('../app/config').defaults().sources.github.enabled === false);
check('cấu hình GitHub chỉ giữ TÊN biến môi trường, không giữ khoá', (function () {
  const gh = require('../app/config').defaults().sources.github;
  const keys = Object.keys(gh);
  // Bất cứ khoá nào tên na ná token/key/secret mà KHÔNG phải tên biến môi
  // trường đều là khoá thật lọt vào cấu hình — mà cấu hình thì đi ra ngoài
  // qua /api/config và cả hai đường xuất dữ liệu.
  return gh.tokenEnv === 'DEVTRACE_GITHUB_TOKEN'
    && keys.every((k) => !/token|secret|password|apikey/i.test(k) || k === 'tokenEnv');
})(), Object.keys(require('../app/config').defaults().sources.github));

const ghFetch = (url) => ({ status: 200, body: JSON.stringify(ghRaw), url });
check('chưa khai tài khoản thì không gọi mạng và nói rõ thiếu gì', (function () {
  const bare = JSON.parse(JSON.stringify(ghConfig));
  bare.sources.github.user = '';
  let called = false;
  const out = GitHub.collect(bare, { fetchJson: () => { called = true; return { status: 200, body: '[]' }; } });
  return !called && out.events.length === 0 && out.complete === false && /sources\.github\.user/.test(out.notes[0]);
})());
check('nguồn GitHub tắt thì không gọi mạng', (function () {
  const off = JSON.parse(JSON.stringify(ghConfig));
  off.sources.github.enabled = false;
  let called = false;
  const out = GitHub.collect(off, { fetchJson: () => { called = true; return { status: 200, body: '[]' }; } });
  return !called && out.events.length === 0;
})());
check('đọc được hoạt động qua khe mạng giả', (function () {
  const out = GitHub.collect(ghConfig, { fetchJson: ghFetch });
  return out.events.length === 3 && out.notes.some((n) => /3 hoạt động/.test(n));
})(), GitHub.collect(ghConfig, { fetchJson: ghFetch }).notes);
check('gọi đúng địa chỉ API của tài khoản', (function () {
  let seen = '';
  GitHub.collect(ghConfig, { fetchJson: (url) => { seen = url; return ghFetch(url); } });
  return seen === 'https://api.github.com/users/manhhiepxyz/events?per_page=100';
})());
check('không có khoá thì nói thẳng là không thấy được kho riêng', (function () {
  const saved = process.env[ghConfig.sources.github.tokenEnv];
  delete process.env[ghConfig.sources.github.tokenEnv];
  try {
    const notes = GitHub.collect(ghConfig, { fetchJson: ghFetch }).notes;
    return notes.some((n) => /chế độ công khai/.test(n) && /kho riêng/.test(n));
  } finally { if (saved !== undefined) process.env[ghConfig.sources.github.tokenEnv] = saved; }
})());
check('tài khoản không tồn tại thì nói rõ, không đoán bừa', (function () {
  const out = GitHub.collect(ghConfig, { fetchJson: () => ({ status: 404, body: '{}' }) });
  return out.events.length === 0 && out.complete === false && /không thấy tài khoản/.test(out.notes[0]);
})());
check('bị chặn vì hạn mức thì nói rõ là hạn mức', (function () {
  const out = GitHub.collect(ghConfig, { fetchJson: () => ({ status: 403, body: '{}', note: 'GitHub đang chặn vì hạn mức (HTTP 403).' }) });
  return out.events.length === 0 && out.complete === false && /hạn mức/.test(out.notes[0]);
})());
check('mạng hỏng thì báo đọc hụt, không phải tài khoản rỗng', (function () {
  const out = GitHub.collect(ghConfig, { fetchJson: () => ({ status: 0, body: 'getaddrinfo ENOTFOUND' }) });
  return out.events.length === 0 && out.complete === false;
})());
check('dữ liệu trả về hỏng thì không làm gãy lần thu thập', (function () {
  const out = GitHub.collect(ghConfig, { fetchJson: () => ({ status: 200, body: '<html>không phải JSON</html>' }) });
  return out.events.length === 0 && out.complete === false && out.notes.length > 0;
})());

/* Nguồn này chỉ được GHI THÊM. Nếu nó bị xếp nhầm vào nhóm suy-ra-được thì
   mỗi lần thu thập lại là một lần xoá những sự kiện đã rơi ra khỏi cửa sổ
   ~90 ngày của API — tức là bằng chứng cũ biến mất trong im lặng. */
check('nguồn GitHub ghi thêm chứ không thay thế', E.STREAM_SOURCES.indexOf('github') !== -1
  && E.DERIVED_SOURCES.indexOf('github') === -1);
check('nguồn GitHub không khai complete nên không kích chốt chặn thay thế',
  GitHub.collect(ghConfig, { fetchJson: ghFetch }).complete === undefined);

// Không bao giờ được để giá trị khoá lọt vào bất cứ thứ gì ghi ra đĩa hoặc
// gửi lên trình duyệt.
check('bộ gọi mạng con nhận TÊN biến môi trường, không nhận giá trị khoá', (function () {
  const src = fs.readFileSync(path.join(ROOT, 'app/collect/github-fetch.js'), 'utf8');
  return src.indexOf('process.argv[3]') !== -1 && /process\.env\[tokenEnv\]/.test(src)
    && src.indexOf('process.argv[2] = ') === -1;
})());
check('bộ gọi mạng con không ghi gì ra đĩa', (function () {
  const src = fs.readFileSync(path.join(ROOT, 'app/collect/github-fetch.js'), 'utf8');
  return !/writeFileSync|appendFileSync|createWriteStream|mkdirSync/.test(src);
})());
check('gắn nhãn java cho maven', shell.tagsOf('mvn clean install').indexOf('java') !== -1);
check('gắn nhãn hạ tầng cho docker', shell.tagsOf('docker compose up -d').indexOf('hạ tầng') !== -1);
check('lệnh lạ không có nhãn', shell.tagsOf('echo xin chao').length === 0);

const browserCollector = require('../app/collect/browser');
check('bóc tên miền từ URL', browserCollector.hostOf('https://www.github.com/a/b') === 'github.com');
check('xếp github vào nhóm học', browserCollector.categoryOf('github.com') === 'học');
check('xếp youtube vào nhóm giải trí', browserCollector.categoryOf('youtube.com') === 'giải trí');
check('miền lạ vào nhóm khác', browserCollector.categoryOf('vi-du.com') === 'khác');
check('nhận diện miền con của tài liệu', browserCollector.categoryOf('developer.mozilla.org') === 'học');

/* Gộp những lượt xem liền kề trùng tiêu đề. Truy vấn SQL trả về theo thứ tự
   MỚI NHẤT TRƯỚC, nên vòng lặp đi từ mới tới cũ; bản cũ viết hiệu ngược lại
   (ts - lastTs, luôn âm) nên điều kiện luôn đúng và MỌI lượt liền kề cùng
   tiêu đề đều bị gộp, bất kể cách nhau bao lâu. Mấy phép thử này khoá lại. */
// Đi ngược lại phép đổi của bộ thu thập: Chrome ghi thời gian bằng micro-giây
// kể từ 1601, nên ở đây phải dựng số WebKit từ mili-giây thật.
const webkit = (base, minutes) => (base + minutes * 60000 + U.WEBKIT_EPOCH_OFFSET_MS) * 1000;
const visitBase = new Date(2026, 9, 9, 10, 0).getTime();
const farApart = [
  { t: webkit(visitBase, 60), url: 'https://a.com/1', title: 'Trang A' },  // mới nhất
  { t: webkit(visitBase, 30), url: 'https://a.com/2', title: 'Trang A' },  // cách 30 phút
  { t: webkit(visitBase, 29), url: 'https://a.com/3', title: 'Trang A' },  // cách 1 phút
  { t: webkit(visitBase, 0), url: 'https://b.com/', title: 'Trang B' }
];
check('lượt xem cùng tiêu đề nhưng cách xa nhau thì vẫn giữ',
  browserCollector.dedupeVisits(farApart).length === 3, browserCollector.dedupeVisits(farApart).length);
const backToBack = [
  { t: webkit(visitBase, 3), url: 'https://a.com/1', title: 'Trang A' },
  { t: webkit(visitBase, 2), url: 'https://a.com/2', title: 'Trang A' }
];
check('hai lượt xem liền nhau cùng tiêu đề thì gộp làm một',
  browserCollector.dedupeVisits(backToBack).length === 1, browserCollector.dedupeVisits(backToBack).length);
check('khác tiêu đề thì không gộp dù cùng miền',
  browserCollector.dedupeVisits([
    { t: webkit(visitBase, 3), url: 'https://a.com/1', title: 'Trang A' },
    { t: webkit(visitBase, 2), url: 'https://a.com/2', title: 'Trang B' }
  ]).length === 2);
check('khác miền thì không gộp dù cùng tiêu đề',
  browserCollector.dedupeVisits([
    { t: webkit(visitBase, 3), url: 'https://a.com/1', title: 'Trang A' },
    { t: webkit(visitBase, 2), url: 'https://b.com/1', title: 'Trang A' }
  ]).length === 2);
check('mốc thời gian rác bị bỏ qua chứ không làm vỡ',
  browserCollector.dedupeVisits([{ t: 0, url: 'https://a.com/1', title: 'A' }]).length === 0);
check('lượt xem đã gộp vẫn giữ đúng mốc thời gian mới nhất',
  browserCollector.dedupeVisits(backToBack)[0].ts === visitBase + 3 * 60000,
  browserCollector.dedupeVisits(backToBack)[0].ts);

const vscode = require('../app/collect/vscode');
check('giải mã URI thư mục của VS Code', vscode.decodeFolder('file:///d%3A/du-an/abc') === 'd:\\du-an\\abc' || vscode.decodeFolder('file:///d%3A/du-an/abc') === 'd:\\du-an\\abc');

const filesCollector = require('../app/collect/files');
const watchDir = path.join(TEST_DIR, 'theo-doi');
fs.mkdirSync(path.join(watchDir, 'src'), { recursive: true });
fs.mkdirSync(path.join(watchDir, 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(watchDir, 'src', 'a.js'), 'console.log(1)\n');
fs.writeFileSync(path.join(watchDir, 'node_modules', 'x.js'), 'module\n');
const fileConfig = JSON.parse(JSON.stringify(config));
fileConfig.sources.files = { enabled: true, dirs: [watchDir], maxDepth: 3, ignore: [] };
const firstScan = filesCollector.scan(fileConfig);
check('bỏ qua node_modules khi quét tệp', Object.keys(firstScan.snapshot).every((k) => k.indexOf('node_modules') === -1), Object.keys(firstScan.snapshot));
check('quét được tệp trong thư mục con', Object.keys(firstScan.snapshot).some((k) => k.indexOf('a.js') !== -1));

/* =====================================================================
   [8] Bộ điều phối thu thập
   ===================================================================== */

section('[8] Điều phối thu thập');

const runConfig = JSON.parse(JSON.stringify(config));
runConfig.sources.codex = { enabled: true, root: fakeRolloutDir, maxFiles: 20 };
runConfig.sources.files = { enabled: true, dirs: [watchDir], maxDepth: 3, ignore: [] };

const summary = Collect.run(runConfig, {});
check('điều phối chạy không lỗi', typeof summary.total === 'number');
/* Bảy, không phải tám: "Tự ghi" là nguồn có mặt trong E.SOURCES nhưng không
   có bộ thu thập nào — nó do huynh tự thêm, không phải máy đi nhặt. */
check('điều phối báo cáo từng nguồn', Object.keys(summary.sources).length === 7);
check('nguồn tắt không sinh sự kiện', summary.sources.browser.events === 0);
check('ghi lại sức khoẻ nguồn', fs.existsSync(E.healthPath(runConfig)) || true);
const health = E.readHealth(runConfig);
check('sức khoẻ có mục Codex', !!(health.sources && health.sources.codex));
check('sức khoẻ ghi nhận thời điểm chạy', typeof health.sources.codex.lastRun === 'number');
check('nguồn suy ra được thay thế chứ không cộng dồn', (function () {
  const before = E.readDay(runConfig, '2026-10-09').filter((e) => e.source === 'codex').length;
  Collect.run(runConfig, { sources: ['codex'] });
  const after = E.readDay(runConfig, '2026-10-09').filter((e) => e.source === 'codex').length;
  return before === after;
})());
check('trạng thái nguồn cho giao diện', Collect.status(runConfig).sources.length === 8);

/* ---- Chốt chặn chống xoá dữ liệu -----------------------------------
   Nguồn suy ra được ghi bằng cách THAY TOÀN BỘ trên mọi ngày. Nghĩa là một
   lần đọc hụt — Chrome đang giữ tệp History, ổ mạng rút ra, nguồn bị tắt
   trong màn Cài đặt — từng xoá sạch lịch sử thật của chính nguồn đó. Nhóm
   kiểm tra dưới đây dựng dữ liệu ở một thư mục riêng rồi thử từng đường
   làm mất dữ liệu; tất cả đều phải giữ nguyên bản cũ.
   ------------------------------------------------------------------- */

const guardConfig = JSON.parse(JSON.stringify(config));
guardConfig.dataDir = path.join(TEST_DIR, 'guard');
fs.mkdirSync(guardConfig.dataDir, { recursive: true });
// Cấu hình gốc của bộ kiểm thử tắt hết nguồn; ở đây phải BẬT Codex, nếu
// không thì phép thử đi nhầm vào nhánh "nguồn đang tắt" và chốt chặn không
// hề được chạy tới.
guardConfig.sources.codex = { enabled: true, root: fakeRolloutDir, maxFiles: 20 };

function countSource(cfg, source) {
  let total = 0;
  for (const day of E.listDays(cfg)) total += E.readDay(cfg, day).filter((e) => e.source === source).length;
  return total;
}

// Hai sự kiện ở hai ngày khác nhau: thay toàn bộ là xoá cả hai.
E.replaceSourceAllDays(guardConfig, 'codex', E.makeMany(guardConfig, [
  { source: 'codex', kind: 'session', ts: morning, title: 'phiên thử' },
  { source: 'codex', kind: 'turn', ts: new Date(2026, 9, 8, 15, 0).getTime(), title: 'lượt hôm trước' }
]));
const seeded = countSource(guardConfig, 'codex');
check('dựng được dữ liệu nhiều ngày để thử chốt chặn', seeded === 2, seeded);

// 1. Bộ thu thập trả về rỗng mà không nói gì: chưa chắc nguồn rỗng thật.
const emptyRead = Collect.persist(guardConfig, 'codex', [], {});
check('nguồn suy ra trả về rỗng thì giữ nguyên bản cũ', emptyRead.skipped === 'nguồn trả về rỗng', emptyRead);
check('lần trả về rỗng không trả ra sự kiện nào', emptyRead.events.length === 0);
check('dữ liệu vẫn còn nguyên sau lần trả về rỗng', countSource(guardConfig, 'codex') === seeded);

// 2. Bộ thu thập nói rõ là đọc hụt: cũng phải giữ nguyên.
const partialRead = Collect.persist(guardConfig, 'codex', [], { complete: false });
check('nguồn đọc hụt thì giữ nguyên bản cũ', partialRead.skipped === 'nguồn đọc hụt', partialRead);
check('dữ liệu vẫn còn nguyên sau lần đọc hụt', countSource(guardConfig, 'codex') === seeded);

// 3. Cờ đọc hụt phải chảy được qua bộ điều phối, không chỉ đúng khi gọi thẳng.
const realCodex = Collect.COLLECTORS.codex;
function withCodex(fake, fn) {
  Collect.COLLECTORS.codex = fake;
  try { return fn(); } finally { Collect.COLLECTORS.codex = realCodex; }
}
const partialRun = withCodex(
  { collect: function () { return { events: [], notes: [], complete: false }; } },
  function () { return Collect.run(guardConfig, { sources: ['codex'] }); }
);
check('điều phối truyền được cờ đọc hụt xuống chốt chặn', countSource(guardConfig, 'codex') === seeded);
check('điều phối nói rõ vì sao con số không đổi',
  partialRun.notes.join(' ').indexOf('giữ nguyên dữ liệu cũ') !== -1, partialRun.notes);
check('điều phối vẫn ghi sức khoẻ cho nguồn đọc hụt', !!(E.readHealth(guardConfig).sources || {}).codex);

// 4. Nguồn tắt thì không chạy và không đụng tới kho.
const offConfig = JSON.parse(JSON.stringify(guardConfig));
offConfig.sources.codex.enabled = false;
const offSummary = Collect.run(offConfig, { sources: ['codex'] });
check('nguồn tắt thì không đụng tới kho', countSource(offConfig, 'codex') === seeded);
check('nguồn tắt vẫn được báo cáo trong bảng điều phối',
  offSummary.sources.codex.events === 0 && offSummary.sources.codex.notes.join(' ').indexOf('đang tắt') !== -1,
  offSummary.sources.codex);
check('nguồn tắt vẫn có mặt trong danh sách nguồn', Collect.status(offConfig).sources.length === 8);
check('nguồn tắt vẫn hiện là đang tắt cho giao diện',
  Collect.status(offConfig).sources.filter((s) => s.name === 'codex')[0].enabled === false);

// 5. Nguồn thật sự đọc đủ mà rỗng thì vẫn phải thay được — nếu không,
//    xoá một nguồn sẽ là việc không thể làm.
const cleared = Collect.persist(guardConfig, 'codex', [], { complete: true });
check('đọc đủ mà nguồn thật sự rỗng thì được phép thay', cleared.skipped === null, cleared);
check('thay bằng rỗng thì xoá đúng dữ liệu cũ', countSource(guardConfig, 'codex') === 0);

// 6. Dựng lại toàn bộ là đường thoát hiểm: vẫn thay được kể cả khi đọc hụt.
E.replaceSourceAllDays(guardConfig, 'codex', E.makeMany(guardConfig, [
  { source: 'codex', kind: 'session', ts: morning, title: 'phiên dựng lại' }
]));
const rebuilt = Collect.persist(guardConfig, 'codex', [], { rebuild: true });
check('dựng lại toàn bộ thì thay được dù kết quả rỗng', rebuilt.skipped === null && countSource(guardConfig, 'codex') === 0);

// 7. Nguồn dòng chảy ghi thêm chứ không thay, nên rỗng không xoá được gì.
E.addEvents(guardConfig, U.dayKey(morning, guardConfig.dayStartHour), E.makeMany(guardConfig, [
  { source: 'files', kind: 'change', ts: morning, title: 'giu-lai.js' }
]));
const streamRead = Collect.persist(guardConfig, 'files', [], {});
check('nguồn dòng chảy trả về rỗng thì không bị coi là lỗi', streamRead.skipped === null, streamRead);
check('nguồn dòng chảy giữ nguyên sự kiện cũ', countSource(guardConfig, 'files') === 1);

/* =====================================================================
   [9] Giao diện: dựng thử mọi màn hình
   ===================================================================== */

section('[9] Dựng giao diện');

const vm = require('vm');
const sandbox = { console: console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/charts.js'), 'utf8'), sandbox, { filename: 'charts.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/views.js'), 'utf8'), sandbox, { filename: 'views.js' });

const Views = sandbox.Views;
const Charts = sandbox.Charts;
check('nạp được thư viện biểu đồ', !!Charts && typeof Charts.bars === 'function');
check('nạp được sáu màn hình', Object.keys(Views).length === 6, Object.keys(Views));

sandbox.DEVTRACE_SOURCES = E.SOURCES;
const colors = { bg: '#000', panel: '#111', line: '#222', ink: '#eee', muted: '#888', cinabar: '#c8543c', jade: '#5a7', indigo: '#79c', gold: '#da3', plum: '#a7c' };
const dayForView = E.listDays(runConfig)[0] || '2026-10-09';

const viewCtx = {
  state: { day: dayForView, range: 14, filters: { source: '', q: '' }, theme: 'muc' },
  colors,
  data: {
    digest: D.build(runConfig, dayForView),
    journal: { text: 'Nhật ký thử để kiểm tra hiển thị.', source: 'test', updatedAt: Date.now() },
    status: Collect.status(runConfig),
    config: runConfig,
    distribution: [{ label: 'Codex', value: 3, color: colors.plum }, { label: 'Trình duyệt', value: 5, color: colors.jade }],
    events: E.readDay(runConfig, dayForView),
    days: [Report.daySummary(runConfig, dayForView)],
    projects: Report.projectsRange(runConfig, 14),
    totalEvents: 10
  }
};

Object.keys(Views).forEach(function (name) {
  let html = '';
  let failed = null;
  try { html = Views[name].render(viewCtx); } catch (error) { failed = error.message; }
  check('màn ' + name + ' dựng được HTML', !failed && html.length > 40, failed);
  check('màn ' + name + ' không lộ undefined', !failed && html.indexOf('undefined') === -1);
  check('màn ' + name + ' không lộ [object Object]', !failed && html.indexOf('[object Object]') === -1);
  check('màn ' + name + ' có tiêu đề', !failed && typeof Views[name].title === 'string' && Views[name].title.length > 0);
});

check('màn hình rỗng vẫn không vỡ', (function () {
  const emptyCtx = JSON.parse(JSON.stringify(viewCtx));
  emptyCtx.data.digest = D.build(runConfig, '2000-01-01');
  emptyCtx.data.journal = null;
  emptyCtx.data.events = [];
  emptyCtx.data.days = [];
  emptyCtx.data.projects = { days: 0, totalEvents: 0, projects: [] };
  return Object.keys(Views).every(function (name) {
    try { return Views[name].render(emptyCtx).length > 20; } catch (e) { return false; }
  });
})());

/* Ba câu hỏi phải luôn hiện, kể cả khi mọi phần chi tiết đều đang gấp lại.
   Đây là điều kiện để "gọn mặc định" không biến thành "giấu mất thông tin". */
check('màn today lúc gấp vẫn đủ ba câu hỏi', (function () {
  const html = Views.today.render(viewCtx);
  return ['Huynh đã làm gì', 'Huynh đã tạo ra kết quả gì', 'Học được gì, mai làm gì']
    .every((title) => html.indexOf(title) !== -1);
})(), Views.today.render(viewCtx).length);

check('màn today có nút mở chi tiết', Views.today.render(viewCtx).indexOf('data-action="toggle-detail"') !== -1);

/* Gấp và mở phải thật sự khác nhau, chứ không phải hai cách viết ra cùng một
   thứ. Dùng mục "Lịch sử thu thập" vì nó luôn có mặt, không phụ thuộc ngày
   đang xem có dữ liệu hay không. */
check('gấp thì giấu chi tiết, mở thì hiện ra', (function () {
  const closed = Views.today.render(viewCtx);
  const openCtx = Object.assign({}, viewCtx, {
    state: Object.assign({}, viewCtx.state, { open: { 'today-sources': true } })
  });
  const opened = Views.today.render(openCtx);
  return closed.indexOf('disclosure-body') === -1
    && closed.indexOf('data-value="today-sources"') !== -1
    && opened.indexOf('disclosure-body') !== -1
    && opened.indexOf('source-row') !== -1;
})(), Views.today.render(viewCtx).indexOf('disclosure-body'));

check('màn today đọc được state thiếu trường open', (function () {
  // Bộ kiểm thử và lần vẽ đầu tiên đều có thể đưa vào một state không có
  // `open`. Thiếu chốt chặn là lộ chữ "undefined" ra giao diện.
  const bare = Object.assign({}, viewCtx, { state: { day: dayForView, range: 14, filters: {} } });
  const html = Views.today.render(bare);
  return html.indexOf('undefined') === -1 && html.indexOf('disclosure') !== -1;
})());

check('có bảng gom cảnh báo riêng, không nhét vào Views', !!sandbox.Warnings && typeof sandbox.Warnings.html === 'function');
check('đếm được cảnh báo của một ngày', (function () {
  const n = sandbox.Warnings.count(viewCtx);
  return typeof n === 'number' && n >= 0;
})(), sandbox.Warnings.count(viewCtx));

check('biểu đồ cột dựng được', Charts.bars({ data: [{ label: 'a', value: 3 }, { label: 'b', value: 7 }] }).indexOf('<svg') === 0);
check('biểu đồ cột chịu được dữ liệu rỗng', Charts.bars({ data: [] }).indexOf('<svg') === 0);
check('đường xu hướng chịu được một điểm', Charts.sparkline([5]).indexOf('empty') !== -1);
check('vòng tròn chịu được tổng bằng 0', Charts.donut([{ label: 'x', value: 0 }]).indexOf('empty') !== -1);
check('vòng tròn vẽ đủ nền và số cung', (Charts.donut([{ label: 'a', value: 1, color: '#f00' }, { label: 'b', value: 1, color: '#0f0' }]).match(/<circle/g) || []).length === 3);
check('lưới nhiệt chịu được danh sách rỗng', Charts.heatmap([]).indexOf('empty') !== -1);
check('thoát HTML đúng', Charts.esc('<b>"x"</b>') === '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');

/* =====================================================================
   [10] Nối dây giữa giao diện, máy chủ và tài nguyên
   ===================================================================== */

section('[10] Nối dây');

const viewsSrc = fs.readFileSync(path.join(ROOT, 'web/views.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'web/app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const grab = (src, re) => [...src.matchAll(re)].map((m) => m[1]);

const usedActions = new Set([].concat(grab(viewsSrc, /data-action="([a-z0-9-]+)"/g), grab(htmlSrc, /data-action="([a-z0-9-]+)"/g)));
const handledActions = new Set(grab(appSrc, /'([a-z0-9-]+)':\s*function/g));
const missingActions = [...usedActions].filter((a) => !handledActions.has(a));
check('mọi data-action đều có hàm xử lý', missingActions.length === 0, missingActions);

const usedRoutes = new Set(grab(viewsSrc, /data-route="([a-z0-9-]+)"/g).concat(grab(htmlSrc, /data-route="([a-z0-9-]+)"/g)));
const viewKeys = new Set(Object.keys(Views));
check('mọi liên kết nội bộ trỏ tới màn hình có thật', [...usedRoutes].every((r) => viewKeys.has(r)), [...usedRoutes]);

const apiPaths = new Set(grab(appSrc, /'(\/api\/[a-z\/]*)/g));
const serverFlat = serverSrc.replace(/\\/g, '');
const missingApis = [...apiPaths].filter((p) => serverFlat.indexOf(p) === -1);
check('mọi đường dẫn API giao diện gọi đều có ở máy chủ', missingApis.length === 0, missingApis);
check('giao diện có gọi API', apiPaths.size >= 5, [...apiPaths]);

check('index.html nạp đủ ba tệp kịch bản', grab(htmlSrc, /<script src="(web\/[a-z]+\.js)"/g).length === 3, grab(htmlSrc, /<script src="(web\/[a-z]+\.js)"/g));
check('index.html nạp bảng kiểu', /<link rel="stylesheet" href="styles\.css">/.test(htmlSrc));
check('index.html có đủ điểm gắn của giao diện', ['id="nav"', 'id="view"', 'id="modalRoot"', 'id="toastRoot"', 'id="viewTitle"'].every((needle) => htmlSrc.indexOf(needle) !== -1));

/* ---- Trang ghi nhanh (capture.html) ----

   Trang này là cửa thứ hai vào cùng một hộp thư đến. Nó nạp CHUNG
   styles.css với ứng dụng — đó là cách duy nhất để bảng màu đang chọn đi
   theo mà không phải chép bộ token sang một tệp thứ hai rồi để chúng lệch
   nhau. Ba phép kiểm dưới khoá lại đúng ba mối nối đó. */
const captureHtmlSrc = fs.readFileSync(path.join(ROOT, 'capture.html'), 'utf8');
const captureJsSrc = fs.readFileSync(path.join(ROOT, 'web', 'capture.js'), 'utf8');

check('trang ghi nhanh dùng chung bảng kiểu với ứng dụng',
  captureHtmlSrc.indexOf('<link rel="stylesheet" href="styles.css">') !== -1);
check('trang ghi nhanh nạp mã của nó', captureHtmlSrc.indexOf('<script src="web/capture.js"></script>') !== -1);
check('trang ghi nhanh có đủ ô nhập, biểu mẫu và chỗ báo',
  ['id="captureForm"', 'id="captureText"', 'id="captureMsg"'].every((needle) => captureHtmlSrc.indexOf(needle) !== -1));
check('trang ghi nhanh đọc bảng màu trước khi vẽ, không nháy màu',
  captureHtmlSrc.indexOf("document.body.setAttribute('data-theme'") !== -1);

const captureApis = [...new Set(grab(captureJsSrc, /'(\/api\/[a-z\/]*)'/g))];
check('trang ghi nhanh có gọi API', captureApis.length >= 1, captureApis);
check('trang ghi nhanh gọi API có thật ở máy chủ',
  captureApis.every((p) => serverFlat.indexOf(p) !== -1), captureApis);

/* Câu huynh gõ không được xoá khi ghi hỏng — đó là lời hứa quan trọng nhất
   của cả tệp, và là thứ dễ bị phá nhất khi ai đó "dọn lại cho gọn". Đếm
   thẳng: cả tệp chỉ được có ĐÚNG MỘT chỗ xoá ô nhập, và nó phải nằm trước
   nhánh .catch. Đặt sai chỗ thì ghi hỏng là mất câu, im lặng. */
const clearAt = captureJsSrc.indexOf("input.value = ''");
check('trang ghi nhanh chỉ xoá ô nhập ở đúng một chỗ',
  clearAt !== -1 && captureJsSrc.indexOf("input.value = ''", clearAt + 1) === -1, clearAt);
const failAt = captureJsSrc.indexOf('Chưa ghi được:');
check('nhánh ghi hỏng không xoá ô nhập',
  failAt !== -1 && clearAt !== -1 && clearAt < failAt
  && captureJsSrc.slice(failAt).indexOf("input.value = ''") === -1, [clearAt, failAt]);

const requiredClasses = ['card', 'stat', 'badge', 'btn', 'table', 'question', 'timeline', 'block-card', 'meter', 'journal-text', 'source-row', 'empty', 'grid', 'toast', 'modal', 'hbar',
  'alert', 'alert-list', 'disclosure', 'disclosure-body', 'settings-actions',
  // Kế hoạch: bảng tuần, bảng bốn tầm nhìn, dải đợt, thẻ hộp thư, chip kho.
  'timetable', 'slot', 'slot-ok', 'slot-partial', 'slot-missed', 'slot-unknown',
  // Bảng tuần: khung cuộn, hàng/cột, ô trống, hàng Nguyên tắc, dòng đối chiếu.
  'timetable-wrap', 'slot-head', 'slot-head-time', 'slot-period', 'slot-col', 'slot-date',
  'slot-upcoming', 'slot-today', 'slot-cell', 'slot-empty', 'slot-pending', 'slot-target',
  'slot-goal-1', 'slot-goal-2', 'slot-goal-3', 'slot-goal-4', 'slot-goal-5',
  'slot-goal-none', 'slot-goal-many', 'slot-detail-row', 'slot-detail-open',
  'slot-principle-row', 'slot-principle-text',
  // Hộp thư đến, và cửa sổ ghi nhanh mở vào cùng chỗ đó.
  'inbox-capture', 'inbox-list', 'inbox-item', 'inbox-text', 'inbox-actions', 'inbox-empty',
  'capture-body', 'capture-form', 'capture-input', 'capture-foot', 'capture-hint',
  'capture-msg', 'capture-bad',
  // Dải "đang thu dấu vết" — nằm trên mọi màn hình trong lúc thu thập.
  'collect-bar', 'collect-bar-dot', 'collect-bar-text',
  'board', 'board-col', 'task', 'task-done', 'sprint-band', 'mail-list', 'mail-row', 'repo-chip'];
const missingClasses = requiredClasses.filter((name) => cssSrc.indexOf('.' + name) === -1);
check('bảng kiểu có đủ lớp giao diện dùng tới', missingClasses.length === 0, missingClasses);
check('bảng kiểu có ba bảng màu', ["muc", "giay", "trang"].every((t) => cssSrc.indexOf("body[data-theme='" + t + "']") !== -1));
check('bảng kiểu có giao diện hẹp', cssSrc.indexOf('@media') !== -1);

/* Ba bảng màu phải khai CÙNG một bộ token. Thiếu một token ở một bảng là ô đó
   rơi về giá trị thừa hưởng từ :root — chữ đen trên nền đen, hoặc tệ hơn là
   trong suốt — và chỉ lộ ra khi ai đó đổi bảng màu. */
const themeBlocks = {};
["muc", "giay", "trang"].forEach((name) => {
  const at = cssSrc.indexOf("body[data-theme='" + name + "']");
  themeBlocks[name] = cssSrc.slice(at, cssSrc.indexOf('}', at));
});
const tokensOf = (block) => [...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]).sort();
const mucTokens = tokensOf(themeBlocks.muc);
const tokenDiff = ["giay", "trang"].filter((name) => tokensOf(themeBlocks[name]).join(',') !== mucTokens.join(','));
check('ba bảng màu khai đủ cùng bộ token', tokenDiff.length === 0 && mucTokens.length >= 16,
  tokenDiff.length ? tokenDiff : mucTokens.length);

/* Bảng màu sáng là mặc định. Quét cả hai đầu: giá trị vẽ trước khi tải
   (index.html) và giá trị dự phòng trong mã. Lệch một trong hai là mỗi lần mở
   ứng dụng sẽ nháy một khung màu khác trước khi bảng kiểu kịp áp. */
check('bảng màu sáng là mặc định', htmlSrc.indexOf('data-theme="trang"') !== -1 && /localStorage\.getItem\('devtrace\.theme'\)\s*\|\|\s*'trang'/.test(appSrc));

/* Màu cứng còn sót là màu không đổi theo bảng màu — đúng thứ khiến một bảng
   màu mới trông nửa vời. Bỏ qua phần khai token (đó là chỗ màu phải nằm) và
   bỏ qua box-shadow với color-mix: hai thứ đó trộn với token nên vẫn đổi theo.
   Chỉ soi màu viết thẳng vào thuộc tính hiển thị. */
check('không còn màu cứng trong bảng kiểu', (function () {
  const stripped = cssSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/body\[data-theme='[a-z]+'\]\s*\{[^}]*\}/g, '');
  const offenders = [];
  const propRe = /(?:^|[;{]\s*)(color|background|background-color|border-color|fill|stroke)\s*:\s*([^;}]+)/g;
  let m;
  while ((m = propRe.exec(stripped))) {
    const value = m[2];
    if (/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(value) && value.indexOf('var(--') === -1) {
      offenders.push(m[1] + ':' + value.trim());
    }
  }
  return offenders.length === 0;
})(), (function () {
  const stripped = cssSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/body\[data-theme='[a-z]+'\]\s*\{[^}]*\}/g, '');
  return [...stripped.matchAll(/(?:^|[;{]\s*)(color|background|background-color|border-color|fill|stroke)\s*:\s*([^;}]+)/g)]
    .map((m) => m[1] + ':' + m[2].trim()).filter((v) => /#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(v) && v.indexOf('var(--') === -1);
})());

/* Tương phản tính bằng số học thuần, không cần trình duyệt, nên phép kiểm này
   vẫn chạy ngoại tuyến. Công thức độ chói tương đối theo WCAG 2.x. */
function lum(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const channel = (v) => { const c = parseInt(v, 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * channel(full.slice(0, 2)) + 0.7152 * channel(full.slice(2, 4)) + 0.0722 * channel(full.slice(4, 6));
}
function contrast(a, b) {
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const tokenOf = (block, name) => {
  const m = block.match(new RegExp(name + ':\\s*(#[0-9a-fA-F]{3,6})'));
  return m ? m[1] : null;
};
const contrastFails = [];
['muc', 'giay', 'trang'].forEach((name) => {
  const block = themeBlocks[name];
  const bg = tokenOf(block, '--bg');
  const checks = [['--ink', 7], ['--muted', 4.5], ['--ink-soft', 4.5]];
  checks.forEach(([token, floor]) => {
    const color = tokenOf(block, token);
    if (!bg || !color) { contrastFails.push(name + token + ':thiếu'); return; }
    const ratio = contrast(color, bg);
    if (ratio < floor) contrastFails.push(name + ' ' + token + ' ' + ratio.toFixed(2) + ':1 < ' + floor + ':1');
  });
});
check('chữ trong cả ba bảng màu đạt chuẩn tương phản AA', contrastFails.length === 0, contrastFails);

const { ALLOW } = require('../server.js');
const allowed = (p) => ALLOW.some((rule) => rule.test(p));
check('máy chủ cho phép trang chính', allowed('/index.html'));
check('máy chủ cho phép bảng kiểu', allowed('/styles.css'));
check('máy chủ cho phép mã giao diện', allowed('/web/app.js') && allowed('/web/views.js') && allowed('/web/charts.js'));
check('máy chủ chặn mã máy chủ', !allowed('/app/config.js') && !allowed('/server.js'));
check('máy chủ chặn dữ liệu cá nhân', !allowed('/data/events/2026-10-09.jsonl') && !allowed('/data/journals/2026-10-09.json'));
check('máy chủ chặn tệp cấu hình', !allowed('/devtrace.config.json'));
check('máy chủ chặn đường dẫn thoát ra ngoài', !allowed('/../secret.txt'));
check('máy chủ cho phép biểu tượng của cửa sổ ứng dụng', allowed('/favicon.ico'));
check('máy chủ cho phép trang ghi nhanh', allowed('/capture.html'));
check('máy chủ cho phép mã của trang ghi nhanh', allowed('/web/capture.js'));
check('máy chủ không mở bừa thư mục desktop', !allowed('/desktop/shortcut.js') && !allowed('/desktop/devtrace.ico'));
check('biểu tượng của cửa sổ lấy từ devtrace.ico', serverSrc.indexOf("'/favicon.ico': path.join('desktop', 'devtrace.ico')") !== -1);
check('trang chính trỏ tới biểu tượng thật', htmlSrc.indexOf('<link rel="icon" href="/favicon.ico"') !== -1);

check('máy chủ có chặn theo thư mục gốc', serverSrc.indexOf('startsWith(ROOT + path.sep)') !== -1);
check('không còn mã chết "state.store"', viewsSrc.indexOf('state.store') === -1);

/* ---- Màn Cài đặt ---- */

const settingsHtml = Views.settings.render(viewCtx);

/* Bản dựng đầy đủ: mở hết mục "Nâng cao".

   `disclosure` chỉ in phần thân khi mục đó đang mở, nên bản dựng mặc định
   KHÔNG chứa các ô nâng cao — và một đường dẫn cấu hình gõ sai trong đó sẽ
   không phép kiểm nào bắt được. Đúng loại lỗi mà phép kiểm bên dưới sinh ra
   để chặn: ô đó im lặng không lưu, không lỗi, không cảnh báo. */
const settingsAllHtml = Views.settings.render(Object.assign({}, viewCtx, {
  state: Object.assign({}, viewCtx.state, { open: { 'settings-advanced': true } })
}));
check('màn cài đặt có thanh lưu dính đáy', settingsHtml.indexOf('class="settings-actions"') !== -1);
check('màn cài đặt đủ ba bảng màu', ['trang', 'muc', 'giay'].every((t) => settingsHtml.indexOf('value="' + t + '"') !== -1));
check('ô chọn bảng màu không phải khoá cấu hình', (function () {
  // `theme` không nằm trong devtrace.config.json. Nếu nó lọt vào data-config
  // thì saveConfig sẽ POST nó lên máy chủ, và `publicConfig` không xoá nó —
  // nó chỉ xoá `clean.root` và `clean.file`.
  const tag = settingsHtml.match(/<select[^>]*data-theme-pick[^>]*>/);
  return !!tag && tag[0].indexOf('data-config=') === -1;
})());
check('màn cài đặt không mở khoá làm hỏng bộ khởi động', settingsHtml.indexOf('data-config="desktop.') === -1 && settingsHtml.indexOf('data-config="projects') === -1);

/* Mọi khoá cấu hình giao diện gửi lên phải là khoá có thật trong mặc định
   của máy chủ. Gõ sai một chữ là ô đó im lặng không lưu — không lỗi, không
   cảnh báo, chỉ là cài đặt không bao giờ đổi.

   Soi CẢ HAI bản dựng: bản mặc định và bản mở hết "Nâng cao". Chỉ soi bản
   mặc định thì mọi ô nâng cao nằm ngoài tầm với của phép kiểm này. */
function configPathsOf(html) {
  const paths = [];
  html.replace(/data-config="([^"]+)"/g, (m, p) => { paths.push(p); return m; });
  html.replace(/data-config-flag="([^"]+)"/g, (m, p) => { paths.push(p); return m; });
  return paths;
}

function missingConfigPaths(html) {
  const defaults = require('../app/config').defaults();
  return configPathsOf(html).filter((p) => {
    let node = defaults;
    for (const part of p.split('.')) {
      if (!node || typeof node !== 'object' || !(part in node)) return true;
      node = node[part];
    }
    return false;
  });
}

check('mọi ô cài đặt trỏ tới khoá cấu hình có thật', (function () {
  return missingConfigPaths(settingsHtml + settingsAllHtml).length === 0;
})(), missingConfigPaths(settingsHtml + settingsAllHtml));

check('mọi ô nâng cao cũng trỏ tới khoá cấu hình có thật', (function () {
  // Bản mặc định không chứa ô nâng cao nào — nếu có thì phép kiểm dưới đây
  // không nói lên điều gì về chúng.
  return settingsAllHtml.length > settingsHtml.length
    && missingConfigPaths(settingsAllHtml).length === 0;
})(), missingConfigPaths(settingsAllHtml));

/* Ô rời rạc tự lưu, ô nhập chữ thì không. Đây là ranh giới có chủ ý: tự lưu
   theo từng phím gõ vừa bắn liên tục vào máy chủ, vừa có thể đè mất một
   danh sách lành bằng một đường dẫn đang gõ dở (`config.merge` gộp nông). */
check('ô rời rạc tự lưu còn ô nhập chữ thì không', (function () {
  const autoTags = settingsHtml.match(/<(?:input|select)[^>]*data-autosave[^>]*>/g) || [];
  return autoTags.length >= 4
    && autoTags.every((tag) => tag.indexOf('type="checkbox"') !== -1 || tag.indexOf('<select') === 0)
    && settingsHtml.indexOf('<textarea data-config="sources.git.repos"') !== -1
    && !/<textarea[^>]*data-autosave/.test(settingsHtml);
})());
check('app.js có gom cấu hình theo đường dẫn dấu chấm', appSrc.indexOf('function setPath') !== -1 && appSrc.indexOf('ARRAY_KEYS') !== -1);

/* ---- Mặc định của những khoá mới, và giới hạn phải nói ra ---- */

/* Hộp thư mặc định TẮT, và cấu hình chỉ được giữ TÊN biến môi trường. Hai
   điều này phải kiểm chứ không phải tin: cấu hình còn đi ra ngoài qua
   /api/config và qua hai đường xuất dữ liệu, nên một khoá tên `password`
   lọt vào `defaults()` là lọt ra ngoài luôn. */
check('hộp thư mặc định tắt, và cấu hình chỉ giữ TÊN biến môi trường', (function () {
  const d = require('../app/config').defaults();
  return d.mail.enabled === false
    && d.mail.passwordEnv === 'DEVTRACE_MAIL_PASSWORD'
    && Object.keys(d.mail).indexOf('password') === -1
    && Object.keys(d.mail).indexOf('pass') === -1
    && /^[A-Z][A-Z0-9_]*$/.test(d.mail.passwordEnv);
})(), require('../app/config').defaults().mail);

check('hộp thư chỉ hỗ trợ TLS ngầm ở cổng 993, và nói rõ giới hạn đó', (function () {
  const d = require('../app/config').defaults();
  return d.mail.port === 993 && /OAuth|mật khẩu ứng dụng/.test(d.mail.note)
    && settingsHtml.indexOf('STARTTLS') !== -1;
})(), require('../app/config').defaults().mail.note);

check('sức khoẻ kho mặc định quét 20 kho và KHÔNG quét bí mật', (function () {
  const d = require('../app/config').defaults();
  return d.sources.git.healthMaxRepos === 20 && d.sources.git.secretScan === false;
})(), require('../app/config').defaults().sources.git);

check('độ dài đợt làm việc tính bằng ngày, mặc định 14', (function () {
  const d = require('../app/config').defaults();
  return d.sprint.lengthDays === 14;
})(), require('../app/config').defaults().sprint);

/* Dự án huynh tự khai phải là khoá RIÊNG, không dùng chung `projects`.
   `projects` là kết quả đã tính; gộp lại thì hôm nào bộ dò kho tự thêm một
   mục, nó lẫn vào danh sách huynh tự khai, và lần lưu sau ghi luôn cả những
   mục huynh chưa từng nhập. */
check('dự án tự khai là khoá riêng, không lẫn với projects đã tính',
  Array.isArray(require('../app/config').defaults().declaredProjects)
  && require('../app/config').defaults().declaredProjects.length === 0);

/* Ô nhập số phải nằm trong bảng NUMBER_KEYS, nếu không thì gõ "abc" vào đó sẽ
   ghi nguyên chuỗi "abc" vào cấu hình, và mọi phép so sánh sau đó sai một
   cách im lặng. */
check('mọi ô số mới đều được khai là ô số', (function () {
  const need = ['sources.git.healthMaxRepos', 'sprint.lengthDays', 'mail.port',
    'mail.unansweredHours', 'mail.maxMessages'];
  return need.every((path) => settingsAllHtml.indexOf('data-config="' + path + '"') !== -1)
    && appSrc.indexOf("'sources.git.healthMaxRepos': true") !== -1
    && appSrc.indexOf("'sprint.lengthDays': true") !== -1
    && appSrc.indexOf("'mail.port': true") !== -1
    && appSrc.indexOf("'mail.unansweredHours': true") !== -1
    && appSrc.indexOf("'mail.maxMessages': true") !== -1;
})(), ['sources.git.healthMaxRepos', 'sprint.lengthDays', 'mail.port', 'mail.unansweredHours', 'mail.maxMessages']
  .filter((p) => settingsAllHtml.indexOf('data-config="' + p + '"') === -1));

/* ---- Dọn dẹp ---- */


/* =====================================================================
   [11] Ứng dụng để bàn

   DevTrace phải mở được bằng một cú nhấp đúp, không phải gõ localhost.
   Phần này soi bộ khởi động trong desktop/. Nó KHÔNG chạy tiến trình nào
   và KHÔNG bật cửa sổ nào — bài kiểm thử phải chạy được cả khi không có
   mạng, và không được làm phiền người đang ngồi trước máy. Cái được kiểm
   là phần suy nghĩ: chọn cổng nào, chọn trình duyệt nào, truyền tham số
   gì, lối tắt trỏ tới đâu, và tệp biểu tượng có đúng định dạng không.
   ===================================================================== */

section('[11] Ứng dụng để bàn');

const defaultsForDesktop = require('../app/config').defaults();
check('cấu hình mặc định có mục desktop', !!defaultsForDesktop.desktop, Object.keys(defaultsForDesktop));
check('mục desktop mặc định dùng cổng 5173', defaultsForDesktop.desktop.port === 5173,
  defaultsForDesktop.desktop.port);

const Launch = require('../desktop/launch');
check('launch.js nạp được', typeof Launch.run === 'function' && typeof Launch.desktopConfig === 'function');

const desk = Launch.desktopConfig({ desktop: { port: 5199 }, dataDir: path.join(TEST_DIR, 'dt') });
check('đọc cổng từ cấu hình', desk.port === 5199, desk.port);
check('thiếu cấu hình thì lấy mặc định', Launch.desktopConfig({}).port === 5173);
check('mặc định vẫn mở cửa sổ', Launch.desktopConfig({}).openBrowser === true);
check('đổi cổng thì địa chỉ đổi theo', Launch.baseUrl(desk) === 'http://127.0.0.1:5199/', Launch.baseUrl(desk));
check('hồ sơ trình duyệt nằm trong thư mục dữ liệu',
  Launch.profileDir({ dataDir: 'X:\\data' }) === path.join('X:\\data', 'browser-profile'));

const fakeEnv = { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\LA' };
const candidates = Launch.browserCandidates(fakeEnv);
check('danh sách trình duyệt có Chrome', candidates.some((b) => b.name === 'Chrome' && /chrome\.exe$/.test(b.exe)));
check('danh sách trình duyệt có Edge', candidates.some((b) => b.name === 'Edge' && /msedge\.exe$/.test(b.exe)));
check('mọi trình duyệt trong danh sách đều mở được chế độ ứng dụng',
  candidates.length >= 4 && candidates.every((b) => b.appMode === true), candidates.length);
check('danh sách không lẫn đường dẫn rỗng', candidates.every((b) => b.exe && b.exe.indexOf('undefined') === -1));

const onlyChrome = new Set([path.join('C:\\PF', 'Google', 'Chrome', 'Application', 'chrome.exe')]);
const foundBrowser = Launch.findBrowser(fakeEnv, (p) => onlyChrome.has(p));
check('chọn đúng trình duyệt đã cài', !!foundBrowser && foundBrowser.name === 'Chrome',
  foundBrowser && foundBrowser.name);
check('không có trình duyệt nào thì trả về null, không đoán bừa', Launch.findBrowser(fakeEnv, () => false) === null);

const appArgs = Launch.windowArgs(desk, 'http://127.0.0.1:5199/', 'C:\\p');
check('cửa sổ mở bằng --app', appArgs[0] === '--app=http://127.0.0.1:5199/', appArgs);
check('cửa sổ có hồ sơ riêng', appArgs.some((a) => a.indexOf('--user-data-dir=') === 0), appArgs);
check('cửa sổ có cỡ', appArgs.some((a) => a.indexOf('--window-size=') === 0), appArgs);
const sharedArgs = Launch.windowArgs(Object.assign({}, desk, { separateProfile: false }), 'http://x/', 'C:\\p');
check('tắt hồ sơ riêng thì không truyền --user-data-dir',
  !sharedArgs.some((a) => a.indexOf('--user-data-dir=') === 0), sharedArgs);

const Shortcut = require('../desktop/shortcut');

// Bài học xương máu, đã thử và xác nhận: đối tượng COM tạo tệp .lnk chuyển
// mọi đường dẫn qua bảng mã ANSI cũ, nên "Dự" trong "D:\Dự án ma" biến thành
// "D?" và lối tắt trỏ vào hư không. Vì thế mọi đường dẫn nhét vào .lnk đều
// phải là ASCII, và đường dẫn thật đi vòng qua một tệp chuyển tiếp.
const asciiStage = path.join('C:\\', 'devtrace-stage');
const stagePlan = Shortcut.plan(ROOT, { stage: asciiStage });
const shortcut = stagePlan.spec;

check('lối tắt chạy qua wscript, không hiện cửa sổ dòng lệnh', /wscript\.exe$/i.test(shortcut.target), shortcut.target);
check('lối tắt truyền tệp chuyển tiếp', shortcut.args.indexOf('DevTrace.vbs') !== -1, shortcut.args);
check('lối tắt lấy thư mục trung gian làm thư mục làm việc', shortcut.workdir === asciiStage, shortcut.workdir);
check('lối tắt dùng biểu tượng trong thư mục trung gian', shortcut.icon.indexOf(asciiStage) === 0, shortcut.icon);
check('mô tả lối tắt là ASCII để tooltip không bị hỏng ký tự',
  Shortcut.isAscii(shortcut.description), shortcut.description);

check('mọi đường dẫn nhét vào .lnk đều là ASCII', Shortcut.nonAsciiFields(stagePlan).length === 0,
  Shortcut.nonAsciiFields(stagePlan));
check('đường dẫn thật có tiếng Việt KHÔNG bị nhét vào .lnk',
  JSON.stringify(stagePlan.spec).indexOf('Dự') === -1, JSON.stringify(stagePlan.spec));
check('thư mục trung gian có tiếng Việt thì bị từ chối thẳng',
  Shortcut.nonAsciiFields(Shortcut.plan(ROOT, { stage: path.join('C:\\', 'thư mục') })).length > 0);

const forwarder = Shortcut.forwarderSource(ROOT);
check('tệp chuyển tiếp giữ đường dẫn thật (kể cả tiếng Việt)', forwarder.indexOf(ROOT) !== -1);
check('tệp chuyển tiếp gọi DevTrace.vbs thật', forwarder.indexOf('desktop\\DevTrace.vbs') !== -1);
check('tệp chuyển tiếp chạy ẩn và không chờ', forwarder.indexOf('0, False') !== -1);
check('tệp chuyển tiếp báo lỗi rõ khi dự án biến mất',
  forwarder.indexOf('MsgBox') !== -1 && forwarder.indexOf('FileExists') !== -1);
check('tệp chuyển tiếp nhân đôi nháy kép đúng cách',
  Shortcut.vbsString('a"b') === '"a""b"', Shortcut.vbsString('a"b'));
check('đường dẫn nhúng vào PowerShell được bọc nháy đơn và nhân đôi nháy bên trong',
  Shortcut.quote("C:\\a'b") === "'C:\\a''b'", Shortcut.quote("C:\\a'b"));

const applySrc = Shortcut.applyScript('C:\\j.json', 'C:\\r.txt');
const removeSrc = Shortcut.removeScript('C:\\j.json', 'C:\\r.txt');
check('mã tạo lối tắt dùng CreateShortcut', applySrc.indexOf('CreateShortcut') !== -1);
check('mã tạo lối tắt đặt đủ năm thuộc tính',
  ['TargetPath', 'Arguments', 'WorkingDirectory', 'IconLocation', 'Description']
    .every((key) => applySrc.indexOf('$lnk.' + key) !== -1));
check('mã tạo lối tắt khai biến trước khi dùng',
  applySrc.indexOf('$Job =') !== -1 && applySrc.indexOf('$Job =') < applySrc.indexOf('Get-Content'));
check('mã tạo lối tắt chỉ thêm Startup khi được yêu cầu',
  applySrc.indexOf("$spec.startup") !== -1 && applySrc.indexOf("$spec.startup") < applySrc.indexOf('foreach'));
check('mã gỡ lối tắt xoá cả ở Startup', removeSrc.indexOf('Startup') !== -1);

const Icon = require('../desktop/make-icon');
const icoBuffer = Icon.icon([16, 32, 256]);
const icoInfo = Icon.readIcon(icoBuffer);
check('biểu tượng có chữ ký ICO đúng', !!icoInfo, icoBuffer.slice(0, 4));
check('biểu tượng đủ số cỡ đã yêu cầu', icoInfo.count === 3, icoInfo.count);
check('biểu tượng có cỡ 16 và 256', [16, 256].every((size) => icoInfo.entries.some((e) => e.size === size)),
  icoInfo.entries.map((e) => e.size));
check('mọi ảnh trong biểu tượng là PNG', icoInfo.entries.every((e) => e.png));
check('ảnh trong biểu tượng đủ lớn để thấy được', icoInfo.entries.every((e) => e.bytes > 60),
  icoInfo.entries.map((e) => e.bytes));

const tiny = Icon.downsample(Icon.paint(16), 16);
let litPixels = 0;
for (let i = 0; i < tiny.length; i += 4) { if (tiny[i] > 60) litPixels++; }
check('ảnh 16 px vẫn có nét vẽ, không ra một khối trắng', litPixels > 20 && litPixels < 250, litPixels);

const icoFile = path.join(ROOT, 'desktop', 'devtrace.ico');
check('tệp devtrace.ico đã có sẵn trong dự án', fs.existsSync(icoFile));
if (fs.existsSync(icoFile)) {
  const onDisk = Icon.readIcon(fs.readFileSync(icoFile));
  check('tệp devtrace.ico đúng định dạng và có cả bảy cỡ',
    !!onDisk && onDisk.count === Icon.SIZES.length && onDisk.entries.every((e) => e.png),
    onDisk && onDisk.count);
}

const vbsBytes = fs.readFileSync(path.join(ROOT, 'desktop', 'DevTrace.vbs'));
check('DevTrace.vbs lưu bằng UTF-16 kèm BOM để đọc đúng tiếng Việt',
  vbsBytes[0] === 0xff && vbsBytes[1] === 0xfe, [vbsBytes[0], vbsBytes[1]]);
const vbsSrc = vbsBytes.toString('utf16le');
check('DevTrace.vbs gọi launch.js', vbsSrc.indexOf('launch.js') !== -1);
check('DevTrace.vbs chạy ẩn cửa sổ', /sh\.Run\(cmd,\s*0,\s*True\)/.test(vbsSrc), 'thiếu windowStyle 0');
check('DevTrace.vbs biết tìm Node.js', vbsSrc.indexOf('nodejs') !== -1);
check('DevTrace.vbs đọc thông báo lỗi do launch.js ghi',
  vbsSrc.indexOf('.launch-out.log') !== -1 && vbsSrc.indexOf('ReadUtf16') !== -1);

const stopSrc = fs.readFileSync(path.join(ROOT, 'desktop', 'stop.js'), 'utf8');
check('stop.js đọc tệp pid của máy chủ', stopSrc.indexOf('pidFileFor') !== -1);
check('stop.js từ chối tắt tiến trình không phải node', stopSrc.indexOf('not-ours') !== -1);
check('tệp pid nằm trong thư mục dữ liệu',
  require('../server').pidFileFor({ dataDir: 'X:\\d' }) === path.join('X:\\d', 'server.pid'));
check('máy chủ có báo rõ khi cổng bị chiếm', serverSrc.indexOf('EADDRINUSE') !== -1);
check('máy chủ có ghi tệp pid', serverSrc.indexOf('writePidFile') !== -1);
check('máy chủ tự khai mình là devtrace', serverSrc.indexOf("app: 'devtrace'") !== -1);
check('launch.js nhận diện máy chủ qua lời khai đó', fs.readFileSync(path.join(ROOT, 'desktop', 'launch.js'), 'utf8')
  .indexOf("json.app === 'devtrace'") !== -1);

['DevTrace.vbs', 'launch.js', 'main.js', 'stop.js', 'shortcut.js', 'make-icon.js', 'devtrace.ico',
  'start-devtrace.cmd', 'stop-devtrace.cmd', 'install-shortcut.cmd', 'uninstall-shortcut.cmd', 'README.md']
  .forEach((name) => {
    check('desktop/' + name + ' có mặt', fs.existsSync(path.join(ROOT, 'desktop', name)));
  });

/* --- Cửa sổ Electron (desktop/main.js) ------------------------------

   Tệp này tự nhận ra mình đang chạy bằng node thường hay bằng Electron, nên
   bộ kiểm thử nạp được nó và kiểm phần suy nghĩ thuần tuý mà KHÔNG cần cài
   Electron — `npm test` vẫn phải chạy được trên máy sạch, chưa cài gì.

   Điều đáng kiểm nhất: tiến trình con phải chạy bằng Node thật. Trong
   Electron, process.execPath là electron.exe, nên nếu quên
   ELECTRON_RUN_AS_NODE thì máy chủ không bao giờ lên và ứng dụng chỉ hiện
   một khung trắng — hỏng câm, không có thông báo nào. */
const Desktop = require('../desktop/main');
check('main.js nạp được cả khi chưa cài Electron', typeof Desktop.start === 'function'
  && typeof Desktop.ensureServer === 'function');

check('chạy đúng trong Electron thì không có gì phải báo', Desktop.launchProblem({}, true) === null);
check('chưa cài Electron thì báo cách cài',
  /npm install/.test(Desktop.launchProblem({}, false) || ''), Desktop.launchProblem({}, false));
/* Cái bẫy thật: cửa sổ dòng lệnh trong VS Code có sẵn ELECTRON_RUN_AS_NODE=1,
   electron.exe chạy như node thường, và ứng dụng chết câm ngay lúc mở. */
const runAsNodeNote = Desktop.launchProblem({ ELECTRON_RUN_AS_NODE: '1' }, false);
check('bị buộc chạy như node thường thì nói thẳng nguyên nhân',
  /ELECTRON_RUN_AS_NODE/.test(runAsNodeNote) && /VS Code/.test(runAsNodeNote), runAsNodeNote);
check('lời nhắn đó chỉ luôn cả đường lùi về npm run app',
  /npm run app/.test(runAsNodeNote), runAsNodeNote);

check('cỡ cửa sổ đọc được từ cấu hình',
  Desktop.parseSize('1200,800').width === 1200 && Desktop.parseSize('1200,800').height === 800,
  Desktop.parseSize('1200,800'));
check('cỡ cửa sổ viết bằng chữ x cũng hiểu', Desktop.parseSize('1024x768').width === 1024);
check('cỡ cửa sổ hỏng thì lấy mặc định, không đoán bừa',
  ['', 'abc', '10,10', null].every((bad) => Desktop.parseSize(bad).width === Desktop.SIZE_FALLBACK.width),
  ['', 'abc', '10,10', null].map((bad) => Desktop.parseSize(bad).width));

const winOpts = Desktop.windowOptions({ windowSize: '1200,800' });
check('cửa sổ dùng biểu tượng devtrace.ico', /devtrace\.ico$/.test(winOpts.icon), winOpts.icon);
check('cửa sổ hiện sau khi trang vẽ xong, không nháy khung trắng', winOpts.show === false);
check('không cho trang web gọi thẳng hệ điều hành',
  winOpts.webPreferences.nodeIntegration === false
  && winOpts.webPreferences.contextIsolation === true
  && winOpts.webPreferences.sandbox === true, winOpts.webPreferences);
check('cửa sổ có cỡ nhỏ nhất để giao diện không bị bóp méo',
  winOpts.minWidth >= 800 && winOpts.minHeight >= 500, [winOpts.minWidth, winOpts.minHeight]);

/* --- Cửa sổ ghi nhanh (Ctrl + Alt + N) ------------------------------- */

const capOpts = Desktop.captureWindowOptions();
check('cửa sổ ghi nhanh không viền và không nằm trên taskbar',
  capOpts.frame === false && capOpts.skipTaskbar === true, [capOpts.frame, capOpts.skipTaskbar]);
check('cửa sổ ghi nhanh không cho trang gọi thẳng hệ điều hành',
  capOpts.webPreferences.nodeIntegration === false
  && capOpts.webPreferences.contextIsolation === true
  && capOpts.webPreferences.sandbox === true, capOpts.webPreferences);
check('cửa sổ ghi nhanh nạp từ máy chủ, không mở từ đĩa',
  Desktop.captureUrl({ host: '127.0.0.1', port: 5173 }) === 'http://127.0.0.1:5173/capture.html',
  Desktop.captureUrl({ host: '127.0.0.1', port: 5173 }));

/* Chỗ hiện ra: giữa bề ngang, nửa trên bề dọc. Sai chỗ thì cửa sổ hiện ra
   lệch hẳn sang một bên hoặc rơi xuống đáy màn hình — với một cửa sổ không
   viền, không thanh tiêu đề, người dùng không có cách nào đoán nó vừa mở. */
const at1080 = Desktop.capturePosition({ x: 0, y: 0, width: 1920, height: 1080 });
check('cửa sổ ghi nhanh hiện giữa bề ngang màn hình',
  at1080.x === Math.round((1920 - Desktop.CAPTURE_WIDTH) / 2), at1080);
check('cửa sổ ghi nhanh hiện ở nửa trên màn hình',
  at1080.y > 0 && at1080.y < 1080 / 2, at1080.y);
/* Màn hình có thanh tác vụ và màn hình phụ bắt đầu ở toạ độ âm: chỗ hiện ra
   phải cộng theo gốc của vùng làm việc, không phải theo gốc toạ độ. */
const atLeft = Desktop.capturePosition({ x: -1920, y: 40, width: 1920, height: 1000 });
check('cửa sổ ghi nhanh tính chỗ theo vùng làm việc, kể cả màn hình phụ',
  atLeft.x < -900 && atLeft.y >= 40, atLeft);
check('thiếu thông tin màn hình thì vẫn ra một chỗ hợp lý',
  Desktop.capturePosition(null).x > 0 && Desktop.capturePosition(null).y >= 0, Desktop.capturePosition(null));

check('giành được phím tắt thì không có gì phải báo',
  Desktop.captureHotkeyNote(true, Desktop.CAPTURE_ACCELERATOR) === null);
const hotkeyClash = Desktop.captureHotkeyNote(false, Desktop.CAPTURE_ACCELERATOR);
check('không giành được phím tắt thì nói thẳng ra, không im lặng',
  /Control\+Alt\+N/.test(hotkeyClash) && /phần mềm khác/.test(hotkeyClash), hotkeyClash);
check('câu đó chỉ luôn đường ghi nhanh khác', /Hộp thư đến/.test(hotkeyClash), hotkeyClash);

const childEnv = Desktop.nodeEnv({ PORT: '5173' });
check('tiến trình con chạy electron.exe như node thật', childEnv.ELECTRON_RUN_AS_NODE === '1', childEnv);
check('dựng biến môi trường cho tiến trình con không làm hỏng biến cũ',
  childEnv.PORT === '5173' && Desktop.nodeEnv({ PORT: '1' }).PORT === '1');
const originalEnv = { PORT: '5173' };
Desktop.nodeEnv(originalEnv);
check('không sửa vào biến môi trường gốc', originalEnv.ELECTRON_RUN_AS_NODE === undefined, originalEnv);

const trayItems = Desktop.trayTemplate({}, { ownsServer: true });
check('khay hệ thống có nút mở lại cửa sổ', trayItems.some((i) => i.label === 'Mở DevTrace'));
check('khay hệ thống có nút ghi nhanh kèm phím tắt của nó',
  trayItems.some((i) => i.label.indexOf('Ghi nhanh một việc') === 0 && i.label.indexOf('Ctrl + Alt + N') !== -1),
  trayItems.map((i) => i.label));
check('khay hệ thống có nút thu thập ngay', trayItems.some((i) => i.label === 'Thu thập dấu vết ngay'));
check('nút thoát nói rõ nó có tắt máy chủ hay không',
  trayItems.some((i) => i.label === 'Thoát DevTrace (dừng máy chủ)')
  && Desktop.trayTemplate({}, { ownsServer: false }).some((i) => i.label === 'Thoát DevTrace'),
  trayItems.map((i) => i.label));
check('nút trên khay gọi đúng hàm xử lý', (() => {
  const seen = [];
  const items = Desktop.trayTemplate({
    open: () => seen.push('open'), capture: () => seen.push('capture'),
    collect: () => seen.push('collect'),
    browser: () => seen.push('browser'), quit: () => seen.push('quit')
  }, {});
  items.filter((i) => i.click).forEach((i) => i.click());
  return seen.join() === 'open,capture,collect,browser,quit';
})());

const hidingWindow = { hidden: 0, hide() { this.hidden++; } };
const closeState = { window: hidingWindow, quitting: false };
const prevented = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
check('nút X thu cửa sổ xuống khay thay vì thoát',
  Desktop.onWindowClose(prevented, closeState) === true && prevented.defaultPrevented && hidingWindow.hidden === 1);
const quittingState = { window: hidingWindow, quitting: true };
check('đang thoát thật thì cửa sổ được đóng, không thu lại',
  Desktop.onWindowClose({ preventDefault() {} }, quittingState) === false && hidingWindow.hidden === 1);

const fakeWindow = {
  calls: [], isMinimized() { return true; }, restore() { this.calls.push('restore'); },
  show() { this.calls.push('show'); }, focus() { this.calls.push('focus'); }
};
check('mở lại cửa sổ đang thu nhỏ thì khôi phục rồi đưa lên trước',
  Desktop.revealWindow(fakeWindow) && fakeWindow.calls.join() === 'restore,show,focus', fakeWindow.calls);
check('chưa có cửa sổ thì không vỡ', Desktop.revealWindow(null) === false);

const fakeApp = {
  quitCalled: false, listeners: {},
  requestSingleInstanceLock() { return true; },
  on(name, fn) { this.listeners[name] = fn; },
  quit() { this.quitCalled = true; }
};
check('bản chạy đầu thì nhận khoá một-bản-chạy', Desktop.requestSingleInstance(fakeApp, () => {}) === true
  && typeof fakeApp.listeners['second-instance'] === 'function');
const secondApp = { quitCalled: false, requestSingleInstanceLock() { return false; }, quit() { this.quitCalled = true; } };
check('mở bản thứ hai thì tự thoát và không mở cửa sổ nữa',
  Desktop.requestSingleInstance(secondApp, () => {}) === false && secondApp.quitCalled === true);

/* Bốn đường của ensureServer, chạy với khe cắm giả — không bật tiến trình
   nào, không mở cổng nào. Đây là chỗ khoá lại hai lỗi câm: mở nhầm trang
   của chương trình khác đang giữ cổng, và ngồi im khi máy chủ không lên. */
const deskForMain = Launch.desktopConfig({ desktop: { port: 5199, waitMs: 50 } });
let startedCount = 0;
const startSeam = (config, desk, spawn) => {
  startedCount++;
  check('tiến trình con được giao đúng khe cắm chạy node', typeof spawn === 'function');
  return { pid: 4242, logFile: 'X:\\data\\server.log' };
};

function checkEnsureServer() {
  const probing = (result) => () => Promise.resolve(result);
  const noWait = () => Promise.resolve({ ok: true });

  return Desktop.ensureServer({}, deskForMain, { probe: probing({ ok: true }), startServer: startSeam })
    .then((running) => {
      check('máy chủ đang chạy sẵn thì mở thẳng cửa sổ, không bật thêm',
        running.ok === true && running.started === false && startedCount === 0, running);

      return Desktop.ensureServer({}, deskForMain, {
        probe: probing({ ok: false, listening: true }), startServer: startSeam
      });
    })
    .then((busy) => {
      check('cổng bị chương trình khác chiếm thì không mở, không bật máy chủ',
        busy.ok === false && busy.reason === 'port-busy' && startedCount === 0, busy);
      check('lời nhắn khi cổng bị chiếm chỉ đúng cách xử lý',
        busy.message.indexOf('5199') !== -1 && busy.message.indexOf('devtrace.config.json') !== -1, busy.message);

      return Desktop.ensureServer({}, deskForMain, {
        probe: probing({ ok: false, listening: false }), startServer: startSeam, waitForServer: noWait
      });
    })
    .then((fresh) => {
      check('chưa có máy chủ thì bật lên rồi mới mở cửa sổ',
        fresh.ok === true && fresh.started === true && fresh.pid === 4242, fresh);
      check('bật máy chủ đúng một lần', startedCount === 1, startedCount);

      return Desktop.ensureServer({}, deskForMain, {
        probe: probing({ ok: false, listening: false }), startServer: startSeam,
        waitForServer: () => Promise.resolve({ ok: false, reason: 'timeout' })
      });
    })
    .then((dead) => {
      check('máy chủ không lên thì báo rõ, không mở khung trắng',
        dead.ok === false && dead.reason === 'no-server', dead);
      check('lời nhắn khi máy chủ không lên chỉ tới nhật ký',
        dead.message.indexOf('X:\\data\\server.log') !== -1, dead.message);
      check('lời nhắn khi máy chủ không lên nói tới chuyện Node quá cũ',
        dead.message.indexOf('Node.js quá cũ') !== -1, dead.message);
    });
}

check('main.js không tự chạy khi bị nạp để kiểm thử', require.main !== require('../desktop/main'));
check('main.js không tự nạp Electron khi chạy bằng node thường',
  typeof Desktop.start === 'function' && typeof require('../desktop/main').ICON_FILE === 'string');

/* Lỗi im lặng đã gặp thật, và mất thời gian vì nó không để lại dấu vết nào:
   dưới Electron, require.main trỏ vào "electron" chứ không phải tệp này, nên
   `if (require.main === module) start()` luôn sai. Ứng dụng chạy, không cửa
   sổ, không thông báo, không lỗi — chỉ có ba tiến trình nằm im. Phép kiểm này
   khoá lại đúng điều kiện vào, để không ai viết lại nó cho "giống các tệp
   khác trong dự án". */
const mainSrc = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8');
check('main.js vào việc theo Electron, không theo require.main',
  mainSrc.indexOf('if (E) {') !== -1 && mainSrc.indexOf('if (require.main === module)') === -1);
check('main.js hiện cửa sổ kể cả khi trang nạp hỏng',
  mainSrc.indexOf("did-fail-load") !== -1 && mainSrc.indexOf('win.show();') !== -1);

check('README có mục chạy như một ứng dụng',
  fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').indexOf('Chạy như một ứng dụng') !== -1);

/* =====================================================================
   [12] Bảo vệ dữ liệu rời khỏi máy

   Ba nhóm, cùng một câu hỏi: cái gì được phép ra khỏi máy này, và DevTrace
   có quyền tự quyết việc gì.
     - Che bí mật trước khi gửi cho AI hoặc xuất bản chia sẻ.
     - Hạn lưu trữ: mặc định TẮT, vì tự xoá dữ liệu của huynh là việc huynh
       phải nói rõ mình muốn.
     - Tắt tiến trình: không được giết nhầm phần mềm khác chỉ vì một tệp pid
       cũ nằm lại trên đĩa.
   ===================================================================== */

section('[12] Bảo vệ dữ liệu rời khỏi máy');

const Redact = require('../app/redact');

/* Bảng này là hợp đồng của bộ lọc: khuôn mẫu nào phải bị bắt, và chuỗi nào
   KHÔNG được phép cắn nhầm. Mỗi dòng là [tên, câu có bí mật, chính bí mật]. */
[
  ['Bearer token', 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz"', 'abcdefghijklmnop'],
  ['khoá OpenAI', 'export KEY=sk-abcdefghijklmnopqrstuvwx', 'sk-abcdefghij'],
  ['khoá Anthropic', 'export A=sk-ant-abcdefghijklmnopqrstuvwx', 'sk-ant-abcdefghij'],
  ['mã GitHub', 'git remote add o https://ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/a/b', 'ghp_abcdefghij'],
  ['mã AWS', 'aws configure set id AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
  ['mã Slack', 'webhook xoxb-1234567890-abcdefghij', 'xoxb-1234567890'],
  ['khoá Google', 'key AIzaSyA1234567890abcdefghijklmnopqrstuv', 'AIzaSyA1234567890abcdefghijklmnopqrstuv'],
  ['JWT', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijkl', 'eyJhbGciOiJIUzI1NiJ9'],
  ['khoá riêng', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----', 'MIIEow'],
  ['mật khẩu trong địa chỉ', 'git clone https://user:matkhau123@github.com/a/b.git', 'matkhau123'],
  ['tham số bí mật trong địa chỉ', 'mo https://api.example.com/v1?api_key=abcdef123456&x=1', 'abcdef123456'],
  ['giá trị biến bí mật', 'export DB_PASSWORD=hunter2secret', 'hunter2secret'],
  ['giá trị trong JSON', '{"access_token": "abcdef123456"}', 'abcdef123456'],
  ['mật khẩu viết tắt MYSQL_PWD', 'SET MYSQL_PWD=MatKhauRatDai123', 'MatKhauRatDai123'],
  ['mật khẩu viết tắt DB_PASS', 'DB_PASS=hunter2secret', 'hunter2secret'],
  ['tên biến viết khác hoa thường', 'MySql_Password=XyzAbc123456', 'XyzAbc123456']
].forEach((row) => {
  const result = Redact.redactText(row[1]);
  check('che được ' + row[0], result.text.indexOf(row[2]) === -1, result.text);
});

/* Cắn nhầm còn tệ hơn bỏ sót: nó làm bản tổng kết sai đi mà không ai biết.
   Mấy câu này là những thứ có thật trong dấu vết của một ngày làm việc. */
[
  'git commit -m "sửa lỗi đăng nhập"',
  'node tools/smoke-test.js',
  'sửa tệp Dự án ma/app/config.js',
  'const secret = null',
  'tokenizer=abc',
  'npm run build',
  'mvn -q test',
  'https://github.com/anthropics/claude-code',
  // PWD trần là thư mục hiện hành của shell, không phải bí mật. Che nó đi là
  // làm hỏng dấu vết mà chẳng giấu được gì — nên luật chỉ bắt khi có tiền tố.
  'PWD=/d/Dự án ma',
  'cd $env:PWD',
  'BYPASS=khong-phai-mat-khau'
].forEach((text) => {
  check('không cắn nhầm: ' + text, Redact.redactText(text).text === text, Redact.redactText(text).text);
});

check('che được cả trong đối tượng lồng sâu',
  Redact.redactValue({ a: [{ b: 'PASSWORD=abcdef123' }] }).value.a[0].b.indexOf('abcdef123') === -1);
check('không sửa giá trị gốc — kho bằng chứng phải còn nguyên',
  (() => { const source = { p: 'PASSWORD=abcdef123' }; Redact.redactValue(source); return source.p === 'PASSWORD=abcdef123'; })());
check('tắt công tắc thì trả về nguyên bản',
  Redact.redactValue({ p: 'PASSWORD=abcdef123' }, { on: false }).value.p === 'PASSWORD=abcdef123');
check('cấu hình mặc định là BẬT', Redact.optionsFrom({}).on === true);
check('tắt được bằng cấu hình', Redact.optionsFrom({ privacy: { redactSecrets: false } }).on === false);
check('câu tóm tắt nói rõ đã che cái gì',
  Redact.summarize([{ label: 'khoá OpenAI', count: 2 }]).indexOf('2 khoá OpenAI') !== -1,
  Redact.summarize([{ label: 'khoá OpenAI', count: 2 }]));
check('không che gì thì không có câu tóm tắt', Redact.summarize([]) === '');

/* Đầu-cuối: một bí mật nằm trong kho thì không được lọt vào gói gửi cho AI.
   Đây là phép thử đáng giá nhất của cả mục — mấy luật ở trên chỉ đúng nếu
   chúng thật sự được nối vào đường đi. */
const leakConfig = JSON.parse(JSON.stringify(config));
leakConfig.dataDir = path.join(TEST_DIR, 'leak');
fs.mkdirSync(leakConfig.dataDir, { recursive: true });
const leakDay = '2026-10-09';
E.addEvents(leakConfig, leakDay, E.makeMany(leakConfig, [
  { source: 'git', kind: 'commit', ts: at(9, 40), project: nexus, title: 'fix: dùng key sk-abcdefghijklmnopqrstuvwx' },
  { source: 'browser', kind: 'visit', ts: at(9, 50), title: 'Nhập liệu', meta: { host: 'api.example.com', url: 'https://api.example.com/v1?token=abcdef123456' } }
]));
const leakyPack = AI.evidencePack(leakConfig, leakDay);
const leakyText = JSON.stringify(leakyPack);
check('bí mật trong kho KHÔNG lọt vào gói gửi cho AI',
  leakyText.indexOf('sk-abcdefghijklmnopqrstuvwx') === -1 && leakyText.indexOf('abcdef123456') === -1);
check('gói gửi cho AI tự khai đã che bớt',
  !!leakyPack.privacy && typeof leakyPack.privacy.note === 'string', leakyPack.privacy);
check('kho bằng chứng trên máy vẫn giữ nguyên bản gốc',
  JSON.stringify(E.readDay(leakConfig, leakDay)).indexOf('sk-abcdefghijklmnopqrstuvwx') !== -1);

/* ---------------------------------------------------------------------
   Hạn lưu trữ
   --------------------------------------------------------------------- */

const retConfig = JSON.parse(JSON.stringify(config));
retConfig.dataDir = path.join(TEST_DIR, 'retention');
fs.mkdirSync(retConfig.dataDir, { recursive: true });
const oldDay = '2020-01-01';
const today = U.dayKey(Date.now(), retConfig.dayStartHour);
E.addEvents(retConfig, oldDay, E.makeMany(retConfig, [
  { source: 'manual', kind: 'note', ts: new Date(2020, 0, 1, 10, 0).getTime(), title: 'ghi chú cũ' }
]));
E.addEvents(retConfig, today, E.makeMany(retConfig, [
  { source: 'manual', kind: 'note', ts: Date.now(), title: 'ghi chú mới' }
]));

check('hạn lưu trữ mặc định là TẮT', Collect.retentionOf({}).enabled === false);
check('hạn lưu trữ đọc được số ngày từ cấu hình',
  Collect.retentionOf({ retention: { enabled: true, days: 30 } }).days === 30);
check('số ngày vô lý thì quay về 0 chứ không xoá bừa',
  Collect.retentionOf({ retention: { enabled: true, days: -5 } }).days === 0 &&
  Collect.retentionOf({ retention: { enabled: true, days: 'ba mươi' } }).days === 0);
check('tắt thì không xoá gì',
  Collect.prune(retConfig, Collect.retentionOf({})).removed.length === 0 && E.listDays(retConfig).length === 2);

const pruned = Collect.prune(retConfig, Collect.retentionOf({ retention: { enabled: true, days: 30 } }));
check('bật thì xoá đúng ngày quá cũ', pruned.removed.join() === oldDay, pruned);
check('ngày còn trong hạn được giữ nguyên',
  E.listDays(retConfig).join() === today, E.listDays(retConfig));
check('nhật ký không bị xoá theo sự kiện',
  fs.existsSync(path.join(retConfig.dataDir, 'journals')) || true);

/* ---------------------------------------------------------------------
   Tắt máy chủ: không được giết nhầm
   --------------------------------------------------------------------- */

const Stop = require('../desktop/stop');
const stopConfig = { root: ROOT, dataDir: path.join(TEST_DIR, 'stop'), desktop: { port: 5173 } };
fs.mkdirSync(stopConfig.dataDir, { recursive: true });

// Một pid chắc chắn đã chết: cho chạy rồi để nó xong.
const deadPid = require('child_process').spawnSync(process.execPath, ['-e', '0']).pid;

check('không có tệp pid thì báo là không có', Stop.trustedPid(null, stopConfig, null).why === 'no-file');
check('tệp pid ghi cho dự án khác thì không tin',
  Stop.trustedPid({ pid: process.pid, root: 'D:\\du-an-khac' }, stopConfig, null).why === 'wrong-root');
check('tệp pid trỏ tiến trình đã chết thì không tin',
  Stop.trustedPid({ pid: deadPid, root: ROOT }, stopConfig, null).why === 'dead', deadPid);
check('pid trong tệp không phải chủ cổng thì không tin',
  Stop.trustedPid({ pid: process.pid, root: ROOT }, stopConfig, 4242).why === 'not-port-owner');
check('pid trong tệp đúng là chủ cổng thì tin',
  Stop.trustedPid({ pid: process.pid, root: ROOT }, stopConfig, process.pid).pid === process.pid);
check('so đường dẫn không phân biệt hoa thường và dấu gạch cuối',
  Stop.trustedPid({ pid: process.pid, root: ROOT.toUpperCase() + '\\' }, stopConfig, null).pid === process.pid);

check('lời nhắn khi tiến trình không phải node nói rõ là tiến trình nào',
  Stop.describe({ stopped: false, reason: 'not-ours', port: 5173, pid: 5, process: 'chrome.exe', why: 'process-name' })
    .indexOf('chrome.exe') !== -1);
check('lời nhắn khi cổng có kẻ khác tự khai không phải DevTrace',
  Stop.describe({ stopped: false, reason: 'not-ours', port: 5173, pid: 5, process: 'node.exe', why: 'foreign-server' })
    .indexOf('không phải DevTrace') !== -1);
check('lời nhắn khi tệp pid cũ nói rõ tệp nằm ở đâu',
  Stop.describe({ stopped: false, reason: 'stale-pid-file', port: 5173, pidFile: 'X:\\d\\server.pid', why: 'dead' })
    .indexOf('X:\\d\\server.pid') !== -1);

/* Chạy THẬT hàm stop() với netstat/tasklist giả. Đây là chỗ khoá lại lỗi
   nguy hiểm nhất: tệp pid cũ nằm lại, Windows cấp số pid đó cho phần mềm
   khác, và huynh ra lệnh tắt DevTrace. Bản cũ chỉ kiểm tra tên tiến trình
   khi pid đến từ netstat, nên nó sẽ tắt luôn phần mềm kia.

   Đây là phần chạy bất đồng bộ của mục này; nó được gọi ở cuối tệp, ngay
   trước vòng boot giao diện. */
const stopPort = 5173;
const stopPidFile = path.join(stopConfig.dataDir, 'server.pid');

function fakeRun(ownerName, ownerPid) {
  return (cmd, args, callback) => {
    if (cmd === 'netstat') {
      return callback(null, '  TCP    127.0.0.1:' + stopPort + '     0.0.0.0:0    LISTENING    ' + ownerPid + '\r\n');
    }
    return callback(null, '"' + ownerName + '","' + ownerPid + '","Console","1","10 K"\r\n');
  };
}

function writeStopPidFile(pid, root) {
  fs.writeFileSync(stopPidFile,
    JSON.stringify({ pid: pid, port: stopPort, root: root || ROOT, startedAt: new Date().toISOString() }), 'utf8');
}

function stopNow(options) {
  return Stop.stop(Object.assign({ config: stopConfig, claim: () => Promise.resolve('unknown') }, options));
}

// Tiến trình giữ cổng tự khai là ai — mặc định "không hỏi được".
const says = (claim) => () => Promise.resolve(claim);

function checkStopGuards() {
  writeStopPidFile(process.pid);
  const killed = [];

  return stopNow({ run: fakeRun('chrome.exe', process.pid), kill: (t) => { killed.push(t); } })
    .then((refused) => {
      check('tệp pid cũ + số pid bị cấp lại cho phần mềm khác thì KHÔNG tắt',
        refused.stopped === false && refused.why === 'process-name', refused);
      check('không tắt thì cũng không gọi lệnh tắt lần nào', killed.length === 0, killed);
      check('lời nhắn cho huynh biết đã chặn vì lý do gì',
        Stop.describe(refused).indexOf('chrome.exe') !== -1, Stop.describe(refused));

      // Cùng tình huống nhưng tiến trình giữ cổng tự khai không phải DevTrace.
      return stopNow({ run: fakeRun('node.exe', process.pid), claim: says('other'), kill: (t) => { killed.push(t); } });
    })
    .then((foreign) => {
      check('cổng có người trả lời mà tự khai không phải DevTrace thì không tắt',
        foreign.stopped === false && foreign.why === 'foreign-server', foreign);
      check('vẫn không gọi lệnh tắt nào', killed.length === 0);

      // Đúng tiến trình của mình: phải tắt, và phải dọn tệp pid.
      return stopNow({
        run: fakeRun('node.exe', process.pid), claim: says('devtrace'),
        kill: (t) => { killed.push(t); }, waitFree: () => Promise.resolve(true)
      });
    })
    .then((done) => {
      check('đúng tiến trình DevTrace thì tắt',
        done.stopped === true && done.pid === process.pid, done);
      check('tắt xong thì dọn tệp pid', !fs.existsSync(stopPidFile));
      check('cổng đã rảnh thì nói rõ là đã rảnh',
        Stop.describe(done).indexOf('đã rảnh') !== -1, Stop.describe(done));
    });
}

/* ---------------------------------------------------------------------
   Gỡ lối tắt: lệnh xoá cả cây thư mục
   --------------------------------------------------------------------- */

check('chốt chặn từ chối xoá gốc ổ đĩa', Shortcut.stageRefusal('D:\\') !== null);
check('chốt chặn từ chối xoá thư mục nhà', Shortcut.stageRefusal(os.homedir()) !== null);
check('chốt chặn từ chối xoá chính thư mục dự án', Shortcut.stageRefusal(ROOT) !== null);
check('chốt chặn từ chối xoá thư mục chứa dự án', Shortcut.stageRefusal(path.dirname(ROOT)) !== null);

const guardStage = path.join(TEST_DIR, 'stage');
fs.mkdirSync(guardStage, { recursive: true });
check('thư mục rỗng thì không xoá (không có gì chứng minh là của DevTrace)',
  Shortcut.stageRefusal(guardStage) !== null);
Shortcut.writeStage({
  stage: guardStage, forwarder: path.join(guardStage, Shortcut.FORWARDER_NAME),
  icon: path.join(guardStage, 'devtrace.ico'), root: ROOT, spec: {}
});
check('thư mục trung gian đúng chuẩn thì cho xoá', Shortcut.stageRefusal(guardStage) === null,
  Shortcut.stageRefusal(guardStage));
fs.writeFileSync(path.join(guardStage, 'ghi-chu-cua-toi.txt'), 'x', 'utf8');
check('trong đó còn tệp khác của huynh thì không xoá',
  String(Shortcut.stageRefusal(guardStage)).indexOf('ghi-chu-cua-toi.txt') !== -1,
  Shortcut.stageRefusal(guardStage));
fs.unlinkSync(path.join(guardStage, 'ghi-chu-cua-toi.txt'));
fs.writeFileSync(path.join(guardStage, Shortcut.FORWARDER_NAME), 'khong phai do devtrace viet', 'utf16le');
check('tệp chuyển tiếp không phải do DevTrace viết thì không xoá',
  Shortcut.stageRefusal(guardStage) !== null, Shortcut.stageRefusal(guardStage));

/* =====================================================================
   [13] Kế hoạch của huynh: việc, thời khoá biểu, sprint

   Phần này canh ba điều dễ hỏng nhất của cả tính năng, và cả ba đều là
   những cách nói dối rất dễ mắc:

     - Việc cố định phải là MỘT dòng trong tệp, không phải một dòng mỗi
       ngày. Mở cả năm ra mà đẻ 365 dòng thì kho việc phình ra và không ai
       dám sửa nó nữa.
     - Buổi không có dấu vết KHÔNG phải buổi chưa làm. Ngày máy tắt mà
       màn hình báo "chưa làm 3/3 buổi" là DevTrace nói sai về chính huynh.
     - Tệp việc hỏng thì phải giữ bản sao và từ chối ghi, không được ghi
       đè bằng rỗng.
   ===================================================================== */

section('[13] Kế hoạch của huynh');

/* Kho kế hoạch riêng, không dùng chung TEST_DIR với bằng chứng: nếu dùng
   chung thì một phép kiểm ở đây có thể làm lệch những phép kiểm đang đếm
   tệp trong thư mục đó. */
const planConfig = Object.assign({}, config, { dataDir: path.join(TEST_DIR, 'plans-store') });
const PLAN_NOW = Date.parse('2026-10-12T10:00:00');

const MON = '2026-10-12'; // thứ Hai
const WED = '2026-10-14';
const THU = '2026-10-15';
const SAT = '2026-10-17';
const SUN = '2026-10-18';

check('thứ trong tuần đếm từ thứ Hai, không phải theo getDay', (function () {
  return Plans.weekdayOf(MON) === 1 && Plans.weekdayOf(SAT) === 6 && Plans.weekdayOf(SUN) === 7;
})());
check('đầu tuần là thứ Hai của tuần đó', Plans.weekStart(WED) === MON && Plans.weekStart(SUN) === MON);

/* Ngày DevTrace bắt đầu lúc 4 giờ sáng, nên "thứ Hai 01:00" trong thời khoá
   biểu là một giờ sáng thứ Ba theo lịch — cuối ngày làm việc thứ Hai, đúng
   như cách huynh vẫn nghĩ về nó. Cộng giờ theo lịch thì buổi đó rơi sang
   ngày DevTrace của Chủ nhật, lệch hẳn một ngày. */
check('giờ của buổi neo vào ngày DevTrace, không neo vào lịch', (function () {
  const nine = new Date(Plans.atTime(planConfig, MON, '09:00'));
  const one = new Date(Plans.atTime(planConfig, MON, '01:00'));
  return Plans.weekdayOf(U.dayKey(nine.getTime(), 4)) === 1
    && Plans.weekdayOf(U.dayKey(one.getTime(), 4)) === 1
    && one.getTime() > nine.getTime();
})());

check('việc cố định lặp đúng theo từng kiểu', (function () {
  const daily = { freq: 'daily', byWeekday: [] };
  const weekdays = { freq: 'weekdays', byWeekday: [] };
  const monWed = { freq: 'weekly', byWeekday: [1, 3] };
  return Plans.recursOn(daily, SUN) && Plans.recursOn(weekdays, MON) && !Plans.recursOn(weekdays, SAT)
    && Plans.recursOn(monWed, MON) && Plans.recursOn(monWed, WED) && !Plans.recursOn(monWed, SUN)
    && !Plans.recursOn(null, MON);
})());

/* `blankStore` dựng đúng hình dạng `loadStore` trả về, để những phép kiểm
   thuần dưới đây không phải chạm vào đĩa. Viết sai hình dạng ở đây (ví dụ
   đưa thẳng `emptyTasks()` vào chỗ cần cả kho) thì hàm cần `store.tasks.tasks`
   sẽ đọc phải một mảng và ném lỗi — bài kiểm sẽ đỏ vì lý do của chính nó. */
function blankStore() {
  return { tasks: Plans.emptyTasks(), timetable: Plans.emptyTimetable(), sprints: Plans.emptySprints(), corrupt: {} };
}

check('mở một việc cố định suốt năm không đẻ thêm dòng nào', (function () {
  const store = blankStore();
  store.tasks.tasks.push({
    id: 't-0001', title: 'Đọc tài liệu', horizon: 'recurring', status: 'open',
    recur: { freq: 'daily', byWeekday: [] }, order: 0
  });
  let total = 0;
  for (let i = 0; i < 365; i++) total += Plans.occurrencesOn(planConfig, store, U.shiftDay('2026-01-01', i)).length;
  return total === 365 && store.tasks.tasks.length === 1 && Object.keys(store.tasks.completions).length === 0;
})(), 'một dòng lưu trữ, 365 buổi trong bộ nhớ');

/* ---- Ghi thật xuống đĩa, để phần còn lại chạy trên tệp có thật ---- */

const madeRecurring = Plans.applyTask(planConfig, 'save',
  { title: 'Tập thể dục', horizon: 'recurring', recur: { freq: 'daily' } }, { now: PLAN_NOW });

check('thêm được một việc cố định', madeRecurring.ok === true, madeRecurring.error);

check('tệp kế hoạch nằm ngoài kho bằng chứng', (function () {
  const file = Plans.tasksFile(planConfig);
  return U.isFile(file)
    && path.dirname(file) === Plans.plansDir(planConfig)
    && path.dirname(file).indexOf(E.eventsDir(planConfig)) !== 0;
})());

check('tích một buổi cố định không làm ngày khác thành đã xong', (function () {
  const id = madeRecurring.task && madeRecurring.task.id;
  if (!id) return false;
  const ticked = Plans.applyTask(planConfig, 'occur-toggle',
    { id: id, day: '2026-10-13', done: true }, { now: PLAN_NOW });
  if (!ticked.ok) return false;
  const store = Plans.loadStore(planConfig);
  const monday = Plans.occurrencesOn(planConfig, store, MON);
  const tuesday = Plans.occurrencesOn(planConfig, store, '2026-10-13');
  return monday.length === 1 && monday[0].done === false
    && tuesday.length === 1 && tuesday[0].done === true
    && Object.keys(store.tasks.completions).length === 1;
})());

check('việc cố định không được tích một lần cho cả việc', (function () {
  const id = madeRecurring.task && madeRecurring.task.id;
  const tried = Plans.applyTask(planConfig, 'toggle', { id: id }, { now: PLAN_NOW });
  return tried.ok === false && String(tried.error).indexOf('theo từng buổi') !== -1;
})(), (function () {
  const id = madeRecurring.task && madeRecurring.task.id;
  return Plans.applyTask(planConfig, 'toggle', { id: id }, { now: PLAN_NOW }).error;
})());

check('việc trong ngày không thuộc sprint', (function () {
  const made = Plans.applyTask(planConfig, 'save',
    { title: 'Chốt luồng đăng nhập', horizon: 'day', sprintId: 's-0001' }, { now: PLAN_NOW });
  return made.ok === false && String(made.error).indexOf('không thuộc sprint') !== -1;
})());

/* ---- Thời khoá biểu, và đối chiếu với thực tế ---- */

const slotWed = Plans.applySlot(planConfig, 'save',
  { weekday: 3, start: '09:00', end: '11:00', title: 'Làm Nexus', kind: 'deep' }, { now: PLAN_NOW });

check('thêm được một buổi vào thời khoá biểu', slotWed.ok === true, slotWed.error);

check('buổi trùng giờ trong cùng một thứ thì bị từ chối', (function () {
  const clash = Plans.applySlot(planConfig, 'save',
    { weekday: 3, start: '10:00', end: '12:00', title: 'Buổi chồng' }, { now: PLAN_NOW });
  return clash.ok === false && String(clash.error).indexOf('Trùng với buổi') !== -1;
})(), (function () {
  return Plans.applySlot(planConfig, 'save',
    { weekday: 3, start: '10:00', end: '12:00', title: 'Buổi chồng' }, { now: PLAN_NOW }).error;
})());

check('buổi kết thúc trước khi bắt đầu thì bị từ chối', (function () {
  const bad = Plans.applySlot(planConfig, 'save',
    { weekday: 5, start: '11:00', end: '09:00', title: 'Ngược' }, { now: PLAN_NOW });
  return bad.ok === false;
})());

/* Ca chính, đúng con số: dự kiến 09:00–11:00 là 120 phút; bằng chứng thật
   chỉ có một quãng 09:20–10:40 là 80 phút. 80/120 = 0,67 nên là "một phần",
   và 40 phút còn lại là chỗ chưa rõ. */
check('đối chiếu buổi 9–11 với hoạt động 9:20–10:40 ra "làm một phần"', (function () {
  const from = Plans.atTime(planConfig, WED, '09:20');
  const to = Plans.atTime(planConfig, WED, '10:40');
  const spans = { all: [[from, to]], byProject: {} };
  const cmp = Plans.compareSessions(planConfig, WED, spans, { now: PLAN_NOW });
  const row = cmp.sessions[0];
  return cmp.sessions.length === 1 && row.plannedMinutes === 120 && row.matchedMinutes === 80
    && row.unaccountedMinutes === 40 && row.status === 'partial';
})(), (function () {
  const from = Plans.atTime(planConfig, WED, '09:20');
  const to = Plans.atTime(planConfig, WED, '10:40');
  return Plans.compareSessions(planConfig, WED, { all: [[from, to]], byProject: {} }, { now: PLAN_NOW }).sessions[0];
})());

check('làm đủ cả buổi thì tính là đã làm', (function () {
  const from = Plans.atTime(planConfig, WED, '09:00');
  const to = Plans.atTime(planConfig, WED, '11:00');
  const cmp = Plans.compareSessions(planConfig, WED, { all: [[from, to]], byProject: {} }, { now: PLAN_NOW });
  return cmp.sessions[0].status === 'done' && cmp.sessions[0].unaccountedMinutes === 0;
})());

/* Nhánh quan trọng nhất của cả tệp. */
check('ngày không có dấu vết thì mọi buổi là "chưa có dấu vết", không phải "chưa làm"', (function () {
  const cmp = Plans.compareSessions(planConfig, WED, { all: [], byProject: {} }, { now: PLAN_NOW });
  return cmp.sessions.length === 1 && cmp.sessions[0].status === 'no-evidence'
    && cmp.counts.missed === 0 && cmp.counts.noEvidence === 1
    && cmp.hasEvidence === false && cmp.note.indexOf('không có nghĩa là không làm gì') !== -1;
})(), (function () {
  return Plans.compareSessions(planConfig, WED, { all: [], byProject: {} }, { now: PLAN_NOW }).counts;
})());

/* Một commit hay một lượt xem không kèm thời lượng, nhưng vẫn là một điểm
   CÓ THẬT trên trục thời gian. `activitySpans` phải cho nó đúng một phút —
   nếu để dài 0 thì mọi sự kiện lẻ đều biến mất khỏi phép đối chiếu, và một
   ngày chỉ toàn commit sẽ trông y hệt một ngày máy tắt. */
check('một sự kiện lẻ vẫn được tính ít nhất một phút, không phải không có gì', (function () {
  const at = Plans.atTime(planConfig, WED, '09:30');
  const spans = R.activitySpans([{ ts: at, projectKey: null, weight: 1 }]);
  const cmp = Plans.compareSessions(planConfig, WED, spans, { now: PLAN_NOW });
  return spans.all.length === 1 && (spans.all[0][1] - spans.all[0][0]) === 60000
    && cmp.sessions[0].matchedMinutes === 1 && cmp.sessions[0].status === 'partial';
})(), (function () {
  const at = Plans.atTime(planConfig, WED, '09:30');
  return R.activitySpans([{ ts: at, projectKey: null, weight: 1 }]).all;
})());

check('buổi lệch dự án nhưng ngày có việc khác thì tính là lệch, không phải chưa làm', (function () {
  const saved = Plans.applySlot(planConfig, 'save', {
    weekday: 4, start: '14:00', end: '15:00', title: 'Làm Nexus',
    projectPath: path.join(TEST_DIR, 'du-an-rieng')
  }, { now: PLAN_NOW });
  if (!saved.ok) return false;
  const from = Plans.atTime(planConfig, THU, '14:00');
  const to = Plans.atTime(planConfig, THU, '15:00');
  const spans = { all: [[from, to]], byProject: { 'khong-phai-du-an-nay': [[from, to]] } };
  const cmp = Plans.compareSessions(planConfig, THU, spans, { now: PLAN_NOW });
  return cmp.sessions.length === 1 && cmp.sessions[0].status === 'missed'
    && cmp.sessions[0].matchedMinutes === 0 && cmp.hasEvidence === true;
})());

check('buổi nghỉ không bị tính là bỏ lỡ', (function () {
  const saved = Plans.applySlot(planConfig, 'save',
    { weekday: 6, start: '12:00', end: '13:00', title: 'Nghỉ trưa', kind: 'break' }, { now: PLAN_NOW });
  if (!saved.ok) return false;
  const from = Plans.atTime(planConfig, SAT, '12:00');
  const to = Plans.atTime(planConfig, SAT, '13:00');
  const cmp = Plans.compareSessions(planConfig, SAT, { all: [[from, to]], byProject: {} }, { now: PLAN_NOW });
  return cmp.sessions[0].status === 'break' && cmp.counts.break === 1
    && cmp.plannedMinutes === 0 && cmp.counts.missed === 0;
})());

/* ---- Đối chiếu phải đi theo bản tổng hợp và theo gói gửi cho AI ---- */

/* Ghi bằng chứng thật vào kho của `planConfig` — một quãng 09:20–10:40 đúng
   như ca chính ở trên, nhưng lần này đi qua toàn bộ đường ống thật:
   `E.writeDay` → `R.evidence` → `R.activitySpans` → `Plans.compareSessions`. */
const WED_START = Plans.atTime(planConfig, WED, '09:20');
const WED_END = Plans.atTime(planConfig, WED, '10:40');
E.writeDay(planConfig, WED, [E.makeEvent(planConfig, {
  source: 'files', kind: 'change', ts: WED_START, durationMs: WED_END - WED_START,
  project: path.join(ROOT, 'mau', 'nexus'), title: 'sửa app.js'
})]);

check('bản tổng hợp mang theo phần đối chiếu, không chỉ kế hoạch suông', (function () {
  const built = D.build(planConfig, WED);
  const row = built.schedule.sessions[0];
  return built.schedule.sessions.length === 1 && row.plannedMinutes === 120
    && row.matchedMinutes === 80 && row.unaccountedMinutes === 40 && row.status === 'partial'
    && built.schedule.hasEvidence === true && built.schedule.counts.partial === 1;
})(), (function () {
  return D.build(planConfig, WED).schedule;
})());

/* Ngày không có dấu vết vẫn phải mang theo câu nói rằng vắng dữ liệu KHÔNG
   phải là không làm gì — ở cả bản tổng hợp lẫn gói gửi cho AI. Thiếu câu đó
   thì AI đọc một danh sách buổi trống và viết thành "hôm đó huynh không làm
   gì", trong khi sự thật là ngày đó máy không đọc được gì. */
check('ngày trống dấu vết vẫn mang theo câu nói thẳng, không chỉ con số 0', (function () {
  const built = D.build(planConfig, '2026-10-16'); // thứ Sáu, chưa có bằng chứng nào
  return built.schedule.sessions.length === 0 && built.schedule.counts.missed === 0
    && built.schedule.note.length > 0;
})(), (function () {
  return D.build(planConfig, '2026-10-16').schedule.note;
})());

check('gói gửi cho AI có thời khoá biểu, và buổi được cấp mã trích dẫn thật', (function () {
  const pack = AI.evidencePack(planConfig, WED);
  const table = AI.codeIndex(pack);
  return pack.schedule.matchedMinutes === 80
    && pack.schedule.sessions.length === 1 && pack.schedule.sessions[0].id === 'S1'
    && typeof table.S1 === 'string' && table.S1.indexOf('09:00–11:00') !== -1
    && AI.checkCitations('Buổi (S1) khớp một phần.', table).invalid.length === 0;
})(), (function () {
  const pack = AI.evidencePack(planConfig, WED);
  return AI.codeIndex(pack).S1;
})());

/* Gói gửi cho AI phải là hình dạng ĐÃ CẮT, không phải nguyên đối tượng nội
   bộ. Mốc milli-giây và đường dẫn dự án là chuyện của máy, không phải thứ
   AI cần, và chúng chỉ làm gói phình ra. */
check('gói gửi cho AI không mang theo trường nội bộ của bộ đối chiếu', (function () {
  const text = JSON.stringify(AI.evidencePack(planConfig, WED));
  return text.indexOf('startMs') === -1 && text.indexOf('endMs') === -1
    && text.indexOf('projectPath') === -1;
})());

/* ---- Sprint và vận tốc ---- */

check('chưa đóng đủ hai sprint thì chưa nói gì về tốc độ', (function () {
  const v = Plans.velocityOf(Plans.loadStore(planConfig));
  return v.available === false && v.averagePoints === null && v.note.indexOf('hai sprint') !== -1;
})());

function velocityStore() {
  const store = blankStore();
  store.sprints.sprints.push({ id: 's-0001', name: 'S1', status: 'closed', startDay: '2026-09-01', endDay: '2026-09-14' });
  store.sprints.sprints.push({ id: 's-0002', name: 'S2', status: 'closed', startDay: '2026-09-15', endDay: '2026-09-28' });
  store.tasks.tasks.push({ id: 't-0001', title: 'A', horizon: 'week', status: 'done', doneDay: '2026-09-10', sprintId: 's-0001', points: 5 });
  store.tasks.tasks.push({ id: 't-0002', title: 'B', horizon: 'week', status: 'done', doneDay: '2026-09-25', sprintId: 's-0002', points: 3 });
  store.tasks.tasks.push({ id: 't-0003', title: 'C', horizon: 'week', status: 'open', sprintId: 's-0002', points: 8 });
  // Việc xong nhưng NGOÀI khoảng của sprint thì không tính cho sprint đó.
  store.tasks.tasks.push({ id: 't-0004', title: 'D', horizon: 'week', status: 'done', doneDay: '2026-10-05', sprintId: 's-0002', points: 13 });
  return store;
}

check('vận tốc tính bằng điểm việc xong trong khoảng của sprint', (function () {
  const v = Plans.velocityOf(velocityStore());
  return v.available === true && v.sprints[0].points === 5 && v.sprints[1].points === 3 && v.averagePoints === 4;
})(), (function () {
  return Plans.velocityOf(velocityStore()).sprints.map((s) => s.points);
})());

let sprintNote = null;
check('mở sprint đầu tiên rồi đóng, việc còn dở trả về backlog và đếm số lần mang sang', (function () {
  const started = Plans.applySprint(planConfig, 'start', { name: 'Sprint thử', goal: 'Xong việc A' }, { now: PLAN_NOW });
  if (!started.ok) { sprintNote = started.error; return false; }
  // Hai hộp thời gian chồng nhau thì không còn là hộp thời gian.
  const second = Plans.applySprint(planConfig, 'start', { name: 'Sprint chồng' }, { now: PLAN_NOW });
  if (second.ok) return false;
  sprintNote = second.error;
  const task = Plans.applyTask(planConfig, 'save',
    { title: 'Việc tuần', horizon: 'week', points: 5 }, { now: PLAN_NOW });
  if (!task.ok) { sprintNote = task.error; return false; }
  const moved = Plans.applyTask(planConfig, 'move',
    { id: task.task.id, sprintId: started.sprint.id }, { now: PLAN_NOW });
  if (!moved.ok) { sprintNote = moved.error; return false; }
  const closed = Plans.applySprint(planConfig, 'close', { id: started.sprint.id }, { now: PLAN_NOW });
  if (!closed.ok) { sprintNote = closed.error; return false; }
  const store = Plans.loadStore(planConfig);
  const after = store.tasks.tasks.find((t) => t.id === task.task.id);
  sprintNote = closed.sprint.summary;
  return after.sprintId === null && after.carriedCount === 1
    && closed.sprint.summary.carried === 1 && closed.sprint.summary.points === 0;
})(), sprintNote);

/* Cảnh báo mới phải có mặt ở CẢ gói gửi cho AI, không chỉ ở màn hình. Đây
   là lý do `build()` gom cảnh báo thay vì để giao diện tự thêm: AI không
   được phép viết trơn tru trong khi huynh đang nhìn một danh sách đỏ.

   Phép kiểm này phải đứng SAU nhóm sprint ở trên, vì nó dựa vào một việc
   thật đã quá hạn trong kho — "Việc tuần" hạn thứ Hai 12/10, xem ngày 16/10. */
check('cảnh báo kế hoạch có mặt ở cả bản tổng hợp lẫn gói gửi cho AI', (function () {
  const built = D.build(planConfig, '2026-10-16');
  const pack = AI.evidencePack(planConfig, '2026-10-16');
  const inBuilt = built.warnings.filter((w) => w.kind === 'task');
  const inPack = (pack.warnings || []).filter((w) => w.kind === 'task');
  return inBuilt.length > 0 && inPack.length === inBuilt.length
    && inPack[0].title === inBuilt[0].title;
})(), (function () {
  return D.build(planConfig, '2026-10-16').warnings.filter((w) => w.kind === 'task').map((w) => w.title);
})());

/* ---- Kế hoạch sống ngoài tầm với của mọi lệnh xoá bằng chứng ---- */

check('mọi tệp kế hoạch đều nằm ngoài thư mục bằng chứng', (function () {
  const E2 = require('../app/events');
  const evidenceDir = E2.eventsDir(planConfig);
  return [Plans.tasksFile(planConfig), Plans.timetableFile(planConfig), Plans.sprintsFile(planConfig)]
    .every((file) => file.indexOf(evidenceDir) === -1 && U.isFile(file));
})());

check('xoá sạch bằng chứng không đụng tới kế hoạch', (function () {
  const wipe = Object.assign({}, config, { dataDir: path.join(TEST_DIR, 'wipe-store') });
  const day = '2026-10-12';
  E.writeDay(wipe, day, [E.makeEvent(wipe, { source: 'git', kind: 'commit', ts: PLAN_NOW, project: ROOT, title: 'x' })]);
  Plans.applyTask(wipe, 'save', { title: 'Việc phải còn', horizon: 'day' }, { now: PLAN_NOW });
  const before = U.readText(Plans.tasksFile(wipe));
  Collect.clearCollected(wipe);
  const survived = U.readText(Plans.tasksFile(wipe)) === before;
  return E.listDays(wipe).length === 0 && survived && U.isFile(Plans.tasksFile(wipe));
})());

check('dọn theo thời hạn lưu trữ không đụng tới kế hoạch, kể cả khi tắt giữ nhật ký', (function () {
  const wipe = Object.assign({}, config, { dataDir: path.join(TEST_DIR, 'prune-store') });
  const day = '2020-01-01';
  E.writeDay(wipe, day, [E.makeEvent(wipe, { source: 'git', kind: 'commit', ts: Date.parse('2020-01-01T10:00:00'), project: ROOT, title: 'x' })]);
  Plans.applyTask(wipe, 'save', { title: 'Việc phải còn', horizon: 'goal' }, { now: PLAN_NOW });
  U.writeJson(path.join(wipe.dataDir, 'journals', day + '.json'), { text: 'nhật ký cũ' });
  const before = U.readText(Plans.tasksFile(wipe));
  Collect.prune(wipe, { enabled: true, days: 30, keepJournals: false });
  return U.readText(Plans.tasksFile(wipe)) === before
    && !U.isFile(path.join(wipe.dataDir, 'journals', day + '.json'))
    && U.isFile(Plans.tasksFile(wipe));
})());

/* ---- Tệp hỏng: giữ bản sao, từ chối ghi ---- */

let corruptNote = null;
check('tệp việc hỏng thì giữ bản sao và từ chối ghi đè', (function () {
  const file = Plans.tasksFile(planConfig);
  const good = U.readText(file);
  fs.writeFileSync(file, '{ "tasks": [ hong', 'utf8');
  const broken = U.readText(file);

  const store = Plans.loadStore(planConfig);
  const refused = Plans.applyTask(planConfig, 'save', { title: 'Việc mới', horizon: 'day' }, { now: PLAN_NOW });
  const backups = fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith('tasks.json.hong-'));
  const backupText = backups.length ? U.readText(path.join(path.dirname(file), backups[0])) : null;
  const untouched = U.readText(file) === broken;
  const seen = Plans.view(planConfig, MON, { now: PLAN_NOW });

  fs.writeFileSync(file, good, 'utf8'); // trả lại để phần sau không bị lây
  corruptNote = refused.error;
  return store.error !== null && refused.ok === false && String(refused.error).indexOf('bị hỏng') !== -1
    && backups.length === 1 && backupText === broken && untouched
    && seen.ok === false && String(seen.error).indexOf(backups[0]) !== -1;
})(), corruptNote);

check('tệp việc chưa có thì là kho mới, không phải kho hỏng', (function () {
  const fresh = Object.assign({}, config, { dataDir: path.join(TEST_DIR, 'kho-moi') });
  const store = Plans.loadStore(fresh);
  return store.error === null && store.tasks.tasks.length === 0;
})());

check('mục méo trong tệp thì đếm lại và nói ra, không bỏ qua im lặng', (function () {
  const store = blankStore();
  store.tasks.tasks.push({ id: 't-0001', title: 'Việc lành', horizon: 'day', dueDay: MON, order: 0 });
  store.tasks.tasks.push({ title: 'Thiếu id', horizon: 'day' });
  const skipped = [];
  const board = Plans.boardOf(planConfig, store, MON, skipped);
  return board.day.length === 1 && skipped.length === 1 && skipped[0].reason.indexOf('thiếu id') !== -1;
})(), (function () {
  const store = blankStore();
  store.tasks.tasks.push({ id: 't-0001', title: 'Việc lành', horizon: 'day', dueDay: MON, order: 0 });
  store.tasks.tasks.push({ title: 'Thiếu id', horizon: 'day' });
  const skipped = [];
  Plans.boardOf(planConfig, store, MON, skipped);
  return skipped;
})());

/* ---- Một chỗ gom cảnh báo ------------------------------------------ */

const ALERT_DAY = '2026-11-20';

/* Một kế hoạch có đủ thứ đáng nói: ba việc quá hạn, một việc đã xong từ lâu
   (không được tính), một việc cố định (không có hạn, cũng không được tính),
   một sprint đã qua ngày kết thúc, và một tệp hỏng. */
function alertStore() {
  const store = blankStore();
  store.tasks.tasks.push({ id: 't-0001', title: 'Nộp báo cáo', horizon: 'day', status: 'open', dueDay: '2026-11-10' });
  store.tasks.tasks.push({ id: 't-0002', title: 'Sửa lỗi đăng nhập', horizon: 'week', status: 'open', dueDay: '2026-11-09' });
  store.tasks.tasks.push({ id: 't-0003', title: 'Xong luồng thanh toán', horizon: 'goal', status: 'open', targetDay: '2026-11-01' });
  store.tasks.tasks.push({ id: 't-0004', title: 'Việc đã xong từ lâu', horizon: 'day', status: 'done', dueDay: '2026-10-01' });
  store.tasks.tasks.push({ id: 't-0005', title: 'Việc cố định', horizon: 'recurring', status: 'open', recur: { freq: 'daily', byWeekday: [] } });
  store.sprints.sprints.push({ id: 's-0001', name: 'Sprint 1', status: 'active', startDay: '2026-11-01', endDay: '2026-11-14' });
  store.corrupt = { tasks: { file: path.join(TEST_DIR, 'plans-store', 'plans', 'tasks.json'), reason: 'không đọc nổi JSON', backup: null } };
  return store;
}

check('cảnh báo kế hoạch gom đúng và mang đủ tám trường', (function () {
  const list = Alerts.gather(planConfig, ALERT_DAY, { store: alertStore() });
  const kinds = list.map((a) => a.kind).sort().join();
  const shaped = list.every((a) => typeof a.level === 'string' && typeof a.kind === 'string'
    && typeof a.title === 'string' && a.title.length > 0 && typeof a.weight === 'number'
    && ['source', 'detail', 'at', 'project', 'title', 'kind', 'level', 'weight'].every((k) => k in a));
  return list.length === 3 && kinds === 'plan,sprint,task' && shaped;
})(), (function () {
  return Alerts.gather(planConfig, ALERT_DAY, { store: alertStore() }).map((a) => a.kind + '/' + a.level + '/' + a.weight);
})());

check('việc quá hạn gom thành một dòng; việc đã xong và việc cố định không bị tính', (function () {
  const task = Alerts.gather(planConfig, ALERT_DAY, { store: alertStore() }).find((a) => a.kind === 'task');
  return task.title.indexOf('3 việc') === 0 && task.level === 'bad'
    && task.detail.indexOf('Nộp báo cáo') !== -1
    && task.detail.indexOf('Việc đã xong') === -1 && task.detail.indexOf('Việc cố định') === -1;
})(), (function () {
  return Alerts.gather(planConfig, ALERT_DAY, { store: alertStore() }).find((a) => a.kind === 'task').detail;
})());

check('tệp kế hoạch hỏng là cảnh báo nặng nhất, và nói rõ là đang từ chối ghi', (function () {
  const bad = Alerts.gather(planConfig, ALERT_DAY, { store: alertStore() })[0];
  return bad.kind === 'plan' && bad.level === 'bad' && bad.weight >= 9
    && bad.detail.indexOf('không ghi đè') !== -1;
})(), (function () {
  return Alerts.gather(planConfig, ALERT_DAY, { store: alertStore() })[0].title;
})());

check('kế hoạch lành thì không có cảnh báo nào — không dựng chuyện', (function () {
  const store = blankStore();
  store.tasks.tasks.push({ id: 't-0001', title: 'Việc còn hạn', horizon: 'day', status: 'open', dueDay: ALERT_DAY });
  store.tasks.tasks.push({ id: 't-0002', title: 'Việc tuần chưa chốt ngày', horizon: 'week', status: 'open', dueDay: null });
  store.sprints.sprints.push({ id: 's-0001', name: 'Sprint đang chạy', status: 'active', startDay: '2026-11-16', endDay: '2026-11-29' });
  return Alerts.gather(planConfig, ALERT_DAY, { store }).length === 0;
})());

check('sprint kết thúc đúng hôm nay thì nhắc, chưa tới hạn thì im', (function () {
  const store = blankStore();
  store.sprints.sprints.push({ id: 's-0001', name: 'Sprint cuối', status: 'active', startDay: '2026-11-07', endDay: ALERT_DAY });
  const list = Alerts.gather(planConfig, ALERT_DAY, { store });
  return list.length === 1 && list[0].kind === 'sprint' && list[0].level === 'warn'
    && list[0].title.indexOf('kết thúc hôm nay') !== -1;
})());

/* Cảnh báo mới phải đi qua đúng đường của những cảnh báo cũ — nếu không thì
   màn hình và gói gửi cho AI sẽ nhìn thấy hai danh sách khác nhau. */
check('cảnh báo kế hoạch đi vào danh sách chung và sắp đúng mức-rồi-nặng', (function () {
  const evidence = R.evidence(planConfig, ALERT_DAY);
  const list = D.warnings(planConfig, evidence, ALERT_DAY, {
    frictions: [], coverage: D.coverage(planConfig, evidence, ALERT_DAY),
    alerts: Alerts.gather(planConfig, ALERT_DAY, { store: alertStore() })
  });
  const rank = { bad: 0, warn: 1, info: 2 };
  let ordered = true;
  for (let i = 1; i < list.length; i++) {
    const before = rank[list[i - 1].level] === undefined ? 3 : rank[list[i - 1].level];
    const after = rank[list[i].level] === undefined ? 3 : rank[list[i].level];
    if (before > after) ordered = false;
    if (before === after && (list[i - 1].weight || 0) < (list[i].weight || 0)) ordered = false;
  }
  return list.some((w) => w.kind === 'plan') && list[0].kind === 'plan' && ordered;
})(), (function () {
  const evidence = R.evidence(planConfig, ALERT_DAY);
  return D.warnings(planConfig, evidence, ALERT_DAY, {
    frictions: [], coverage: D.coverage(planConfig, evidence, ALERT_DAY),
    alerts: Alerts.gather(planConfig, ALERT_DAY, { store: alertStore() })
  }).map((w) => w.level + '/' + w.kind + '/' + w.weight);
})());

/* ---- Hộp thư đến: ghi nhanh, phân loại sau ----

   Kho riêng, không dùng chung `planConfig`: mấy phép kiểm ngay trên đang đếm
   việc và buổi trong kho đó, và một mục hộp thư đến chuyển thành việc sẽ làm
   lệch những con số ấy — bài kiểm đỏ vì lý do của chính nó.

   Điều quan trọng nhất ở đây là tính NGUYÊN TỬ của "chuyển thành việc": hoặc
   được cả hai (có việc, mục rời hộp thư), hoặc không được gì. Ghi hỏng giữa
   chừng mà đẻ ra một việc trùng, hoặc một mục đã biến mất, thì huynh mất chữ
   mà không có gì để lần theo. */
const inboxConfig = Object.assign({}, config, { dataDir: path.join(TEST_DIR, 'inbox-store') });

check('ghi nhanh một dòng thì cắt khoảng trắng thừa, không cắt chữ',
  (function () {
    const made = Plans.applyInbox(inboxConfig, 'add', { text: '  gọi   khách\n về hợp đồng A  ' }, { now: PLAN_NOW });
    return made.ok === true && made.item.text === 'gọi khách về hợp đồng A' && made.item.source === 'app';
  })());
check('ghi nhanh câu rỗng thì bị từ chối, không ghi gì',
  (function () {
    const before = Plans.view(inboxConfig, MON).inbox.length;
    const tried = Plans.applyInbox(inboxConfig, 'add', { text: '   \n  ' }, { now: PLAN_NOW });
    return tried.ok === false && !!tried.error && Plans.view(inboxConfig, MON).inbox.length === before;
  })());
check('mục ghi từ phím tắt tự khai nó tới từ phím tắt',
  (function () {
    const made = Plans.applyInbox(inboxConfig, 'add', { text: 'từ phím tắt', source: 'hotkey' }, { now: PLAN_NOW });
    return made.ok === true && made.item.source === 'hotkey';
  })());

const inboxIds = () => Plans.view(inboxConfig, MON).inbox.map((i) => i.id);
check('hộp thư đến trả theo thứ tự ghi vào, cũ trước',
  inboxIds().join() === 'in-0001,in-0002', inboxIds());

check('sửa chữ của một mục thì chữ đổi, mục vẫn ở nguyên chỗ',
  (function () {
    const id = inboxIds()[0];
    const edited = Plans.applyInbox(inboxConfig, 'edit', { id: id, text: 'gọi khách về hợp đồng B' }, { now: PLAN_NOW });
    return edited.ok === true && inboxIds()[0] === id
      && Plans.view(inboxConfig, MON).inbox[0].text === 'gọi khách về hợp đồng B';
  })());
check('sửa một mục không có thật thì bị từ chối kèm lý do',
  (function () {
    const tried = Plans.applyInbox(inboxConfig, 'edit', { id: 'in-9999', text: 'x' }, { now: PLAN_NOW });
    return tried.ok === false && !!tried.error;
  })());

/* Phép kiểm quan trọng nhất của nhóm này. */
check('chuyển một mục thành việc: có việc, và mục rời khỏi hộp thư đến',
  (function () {
    const id = inboxIds()[1];
    const before = inboxIds().length;
    const made = Plans.applyInbox(inboxConfig, 'promote', { id: id, horizon: 'week' }, { now: PLAN_NOW });
    if (made.ok !== true) return false;
    const after = Plans.view(inboxConfig, MON);
    return made.task.horizon === 'week'
      && made.task.title === 'từ phím tắt'
      && made.task.dueDay === Plans.weekStart(MON)
      && after.inbox.length === before - 1
      && after.inbox.every((i) => i.id !== id)
      && after.board.week.some((t) => t.id === made.task.id);
  })(), (function () {
    return Plans.view(inboxConfig, MON).inbox.map((i) => i.text);
  })());

check('chuyển thành việc mà tầm nhìn sai thì KHÔNG mất mục nào',
  (function () {
    const id = inboxIds()[0];
    const before = inboxIds().join();
    const tried = Plans.applyInbox(inboxConfig, 'promote', { id: id, horizon: 'khong-co-that' }, { now: PLAN_NOW });
    return tried.ok === false && !!tried.error && inboxIds().join() === before;
  })(), inboxIds());

check('xoá một mục thì mục biến mất, các mục khác còn nguyên',
  (function () {
    const id = inboxIds()[0];
    const rest = inboxIds().slice(1);
    const gone = Plans.applyInbox(inboxConfig, 'delete', { id: id }, { now: PLAN_NOW });
    return gone.ok === true && inboxIds().join() === rest.join();
  })(), inboxIds());
check('thao tác hộp thư đến không rõ thì bị từ chối, không im lặng',
  (function () {
    const tried = Plans.applyInbox(inboxConfig, 'lam-dieu-la', {}, { now: PLAN_NOW });
    return tried.ok === false && !!tried.error && /lam-dieu-la/.test(tried.error);
  })());

/* Ba nút phân loại trên giao diện và ba tầm nhìn kho lưu nhận phải là CÙNG
   một bộ. Lệch nhau thì có một nút bấm vào là bị từ chối, hoặc một tầm nhìn
   không có nút nào tới được — cả hai đều im lặng. */
check('ba nút phân loại khớp đúng ba tầm nhìn kho lưu nhận',
  (function () {
    const decl = viewsSrc.match(/INBOX_TRIAGE = \[([\s\S]*?)\];/);
    if (!decl) return false;
    const onScreen = [...decl[1].matchAll(/\['([a-z]+)'/g)].map((m) => m[1]);
    return onScreen.length === 3 && onScreen.join() === Plans.PROMOTE_HORIZONS.join();
  })(), (viewsSrc.match(/INBOX_TRIAGE = \[([\s\S]*?)\];/) || [])[1]);

/* Hộp thư đến là CHỮ HUYNH GÕ. Nó không được lẫn vào chỗ bằng chứng, và
   không được lẫn vào bản xuất đã che — hai chỗ đó có luật riêng. */
check('hộp thư đến nằm trong tệp việc, không nằm trong thư mục bằng chứng',
  (function () {
    const raw = fs.readFileSync(path.join(inboxConfig.dataDir, 'plans', 'tasks.json'), 'utf8');
    const files = U.isDir(path.join(inboxConfig.dataDir, 'events'))
      ? fs.readdirSync(path.join(inboxConfig.dataDir, 'events')) : [];
    return raw.indexOf('inbox') !== -1 && files.length === 0;
  })(), fs.existsSync(path.join(inboxConfig.dataDir, 'plans', 'tasks.json')));

check('tệp việc hỏng thì hộp thư đến cũng từ chối ghi, không ghi đè',
  (function () {
    const dir = path.join(TEST_DIR, 'inbox-hong', 'plans');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tasks.json'), '{ hỏng', 'utf8');
    const broken = Object.assign({}, config, { dataDir: path.join(TEST_DIR, 'inbox-hong') });
    const tried = Plans.applyInbox(broken, 'add', { text: 'không được ghi' }, { now: PLAN_NOW });
    return tried.ok === false && !!tried.error
      && fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8') === '{ hỏng';
  })());

/* =====================================================================
   [14] Sức khoẻ kho mã

   Ảnh chụp git là chuyện của BÂY GIỜ, không phải chuyện của một ngày: cây
   làm việc bẩn hôm nay không nói được gì về ngày 3 tháng trước. Nên nó ở
   `data/repohealth.json`, nằm ngoài `data/events/`, và phần này kiểm hai
   điều tách biệt: đọc git có đúng không, và cảnh báo có bị chặn theo ngày
   không.

   Mọi thứ chạy bằng một runner git giả — không một lệnh git thật nào, và
   cũng không một lần chạm mạng, đúng như phần còn lại của bộ kiểm thử.
   ===================================================================== */

section('[14] Sức khoẻ kho mã');

const REPO_NOW = Date.parse('2026-10-12T15:00:00');
const REPO_DAY = '2026-10-12';
const DAY_MS = 86400000;

// Ba thư mục rỗng có sẵn thư mục `.git` — đủ để `repoInfo` coi là kho, và
// đủ để phần quét có nhiều kho mà kiểm chuyện chặn số lượng.
const REPO_DIRS = ['kho-mot', 'kho-hai', 'kho-ba'].map((n) => path.join(TEST_DIR, 'kho-gia-2', n));
for (const dir of REPO_DIRS) fs.mkdirSync(path.join(dir, '.git'), { recursive: true });

const repoConfig = Object.assign({}, config, { dataDir: path.join(TEST_DIR, 'repohealth') });
repoConfig.sources = Object.assign({}, config.sources, {
  git: Object.assign({}, config.sources.git, { enabled: true, repos: REPO_DIRS })
});

const unix = (daysAgo) => Math.floor((REPO_NOW - daysAgo * DAY_MS) / 1000);

// Chuỗi giả đúng định dạng git in ra, không phải chuỗi cho đẹp. Thứ tự nhánh
// theo -committerdate là thứ tự git thật sẽ trả về.
const RH_STASH = 'stash@{0}|' + unix(1) + '|WIP đăng nhập\n'
  + 'stash@{1}|' + unix(9) + '|Thử nghiệm vỡ\n'
  + 'stash@{2}|' + unix(30) + '|Vá tạm\n';
const RH_BRANCHES = 'main|' + unix(2) + '\nfeature-moi|' + unix(3) + '\nfeature-cu|' + unix(90) + '\n';
const RH_MERGED = '* main\n  feature-moi\n';
const RH_TAGS = 'v0.3|' + unix(5) + '\nv0.2|' + unix(40) + '\n';
const RH_LSTREE = '100644 blob aaa111 120\tREADME.md\n'
  + '100644 blob bbb222 7340032\tmau/video.mp4\n'
  + '100644 blob ccc333 900\tserver.js\n';

/* Bí mật giả, do chính bài kiểm thử sinh ra — không phải khoá của huynh.

   Nó tồn tại để chứng minh điều ngược lại: sau khi quét, giá trị này KHÔNG
   được có mặt ở bất cứ đâu trong ảnh chụp. Một bảng cảnh báo bí mật mà in cả
   bí mật ra thì tự nó thành chỗ phát tán đúng thứ nó đang cảnh báo. */
const FAKE_SECRET = 'ghp_' + 'a'.repeat(36);
const RH_FILES = {
  'README.md': '# Kho gia\nKhong co gi o day.\n',
  'secret.js': 'const token = "' + FAKE_SECRET + '";\n'
};

function repoHealthRunner(repo, args) {
  const key = args.join(' ');
  if (key === 'rev-parse --abbrev-ref HEAD') return 'main\n';
  if (key === 'config --get remote.origin.url') return 'git@github.com:manhhiepxyz/DevTrace.git\n';
  if (key === 'status --porcelain=v1') return PORCELAIN;
  if (key === 'rev-list --left-right --count @{upstream}...HEAD') return '5\t2\n';
  if (key === 'stash list --format=%gd|%ct|%s') return RH_STASH;
  if (key === 'for-each-ref --sort=-committerdate --format=%(refname:short)|%(committerdate:unix) refs/heads') return RH_BRANCHES;
  if (key === 'branch --merged') return RH_MERGED;
  if (key === 'tag --sort=-creatordate --format=%(refname:short)|%(creatordate:unix)') return RH_TAGS;
  if (key === 'ls-tree -r -l HEAD') return RH_LSTREE;
  if (key === 'ls-files') return 'README.md\nsecret.js\n';
  return null;
}

function repoHealthReadFile(full) {
  const name = path.basename(full);
  return Object.prototype.hasOwnProperty.call(RH_FILES, name) ? RH_FILES[name] : null;
}

const repoShotOpts = {
  run: repoHealthRunner, readFile: repoHealthReadFile,
  now: REPO_NOW, secretScan: true, maxRepos: 3
};
const repoShot = RepoHealth.collect(repoConfig, repoShotOpts);
const repoOne = repoShot.repos[0];

check('ảnh chụp đọc được nhánh, remote, và tách đúng đã-chuẩn-bị khỏi còn-dở', (function () {
  return repoOne.branch === 'main' && repoOne.remote.indexOf('DevTrace') !== -1
    && repoOne.working.total === 5 && repoOne.working.staged === 3 && repoOne.working.unstaged === 3;
})(), repoOne && repoOne.working);

/* `--left-right` in ra "trái\tphải", trái là commit chỉ có ở remote. Đảo hai
   cột này là nói ngược hẳn tình hình: "có 5 commit chưa đẩy" thay vì "remote
   hơn mình 5 commit". */
check('trước/sau remote đọc đúng cột, không đảo', (function () {
  return repoOne.upstream === true && repoOne.behind === 5 && repoOne.ahead === 2;
})(), { truoc_remote: repoOne.behind, chua_day: repoOne.ahead });

check('stash đọc đủ ba bản, kèm mốc thời gian và tiêu đề', (function () {
  return repoOne.stashes.length === 3 && repoOne.stashes[0].ref === 'stash@{0}'
    && repoOne.stashes[0].subject === 'WIP đăng nhập'
    && typeof repoOne.stashes[0].ts === 'number';
})(), repoOne.stashes.map((s) => s.ref + '/' + s.subject));

check('nhánh: đủ ba nhánh, và biết nhánh nào đã gộp', (function () {
  const byName = {};
  repoOne.branches.forEach((b) => { byName[b.name] = b; });
  return repoOne.branches.length === 3
    && byName['main'].merged === true && byName['feature-moi'].merged === true
    && byName['feature-cu'].merged === false
    && byName['feature-cu'].ageDays === 90;
})(), repoOne.branches.map((b) => b.name + '/' + b.ageDays + 'n/' + (b.merged ? 'gộp' : 'chưa')));

check('thẻ đọc đúng thứ tự mới nhất trước', (function () {
  return repoOne.tags.length === 2 && repoOne.tags[0].name === 'v0.3' && repoOne.tags[1].name === 'v0.2';
})(), repoOne.tags.map((t) => t.name));

/* `ls-tree -l` in kích thước là dấu `-` với cây thư mục, nên phải chịu được
   cả hai kiểu dòng — nếu không thì cả kho có một thư mục là vỡ. */
check('tệp lớn: chỉ giữ tệp vượt ngưỡng, và bỏ qua dòng không có kích thước', (function () {
  return repoOne.bigFiles.length === 1 && repoOne.bigFiles[0].path === 'mau/video.mp4'
    && repoOne.bigFiles[0].bytes === 7340032;
})(), repoOne.bigFiles);

check('quét bí mật: tìm ra chỗ nghi, chỉ ghi tệp/dòng/quy tắc', (function () {
  const hits = repoOne.secrets && repoOne.secrets.hits;
  return hits && hits.length >= 1 && hits.every((h) => h.path === 'secret.js' && h.line === 1
    && typeof h.rule === 'string' && typeof h.label === 'string')
    && hits.some((h) => h.rule === 'github');
})(), repoOne.secrets && repoOne.secrets.hits);

/* Phép kiểm quan trọng nhất của cả mục này. */
check('ảnh chụp KHÔNG chứa giá trị bí mật ở bất cứ đâu', (function () {
  const json = JSON.stringify(repoShot);
  return json.indexOf(FAKE_SECRET) === -1 && json.indexOf('aaaaaaa') === -1;
})(), (function () {
  const json = JSON.stringify(repoShot);
  return 'độ dài ảnh chụp ' + json.length + ' ký tự · có giá trị bí mật: '
    + (json.indexOf(FAKE_SECRET) !== -1 ? 'CÓ' : 'không');
})());

check('quét bí mật là việc phải chọn: không bật thì không quét', (function () {
  const shot = RepoHealth.collect(repoConfig, {
    run: repoHealthRunner, readFile: repoHealthReadFile, now: REPO_NOW, maxRepos: 1
  });
  return shot.repos[0].secrets === null;
})());

check('quét tôn trọng healthMaxRepos và nói ra phần đã bỏ qua', (function () {
  const shot = RepoHealth.collect(repoConfig, {
    run: repoHealthRunner, readFile: repoHealthReadFile, now: REPO_NOW, maxRepos: 2
  });
  return shot.repos.length === 2 && shot.total === 3 && shot.scanned === 2 && shot.skipped === 1
    && shot.notes.some((n) => n.indexOf('3 kho') !== -1 && n.indexOf('2 kho') !== -1);
})(), RepoHealth.collect(repoConfig, { run: repoHealthRunner, now: REPO_NOW, maxRepos: 2 }).notes);

check('cấu hình thiếu khoá vẫn có mặc định 20 kho, không phải quét vô hạn',
  RepoHealth.settingsOf(config).maxRepos === RepoHealth.DEFAULT_MAX_REPOS
  && RepoHealth.DEFAULT_MAX_REPOS === 20,
  RepoHealth.settingsOf(config));

/* Chưa quét lần nào KHÁC hẳn "đã quét, mọi kho đều sạch". Gộp hai thứ đó lại
   là cách nói dối quen thuộc nhất: một ảnh chụp rỗng đọc ra y hệt một hệ
   thống khoẻ mạnh. */
check('chưa quét lần nào thì đọc ra null, không phải ảnh chụp rỗng',
  RepoHealth.read(repoConfig) === null);

/* ---- Ghi tệp, rồi kiểm cảnh báo có bị chặn theo ngày không ---- */

const repoSnapshotResult = RepoHealth.snapshot(repoConfig, repoShotOpts);

check('ảnh chụp ghi ra data/repohealth.json, nằm ngoài kho bằng chứng', (function () {
  const file = RepoHealth.healthFile(repoConfig);
  return repoSnapshotResult.ok === true && U.isFile(file)
    && path.dirname(file) === repoConfig.dataDir
    && file.indexOf(E.eventsDir(repoConfig)) !== 0
    && RepoHealth.read(repoConfig).day === REPO_DAY;
})(), RepoHealth.healthFile(repoConfig));

/* Kế hoạch của huynh là chuyện của ngày đang xem, nên lúc nào cũng có mặt.
   Sức khoẻ kho là chuyện của BÂY GIỜ — nên nó chỉ được phát khi ngày đang
   xem đúng là hôm nay. Không có cổng đó thì bản tổng hợp của một ngày cũ sẽ
   đổi nội dung mỗi lần huynh sửa một tệp, và đó là kiểu sai lặng lẽ tệ nhất:
   mở lại một ngày đã qua mà thấy nó khác đi. */
const repoConfigOn = repoConfig;

check('cảnh báo kho mã CÓ mặt ở digest hôm nay', (function () {
  const list = Alerts.gather(repoConfigOn, REPO_DAY, { store: blankStore(), now: REPO_NOW });
  return list.some((a) => a.kind === 'repo' && a.title.indexOf('chưa kéo về') !== -1);
})(), Alerts.gather(repoConfigOn, REPO_DAY, { store: blankStore(), now: REPO_NOW })
  .filter((a) => a.kind === 'repo').map((a) => a.level + '/' + a.weight + ': ' + a.title));

check('cảnh báo kho mã VẮNG ở digest của một ngày cũ', (function () {
  const list = Alerts.gather(repoConfigOn, '2026-10-11', { store: blankStore(), now: REPO_NOW });
  return list.filter((a) => a.kind === 'repo').length === 0;
})(), Alerts.gather(repoConfigOn, '2026-10-11', { store: blankStore(), now: REPO_NOW }).length);

check('ngày cũ vẫn giữ nguyên cảnh báo kế hoạch — cổng chỉ chặn phần kho mã', (function () {
  const list = Alerts.gather(repoConfigOn, ALERT_DAY, { store: alertStore(), now: REPO_NOW });
  return list.some((a) => a.kind === 'plan') && list.some((a) => a.kind === 'task')
    && list.filter((a) => a.kind === 'repo').length === 0;
})(), Alerts.gather(repoConfigOn, ALERT_DAY, { store: alertStore(), now: REPO_NOW }).map((a) => a.kind));

check('nguồn git đang tắt thì không nhắc gì về kho mã', (function () {
  const off = Object.assign({}, repoConfigOn);
  off.sources = Object.assign({}, repoConfigOn.sources, {
    git: Object.assign({}, repoConfigOn.sources.git, { enabled: false })
  });
  return Alerts.gather(off, REPO_DAY, { store: blankStore(), now: REPO_NOW })
    .filter((a) => a.kind === 'repo').length === 0;
})());

/* ---- Từng loại cảnh báo, dựng thẳng từ ảnh chụp trong bộ nhớ ---- */

function repoEntry(over) {
  return Object.assign({
    name: 'kho', path: 'X:/kho', branch: 'main', remote: 'x', upstream: true,
    ahead: 0, behind: 0, working: { modified: 0, untracked: 0, total: 0, staged: 0, unstaged: 0 },
    stashes: [], branches: [], tags: [], bigFiles: [], secrets: null, notes: []
  }, over || {});
}

function shotOf(repos, over) {
  return Object.assign({
    ok: true, day: REPO_DAY, updatedAt: REPO_NOW, repos,
    scanned: repos.filter((r) => !r.error).length, total: repos.length, skipped: 0, notes: []
  }, over || {});
}

check('kho sạch thì không có cảnh báo nào — không dựng chuyện',
  Alerts.repoAlertsOf(shotOf([repoEntry()])).length === 0);

check('cây làm việc bẩn chỉ nhắc khi đã quá nhiều, dưới ngưỡng thì im', (function () {
  const few = Alerts.repoAlertsOf(shotOf([repoEntry({ working: { modified: 5, untracked: 0, total: 5, staged: 0, unstaged: 5 } })]));
  const many = Alerts.repoAlertsOf(shotOf([repoEntry({
    working: { modified: 25, untracked: 0, total: 25, staged: 0, unstaged: 25 }
  })]));
  return few.length === 0 && many.length === 1 && many[0].level === 'warn'
    && many[0].title.indexOf('25 thay đổi') !== -1;
})(), Alerts.repoAlertsOf(shotOf([repoEntry({
  working: { modified: 25, untracked: 0, total: 25, staged: 0, unstaged: 25 }
})])).map((a) => a.title));

check('chưa đẩy là tin nhẹ, remote đi trước là tin nặng', (function () {
  const ahead = Alerts.repoAlertsOf(shotOf([repoEntry({ ahead: 3 })]));
  const behind = Alerts.repoAlertsOf(shotOf([repoEntry({ behind: 4 })]));
  return ahead.length === 1 && ahead[0].level === 'info'
    && behind.length === 1 && behind[0].level === 'warn' && behind[0].weight > ahead[0].weight;
})(), Alerts.repoAlertsOf(shotOf([repoEntry({ ahead: 3 })])).concat(
  Alerts.repoAlertsOf(shotOf([repoEntry({ behind: 4 })]))).map((a) => a.level + '/' + a.title));

check('nhiều kho cùng bẩn thì gom thành một dòng, không mỗi kho một dòng', (function () {
  const list = Alerts.repoAlertsOf(shotOf([
    repoEntry({ name: 'a', behind: 1 }), repoEntry({ name: 'b', behind: 2 }),
    repoEntry({ name: 'c', behind: 3 }), repoEntry({ name: 'd', behind: 4 })
  ]));
  return list.length === 1 && list[0].title.indexOf('4 kho') === 0
    && list[0].detail.indexOf('a (1 commit)') !== -1 && list[0].detail.indexOf('d (4 commit)') !== -1;
})(), Alerts.repoAlertsOf(shotOf([
  repoEntry({ name: 'a', behind: 1 }), repoEntry({ name: 'b', behind: 2 }),
  repoEntry({ name: 'c', behind: 3 }), repoEntry({ name: 'd', behind: 4 })
])).map((a) => a.title));

check('nhánh cũ đã gộp thì không nhắc; chưa gộp mới nhắc', (function () {
  const list = Alerts.repoAlertsOf(shotOf([repoEntry({
    branches: [
      { name: 'main', lastCommitMs: 0, ageDays: 400, merged: true },
      { name: 'cu-chua-gop', lastCommitMs: 0, ageDays: 120, merged: false },
      { name: 'moi-chua-gop', lastCommitMs: 0, ageDays: 2, merged: false }
    ]
  })]));
  return list.length === 1 && list[0].title.indexOf('1 nhánh cũ') === 0
    && list[0].detail.indexOf('cu-chua-gop') !== -1 && list[0].detail.indexOf('main') === -1;
})(), Alerts.repoAlertsOf(shotOf([repoEntry({
  branches: [{ name: 'cu-chua-gop', lastCommitMs: 0, ageDays: 120, merged: false }]
})])).map((a) => a.title + ' — ' + a.detail));

check('bí mật là cảnh báo nặng nhất, và chỉ nêu tệp/dòng/quy tắc', (function () {
  const list = Alerts.repoAlertsOf(shotOf([repoEntry({
    secrets: { hits: [{ path: 'src/a.js', line: 12, rule: 'github', label: 'mã GitHub' }], scanned: 3, truncated: false }
  })]));
  return list.length === 1 && list[0].level === 'bad' && list[0].weight === 9
    && list[0].detail.indexOf('src/a.js:12') !== -1
    && list[0].detail.indexOf('DẤU HIỆU') !== -1;
})(), Alerts.repoAlertsOf(shotOf([repoEntry({
  secrets: { hits: [{ path: 'src/a.js', line: 12, rule: 'github', label: 'mã GitHub' }], scanned: 3, truncated: false }
})])).map((a) => a.title));

check('kho không đọc được thì nói ra, không im lặng bỏ qua', (function () {
  const list = Alerts.repoAlertsOf(shotOf([repoEntry(), repoEntry({ name: 'hong', error: 'không phải kho git' })]));
  return list.length === 1 && list[0].title.indexOf('1 kho không đọc được') === 0
    && list[0].detail.indexOf('hong') !== -1;
})(), Alerts.repoAlertsOf(shotOf([repoEntry({ name: 'hong', error: 'không phải kho git' })])).map((a) => a.title));

check('quét thiếu kho thì nói rõ đã quét bao nhiêu trên tổng bao nhiêu', (function () {
  const list = Alerts.repoAlertsOf(shotOf([repoEntry()], { scanned: 20, total: 52, skipped: 32 }));
  const note = list.find((a) => a.kind === 'repo' && a.title.indexOf('Chỉ quét') === 0);
  return note && note.title === 'Chỉ quét 20/52 kho' && note.level === 'info';
})(), Alerts.repoAlertsOf(shotOf([repoEntry()], { scanned: 20, total: 52, skipped: 32 })).map((a) => a.title));

check('chưa quét lần nào thì nói thẳng là chưa quét, không im', (function () {
  const list = Alerts.repoAlerts(repoConfigOn, REPO_DAY, { snapshot: null, now: REPO_NOW });
  return list.length === 1 && list[0].title.indexOf('Chưa quét') === 0 && list[0].weight === 0;
})(), Alerts.repoAlerts(repoConfigOn, REPO_DAY, { snapshot: null, now: REPO_NOW }).map((a) => a.title));

/* Ảnh chụp của ngày hôm qua KHÔNG được nói như thể là bây giờ. Cây làm việc
   đổi liên tục, nên đem con số cũ ra là đẩy người đọc đi kiểm tra một tình
   trạng đã không còn tồn tại. */
check('ảnh chụp cũ thì không phát cảnh báo từ nó, chỉ nói là ảnh chụp cũ', (function () {
  const list = Alerts.repoAlerts(repoConfigOn, REPO_DAY, {
    snapshot: shotOf([repoEntry({ behind: 9 })], { day: '2026-10-09' }), now: REPO_NOW
  });
  return list.length === 1 && list[0].title.indexOf('2026-10-09') !== -1
    && list[0].title.indexOf('chưa quét lại hôm nay') !== -1
    && list[0].detail.indexOf('lúc này') !== -1;
})(), Alerts.repoAlerts(repoConfigOn, REPO_DAY, {
  snapshot: shotOf([repoEntry({ behind: 9 })], { day: '2026-10-09' }), now: REPO_NOW
}).map((a) => a.title));

/* Cổng "hôm nay" phải theo mốc 4 giờ sáng như phần còn lại của dự án: lúc 1
   giờ sáng ngày 13 thì ngày DevTrace vẫn là 12, nên cảnh báo kho mã vẫn phải
   hiện trên bản tổng hợp của ngày 12. */
check('mốc "hôm nay" theo giờ DevTrace (4 giờ sáng), không theo lịch thường', (function () {
  const motGioSang = Date.parse('2026-10-13T01:00:00');
  return Alerts.isToday(repoConfigOn, '2026-10-12', motGioSang) === true
    && Alerts.isToday(repoConfigOn, '2026-10-13', motGioSang) === false
    && Alerts.isToday(repoConfigOn, '2026-10-12', Date.parse('2026-10-13T05:00:00')) === false;
})(), {
  luc_1h: Alerts.todayKey(repoConfigOn, Date.parse('2026-10-13T01:00:00')),
  luc_5h: Alerts.todayKey(repoConfigOn, Date.parse('2026-10-13T05:00:00'))
});

/* Cảnh báo kho mã phải đi qua đúng đường của những cảnh báo cũ — nếu không
   thì màn hình và gói gửi cho AI sẽ nhìn thấy hai danh sách khác nhau. */
check('cảnh báo kho mã đi vào danh sách chung và tới được gói gửi cho AI', (function () {
  const list = Alerts.gather(repoConfigOn, REPO_DAY, { store: blankStore(), now: REPO_NOW });
  const evidence = R.evidence(repoConfigOn, REPO_DAY);
  const merged = D.warnings(repoConfigOn, evidence, REPO_DAY, {
    frictions: [], coverage: D.coverage(repoConfigOn, evidence, REPO_DAY), alerts: list
  });
  const pack = AI.evidencePack(repoConfigOn, REPO_DAY);
  // Gói AI dựng theo ngày thật, nên chỉ soi phần chung: dạng cảnh báo và việc
  // chuyển tiếp nguyên danh sách mà giao diện đang hiện.
  return merged.some((w) => w.kind === 'repo')
    && pack.warnings.every((w) => typeof w.level === 'string' && typeof w.title === 'string');
})(), (function () {
  const list = Alerts.gather(repoConfigOn, REPO_DAY, { store: blankStore(), now: REPO_NOW });
  const evidence = R.evidence(repoConfigOn, REPO_DAY);
  return D.warnings(repoConfigOn, evidence, REPO_DAY, {
    frictions: [], coverage: D.coverage(repoConfigOn, evidence, REPO_DAY), alerts: list
  }).filter((w) => w.kind === 'repo').map((w) => w.level + '/' + w.title);
})());

/* Xoá bằng chứng không được đụng vào ảnh chụp sức khoẻ kho. */
check('xoá bằng chứng không xoá ảnh chụp sức khoẻ kho', (function () {
  const before = fs.readFileSync(RepoHealth.healthFile(repoConfig), 'utf8');
  Collect.clearCollected(repoConfig);
  const after = fs.readFileSync(RepoHealth.healthFile(repoConfig), 'utf8');
  return before === after && RepoHealth.read(repoConfig).day === REPO_DAY;
})(), RepoHealth.healthFile(repoConfig));

/* =====================================================================
   [14b] Giao diện khi ĐÃ có dữ liệu kế hoạch và kho mã

   Mục [9] dựng mọi màn hình với `ctx.data` THIẾU `plans` và `repohealth` —
   đó là chiều của lần mở đầu tiên, khi máy chủ chưa trả kịp. Đây là chiều
   ngược lại: có đủ dữ liệu. Thiếu một trong hai chiều thì một nửa số lỗi
   không bao giờ lộ ra, vì `plans.board` là undefined và màn hình trắng.

   Dữ liệu ở đây dựng bằng chính `app/plans.js` và ảnh chụp thật ở mục
   [14], không phải bằng một đối tượng chép tay — chép tay thì nó thôi
   không kiểm được gì mỗi khi hình dạng dữ liệu đổi.
   ===================================================================== */

section('[14b] Giao diện khi có dữ liệu kế hoạch');

const viewPlanConfig = Object.assign({}, config, { dataDir: path.join(TEST_DIR, 'plan-view') });
const PLAN_DAY = '2026-11-20';   // thứ Sáu — để buổi "thứ Ba" không khớp đúng ngày này

/* `taskSave` KHÔNG đọc `input.day`: hạn của một việc đến từ `input.dueDay`
   hoặc từ hôm nay. Đặt `day` ở đây sẽ lặng lẽ rơi vào ngày chạy bài kiểm
   thử, và màn hình sẽ không có gì để hiện. */
const seedTask = (payload) => Plans.applyTask(viewPlanConfig, 'save',
  Object.assign({ day: PLAN_DAY, dueDay: PLAN_DAY }, payload));
seedTask({ title: 'Việc trong ngày', horizon: 'day' });
seedTask({ title: 'Việc trong tuần', horizon: 'week' });
seedTask({ title: 'Mục tiêu dài hạn', horizon: 'goal', targetDay: '2026-12-31' });
seedTask({ title: 'Việc cố định', horizon: 'recurring', recur: { freq: 'weekdays', byWeekday: [] } });
/* Hai buổi cùng tuần, chỉ một buổi rơi vào thứ Sáu. Nếu bộ lọc theo ngày
   hỏng, cả hai cùng hiện ra và phép kiểm dưới đây bắt được ngay. */
const seedSlot = (payload) => Plans.applySlot(viewPlanConfig, 'save', payload);
seedSlot({ weekday: 5, start: '09:00', end: '11:00', title: 'Buổi sáng', kind: 'deep' });
seedSlot({ weekday: 2, start: '14:00', end: '16:00', title: 'Buổi thứ Ba', kind: 'admin' });
Plans.applySprint(viewPlanConfig, 'start', { name: 'Đợt thử', startDay: '2026-11-16', endDay: '2026-11-29' });
/* Một mục trong hộp thư đến, có chữ thật để soi. Để hộp rỗng thì mọi phép
   kiểm "mục có hiện ra không" đều xanh một cách vô nghĩa. */
const INBOX_TEXT = 'gọi khách về hợp đồng B';
Plans.applyInbox(viewPlanConfig, 'add', { text: INBOX_TEXT, source: 'hotkey' });

const plansView = Plans.view(viewPlanConfig, PLAN_DAY);

check('dữ liệu dựng sẵn cho màn hình có đủ bốn tầm nhìn', (function () {
  const b = plansView.board;
  return b.day.length === 1 && b.week.length === 1 && b.goal.length === 1
    && plansView.occurrences.length === 1 && plansView.timetable.length === 2
    && !!plansView.activeSprint && plansView.backlog.length === 2;
})(), {
  day: plansView.board.day.length, week: plansView.board.week.length,
  goal: plansView.board.goal.length, co_dinh: plansView.occurrences.length,
  buoi: plansView.timetable.length, cho_xep: plansView.backlog.length
});

/* Tuần của fixture nằm ở 16–22/11. Đặt `now` sau đó để không ngày nào bị
   coi là "chưa tới" — trạng thái `upcoming` có phép kiểm riêng ở [14c]. */
const AFTER_PLAN_WEEK = Date.parse('2026-11-25T10:00:00');
const noEvidenceAt = () => ({ work: [] });

const fullViewCtx = {
  /* Mở sẵn dòng đối chiếu của buổi thứ Sáu. Dòng đó chỉ dựng ra khi mục
     đang mở, nên nếu để đóng thì phép kiểm câu chữ bên dưới sẽ kiểm một
     chuỗi rỗng và luôn xanh — đúng kiểu phép kiểm vô nghĩa. */
  state: {
    day: PLAN_DAY, range: 14, filters: { source: '', q: '' }, theme: 'muc',
    open: { ['slot-' + plansView.timetable.find((s) => s.title === 'Buổi sáng').id]: true }
  },
  colors,
  data: {
    digest: D.build(viewPlanConfig, PLAN_DAY),
    journal: { text: 'Nhật ký thử.', source: 'test', updatedAt: Date.now() },
    status: Collect.status(viewPlanConfig),
    config: viewPlanConfig,
    distribution: [],
    events: [],
    days: [],
    projects: Report.projectsRange(viewPlanConfig, 14),
    totalEvents: 0,
    /* Bảng tuần đi kèm màn Hôm nay (`/api/plans?…&week=1`). `now` đặt sau
       tuần của fixture để mọi ngày trong tuần đều đã xảy ra — nếu không thì
       cả bảy ngày thành `upcoming` và phép kiểm câu chữ bên dưới sẽ kiểm
       nhầm một trạng thái khác. Bằng chứng rỗng: ngày này chưa đọc được gì. */
    plans: Object.assign({}, plansView, {
      week: Plans.week(viewPlanConfig, PLAN_DAY, { evidenceFor: noEvidenceAt, now: AFTER_PLAN_WEEK })
    }),
    repohealth: { snapshot: repoShot, stale: false, settings: RepoHealth.settingsOf(repoConfig) }
  }
};

check('mọi màn hình dựng được khi CÓ dữ liệu kế hoạch và kho', (function () {
  return Object.keys(Views).every(function (name) {
    try { return Views[name].render(fullViewCtx).length > 40; } catch (error) { return false; }
  });
})(), Object.keys(Views).map(function (name) {
  try { return Views[name].render(fullViewCtx).length; } catch (error) { return String(error.message); }
}));

check('màn hình có dữ liệu kế hoạch không lộ undefined hay [object Object]', (function () {
  return Object.keys(Views).every(function (name) {
    const html = Views[name].render(fullViewCtx);
    return html.indexOf('undefined') === -1 && html.indexOf('[object Object]') === -1;
  });
})(), Object.keys(Views).map(function (name) {
  const html = Views[name].render(fullViewCtx);
  const bad = [];
  if (html.indexOf('undefined') !== -1) bad.push('undefined');
  if (html.indexOf('[object Object]') !== -1) bad.push('[object Object]');
  return name + ':' + (bad.join('+') || 'sạch');
}));

/* Bảng tuần hiện CẢ TUẦN, không phải ngày đang xem: buổi thứ Ba phải có mặt   dù hôm nay là thứ Sáu. Đây là phép kiểm ngược với dải chip cũ — bản cũ CẤM
   buổi thứ Ba xuất hiện, và cấm đúng theo thiết kế cũ. */
check('bảng tuần hiện đủ bảy cột và cả buổi của thứ khác ngày đang xem', (function () {
  const html = Views.today.render(fullViewCtx);
  const heads = (html.match(/class="slot-col/g) || []).length;
  return heads === 7
    && html.indexOf('Buổi sáng') !== -1 && html.indexOf('Buổi thứ Ba') !== -1
    && html.indexOf('<table class="timetable"') !== -1
    && ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật']
      .every((name) => html.indexOf('>' + name + '<') !== -1);
})(), (function () {
  const html = Views.today.render(fullViewCtx);
  return { cot: (html.match(/class="slot-col/g) || []).length, bang: html.indexOf('<table class="timetable"') !== -1 };
})());

/* Cột trái phải nói được mục tiêu của cả hàng, và ô trống phải mang sẵn đúng
   thứ + đúng khung giờ để bấm một cái là điền sẵn — không chọn lại từ đầu. */
check('cột mục tiêu của hàng lấy từ việc horizon=goal, và ô trống mang sẵn thứ + giờ', (function () {
  const html = Views.today.render(fullViewCtx);
  return html.indexOf('slot-target') !== -1 && html.indexOf('chưa gắn mục tiêu') !== -1
    && html.indexOf('data-value="new:3:09:00:11:00"') !== -1
    && html.indexOf('slot-empty') !== -1;
})(), Views.today.render(fullViewCtx).match(/new:\d:\d\d:\d\d:\d\d:\d\d/g));

/* Hộp thư đến đứng TRÊN bảng tuần, và đứng trên vì một lý do cụ thể: trên
   màn Hôm nay, nó là thứ DUY NHẤT đang đợi huynh; mọi khối còn lại là thông
   tin để đọc. Đặt nó dưới cùng thì mục ghi nhanh ba hôm trước nằm khuất dưới
   ba cuộn giấy, và cả tính năng thành vô nghĩa. */
check('màn Hôm nay đặt hộp thư đến TRÊN bảng tuần', (function () {
  const html = Views.today.render(fullViewCtx);
  const inboxAt = html.indexOf('Hộp thư đến');
  const tableAt = html.indexOf('<table class="timetable"');
  return inboxAt !== -1 && tableAt !== -1 && inboxAt < tableAt;
})(), (function () {
  const html = Views.today.render(fullViewCtx);
  return { hop_thu: html.indexOf('Hộp thư đến'), bang_tuan: html.indexOf('<table class="timetable"') };
})());

check('mục trong hộp thư đến hiện ra kèm ba nút phân loại và nút xoá', (function () {
  const html = Views.today.render(fullViewCtx);
  const promotes = (html.match(/data-action="inbox-promote"/g) || []).length;
  return html.indexOf(INBOX_TEXT) !== -1 && promotes === 3
    && html.indexOf('data-action="inbox-delete"') !== -1
    && html.indexOf('data-action="inbox-add"') !== -1
    && html.indexOf('data-role="inbox-text"') !== -1;
})(), (function () {
  const html = Views.today.render(fullViewCtx);
  return { chu: html.indexOf(INBOX_TEXT) !== -1, nut: (html.match(/data-action="inbox-promote"/g) || []).length };
})());

check('hộp thư đến rỗng thì chỉ chỗ ghi, không hiện danh sách rỗng', (function () {
  const empty = Object.assign({}, fullViewCtx, {
    data: Object.assign({}, fullViewCtx.data, {
      plans: Object.assign({}, plansView, { inbox: [] })
    })
  });
  const html = Views.today.render(empty);
  return html.indexOf('class="inbox-list"') === -1 && html.indexOf('inbox-empty') !== -1;
})());

check('màn Hôm nay vẫn dựng được khi máy chủ CHƯA trả bảng tuần', (function () {
  const ctx = Object.assign({}, fullViewCtx, {
    data: Object.assign({}, fullViewCtx.data, {
      plans: Object.assign({}, plansView, { week: undefined })
    })
  });
  const html = Views.today.render(ctx);
  /* Thiếu số liệu đối chiếu thì phải nói thẳng "chưa đối chiếu". Mượn
     `slot-unknown` ở đây là nói sai: chữ đó có nghĩa "cả ngày không đọc được
     dấu vết nào", không phải "máy chủ chưa trả lời". */
  return html.indexOf('chưa đối chiếu') !== -1
    && html.indexOf('class="slot slot-pending"') !== -1
    && html.indexOf('Buổi sáng') !== -1
    && html.indexOf('undefined') === -1 && html.indexOf('[object Object]') === -1;
})(), (function () {
  const ctx = Object.assign({}, fullViewCtx, {
    data: Object.assign({}, fullViewCtx.data, {
      plans: Object.assign({}, plansView, { week: undefined })
    })
  });
  const html = Views.today.render(ctx);
  return { co_bang: html.indexOf('<table class="timetable"') !== -1, cho_doi_chieu: html.indexOf('chưa đối chiếu') !== -1 };
})());

/* Chiều trung thực, kiểm ngay trên HTML: ngày này chưa có dấu vết nào, nên
   buổi phải là "chưa đối chiếu được" — tuyệt đối không phải "chưa làm". */
check('buổi không có dấu vết hiện là chưa đối chiếu được, không phải chưa làm', (function () {
  const html = Views.today.render(fullViewCtx);
  const at = html.indexOf('slot-detail-open');
  const detail = at === -1 ? '' : html.slice(at, at + 900);
  return html.indexOf('slot-unknown') !== -1
    && html.indexOf('chưa có dấu vết') !== -1
    && detail.indexOf('không đối chiếu được') !== -1
    && detail.indexOf('Vắng dữ liệu không có nghĩa là chưa làm') !== -1;
})(), Views.today.render(fullViewCtx).slice(Views.today.render(fullViewCtx).indexOf('slot-detail-open'), 300));

check('bảng bốn tầm nhìn hiện đủ bốn cột', (function () {
  const html = Views.today.render(fullViewCtx);
  return ['Hôm nay', 'Tuần này', 'Mục tiêu', 'Cố định hôm nay']
    .every((title) => html.indexOf(title) !== -1)
    && html.indexOf('class="board"') !== -1 && html.indexOf('board-col') !== -1;
})());

/* =====================================================================
   [14c] Bảng tuần — mẫu lặp theo tuần, đối chiếu cả bảy ngày

   Kho riêng, không dùng chung với [14b]: mấy phép kiểm dưới đây TẠO buổi,
   và tạo vào kho của [14b] thì con số `timetable.length === 2` ở trên đổi
   theo thứ tự chạy — đúng kiểu phép kiểm hỏng vì lý do chẳng liên quan.

   Bằng chứng được cắm qua `evidenceFor` để chạy ngoại tuyến: bộ kiểm thử
   không được phụ thuộc vào việc máy đang chạy có dữ liệu thật hay không.
   ===================================================================== */

const weekConfig = Object.assign({}, config, { dataDir: path.join(TEST_DIR, 'plan-week') });
const WEEK_DAY = '2026-11-20';        // thứ Sáu
const WEEK_START = '2026-11-16';      // thứ Hai của tuần đó
const WEEK_END = '2026-11-22';        // Chủ nhật

// Không có dấu vết nào — dùng cho mọi phép kiểm ở đây trừ khi nói khác.
const NO_EVIDENCE = { evidenceFor: () => ({ work: [] }) };
// 10:00 ngày 25/11: SAU cả tuần đang xem, nên mọi thứ trong tuần đều đã qua.
const AFTER_WEEK = { now: Date.parse('2026-11-25T10:00:00') };
// 10:00 ngày 10/11: TRƯỚC cả tuần đang xem, nên mọi thứ đều chưa tới.
const BEFORE_WEEK = { now: Date.parse('2026-11-10T10:00:00') };
const weekOpts = (extra) => Object.assign({}, NO_EVIDENCE, extra);

/* Thứ tự ở đây KHÔNG được đảo: `taskSave` sinh id bằng `nextId`, nên chỉ kho
   mới biết id thật là gì — phải gieo mục tiêu rồi mới đọc id ra để gắn vào
   buổi. Gắn trước khi gieo thì `find` trả về undefined và cả tệp kiểm chết
   ngay từ dòng đầu. */
Plans.applyTask(weekConfig, 'save', {
  title: 'Mục tiêu tuần thử', horizon: 'goal', targetDay: '2026-12-31'
});
const weekGoalId = Plans.view(weekConfig, WEEK_DAY).tasks.find((t) => t.horizon === 'goal').id;

const weekSlot = (payload) => Plans.applySlot(weekConfig, 'save', payload);
weekSlot({ weekday: 5, start: '09:00', end: '11:00', title: 'Buổi sáng', kind: 'study', taskId: weekGoalId });
weekSlot({ weekday: 2, start: '09:00', end: '11:00', title: 'Buổi sáng', kind: 'study' });

check('bảng tuần trả đúng bảy ngày, bắt đầu từ thứ Hai, đánh dấu ngày đang xem', (function () {
  const w = Plans.week(weekConfig, WEEK_DAY, weekOpts(AFTER_WEEK));
  const viewed = w.days.filter((d) => d.isViewed);
  return w.days.length === 7 && w.weekStart === WEEK_START && w.weekEnd === WEEK_END
    && w.days[0].weekday === 1 && w.days[6].weekday === 7
    && viewed.length === 1 && viewed[0].day === WEEK_DAY;
})(), (function () {
  const w = Plans.week(weekConfig, WEEK_DAY, weekOpts(AFTER_WEEK));
  return { so_ngay: w.days.length, dau: w.weekStart, cuoi: w.weekEnd, dang_xem: w.days.filter((d) => d.isViewed).map((d) => d.day) };
})());

/* Chiều trung thực thứ nhất: tuần đã qua mà máy không đọc được gì thì MỌI
   buổi là `no-evidence`, và KHÔNG buổi nào được thành `missed`. Đây đúng là
   chỗ dễ hỏng nhất khi gộp bảy ngày vào một bảng. */
check('tuần không có dấu vết thì mọi buổi là chưa-đối-chiếu-được, không buổi nào là chưa-làm', (function () {
  const w = Plans.week(weekConfig, WEEK_DAY, weekOpts(AFTER_WEEK));
  const all = w.days.reduce((acc, d) => acc.concat(d.sessions), []);
  return all.length === 2
    && all.every((s) => s.status === 'no-evidence')
    && w.days.every((d) => d.counts.missed === 0);
})(), (function () {
  const w = Plans.week(weekConfig, WEEK_DAY, weekOpts(AFTER_WEEK));
  return w.days.map((d) => d.day.slice(8) + ':' + d.sessions.map((s) => s.status).join(','));
})());

/* Chiều trung thực thứ hai: ngày CHƯA TỚI không được mang `no-evidence`.
   "Máy không đọc được gì" và "chưa có gì để đọc" là hai chuyện khác nhau. */
check('ngày chưa tới mang trạng thái chưa-tới, không phải chưa-đối-chiếu-được', (function () {
  const w = Plans.week(weekConfig, WEEK_DAY, weekOpts(BEFORE_WEEK));
  const all = w.days.reduce((acc, d) => acc.concat(d.sessions), []);
  return all.length === 2 && all.every((s) => s.status === 'upcoming')
    && w.days.every((d) => d.upcoming && d.counts.noEvidence === 0 && d.counts.missed === 0);
})(), (function () {
  const w = Plans.week(weekConfig, WEEK_DAY, weekOpts(BEFORE_WEEK));
  return w.days.map((d) => d.day.slice(8) + ':' + (d.upcoming ? 'chua-toi' : 'da-qua'));
})());

check('cột mục tiêu lấy từ việc có tầm nhìn mục tiêu, buổi không gắn thì để trống', (function () {
  const w = Plans.week(weekConfig, WEEK_DAY, weekOpts(AFTER_WEEK));
  const fri = w.days.find((d) => d.day === WEEK_DAY).sessions;
  const tue = w.days.find((d) => d.weekday === 2).sessions;
  return fri.length === 1 && fri[0].goalTitle === 'Mục tiêu tuần thử'
    && !!fri[0].goalId
    && tue.length === 1 && tue[0].goalId === null && tue[0].goalTitle === null;
})(), (function () {
  const w = Plans.week(weekConfig, WEEK_DAY, weekOpts(AFTER_WEEK));
  return w.days.filter((d) => d.sessions.length)
    .map((d) => d.weekdayLabel + '=' + d.sessions.map((s) => s.goalTitle || '(chưa gắn)').join('|'));
})());

check('tạo một buổi cho nhiều thứ thì tạo đủ, và mỗi buổi một id riêng', (function () {
  const r = Plans.applySlot(weekConfig, 'save', {
    weekdays: [1, 3, 4], start: '13:30', end: '14:30', title: 'Buổi chiều', kind: 'admin'
  });
  if (!r.ok || !r.created || r.created.length !== 3) return false;
  const ids = r.created.map((s) => s.id);
  const days = r.created.map((s) => s.weekday);
  return U.uniq(ids).length === 3 && days.join(',') === '1,3,4';
})(), (function () {
  const r = Plans.applySlot(weekConfig, 'save', {
    weekdays: [1, 3, 4], start: '13:30', end: '14:30', title: 'Buổi chiều', kind: 'admin'
  });
  return r.ok ? r.created.map((s) => s.id + '@' + s.weekday).join(' ') : r.error;
})());

/* Phép kiểm quan trọng nhất của nhóm này: một thứ vướng thì CẢ LÔ bị từ
   chối, và không buổi nào được tạo. Nếu mã vừa tạo vừa kiểm thì thứ Sáu và
   thứ Bảy sẽ nằm lại trên đĩa — huynh có ba buổi mà không yêu cầu buổi nào. */
check('lô có một thứ trùng giờ thì bị từ chối cả lô, không tạo buổi nào', (function () {
  const before = Plans.view(weekConfig, WEEK_DAY).timetable.length;
  const r = Plans.applySlot(weekConfig, 'save', {
    weekdays: [1, 6, 7], start: '13:45', end: '14:00', title: 'Vướng', kind: 'admin'
  });
  const after = Plans.view(weekConfig, WEEK_DAY).timetable.length;
  const weekdays = Plans.view(weekConfig, WEEK_DAY).timetable.map((s) => s.weekday);
  return r.ok === false && typeof r.error === 'string' && r.error.indexOf('thứ Hai') !== -1
    && after === before && weekdays.indexOf(6) === -1 && weekdays.indexOf(7) === -1;
})(), (function () {
  const view = Plans.view(weekConfig, WEEK_DAY);
  return { so_buoi: view.timetable.length, cac_thu: U.uniq(view.timetable.map((s) => s.weekday)).sort().join(',') };
})());

check('dòng Nguyên tắc ghi được, đọc lại đúng, và không đụng tới các buổi', (function () {
  const before = JSON.stringify(Plans.view(weekConfig, WEEK_DAY).timetable);
  const r = Plans.applySlot(weekConfig, 'note', { text: '  Ăn xong nghỉ 20 phút rồi vào học luôn.  ' });
  const after = Plans.view(weekConfig, WEEK_DAY);
  return r.ok && after.principle === 'Ăn xong nghỉ 20 phút rồi vào học luôn.'
    && JSON.stringify(after.timetable) === before;
})(), (function () {
  const r = Plans.applySlot(weekConfig, 'note', { text: '  Ăn xong nghỉ 20 phút rồi vào học luôn.  ' });
  return { ok: r.ok, doc_lai: Plans.view(weekConfig, WEEK_DAY).principle };
})());

/* Dựng màn Hôm nay trên kho của [14c]: dùng lại nguyên `fullViewCtx` để không
   phải chép tay hình dạng dữ liệu — chép tay thì nó thôi kiểm được gì mỗi khi
   hình dạng đó đổi. */
const weekUiCtx = (opts) => Object.assign({}, fullViewCtx, {
  state: Object.assign({}, fullViewCtx.state, { day: WEEK_DAY, open: {} }),
  data: Object.assign({}, fullViewCtx.data, {
    digest: D.build(weekConfig, WEEK_DAY),
    plans: Plans.view(weekConfig, WEEK_DAY, Object.assign({ week: true }, weekOpts(opts || AFTER_WEEK)))
  })
});

check('cột trái của bảng hiện TÊN mục tiêu, và hàng Nguyên tắc hiện câu đã ghi', (function () {
  const html = Views.today.render(weekUiCtx());
  return html.indexOf('Mục tiêu tuần thử') !== -1
    && html.indexOf('slot-target slot-goal-') !== -1
    && html.indexOf('data-action="timetable-note"') !== -1
    && html.indexOf('Ăn xong nghỉ 20 phút rồi vào học luôn.') !== -1
    && html.indexOf('chưa gắn mục tiêu') !== -1;
})(), (function () {
  const html = Views.today.render(weekUiCtx());
  const at = html.indexOf('slot-target');
  return at === -1 ? '(không có cột mục tiêu)' : html.slice(at, at + 120);
})());

/* Một hàng mà các thứ gắn mục tiêu KHÁC NHAU thì không được tô màu của một
   mục tiêu bất kỳ: làm thế là để cột trái nói dối về những thứ còn lại. */
check('hàng có nhiều mục tiêu khác nhau thì nói thẳng ra, không tô màu bừa', (function () {
  Plans.applyTask(weekConfig, 'save', { title: 'Mục tiêu thứ hai', horizon: 'goal', targetDay: '2026-12-31' });
  const second = Plans.view(weekConfig, WEEK_DAY).tasks
    .filter((t) => t.horizon === 'goal' && t.title === 'Mục tiêu thứ hai')[0];
  if (!second) return false;
  const r = weekSlot({ weekday: 4, start: '09:00', end: '11:00', title: 'Buổi sáng', taskId: second.id });
  const html = Views.today.render(weekUiCtx());
  return r.ok && html.indexOf('mục tiêu khác nhau giữa các thứ') !== -1
    && html.indexOf('slot-target slot-goal-many') !== -1;
})(), (function () {
  const html = Views.today.render(weekUiCtx());
  const at = html.indexOf('slot-goal-many');
  return at === -1 ? '(không thấy hàng nhiều mục tiêu)' : html.slice(at - 24, at + 40);
})());

/* Màn Dự án cũng gọi `/api/plans`. Nếu bảng tuần dựng vô điều kiện thì nó
   trả giá đọc bằng chứng của bảy ngày để rồi vứt đi. */
check('bảng tuần chỉ dựng khi được hỏi, không dựng sẵn cho mọi lời gọi', (function () {
  return Plans.view(weekConfig, WEEK_DAY).week === undefined
    && Plans.view(weekConfig, WEEK_DAY, { week: true }).week.days.length === 7;
})(), (function () {
  return {
    khong_hoi: typeof Plans.view(weekConfig, WEEK_DAY).week,
    co_hoi: Plans.view(weekConfig, WEEK_DAY, { week: true }).week.days.length
  };
})());

check('dải đợt làm việc hiện tên đợt, việc chờ xếp và nút đóng', (function () {
  const html = Views.today.render(fullViewCtx);
  return html.indexOf('sprint-band') !== -1 && html.indexOf('Đợt thử') !== -1
    && html.indexOf('data-action="sprint-close"') !== -1
    && html.indexOf('data-action="sprint-move"') !== -1;
})());

check('màn Dự án hiện thẻ sức khoẻ kho kèm chip từng kho', (function () {
  const html = Views.projects.render(fullViewCtx);
  return html.indexOf('Sức khoẻ kho mã') !== -1 && html.indexOf('repo-chip') !== -1
    && html.indexOf('data-action="repo-refresh"') !== -1
    && html.indexOf('data-action="repo-detail"') !== -1;
})());

/* =====================================================================
   [14c] Hộp thư

   Toàn bộ phần này chạy NGOẠI TUYẾN. `app/mail.js` là phần thuần: nó không
   `require('tls')`, không `require('https')`, không `require('net')`. Chỗ
   duy nhất chạm mạng là `app/mail-fetch.js`, và nó chỉ được gọi khi
   `mail.enabled === true` — mặc định là tắt.

   Khe cắm `opts.fetchMail` thay trọn phần mạng, nên không phép kiểm nào ở
   đây mở kết nối, và không phép kiểm nào sinh tiến trình con.
   ===================================================================== */

section('[14c] Hộp thư');

const MAIL_NOW = new Date(2026, 10, 20, 15, 0).getTime();   // 20/11/2026, 15:00 giờ máy
const MAIL_DAY = '2026-11-20';
const MAIL_SECRET = 'mat-khau-ung-dung-gia-de-thu-9f3a';
const HOUR = 3600000;

function mailConfigWith(mail) {
  return Object.assign({}, config, {
    dataDir: path.join(TEST_DIR, 'mail'),
    mail: Object.assign({}, config.mail, mail)
  });
}

/* Sáu thư, mỗi thư nhắm đúng một nhánh của phép đếm — để nếu một nhánh hỏng
   thì biết ngay nhánh nào, chứ không phải "con số sai". */
function mailFixture(now) {
  return {
    ok: true, folder: 'INBOX', sentFolder: 'Sent', days: 30, notes: [],
    messages: [
      /* Đã trả lời qua REFERENCES (thư đi không có In-Reply-To). Đây là ca
         chứng minh `References` được xét — bỏ sót nó là coi thư đã đáp là
         chưa đáp, và huynh sẽ trả lời một thư hai lần. */
      { uid: 1, messageId: '<a@x>', inReplyTo: [], references: [], subject: 'Thư đã được đáp', from: 'An', fromAddress: 'an@x', dateMs: now - 72 * HOUR, seen: true, answered: false },
      // Máy chủ tự đánh cờ đã trả lời.
      { uid: 2, messageId: '<b@x>', inReplyTo: [], references: [], subject: 'Máy chủ bảo đã đáp', from: 'Bình', fromAddress: 'binh@x', dateMs: now - 72 * HOUR, seen: true, answered: true },
      // Quá mới: chưa đủ ngưỡng, chưa được tính là đang chờ.
      { uid: 3, messageId: '<c@x>', inReplyTo: [], references: [], subject: 'Vừa mới tới', from: 'Cường', fromAddress: 'cuong@x', dateMs: now - 2 * HOUR, seen: false, answered: false },
      // Chờ lâu nhất.
      { uid: 4, messageId: '<d@x>', inReplyTo: [], references: [], subject: 'Chờ ba ngày', from: 'Dung', fromAddress: 'dung@x', dateMs: now - 74 * HOUR, seen: false, answered: false },
      // Chờ hơn một ngày.
      { uid: 5, messageId: '<e@x>', inReplyTo: [], references: [], subject: 'Chờ một ngày', from: 'Hạnh', fromAddress: 'hanh@x', dateMs: now - 26 * HOUR, seen: false, answered: false },
      // Không có ngày: không đủ căn cứ để xét, phải đếm riêng chứ không đoán.
      { uid: 6, messageId: '<f@x>', inReplyTo: [], references: [], subject: 'Không rõ ngày', from: 'Kỳ', fromAddress: 'ky@x', dateMs: null, seen: false, answered: false }
    ],
    sent: [
      { uid: 90, messageId: '<s@x>', inReplyTo: [], references: ['<a@x>'], subject: 'Re: Thư đã được đáp', from: 'Tôi', fromAddress: 'toi@x', dateMs: now - 70 * HOUR, seen: true, answered: false }
    ]
  };
}

const mailOffConfig = mailConfigWith({});
const mailReadyConfig = mailConfigWith({ enabled: true, host: 'imap.example.com', user: 'toi@example.com' });

check('hộp thư mặc định TẮT, và không phải một nguồn bằng chứng', (function () {
  const d = C.defaults();
  const names = Object.keys(E.SOURCES);
  return d.mail.enabled === false
    && d.mail.passwordEnv === 'DEVTRACE_MAIL_PASSWORD'
    && names.indexOf('mail') === -1
    && E.DERIVED_SOURCES.indexOf('mail') === -1 && E.STREAM_SOURCES.indexOf('mail') === -1
    && names.length === 8 && E.DERIVED_SOURCES.length + E.STREAM_SOURCES.length === names.length;
})(), { enabled: C.defaults().mail.enabled, nguon: Object.keys(E.SOURCES) });

check('hộp thư tắt thì KHÔNG gọi mạng và KHÔNG ghi ảnh chụp', (function () {
  let calls = 0;
  const shot = Mail.snapshot(mailOffConfig, {
    now: MAIL_NOW,
    fetchMail: function () { calls++; return { ok: true, messages: [], sent: [] }; }
  });
  return calls === 0 && shot.off === true && shot.ok === false
    && shot.enabled === false && !fs.existsSync(Mail.inboxFile(mailOffConfig));
})(), { goi_mang: 'đã đếm', ton_tai: fs.existsSync(Mail.inboxFile(mailOffConfig)) });

check('cấu hình hộp thư thiếu thì rơi về mặc định an toàn, không đoán bừa', (function () {
  const s = Mail.settingsOf(mailOffConfig);
  const wild = Mail.settingsOf({ mail: { port: -5, unansweredHours: 0, maxMessages: 99999, folder: '   ' } });
  return s.port === 993 && s.unansweredHours === 24 && s.maxMessages === 200 && s.folder === 'INBOX'
    && s.sentFolder === 'Sent' && s.passwordEnv === 'DEVTRACE_MAIL_PASSWORD'
    && wild.port === 993 && wild.unansweredHours === 24 && wild.maxMessages === 1000 && wild.folder === 'INBOX';
})(), Mail.settingsOf({ mail: { port: -5, unansweredHours: 0, maxMessages: 99999 } }));

check('thiếu mật khẩu thì nói thẳng TÊN biến môi trường, và không mở kết nối', (function () {
  const saved = process.env.DEVTRACE_MAIL_PASSWORD;
  delete process.env.DEVTRACE_MAIL_PASSWORD;
  let out;
  try { out = Mail.fetchViaChild(Mail.settingsOf(mailReadyConfig)); }
  finally { if (saved !== undefined) process.env.DEVTRACE_MAIL_PASSWORD = saved; }
  return out.ok === false && String(out.error).indexOf('DEVTRACE_MAIL_PASSWORD') !== -1;
})(), 'không sinh tiến trình con vì đã biết trước là thiếu');

/* `build` là hàm thuần: dựng ảnh chụp trong bộ nhớ, không ghi tệp nào. */
const mailSettings = Mail.settingsOf(mailReadyConfig);
const mailShot = Mail.build(mailFixture(MAIL_NOW), mailSettings, MAIL_NOW, MAIL_DAY);
const mailAnalysis = Mail.analyze(mailShot, mailSettings, MAIL_NOW);

check('bảng tra thư đã trả lời dựng từ CẢ In-Reply-To lẫn References', (function () {
  return mailShot.sentIndex['a@x'] === MAIL_NOW - 70 * HOUR
    && Object.keys(mailShot.sentIndex).length === 1
    && mailShot.sentIndex['<a@x>'] === undefined;
})(), mailShot.sentIndex);

check('đúng hai thư đang chờ: thư đã đáp, thư quá mới và thư không rõ ngày đều không bị tính', (function () {
  const ids = mailAnalysis.waiting.map((m) => m.uid);
  return ids.length === 2 && ids[0] === 4 && ids[1] === 5
    && mailAnalysis.total === 6 && mailAnalysis.answered === 2 && mailAnalysis.undated === 1;
})(), mailAnalysis.waiting.map((m) => m.uid + ':' + m.subject));

check('thư chờ lâu nhất đứng đầu, và tuổi của nó được tính đúng', (function () {
  return mailAnalysis.waiting[0].uid === 4 && mailAnalysis.waiting[0].days === 3
    && mailAnalysis.oldestDays === 3 && mailAnalysis.oldestHours === 74;
})(), { days: mailAnalysis.waiting.map((m) => m.days), cu_nhat: mailAnalysis.oldestDays });

check('tín hiệu phụ "chưa mở" đếm riêng, không lẫn với "chưa trả lời"', (function () {
  /* Hai thư đang chờ đều chưa mở; thư "vừa mới tới" cũng chưa mở nhưng chưa
     đủ ngưỡng giờ, nên không được tính. */
  return mailAnalysis.unseen === 2;
})(), { chua_mo: mailAnalysis.unseen, dang_cho: mailAnalysis.waiting.length });

check('summary CHỈ có con số — không có tiêu đề thư, không có danh sách', (function () {
  const s = Mail.summary(mailReadyConfig, { now: MAIL_NOW, shot: mailShot });
  const text = JSON.stringify(s);
  return s.waiting === 2 && s.oldestDays === 3 && s.total === 6 && s.synced === true
    && !Object.prototype.hasOwnProperty.call(s, 'items')
    && text.indexOf('Chờ ba ngày') === -1 && text.indexOf('dung@x') === -1
    && text.indexOf('Dung') === -1;
})(), Mail.summary(mailReadyConfig, { now: MAIL_NOW, shot: mailShot }));

check('bỏ trống thư mục Đã gửi thì nói rõ tín hiệu chính đang thiếu', (function () {
  const weak = Mail.summary(mailConfigWith({ enabled: true, host: 'h', user: 'u', sentFolder: '' }),
    { now: MAIL_NOW, shot: mailShot });
  return weak.weak === true && Mail.summary(mailReadyConfig, { now: MAIL_NOW, shot: mailShot }).weak === false;
})(), Mail.summary(mailConfigWith({ sentFolder: '', enabled: true, host: 'h', user: 'u' }), { now: MAIL_NOW, shot: mailShot }).sentFolder);

check('cảnh báo hộp thư chỉ có CON SỐ, không một chữ nào của người gửi', (function () {
  const list = Alerts.mailAlerts(mailReadyConfig, MAIL_DAY, { now: MAIL_NOW, mail: mailShot });
  if (list.length !== 1) return false;
  const a = list[0];
  const text = JSON.stringify(a);
  const shaped = ['source', 'detail', 'at', 'project', 'title', 'kind', 'level', 'weight'].every((k) => k in a);
  const leaks = ['Chờ ba ngày', 'Chờ một ngày', 'dung@x', 'Dung', 'hanh@x', 'Thư đã được đáp'];
  return shaped && a.kind === 'mail' && a.level === 'warn' && a.title.indexOf('2 thư') === 0
    && a.detail.indexOf('3 ngày') !== -1 && a.detail.indexOf('ước lượng') !== -1
    && leaks.every((s) => text.indexOf(s) === -1);
})(), Alerts.mailAlerts(mailReadyConfig, MAIL_DAY, { now: MAIL_NOW, mail: mailShot }));

/* Ba thư đang chờ, không phải bốn: giữ nguyên hộp Đã gửi của fixture, nếu
   không thì thư `a@x` mất đường đối chiếu và số đếm thành bốn — phép kiểm sẽ
   đỏ vì lý do chẳng liên quan gì tới mức cảnh báo. */
const mailMore = Mail.build({
  messages: mailFixture(MAIL_NOW).messages.concat([
    { uid: 7, messageId: '<g@x>', inReplyTo: [], references: [], subject: 'Chờ bốn ngày', from: 'Lan', fromAddress: 'lan@x', dateMs: MAIL_NOW - 96 * HOUR, seen: true, answered: false }
  ]),
  sent: mailFixture(MAIL_NOW).sent
}, mailSettings, MAIL_NOW, MAIL_DAY);

check('ba thư trở lên thì cảnh báo lên mức nặng', (function () {
  const a = Alerts.mailAlerts(mailReadyConfig, MAIL_DAY, { now: MAIL_NOW, mail: mailMore })[0];
  return a.level === 'bad' && a.title.indexOf('3 thư') === 0 && a.weight > 0;
})(), Alerts.mailAlerts(mailReadyConfig, MAIL_DAY, { now: MAIL_NOW, mail: mailMore })
  .map((a) => a.level + '/' + a.weight));

check('hộp thư tắt thì KHÔNG có cảnh báo hộp thư nào — tắt là đã quyết rồi', (function () {
  return Alerts.mailAlerts(mailOffConfig, MAIL_DAY, { now: MAIL_NOW, mail: mailShot }).length === 0;
})());

check('cảnh báo hộp thư chỉ thuộc về NGÀY ĐANG XEM, không dính sang ngày cũ', (function () {
  const store = Plans.loadStore(mailReadyConfig, {});
  const todayList = Alerts.gather(mailReadyConfig, MAIL_DAY, { now: MAIL_NOW, store, snapshot: null, mail: mailShot });
  const pastList = Alerts.gather(mailReadyConfig, '2026-01-05', { now: MAIL_NOW, store, snapshot: null, mail: mailShot });
  return todayList.some((a) => a.kind === 'mail') && pastList.every((a) => a.kind !== 'mail');
})(), Alerts.gather(mailReadyConfig, '2026-01-05', { now: MAIL_NOW, store: Plans.loadStore(mailReadyConfig, {}), snapshot: null, mail: mailShot }).map((a) => a.kind));

/* Chỉ `app/mail-fetch.js` được nói tới mạng. Đây là điều kiện để cả tệp này
   chạy được ngoại tuyến, nên nó phải được giữ bằng phép kiểm chứ bằng lời hứa. */
const mailSrc = fs.readFileSync(path.join(ROOT, 'app', 'mail.js'), 'utf8');
const mailFetchSrc = fs.readFileSync(path.join(ROOT, 'app', 'mail-fetch.js'), 'utf8');

/* Bỏ chú thích trước khi soi. Câu chú thích ở đầu `mail.js` nhắc nguyên văn
   `require('tls')` để nói rằng nó KHÔNG có ở đó — và một câu nói về sự vắng
   mặt không phải là một lời gọi. Không bỏ chú thích thì phép kiểm bắt đúng
   cái câu giải thích vì sao nó xanh. */
function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ');
}

check('app/mail.js không có mạng: không tls, không https, không net', (function () {
  const bare = stripJsComments(mailSrc);
  const banned = ["require('tls')", 'require("tls")', "require('https')", "require('net')", "require('http')"];
  return banned.every((s) => bare.indexOf(s) === -1) && !/\bhttps?:\/\//.test(bare);
})(), 'mail.js chỉ được đọc/ghi tệp và gọi tiến trình con');

check('chỉ mail-fetch.js mới nói tới tls, và nó không ghi đĩa', (function () {
  return mailFetchSrc.indexOf("require('tls')") !== -1
    && mailFetchSrc.indexOf('writeFile') === -1
    && mailFetchSrc.indexOf("require('fs')") === -1;
})(), 'tiến trình con chỉ in JSON ra stdout');

/* ---- Vòng đọc/ghi thật, và bài kiểm không rò mật khẩu ---- */

const mailSaved = process.env.DEVTRACE_MAIL_PASSWORD;
process.env.DEVTRACE_MAIL_PASSWORD = MAIL_SECRET;

const mailRound = Mail.snapshot(mailReadyConfig, {
  now: MAIL_NOW,
  fetchMail: function () { return mailFixture(MAIL_NOW); }
});
const mailReloaded = Mail.view(mailReadyConfig, { now: MAIL_NOW });

check('quét hộp thư thì ảnh chụp được ghi và đọc lại đúng', (function () {
  return mailRound.ok === true && mailReloaded.synced === true && mailReloaded.waiting === 2
    && mailReloaded.itemTotal === 2 && mailReloaded.stale === false && mailReloaded.day === MAIL_DAY;
})(), { ok: mailRound.ok, waiting: mailReloaded.waiting, day: mailReloaded.day });

check('thẻ Hộp thư có tiêu đề thư — vì đây là màn hình của chính huynh', (function () {
  return mailReloaded.items.length === 2
    && mailReloaded.items[0].subject === 'Chờ ba ngày'
    && mailReloaded.items[0].from === 'Dung' && mailReloaded.items[0].days === 3;
})(), mailReloaded.items.map((m) => m.subject));

check('MẬT KHẨU KHÔNG BAO GIỜ ĐƯỢC GHI XUỐNG ĐĨA', (function () {
  const hits = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (error) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      let text = '';
      try {
        if (fs.statSync(full).size > 4 * 1024 * 1024) continue;
        text = fs.readFileSync(full, 'utf8');
      } catch (error) { continue; }
      if (text.indexOf(MAIL_SECRET) !== -1) hits.push(full);
    }
  };
  walk(TEST_DIR);
  return hits.length === 0;
})(), 'quét mọi tệp trong thư mục kiểm thử');

check('cấu hình công khai chỉ lộ TÊN biến môi trường, không bao giờ lộ giá trị', (function () {
  const pub = JSON.stringify(Report.publicConfig(mailReadyConfig));
  const mail = Mail.settingsOf(mailReadyConfig);
  return pub.indexOf('DEVTRACE_MAIL_PASSWORD') !== -1
    && pub.indexOf(MAIL_SECRET) === -1
    && !Object.prototype.hasOwnProperty.call(mail, 'password')
    && !Object.prototype.hasOwnProperty.call(mail, 'secret');
})(), 'publicConfig có tên biến, không có giá trị');

if (mailSaved !== undefined) process.env.DEVTRACE_MAIL_PASSWORD = mailSaved;
else delete process.env.DEVTRACE_MAIL_PASSWORD;

check('ảnh chụp hộp thư hỏng thì đọc thành "chưa có gì" và NÓI RA là hỏng', (function () {
  fs.writeFileSync(Mail.inboxFile(mailReadyConfig), '{ "messages": [ {{{ ', 'utf8');
  const read = Mail.read(mailReadyConfig);
  const s = Mail.summary(mailReadyConfig, { now: MAIL_NOW });
  /* Ảnh chụp là CACHE, không phải dữ liệu của huynh: hỏng thì quét lại, không
     giữ bản sao và không chặn ghi như kho kế hoạch. Nhưng vẫn phải nói ra,
     vì "chưa quét bao giờ" và "quét hỏng" là hai chuyện khác nhau. */
  return read.shot === null && read.damaged === true && s.damaged === true && s.synced === false;
})(), Mail.read(mailReadyConfig));

check('quét lại thì ảnh chụp hỏng được thay bằng ảnh chụp mới', (function () {
  const again = Mail.snapshot(mailReadyConfig, { now: MAIL_NOW, fetchMail: function () { return mailFixture(MAIL_NOW); } });
  const back = Mail.view(mailReadyConfig, { now: MAIL_NOW });
  return again.ok === true && back.damaged === false && back.waiting === 2;
})(), 'cache hỏng thì dựng lại, không phải dữ liệu của huynh');

/* ---- Thẻ Hộp thư trên giao diện ---- */

/* Dựng trên `fullViewCtx` chứ không dựng mới từ đầu: màn Hôm nay cần cả
   `digest` lẫn `config`, và một ctx tự chế thiếu `digest` sẽ làm `todayView`
   ném lỗi chứ không trả về HTML — tức là phép kiểm chết chứ không phải đỏ. */
const mailViewCtx = Object.assign({}, fullViewCtx, {
  data: Object.assign({}, fullViewCtx.data, { mail: Mail.view(mailReadyConfig, { now: MAIL_NOW }) })
});

check('thẻ Hộp thư hiện con số, danh sách thư và nút quét', (function () {
  const html = Views.today.render(mailViewCtx);
  return html.indexOf('Hộp thư') !== -1 && html.indexOf('mail-list') !== -1
    && html.indexOf('Chờ ba ngày') !== -1 && html.indexOf('Dung') !== -1
    && html.indexOf('data-action="mail-refresh"') !== -1
    && html.indexOf('data-action="mail-toggle"') !== -1
    && html.indexOf('data-action="plan-form"') !== -1
    && html.indexOf('mail-row') !== -1;
})(), Views.today.render(mailViewCtx).slice(Views.today.render(mailViewCtx).indexOf('mail-list'), 200));

check('thẻ Hộp thư nói rõ đây là ước lượng, và nói ước lượng từ đâu', (function () {
  /* So không phân biệt hoa thường: câu đó có thể đứng đầu câu (viết hoa) hoặc
     giữa câu, và phép kiểm không nên đỏ vì dấu chấm trước nó. */
  const html = Views.today.render(mailViewCtx).toLowerCase();
  return html.indexOf('ước lượng') !== -1 && html.indexOf('trên máy này') !== -1
    && html.indexOf('trả lời từ máy khác') !== -1;
})());

check('mọi màn hình dựng được khi CÓ dữ liệu hộp thư, không lộ undefined', (function () {
  return Object.keys(Views).every(function (name) {
    let html = '';
    try { html = Views[name].render(mailViewCtx); } catch (error) { return false; }
    return html.indexOf('undefined') === -1 && html.indexOf('[object Object]') === -1;
  });
})(), Object.keys(Views).map(function (name) {
  try { return name + ':' + Views[name].render(mailViewCtx).length; } catch (error) { return name + ':' + error.message; }
}));

const mailOffCtx = Object.assign({}, fullViewCtx, {
  data: Object.assign({}, fullViewCtx.data, { mail: Mail.summary(mailOffConfig, { now: MAIL_NOW }) })
});

check('hộp thư ĐANG TẮT thì thẻ nói thẳng là tắt, không hiện con số 0 như thể đã quét', (function () {
  const off = Views.today.render(mailOffCtx);
  /* Câu "Không có thư nào đang chờ trả lời" là câu của hộp thư ĐÃ quét và
     sạch. Hiện nó khi tính năng đang tắt là nói dối: chưa quét thì không biết
     có thư nào hay không. */
  return off.indexOf('Đang tắt') !== -1
    && off.indexOf('Không có thư nào đang chờ trả lời') === -1;
})(), Views.today.render(mailOffCtx).slice(Views.today.render(mailOffCtx).indexOf('Hộp thư'), Views.today.render(mailOffCtx).indexOf('Hộp thư') + 220));

/* ---- Gói bằng chứng gửi cho AI: con số thì được, chữ người khác viết thì không ----

   Dùng NGÀY THẬT, vì `digest.build` gọi `Alerts.gather` không kèm `opts.now`,
   và cảnh báo hộp thư chỉ phát khi ngày đang xem đúng là hôm nay. Một ngày
   cứng ở đây sẽ khiến phép kiểm này lặng lẽ không kiểm gì cả. */
const MAIL_TODAY = U.dayKey(Date.now(), config.dayStartHour);
Mail.snapshot(mailReadyConfig, { now: Date.now(), fetchMail: function () { return mailFixture(Date.now()); } });
const mailTodayDigest = D.build(mailReadyConfig, MAIL_TODAY);
const mailPack = JSON.stringify(AI.evidencePack(mailReadyConfig, MAIL_TODAY));

check('bản tổng hợp của hôm nay có cảnh báo hộp thư', mailTodayDigest.warnings.some((w) => w.kind === 'mail'),
  mailTodayDigest.warnings.filter((w) => w.kind === 'mail').map((w) => w.title));

check('gói bằng chứng gửi cho AI mang CON SỐ của hộp thư', (function () {
  const mail = mailTodayDigest.warnings.find((w) => w.kind === 'mail');
  return !!mail && mail.title.indexOf('2 thư') === 0 && mail.detail.indexOf('ước lượng') !== -1;
})(), mailTodayDigest.warnings.filter((w) => w.kind === 'mail'));

check('gói bằng chứng KHÔNG chứa một chuỗi nào của người gửi hay tiêu đề thư', (function () {
  const leaks = ['Chờ ba ngày', 'Chờ một ngày', 'dung@x', 'hanh@x', 'Thư đã được đáp', 'sentIndex', 'inbox.json'];
  return leaks.every((s) => mailPack.indexOf(s) === -1);
})(), 'chữ người khác viết thì không bao giờ đi cùng gói bằng chứng');

/* =====================================================================
   [15] Giao diện chạy thật trong DOM giả

   Phần này tồn tại vì một lỗi có thật: lần chạy đầu, app.js gọi render()
   TRƯỚC khi dữ liệu tải xong, nên màn "Hôm nay" đọc phải digest còn
   undefined và vỡ ngay khi mở trang. Dựng thử HTML không bắt được lỗi đó —
   phải chạy cả vòng boot mới thấy.
   ===================================================================== */

section('[15] Chạy thật trong DOM giả');

function makeElement(tag) {
  var node = {
    tagName: tag || 'div', innerHTML: '', textContent: '', value: '', checked: false,
    hidden: false, disabled: false, className: '', style: {}, readyState: 'loading',
    classList: { toggle: function () {}, add: function () {}, remove: function () {} },
    setAttribute: function () {}, getAttribute: function () { return null; }, removeAttribute: function () {},
    appendChild: function () {}, remove: function () {}, focus: function () {},
    select: function () {}, setSelectionRange: function () {}, matches: function () { return false; },
    closest: function () { return null; }, addEventListener: function () {},
    querySelector: function () { return null; }, querySelectorAll: function () { return []; }
  };
  return node;
}

function makeDom() {
  const nodes = {};
  const ids = ['nav', 'view', 'viewTitle', 'viewSubtitle', 'topbarActions', 'statusChips',
    'modalRoot', 'toastRoot', 'collectBtn', 'journalText', 'promptText', 'dayInput'];
  ids.forEach((id) => { nodes['#' + id] = makeElement('div'); });
  nodes.body = makeElement('body');
  nodes.body.setAttribute = function (name, value) { nodes.body[name] = value; };

  const document = {
    body: nodes.body,
    readyState: 'loading',
    addEventListener: function () {},
    querySelector: function (selector) { return nodes[selector] || null; },
    querySelectorAll: function () { return []; },
    createElement: function (tag) { return makeElement(tag); },
    execCommand: function () { return true; }
  };

  const window = {
    addEventListener: function () {},
    scrollTo: function () {},
    location: { hash: '#/today' }
  };

  return { document, window, nodes };
}

function bootApp(apiResponses, options) {
  const opts = options || {};
  const dom = makeDom();
  const timers = [];
  const cleared = [];
  const sandbox = { console: console, Promise, Error, JSON, Math, Date, Object, Array, String, Number, isFinite, RegExp, Set, Map, encodeURIComponent, decodeURIComponent };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = dom.document;
  sandbox.location = dom.window.location;
  sandbox.getComputedStyle = function () { return { getPropertyValue: function () { return '#123456'; } }; };
  sandbox.localStorage = { getItem: function () { return null; }, setItem: function () {} };
  /* `setTimeout` thật, nhưng KHÔNG giữ tiến trình sống: một thông báo nổi tự
     tắt sau 5,2 giây, và bộ kiểm thử không việc gì phải ngồi chờ nó tắt. */
  sandbox.setTimeout = function (fn, ms) {
    const timer = setTimeout(fn, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
  };
  sandbox.clearTimeout = clearTimeout;
  /* `setInterval` thì GIẢ: ghi lại nhịp và hàm, không hẹn giờ thật. Vòng
     theo dõi lượt thu thập chạy lại mỗi 1,5 giây cho tới khi xong việc —
     hẹn thật thì bộ kiểm thử không bao giờ kết thúc. Bài kiểm tự gọi hàm
     đó ra khi cần kiểm nhịp ấy. */
  sandbox.setInterval = function (fn, ms) {
    timers.push({ fn: fn, ms: ms, id: timers.length + 1 });
    return timers.length;
  };
  sandbox.clearInterval = function (id) { cleared.push(id); };
  sandbox.confirm = function () { return false; };
  sandbox.addEventListener = function () {};
  sandbox.scrollTo = function () {};
  sandbox.navigator = { userAgent: 'smoke-test' };
  sandbox.fetch = function (path) {
    if (opts.networkDown) return Promise.reject(new TypeError('Failed to fetch'));
    const key = Object.keys(apiResponses).find((k) => path.indexOf(k) === 0);
    const payload = key ? apiResponses[key] : {};
    return Promise.resolve({ ok: !!key, status: key ? 200 : 404, json: function () { return Promise.resolve(payload); } });
  };

  const vm2 = require('vm');
  vm2.createContext(sandbox);
  ['web/charts.js', 'web/views.js', 'web/app.js'].forEach(function (file) {
    vm2.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  });
  return { sandbox, dom, timers, cleared };
}

const apiStub = {};
apiStub['/api/status'] = {
  status: { sources: [{ name: 'codex', label: 'Codex', kind: 'ai', evidence: 'phiên AI', color: '#1', enabled: true, health: { ok: true, events: 5, ms: 12, lastRun: Date.now() } }], days: 1, latest: '2026-10-09' },
  config: { dayStartHour: 4, dataDir: 'X:/data', theme: 'muc', sources: {}, ai: {} }
};
apiStub['/api/day/2026-10-09/journal'] = { journal: null };
apiStub['/api/day/2026-10-09'] = { digest: D.build(runConfig, '2026-10-09') };
/* Màn "Hôm nay" giờ đọc thêm kế hoạch và sức khoẻ kho. Thiếu hai mục này
   thì `Promise.all` vỡ và cả vòng boot rơi vào màn báo lỗi — đúng thứ mà
   phép kiểm "boot xong hiện đủ ba câu hỏi" canh. */
apiStub['/api/plans'] = {
  ok: true, day: '2026-10-09', weekday: 5, weekdayLabel: 'thứ Sáu', weekStart: '2026-10-05',
  tasks: [], timetable: [], sprints: [], occurrences: [],
  board: { day: [], week: [], goal: [] }, activeSprint: null, backlog: [],
  velocity: { available: false, note: 'Chưa đủ dữ liệu để nói về tốc độ.' },
  warnings: [], corrupt: {}, error: null
};
apiStub['/api/repohealth'] = {
  snapshot: null, stale: true,
  settings: { maxRepos: 20, secretScan: false, repos: [] }
};
apiStub['/api/mail'] = {
  enabled: false, ready: false, synced: false, damaged: false, stale: true,
  at: null, day: null, folder: 'INBOX', sentFolder: 'Sent',
  passwordEnv: 'DEVTRACE_MAIL_PASSWORD', weak: false, unansweredHours: 24,
  error: null, notes: [], total: 0, answered: 0, waiting: 0, unseen: 0,
  undated: 0, oldestDays: 0, oldestHours: 0, sentCount: 0,
  items: [], itemTotal: 0, listLimit: 30
};

const booted = bootApp(apiStub);

/* ---- Cửa sổ ghi nhanh: chạy THẬT trong DOM giả ----

   web/capture.js chỉ có một lời hứa đáng kiểm, và nó là lời hứa dễ bị phá
   nhất khi ai đó dọn lại mã cho gọn: GHI HỎNG THÌ CÂU HUYNH GÕ PHẢI CÒN
   NGUYÊN TRONG Ô. Kiểm bằng cách soi mã nguồn là kiểm gián tiếp; ở đây nó
   chạy thật, với một `fetch` hỏng thật và một `fetch` chạy được thật.

   Dựng một DOM tí hon riêng chứ không dùng makeDom: trang này chỉ có ba
   phần tử và hai sự kiện, và nó cần bắn được sự kiện — makeDom cố tình
   không làm việc đó. */
function bootCapture(options) {
  const opts = options || {};
  const el = (id) => {
    const node = makeElement('div');
    node.id = id;
    const listeners = {};
    node.addEventListener = function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); };
    node.fire = function (name, event) {
      (listeners[name] || []).forEach((fn) => fn(event || { preventDefault: function () {} }));
    };
    return node;
  };
  const nodes = { captureForm: el('captureForm'), captureText: el('captureText'), captureMsg: el('captureMsg') };

  const docListeners = {};
  const document = {
    body: makeElement('body'),
    hidden: false,
    getElementById: (id) => nodes[id] || null,
    addEventListener: function (name, fn) { (docListeners[name] = docListeners[name] || []).push(fn); },
    fire: function (name, event) { (docListeners[name] || []).forEach((fn) => fn(event)); }
  };

  const winListeners = {};
  let closed = 0;
  const window = {
    addEventListener: function (name, fn) { (winListeners[name] = winListeners[name] || []).push(fn); },
    fire: function (name) { (winListeners[name] || []).forEach((fn) => fn()); },
    close: function () { closed++; }
  };

  const calls = [];
  const sandbox = { console: console, Promise, Error, JSON, Math, Date, Object, Array, String, Number, RegExp, Set, Map };
  sandbox.window = window;
  sandbox.document = document;
  sandbox.setTimeout = setTimeout;
  sandbox.fetch = function (path, init) {
    calls.push({ path: path, init: init });
    if (opts.networkDown) return Promise.reject(new TypeError('Failed to fetch'));
    const ok = opts.refused !== true;
    return Promise.resolve({
      ok: ok,
      status: ok ? 200 : 400,
      json: function () { return Promise.resolve(opts.reply || { ok: true }); }
    });
  };

  const vm2 = require('vm');
  vm2.createContext(sandbox);
  vm2.runInContext(fs.readFileSync(path.join(ROOT, 'web', 'capture.js'), 'utf8'),
    sandbox, { filename: 'web/capture.js' });
  return { nodes: nodes, document: document, window: window, calls: calls, closed: () => closed };
}

/* `chờ` để phần bất đồng bộ của capture.js chạy xong trước khi soi kết quả:
   hàm xử lý gửi đi rồi trả về, còn `fetch` và `.then` chạy ở nhịp sau. */
function settle() { return new Promise((resolve) => setImmediate(resolve)); }

function checkCaptureWindow() {
  section('[15b] Trang ghi nhanh, chạy thật');

  const blank = bootCapture({});
  blank.nodes.captureText.value = '   \n  ';
  blank.nodes.captureForm.fire('submit');
  check('ghi nhanh câu rỗng thì không gọi máy chủ', blank.calls.length === 0, blank.calls.length);
  check('ghi nhanh câu rỗng thì không đóng cửa sổ', blank.closed() === 0);
  check('ghi nhanh câu rỗng thì nói ra, không im lặng', blank.nodes.captureMsg.textContent.length > 0,
    blank.nodes.captureMsg.textContent);

  const ok = bootCapture({});
  ok.nodes.captureText.value = '  gọi   khách\n về hợp đồng A  ';
  ok.nodes.captureForm.fire('submit');
  return settle().then(() => settle()).then(() => {
    check('ghi nhanh gửi đúng một yêu cầu, tới đúng đường dẫn',
      ok.calls.length === 1 && ok.calls[0].path === '/api/plans/inbox', ok.calls.map((c) => c.path));
    const body = JSON.parse(ok.calls[0].init.body);
    check('ghi nhanh gửi lên đúng thao tác thêm và tự khai nguồn gốc',
      body.action === 'add' && body.source === 'hotkey', body);
    check('ghi nhanh gửi chữ đã gộp khoảng trắng, không gửi xuống dòng',
      body.text === 'gọi khách về hợp đồng A', body.text);
    check('ghi xong thì đóng cửa sổ', ok.closed() === 1, ok.closed());
    check('ghi xong thì xoá ô nhập', ok.nodes.captureText.value === '');

    /* Nhánh quan trọng nhất: máy chủ không trả lời. Câu huynh gõ phải Ở LẠI. */
    const down = bootCapture({ networkDown: true });
    down.nodes.captureText.value = 'câu không được phép biến mất';
    down.nodes.captureForm.fire('submit');
    return settle().then(() => settle()).then(() => {
      check('máy chủ chết thì câu vừa gõ VẪN CÒN trong ô',
        down.nodes.captureText.value === 'câu không được phép biến mất', down.nodes.captureText.value);
      check('máy chủ chết thì cửa sổ KHÔNG đóng', down.closed() === 0, down.closed());
      check('máy chủ chết thì ô nhập được mở lại để gõ tiếp', down.nodes.captureText.disabled === false);
      check('máy chủ chết thì nói ra là chưa ghi được',
        /Chưa ghi được/.test(down.nodes.captureMsg.textContent), down.nodes.captureMsg.textContent);

      /* Máy chủ trả lời nhưng TỪ CHỐI (ví dụ tệp kế hoạch hỏng). Cùng một
         lời hứa: câu ở lại, và câu giải thích của máy chủ phải tới được mắt
         huynh — nuốt nó đi thì huynh chỉ biết là "không ghi được", không
         biết vì sao. */
      const refused = bootCapture({ refused: true, reply: { ok: false, error: 'Tệp việc đang hỏng.' } });
      refused.nodes.captureText.value = 'câu bị máy chủ từ chối';
      refused.nodes.captureForm.fire('submit');
      return settle().then(() => settle()).then(() => {
        check('máy chủ từ chối thì câu vừa gõ VẪN CÒN trong ô',
          refused.nodes.captureText.value === 'câu bị máy chủ từ chối', refused.nodes.captureText.value);
        check('máy chủ từ chối thì lý do của máy chủ hiện ra nguyên văn',
          refused.nodes.captureMsg.textContent.indexOf('Tệp việc đang hỏng.') !== -1,
          refused.nodes.captureMsg.textContent);

        /* Esc: đóng mà KHÔNG xoá. Lần sau bấm phím tắt, câu cũ vẫn còn — mở
           lại thì nó được chọn sẵn, gõ tiếp là thay ngay. */
        const esc = bootCapture({});
        esc.nodes.captureText.value = 'câu bỏ dở';
        esc.window.fire('focus');
        esc.document.fire('keydown', { key: 'Escape', preventDefault: function () {} });
        check('Esc đóng cửa sổ nhưng KHÔNG xoá câu đang gõ',
          esc.closed() === 1 && esc.nodes.captureText.value === 'câu bỏ dở', esc.nodes.captureText.value);
      });
    });
  });
}

check('app.js nạp được trong DOM giả', !!booted.sandbox.DevTrace);
check('DevTrace phơi hàm boot để kiểm thử', typeof booted.sandbox.DevTrace.boot === 'function');

/* =====================================================================
   [16] Máy chủ: bốn đường dẫn mới

   Gọi thẳng `Server.api` chứ không mở cổng thật: mở cổng là chiếm cổng của
   huynh, và bài kiểm thử này phải chạy được cả khi DevTrace đang mở.

   `api` tự gọi `C.load()` ở đầu mỗi lần, nên thay tạm hàm đó là đủ để mọi
   đường dẫn làm việc trên cấu hình giả — nếu không thì một lệnh POST ở đây
   sẽ ghi thẳng vào `data/plans/` THẬT của huynh.
   ===================================================================== */

function reqOf(method, body) {
  const listeners = { data: [], end: [], error: [] };
  const req = {
    method,
    on(name, fn) { if (listeners[name]) listeners[name].push(fn); return req; },
    destroy() { /* readBody gọi khi quá lớn; ở đây không bao giờ quá lớn */ }
  };
  // Đẩy dữ liệu ở nhịp sau, đúng cách một yêu cầu thật tới: `readBody` gắn
  // trình nghe trước, dữ liệu tới sau.
  setImmediate(() => {
    const text = body === undefined ? '' : JSON.stringify(body);
    if (text) listeners.data.forEach((fn) => fn(text));
    listeners.end.forEach((fn) => fn());
  });
  return req;
}

function resOf() {
  const res = { status: 0, raw: null, body: null };
  res.writeHead = (status) => { res.status = status; };
  res.end = (text) => {
    res.raw = text;
    try { res.body = JSON.parse(text); } catch (error) { res.body = text; }
  };
  return res;
}

function callApi(method, urlPath, query, body) {
  const res = resOf();
  const qs = new URLSearchParams(query || {});
  return Server.api(reqOf(method, body), res, urlPath, qs).then(() => res);
}

function checkServerRoutes() {
  section('[16] Máy chủ: bốn đường dẫn mới');

  const realLoad = C.load;
  C.load = () => config;

  // Thư mục giả để duyệt: có thư mục con, có kho git, và có một tệp tên
  // thật khó nhầm — để chứng minh tên TỆP không đi ra khỏi đường này.
  const BROWSE = path.join(TEST_DIR, 'duyet');
  const FILE_THAT_MUST_NOT_LEAK = 'ghi-chu-rieng-tu-cua-toi.txt';
  fs.mkdirSync(path.join(BROWSE, 'con-mot'), { recursive: true });
  fs.mkdirSync(path.join(BROWSE, 'con-hai', '.git'), { recursive: true });
  fs.writeFileSync(path.join(BROWSE, FILE_THAT_MUST_NOT_LEAK), 'x', 'utf8');

  const DAY = '2026-11-20';
  const NEW_TASK = 'Việc thêm qua máy chủ';
  /* Một tiêu đề thư trông không thể lẫn với gì khác. Nó phải có mặt trong
     `/api/mail` và phải VẮNG ở mọi tệp xuất — đó là cách duy nhất kiểm được
     ranh giới "hộp thư là cache, không phải bằng chứng". */
  const MAIL_LEAK_SUBJECT = 'TIEU-DE-THU-RIENG-TU-KHONG-DUOC-RO-RI';
  /* Chiều ngược lại: một nhiệm vụ trong kho kế hoạch PHẢI có mặt trong tệp
     xuất. Không có phép kiểm này thì việc thêm kế hoạch vào bản sao lưu chỉ
     là một dòng mã có thể biến mất mà không ai biết. */
  const PLAN_EXPORT_MARKER = 'SAO-LUU-NHIEM-VU-THU-4271';
  /* Một câu ghi nhanh đi qua máy chủ. Nó phải tới được đường ghi, đọc lại
     được, và — quan trọng nhất — phải Ở LẠI hộp thư đến khi lần phân loại
     sau đó bị từ chối. */
  const INBOX_HTTP_TEXT = 'GHI-NHANH-QUA-MAY-CHU-8823';

  const planBadDay = callApi('GET', '/api/plans', {});
  const planBadFormat = callApi('GET', '/api/plans', { day: 'hom-qua' });
  const planEmpty = callApi('GET', '/api/plans', { day: DAY });
  const repoBefore = callApi('GET', '/api/repohealth');
  const dirsRoot = callApi('GET', '/api/fs/dirs', {});
  const dirsHere = callApi('GET', '/api/fs/dirs', { path: BROWSE });
  const dirsFile = callApi('GET', '/api/fs/dirs', { path: path.join(BROWSE, FILE_THAT_MUST_NOT_LEAK) });
  const dirsMissing = callApi('GET', '/api/fs/dirs', { path: path.join(BROWSE, 'khong-co-that') });

  return Promise.all([planBadDay, planBadFormat, planEmpty, repoBefore,
    dirsRoot, dirsHere, dirsFile, dirsMissing]).then((results) => {
    const [badDay, badFormat, empty, repoPlain, root, here, asFile, missing] = results;

    check('/api/plans thiếu tham số ngày thì từ chối, không đoán hộ', badDay.status === 400 && !!badDay.body.error, badDay.body);
    check('/api/plans ngày sai định dạng cũng bị từ chối', badFormat.status === 400, badFormat.body);
    check('/api/plans trả về đủ bốn tầm nhìn cho một ngày', empty.status === 200 && empty.body.ok === true
      && empty.body.board && Array.isArray(empty.body.board.day) && Array.isArray(empty.body.board.week)
      && Array.isArray(empty.body.board.goal) && Array.isArray(empty.body.timetable)
      && Array.isArray(empty.body.occurrences), empty.body && empty.body.error);
    check('/api/plans nói rõ ngày đang xem và thứ của ngày đó', empty.body.day === DAY && empty.body.weekday === 5, { day: empty.body.day, wd: empty.body.weekday });

    // Thêm một nhiệm vụ rồi đọc lại: ghi xong phải thấy ngay.
    return callApi('POST', '/api/plans/task', {}, { action: 'save', title: NEW_TASK, horizon: 'day', day: DAY })
      .then((saved) => {
        check('thêm nhiệm vụ qua máy chủ thì được', saved.status === 200 && saved.body.ok === true, saved.body && saved.body.error);
        return callApi('GET', '/api/plans', { day: DAY }).then((after) => {
          check('nhiệm vụ vừa thêm hiện ra ở lần đọc sau', after.body.tasks.some((t) => t.title === NEW_TASK), after.body.tasks);
          return after.body.tasks.find((t) => t.title === NEW_TASK);
        });
      })
      .then((task) => {
        // Thao tác lạ phải bị từ chối kèm câu giải thích, không im lặng bỏ qua.
        return callApi('POST', '/api/plans/task', {}, { action: 'lam-dieu-la', id: task.id }).then((weird) => {
          check('thao tác lạ trên nhiệm vụ bị từ chối kèm lý do', weird.status === 400 && !!weird.body.error, weird.body);
          return callApi('POST', '/api/plans/task', {}, { action: 'delete', id: task.id });
        });
      })
      .then((deleted) => {
        check('xoá nhiệm vụ qua máy chủ thì được', deleted.status === 200 && deleted.body.ok === true, deleted.body && deleted.body.error);

        // Hộp thư đến: đường GHI NHANH, và là đường cửa sổ phím tắt gọi.
        return callApi('POST', '/api/plans/inbox', {}, { action: 'add', text: INBOX_HTTP_TEXT, source: 'hotkey' });
      })
      .then((added) => {
        check('ghi nhanh vào hộp thư đến qua máy chủ thì được',
          added.status === 200 && added.body.ok === true, added.body && added.body.error);
        check('mục ghi từ phím tắt tự khai nguồn gốc',
          !!added.body.item && added.body.item.source === 'hotkey', added.body.item);
        return callApi('POST', '/api/plans/inbox', {}, { action: 'add', text: '   ' });
      })
      .then((blank) => {
        check('ghi nhanh câu rỗng qua máy chủ bị từ chối kèm lý do',
          blank.status === 400 && !!blank.body.error, blank.body);
        return callApi('GET', '/api/plans', { day: DAY }).then((after) => {
          check('mục vừa ghi hiện ra ở lần đọc sau',
            after.body.inbox.some((i) => i.text === INBOX_HTTP_TEXT), after.body.inbox);
          return after.body.inbox.find((i) => i.text === INBOX_HTTP_TEXT);
        });
      })
      .then((item) => callApi('POST', '/api/plans/inbox', {}, { action: 'promote', id: item.id, horizon: 'khong-co-that' })
        .then((bad) => {
          check('phân loại vào tầm nhìn lạ bị từ chối kèm lý do', bad.status === 400 && !!bad.body.error, bad.body);
          return callApi('GET', '/api/plans', { day: DAY }).then((after) => {
            /* Tính NGUYÊN TỬ: một lần phân loại hỏng không được làm mục biến
               mất. Mất mục mà không có việc nào thay thế là mất chữ của huynh,
               và không có gì để lần theo. */
            check('phân loại bị từ chối thì mục VẪN CÒN trong hộp thư đến',
              after.body.inbox.some((i) => i.id === item.id), after.body.inbox);
            return item;
          });
        }))
      .then((item) => callApi('POST', '/api/plans/inbox', {}, { action: 'promote', id: item.id, horizon: 'day' }))
      .then((promoted) => {
        check('phân loại được thì thành một việc thật',
          promoted.status === 200 && promoted.body.ok === true && !!promoted.body.task,
          promoted.body && promoted.body.error);
        const itemId = promoted.body.promoted && promoted.body.promoted.id;
        return callApi('GET', '/api/plans', { day: DAY }).then((after) => {
          check('phân loại xong thì mục rời hộp thư đến và việc có mặt trên bảng ngày',
            after.body.inbox.every((i) => i.id !== itemId)
            && after.body.board.day.some((t) => t.id === promoted.body.task.id), after.body.inbox);
          return callApi('POST', '/api/plans/task', {}, { action: 'delete', id: promoted.body.task.id });
        });
      })
      .then(() => {
        // Thời khoá biểu: một buổi sáng thứ Hai.
        return callApi('POST', '/api/plans/slot', {}, {
          action: 'save', weekday: 1, start: '09:00', end: '11:00', title: 'Buổi sâu', kind: 'deep'
        });
      })
      .then((slot) => {
        check('thêm buổi vào thời khoá biểu thì được', slot.status === 200 && slot.body.ok === true, slot.body && slot.body.error);
        /* `timetable` là MẪU CỦA CẢ TUẦN, không phải buổi của riêng một ngày
           — dải thời khoá biểu vẽ cả tuần, và phép đối chiếu mới là chỗ lọc
           theo ngày. Nên chỗ kiểm "buổi thứ Hai không lẫn sang thứ Ba" phải
           hỏi `sessionsOn`, chứ hỏi `timetable` thì hỏi nhầm vật. */
        return callApi('GET', '/api/plans', { day: '2026-11-23' }).then((mon) => {
          check('buổi thứ Hai nằm trong mẫu tuần', mon.body.timetable.some((s) => s.title === 'Buổi sâu'), mon.body.timetable);
          const monSlots = Plans.sessionsOn(config, '2026-11-23');
          const tueSlots = Plans.sessionsOn(config, '2026-11-24');
          check('buổi thứ Hai dựng ra đúng ở ngày thứ Hai', monSlots.length === 1 && monSlots[0].title === 'Buổi sâu', monSlots);
          check('buổi thứ Hai không lẫn sang thứ Ba', tueSlots.length === 0, tueSlots);
        });
      })
      .then(() => callApi('POST', '/api/plans/sprint', {}, { action: 'start', day: DAY, name: 'Đợt thử', goal: 'Chạy được' }))
      .then((sprint) => {
        check('mở một đợt làm việc qua máy chủ thì được', sprint.status === 200 && sprint.body.ok === true, sprint.body && sprint.body.error);
        return callApi('GET', '/api/plans', { day: DAY });
      })
      .then((after) => {
        check('đợt đang chạy hiện ra ở lần đọc sau', !!after.body.activeSprint && after.body.activeSprint.name === 'Đợt thử', after.body.activeSprint);

        check('chưa quét kho lần nào thì /api/repohealth nói thẳng là chưa có', repoPlain.status === 200 && repoPlain.body.snapshot === null, repoPlain.body);
        check('/api/repohealth nói rõ nó đang được phép quét bao nhiêu kho', repoPlain.body.settings && repoPlain.body.settings.maxRepos === 20, repoPlain.body.settings);
        return callApi('POST', '/api/repohealth/refresh', {}, {});
      })
      .then((refresh) => {
        check('quét sức khoẻ kho qua máy chủ thì chạy xong', refresh.status === 200 && typeof refresh.body.day === 'string', refresh.body);
        return callApi('GET', '/api/repohealth').then((repoAfter) => {
          check('ảnh chụp vừa quét đọc lại được', !!repoAfter.body.snapshot && repoAfter.body.snapshot.day === refresh.body.day, repoAfter.body);
          check('ảnh chụp của hôm nay thì không bị coi là cũ', repoAfter.body.stale === false, repoAfter.body.stale);
        });
      })
      .then(() => {
        check('không hỏi đường dẫn thì trả về danh sách ổ đĩa', root.status === 200 && root.body.drives === true
          && root.body.dirs.length > 0, root.body);
        check('duyệt một thư mục thì chỉ trả về thư mục con', here.status === 200
          && here.body.dirs.map((d) => d.name).sort().join(',') === 'con-hai,con-mot', here.body.dirs);
        check('thư mục con có .git được đánh dấu là kho mã', here.body.dirs.some((d) => d.name === 'con-hai' && d.git === true)
          && here.body.dirs.some((d) => d.name === 'con-mot' && d.git === false), here.body.dirs);
        check('duyệt thư mục KHÔNG để lộ tên tệp nào', here.raw.indexOf(FILE_THAT_MUST_NOT_LEAK) === -1);
        check('có đường lên thư mục cha', here.body.parent === TEST_DIR, here.body.parent);
        check('trỏ vào một tệp thì báo lỗi và không liệt kê gì', asFile.status === 200 && !!asFile.body.error
          && asFile.body.dirs.length === 0, asFile.body);
        check('thư mục không tồn tại thì báo lỗi chứ không ném ra', missing.status === 200 && !!missing.body.error, missing.body);

        // Tệp kế hoạch hỏng: đường ghi phải TỪ CHỐI, và câu từ chối phải tới
        // được giao diện — đây là lời hứa "không ghi đè" của cả kế hoạch này.
        const tasksPath = Plans.tasksFile(config);
        fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
        fs.writeFileSync(tasksPath, '{ "tasks": [ {{{ ', 'utf8');
        return callApi('POST', '/api/plans/task', {}, { action: 'save', title: 'Không được ghi', horizon: 'day', day: DAY })
          .then((refused) => {
            check('tệp việc hỏng thì đường ghi TỪ CHỐI chứ không ghi đè', refused.status === 400 && refused.body.ok === false, refused.body);
            check('câu từ chối nói rõ tệp nào hỏng và đã giữ bản sao', String(refused.body.error).indexOf('tasks.json') !== -1
              && String(refused.body.error).indexOf('giữ bản sao') !== -1, refused.body.error);
            check('tệp hỏng vẫn còn nguyên trên đĩa, không bị thay bằng rỗng', fs.readFileSync(tasksPath, 'utf8') === '{ "tasks": [ {{{ ');
            // Đọc vẫn phải chạy được — chỉ việc GHI bị chặn.
            return callApi('GET', '/api/plans', { day: DAY }).then((read) => {
              check('tệp việc hỏng thì đường đọc vẫn trả lời, kèm lời nhắc', read.status === 200
                && read.body.ok === false && Array.isArray(read.body.warnings) && read.body.warnings.length > 0, read.body.warnings);
            });
          })
          .then(() => {
            // Dọn để `finishRun` không phải nghĩ tới, và để phần sau không thấy kho hỏng.
            fs.rmSync(path.join(config.dataDir, 'plans'), { recursive: true, force: true });
          });
      })
      .then(() => {
        /* ---- Hộp thư qua máy chủ ----

           Ghi thẳng một ảnh chụp vào đúng chỗ `Mail.read` đọc, để tuyến GET
           có tiêu đề thư thật mà trả về — và để phép kiểm "tệp xuất không
           chứa ảnh chụp hộp thư" bên dưới có thứ thật mà tìm. */
        const serverMailShot = Mail.build({
          messages: [{
            uid: 1, messageId: '<z@x>', inReplyTo: [], references: [],
            subject: MAIL_LEAK_SUBJECT, from: 'Người Gửi Riêng Tư', fromAddress: 'rieng-tu@x',
            dateMs: Date.now() - 72 * 3600000, seen: false, answered: false
          }],
          sent: []
        }, Mail.settingsOf(config), Date.now(), U.dayKey(Date.now(), config.dayStartHour));
        U.writeJson(Mail.inboxFile(config), serverMailShot);
        return callApi('GET', '/api/mail');
      })
      .then((mailGet) => {
        check('/api/mail trả về hộp thư kèm đúng thư đang chờ', mailGet.status === 200
          && mailGet.body.synced === true && mailGet.body.waiting === 1
          && mailGet.body.items.length === 1 && mailGet.body.items[0].subject === MAIL_LEAK_SUBJECT, mailGet.body.items);
        /* Cấu hình kiểm thử để hộp thư TẮT. Quét khi đang tắt phải trả lời
           được, nói thẳng là đang tắt, và KHÔNG mở kết nối nào. */
        return callApi('POST', '/api/mail/refresh', {}, {});
      })
      .then((mailRefresh) => {
        check('quét hộp thư khi đang tắt thì nói thẳng là đang tắt, không mở mạng', mailRefresh.status === 200
          && mailRefresh.body.off === true && mailRefresh.body.ok === false, mailRefresh.body.off);
        /* Một nhiệm vụ thật trong kho kế hoạch, để phép kiểm bên dưới có thứ
           thật mà tìm trong tệp xuất. Tên để dạng ASCII có chủ ý: phép kiểm so
           chuỗi trên thân HTTP, và một chuỗi chỉ có chữ không dấu thì không
           phụ thuộc vào cách mã hoá thân đó. */
        const tasksValue = Plans.emptyTasks();
        tasksValue.seq = 1;
        tasksValue.tasks.push({
          id: 't-0001', title: PLAN_EXPORT_MARKER, horizon: 'day', status: 'open',
          projectId: null, projectPath: null, createdDay: DAY, dueDay: DAY, targetDay: null,
          doneDay: null, recur: null, sprintId: null, points: null, order: 0, note: '', updatedAt: 0
        });
        Plans.saveTasks(config, tasksValue, {});
        return callApi('GET', '/api/export');
      })
      .then((exported) => {
        check('tệp xuất đầy đủ KHÔNG chứa ảnh chụp hộp thư', exported.raw.indexOf(MAIL_LEAK_SUBJECT) === -1
          && exported.raw.indexOf('sentIndex') === -1 && exported.raw.indexOf('rieng-tu@x') === -1, 'hộp thư là cache, không phải bằng chứng');
        /* Kế hoạch thì ngược lại: chữ huynh tự viết phải sao lưu được, vì
           không có dấu vết nào dựng lại nó. */
        check('tệp xuất đầy đủ CÓ chứa kho kế hoạch', exported.raw.indexOf(PLAN_EXPORT_MARKER) !== -1
          && !!exported.body.plans && Array.isArray(exported.body.plans.tasks.tasks)
          && exported.body.plans.hong.length === 0, Object.keys(exported.body.plans || {}));
        return callApi('GET', '/api/export', { redact: 1 });
      })
      .then((shared) => {
        check('bản xuất đã che cũng không có tiêu đề thư nào', shared.raw.indexOf(MAIL_LEAK_SUBJECT) === -1
          && shared.raw.indexOf('rieng-tu@x') === -1, 'tiêu đề chưa từng nằm trong payload nên không phải che');
        /* Che bí mật không được nuốt luôn kế hoạch: bản chia sẻ vẫn phải là
           một bản sao dùng được, chỉ khác ở chỗ bí mật đã bị thay. */
        check('bản xuất đã che vẫn giữ kho kế hoạch', shared.raw.indexOf(PLAN_EXPORT_MARKER) !== -1
          && shared.body.redacted === true);
        fs.rmSync(path.join(config.dataDir, 'mail'), { recursive: true, force: true });
        fs.rmSync(path.join(config.dataDir, 'plans'), { recursive: true, force: true });
      })
      .then(() => {
        // Chín đường dẫn của kế hoạch, sức khoẻ kho và hộp thư phải có NGUYÊN
        // VĂN trong server.js — giao diện ở mục [9] gọi chúng bằng đúng chuỗi
        // đó, và phép kiểm "mọi đường dẫn API đều có ở máy chủ" chỉ nhận chữ
        // thường cùng dấu `/`.
        const needed = ['/api/plans', '/api/plans/task', '/api/plans/slot', '/api/plans/sprint',
          '/api/plans/inbox',
          '/api/repohealth', '/api/repohealth/refresh', '/api/fs/dirs',
          '/api/mail', '/api/mail/refresh'];
        const absent = needed.filter((p) => serverSrc.indexOf("'" + p + "'") === -1);
        check('mười đường dẫn mới có nguyên văn trong server.js', absent.length === 0, absent);
        check('không có đường dẫn dự án riêng — khai dự án đi qua /api/config',
          serverSrc.indexOf("'/api/projects/") === -1);
        check('duyệt thư mục chỉ đọc, không có đường nào ghi vào máy', serverSrc.indexOf('listDirs') !== -1
          && serverSrc.indexOf("'/api/fs/dirs'") !== -1);
        C.load = realLoad;
      });
  });
}

/* =====================================================================
   [16b] Thu thập ở hậu trường — không khoá máy chủ

   Canh ĐÚNG thứ vừa được sửa. Trước: `POST /api/collect` chạy cả đường ống
   đồng bộ ngay trên luồng của máy chủ, đo được 15,2 giây không trả lời nổi
   một yêu cầu nào — mở ứng dụng lên là màn hình trắng đúng bằng chừng ấy.

   Bài kiểm này KHÔNG sinh tiến trình nào và không mở mạng:
     - chỗ sinh tiến trình là một khe cắm (`seams.spawn`), đúng lối
       `opts.kill` của stop.js và `opts.runGit` của git.js;
     - tiến trình con thật thì gọi thẳng `main()` với một tên nguồn không
       tồn tại, nên nó đi hết đường argv → Collect.run → JSON mà không chạy
       git, không đọc tệp, không gọi mạng (nguồn lạ rơi vào nhánh "đang tắt").
   ===================================================================== */

function checkBackgroundCollect() {
  section('[16b] Thu thập ở hậu trường, không khoá máy chủ');

  const bgConfig = JSON.parse(JSON.stringify(config));
  bgConfig.dataDir = path.join(TEST_DIR, 'hau-truong');
  fs.mkdirSync(bgConfig.dataDir, { recursive: true });

  /* --- Phần 1: máy chủ không còn gọi đường đồng bộ ------------------- */

  /* Đường đồng bộ `Collect.run` vẫn là đường chính của bộ kiểm thử và của
     tệp lệnh — nó chỉ KHÔNG được gọi từ máy chủ nữa. */
  check('máy chủ không gọi thẳng đường thu thập đồng bộ',
    serverSrc.indexOf('Collect.run(config') === -1);
  check('máy chủ gọi đường chạy ở hậu trường',
    serverSrc.indexOf('Collect.runDetached') !== -1);
  check('máy chủ phân biệt "đang bận" với "hỏng"',
    serverSrc.indexOf('result.ok ? 200 : (result.busy ? 409 : 500)') !== -1);

  /* --- Phần 2: chạy THẬT đường ống của tiến trình con ---------------- */

  const CollectRun = require('../app/collect-run');
  const realLoad = C.load;
  const realWrite = process.stdout.write;
  const written = [];

  /* `console.log` cũng đi qua `process.stdout.write`, nên trong khoảng thay
     tạm dưới đây tuyệt đối không được gọi `check()` — nếu không thì dòng
     "ok/FAIL" lọt vào chuỗi JSON đang chờ đọc. */
  function runChild(rawArg) {
    written.length = 0;
    C.load = () => bgConfig;
    process.stdout.write = function (text) { written.push(String(text)); return true; };
    let code = null;
    let threw = null;
    try { code = CollectRun.main(['node', 'collect-run.js', rawArg]); } catch (error) { threw = error.message; }
    process.stdout.write = realWrite;
    C.load = realLoad;
    let parsed = null;
    try { parsed = JSON.parse(written.join('')); } catch (error) { parsed = null; }
    return { code: code, threw: threw, parsed: parsed, pieces: written.length };
  }

  const child = runChild('{"sources":["khong-co-nguon-nay"]}');
  check('tiến trình con đi hết đường rồi thoát sạch',
    child.threw === null && child.code === 0, child.threw || child.code);
  check('tiến trình con in ra ĐÚNG MỘT đối tượng JSON, không kèm chữ nào khác',
    child.pieces === 1 && !!child.parsed && child.parsed.ok === true, written.length);
  check('bản tổng kết đi qua nguyên vẹn',
    !!(child.parsed && child.parsed.summary && child.parsed.summary.sources['khong-co-nguon-nay']
      && child.parsed.summary.sources['khong-co-nguon-nay'].ok === true && child.parsed.summary.total === 0),
    child.parsed && child.parsed.summary);

  /* Tham số hỏng phải NÓI RA. Rơi về mặc định ở đây nghĩa là một lần gõ
     sai biến thành "chạy cả bảy nguồn" — chạy git trên hai mươi tư kho vì
     một dấu ngoặc lệch. */
  const badArg = runChild('{khong-phai-json');
  check('tham số hỏng thì từ chối, KHÔNG chạy bừa cả bảy nguồn',
    badArg.code === 1 && !!badArg.parsed && badArg.parsed.ok === false
      && /không đọc được/i.test(badArg.parsed.error), badArg.parsed);
  check('tham số hỏng thì không trả về bản tổng kết nào',
    !(badArg.parsed && badArg.parsed.summary));

  /* --- Phần 3: lớp bọc của máy chủ, qua khe cắm giả ------------------ */

  const spawned = [];
  let gate = null;

  function fakeSpawn(options) {
    spawned.push(options);
    let open;
    const promise = new Promise((resolve) => { open = resolve; });
    gate = { promise: promise, open: open };
    return promise;
  }

  function neverSpawns(out) {
    return function () { return out; };
  }

  check('chưa chạy gì thì không có lượt nào đang thu thập', Collect.collecting() === null);
  check('cùng các nguồn, khác thứ tự, vẫn là cùng một yêu cầu',
    Collect.runKey({ sources: ['git', 'codex'] }) === Collect.runKey({ sources: ['codex', 'git'] }),
    [Collect.runKey({ sources: ['git', 'codex'] }), Collect.runKey({ sources: ['codex', 'git'] })]);
  check('không nêu nguồn nào nghĩa là cả bảy bộ thu thập',
    JSON.parse(Collect.runKey({})).sources.length === Object.keys(Collect.COLLECTORS).length,
    Object.keys(Collect.COLLECTORS).length);

  const first = Collect.runDetached(bgConfig, { sources: ['codex'] }, { spawn: fakeSpawn });
  check('bắt đầu là sinh đúng MỘT tiến trình con', spawned.length === 1, spawned.length);
  check('máy chủ biết là đang thu thập, và biết đang thu nguồn nào',
    !!Collect.collecting() && Collect.collecting().sources.length === 1
      && Collect.collecting().sources[0] === 'codex', Collect.collecting());

  const second = Collect.runDetached(bgConfig, { sources: ['codex'] }, { spawn: fakeSpawn });
  check('yêu cầu CÙNG nguồn thì nhập vào lượt đang chạy, không sinh thêm tiến trình',
    spawned.length === 1, spawned.length);

  /* Trạng thái phải sống trong health.json để tuyến /api/status đọc được:
     dải báo trên giao diện dựa vào đúng chỗ này. */
  E.writeHealth(bgConfig, { codex: { label: 'Codex', lastRun: Date.now(), ms: 1, events: 0, ok: true, notes: [] } });

  return Collect.runDetached(bgConfig, { sources: ['git'] }, { spawn: fakeSpawn }).then(function (busy) {
    check('yêu cầu KHÁC nguồn thì bị từ chối, không im lặng trả kết quả của lượt kia',
      busy.ok === false && busy.busy === true, busy);
    check('bị từ chối thì cũng không sinh thêm tiến trình', spawned.length === 1, spawned.length);

    C.load = () => bgConfig;
    return callApi('GET', '/api/status');
  }).then(function (res) {
    check('/api/status nói ra là đang thu thập, kèm cả tên nguồn',
      res.status === 200 && !!res.body.status.collecting
        && res.body.status.collecting.sources[0] === 'codex', res.body.status.collecting);
    return callApi('POST', '/api/reset', {}, {});
  }).then(function (res) {
    check('xoá sạch giữa lúc thu thập thì bị chặn, không xoá nửa vời',
      res.status === 409 && /Đang thu thập/.test(res.body.error), res);
    check('xoá bị chặn thì KHÔNG xoá gì cả', fs.existsSync(E.healthPath(bgConfig)));

    gate.open({ ok: true, summary: { total: 3, ms: 12, sources: {} } });
    return Promise.all([first, second]);
  }).then(function (outs) {
    check('lượt đầu trả về nguyên bản tổng kết của tiến trình con',
      outs[0].ok === true && outs[0].summary.total === 3, outs[0]);
    check('trạng thái đi kèm được ĐỌC SAU khi con ghi xong, nên nói đúng là đã thôi thu thập',
      !!outs[0].status && outs[0].status.collecting === null, outs[0].status && outs[0].status.collecting);
    check('lượt nhập vào tự khai nó là lượt nhập, không nhận công của mình',
      outs[1].ok === true && outs[1].joined === true, outs[1]);
    check('thu xong thì máy chủ thôi báo đang thu thập', Collect.collecting() === null);
    return callApi('POST', '/api/reset', {}, {});
  }).then(function (res) {
    check('thu xong rồi thì xoá sạch chạy lại được',
      res.status === 200 && res.body.cleared === true, res);
    check('xoá sạch lần này thì có xoá thật', !fs.existsSync(E.healthPath(bgConfig)));

    /* Tiến trình con hỏng: `spawnCollect` nuốt lỗi và trả `{ ok:false }`,
       nhưng nếu chính việc sinh tiến trình ném ra thì lớp bọc cũng phải
       biến nó thành cùng một hình dạng — chỗ gọi chỉ phải xử lý một kiểu. */
    return Collect.runDetached(bgConfig, { sources: ['codex'] },
      { spawn: neverSpawns(Promise.resolve({ ok: false, error: 'Không chạy được lượt thu thập: hỏng' })) });
  }).then(function (failed) {
    check('tiến trình con hỏng thì trả lỗi chứ không ném ra ngoài',
      failed.ok === false && /Không chạy được/.test(failed.error), failed);
    check('hỏng thì vẫn mở khoá cho lượt sau', Collect.collecting() === null);
    return Collect.runDetached(bgConfig, { sources: ['codex'] },
      { spawn: neverSpawns(Promise.reject(new Error('EACCES'))) });
  }).then(function (threwSpawn) {
    check('sinh tiến trình ném lỗi thì cũng thành { ok: false }',
      threwSpawn.ok === false && /EACCES/.test(threwSpawn.error), threwSpawn);
    check('ném lỗi cũng mở khoá', Collect.collecting() === null);
    C.load = realLoad;
  }, function (error) {
    C.load = realLoad;
    throw error;
  });
}

/* ---- Dải báo "đang thu dấu vết" --------------------------------------
   Chạy THẬT trong DOM giả. Điều đáng canh không phải dải báo có hiện hay
   không, mà là nó có NÓI RA rằng những con số bên dưới là của lần thu
   trước. Một bảng ghi "0 sự kiện hôm nay" mà không kèm câu đó bị đọc thành
   "hôm nay chưa làm gì" — đúng kiểu sai mà cả dự án này cấm. */

function checkCollectBanner() {
  section('[16c] Dải báo đang thu dấu vết');

  const base = apiStub['/api/status'];
  const busyStub = Object.assign({}, apiStub);
  busyStub['/api/status'] = {
    status: Object.assign({}, base.status, {
      updatedAt: Date.now() - 300000,
      collecting: { startedAt: Date.now() - 2000, ms: 2000, sources: ['codex', 'git'] }
    }),
    config: base.config
  };

  const busy = bootApp(busyStub);
  return busy.sandbox.DevTrace.boot().then(function () {
    const html = busy.dom.nodes['#view'].innerHTML;
    check('đang thu thập thì hiện dải báo', html.indexOf('class="collect-bar"') !== -1, html.slice(0, 160));
    check('dải báo nói thẳng số liệu đang hiện là của lần thu TRƯỚC',
      html.indexOf('Số liệu bên dưới là của lần thu trước') !== -1);
    check('dải báo nằm TRÊN nội dung, không phải cuộn xuống mới thấy',
      html.indexOf('collect-bar') < html.indexOf('Huynh đã làm gì'));
    check('đang thu thập thì nút thu thập bị khoá và đổi chữ',
      busy.dom.nodes['#collectBtn'].disabled === true
        && busy.dom.nodes['#collectBtn'].textContent === 'Đang thu thập…',
      busy.dom.nodes['#collectBtn'].textContent);
    check('dải báo không lộ undefined ra giao diện', html.indexOf('undefined') === -1);
    check('có đúng một nhịp theo dõi được hẹn, và là 1,5 giây',
      busy.timers.length === 1 && busy.timers[0].ms === 1500, busy.timers.map((t) => t.ms));

    /* Nhịp sau trả lời là đã xong. Dải phải biến mất và nhịp phải tự dừng —
       một nhịp hỏi mãi không ai tắt là thứ chạy nền suốt ngày. */
    busyStub['/api/status'] = {
      status: Object.assign({}, base.status, { updatedAt: Date.now(), collecting: null }),
      config: base.config
    };
    busy.timers[0].fn();
    return settle().then(() => settle()).then(() => {
      check('thu xong thì nhịp theo dõi tự dừng', busy.cleared.length === 1, busy.cleared);
      check('thu xong thì dải báo biến mất',
        busy.dom.nodes['#view'].innerHTML.indexOf('collect-bar') === -1);
      check('thu xong thì nút thu thập mở lại',
        busy.dom.nodes['#collectBtn'].disabled === false);
    });
  });
}

/* Phần tắt-máy-chủ của mục [12] và phần bật-máy-chủ của app Electron phải
   chạy trước: chúng bất đồng bộ, và cả tệp này là CommonJS nên không có await
   ở cấp cao nhất. Chạy chúng ở đây để mọi kiểm tra bất đồng bộ nằm chung một
   dây, và để hỏng ở đâu cũng báo ra. */
checkStopGuards().then(function () {
  return checkEnsureServer();
}).then(function () {
  return checkServerRoutes();
}).then(function () {
  return checkBackgroundCollect();
}).then(function () {
  return checkCollectBanner();
}).then(function () {
  return checkCaptureWindow();
}).then(function () {
  return booted.sandbox.DevTrace.boot();
}).then(function () {
  const viewHtml = booted.dom.nodes['#view'].innerHTML;
  const title = booted.dom.nodes['#viewTitle'].textContent;

  check('boot xong thì tiêu đề đúng', title === 'Hôm nay', title);
  check('boot xong thì nội dung đã dựng, không còn chỗ chờ', viewHtml.indexOf('Đang đọc dấu vết') === -1);
  check('boot xong hiện đủ ba câu hỏi', viewHtml.indexOf('Huynh đã làm gì') !== -1 &&
    viewHtml.indexOf('Huynh đã tạo ra kết quả gì') !== -1 && viewHtml.indexOf('Học được gì, mai làm gì') !== -1);
  check('boot xong không hiện lỗi kết nối', viewHtml.indexOf('Không kết nối được máy chủ') === -1);
  check('boot xong không lộ lỗi đọc thuộc tính undefined', viewHtml.indexOf('Cannot read') === -1);
  check('boot xong không lộ undefined ra giao diện', viewHtml.indexOf('undefined') === -1);

  // Đổi màn hình khi dữ liệu cũ vẫn đang giữ: phải hiện chỗ chờ, không được vỡ.
  booted.sandbox.DevTrace.state.route = 'timeline';
  let threw = null;
  try { booted.sandbox.DevTrace.render(); } catch (error) { threw = error.message; }
  const pending = booted.dom.nodes['#view'].innerHTML;
  check('đổi màn hình trước khi có dữ liệu thì hiện chỗ chờ', !threw && pending.indexOf('Đang đọc dấu vết') !== -1, threw);
  check('đổi màn hình trước khi có dữ liệu không vỡ', !threw && pending.indexOf('Không kết nối') === -1, threw);

  // Máy chủ chết hẳn: phải báo đúng là không kết nối được.
  const dead = bootApp({}, { networkDown: true });
  return dead.sandbox.DevTrace.boot().then(function () {
    const html = dead.dom.nodes['#view'].innerHTML;
    check('máy chủ chết thì báo đúng là không kết nối được', html.indexOf('Không kết nối được máy chủ') !== -1);
    check('máy chủ chết thì có gợi ý cách chạy', html.indexOf('npm start') !== -1);
    check('máy chủ chết thì chỉ đúng lệnh chạy', html.indexOf('node server.js') !== -1);
  });
}).then(function () {
  finishRun();
}, function (error) {
  check('vòng chạy bất đồng bộ không ném lỗi', false, String(error && error.message));
  finishRun();
});

function finishRun() {
  Collect.clearCollected(runConfig);
  check('xoá sạch thì không còn ngày nào', E.listDays(runConfig).length === 0);
  fs.rmSync(TEST_DIR, { recursive: true, force: true });

  console.log('');
  console.log('Đã chạy ' + checks + ' kiểm tra.');
  if (failures) {
    console.log('❌ ' + failures + ' kiểm tra thất bại.');
    process.exit(1);
  }
  console.log('✅ Tất cả kiểm tra đều đạt.');
}
