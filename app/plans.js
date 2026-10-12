'use strict';

/* =====================================================================
   app/plans.js — Kế hoạch của huynh: việc, thời khoá biểu, sprint.

   Tới giờ DevTrace chỉ trả lời được "máy đọc được gì về ngày hôm qua".
   Nó thu bằng chứng rồi đối chiếu, và làm việc đó tốt — nhưng nó không
   biết huynh ĐỊNH làm gì, nên chỉ kể lại quá khứ. Tệp này là chỗ huynh
   nói trước, để phần đối chiếu có cái mà so.

   BA ĐIỀU QUAN TRỌNG NHẤT, nói trước vì cả tệp được viết quanh chúng:

   1. Kế hoạch KHÔNG PHẢI bằng chứng. Kho `data/events/*.jsonl` là thứ máy
      đọc được, và cả dự án dựng lên quanh việc không bao giờ xoá hay sửa
      nó. Chữ huynh tự viết nằm ở thư mục riêng (`data/plans/`), và hai chỗ
      duy nhất xoá dữ liệu trong dự án — `Collect.clearCollected` và
      `Collect.prune` — không đụng tới thư mục này. Nhật ký
      (`data/journals/`) đã là tiền lệ đúng; kế hoạch đi theo lối đó.

   2. Không biết thì nói là không biết. Một buổi không có dấu vết nào KHÔNG
      phải là buổi chưa làm — nó là buổi mà máy không đọc được gì. Hai
      chuyện đó khác hẳn nhau, và trộn chúng lại là biến DevTrace thành
      công cụ mắng mỏ nói sai về chính huynh.

   3. Tệp hỏng thì giữ bản sao và TỪ CHỐI GHI, chứ không ghi đè. `U.readJson`
      trả về mặc định khi parse lỗi; nếu cứ thế ghi lại thì cả kho việc của
      huynh bị thay bằng rỗng trong im lặng — mất trắng mà không có gì báo.
      Xem `keepCopy` và `guardWritable`.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const U = require('./util');
const R = require('./correlate');

/* --- Từ vựng -------------------------------------------------------- */

const HORIZONS = ['day', 'week', 'goal', 'recurring'];
const HORIZON_LABEL = { day: 'Hôm nay', week: 'Tuần này', goal: 'Mục tiêu', recurring: 'Cố định' };
const FREQS = ['daily', 'weekdays', 'weekly'];
const FREQ_LABEL = { daily: 'hằng ngày', weekdays: 'các ngày trong tuần', weekly: 'theo thứ' };
const KINDS = ['deep', 'study', 'admin', 'break'];
const KIND_LABEL = { deep: 'việc sâu', study: 'học', admin: 'hành chính', break: 'nghỉ' };
const TASK_STATUS = ['open', 'done', 'dropped'];

// Mức "đã làm đủ" của một buổi. 0.8 chứ không phải 1.0 vì đối chiếu này là
// ƯỚC LƯỢNG: ngưỡng 25 phút chia khối và 8 phút cộng thời gian khiến một
// buổi có nghỉ giải lao bị tách khúc, nên đòi khớp từng phút là đòi một độ
// chính xác mà dữ liệu không có.
const DONE_RATIO = 0.8;

/* --- Đường dẫn ------------------------------------------------------ */

function plansDir(config) { return path.join(config.dataDir, 'plans'); }
function tasksFile(config) { return path.join(plansDir(config), 'tasks.json'); }
function timetableFile(config) { return path.join(plansDir(config), 'timetable.json'); }
function sprintsFile(config) { return path.join(plansDir(config), 'sprints.json'); }

function emptyTasks() { return { version: 1, updatedAt: 0, seq: 0, tasks: [], completions: {} }; }
function emptyTimetable() { return { version: 1, updatedAt: 0, seq: 0, sessions: [] }; }
function emptySprints() { return { version: 1, updatedAt: 0, seq: 0, sprints: [] }; }

/* --- Đọc tệp, và giữ bằng chứng khi tệp hỏng ------------------------ */

function stamp() { return String(Date.now()); }

/* Giữ một bản sao của tệp hỏng.

   Vì sao cần: nếu `tasks.json` hỏng mà DevTrace cứ thế ghi lại thì kho việc
   của huynh biến thành rỗng — tệp hỏng thường vẫn còn đọc được bằng mắt,
   nhưng ghi đè là mất luôn khả năng đó. Bản sao giữ lại đúng thứ đang có
   trên đĩa lúc phát hiện, không phải thứ DevTrace đoán ra.

   Chỉ giữ một bản cho mỗi NỘI DUNG hỏng, không phải mỗi lần phát hiện:
   cùng một tệp hỏng bị đọc lại mười lần thì vẫn chỉ có một bản sao. Nhưng
   hỏng theo kiểu khác thì phải là bản sao khác — nếu không, lời nhắn "đã
   giữ bản sao ở đây" sẽ chỉ vào một tệp chẳng liên quan gì. */
function ensureBackup(file) {
  const dir = path.dirname(file);
  const prefix = path.basename(file) + '.hong-';
  let broken = null;
  try { broken = fs.readFileSync(file); } catch (error) { broken = null; }

  let existing = [];
  try { existing = fs.readdirSync(dir).filter((name) => name.startsWith(prefix)).sort(); }
  catch (error) { existing = []; }

  for (const name of existing) {
    const full = path.join(dir, name);
    try {
      if (broken && fs.readFileSync(full).equals(broken)) return full;
    } catch (error) { /* bản sao cũ không đọc được: bỏ qua, tìm tiếp */ }
  }

  const dest = file + '.hong-' + stamp();
  try { fs.copyFileSync(file, dest); return dest; }
  catch (error) { return existing.length ? path.join(dir, existing[existing.length - 1]) : null; }
}

