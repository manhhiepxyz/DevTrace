/* =====================================================================
   tools/smoke-test.js — Chạy thử toàn bộ logic bằng Node, không cần trình duyệt.
   Cách dùng:  node tools/smoke-test.js
   ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const memory = {};

const sandbox = {
  console,
  localStorage: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : null),
    setItem: (k, v) => { memory[k] = String(v); },
    removeItem: (k) => { delete memory[k]; }
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['js/seed.js', 'js/store.js', 'js/charts.js', 'js/timer.js', 'js/views.js'].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
});

const { Store, Metrics, Utils, Views, SEED, Timer } = sandbox;
const today = Utils.today();
const yesterday = Utils.addDays(today, -1);

let failures = 0;
function check(name, condition, extra) {
  if (condition) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function section(t) { console.log('\n' + t); }

section('[1] Khởi tạo');
Store.init();
check('trạng thái rỗng ban đầu', Store.state.sessions.length === 0);
check('có đủ 5 cảnh giới', Object.keys(Store.state.levelProgress).length === 5);
check('có sẵn trạng thái đồng hồ', !!Store.state.timer && Store.state.timer.minutes === 45);

section('[2] Buổi học và chỉ số tự lực');
Store.addSession({
  date: today, level: 1, mode: 'B',
  minutes: { review: 30, docs: 45, build: 90, debug: 30, journal: 15 },
  selfSolved: 2, conceptsExplained: 1, debugWithoutAI: true,
  journal: { didToday: 'Viết xong class Document', hardestBug: 'Lỗi null khi validate' },
  tags: ['java', 'validation']
});
Store.addSession({
  date: yesterday, level: 1, mode: 'A',
  minutes: { review: 30, docs: 0, build: 60, debug: 0, journal: 15 },
  selfSolved: 1, conceptsExplained: 0, debugWithoutAI: false,
  journal: { didToday: 'Đọc về encapsulation' }, tags: []
});
check('điểm tự lực buổi hôm nay = 66', Metrics.sessionScore(Store.state.sessions[0]) === 66, Metrics.sessionScore(Store.state.sessions[0]));
check('phút hôm nay = 210', Metrics.minutesToday(Store.state) === 210, Metrics.minutesToday(Store.state));
check('chuỗi ngày = 2', Metrics.streak(Store.state) === 2, Metrics.streak(Store.state));

section('[3] Ghi nhanh theo lịch');
const before = Metrics.minutesToday(Store.state);
Store.logTodayBlock('review', 0);
check('bỏ ghi mục ôn tập: 210 - 30 = 180', Metrics.minutesToday(Store.state) === before - 30, Metrics.minutesToday(Store.state));
Store.logTodayBlock('debug', 30);
Store.logTodayBlock('review', 30);
check('ghi lại mục ôn tập: quay về 210', Metrics.minutesToday(Store.state) === before, Metrics.minutesToday(Store.state));
check('buổi hôm nay vẫn chỉ có một bản ghi', Store.state.sessions.filter((s) => s.date === today).length === 1);

section('[4] Giới luật, lộ trình, tái tạo');
Store.setRule(today, 1, true);
Store.setRule(today, 2, true);
check('điểm danh 2 giới luật', Metrics.ruleCompletion(Store.state, today).done === 2);
Store.setTask(1, 0, true);
Store.setPass(1, true);
check('cảnh giới 1 đã qua ải', Metrics.levelStats(Store.state, SEED.levels[0]).pass === true);
check('tự chuyển sang cảnh giới 2', Store.state.profile.currentLevel === 2);
Store.addRecreation({ date: today, feature: 'API tạo tài liệu', result: 'pass', minutes: 45, notes: 'Nhớ được luồng' });
Store.addRecreation({ date: today, feature: 'Phân trang SQL', result: 'fail', minutes: 30, notes: 'Quên OFFSET/LIMIT' });
check('tỉ lệ tái tạo 50%', Metrics.recreationStats(Store.state).rate === 50);

section('[5] Theo dõi việc đọc');
const book = Store.addBook({ title: 'Spring Boot in Action', author: 'Craig Walls', unit: 'trang', total: 320, startedAt: Utils.addDays(today, -9), kind: 'sach', tags: ['spring'] });
for (let i = 9; i >= 0; i--) {
  Store.addReadingLog({ bookId: book.id, date: Utils.addDays(today, -i), amount: 10, minutes: 25, note: 'chương ' + (10 - i) });
}
const bs = Metrics.readingStats(Store.state, Store.getBook(book.id));
check('tiến độ 100/320 trang', bs.progress === 100 && bs.total === 320, [bs.progress, bs.total]);
check('phần trăm 31%', bs.pct === 31, bs.pct);
check('nhịp đọc 10 trang/ngày', bs.pace === 10, bs.pace);
check('dự kiến xong sau 22 ngày', bs.eta === Utils.addDays(today, 22), bs.eta);
const rt = Metrics.readingTotals(Store.state, 30);
check('tổng đọc 30 ngày = 100 đơn vị', rt.amount === 100, rt.amount);
check('số ngày có đọc = 10', rt.activeDays === 10, rt.activeDays);
Store.addReadingLog({ bookId: book.id, date: today, amount: 20, minutes: 40 });
check('ghi thêm 20 trang → 120', Store.getBook(book.id).progress === 120, Store.getBook(book.id).progress);
const logToRemove = Store.state.readingLogs[Store.state.readingLogs.length - 1];
Store.removeReadingLog(logToRemove.id);
check('xoá lần ghi → trả về 100', Store.getBook(book.id).progress === 100, Store.getBook(book.id).progress);
const shortBook = Store.addBook({ title: 'Sách mỏng', unit: 'trang', total: 30, startedAt: today });
Store.addReadingLog({ bookId: shortBook.id, date: today, amount: 30, minutes: 20 });
check('đọc hết thì tự chuyển "đã xong"', Store.getBook(shortBook.id).status === 'done');

section('[6] Nhóm theo Scrum');
Store.addMember({ name: 'Lan', role: 'backend' });
Store.addMember({ name: 'Minh', role: 'kiểm thử' });
check('có 2 thành viên', Store.state.team.members.length === 2);
const member = Store.state.team.members[0];
const sprint = Store.addSprint({ name: 'Sprint 1', goal: 'Chạy được API tài liệu', startDate: Utils.addDays(today, -4), endDate: Utils.addDays(today, 9) });
check('sprint đang chạy', Store.activeSprint() && Store.activeSprint().id === sprint.id);
const t1 = Store.addTask({ title: 'Viết API tạo tài liệu', points: 3, sprintId: sprint.id, assigneeId: member.id });
const t2 = Store.addTask({ title: 'Viết test quyền truy cập', points: 5, sprintId: sprint.id });
const t3 = Store.addTask({ title: 'Sửa lỗi validate tiêu đề', points: 2, sprintId: sprint.id });
Store.addTask({ title: 'Ý tưởng cho sau', points: 8 });
Store.moveTask(t3.id, 'done');
const stats = Metrics.sprintStats(Store.state, sprint);
check('sprint: 10 điểm, xong 2 điểm', stats.points === 10 && stats.pointsDone === 2, [stats.points, stats.pointsDone]);
check('sprint: 20% hoàn thành', stats.pct === 20, stats.pct);
check('sprint: 1/3 việc xong', stats.itemsDone === 1 && stats.items === 3);
const burn = Metrics.burndown(Store.state, sprint);
check('burndown có 5 mốc (4 ngày qua + hôm nay)', burn.length === 5, burn.length);
check('burndown hôm nay còn 8 điểm', burn[burn.length - 1].actual === 8, burn[burn.length - 1]);
const load = Metrics.memberLoad(Store.state, sprint.id);
check('phân bổ: Lan giữ 3 điểm', load.filter((x) => x.member.id === member.id)[0].points === 3);
check('việc cần làm hôm nay = 2', Metrics.tasksDueToday(Store.state).length === 2, Metrics.tasksDueToday(Store.state).length);
Store.closeSprint(sprint.id);
check('kết thúc sprint → không còn sprint chạy', Store.activeSprint() === null);
const vel = Metrics.velocity(Store.state);
check('velocity ghi nhận 2 điểm', vel.length === 1 && vel[0].value === 2, vel);
const backlogOnly = Store.addTask({ title: 'Việc tồn đọng', points: 1 });
Store.setTaskSprint(backlogOnly.id, sprint.id);
check('kéo việc tồn đọng vào sprint', Store.getTask(backlogOnly.id).sprintId === sprint.id);

section('[7] Dựng giao diện');
Object.keys(Views).forEach((key) => {
  const view = Views[key];
  if (typeof view.render !== 'function') return;
  let html = '';
  try { html = view.render(Store.state, { range: 30 }); }
  catch (err) { failures++; console.log('  FAIL view ' + key + ' ném lỗi → ' + err.stack); return; }
  check('view ' + key + ' dựng được HTML', html.length > 50, html.length);
  check('view ' + key + ' không có undefined', html.indexOf('undefined') === -1);
  check('view ' + key + ' không có [object Object]', html.indexOf('[object Object]') === -1);
});
check('biểu mẫu buổi học dựng được', Views.sessionForm(Store.state, Store.state.sessions[0]).length > 500);
check('biểu mẫu sách dựng được', Views.bookForm(Store.state, null).length > 300);
check('biểu mẫu việc dựng được', Views.taskForm(Store.state, null).length > 300);
check('biểu mẫu sprint dựng được', Views.sprintForm(null).length > 200);
check('biểu mẫu thành viên dựng được', Views.memberForm().length > 100);
check('đồng hồ hiển thị 01:30', Timer.fmtMs(90 * 1000) === '01:30', Timer.fmtMs(90 * 1000));

section('[8] Sao lưu và phục hồi');
const backup = Store.exportJSON();
Store.reset();
check('sau khi xoá còn 0 buổi', Store.state.sessions.length === 0);
Store.importJSON(backup);
check('phục hồi đủ 2 buổi', Store.state.sessions.length === 2, Store.state.sessions.length);
check('phục hồi 1 tài liệu', Store.state.books.length === 2, Store.state.books.length);
check('phục hồi 5 việc', Store.state.team.backlog.length === 5, Store.state.team.backlog.length);
check('phục hồi 1 sprint', Store.state.team.sprints.length === 1);
check('phục hồi 2 thành viên', Store.state.team.members.length === 2);
check('phục hồi điểm đọc', Store.getBook(book.id).progress === 100);

section('[9] Bền vững qua localStorage');
check('đã ghi vào localStorage', typeof memory['tu-luyen-ky.v2'] === 'string' && memory['tu-luyen-ky.v2'].length > 500);

section('[10] Nối dây giữa giao diện và bộ điều khiển');
const viewsSrc = fs.readFileSync(path.join(ROOT, 'js/views.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const grab = (src, re) => [...src.matchAll(re)].map((m) => m[1]);

const usedActions = new Set([
  ...grab(viewsSrc, /data-action="([a-z0-9-]+)"/g),
  ...grab(htmlSrc, /data-action="([a-z0-9-]+)"/g)
]);
const handledActions = new Set(grab(appSrc, /case '([a-z0-9-]+)':/g));
const missingActions = [...usedActions].filter((a) => !handledActions.has(a) && a.indexOf('timer-') !== 0);
check('mọi data-action đều có hàm xử lý', missingActions.length === 0, missingActions);

const usedForms = new Set(grab(viewsSrc, /data-form="([a-z0-9-]+)"/g));
const handledForms = new Set(grab(appSrc, /kind === '([a-z0-9-]+)'/g));
const missingForms = [...usedForms].filter((k) => !handledForms.has(k));
check('mọi data-form đều có hàm xử lý', missingForms.length === 0, missingForms);

const usedRoutes = new Set([...grab(viewsSrc, /data-route="#\/([a-z0-9-]+)"/g), ...grab(htmlSrc, /data-route="#\/([a-z0-9-]+)"/g)]);
const viewKeys = new Set(Object.keys(Views));
const missingRoutes = [...usedRoutes].filter((r) => !viewKeys.has(r));
check('mọi liên kết nội bộ đều trỏ tới màn hình có thật', missingRoutes.length === 0, missingRoutes);

check('không còn sót mã chết "state.store"', viewsSrc.indexOf('state.store') === -1);
check('index.html có nạp đủ sáu tệp kịch bản', grab(htmlSrc, /<script src="(js\/[a-z0-9]+\.js)"/g).length === 6);

console.log('');
if (failures) { console.log('❌ ' + failures + ' kiểm tra thất bại.'); process.exit(1); }
console.log('✅ Tất cả kiểm tra đều đạt.');
