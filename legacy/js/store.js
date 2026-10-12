/* =====================================================================
   store.js — Tầng dữ liệu (localStorage) + các chỉ số đánh giá
   Nguyên tắc: KHÔNG đo tiến bộ bằng số dòng code.
   ===================================================================== */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'tu-luyen-ky.v2';

  /* ------------------------------ Tiện ích ------------------------------ */
  function uid() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

  function isoDate(d) {
    var x = d ? new Date(d) : new Date();
    if (isNaN(x.getTime())) x = new Date();
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  }
  function today() { return isoDate(); }
  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDate(d); }
  function dayName(iso) { var n = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']; var d = new Date(iso + 'T00:00:00'); return isNaN(d.getTime()) ? '' : n[d.getDay()]; }
  function fmtVN(iso) { var p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
  function num(v, fallback) { var n = Number(v); return isFinite(n) ? n : (fallback || 0); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }

  /* --------------------------- Chuẩn hoá dữ liệu --------------------------- */
  function defaultState() {
    var s = {
      version: 2,
      profile: { name: '', startDate: today(), goalMinutes: 210, currentLevel: 1, theme: 'giay' },
      sessions: [], ruleAudit: {}, levelProgress: {}, recreations: [],
      books: [], readingLogs: [],
      team: { members: [], backlog: [], sprints: [] },
      timer: { running: false, endsAt: null, remainingMs: 45 * 60000, minutes: 45, label: '' },
      createdAt: new Date().toISOString()
    };
    ensureLevelProgress(s);
    return s;
  }

  function ensureLevelProgress(s) {
    (global.SEED.levels || []).forEach(function (lv) {
      if (!s.levelProgress[lv.id]) s.levelProgress[lv.id] = { tasks: {}, pass: false, confidence: 1, passedAt: null };
      var p = s.levelProgress[lv.id];
      if (typeof p.confidence !== 'number') p.confidence = 1;
      lv.tasks.forEach(function (_, i) { if (p.tasks[i] === undefined) p.tasks[i] = false; });
    });
    return s;
  }

  function normalizeSession(x) {
    x = x || {};
    var minutes = {}, journal = {};
    global.SEED.schedule.forEach(function (i) { minutes[i.id] = num((x.minutes || {})[i.id], 0); });
    global.SEED.journalQuestions.forEach(function (q) { journal[q.id] = String((x.journal || {})[q.id] || ''); });
    return {
      id: x.id || uid(), date: x.date || today(), level: num(x.level, 1),
      mode: ['A', 'B', 'C', 'D'].indexOf(x.mode) >= 0 ? x.mode : 'B',
      minutes: minutes,
      selfSolved: num(x.selfSolved, 0), conceptsExplained: num(x.conceptsExplained, 0),
      debugWithoutAI: !!x.debugWithoutAI, journal: journal,
      tags: Array.isArray(x.tags) ? x.tags.filter(Boolean).map(String) : [],
      createdAt: x.createdAt || new Date().toISOString()
    };
  }

  function normalizeBook(x) {
    x = x || {};
    var unit = global.SEED.readingUnits.indexOf(x.unit) >= 0 ? x.unit : 'trang';
    var status = ['reading', 'paused', 'done'].indexOf(x.status) >= 0 ? x.status : 'reading';
    return {
      id: x.id || uid(),
      title: String(x.title || '').trim(),
      author: String(x.author || '').trim(),
      kind: global.SEED.readingKinds.some(function (k) { return k.id === x.kind; }) ? x.kind : 'sach',
      unit: unit,
      total: num(x.total, 0),
      progress: num(x.progress, 0),
      status: status,
      rating: Math.max(0, Math.min(5, num(x.rating, 0))),
      takeaways: String(x.takeaways || ''),
      tags: Array.isArray(x.tags) ? x.tags.filter(Boolean).map(String) : [],
      startedAt: x.startedAt || today(),
      finishedAt: x.finishedAt || null,
      createdAt: x.createdAt || new Date().toISOString()
    };
  }

  function normalizeReadingLog(x) {
    x = x || {};
    return {
      id: x.id || uid(), bookId: String(x.bookId || ''), date: x.date || today(),
      amount: num(x.amount, 0), minutes: num(x.minutes, 0), note: String(x.note || ''),
      createdAt: x.createdAt || new Date().toISOString()
    };
  }

  function normalizeMember(x) {
    x = x || {};
    return { id: x.id || uid(), name: String(x.name || '').trim(), role: String(x.role || '').trim(), color: x.color || global.SEED.memberColors[0] };
  }

  function normalizeTask(x) {
    x = x || {};
    var status = ['todo', 'doing', 'review', 'done'].indexOf(x.status) >= 0 ? x.status : 'todo';
    var priority = global.SEED.priorities.some(function (p) { return p.id === x.priority; }) ? x.priority : 'vua';
    var points = global.SEED.storyPoints.indexOf(num(x.points, 1)) >= 0 ? num(x.points, 1) : 1;
    return {
      id: x.id || uid(),
      title: String(x.title || '').trim(),
      desc: String(x.desc || '').trim(),
      points: points,
      priority: priority,
      status: status,
      inSprint: !!x.inSprint,
      sprintId: x.sprintId || null,
      assigneeId: x.assigneeId || null,
      doneAt: x.doneAt || null,
      createdAt: x.createdAt || new Date().toISOString()
    };
  }

  function normalizeSprint(x) {
    x = x || {};
    var status = ['planned', 'active', 'done'].indexOf(x.status) >= 0 ? x.status : 'planned';
    return {
      id: x.id || uid(),
      name: String(x.name || '').trim(),
      goal: String(x.goal || '').trim(),
      startDate: x.startDate || today(),
      endDate: x.endDate || addDays(today(), 13),
      status: status,
      retro: { good: '', improve: '', actions: '' },
      _retro: x.retro,
      createdAt: x.createdAt || new Date().toISOString()
    };
  }

  function normalize(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    var s = {
      version: 2,
      profile: Object.assign({}, base.profile, raw.profile || {}),
      sessions: Array.isArray(raw.sessions) ? raw.sessions.map(normalizeSession) : [],
      ruleAudit: (raw.ruleAudit && typeof raw.ruleAudit === 'object') ? raw.ruleAudit : {},
      levelProgress: (raw.levelProgress && typeof raw.levelProgress === 'object') ? raw.levelProgress : {},
      recreations: Array.isArray(raw.recreations) ? raw.recreations.map(function (x) {
        x = x || {};
        return {
          id: x.id || uid(), date: x.date || today(), feature: String(x.feature || ''),
          result: x.result === 'pass' ? 'pass' : 'fail', minutes: num(x.minutes, 0), notes: String(x.notes || '')
        };
      }) : [],
      books: Array.isArray(raw.books) ? raw.books.map(normalizeBook) : [],
      readingLogs: Array.isArray(raw.readingLogs) ? raw.readingLogs.map(normalizeReadingLog) : [],
      team: {
        members: (raw.team && Array.isArray(raw.team.members)) ? raw.team.members.map(normalizeMember) : [],
        backlog: (raw.team && Array.isArray(raw.team.backlog)) ? raw.team.backlog.map(normalizeTask) : [],
        sprints: (raw.team && Array.isArray(raw.team.sprints)) ? raw.team.sprints.map(normalizeSprint) : []
      },
      timer: Object.assign({}, base.timer, raw.timer || {}),
      createdAt: raw.createdAt || base.createdAt
    };
    s.team.sprints.forEach(function (sp) {
      if (sp._retro && typeof sp._retro === 'object') {
        sp.retro = {
          good: String(sp._retro.good || ''), improve: String(sp._retro.improve || ''), actions: String(sp._retro.actions || '')
        };
      }
      delete sp._retro;
    });
    if (['giay', 'muc'].indexOf(s.profile.theme) < 0) s.profile.theme = 'giay';
    ensureLevelProgress(s);
    return s;
  }

  /* ------------------------------- Store ------------------------------- */
  var Store = {
    state: null,
    lastSavedAt: null,
    _listeners: [],

    init: function () {
      var raw = null;
      try {
        var text = global.localStorage.getItem(STORAGE_KEY);
        if (text) raw = JSON.parse(text);
      } catch (e) { console.warn('Không đọc được dữ liệu đã lưu:', e); }
      this.state = raw ? normalize(raw) : defaultState();
      if (!raw) this.persist();
      return this.state;
    },

    persist: function () {
      try {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        this.lastSavedAt = new Date();
      } catch (e) {
        console.error('Không ghi được dữ liệu:', e);
        if (global.App && global.App.toast) global.App.toast('Không lưu được dữ liệu — trình duyệt có thể đang chặn localStorage.', 'error');
      }
    },

    subscribe: function (fn) { this._listeners.push(fn); },
    emit: function () { this._listeners.forEach(function (fn) { fn(); }); },
    commit: function () { this.persist(); this.emit(); },
    /** Lưu mà không vẽ lại giao diện (dùng cho đồng hồ đếm từng giây). */
    commitQuiet: function () { this.persist(); },

    /* ---------------------------- Buổi học ---------------------------- */
    addSession: function (data) {
      var s = normalizeSession(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, data));
      this.state.sessions.push(s);
      this.commit();
      return s;
    },
    updateSession: function (id, data) {
      var i = this.state.sessions.findIndex(function (x) { return x.id === id; });
      if (i < 0) return null;
      this.state.sessions[i] = normalizeSession(Object.assign({}, this.state.sessions[i], data, { id: id }));
      this.commit();
      return this.state.sessions[i];
    },
    removeSession: function (id) { this.state.sessions = this.state.sessions.filter(function (x) { return x.id !== id; }); this.commit(); },
    getSession: function (id) { return this.state.sessions.filter(function (x) { return x.id === id; })[0] || null; },
    lastSession: function () {
      var l = this.state.sessions.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      return l[0] || null;
    },

    /* --------------------- Ghi nhanh theo lịch mỗi ngày --------------------- */
    logTodayBlock: function (key, minutes) {
      var t = today();
      var existing = this.state.sessions.filter(function (s) { return s.date === t; })[0];
      var patch = { minutes: {} };
      global.SEED.schedule.forEach(function (i) { patch.minutes[i.id] = 0; });
      if (existing) {
        patch.minutes = Object.assign({}, existing.minutes);
        patch.minutes[key] = num(minutes, 0);
        this.updateSession(existing.id, patch);
      } else {
        patch.minutes[key] = num(minutes, 0);
        patch.date = t;
        patch.level = this.state.profile.currentLevel;
        this.addSession(patch);
      }
    },

    /* ---------------------------- Giới luật ---------------------------- */
    toggleRule: function (date, ruleId) { var d = this.state.ruleAudit[date] || {}; d[ruleId] = !d[ruleId]; this.state.ruleAudit[date] = d; this.commit(); },
    setRule: function (date, ruleId, on) { var d = this.state.ruleAudit[date] || {}; d[ruleId] = !!on; this.state.ruleAudit[date] = d; this.commit(); },

    /* ----------------------------- Lộ trình ----------------------------- */
    toggleTask: function (levelId, index) { var p = this.state.levelProgress[levelId]; if (!p) return; p.tasks[index] = !p.tasks[index]; this.commit(); },
    setTask: function (levelId, index, on) { var p = this.state.levelProgress[levelId]; if (!p) return; p.tasks[index] = !!on; this.commit(); },
    setPass: function (levelId, on) {
      var p = this.state.levelProgress[levelId];
      if (!p) return;
      p.pass = !!on; p.passedAt = p.pass ? new Date().toISOString() : null;
      if (p.pass && this.state.profile.currentLevel === Number(levelId)) this.state.profile.currentLevel = Math.min(5, Number(levelId) + 1);
      this.commit();
    },
    setConfidence: function (levelId, value) { var p = this.state.levelProgress[levelId]; if (!p) return; p.confidence = Math.max(1, Math.min(5, num(value, 1))); this.commit(); },
    setCurrentLevel: function (levelId) { this.state.profile.currentLevel = Math.max(1, Math.min(5, num(levelId, 1))); this.commit(); },

    /* ----------------------------- Tái tạo ----------------------------- */
    addRecreation: function (data) {
      this.state.recreations.push({
        id: uid(), date: data.date || today(), feature: String(data.feature || '').trim(),
        result: data.result === 'pass' ? 'pass' : 'fail', minutes: num(data.minutes, 0), notes: String(data.notes || '').trim()
      });
      this.commit();
    },
    removeRecreation: function (id) { this.state.recreations = this.state.recreations.filter(function (x) { return x.id !== id; }); this.commit(); },

    /* ------------------------------- Sách ------------------------------- */
    addBook: function (data) { var b = normalizeBook(data); this.state.books.push(b); this.commit(); return b; },
    updateBook: function (id, data) {
      var i = this.state.books.findIndex(function (x) { return x.id === id; });
      if (i < 0) return null;
      this.state.books[i] = normalizeBook(Object.assign({}, this.state.books[i], data, { id: id }));
      this.commit();
      return this.state.books[i];
    },
    removeBook: function (id) {
      this.state.books = this.state.books.filter(function (x) { return x.id !== id; });
      this.state.readingLogs = this.state.readingLogs.filter(function (l) { return l.bookId !== id; });
      this.commit();
    },
    getBook: function (id) { return this.state.books.filter(function (x) { return x.id === id; })[0] || null; },

    addReadingLog: function (data) {
      var log = normalizeReadingLog(data);
      this.state.readingLogs.push(log);
      var book = this.getBook(log.bookId);
      if (book) {
        var next = num(book.progress, 0) + num(log.amount, 0);
        if (book.total > 0) next = Math.min(book.total, next);
        book.progress = next;
        if (book.total > 0 && book.progress >= book.total && book.status === 'reading') {
          book.status = 'done';
          book.finishedAt = today();
        }
      }
      this.commit();
      return log;
    },
    removeReadingLog: function (id) {
      var log = this.state.readingLogs.filter(function (x) { return x.id === id; })[0];
      if (log) {
        var book = this.getBook(log.bookId);
        if (book) book.progress = Math.max(0, num(book.progress, 0) - num(log.amount, 0));
      }
      this.state.readingLogs = this.state.readingLogs.filter(function (x) { return x.id !== id; });
      this.commit();
    },
    logsFor: function (bookId) {
      return this.state.readingLogs.filter(function (l) { return l.bookId === bookId; })
        .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    },

    /* ------------------------------- Nhóm ------------------------------- */
    addMember: function (data) {
      var used = this.state.team.members.length;
      this.state.team.members.push(normalizeMember(Object.assign({ color: global.SEED.memberColors[used % global.SEED.memberColors.length] }, data)));
      this.commit();
    },
    removeMember: function (id) {
      this.state.team.members = this.state.team.members.filter(function (m) { return m.id !== id; });
      this.state.team.backlog.forEach(function (t) { if (t.assigneeId === id) t.assigneeId = null; });
      this.commit();
    },

    addTask: function (data) {
      var t = normalizeTask(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, data));
      if (t.sprintId || t.inSprint) {
        var sp = this.activeSprint();
        if (!t.sprintId && sp) t.sprintId = sp.id;
        t.inSprint = true;
        if (!t.status || t.status === 'todo') t.status = 'todo';
      }
      this.state.team.backlog.push(t);
      this.commit();
      return t;
    },
    updateTask: function (id, data) {
      var i = this.state.team.backlog.findIndex(function (x) { return x.id === id; });
      if (i < 0) return null;
      this.state.team.backlog[i] = normalizeTask(Object.assign({}, this.state.team.backlog[i], data, { id: id }));
      this.commit();
      return this.state.team.backlog[i];
    },
    removeTask: function (id) { this.state.team.backlog = this.state.team.backlog.filter(function (x) { return x.id !== id; }); this.commit(); },
    getTask: function (id) { return this.state.team.backlog.filter(function (x) { return x.id === id; })[0] || null; },

    moveTask: function (id, status) {
      var t = this.getTask(id);
      if (!t) return;
      t.status = status;
      t.doneAt = status === 'done' ? today() : null;
      this.commit();
    },
    setTaskSprint: function (id, sprintId) {
      var t = this.getTask(id);
      if (!t) return;
      t.sprintId = sprintId || null;
      t.inSprint = !!sprintId;
      t.status = sprintId ? 'todo' : 'todo';
      if (!sprintId) t.status = 'todo';
      this.commit();
    },

    activeSprint: function () {
      return this.state.team.sprints.filter(function (s) { return s.status === 'active'; })[0] || null;
    },
    getSprint: function (id) { return this.state.team.sprints.filter(function (s) { return s.id === id; })[0] || null; },

    addSprint: function (data) {
      var sp = normalizeSprint(data);
      // Mở sprint mới thì sprint cũ đang chạy phải khép lại.
      sp.status = 'active';
      this.state.team.sprints.forEach(function (s) { if (s.id !== sp.id && s.status === 'active') s.status = 'done'; });
      this.state.team.sprints.push(sp);
      this.commit();
      return sp;
    },
    updateSprint: function (id, data) {
      var i = this.state.team.sprints.findIndex(function (x) { return x.id === id; });
      if (i < 0) return null;
      this.state.team.sprints[i] = normalizeSprint(Object.assign({}, this.state.team.sprints[i], data, { id: id }));
      this.commit();
      return this.state.team.sprints[i];
    },
    closeSprint: function (id) {
      var sp = this.getSprint(id);
      if (!sp) return;
      sp.status = 'done';
      this.commit();
    },
    saveRetro: function (id, data) {
      var sp = this.getSprint(id);
      if (!sp) return;
      sp.retro = Object.assign({ good: '', improve: '', actions: '' }, sp.retro, data);
      this.commit();
    },

    /* ------------------------------ Đồng hồ ------------------------------ */
    setTimer: function (patch) { this.state.timer = Object.assign({}, this.state.timer, patch); this.commitQuiet(); },

    /* ------------------------------- Hồ sơ ------------------------------- */
    saveProfile: function (data) {
      this.state.profile = Object.assign({}, this.state.profile, data);
      this.state.profile.goalMinutes = Math.max(15, num(this.state.profile.goalMinutes, 210));
      this.state.profile.currentLevel = Math.max(1, Math.min(5, num(this.state.profile.currentLevel, 1)));
      this.commit();
    },
    setTheme: function (theme) { this.state.profile.theme = theme === 'muc' ? 'muc' : 'giay'; this.commit(); },

    /* ------------------------------ Sao lưu ------------------------------ */
    exportJSON: function () { return JSON.stringify(this.state, null, 2); },
    importJSON: function (text) { this.state = normalize(JSON.parse(text)); this.commit(); },
    reset: function () { this.state = defaultState(); this.commit(); }
  };

  /* ============================== Chỉ số ============================== */
  var MODE_SCORE = {};
  global.SEED.aiModes.forEach(function (m) { MODE_SCORE[m.id] = m.score; });

  function minutesOf(s) { var t = 0; global.SEED.schedule.forEach(function (i) { t += num(s.minutes[i.id], 0); }); return t; }
  function hasJournal(s) { return global.SEED.journalQuestions.some(function (q) { return String(s.journal[q.id] || '').trim().length > 0; }); }

  function sessionScore(s) {
    if (!s) return 0;
    return Math.round(
      (MODE_SCORE[s.mode] || 0) +
      Math.min(30, num(s.selfSolved, 0) * 10) +
      Math.min(25, num(s.conceptsExplained, 0) * 8) +
      (s.debugWithoutAI ? 20 : 0)
    );
  }

  function sessionsInRange(state, days) {
    var list = state.sessions.slice().sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    if (!days || days <= 0) return list;
    var from = addDays(today(), -(days - 1));
    return list.filter(function (s) { return s.date >= from; });
  }

  function streak(state) {
    var days = {};
    state.sessions.forEach(function (s) { if (minutesOf(s) > 0 || hasJournal(s)) days[s.date] = true; });
    state.readingLogs.forEach(function (l) { days[l.date] = true; });
    var count = 0, cursor = today();
    if (!days[cursor]) cursor = addDays(cursor, -1);
    while (days[cursor]) { count++; cursor = addDays(cursor, -1); }
    return count;
  }

  function minutesToday(state) { return state.sessions.filter(function (s) { return s.date === today(); }).reduce(function (a, s) { return a + minutesOf(s); }, 0); }
  function minutesOn(state, date) { return state.sessions.filter(function (s) { return s.date === date; }).reduce(function (a, s) { return a + minutesOf(s); }, 0); }

  function categoryTotals(state, days) {
    var out = {};
    global.SEED.schedule.forEach(function (i) { out[i.id] = 0; });
    sessionsInRange(state, days).forEach(function (s) { global.SEED.schedule.forEach(function (i) { out[i.id] += num(s.minutes[i.id], 0); }); });
    return out;
  }

  function autonomyIndex(state, days) {
    var list = sessionsInRange(state, days);
    if (!list.length) return 0;
    return Math.round(list.reduce(function (a, s) { return a + sessionScore(s); }, 0) / list.length);
  }
  function seriesAutonomy(state, days) {
    return sessionsInRange(state, days).map(function (s) { return { label: fmtVN(s.date).slice(0, 5), value: sessionScore(s), date: s.date }; });
  }

  function dailyMinutes(state, days) {
    var rows = [];
    for (var i = days - 1; i >= 0; i--) {
      var date = addDays(today(), -i), values = {};
      global.SEED.schedule.forEach(function (it) { values[it.id] = 0; });
      state.sessions.forEach(function (s) {
        if (s.date !== date) return;
        global.SEED.schedule.forEach(function (it) { values[it.id] += num(s.minutes[it.id], 0); });
      });
      rows.push({ label: dayName(date) + ' ' + fmtVN(date).slice(0, 5), date: date, values: values });
    }
    return rows;
  }

  function modeDistribution(state, days) {
    var out = { A: 0, B: 0, C: 0, D: 0 };
    sessionsInRange(state, days).forEach(function (s) { out[s.mode] = (out[s.mode] || 0) + 1; });
    return out;
  }

  function totals(state, days) {
    var list = sessionsInRange(state, days);
    return {
      sessions: list.length,
      minutes: list.reduce(function (a, s) { return a + minutesOf(s); }, 0),
      selfSolved: list.reduce(function (a, s) { return a + num(s.selfSolved, 0); }, 0),
      concepts: list.reduce(function (a, s) { return a + num(s.conceptsExplained, 0); }, 0),
      debugNoAI: list.filter(function (s) { return s.debugWithoutAI; }).length
    };
  }

  function levelStats(state, level) {
    var p = state.levelProgress[level.id] || { tasks: {}, pass: false, confidence: 1 };
    var done = level.tasks.filter(function (_, i) { return !!p.tasks[i]; }).length;
    var total = level.tasks.length;
    return { done: done, total: total, pct: total ? Math.round(done / total * 100) : 0, pass: !!p.pass, confidence: p.confidence || 1 };
  }

  function ruleCompletion(state, date) {
    var day = state.ruleAudit[date] || {};
    return { done: global.SEED.rules.filter(function (r) { return day[r.id]; }).length, total: global.SEED.rules.length };
  }

  function recreationStats(state) {
    var list = state.recreations;
    var pass = list.filter(function (r) { return r.result === 'pass'; }).length;
    return { total: list.length, pass: pass, fail: list.length - pass, rate: list.length ? Math.round(pass / list.length * 100) : 0 };
  }

  /* --------------------------- Chỉ số việc đọc --------------------------- */
  function readingStats(state, book) {
    var logs = state.readingLogs.filter(function (l) { return l.bookId === book.id; });
    var total = num(book.total, 0), progress = num(book.progress, 0);
    var from = addDays(today(), -13);
    var recent = logs.filter(function (l) { return l.date >= from; });
    var recentAmount = recent.reduce(function (a, l) { return a + num(l.amount, 0); }, 0);
    var spanDays = Math.max(1, Math.min(14, daysBetween(book.startedAt || today(), today()) + 1));
    var pace = recent.length ? Math.round(recentAmount / spanDays * 10) / 10 : 0;
    var remaining = total > 0 ? Math.max(0, total - progress) : 0;
    var eta = (pace > 0 && remaining > 0) ? addDays(today(), Math.ceil(remaining / pace)) : null;
    return {
      pct: total > 0 ? Math.min(100, Math.round(progress / total * 100)) : (book.status === 'done' ? 100 : 0),
      progress: progress, total: total, remaining: remaining,
      pace: pace,
      eta: eta,
      logs: logs,
      minutes: logs.reduce(function (a, l) { return a + num(l.minutes, 0); }, 0),
      lastDate: logs.length ? logs[0].date : null
    };
  }

  function readingTotals(state, days) {
    var from = (!days || days <= 0) ? '0000-01-01' : addDays(today(), -(days - 1));
    var logs = state.readingLogs.filter(function (l) { return l.date >= from; });
    var amount = logs.reduce(function (a, l) { return a + num(l.amount, 0); }, 0);
    var daysWith = {};
    logs.forEach(function (l) { daysWith[l.date] = true; });
    var active = Object.keys(daysWith).length;
    return {
      books: state.books.length,
      reading: state.books.filter(function (b) { return b.status === 'reading'; }).length,
      done: state.books.filter(function (b) { return b.status === 'done'; }).length,
      logs: logs.length,
      amount: amount,
      minutes: logs.reduce(function (a, l) { return a + num(l.minutes, 0); }, 0),
      pacePerDay: active ? Math.round(amount / Math.max(1, Math.min(days || 30, Math.max(1, daysBetween(from, today()) + 1))) * 10) / 10 : 0,
      activeDays: active
    };
  }

  function readingDaily(state, days) {
    var rows = [];
    for (var i = days - 1; i >= 0; i--) {
      var date = addDays(today(), -i);
      var amount = state.readingLogs.filter(function (l) { return l.date === date; }).reduce(function (a, l) { return a + num(l.amount, 0); }, 0);
      rows.push({ label: dayName(date) + ' ' + fmtVN(date).slice(0, 5), value: amount, date: date });
    }
    return rows;
  }

  /* ------------------------- Chỉ số nhóm Scrum ------------------------- */
  function sprintItems(state, sprintId) {
    return state.team.backlog.filter(function (t) { return t.sprintId === sprintId; });
  }

  function sprintStats(state, sprint) {
    if (!sprint) return { items: 0, itemsDone: 0, points: 0, pointsDone: 0, pct: 0 };
    var items = sprintItems(state, sprint.id);
    var points = items.reduce(function (a, t) { return a + num(t.points, 0); }, 0);
    var pointsDone = items.filter(function (t) { return t.status === 'done'; }).reduce(function (a, t) { return a + num(t.points, 0); }, 0);
    return {
      items: items.length,
      itemsDone: items.filter(function (t) { return t.status === 'done'; }).length,
      points: points, pointsDone: pointsDone,
      pct: points ? Math.round(pointsDone / points * 100) : (items.length ? Math.round(items.filter(function (t) { return t.status === 'done'; }).length / items.length * 100) : 0)
    };
  }

  function burndown(state, sprint) {
    if (!sprint) return [];
    var items = sprintItems(state, sprint.id);
    var total = items.reduce(function (a, t) { return a + num(t.points, 0); }, 0);
    var start = sprint.startDate, end = sprint.endDate;
    var span = Math.max(1, daysBetween(start, end));
    var last = today() < end ? today() : end;
    var rows = [];
    for (var i = 0; i <= span; i++) {
      var date = addDays(start, i);
      if (date > last) break;
      var donePoints = items.filter(function (t) { return t.status === 'done' && t.doneAt && t.doneAt <= date; }).reduce(function (a, t) { return a + num(t.points, 0); }, 0);
      rows.push({
        label: fmtVN(date).slice(0, 5),
        ideal: Math.round(total * (1 - i / span) * 10) / 10,
        actual: total - donePoints
      });
    }
    return rows;
  }

  function velocity(state) {
    return state.team.sprints
      .filter(function (s) { return s.status === 'done'; })
      .map(function (s) { return { label: s.name || 'Sprint', value: sprintStats(state, s).pointsDone }; });
  }

  function memberLoad(state, sprintId) {
    var items = sprintId ? sprintItems(state, sprintId) : state.team.backlog;
    var map = {};
    state.team.members.forEach(function (m) { map[m.id] = { member: m, points: 0, items: 0, donePoints: 0 }; });
    items.forEach(function (t) {
      if (!t.assigneeId || !map[t.assigneeId]) return;
      map[t.assigneeId].points += num(t.points, 0);
      map[t.assigneeId].items += 1;
      if (t.status === 'done') map[t.assigneeId].donePoints += num(t.points, 0);
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function tasksDueToday(state) {
    var sp = Store.activeSprint();
    if (!sp) return [];
    return sprintItems(state, sp.id).filter(function (t) { return t.status === 'todo' || t.status === 'doing'; });
  }

  global.Store = Store;
  global.Metrics = {
    minutesOf: minutesOf, hasJournal: hasJournal, sessionScore: sessionScore,
    sessionsInRange: sessionsInRange, streak: streak,
    minutesToday: minutesToday, minutesOn: minutesOn, categoryTotals: categoryTotals,
    autonomyIndex: autonomyIndex, seriesAutonomy: seriesAutonomy, dailyMinutes: dailyMinutes,
    modeDistribution: modeDistribution, totals: totals, levelStats: levelStats,
    ruleCompletion: ruleCompletion, recreationStats: recreationStats,
    readingStats: readingStats, readingTotals: readingTotals, readingDaily: readingDaily,
    sprintItems: sprintItems, sprintStats: sprintStats, burndown: burndown, velocity: velocity,
    memberLoad: memberLoad, tasksDueToday: tasksDueToday
  };
  global.Utils = {
    uid: uid, isoDate: isoDate, today: today, addDays: addDays, dayName: dayName,
    fmtVN: fmtVN, num: num, daysBetween: daysBetween
  };
})(window);