function keepCopy(file, reason) {
  return { file, reason, backup: ensureBackup(file) };
}

function corruptMessage(info) {
  if (!info) return null;
  return 'Tệp ' + path.basename(info.file) + ' bị hỏng (' + info.reason + '). '
    + (info.backup ? 'Đã giữ bản sao ở ' + path.basename(info.backup) + '. ' : '')
    + 'DevTrace không ghi đè cho tới khi huynh xử lý tệp đó — mở ra xem, sửa lại, hoặc đổi tên nó đi.';
}

/* Đọc một tệp JSON của kho kế hoạch.

   Tệp CHƯA CÓ và tệp RỖNG đều là kho mới, không phải hỏng — người mới dùng
   chưa có tệp nào, và tệp rỗng là thứ vài trình soạn thảo để lại. Chỉ khi
   tệp có nội dung mà không đọc nổi mới tính là hỏng. */
function readStore(file, blank, name, corrupt) {
  const text = U.readText(file);
  if (text == null) return blank;
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  if (!clean.trim()) return blank;
  let parsed;
  try { parsed = JSON.parse(clean); } catch (error) {
    corrupt[name] = keepCopy(file, 'không đọc nổi JSON: ' + error.message);
    return blank;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    corrupt[name] = keepCopy(file, 'nội dung không phải một đối tượng JSON');
    return blank;
  }
  return parsed;
}

/* Trước mỗi lần ghi: tệp đang nằm trên đĩa có đọc nổi không?

   Kiểm lại từ đĩa chứ không nhớ trạng thái trong bộ nhớ, vì máy chủ có thể
   đã khởi động lại giữa hai lần, và vì tệp có thể hỏng trong lúc chương
   trình đang chạy. Cùng lý do đó, hàm này tự giữ bản sao nếu chưa có — để
   lời hứa "giữ bản sao" không phụ thuộc vào việc ai đó đã gọi hàm đọc. */
function guardWritable(file) {
  const text = U.readText(file);
  if (text == null) return null;
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  if (!clean.trim()) return null;
  try {
    const parsed = JSON.parse(clean);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return null;
    return keepCopy(file, 'nội dung không phải một đối tượng JSON');
  } catch (error) {
    return keepCopy(file, 'không đọc nổi JSON: ' + error.message);
  }
}

function loadStore(config, opts) {
  const corrupt = {};
  const store = {
    tasks: readStore(tasksFile(config), emptyTasks(), 'tasks', corrupt),
    timetable: readStore(timetableFile(config), emptyTimetable(), 'timetable', corrupt),
    sprints: readStore(sprintsFile(config), emptySprints(), 'sprints', corrupt),
    corrupt
  };
  // Mảng và bù nhìn: chỉ để chỗ đọc khỏi phải tự kiểm tra kiểu ở mọi nơi.
  // KHÔNG sửa và KHÔNG bỏ mục nào — một mục hỏng trong tệp vẫn còn nguyên
  // trên đĩa cho tới khi huynh tự sửa, vì ghi lại là việc của huynh.
  store.tasks.tasks = Array.isArray(store.tasks.tasks) ? store.tasks.tasks : [];
  store.tasks.completions = isPlainObject(store.tasks.completions) ? store.tasks.completions : {};
  store.timetable.sessions = Array.isArray(store.timetable.sessions) ? store.timetable.sessions : [];
  store.sprints.sprints = Array.isArray(store.sprints.sprints) ? store.sprints.sprints : [];
  store.error = firstCorruptMessage(corrupt);
  return store;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function firstCorruptMessage(corrupt) {
  const keys = Object.keys(corrupt || {});
  return keys.length ? corruptMessage(corrupt[keys[0]]) : null;
}

/* --- Ghi ------------------------------------------------------------ */

function nowOf(opts) { return (opts && opts.now) || Date.now(); }

function todayKey(config, opts) { return U.dayKey(nowOf(opts), config.dayStartHour); }

function savePart(config, name, value, opts) {
  const file = name === 'tasks' ? tasksFile(config)
    : name === 'timetable' ? timetableFile(config) : sprintsFile(config);
  const bad = guardWritable(file);
  if (bad) return { ok: false, corrupt: bad, error: corruptMessage(bad) };
  U.writeJson(file, Object.assign({}, value, { version: 1, updatedAt: nowOf(opts) }));
  return { ok: true, file };
}

function saveTasks(config, value, opts) { return savePart(config, 'tasks', value, opts); }
function saveTimetable(config, value, opts) { return savePart(config, 'timetable', value, opts); }
function saveSprints(config, value, opts) { return savePart(config, 'sprints', value, opts); }

/* Khung chung cho mọi thay đổi: nạp, đổi, ghi.

   Chỉ chặn khi tệp SẮP GHI bị hỏng. Một tệp thời khoá biểu hỏng không có
   lý gì cấm huynh thêm một nhiệm vụ — nhưng nó vẫn phải được nhắc, nên
   những tệp hỏng khác đi kèm trong `warnings`. */
function mutate(config, part, opts, change) {
  const store = (opts && opts.store) || loadStore(config, opts);
  const bad = store.corrupt && store.corrupt[part];
  if (bad) return { ok: false, corrupt: bad, error: corruptMessage(bad) };

  const result = change(store) || {};
  if (result.error) return Object.assign({ ok: false }, result);

  const saved = savePart(config, part, store[part], opts);
  if (!saved.ok) return saved;

  const others = Object.keys(store.corrupt || {}).filter((k) => k !== part)
    .map((k) => corruptMessage(store.corrupt[k]));
  return Object.assign({ ok: true, store, warnings: others }, result);
}

function nextId(part, prefix) {
  part.seq = (Number(part.seq) || 0) + 1;
  return prefix + '-' + String(part.seq).padStart(4, '0');
}

/* --- Đọc giá trị, chịu được dữ liệu méo ------------------------------ */

/* Không có hàm "chuẩn hoá" nào ghi đè lại tệp. Một mục thiếu trường vẫn
   nằm nguyên trên đĩa; ở đây chỉ đọc nó một cách thận trọng, và nếu không
   đọc nổi thì ĐẾM LẠI vào `skipped` để giao diện nói ra — bỏ qua trong im
   lặng cũng là một cách nói dối. */

function numOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return isFinite(n) ? n : null;
}

