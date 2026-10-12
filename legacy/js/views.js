/* =====================================================================
   views.js — Sinh HTML cho từng khu vực của web.
   ===================================================================== */
(function (global) {
  'use strict';

  var SEED = global.SEED;
  var M = global.Metrics;
  var U = global.Utils;
  var C = global.Charts;
  var esc = C.esc;

  var HAN = ['', '一', '二', '三', '四', '五'];
  var Views = {};

  /* ================================ Tiện ích ================================ */
  function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }
  function chip(text, cls) { return '<span class="chip ' + (cls || '') + '">' + esc(text) + '</span>'; }
  function bar(p, color) { return '<span class="bar"><i style="width:' + Math.max(0, Math.min(100, p)) + '%;background:' + (color || 'var(--jade)') + '"></i></span>'; }
  function empty(title, sub) { return '<div class="empty"><strong>' + esc(title) + '</strong>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>'; }
  function stars(n) { return '<span class="stars">' + '★'.repeat(Math.max(0, n)) + '☆'.repeat(Math.max(0, 5 - n)) + '</span>'; }
  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
    return parts.map(function (p) { return p.charAt(0).toUpperCase(); }).join('') || '?';
  }
  function kindLabel(id) { var k = SEED.readingKinds.filter(function (x) { return x.id === id; })[0]; return k ? k.label : id; }
  function statusLabel(id) { var s = SEED.readingStatuses.filter(function (x) { return x.id === id; })[0]; return s ? s.label : id; }
  function prioLabel(id) { var p = SEED.priorities.filter(function (x) { return x.id === id; })[0]; return p || SEED.priorities[1]; }
  function memberOf(state, id) { return state.team.members.filter(function (m) { return m.id === id; })[0] || null; }
  function modeChip(mode) {
    var m = SEED.aiModes.filter(function (x) { return x.id === mode; })[0];
    return chip('Chế độ ' + mode + (m ? ' · ' + m.name : ''), 'chip-mode mode-' + String(mode).toLowerCase());
  }
  function scoreBadge(score) {
    var tone = score >= 75 ? 'good' : score >= 50 ? 'mid' : 'low';
    return '<span class="score score-' + tone + '">' + score + '<i>tự lực</i></span>';
  }
  function statCard(label, value, unit, sub, han) {
    return '<div class="card stat">' +
      (han ? '<span class="stat-han">' + han + '</span>' : '') +
      '<span class="stat-label">' + esc(label) + '</span>' +
      '<span class="stat-value">' + esc(value) + '<i>' + esc(unit) + '</i></span>' +
      '<span class="stat-sub muted">' + esc(sub) + '</span></div>';
  }
  function field(label, control) { return '<label class="field"><span class="field-label">' + esc(label) + '</span>' + control + '</label>'; }
  function head(title, right) { return '<header class="card-head"><h3>' + esc(title) + '</h3>' + (right || '') + '</header>'; }

  /* ============================== HÔM NAY ============================== */
  Views.today = {
    title: 'Hôm nay',
    subtitle: 'Một ngày tu luyện',
    render: function (state) {
      var t = U.today();
      var goal = state.profile.goalMinutes;
      var todayMin = M.minutesToday(state);
      var streakDays = M.streak(state);
      var level = SEED.levels[state.profile.currentLevel - 1];
      var ls = M.levelStats(state, level);
      var rule = M.ruleCompletion(state, t);
      var cat = M.categoryTotals(state, 1);
      var due = M.tasksDueToday(state);
      var sprint = state.team.sprints.filter(function (s) { return s.status === 'active'; })[0] || null;
      var last = global.Store.lastSession();
      var reading = state.books.filter(function (b) { return b.status === 'reading'; });
      var dayIdx = Math.floor(new Date(t + 'T00:00:00').getTime() / 86400000);
      var tip = SEED.rules[dayIdx % SEED.rules.length];

      var h = '';

      h += '<section class="card hero">' +
        '<div class="hero-main">' +
        '<p class="eyebrow">' + esc(U.dayName(t) + ' · ' + U.fmtVN(t)) + '</p>' +
        '<h2>' + (state.profile.name ? esc(state.profile.name) + ', hôm nay' : 'Hôm nay') + ' luyện điều gì?</h2>' +
        '<p class="muted">' + (todayMin > 0
          ? 'Đã ghi ' + todayMin + '/' + goal + ' phút. ' + (todayMin >= goal ? 'Đủ mục tiêu rồi, giữ phong độ nhé.' : 'Còn ' + (goal - todayMin) + ' phút nữa.')
          : 'Chưa có phút nào hôm nay. Thắp một nén hương 25 phút là bắt đầu được ngay.') + '</p>' +
        '<div class="hero-actions">' +
        '<button class="btn btn-primary" data-action="focus-timer">Thắp hương</button>' +
        '<button class="btn" data-action="new-session">Ghi buổi học</button>' +
        '<button class="btn btn-ghost" data-route="#/team">Bảng nhóm</button>' +
        '</div></div>' +
        '<div class="hero-side">' + C.ring({ pct: pct(todayMin, goal), main: todayMin, sub: '/ ' + goal + ' phút', color: todayMin >= goal ? 'var(--jade)' : 'var(--gold)' }) +
        '<div class="streak-inline">' + chip('Chuỗi ' + streakDays + ' ngày', 'chip-gold') + '</div>' +
        '</div></section>';

      h += '<section class="steps-strip">' +
        '<span class="steps-title">Ba việc mỗi ngày</span>' +
        step(1, 'Thắp hương', 'Một phiên tập trung, không mở AI', todayMin > 0) +
        step(2, 'Ghi nhật ký', 'Năm câu hỏi sau buổi học', M.sessionsInRange(state, 1).length > 0) +
        step(3, 'Điểm danh giới luật', rule.done + '/' + rule.total + ' điều đã giữ', rule.done === rule.total) +
        '</section>';

      h += '<section class="grid cols-2">' +
        '<div class="card">' + head('Đồng hồ nén hương') + '<div id="timerWidget"></div></div>' +
        '<div class="card">' + head('Việc cần làm hôm nay', sprint ? chip(sprint.name, 'chip-gold') : '') +
        (sprint
          ? (due.length
            ? '<ul class="task-mini">' + due.slice(0, 6).map(function (task) {
              return '<li><label class="check"><input type="checkbox" data-action="task-done" data-id="' + task.id + '">' +
                '<span>' + esc(task.title) + ' ' + chip(task.points + ' điểm', 'chip-points') + '</span></label></li>';
            }).join('') + '</ul>'
            : empty('Sprint đã sạch việc', 'Thêm việc mới trong bảng nhóm.'))
          : empty('Chưa có sprint nào', 'Mở một sprint trong mục Nhóm để chia việc theo tuần.')) +
        '<div class="row-actions"><button class="btn btn-sm" data-route="#/team">Mở bảng nhóm</button></div>' +
        '</div></section>';

      h += '<section class="grid cols-2">' +
        '<div class="card">' + head('Lịch tu luyện hôm nay', '<span class="muted small">' + todayMin + '/' + goal + ' phút</span>') +
        '<ul class="schedule">' + SEED.schedule.map(function (item) {
          var done = cat[item.id] || 0;
          var on = done > 0;
          return '<li class="' + (on ? 'done' : '') + '">' +
            '<button class="tick' + (on ? ' on' : '') + '" data-action="quick-log" data-key="' + item.id + '" data-minutes="' + item.minutes + '" title="Ghi ' + item.minutes + ' phút">' + (on ? '✓' : '') + '</button>' +
            '<span class="schedule-label">' + esc(item.label) + '</span>' +
            '<span class="schedule-time">' + done + '/' + item.minutes + '</span>' +
            bar(pct(done, item.minutes), item.color) +
            '</li>';
        }).join('') + '</ul>' +
        '<p class="muted small">Bấm dấu tròn để ghi nhanh đủ số phút của mục đó.</p></div>' +

        '<div class="card">' + head('Giới luật hôm nay', '<span class="muted small">' + rule.done + '/' + rule.total + '</span>') +
        '<ul class="rule-dots">' + SEED.rules.map(function (r) {
          var on = !!(state.ruleAudit[t] || {})[r.id];
          return '<li class="' + (on ? 'on' : '') + '"><label class="check">' +
            '<input type="checkbox" data-action="toggle-rule" data-rule="' + r.id + '"' + (on ? ' checked' : '') + '>' +
            '<span><i class="rule-num">' + (r.id < 10 ? '0' + r.id : r.id) + '</i>' + esc(r.title) + '</span></label></li>';
        }).join('') + '</ul>' +
        '<div class="tip-box"><span class="tip-num">' + tip.id + '</span><div><p class="muted">' + esc(tip.detail) + '</p></div></div>' +
        '</div></section>';

      h += '<section class="grid cols-2">' +
        '<div class="card">' + head('Tiếp nối buổi trước') +
        (last
          ? '<p class="muted small">' + esc(U.dayName(last.date) + ', ' + U.fmtVN(last.date) + ' · ' + M.sessionScore(last) + ' điểm tự lực') + '</p>' +
            '<dl class="qa">' +
            '<dt>Mai tự làm lại phần nào?</dt><dd>' + esc(String(last.journal.canRedo || '').trim() || '— chưa ghi —') + '</dd>' +
            '<dt>Còn chưa giải thích được</dt><dd>' + esc(String(last.journal.cantExplain || '').trim() || '— chưa ghi —') + '</dd>' +
            '<dt>Lỗi khó nhất</dt><dd>' + esc(String(last.journal.hardestBug || '').trim() || '— chưa ghi —') + '</dd>' +
            '</dl>' +
            '<div class="row-actions"><button class="btn btn-sm btn-primary" data-action="repeat-last">Nhân bản buổi này</button></div>'
          : empty('Chưa có buổi nào', 'Ghi buổi đầu tiên để lần sau mở là thấy ngay mình đang ở đâu.')) +
        '</div>' +

        '<div class="card">' + head('Đang ở đâu', '<button class="btn btn-ghost btn-sm" data-route="#/roadmap">Lộ trình</button>') +
        '<div class="mini-block"><span class="mini-han">' + HAN[level.id] + '</span><div><b>Cảnh giới ' + level.id + ' — ' + esc(level.name) + '</b>' +
        '<p class="muted small">' + esc(level.weeks) + ' · đã xong ' + ls.done + '/' + ls.total + ' nhiệm vụ</p></div></div>' +
        bar(ls.pass ? 100 : ls.pct) +
        (reading.length
          ? '<hr class="sep"><p class="muted small">Đang đọc ' + reading.length + ' tài liệu:</p><ul class="plain-list">' +
            reading.slice(0, 3).map(function (b) {
              var s = M.readingStats(state, b);
              return '<li><b>' + esc(b.title) + '</b><span class="muted small">' + s.progress + '/' + s.total + ' ' + esc(b.unit) + ' · ' + s.pct + '%</span>' + bar(s.pct, 'var(--bronze)') + '</li>';
            }).join('') + '</ul>'
          : '<hr class="sep"><p class="muted small">Chưa theo dõi tài liệu nào. <a href="#/reading">Thêm vào giá sách</a> để biết mình đọc nhanh hay chậm.</p>') +
        '</div></section>';

      return h;
    }
  };

  function step(n, title, sub, done) {
    return '<div class="step' + (done ? ' done' : '') + '"><span class="step-num">' + n + '</span>' +
      '<div><b>' + esc(title) + '</b><span class="muted small">' + esc(sub) + '</span></div></div>';
  }

  /* ============================== NHẬT KÝ ============================== */
  Views.journal = {
    title: 'Nhật ký tu luyện',
    subtitle: 'Năm câu hỏi sau mỗi buổi học',
    render: function (state) {
      var list = state.sessions.slice().sort(function (a, b) {
        if (a.date === b.date) return (b.createdAt || '') < (a.createdAt || '') ? -1 : 1;
        return a.date < b.date ? 1 : -1;
      });
      var t = M.totals(state, 0);

      var h = '<section class="card"><div class="row-between">' +
        '<div><h3>Toàn bộ hành trình</h3>' +
        '<p class="muted small">' + t.sessions + ' buổi · ' + Math.round(t.minutes / 60 * 10) / 10 + ' giờ · ' +
        t.selfSolved + ' vấn đề tự giải · ' + t.concepts + ' khái niệm tự giải thích</p></div>' +
        '<div class="row-actions">' +
        (list.length ? '<button class="btn" data-action="repeat-last">Nhân bản buổi trước</button>' : '') +
        '<button class="btn btn-primary" data-action="new-session">Ghi buổi học</button></div>' +
        '</div></section>';

      if (!list.length) return h + empty('Chưa có buổi học nào', 'Bấm "Ghi buổi học" để lưu lại buổi tu luyện đầu tiên.');

      h += '<div class="session-list">' + list.map(renderSessionCard).join('') + '</div>';
      h += '<section class="card">' + head('Năm câu hỏi nhật ký') + '<ol class="q-list">' +
        SEED.journalQuestions.map(function (q) { return '<li>' + esc(q.q) + '</li>'; }).join('') + '</ol></section>';
      return h;
    }
  };

  function renderSessionCard(s) {
    var score = M.sessionScore(s);
    var minutes = M.minutesOf(s);
    var lv = SEED.levels.filter(function (x) { return x.id === s.level; })[0];

    var h = '<article class="card session-card">';
    h += '<header class="session-head"><div>' +
      '<span class="session-date">' + esc(U.dayName(s.date) + ', ' + U.fmtVN(s.date)) + '</span>' +
      '<div class="chips">' + chip('Cảnh giới ' + s.level + (lv ? ' · ' + lv.name : ''), 'chip-level') + modeChip(s.mode) + '</div></div>' +
      scoreBadge(score) + '</header>';

    h += '<div class="session-meta">' +
      '<span>' + minutes + ' phút</span>' +
      '<span>' + s.selfSolved + ' vấn đề tự giải</span>' +
      '<span>' + s.conceptsExplained + ' khái niệm giải thích được</span>' +
      '<span class="' + (s.debugWithoutAI ? 'ok' : 'muted') + '">' + (s.debugWithoutAI ? 'Debug không cần AI' : 'Chưa debug độc lập') + '</span></div>';

    if (s.tags && s.tags.length) h += '<div class="chips">' + s.tags.map(function (x) { return chip('#' + x, 'chip-tag'); }).join('') + '</div>';

    if (M.hasJournal(s)) {
      h += '<details class="journal-detail"><summary>Nhật ký năm câu hỏi</summary><dl class="qa">' +
        SEED.journalQuestions.map(function (q) {
          var v = String(s.journal[q.id] || '').trim();
          return '<dt>' + esc(q.q) + '</dt><dd' + (v ? '' : ' class="muted"') + '>' + esc(v || '— chưa ghi —') + '</dd>';
        }).join('') + '</dl></details>';
    }

    h += '<footer class="session-actions">' +
      '<button class="btn btn-ghost btn-sm" data-action="edit-session" data-id="' + s.id + '">Sửa</button>' +
      '<button class="btn btn-danger-ghost btn-sm" data-action="delete-session" data-id="' + s.id + '">Xoá</button>' +
      '</footer></article>';
    return h;
  }

  Views.sessionForm = function (state, session, prefill) {
    var v = Object.assign({
      id: '', date: U.today(), level: state.profile.currentLevel, mode: 'B',
      minutes: {}, selfSolved: 0, conceptsExplained: 0, debugWithoutAI: false, journal: {}, tags: []
    }, prefill || {}, session || {});

    var h = '<form class="form" data-form="session">';
    h += '<input type="hidden" name="id" value="' + esc(v.id) + '">';
    h += '<div class="form-grid">' +
      field('Ngày học', '<input type="date" name="date" value="' + esc(v.date) + '" required>') +
      field('Cảnh giới', '<select name="level">' + SEED.levels.map(function (lv) {
        return '<option value="' + lv.id + '"' + (Number(v.level) === lv.id ? ' selected' : '') + '>Cảnh giới ' + lv.id + ' — ' + esc(lv.name) + '</option>';
      }).join('') + '</select>') + '</div>';

    h += '<fieldset class="fieldset"><legend>Hôm nay dùng AI ở chế độ nào?</legend><div class="mode-grid">' +
      SEED.aiModes.map(function (m) {
        return '<label class="mode-option mode-' + m.id.toLowerCase() + '">' +
          '<input type="radio" name="mode" value="' + m.id + '"' + (v.mode === m.id ? ' checked' : '') + '>' +
          '<span class="mode-badge">' + m.id + '</span>' +
          '<span class="mode-body"><b>' + esc(m.name) + '</b><i>' + esc(m.desc) + '</i></span></label>';
      }).join('') + '</div></fieldset>';

    h += '<fieldset class="fieldset"><legend>Thời gian (phút)</legend><div class="minutes-grid">' +
      SEED.schedule.map(function (item) {
        var val = (v.minutes && v.minutes[item.id] !== undefined) ? U.num(v.minutes[item.id], 0) : item.minutes;
        return '<label class="min-field"><span>' + esc(item.short || item.label) + '</span>' +
          '<input type="number" min="0" step="5" name="min_' + item.id + '" value="' + val + '" data-minutes-input></label>';
      }).join('') + '</div>' +
      '<p class="muted small">Tổng: <b data-role="minutes-total">0</b> phút</p></fieldset>';

    h += '<fieldset class="fieldset"><legend>Tự đánh giá (thay cho đếm dòng code)</legend><div class="form-grid cols-3">' +
      field('Số vấn đề tự giải quyết', '<input type="number" min="0" max="10" name="selfSolved" value="' + U.num(v.selfSolved, 0) + '">') +
      field('Số khái niệm giải thích được', '<input type="number" min="0" max="10" name="conceptsExplained" value="' + U.num(v.conceptsExplained, 0) + '">') +
      field('Debug độc lập', '<label class="switch"><input type="checkbox" name="debugWithoutAI"' + (v.debugWithoutAI ? ' checked' : '') + '><span>Không cần AI vẫn tìm ra lỗi</span></label>') +
      '</div></fieldset>';

    h += '<fieldset class="fieldset"><legend>Nhật ký năm câu hỏi</legend>' +
      SEED.journalQuestions.map(function (q) {
        var val = String((v.journal || {})[q.id] || '');
        return field(q.q, '<textarea name="q_' + q.id + '" rows="2" placeholder="Viết ngắn, bằng lời của huynh...">' + esc(val) + '</textarea>');
      }).join('') + '</fieldset>';

    h += field('Thẻ (phân tách bằng dấu phẩy)', '<input type="text" name="tags" placeholder="transaction, jpa, index" value="' + esc((v.tags || []).join(', ')) + '">');
    h += '<div class="form-actions"><button type="button" class="btn" data-action="close-modal">Huỷ</button>' +
      '<button type="submit" class="btn btn-primary">Lưu buổi học</button></div></form>';
    return h;
  };

  /* ============================== LỘ TRÌNH ============================== */
  Views.roadmap = {
    title: 'Lộ trình khổ luyện',
    subtitle: 'Năm cảnh giới trên dự án Nexus',
    render: function (state) {
      var h = '<section class="card intro-card"><p>Lịch dưới đây là <b>tham khảo</b>, không phải thời hạn bắt buộc. Nếu một phần cần hai tuần để hiểu, ta dành hai tuần. Đừng hy sinh nền tảng để chạy theo tiến độ.</p></section>';

      h += '<div class="level-list">' + SEED.levels.map(function (lv) {
        var s = M.levelStats(state, lv);
        var active = lv.id === state.profile.currentLevel;
        var p = state.levelProgress[lv.id];

        var card = '<article class="card level-card ' + (s.pass ? 'passed' : '') + ' ' + (active ? 'active' : '') + '">';
        card += '<header class="level-head"><div class="level-id"><span>' + HAN[lv.id] + '</span></div>' +
          '<div class="level-title"><h3>' + esc(lv.name) + '</h3>' +
          '<p class="muted small">' + esc(lv.weeks) + ' · ' + esc(lv.theme) + '</p></div>' +
          '<div class="level-right">' + (s.pass ? chip('Đã qua ải', 'chip-pass') : (active ? chip('Đang học', 'chip-active') : '')) +
          '<span class="level-pct">' + s.pct + '%</span></div></header>';
        card += bar(s.pass ? 100 : s.pct, s.pass ? 'var(--jade)' : 'var(--indigo)');
        card += '<ul class="task-list">' + lv.tasks.map(function (task, i) {
          return '<li><label class="check"><input type="checkbox" data-action="toggle-task" data-level="' + lv.id + '" data-index="' + i + '"' + (p.tasks[i] ? ' checked' : '') + '>' +
            '<span>' + esc(task) + '</span></label></li>';
        }).join('') + '</ul>';
        card += '<div class="pass-box"><b>Điều kiện qua ải</b><p>' + esc(lv.pass) + '</p>' +
          '<label class="check"><input type="checkbox" data-action="toggle-pass" data-level="' + lv.id + '"' + (s.pass ? ' checked' : '') + '>' +
          '<span>Ta đã đạt điều kiện này</span></label></div>';
        card += '<footer class="level-foot"><div class="confidence"><span class="muted small">Tự tin</span>' +
          [1, 2, 3, 4, 5].map(function (n) {
            return '<button class="dot-btn' + (n <= s.confidence ? ' on' : '') + '" data-action="set-confidence" data-level="' + lv.id + '" data-value="' + n + '" title="' + n + '/5"></button>';
          }).join('') + '</div>' +
          (active ? '<span class="muted small">Đang là cảnh giới hiện tại</span>' : '<button class="btn btn-ghost btn-sm" data-action="set-level" data-level="' + lv.id + '">Đặt làm cảnh giới hiện tại</button>') +
          '</footer></article>';
        return card;
      }).join('') + '</div>';
      return h;
    }
  };

  /* ============================== GIỚI LUẬT ============================== */
  Views.rules = {
    title: 'Bảy giới luật',
    subtitle: 'Điểm danh mỗi ngày để không tái nhập ma',
    render: function (state) {
      var t = U.today();
      var day = state.ruleAudit[t] || {};
      var done = M.ruleCompletion(state, t).done;
      var total = SEED.rules.length;

      var h = '<section class="grid cols-2">' +
        '<div class="card center-card">' + C.ring({ pct: pct(done, total), main: done + '/' + total, sub: 'giữ hôm nay', color: 'var(--jade)' }) +
        '<p class="muted center">' + (done === total ? 'Trọn vẹn. Huynh đang đi đúng đường.' : 'Còn ' + (total - done) + ' giới luật chưa điểm danh hôm nay.') + '</p></div>' +
        '<div class="card"><h3>Bốn chế độ dùng AI</h3><div class="mode-ref">' +
        SEED.aiModes.map(function (m) {
          return '<div class="mode-ref-row mode-' + m.id.toLowerCase() + '"><span class="mode-badge">' + m.id + '</span>' +
            '<div><b>' + esc(m.name) + '</b><p class="muted small">' + esc(m.desc) + '</p></div></div>';
        }).join('') + '</div>' +
        '<p class="muted small">Trong 4–6 tuần đầu, ưu tiên chế độ A và B. Chế độ D chỉ mở rộng khi huynh đã hiểu rõ phần đang giao cho AI.</p></div></section>';

      h += '<section class="card">' + head('Hôm nay · ' + U.fmtVN(t)) +
        '<ul class="rule-list">' + SEED.rules.map(function (r) {
          var on = !!day[r.id];
          return '<li class="' + (on ? 'on' : '') + '"><label class="check">' +
            '<input type="checkbox" data-action="toggle-rule" data-rule="' + r.id + '"' + (on ? ' checked' : '') + '>' +
            '<span class="rule-body"><b><i class="rule-num">' + (r.id < 10 ? '0' + r.id : r.id) + '</i>' + esc(r.title) + '</b>' +
            '<em>' + esc(r.detail) + '</em></span></label></li>';
        }).join('') + '</ul></section>';

      var strip = '';
      for (var i = 13; i >= 0; i--) {
        var date = U.addDays(t, -i);
        var rc = M.ruleCompletion(state, date);
        var p = pct(rc.done, rc.total);
        strip += '<div class="strip-cell" title="' + U.fmtVN(date) + ': ' + rc.done + '/' + rc.total + '">' +
          '<span class="strip-fill" style="height:' + p + '%;opacity:' + (p ? 0.35 + p / 160 : 0.12) + '"></span>' +
          '<em>' + esc(U.dayName(date).replace('T', '')) + '</em></div>';
      }
      h += '<section class="card">' + head('Mức giữ giới luật 14 ngày', '<span class="muted small">càng đậm càng trọn vẹn</span>') +
        '<div class="strip">' + strip + '</div></section>';

      return h;
    }
  };

  /* ============================== VIỆC ĐỌC ============================== */
  Views.reading = {
    title: 'Việc đọc',
    subtitle: 'Theo dõi quá trình đọc để biết mình tiến nhanh hay chậm',
    render: function (state) {
      var t = M.readingTotals(state, 30);
      var order = { reading: 0, paused: 1, done: 2 };
      var books = state.books.slice().sort(function (a, b) {
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        var e1 = M.readingStats(state, a).eta, e2 = M.readingStats(state, b).eta;
        if (e1 && e2) return e1 < e2 ? -1 : 1;
        return a.title < b.title ? -1 : 1;
      });

      var h = '<section class="card"><div class="row-between">' +
        '<div><h3>Giá sách</h3><p class="muted small">' + t.books + ' tài liệu · ' + t.reading + ' đang đọc · ' + t.done + ' đã xong</p></div>' +
        '<button class="btn btn-primary" data-action="new-book">Thêm tài liệu</button></div></section>';

      h += '<section class="grid cols-4">' +
        statCard('Đang đọc', t.reading, 'tài liệu', 'Giữ ít thôi để đọc cho sâu.', '讀') +
        statCard('Đọc 30 ngày', t.amount, 'đơn vị', 'Tổng số trang/chương đã đọc.') +
        statCard('Thời gian đọc', Math.round(t.minutes / 60 * 10) / 10, 'giờ', 'Trong 30 ngày gần nhất.') +
        statCard('Số ngày có đọc', t.activeDays, 'ngày', 'Đều đặn quan trọng hơn đọc dồn.') +
        '</section>';

      h += '<section class="card">' + head('Nhịp đọc 30 ngày', '<span class="muted small">số đơn vị mỗi ngày</span>') +
        C.bars({ rows: M.readingDaily(state, 30), height: 190, color: 'var(--bronze)' }) + '</section>';

      if (!books.length) {
        return h + empty('Giá sách đang trống', 'Thêm sách hoặc tài liệu chính thức huynh đang đọc để theo dõi tiến độ.');
      }

      h += '<div class="book-list">' + books.map(function (b) { return renderBookCard(state, b); }).join('') + '</div>';
      return h;
    }
  };

  function renderBookCard(state, b) {
    var s = M.readingStats(state, b);
    var recent = s.logs.slice(0, 5);
    var h = '<article class="card book ' + b.status + '">';
    h += '<header class="book-head"><div class="book-title">' +
      '<h3>' + esc(b.title) + '</h3>' +
      '<p class="muted small">' + esc(b.author || '—') + ' · ' + esc(kindLabel(b.kind)) + '</p></div>' +
      '<div class="book-right">' + chip(statusLabel(b.status), 'chip-' + b.status) +
      (b.rating ? stars(b.rating) : '') + '</div></header>';

    h += '<div class="book-progress">' + bar(s.pct, 'var(--bronze)') +
      '<span class="book-num">' + s.progress + '/' + (s.total || '?') + ' ' + esc(b.unit) + ' · ' + s.pct + '%</span></div>';

    h += '<div class="book-meta">' +
      '<span>Nhịp: <b>' + (s.pace > 0 ? s.pace + ' ' + esc(b.unit) + '/ngày' : 'chưa đủ dữ liệu') + '</b></span>' +
      (s.eta ? '<span>Dự kiến xong: <b>' + U.fmtVN(s.eta) + '</b></span>' : '') +
      (s.lastDate ? '<span>Lần cuối: ' + U.fmtVN(s.lastDate) + '</span>' : '') +
      '<span>Tổng: ' + s.minutes + ' phút</span></div>';

    if (b.tags && b.tags.length) h += '<div class="chips">' + b.tags.map(function (x) { return chip('#' + x, 'chip-tag'); }).join('') + '</div>';
    if (b.takeaways) h += '<div class="takeaway"><b>Bài học rút ra</b><p>' + esc(b.takeaways) + '</p></div>';

    if (recent.length) {
      h += '<details class="journal-detail"><summary>Nhật ký đọc (' + s.logs.length + ' lần)</summary><ul class="log-list">' +
        recent.map(function (l) {
          return '<li><span class="log-date">' + U.fmtVN(l.date) + '</span>' +
            '<span class="log-amount">+' + l.amount + ' ' + esc(b.unit) + '</span>' +
            (l.minutes ? '<span class="muted">' + l.minutes + ' phút</span>' : '') +
            (l.note ? '<span class="log-note">' + esc(l.note) + '</span>' : '') +
            '<button class="btn btn-ghost btn-sm" data-action="delete-reading-log" data-id="' + l.id + '">Xoá</button></li>';
        }).join('') + '</ul></details>';
    }

    h += '<footer class="book-actions">' +
      '<button class="btn btn-sm btn-primary" data-action="log-progress" data-id="' + b.id + '">Ghi tiến độ</button>' +
      '<button class="btn btn-sm" data-action="edit-book" data-id="' + b.id + '">Sửa</button>' +
      '<button class="btn btn-danger-ghost btn-sm" data-action="delete-book" data-id="' + b.id + '">Xoá</button>' +
      '</footer></article>';
    return h;
  }

  Views.bookForm = function (state, book) {
    var v = Object.assign({ id: '', title: '', author: '', kind: 'sach', unit: 'trang', total: 300, progress: 0, status: 'reading', rating: 0, takeaways: '', tags: [], startedAt: U.today() }, book || {});
    var h = '<form class="form" data-form="book"><input type="hidden" name="id" value="' + esc(v.id) + '">';
    h += '<div class="form-grid">' +
      field('Tên sách / tài liệu', '<input type="text" name="title" required value="' + esc(v.title) + '" placeholder="Ví dụ: Spring Boot in Action">') +
      field('Tác giả / nguồn', '<input type="text" name="author" value="' + esc(v.author) + '">') + '</div>';
    h += '<div class="form-grid cols-3">' +
      field('Loại', '<select name="kind">' + SEED.readingKinds.map(function (k) {
        return '<option value="' + k.id + '"' + (v.kind === k.id ? ' selected' : '') + '>' + esc(k.label) + '</option>';
      }).join('') + '</select>') +
      field('Đơn vị', '<select name="unit">' + SEED.readingUnits.map(function (u) {
        return '<option value="' + u + '"' + (v.unit === u ? ' selected' : '') + '>' + esc(u) + '</option>';
      }).join('') + '</select>') +
      field('Tổng số', '<input type="number" min="0" name="total" value="' + U.num(v.total, 0) + '">') + '</div>';
    h += '<div class="form-grid cols-3">' +
      field('Đã đọc tới', '<input type="number" min="0" name="progress" value="' + U.num(v.progress, 0) + '">') +
      field('Trạng thái', '<select name="status">' + SEED.readingStatuses.map(function (s) {
        return '<option value="' + s.id + '"' + (v.status === s.id ? ' selected' : '') + '>' + esc(s.label) + '</option>';
      }).join('') + '</select>') +
      field('Tự đánh giá (0–5)', '<input type="number" min="0" max="5" name="rating" value="' + U.num(v.rating, 0) + '">') + '</div>';
    h += '<div class="form-grid">' +
      field('Bắt đầu từ ngày', '<input type="date" name="startedAt" value="' + esc(v.startedAt) + '">') +
      field('Thẻ', '<input type="text" name="tags" value="' + esc((v.tags || []).join(', ')) + '" placeholder="java, spring">') + '</div>';
    h += field('Bài học rút ra', '<textarea name="takeaways" rows="3" placeholder="Điều gì đáng nhớ nhất? Áp dụng được vào đâu?">' + esc(v.takeaways) + '</textarea>');
    h += '<div class="form-actions"><button type="button" class="btn" data-action="close-modal">Huỷ</button>' +
      '<button type="submit" class="btn btn-primary">Lưu</button></div></form>';
    return h;
  };

  Views.progressForm = function (book) {
    var h = '<form class="form" data-form="progress"><input type="hidden" name="bookId" value="' + esc(book.id) + '">';
    h += '<p class="muted small">' + esc(book.title) + ' — đang ở ' + book.progress + '/' + (book.total || '?') + ' ' + esc(book.unit) + '</p>';
    h += '<div class="form-grid">' +
      field('Ngày', '<input type="date" name="date" value="' + U.today() + '">') +
      field('Số ' + book.unit + ' đã đọc', '<input type="number" min="1" name="amount" value="10" required>') + '</div>';
    h += '<div class="form-grid">' +
      field('Số phút', '<input type="number" min="0" step="5" name="minutes" value="30">') +
      field('Ghi chú', '<input type="text" name="note" placeholder="Đọc chương nào, vướng gì?">') + '</div>';
    h += '<div class="form-actions"><button type="button" class="btn" data-action="close-modal">Huỷ</button>' +
      '<button type="submit" class="btn btn-primary">Ghi lại</button></div></form>';
    return h;
  };

  /* ============================== TÁI TẠO ============================== */
  Views.recreate = {
    title: 'Tái tạo không nhìn lời giải',
    subtitle: 'Đóng code mẫu và tự viết lại',
    render: function (state) {
      var st = M.recreationStats(state);
      var list = state.recreations.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });

      var h = '<section class="grid cols-2">' +
        '<div class="card"><h3>Phép thử mỗi tuần</h3>' +
        '<p class="muted">Chọn một tính năng nhỏ đã làm, đóng toàn bộ code cũ và tự viết lại từ đầu trên bài toán tương tự. Nếu chưa làm được, đó là <b>dữ liệu để điều chỉnh việc học</b>, không phải lý do để tự trách mình.</p>' +
        '<div class="stat-inline"><div><b>' + st.pass + '</b><span>lần tự làm được</span></div>' +
        '<div><b>' + st.fail + '</b><span>lần cần học thêm</span></div>' +
        '<div><b>' + st.rate + '%</b><span>tỉ lệ thành công</span></div></div></div>' +
        '<div class="card"><h3>Ghi một lần tái tạo</h3>' +
        '<form class="form" data-form="recreation">' +
        '<div class="form-grid">' +
        field('Ngày', '<input type="date" name="date" value="' + U.today() + '" required>') +
        field('Thời gian (phút)', '<input type="number" min="0" step="5" name="minutes" value="45">') + '</div>' +
        field('Tính năng đã tái tạo', '<input type="text" name="feature" required placeholder="Ví dụ: API tạo tài liệu">') +
        '<fieldset class="fieldset"><legend>Kết quả</legend><div class="result-grid">' +
        '<label class="result-option"><input type="radio" name="result" value="pass" checked><span><b>Tự làm được</b><i>Không nhìn lời giải cũ</i></span></label>' +
        '<label class="result-option"><input type="radio" name="result" value="fail"><span><b>Chưa làm được</b><i>Cần học thêm phần nào?</i></span></label>' +
        '</div></fieldset>' +
        field('Ghi chú', '<textarea name="notes" rows="2" placeholder="Vướng ở đâu, lần sau cần ôn gì..."></textarea>') +
        '<div class="form-actions"><button type="submit" class="btn btn-primary">Lưu</button></div></form></div></section>';

      if (!list.length) return h + empty('Chưa có lần tái tạo nào', 'Tuần này hãy chọn một tính năng nhỏ và thử sức.');

      h += '<section class="card">' + head('Lịch sử tái tạo') + '<ul class="recreate-list">' + list.map(function (r) {
        return '<li class="' + r.result + '"><span class="rc-badge">' + (r.result === 'pass' ? 'Đạt' : 'Học thêm') + '</span>' +
          '<div class="rc-body"><b>' + esc(r.feature) + '</b>' +
          '<span class="muted small">' + esc(U.dayName(r.date) + ', ' + U.fmtVN(r.date)) + (r.minutes ? ' · ' + r.minutes + ' phút' : '') + '</span>' +
          (r.notes ? '<p class="muted">' + esc(r.notes) + '</p>' : '') + '</div>' +
          '<button class="btn btn-danger-ghost btn-sm" data-action="delete-recreation" data-id="' + r.id + '">Xoá</button></li>';
      }).join('') + '</ul></section>';
      return h;
    }
  };

  /* ================================ NHÓM ================================ */
  Views.team = {
    title: 'Nhóm theo Scrum',
    subtitle: 'Sprint, bảng việc và họp cải tiến',
    render: function (state) {
      var sprint = state.team.sprints.filter(function (s) { return s.status === 'active'; })[0] || null;
      var stats = sprint ? M.sprintStats(state, sprint) : null;
      var members = state.team.members;
      var backlog = state.team.backlog.filter(function (t) { return !t.sprintId; });

      var h = '';

      h += '<section class="card sprint-head"><div class="row-between">' +
        '<div><p class="eyebrow">Sprint đang chạy</p>' +
        (sprint
          ? '<h3>' + esc(sprint.name) + '</h3><p class="muted small">' + esc(sprint.goal || 'Chưa đặt mục tiêu sprint') + '</p>' +
            '<p class="muted small">' + U.fmtVN(sprint.startDate) + ' → ' + U.fmtVN(sprint.endDate) + ' · còn ' + Math.max(0, U.daysBetween(U.today(), sprint.endDate)) + ' ngày</p>'
          : '<h3>Chưa có sprint nào</h3><p class="muted small">Mở một sprint (thường 1–2 tuần) để gom việc và đo được tốc độ của nhóm.</p>') +
        '</div>' +
        '<div class="row-actions">' +
        '<button class="btn" data-action="new-task">Thêm việc</button>' +
        (sprint
          ? '<button class="btn" data-action="edit-sprint" data-id="' + sprint.id + '">Sửa sprint</button><button class="btn btn-ghost" data-action="close-sprint" data-id="' + sprint.id + '">Kết thúc sprint</button>'
          : '<button class="btn btn-primary" data-action="new-sprint">Mở sprint đầu tiên</button>') +
        '</div></div>' +
        (sprint
          ? '<div class="sprint-stats"><div>' + C.ring({ pct: stats.pct, size: 112, main: stats.pct + '%', sub: 'hoàn thành', color: 'var(--jade)' }) + '</div>' +
            '<div class="sprint-nums">' +
            '<div><b>' + stats.pointsDone + '/' + stats.points + '</b><span>điểm đã xong</span></div>' +
            '<div><b>' + stats.itemsDone + '/' + stats.items + '</b><span>việc đã xong</span></div>' +
            '<div><b>' + members.length + '</b><span>thành viên</span></div>' +
            '</div></div>'
          : '') +
        '</section>';

      if (sprint) {
        h += '<section class="card">' + head('Biểu đồ burndown', chip('lý tưởng & thực tế', 'chip-gold')) +
          C.burndown({ rows: M.burndown(state, sprint), height: 220 }) + '</section>';
      }

      h += '<section class="board-wrap">' + SEED.scrumColumns.map(function (col) {
        var items = sprint ? state.team.backlog.filter(function (t) { return t.sprintId === sprint.id && t.status === col.id; }) : [];
        return '<section class="board-col" data-drop="' + col.id + '">' +
          '<header class="board-col-head"><b>' + esc(col.label) + '</b><span class="board-count">' + items.length + '</span></header>' +
          '<p class="board-hint muted">' + esc(col.hint) + '</p>' +
          '<div class="board-cards">' +
          (items.length ? items.map(function (t) { return taskCard(state, t); }).join('')
            : '<p class="board-empty muted">' + (sprint ? 'Trống' : 'Mở sprint để dùng bảng này') + '</p>') +
          '</div></section>';
      }).join('') + '</section>';

      h += '<section class="grid cols-2">' +
        '<div class="card">' + head('Tồn đọng sản phẩm (' + backlog.length + ')', '<button class="btn btn-sm" data-action="new-task">Thêm việc</button>') +
        (backlog.length
          ? '<ul class="backlog-list">' + backlog.map(function (t) {
            return '<li>' + taskCard(state, t, true) +
              (sprint ? '<button class="btn btn-sm" data-action="task-add-sprint" data-id="' + t.id + '">Đưa vào sprint</button>' : '') +
              '</li>';
          }).join('') + '</ul>'
          : empty('Tồn đọng trống', 'Mọi việc đã được xếp vào sprint hoặc đã xong.')) +
        '</div>' +

        '<div class="card">' + head('Thành viên', '<button class="btn btn-sm" data-action="new-member">Thêm người</button>') +
        (members.length
          ? '<ul class="member-list">' + members.map(function (m) {
            return '<li><span class="avatar" style="background:' + m.color + '">' + esc(initials(m.name)) + '</span>' +
              '<span class="member-name"><b>' + esc(m.name) + '</b><i class="muted small">' + esc(m.role || 'thành viên') + '</i></span>' +
              '<button class="btn btn-danger-ghost btn-sm" data-action="delete-member" data-id="' + m.id + '">Xoá</button></li>';
          }).join('') + '</ul>'
          : empty('Chưa có thành viên', 'Thêm tên đồng đội để chia việc và xem ai đang quá tải.')) +
        (members.length ? '<hr class="sep"><h3>Phân bổ điểm việc</h3>' + C.hbars({
          items: M.memberLoad(state, sprint ? sprint.id : null).map(function (x) {
            return { label: x.member.name, value: x.points, display: x.points + ' điểm / ' + x.items + ' việc', color: x.member.color };
          })
        }) : '') +
        '</div></section>';

      h += '<section class="grid cols-2">' +
        '<div class="card">' + head('Họp cải tiến (retro)', sprint ? chip(sprint.name, 'chip-gold') : '') +
        (sprint
          ? '<form class="form" data-form="retro"><input type="hidden" name="sprintId" value="' + sprint.id + '">' +
            SEED.retroQuestions.map(function (q) {
              return field(q.q, '<textarea name="retro_' + q.id + '" rows="2">' + esc(sprint.retro[q.id] || '') + '</textarea>');
            }).join('') +
            '<div class="form-actions"><button type="submit" class="btn btn-primary">Lưu retro</button></div></form>'
          : empty('Chưa có sprint để họp retro', 'Mở sprint rồi quay lại đây sau khi kết thúc.')) +
        '</div>' +
        '<div class="card">' + head('Định nghĩa "hoàn thành"') +
        '<ul class="dod-list">' + SEED.definitionOfDone.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
        '<p class="muted small">Một việc chỉ được kéo sang cột Hoàn thành khi thoả hết bốn điều trên.</p>' +
        '</div></section>';

      return h;
    }
  };

  function taskCard(state, t, compact) {
    var prio = prioLabel(t.priority);
    var who = memberOf(state, t.assigneeId);
    var cols = SEED.scrumColumns.map(function (c) { return c.id; });
    var idx = cols.indexOf(t.status);
    var prev = idx > 0 ? cols[idx - 1] : null;
    var next = idx < cols.length - 1 ? cols[idx + 1] : null;

    return '<article class="task' + (compact ? ' compact' : '') + '" draggable="true" data-drag="' + t.id + '">' +
      '<div class="task-top"><span class="task-title">' + esc(t.title) + '</span>' +
      '<span class="task-points">' + t.points + '</span></div>' +
      (t.desc ? '<p class="task-desc muted small">' + esc(t.desc) + '</p>' : '') +
      '<div class="task-meta">' +
      '<span class="prio prio-' + t.priority + '" style="--prio:' + prio.color + '">' + esc(prio.label) + '</span>' +
      (who ? '<span class="avatar avatar-sm" style="background:' + who.color + '" title="' + esc(who.name) + '">' + esc(initials(who.name)) + '</span>' : '<span class="muted small">chưa giao</span>') +
      '</div>' +
      (compact ? '' : '<div class="task-actions">' +
        (prev ? '<button class="btn btn-ghost btn-sm" data-action="task-move" data-id="' + t.id + '" data-to="' + prev + '" title="Lùi">←</button>' : '') +
        (next ? '<button class="btn btn-ghost btn-sm" data-action="task-move" data-id="' + t.id + '" data-to="' + next + '" title="Tiến">→</button>' : '') +
        '<button class="btn btn-ghost btn-sm" data-action="edit-task" data-id="' + t.id + '">Sửa</button>' +
        '<button class="btn btn-danger-ghost btn-sm" data-action="delete-task" data-id="' + t.id + '">Xoá</button>' +
        '</div>') +
      '</article>';
  }

  Views.taskForm = function (state, task) {
    var v = Object.assign({ id: '', title: '', desc: '', points: 3, priority: 'vua', status: 'todo', assigneeId: null, sprintId: null }, task || {});
    var sprint = state.team.sprints.filter(function (s) { return s.status === 'active'; })[0];
    var h = '<form class="form" data-form="task"><input type="hidden" name="id" value="' + esc(v.id) + '">';
    h += field('Việc cần làm', '<input type="text" name="title" required value="' + esc(v.title) + '" placeholder="Ví dụ: viết API tạo tài liệu">');
    h += field('Mô tả / tiêu chí nghiệm thu', '<textarea name="desc" rows="2" placeholder="Làm xong thì phải kiểm được điều gì?">' + esc(v.desc) + '</textarea>');
    h += '<div class="form-grid cols-3">' +
      field('Điểm (story point)', '<select name="points">' + SEED.storyPoints.map(function (p) {
        return '<option value="' + p + '"' + (U.num(v.points, 3) === p ? ' selected' : '') + '>' + p + '</option>';
      }).join('') + '</select>') +
      field('Ưu tiên', '<select name="priority">' + SEED.priorities.map(function (p) {
        return '<option value="' + p.id + '"' + (v.priority === p.id ? ' selected' : '') + '>' + esc(p.label) + '</option>';
      }).join('') + '</select>') +
      field('Giao cho', '<select name="assigneeId"><option value="">— chưa giao —</option>' + state.team.members.map(function (m) {
        return '<option value="' + m.id + '"' + (v.assigneeId === m.id ? ' selected' : '') + '>' + esc(m.name) + '</option>';
      }).join('') + '</select>') + '</div>';
    h += '<div class="form-grid">' +
      field('Cột', '<select name="status">' + SEED.scrumColumns.map(function (c) {
        return '<option value="' + c.id + '"' + (v.status === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>';
      }).join('') + '</select>') +
      field('Thuộc sprint', '<select name="sprintId"><option value="">— tồn đọng —</option>' + state.team.sprints.map(function (s) {
        return '<option value="' + s.id + '"' + (v.sprintId === s.id ? ' selected' : '') + '>' + esc(s.name) + (s.status === 'active' ? ' (đang chạy)' : '') + '</option>';
      }).join('') + '</select>') + '</div>';
    if (!sprint) h += '<p class="muted small">Chưa có sprint đang chạy — việc sẽ nằm ở tồn đọng cho tới khi huynh mở sprint.</p>';
    h += '<div class="form-actions"><button type="button" class="btn" data-action="close-modal">Huỷ</button>' +
      '<button type="submit" class="btn btn-primary">Lưu việc</button></div></form>';
    return h;
  };

  Views.sprintForm = function (sprint) {
    var v = Object.assign({ id: '', name: '', goal: '', startDate: U.today(), endDate: U.addDays(U.today(), 13) }, sprint || {});
    var h = '<form class="form" data-form="sprint"><input type="hidden" name="id" value="' + esc(v.id) + '">';
    h += '<div class="form-grid">' +
      field('Tên sprint', '<input type="text" name="name" required value="' + esc(v.name) + '" placeholder="Ví dụ: Sprint 1 — API tài liệu">') +
      field('Mục tiêu sprint', '<input type="text" name="goal" value="' + esc(v.goal) + '" placeholder="Một câu thôi">') + '</div>';
    h += '<div class="form-grid">' +
      field('Bắt đầu', '<input type="date" name="startDate" value="' + esc(v.startDate) + '">') +
      field('Kết thúc', '<input type="date" name="endDate" value="' + esc(v.endDate) + '">') + '</div>';
    h += '<p class="muted small">Sprint 1–2 tuần là vừa sức với người tự học. Kết thúc sprint thì họp retro để cải tiến cho sprint sau.</p>';
    h += '<div class="form-actions"><button type="button" class="btn" data-action="close-modal">Huỷ</button>' +
      '<button type="submit" class="btn btn-primary">Mở sprint</button></div></form>';
    return h;
  };

  /* ============================== ĐÁNH GIÁ ============================== */
  Views.stats = {
    title: 'Đánh giá quá trình',
    subtitle: 'Đo bằng năng lực tự giải quyết, không bằng số dòng code',
    render: function (state, ui) {
      var range = (ui && ui.range) || 30;
      var t = M.totals(state, range);
      var autonomy = M.autonomyIndex(state, range);
      var serial = M.seriesAutonomy(state, range);
      var rows = M.dailyMinutes(state, range === 0 ? 30 : Math.min(range, 30));
      var cat = M.categoryTotals(state, range);
      var modes = M.modeDistribution(state, range);
      var rs = M.recreationStats(state);
      var rt = M.readingTotals(state, range);
      var keys = SEED.schedule.map(function (i) { return { key: i.id, label: i.short || i.label, color: i.color }; });
      var modeColors = { A: '#2f6b52', B: '#3b4a7a', C: '#7a4b8a', D: '#b08419' };

      var h = '<section class="card toolbar"><span class="muted small">Khoảng thời gian:</span>' +
        [[7, '7 ngày'], [30, '30 ngày'], [90, '90 ngày'], [0, 'Tất cả']].map(function (o) {
          return '<button class="seg' + (range === o[0] ? ' on' : '') + '" data-action="set-range" data-range="' + o[0] + '">' + o[1] + '</button>';
        }).join('') + '</section>';

      h += '<section class="grid cols-4">' +
        statCard('Chỉ số tự lực', autonomy, '/100', 'Càng cao càng ít phụ thuộc AI.', '鑑') +
        statCard('Vấn đề tự giải', t.selfSolved, 'vấn đề', 'Đây mới là thước đo tiến bộ.') +
        statCard('Khái niệm giải thích được', t.concepts, 'khái niệm', 'Giải thích được mới là hiểu.') +
        statCard('Buổi debug độc lập', t.debugNoAI, '/' + t.sessions + ' buổi', 'Không có AI vẫn tìm ra lỗi.') +
        '</section>';

      h += '<section class="card">' + head('Diễn biến chỉ số tự lực', '<span class="muted small">theo từng buổi học</span>') +
        C.area({ points: serial, height: 220, max: 100, color: 'var(--jade)', goal: 70, goalLabel: 'mốc 70' }) + '</section>';

      h += '<section class="card">' + head('Thời gian theo ngày', C.legend(keys)) +
        C.stackedBars({ rows: rows, keys: keys, height: 230 }) + '</section>';

      h += '<section class="grid cols-2">';
      var totalMin = keys.reduce(function (a, k) { return a + (cat[k.key] || 0); }, 0);
      h += '<div class="card"><h3>Phân bổ thời gian</h3><div class="donut-wrap">' +
        C.donut({
          segments: keys.map(function (k) { return { label: k.label, value: cat[k.key] || 0, color: k.color }; }),
          size: 200, thickness: 26, main: Math.round(totalMin / 60) + 'h', sub: totalMin + ' phút'
        }) +
        '<ul class="donut-legend">' + keys.map(function (k) {
          return '<li><i style="background:' + k.color + '"></i><span>' + esc(k.label) + '</span><b>' + (cat[k.key] || 0) + 'p</b></li>';
        }).join('') + '</ul></div></div>';

      h += '<div class="card"><h3>Chế độ dùng AI</h3>' +
        C.hbars({
          items: SEED.aiModes.map(function (m) {
            return { label: 'Chế độ ' + m.id + ' · ' + m.name, value: modes[m.id] || 0, color: modeColors[m.id], display: (modes[m.id] || 0) + ' buổi' };
          })
        }) +
        '<p class="muted small">Ưu tiên A và B trong giai đoạn đầu. Nếu D chiếm phần lớn, hãy giảm phạm vi giao cho AI.</p>' +
        '<hr class="sep"><h3>Tự tin theo cảnh giới</h3>' +
        C.hbars({
          items: SEED.levels.map(function (lv) {
            var s = M.levelStats(state, lv);
            return { label: 'Cảnh giới ' + lv.id + ' · ' + lv.name, value: s.confidence, display: s.confidence + '/5', color: 'var(--indigo)' };
          })
        }) + '</div></section>';

      var vel = M.velocity(state);
      h += '<section class="grid cols-2">' +
        '<div class="card"><h3>Việc đọc trong khoảng đã chọn</h3>' +
        '<div class="stat-inline"><div><b>' + rt.amount + '</b><span>đơn vị đã đọc</span></div>' +
        '<div><b>' + rt.logs + '</b><span>lần ghi</span></div>' +
        '<div><b>' + Math.round(rt.minutes / 60 * 10) / 10 + 'h</b><span>thời gian đọc</span></div></div>' +
        '<hr class="sep"><h3>Nhịp đọc 14 ngày</h3>' +
        C.bars({ rows: M.readingDaily(state, 14), height: 170, color: 'var(--bronze)' }) + '</div>' +

        '<div class="card"><h3>Tốc độ nhóm (velocity)</h3>' +
        (vel.length
          ? C.hbars({ items: vel.map(function (v) { return { label: v.label, value: v.value, display: v.value + ' điểm', color: 'var(--jade)' }; }) })
          : empty('Chưa có sprint nào kết thúc', 'Hoàn thành một sprint rồi tốc độ sẽ hiện ở đây.')) +
        '<p class="muted small">Tốc độ giúp huynh chọn khối lượng việc vừa sức cho sprint sau, thay vì tham lam rồi bỏ dở.</p>' +
        '<hr class="sep"><h3>Tái tạo không nhìn lời giải</h3>' +
        '<div class="stat-inline"><div><b>' + rs.pass + '/' + rs.total + '</b><span>lần thành công</span></div><div><b>' + rs.rate + '%</b><span>tỉ lệ</span></div></div>' +
        '</div></section>';

      h += '<section class="grid cols-3">' +
        statCard('Tổng buổi học', t.sessions, 'buổi', 'Trong khoảng đã chọn.') +
        statCard('Tổng thời gian', Math.round(t.minutes / 60 * 10) / 10, 'giờ', 'Chất lượng hơn số lượng.') +
        statCard('Việc đã xong', state.team.backlog.filter(function (x) { return x.status === 'done'; }).length, 'việc', 'Trên toàn bộ tồn đọng.') +
        '</section>';

      return h;
    }
  };

  /* ============================== CÀI ĐẶT ============================== */
  Views.settings = {
    title: 'Cài đặt',
    subtitle: 'Hồ sơ, giao diện và dữ liệu',
    render: function (state) {
      var p = state.profile;
      var h = '';

      h += '<section class="grid cols-2">' +
        '<div class="card"><h3>Hồ sơ</h3><form class="form" data-form="profile">' +
        field('Tên gọi', '<input type="text" name="name" value="' + esc(p.name) + '" placeholder="Ví dụ: Minh">') +
        '<div class="form-grid">' +
        field('Ngày bắt đầu', '<input type="date" name="startDate" value="' + esc(p.startDate) + '">') +
        field('Mục tiêu mỗi ngày (phút)', '<input type="number" min="15" step="15" name="goalMinutes" value="' + p.goalMinutes + '">') +
        '</div>' +
        field('Cảnh giới hiện tại', '<select name="currentLevel">' + SEED.levels.map(function (lv) {
          return '<option value="' + lv.id + '"' + (p.currentLevel === lv.id ? ' selected' : '') + '>Cảnh giới ' + lv.id + ' — ' + esc(lv.name) + '</option>';
        }).join('') + '</select>') +
        '<div class="form-actions"><button type="submit" class="btn btn-primary">Lưu hồ sơ</button></div></form></div>' +

        '<div class="card"><h3>Giao diện</h3>' +
        '<p class="muted small">Chọn tông màu huynh thấy dễ chịu khi ngồi lâu.</p>' +
        '<div class="theme-grid">' +
        '<label class="theme-option' + (p.theme === 'giay' ? ' on' : '') + '"><input type="radio" name="theme" value="giay" data-action="set-theme"' + (p.theme === 'giay' ? ' checked' : '') + '>' +
        '<span class="theme-swatch swatch-giay"></span><span><b>Giấy dó</b><i>Tông sáng, ấm, như trang sách cũ</i></span></label>' +
        '<label class="theme-option' + (p.theme === 'muc' ? ' on' : '') + '"><input type="radio" name="theme" value="muc" data-action="set-theme"' + (p.theme === 'muc' ? ' checked' : '') + '>' +
        '<span class="theme-swatch swatch-muc"></span><span><b>Mực đêm</b><i>Tông tối, dịu mắt khi học khuya</i></span></label>' +
        '</div>' +
        '<hr class="sep"><h3>Dữ liệu</h3>' +
        '<p class="muted small">Toàn bộ dữ liệu nằm trong trình duyệt của huynh, không gửi đi đâu. Hãy xuất file sao lưu định kỳ.</p>' +
        '<div class="data-actions">' +
        '<button class="btn" data-action="export-data">Xuất dữ liệu (.json)</button>' +
        '<button class="btn" data-action="pick-import">Nhập từ file</button>' +
        '<input type="file" id="importFile" accept="application/json,.json" hidden>' +
        '<button class="btn btn-danger-ghost" data-action="reset-data">Xoá toàn bộ dữ liệu</button>' +
        '</div>' +
        '<p class="muted small">Hiện có ' + state.sessions.length + ' buổi học · ' + state.books.length + ' tài liệu · ' +
        state.team.backlog.length + ' việc · ' + state.team.sprints.length + ' sprint</p>' +
        '</div></section>';

      h += '<section class="card about"><h3>Về web này</h3>' +
        '<p>Bám theo bức thư: <b>Understand → Build → Verify → Accelerate</b>. Web này không viết code thay huynh — nó giữ nhật ký, điểm danh giới luật, đo chỉ số tự lực, theo dõi việc đọc và giúp chia việc nhóm theo Scrum.</p>' +
        '<div class="method-strip">' + SEED.methods.map(function (m, i) {
          return '<div class="method-step"><span class="method-idx">' + (i + 1) + '</span><b>' + esc(m.name) + '</b><i>' + esc(m.vi) + '</i></div>';
        }).join('') + '</div>' +
        '<p class="muted small">Chỉ số tự lực = chế độ AI (tối đa 25) + vấn đề tự giải (30) + khái niệm giải thích được (25) + debug độc lập (20).</p>' +
        '</section>';

      return h;
    }
  };

  Views.notFound = {
    title: 'Không tìm thấy',
    subtitle: '',
    render: function () { return '<section class="card">' + empty('Trang này không tồn tại', 'Hãy chọn một mục ở thanh bên.') + '</section>'; }
  };

  Views.memberForm = function () {
    var h = '<form class="form" data-form="member">';
    h += field('Tên đồng đội', '<input type="text" name="name" required placeholder="Ví dụ: Lan">');
    h += field('Vai trò', '<input type="text" name="role" placeholder="backend, kiểm thử, giao diện...">');
    h += '<div class="form-actions"><button type="button" class="btn" data-action="close-modal">Huỷ</button>' +
      '<button type="submit" class="btn btn-primary">Thêm người</button></div></form>';
    return h;
  };

  global.Views = Views;
})(window);