function textOf(value, fallback) {
  const text = String(value == null ? '' : value).trim();
  return text || (fallback === undefined ? '' : fallback);
}

function horizonOf(task) {
  return task && HORIZONS.indexOf(task.horizon) !== -1 ? task.horizon : 'day';
}

function statusOf(task) {
  return task && TASK_STATUS.indexOf(task.status) !== -1 ? task.status : 'open';
}

function recurOf(task) {
  const raw = task && task.recur;
  if (!isPlainObject(raw)) return null;
  const freq = FREQS.indexOf(raw.freq) !== -1 ? raw.freq : null;
  if (!freq) return null;
  const byWeekday = Array.isArray(raw.byWeekday)
    ? U.uniq(raw.byWeekday.map(Number).filter((n) => n >= 1 && n <= 7)).sort((a, b) => a - b)
    : [];
  if (freq === 'weekly' && !byWeekday.length) return null;
  return { freq, byWeekday };
}

function hhmm(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value == null ? '' : value).trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return U.pad2(hours) + ':' + U.pad2(minutes);
}

function clockMinutes(value) {
  const clean = hhmm(value);
  if (!clean) return null;
  return Number(clean.slice(0, 2)) * 60 + Number(clean.slice(3));
}

function normalizeSession(raw) {
  if (!isPlainObject(raw)) return null;
  const id = textOf(raw.id);
  const weekday = Number(raw.weekday);
  const start = hhmm(raw.start);
  const end = hhmm(raw.end);
  if (!id || !(weekday >= 1 && weekday <= 7) || !start || !end) return null;
  if (clockMinutes(end) <= clockMinutes(start)) return null;
  return {
    id, weekday, start, end,
    title: textOf(raw.title, 'Buổi chưa đặt tên'),
    projectId: raw.projectId || null,
    projectPath: raw.projectPath || null,
    taskId: raw.taskId || null,
    kind: KINDS.indexOf(raw.kind) !== -1 ? raw.kind : 'deep',
    enabled: raw.enabled !== false
  };
}

/* --- Thời gian ------------------------------------------------------ */

// Thứ trong tuần: 1 = thứ Hai … 7 = Chủ nhật. `Date.getDay()` đếm Chủ nhật
// là 0, còn thời khoá biểu của người Việt đọc từ thứ Hai — đổi ngay ở đây
// để không phải nhớ điều đó ở mọi chỗ dùng.
function weekdayOf(day) {
  const value = new Date(String(day) + 'T12:00:00').getDay();
  return value === 0 ? 7 : value;
}

function weekStart(day) { return U.shiftDay(day, -(weekdayOf(day) - 1)); }

function minutesBetween(startMs, endMs) { return Math.round((endMs - startMs) / 60000); }

/* Đổi "HH:MM" của một buổi thành thời điểm tuyệt đối trong NGÀY DevTrace.

   Đây không phải phép cộng giờ tầm thường, và chỗ này đáng nói rõ: ngày
   DevTrace bắt đầu lúc 4 giờ sáng, nên "thứ Ba 01:00" mà huynh viết trong
   thời khoá biểu là một giờ sáng THỨ TƯ theo lịch — tức là cuối ngày làm
   việc thứ Ba, đúng như huynh vẫn nghĩ về nó. Cộng giờ theo lịch thì buổi
   đó rơi vào ngày DevTrace của thứ Hai, lệch hẳn một ngày. */
function atTime(config, day, value) {
  const minutes = clockMinutes(value);
  if (minutes == null) return null;
  const startHour = Number(config.dayStartHour) || 0;
  const base = Date.parse(String(day) + 'T00:00:00') + startHour * 3600000;
  let offset = minutes - startHour * 60;
  if (offset < 0) offset += 24 * 60;
  return base + offset * 60000;
}

/* --- Việc cố định: mở một mẫu thành từng buổi ----------------------- */

/* Việc cố định KHÔNG đẻ ra một dòng cho mỗi ngày. Nó là MỘT dòng trong
   `tasks.json`, và `occurrencesOn` mở nó ra thành buổi của đúng một ngày,
   trong bộ nhớ. Mở cả năm ra thì được 365 buổi mà tệp vẫn một dòng; buổi
   bỏ lỡ không được lưu ở đâu cả — nó được tính lại mỗi lần đọc. */
function recursOn(recur, day) {
  if (!recur) return false;
  const weekday = weekdayOf(day);
  if (recur.freq === 'daily') return true;
  if (recur.freq === 'weekdays') return weekday >= 1 && weekday <= 5;
  if (recur.freq === 'weekly') return (recur.byWeekday || []).indexOf(weekday) !== -1;
  return false;
}

function occurrencesOn(config, store, day, skipped) {
  const doneToday = isPlainObject(store.tasks.completions[day]) ? store.tasks.completions[day] : {};
  const out = [];
  for (const task of store.tasks.tasks) {
    if (!isPlainObject(task) || task.id === undefined) {
      if (skipped) skipped.push({ kind: 'task', id: null, reason: 'mục không phải một đối tượng' });
      continue;
    }
    if (horizonOf(task) !== 'recurring') continue;
    if (statusOf(task) === 'dropped') continue;
    const recur = recurOf(task);
    if (!recur) {
      if (skipped) skipped.push({ kind: 'task', id: task.id, reason: 'việc cố định thiếu kiểu lặp hợp lệ' });
      continue;
    }
    if (!recursOn(recur, day)) continue;
    const mark = isPlainObject(doneToday[task.id]) ? doneToday[task.id] : null;
    out.push({
      taskId: task.id,
      title: textOf(task.title, '(chưa đặt tên)'),
      day,
      projectId: task.projectId || null,
      projectPath: task.projectPath || null,
      points: numOrNull(task.points),
      order: Number(task.order) || 0,
      done: !!mark,
      doneAt: mark ? numOrNull(mark.doneAt) : null,
      note: mark ? textOf(mark.note) : ''
    });
  }
  return out.sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title));
}

/* --- Thời khoá biểu của một ngày ------------------------------------ */

function sessionsOn(config, day, opts) {
  const store = (opts && opts.store) || loadStore(config, opts);
  const skipped = (opts && opts.skipped) || null;
  const weekday = weekdayOf(day);
  const out = [];
  for (const raw of store.timetable.sessions) {
    const session = normalizeSession(raw);
    if (!session) {
      if (skipped) skipped.push({ kind: 'session', id: (raw && raw.id) || null, reason: 'thiếu thứ hoặc giờ hợp lệ' });
      continue;
    }
    if (session.weekday !== weekday) continue;
    const startMs = atTime(config, day, session.start);
    const endMs = atTime(config, day, session.end);
    out.push(Object.assign({}, session, {
      day, startMs, endMs,
      minutes: minutesBetween(startMs, endMs),
      projectName: session.projectPath ? R.projectLabel(config, session.projectPath) : null
    }));
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/* --- Đối chiếu kế hoạch với thực tế --------------------------------- */

/* Khoá dự án của một buổi. Dùng ĐƯỜNG DẪN làm nguồn chính chứ không phải
   id: đường dẫn là thứ DevTrace lưu trong bằng chứng, và `R.projectKey`
   biến nó thành đúng khoá mà khối bằng chứng đang dùng. Nhờ vậy đổi tên
   dự án không làm buổi nào mất dấu — tên chỉ là nhãn, đọc lúc hiển thị. */
function sessionKey(config, session) {
  if (session.projectPath) return R.projectKey(config, session.projectPath);
  if (session.projectId) return 'p:' + session.projectId;
  return null;
}

function overlapMinutes(spans, startMs, endMs) {
  let ms = 0;
  for (const pair of spans || []) {
    const lo = Math.max(pair[0], startMs);
    const hi = Math.min(pair[1], endMs);
    if (hi > lo) ms += hi - lo;
  }
  return Math.round(ms / 60000);
}

/* Ghép từng buổi trong thời khoá biểu với bằng chứng thật của ngày đó.

   `spans` là kết quả của `R.activitySpans(evidence.work)` — thời gian LÀM
   THẬT, không phải vỏ chứa của khối. Lấy vỏ chứa thì buổi 9–11 với đúng
   hai sự kiện ở 9:20 và 11:50 sẽ được tính là đã làm đủ hai tiếng.

   Bốn kết cục, và kết cục thứ tư mới là chỗ quan trọng:

     done        khớp từ 80% thời lượng dự kiến trở lên
     partial     có khớp, nhưng ít hơn
     missed      trong khung đó có hoạt động, nhưng không phải việc này
     no-evidence CẢ NGÀY không đọc được dấu vết nào

   `no-evidence` không bao giờ được gộp vào `missed`. Ngày mà bộ thu thập
   không chạy — máy tắt, nguồn bị tắt trong Cài đặt — thì MỌI buổi đều là
   `no-evidence`, và giao diện phải nói "chưa có dấu vết", tuyệt đối không
   nói "chưa làm". */
function compareSessions(config, day, spans, opts) {
  const options = opts || {};
  const skipped = options.skipped || [];
  const sessions = sessionsOn(config, day, { store: options.store, skipped, now: options.now });
  const all = (spans && spans.all) || [];
  const byProject = (spans && spans.byProject) || {};
  const hasEvidence = all.length > 0;

  const rows = sessions.map((session) => {
    const planned = session.minutes;
    if (session.kind === 'break' || !session.enabled) {
      return Object.assign({}, session, {
        plannedMinutes: planned, matchedMinutes: 0, unaccountedMinutes: 0,
        status: session.kind === 'break' ? 'break' : 'off', hasEvidence
      });
    }
    const key = sessionKey(config, session);
    const matched = overlapMinutes(key ? (byProject[key] || []) : all, session.startMs, session.endMs);
    let status;
    if (planned > 0 && matched >= planned * DONE_RATIO) status = 'done';
    else if (matched > 0) status = 'partial';
    else if (hasEvidence) status = 'missed';
    else status = 'no-evidence';
    return Object.assign({}, session, {
      plannedMinutes: planned,
      matchedMinutes: matched,
      unaccountedMinutes: Math.max(0, planned - matched),
      status, hasEvidence
    });
  });

  const counted = rows.filter((row) => row.status !== 'break' && row.status !== 'off');
  const counts = { done: 0, partial: 0, missed: 0, noEvidence: 0, break: 0, off: 0 };
  for (const row of rows) {
    if (row.status === 'break') counts.break++;
    else if (row.status === 'off') counts.off++;
    else if (row.status === 'no-evidence') counts.noEvidence++;
    else counts[row.status]++;
  }

  return {
    day,
    weekday: weekdayOf(day),
    weekdayLabel: WEEKDAY_LABEL[weekdayOf(day)] || null,
    sessions: rows,
    counts,
    hasEvidence,
    plannedMinutes: U.sum(counted, (row) => row.plannedMinutes),
    matchedMinutes: U.sum(counted, (row) => row.matchedMinutes),
    unaccountedMinutes: U.sum(counted, (row) => row.unaccountedMinutes),
    skipped,
    // Câu này đi thẳng vào giao diện và vào gói bằng chứng gửi cho AI.
    note: sessionsNote(rows, counted, hasEvidence)
  };
}

const WEEKDAY_LABEL = { 1: 'thứ Hai', 2: 'thứ Ba', 3: 'thứ Tư', 4: 'thứ Năm', 5: 'thứ Sáu', 6: 'thứ Bảy', 7: 'Chủ nhật' };

function sessionsNote(rows, counted, hasEvidence) {
  if (!rows.length) return 'Ngày này chưa có buổi nào trong thời khoá biểu.';
  if (!counted.length) return 'Ngày này chỉ có buổi nghỉ trong thời khoá biểu.';
  if (!hasEvidence) {
    return 'Ngày này không đọc được dấu vết nào, nên không buổi nào đối chiếu được. '
      + 'Vắng dữ liệu không có nghĩa là không làm gì.';
  }
  const done = counted.filter((row) => row.status === 'done').length;
  const missed = counted.filter((row) => row.status === 'missed').length;
  return 'Đối chiếu theo ước lượng: ' + done + '/' + counted.length + ' buổi khớp phần lớn thời lượng'
    + (missed ? ', ' + missed + ' buổi có hoạt động nhưng thuộc việc khác' : '') + '.';
}

/* Tiện ích cho tầng tổng hợp: từ bằng chứng của một ngày ra bức tranh
   kế-hoạch-đối-chiếu. Giữ ở đây để `digest.js` không phải biết
   `activitySpans` tính thế nào. */
function schedule(config, day, evidence, opts) {
  const spans = R.activitySpans(evidence.work, R.ACTIVE_GAP_MS);
  return compareSessions(config, day, spans, opts);
}

/* --- Bảng việc: bốn tầm nhìn ---------------------------------------- */

function decorateTask(config, task, extra) {
  return Object.assign({
    id: task.id,
    title: textOf(task.title, '(chưa đặt tên)'),
    horizon: horizonOf(task),
    horizonLabel: HORIZON_LABEL[horizonOf(task)] || null,
    status: statusOf(task),
    projectId: task.projectId || null,
    projectPath: task.projectPath || null,
    projectName: task.projectPath ? R.projectLabel(config, task.projectPath) : null,
    createdDay: task.createdDay || null,
    dueDay: task.dueDay || null,
    targetDay: task.targetDay || null,
    doneDay: task.doneDay || null,
    recur: recurOf(task),
    recurLabel: recurLabel(recurOf(task)),
    sprintId: task.sprintId || null,
    points: numOrNull(task.points),
    order: Number(task.order) || 0,
    carriedFrom: task.carriedFrom || null,
    carriedCount: Number(task.carriedCount) || 0,
    note: textOf(task.note),
    updatedAt: Number(task.updatedAt) || 0
  }, extra || {});
}

function recurLabel(recur) {
  if (!recur) return null;
  if (recur.freq === 'daily') return 'hằng ngày';
  if (recur.freq === 'weekdays') return 'thứ Hai – thứ Sáu';
  const names = (recur.byWeekday || []).map((w) => WEEKDAY_LABEL[w]).filter(Boolean);
  return names.length ? names.join(', ') : 'theo thứ';
}

function isOverdue(task, day) {
  if (statusOf(task) !== 'open') return false;
  const due = horizonOf(task) === 'goal' ? task.targetDay : task.dueDay;
  return !!(due && due < day);
}

function boardOf(config, store, day, skipped) {
  const week = weekStart(day);
  const dayTasks = [];
  const weekTasks = [];
  const goalTasks = [];

  for (const raw of store.tasks.tasks) {
    if (!isPlainObject(raw) || !raw.id) {
      skipped.push({ kind: 'task', id: null, reason: 'mục thiếu id' });
      continue;
    }
    const horizon = horizonOf(raw);
    const status = statusOf(raw);
    if (status === 'dropped') continue;
    const task = decorateTask(config, raw, { overdue: isOverdue(raw, day), dueThisWeek: (raw.dueDay || null) === week });

    if (horizon === 'day') {
      /* Việc trong ngày: hôm nay, những việc còn dở từ hôm trước, và những
         việc đã xong trong chính hôm nay. Việc quá hạn KHÔNG được giấu đi —
         nó là thứ cần nhìn thấy nhất, mà cũng là thứ dễ bị lọc mất nhất. */
      if (status === 'done') { if (raw.doneDay === day) dayTasks.push(task); }
      else if (!raw.dueDay || raw.dueDay <= day) dayTasks.push(task);
    } else if (horizon === 'week') {
      if (status === 'done') {
        if (raw.doneDay && raw.doneDay >= week && raw.doneDay <= U.shiftDay(week, 6)) weekTasks.push(task);
      } else weekTasks.push(task);
    } else if (horizon === 'goal') {
      if (status !== 'done') goalTasks.push(task);
    }
  }

  const byOrder = (a, b) => (a.order - b.order) || a.title.localeCompare(b.title);
  return {
    day: dayTasks.sort(byOrder),
    week: weekTasks.sort(byOrder),
    goal: goalTasks.sort(byOrder)
  };
}

function backlogOf(store) {
  const out = [];
  for (const task of store.tasks.tasks) {
    if (!isPlainObject(task) || !task.id) continue;
    const horizon = horizonOf(task);
    if (horizon !== 'week' && horizon !== 'goal') continue;
    if (statusOf(task) !== 'open') continue;
    if (task.sprintId) continue;
    out.push({
      id: task.id,
      title: textOf(task.title, '(chưa đặt tên)'),
      horizon,
      points: numOrNull(task.points),
      order: Number(task.order) || 0,
      carriedCount: Number(task.carriedCount) || 0
    });
  }
  return out.sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title));
}

/* --- Sprint --------------------------------------------------------- */

/* Scrum ở đây KHÔNG nghi thức. Giữ lại đúng bốn thứ có ích cho một người
   làm việc theo đợt: một hộp thời gian, một dòng mục tiêu, một backlog
   xếp tay, và con số trung thực xong-vs-mang-sang. Bỏ biểu đồ burn-down
   (vẽ ra chỉ tạo cảm giác chính xác giả), họp đứng, và thẻ điểm. */

function sprintPoints(store, sprint) {
  let points = 0;
  let done = 0;
  for (const task of store.tasks.tasks) {
    if (!isPlainObject(task) || task.sprintId !== sprint.id) continue;
    if (statusOf(task) !== 'done') continue;
    if (!task.doneDay || task.doneDay < sprint.startDay || task.doneDay > sprint.endDay) continue;
    done++;
    points += numOrNull(task.points) || 0;
  }
  return { points, done };
}

/* Vận tốc: bao nhiêu điểm thực sự xong trong mỗi hộp thời gian.

   Ẩn cho tới khi có ít nhất hai sprint đã đóng. Một sprint thì chưa nói
   được gì — con số duy nhất sẽ bị đọc thành một lời hứa, và đó đúng là
   kiểu số liệu khiến người ta lập kế hoạch sai. */
function velocityOf(store) {
  const closed = store.sprints.sprints.filter((s) => isPlainObject(s) && s.status === 'closed');
  const series = closed.map((sprint) => {
    const measured = sprintPoints(store, sprint);
    const summary = isPlainObject(sprint.summary) ? sprint.summary : {};
    return {
      id: sprint.id, name: textOf(sprint.name, sprint.id),
      startDay: sprint.startDay || null, endDay: sprint.endDay || null,
      points: measured.points, done: measured.done,
      carried: Number(summary.carried) || 0
    };
  });
  const available = series.length >= 2;
  return {
    available,
    sprints: series,
    averagePoints: available ? Math.round(U.sum(series, (s) => s.points) / series.length) : null,
    averageDone: available ? Math.round(U.sum(series, (s) => s.done) / series.length) : null,
    note: available ? null : 'Chưa đủ dữ liệu để nói về tốc độ — cần ít nhất hai sprint đã đóng.'
  };
}

/* --- Một chỗ để giao diện hỏi --------------------------------------- */

function view(config, day, opts) {
  const store = (opts && opts.store) || loadStore(config, opts);
  const skipped = [];
  return {
    ok: !store.error,
    day,
    weekday: weekdayOf(day),
    weekdayLabel: WEEKDAY_LABEL[weekdayOf(day)] || null,
    weekStart: weekStart(day),
    error: store.error,
    corrupt: store.corrupt || {},
    warnings: Object.keys(store.corrupt || {}).map((k) => corruptMessage(store.corrupt[k])),
    tasks: store.tasks.tasks.filter(isPlainObject),
    timetable: store.timetable.sessions.filter(isPlainObject).map(normalizeSession).filter(Boolean),
    sprints: store.sprints.sprints.filter(isPlainObject),
    board: boardOf(config, store, day, skipped),
    occurrences: occurrencesOn(config, store, day, skipped),
    activeSprint: store.sprints.sprints.find((s) => isPlainObject(s) && s.status === 'active') || null,
    backlog: backlogOf(store),
    velocity: velocityOf(store),
    skipped
  };
}

/* --- Thay đổi: việc -------------------------------------------------- */

function findTask(part, id) {
  for (const task of part.tasks) if (isPlainObject(task) && task.id === id) return task;
  return null;
}

function defaultDue(horizon, input, day) {
  const given = input.dueDay || null;
  if (horizon === 'day') return given || day;
  if (horizon === 'week') return given || weekStart(day);
  return null;
}

function taskSave(config, part, input, opts) {
  const now = nowOf(opts);
  const day = todayKey(config, opts);
  const title = textOf(input.title);
  if (!title) return { error: 'Nhiệm vụ phải có tiêu đề.' };

  const horizon = HORIZONS.indexOf(input.horizon) !== -1 ? input.horizon : 'day';
  const recur = horizon === 'recurring' ? recurOf({ recur: input.recur }) : null;
  if (horizon === 'recurring' && !recur) {
    return { error: 'Việc cố định cần một kiểu lặp hợp lệ: hằng ngày, các ngày trong tuần, hoặc theo thứ.' };
  }

  const existing = input.id ? findTask(part, input.id) : null;
  if (input.id && !existing) return { error: 'Không thấy nhiệm vụ ' + input.id };

  /* Việc trong ngày và việc cố định là việc chiến thuật — chúng lặp theo
     lịch, không theo đợt. Cho chúng vào sprint là trộn hai thứ đo khác
     nhau, rồi con số vận tốc không còn nghĩa gì. */
  const sprintId = input.sprintId === undefined
    ? (existing && existing.sprintId) || null
    : (input.sprintId || null);
  if (sprintId && (horizon === 'day' || horizon === 'recurring')) {
    return { error: 'Việc trong ngày và việc cố định không thuộc sprint — chúng lặp theo lịch, không theo đợt.' };
  }

  const fields = {
    title, horizon,
    projectId: input.projectId || null,
    projectPath: input.projectPath ? U.expandPath(input.projectPath) : null,
    dueDay: defaultDue(horizon, input, day),
    targetDay: horizon === 'goal' ? (input.targetDay || null) : null,
    recur,
    sprintId,
    points: numOrNull(input.points),
    note: textOf(input.note),
    updatedAt: now
  };

  if (existing) {
    Object.assign(existing, fields);
    return { task: existing };
  }

  const task = Object.assign({
    id: nextId(part, 't'),
    status: 'open',
    createdDay: day,
    doneDay: null,
    order: part.tasks.length,
    carriedFrom: null,
    carriedCount: 0
  }, fields);
  part.tasks.push(task);
  return { task };
}

function taskToggle(config, part, input, opts) {
  const task = findTask(part, input.id);
  if (!task) return { error: 'Không thấy nhiệm vụ ' + input.id };
  if (horizonOf(task) === 'recurring') {
    return { error: 'Việc cố định được tích theo từng buổi, không tích một lần cho cả việc.' };
  }
  const now = nowOf(opts);
  if (statusOf(task) === 'done') {
    task.status = 'open';
    task.doneDay = null;
  } else {
    task.status = 'done';
    task.doneDay = input.doneDay || todayKey(config, opts);
  }
  task.updatedAt = now;
  return { task };
}

function taskMove(config, part, input, opts) {
  const task = findTask(part, input.id);
  if (!task) return { error: 'Không thấy nhiệm vụ ' + input.id };
  const horizon = horizonOf(task);
  const sprintId = input.sprintId || null;
  if (sprintId && (horizon === 'day' || horizon === 'recurring')) {
    return { error: 'Việc trong ngày và việc cố định không thuộc sprint — chúng lặp theo lịch, không theo đợt.' };
  }
  task.sprintId = sprintId;
  task.updatedAt = nowOf(opts);
  return { task };
}

function taskDelete(part, input) {
  const at = part.tasks.findIndex((task) => isPlainObject(task) && task.id === input.id);
  if (at === -1) return { error: 'Không thấy nhiệm vụ ' + input.id };
  const removed = part.tasks[at];
  part.tasks.splice(at, 1);

  /* Dấu đã-xong của việc này ở mọi ngày cũng đi theo. Giữ lại thì bản đồ
     `completions` phình ra mãi với những id không còn ai đọc. */
  let cleared = 0;
  for (const day of Object.keys(part.completions)) {
    const bucket = part.completions[day];
    if (!isPlainObject(bucket) || !bucket[input.id]) continue;
    delete bucket[input.id];
    cleared++;
    if (!Object.keys(bucket).length) delete part.completions[day];
  }
  return { removed, clearedDays: cleared };
}

function occurToggle(config, part, input, opts) {
  const task = findTask(part, input.id);
  if (!task) return { error: 'Không thấy nhiệm vụ ' + input.id };
  if (horizonOf(task) !== 'recurring') return { error: 'Chỉ việc cố định mới tích theo từng buổi.' };
  const recur = recurOf(task);
  if (!recur) return { error: 'Việc cố định này thiếu kiểu lặp hợp lệ nên không mở ra buổi được.' };

  const day = input.day || todayKey(config, opts);
  if (!recursOn(recur, day)) return { error: 'Việc này không lặp vào ' + day + '.' };

  const bucket = isPlainObject(part.completions[day]) ? part.completions[day] : (part.completions[day] = {});
  const want = typeof input.done === 'boolean' ? input.done : !bucket[task.id];
  if (want) bucket[task.id] = { doneAt: nowOf(opts), note: textOf(input.note) };
  else delete bucket[task.id];
  if (!Object.keys(bucket).length) delete part.completions[day];

  return { occurrence: { taskId: task.id, day, done: want } };
}

function applyTask(config, action, payload, opts) {
  const input = payload || {};
  return mutate(config, 'tasks', opts, (store) => {
    const part = store.tasks;
    if (action === 'save') return taskSave(config, part, input, opts);
    if (action === 'delete') return taskDelete(part, input);
    if (action === 'toggle') return taskToggle(config, part, input, opts);
    if (action === 'occur-toggle') return occurToggle(config, part, input, opts);
    if (action === 'move') return taskMove(config, part, input, opts);
    return { error: 'Thao tác việc không rõ: ' + action };
  });
}

/* --- Thay đổi: thời khoá biểu --------------------------------------- */

function slotSave(config, part, input, opts) {
  const weekday = Number(input.weekday);
  if (!(weekday >= 1 && weekday <= 7)) {
    return { error: 'Buổi phải thuộc một thứ trong tuần (1 = thứ Hai … 7 = Chủ nhật).' };
  }
  const start = hhmm(input.start);
  const end = hhmm(input.end);
  if (!start || !end) return { error: 'Giờ phải theo dạng HH:MM, ví dụ 09:00.' };
  if (clockMinutes(end) <= clockMinutes(start)) return { error: 'Giờ kết thúc phải sau giờ bắt đầu.' };
  const title = textOf(input.title);
  if (!title) return { error: 'Buổi phải có tên — ghi rõ buổi này để làm gì.' };

  const existing = input.id
    ? part.sessions.find((s) => isPlainObject(s) && s.id === input.id) : null;
  if (input.id && !existing) return { error: 'Không thấy buổi ' + input.id };

  /* Hai buổi chồng nhau trong cùng một thứ là lỗi gõ, không phải kế hoạch:
     đối chiếu với bằng chứng sẽ đếm cùng một quãng hai lần, và bức tranh
     "hôm nay định làm gì" thành ra không đọc được. */
  const clash = part.sessions.find((s) => isPlainObject(s) && s.id !== input.id
    && Number(s.weekday) === weekday
    && clockMinutes(s.start) != null && clockMinutes(s.end) != null
    && clockMinutes(s.start) < clockMinutes(end) && clockMinutes(start) < clockMinutes(s.end));
  if (clash) {
    return { error: 'Trùng với buổi "' + textOf(clash.title, clash.id) + '" (' + clash.start + '–' + clash.end + ') cùng thứ.' };
  }

  const fields = {
    weekday, start, end, title,
    projectId: input.projectId || null,
    projectPath: input.projectPath ? U.expandPath(input.projectPath) : null,
    taskId: input.taskId || null,
    kind: KINDS.indexOf(input.kind) !== -1 ? input.kind : 'deep',
    enabled: input.enabled !== false
  };

  if (existing) {
    Object.assign(existing, fields);
    return { session: existing };
  }
  const session = Object.assign({ id: nextId(part, 'w') }, fields);
  part.sessions.push(session);
  return { session };
}

function slotDelete(part, input) {
  const at = part.sessions.findIndex((s) => isPlainObject(s) && s.id === input.id);
  if (at === -1) return { error: 'Không thấy buổi ' + input.id };
  const removed = part.sessions[at];
  part.sessions.splice(at, 1);
  return { removed };
}

function applySlot(config, action, payload, opts) {
  const input = payload || {};
  return mutate(config, 'timetable', opts, (store) => {
    const part = store.timetable;
    if (action === 'save') return slotSave(config, part, input, opts);
    if (action === 'delete') return slotDelete(part, input);
    return { error: 'Thao tác buổi không rõ: ' + action };
  });
}

/* --- Thay đổi: sprint ----------------------------------------------- */

function sprintStart(config, store, input, opts) {
  const part = store.sprints;
  const active = part.sprints.find((s) => isPlainObject(s) && s.status === 'active');
  if (active) {
    return { error: 'Đang có một sprint chạy (' + textOf(active.name, active.id) + '). '
      + 'Đóng nó trước khi mở sprint mới — hai hộp thời gian chồng nhau thì không còn là hộp thời gian.' };
  }
  const startDay = input.startDay || todayKey(config, opts);
  const lengthDays = Math.max(1, Math.round(Number((config.sprint || {}).lengthDays) || 14));
  const endDay = input.endDay || U.shiftDay(startDay, lengthDays - 1);
  if (endDay < startDay) return { error: 'Ngày kết thúc sprint phải sau ngày bắt đầu.' };

  const name = textOf(input.name) || ('Sprint ' + ((Number(part.seq) || 0) + 1));
  const sprint = {
    id: nextId(part, 's'),
    name,
    goal: textOf(input.goal),
    startDay, endDay,
    status: 'active',
    capacityPoints: numOrNull(input.capacityPoints),
    createdAt: nowOf(opts),
    closedAt: null,
    summary: null
  };
  part.sprints.push(sprint);
  return { sprint };
}

/* Đóng sprint: việc còn dở trả về backlog và ĐẾM LẠI số lần bị mang sang.
   Con số đó mới là thứ đáng nhìn — "việc này mang sang lần thứ tư" nói
   được nhiều hơn mọi biểu đồ. */
function sprintClose(config, store, input, opts) {
  const part = store.sprints;
  const sprint = input.id
    ? part.sprints.find((s) => isPlainObject(s) && s.id === input.id)
    : part.sprints.find((s) => isPlainObject(s) && s.status === 'active');
  if (!sprint) return { error: 'Không thấy sprint nào đang chạy để đóng.' };
  if (sprint.status === 'closed') return { error: 'Sprint này đã đóng rồi.' };

  const now = nowOf(opts);
  const closed = sprintPoints(store, sprint);
  const carried = [];
  for (const task of store.tasks.tasks) {
    if (!isPlainObject(task) || task.sprintId !== sprint.id) continue;
    if (statusOf(task) === 'done') continue;
    task.sprintId = null;
    task.carriedFrom = sprint.id;
    task.carriedCount = (Number(task.carriedCount) || 0) + 1;
    task.updatedAt = now;
    carried.push(task.id);
  }

  sprint.status = 'closed';
  sprint.closedAt = now;
  sprint.summary = { done: closed.done, carried: carried.length, points: closed.points, carriedIds: carried };
  return { sprint, carried: carried.length, touchedTasks: carried.length > 0 };
}

function applySprint(config, action, payload, opts) {
  const input = payload || {};
  const store = (opts && opts.store) || loadStore(config, opts);

  // Luôn chặn nếu chính tệp sprint hỏng.
  const badSprints = store.corrupt && store.corrupt.sprints;
  if (badSprints) return { ok: false, corrupt: badSprints, error: corruptMessage(badSprints) };

  let result;
  if (action === 'start') result = sprintStart(config, store, input, opts);
  else if (action === 'close') result = sprintClose(config, store, input, opts);
  else return { ok: false, error: 'Thao tác sprint không rõ: ' + action };
  if (result.error) return Object.assign({ ok: false }, result);

  const savedSprints = saveSprints(config, store.sprints, opts);
  if (!savedSprints.ok) return savedSprints;

  /* Đóng sprint có sửa cả kho việc (trả việc dở về backlog). Nếu tệp việc
     hỏng thì dừng trước khi ghi sprint — thà cả hai còn nguyên lúc cũ, còn
     hơn sprint đã đóng mà việc vẫn còn treo trong đó. */
  if (result.touchedTasks) {
    const badTasks = store.corrupt && store.corrupt.tasks;
    if (badTasks) return { ok: false, corrupt: badTasks, error: corruptMessage(badTasks) };
    const savedTasks = saveTasks(config, store.tasks, opts);
    if (!savedTasks.ok) return savedTasks;
  }

  return Object.assign({ ok: true, store }, result);
}

module.exports = {
  plansDir, tasksFile, timetableFile, sprintsFile,
  emptyTasks, emptyTimetable, emptySprints,
  loadStore, saveTasks, saveTimetable, saveSprints,
  corruptMessage, guardWritable,
  weekdayOf, weekStart, recursOn, occurrencesOn, sessionsOn, atTime,
  compareSessions, schedule, overlapMinutes,
  view, boardOf, backlogOf, velocityOf, sprintPoints,
  applyTask, applySlot, applySprint,
  HORIZONS, HORIZON_LABEL, FREQS, FREQ_LABEL, KINDS, KIND_LABEL, WEEKDAY_LABEL, TASK_STATUS, DONE_RATIO
};
