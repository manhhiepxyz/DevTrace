'use strict';

/* =====================================================================
   app/mail.js — Hộp thư: đếm thư chưa trả lời, và không làm gì khác.

   Tệp này là PHẦN THUẦN. Nó không mở kết nối mạng, không `require('tls')`,
   không chạy tiến trình con — việc đó nằm trọn trong `app/mail-fetch.js`.
   Ở đây chỉ có: đọc/ghi ảnh chụp, định nghĩa "chưa trả lời", và đếm. Nhờ
   vậy toàn bộ phần này kiểm thử được ngoại tuyến, và đó là lý do nó tách
   làm hai tệp chứ không phải một.

   BỐN ĐIỀU QUAN TRỌNG NHẤT:

   1. CHỮ NGƯỜI KHÁC VIẾT KHÔNG BAO GIỜ ĐI ĐÂU CẢ.
      Tiêu đề thư, địa chỉ người gửi, nội dung — không vào gói bằng chứng
      gửi cho AI, không vào cảnh báo, không vào tệp xuất. Cảnh báo về hộp
      thư CHỈ có con số và số ngày: "5 thư chưa trả lời, cũ nhất 3 ngày".
      Đó là ranh giới chịu lực của cả tính năng này: `summary()` trả về con
      số, `view()` mới trả về tiêu đề — và `view()` chỉ đi tới màn hình của
      chính huynh, không đi xa hơn. Nếu sau này có ai muốn thêm tiêu đề vào
      cảnh báo hay vào gói AI, thì câu trả lời là không.

   2. HỘP THƯ KHÔNG PHẢI MỘT NGUỒN BẰNG CHỨNG.
      Nó không nằm trong `E.SOURCES`, không có trong `COLLECTORS`, không
      ghi vào `data/events/`, không vào `/api/export`. Ảnh chụp ở
      `data/mail/inbox.json` là CACHE — dựng lại được bằng một lần bấm, và
      mất nó không mất gì của huynh. Vì vậy nó cũng không cần chốt chống
      hỏng như kho kế hoạch: hỏng thì đọc thành "chưa có gì" và quét lại,
      KHÔNG giữ bản sao và KHÔNG chặn ghi. Nói rõ ở đây để lần sau không ai
      tưởng là thiếu sót.

   3. "CHƯA TRẢ LỜI" LÀ MỘT ƯỚC LƯỢNG, VÀ SAI CẢ HAI CHIỀU.
      Trả lời từ máy khác thì bị tính là chưa trả lời (sai âm). Thư quảng
      cáo thì nằm mãi trong danh sách (sai dương). Mọi chỗ hiện con số này
      đều phải nói nó là ước lượng, và phải nói ước lượng từ đâu ra.

   4. MẬT KHẨU CHỈ TỒN TẠI DƯỚI DẠNG TÊN BIẾN MÔI TRƯỜNG.
      Không có đường nào trong tệp này ghi mật khẩu xuống đĩa, và không có
      hàm nào nhận mật khẩu làm tham số. Giá trị chỉ được đọc ở đúng một
      chỗ — bên trong tiến trình con, từ `process.env`.
   ===================================================================== */

const path = require('path');
const { execFileSync } = require('child_process');
const U = require('./util');

const FETCH_SCRIPT = path.join(__dirname, 'mail-fetch.js');

const DEFAULT_PORT = 993;
const DEFAULT_PASSWORD_ENV = 'DEVTRACE_MAIL_PASSWORD';
const DEFAULT_FOLDER = 'INBOX';
const DEFAULT_SENT_FOLDER = 'Sent';
const DEFAULT_UNANSWERED_HOURS = 24;
const DEFAULT_MAX_MESSAGES = 200;

/* Bao nhiêu thư hiện thẳng trên thẻ. Danh sách dài hơn ngưỡng này thì con số
   vẫn đúng, chỉ là không kể hết ra — thẻ này là để biết hôm nay phải trả lời
   ai, không phải để đọc hộp thư. */
const LIST_LIMIT = 30;

/* --- Cấu hình -------------------------------------------------------- */

/* Đọc một giá trị số từ dữ liệu đọc trên đĩa, và trả `null` khi nó không
   phải số.

   Viết riêng hàm này thay vì dùng thẳng `isFinite` là để bịt một cái bẫy có
   thật: `isFinite(null)` trả về **true** (`Number(null)` là 0), nên một thư
   không có ngày sẽ được đọc thành "ngày 1 tháng 1 năm 1970" — tức là thư cũ
   nhất trong hộp, và nó sẽ đứng đầu danh sách cần trả lời. Đó đúng là kiểu
   sai khiến huynh đi trả lời một thư chẳng có gì. */
function num(value) {
  return typeof value === 'number' && isFinite(value) ? value : null;
}

function whole(value, fallback, min, max) {
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return fallback;
  const r = Math.round(n);
  if (min != null && r < min) return min;
  if (max != null && r > max) return max;
  return r;
}

function settingsOf(config) {
  const mail = (config && config.mail) || {};
  const sent = mail.sentFolder == null ? DEFAULT_SENT_FOLDER : String(mail.sentFolder).trim();
  return {
    enabled: mail.enabled === true,
    host: String(mail.host == null ? '' : mail.host).trim(),
    port: whole(mail.port, DEFAULT_PORT, 1, 65535),
    user: String(mail.user == null ? '' : mail.user).trim(),
    passwordEnv: String(mail.passwordEnv == null ? '' : mail.passwordEnv).trim() || DEFAULT_PASSWORD_ENV,
    folder: String(mail.folder == null ? '' : mail.folder).trim() || DEFAULT_FOLDER,
    /* Thư mục Đã gửi để trống là lựa chọn có thật: người dùng không muốn
       DevTrace đọc thư mình gửi. Khi đó tín hiệu chính tắt, còn lại tín hiệu
       phụ, và giao diện phải nói ra là đang thiếu. */
    sentFolder: sent,
    unansweredHours: whole(mail.unansweredHours, DEFAULT_UNANSWERED_HOURS, 1, 24 * 30),
    maxMessages: whole(mail.maxMessages, DEFAULT_MAX_MESSAGES, 1, 1000)
  };
}

/* `enabled` mà thiếu máy chủ hoặc tài khoản thì chưa gọi được là bật. Nói ra
   thành một hàm riêng để giao diện và cảnh báo dùng chung một định nghĩa,
   thay vì mỗi nơi tự đoán. */
function isReady(settings) {
  return !!(settings.enabled && settings.host && settings.user);
}

/* --- Đường dẫn ------------------------------------------------------- */

function mailDir(config) { return path.join(config.dataDir, 'mail'); }
function inboxFile(config) { return path.join(mailDir(config), 'inbox.json'); }

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normId(raw) {
  const text = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!text) return null;
  const angle = /<([^<>]+)>/.exec(text);
  return (angle ? angle[1] : text).trim() || null;
}

/* --- Đọc ảnh chụp ---------------------------------------------------- */

function read(config) {
  const text = U.readText(inboxFile(config));
  if (text == null) return { shot: null, damaged: false };
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  if (!clean.trim()) return { shot: null, damaged: false };
  let parsed;
  try { parsed = JSON.parse(clean); } catch (error) { return { shot: null, damaged: true }; }
  if (!isPlainObject(parsed)) return { shot: null, damaged: true };
  /* Bù nhìn chứ không sửa: chỗ đọc không được phép tự ý thêm bớt dữ liệu của
     một tệp nó vừa đọc từ đĩa. */
  if (!Array.isArray(parsed.messages)) parsed.messages = [];
  if (!isPlainObject(parsed.sentIndex)) parsed.sentIndex = {};
  return { shot: parsed, damaged: false };
}

/* --- Định nghĩa "chưa trả lời" --------------------------------------- */

/* Bảng tra: Message-ID của một thư ĐẾN → thời điểm mình đã trả lời nó.

   Dựng từ hộp thư Đã gửi: mỗi thư đi có `In-Reply-To` (thư nó trả lời) và
   `References` (cả mạch). Cả hai đều được xét, vì bỏ sót `References` nghĩa
   là coi một thư đã trả lời là chưa trả lời — và đó là kiểu sai khiến huynh
   trả lời một thư hai lần.

   Giữ thời điểm SỚM NHẤT khi biết: trả lời muộn vẫn là đã trả lời, nên chỉ
   cần một lần khớp là đủ. */
function buildSentIndex(sent) {
  const index = {};
  for (const msg of Array.isArray(sent) ? sent : []) {
    if (!isPlainObject(msg)) continue;
    const at = num(msg.dateMs);
    const ids = [];
    for (const raw of (Array.isArray(msg.inReplyTo) ? msg.inReplyTo : []).concat(Array.isArray(msg.references) ? msg.references : [])) {
      const id = normId(raw);
      if (id) ids.push(id);
    }
    for (const id of ids) {
      if (!(id in index)) { index[id] = at; continue; }
      if (at != null && (index[id] == null || at < index[id])) index[id] = at;
    }
  }
  return index;
}

const HOUR_MS = 3600000;

/* Soi một ảnh chụp và trả về từng thư kèm phán quyết của nó.

   Hàm THUẦN: cùng ảnh chụp, cùng `now`, cùng cấu hình thì luôn ra cùng kết
   quả. Không đọc thêm tệp nào, không hỏi đồng hồ hệ thống. */
function analyze(shot, settings, now) {
  const index = isPlainObject(shot && shot.sentIndex) ? shot.sentIndex : {};
  const threshold = settings.unansweredHours * HOUR_MS;
  const items = [];
  let undated = 0;

  for (const raw of (shot && Array.isArray(shot.messages)) ? shot.messages : []) {
    if (!isPlainObject(raw)) continue;
    const id = normId(raw.messageId);
    const repliedAt = id && (id in index) ? index[id] : null;
    const replied = !!(id && (id in index));
    /* Thư không có ngày thì KHÔNG xét. Không biết nó cũ bao lâu thì mọi phán
       quyết về nó đều là đoán, và đoán ở đây nghĩa là thêm một dòng vào danh
       sách việc của huynh mà chẳng có căn cứ nào. Đếm riêng để còn nói ra. */
    const dateMs = num(raw.dateMs);
    const dated = dateMs != null;
    if (!dated) undated++;
    const ageMs = dated ? now - dateMs : null;
    /* Thư đến từ tương lai (đồng hồ máy gửi sai) thì `ageMs` âm — coi như
       chưa đủ cũ, không phải cũ nhất. */
    const oldEnough = ageMs != null && ageMs >= threshold;
    const answered = raw.answered === true || replied;
    items.push({
      uid: raw.uid,
      messageId: raw.messageId || null,
      subject: String(raw.subject == null ? '' : raw.subject) || '(không có tiêu đề)',
      from: String(raw.from == null ? '' : raw.from) || '(không rõ người gửi)',
      fromAddress: String(raw.fromAddress == null ? '' : raw.fromAddress),
      dateMs,
      days: ageMs == null ? null : Math.max(0, Math.floor(ageMs / 86400000)),
      hours: ageMs == null ? null : Math.max(0, Math.floor(ageMs / HOUR_MS)),
      seen: raw.seen === true,
      answered,
      replied,
      repliedAt,
      unanswered: !answered && oldEnough,
      unseenOld: raw.seen !== true && oldEnough
    });
  }

  /* Cũ nhất lên đầu: đó là thư nên trả lời trước. Thư không có ngày xếp
     cuối, sau cả những thư đã trả lời — chúng chưa đủ căn cứ để đứng trước. */
  const waiting = items.filter((i) => i.unanswered)
    .sort((a, b) => (a.dateMs == null ? Infinity : a.dateMs) - (b.dateMs == null ? Infinity : b.dateMs));

  return {
    items,
    waiting,
    total: items.length,
    answered: items.filter((i) => i.answered).length,
    unseen: items.filter((i) => i.unseenOld).length,
    undated,
    /* 0 khi không có thư nào đang chờ — và 0 ở đây nghĩa đúng là "không có
       gì để nói", không phải "không biết". Chỗ gọi phải phân biệt được hai
       chuyện đó bằng `synced`, nên `oldestDays` không tự nó nói lên điều gì. */
    oldestDays: waiting.length ? Math.max(...waiting.map((i) => i.days || 0)) : 0,
    oldestHours: waiting.length ? Math.max(...waiting.map((i) => (i.hours == null ? 0 : i.hours))) : 0
  };
}

/* --- Gọi mạng (qua tiến trình con) ----------------------------------- */

function fetchOpts(settings) {
  return {
    host: settings.host,
    port: settings.port,
    user: settings.user,
    /* TÊN biến, không phải giá trị. Tiến trình con tự đọc `process.env` —
       dòng lệnh thì tiến trình khác đọc được, biến môi trường thì không. */
    passwordEnv: settings.passwordEnv,
    folder: settings.folder,
    sentFolder: settings.sentFolder,
    maxMessages: settings.maxMessages
  };
}

function fetchViaChild(settings) {
  /* Kiểm mật khẩu ở ĐÂY trước khi sinh tiến trình: thiếu mật khẩu là chuyện
     chắc chắn biết được mà không cần mở mạng, và bắt người dùng chờ một vòng
     khởi động Node chỉ để nhận đúng câu đó là vô nghĩa. Tiến trình con vẫn
     kiểm lại — nó có thể được gọi bằng đường khác. */
  if (!process.env[settings.passwordEnv]) {
    return {
      ok: false,
      error: 'Chưa có mật khẩu trong biến môi trường “' + settings.passwordEnv + '”. '
        + 'Đặt biến đó rồi mở lại DevTrace. DevTrace không bao giờ lưu mật khẩu vào tệp cấu hình, '
        + 'và không đọc được biến môi trường của một tiến trình đã chạy trước đó.'
    };
  }
  try {
    const out = execFileSync(process.execPath, [FETCH_SCRIPT, JSON.stringify(fetchOpts(settings))], {
      encoding: 'utf8',
      timeout: 100000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      env: process.env
    });
    return JSON.parse(out);
  } catch (error) {
    /* Không đọc nổi kết quả của tiến trình con thì nói ra ĐÚNG thứ đọc được,
       không đoán. `stdout` có thể chứa nửa đối tượng JSON; cắt ngắn để nó
       không tràn vào chỗ khác. */
    const said = error && error.stdout ? String(error.stdout).slice(0, 200) : '';
    return {
      ok: false,
      error: 'Không chạy được phần đọc hộp thư: ' + String((error && error.message) || error)
        + (said ? ' — nó nói: ' + said : '')
    };
  }
}

/* --- Dựng ảnh chụp --------------------------------------------------- */

function normalizeMessages(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (!isPlainObject(raw)) continue;
    out.push({
      uid: num(raw.uid),
      messageId: raw.messageId == null ? null : String(raw.messageId),
      inReplyTo: Array.isArray(raw.inReplyTo) ? raw.inReplyTo.map(String) : [],
      references: Array.isArray(raw.references) ? raw.references.map(String) : [],
      subject: String(raw.subject == null ? '' : raw.subject).slice(0, 400),
      from: String(raw.from == null ? '' : raw.from).slice(0, 200),
      fromAddress: String(raw.fromAddress == null ? '' : raw.fromAddress).slice(0, 200),
      dateMs: num(raw.dateMs),
      seen: raw.seen === true,
      answered: raw.answered === true
    });
  }
  return out;
}

function build(parsed, settings, now, day) {
  const messages = normalizeMessages(parsed && parsed.messages);
  const sent = normalizeMessages(parsed && parsed.sent);
  return {
    version: 1,
    updatedAt: now,
    day,
    ok: true,
    error: null,
    folder: String((parsed && parsed.folder) || settings.folder),
    sentFolder: (parsed && parsed.sentFolder) || null,
    days: num(parsed && parsed.days),
    /* CHỈ số đếm của hộp Đã gửi, không giữ từng thư đi: bảng tra đã đủ để
       phán quyết, còn giữ cả hộp thư đi thì ảnh chụp phình gấp đôi mà không
       đổi lấy được gì. */
    sentCount: sent.length,
    sentIndex: buildSentIndex(sent),
    notes: Array.isArray(parsed && parsed.notes) ? parsed.notes.map(String) : [],
    messages
  };
}

function bad(now, day, error, notes) {
  return {
    version: 1, updatedAt: now, day, ok: false, error: error || null,
    folder: null, sentFolder: null, days: null, sentCount: 0, sentIndex: {},
    notes: Array.isArray(notes) ? notes : [], messages: []
  };
}

/* Quét hộp thư và ghi ảnh chụp. ĐÂY LÀ HÀM DUY NHẤT chạm tới mạng, và nó chỉ
   chạm khi `config.mail.enabled === true` — mặc định là tắt, nên một bản
   DevTrace mới cài không mở kết nối nào ra ngoài.

   `opts.fetchMail` là khe cắm cho bộ kiểm thử: nó thay trọn phần mạng, nên
   mọi phép kiểm về hộp thư chạy được ngoại tuyến và không bao giờ sinh tiến
   trình con. */
function snapshot(config, opts) {
  const options = opts || {};
  const settings = settingsOf(config);
  const now = options.now == null ? Date.now() : options.now;
  const day = U.dayKey(now, config.dayStartHour);

  if (!settings.enabled) {
    return { ...bad(now, day, null), enabled: false, off: true };
  }
  if (!settings.host) return { ...bad(now, day, 'Chưa điền máy chủ IMAP trong Cài đặt.'), enabled: true };
  if (!settings.user) return { ...bad(now, day, 'Chưa điền tài khoản thư trong Cài đặt.'), enabled: true };

  const fetchMail = options.fetchMail || fetchViaChild;
  let parsed;
  try {
    parsed = fetchMail(settings, options);
  } catch (error) {
    parsed = { ok: false, error: String((error && error.message) || error) };
  }
  if (!isPlainObject(parsed)) parsed = { ok: false, error: 'Phần đọc hộp thư trả về thứ không hiểu được.' };

  if (!parsed.ok) {
    const shot = { ...bad(now, day, String(parsed.error || 'Không đọc được hộp thư.'), parsed.notes), enabled: true };
    /* Vẫn GHI ảnh chụp khi lỗi. Không phải để lưu cái lỗi, mà để lần sau mở
       lên còn biết lần quét gần nhất hỏng lúc nào — nếu không, "chưa quét bao
       giờ" và "quét hỏng" trông giống hệt nhau. */
    writeShot(config, shot);
    return shot;
  }

  const shot = { ...build(parsed, settings, now, day), enabled: true };
  writeShot(config, shot);
  return shot;
}

function writeShot(config, shot) {
  try { U.writeJson(inboxFile(config), shot); return null; }
  catch (error) { return String((error && error.message) || error); }
}

/* --- Trạng thái, cho cảnh báo và cho giao diện ----------------------- */

/* CON SỐ. Không tiêu đề, không địa chỉ, không nội dung.

   Đây là thứ đi vào cảnh báo và đi vào gói bằng chứng gửi cho AI. Giữ nó
   sạch là giữ điều 1 ở đầu tệp; thêm một trường văn bản vào đây là phá đúng
   ranh giới mà cả tính năng này dựng lên để giữ. */
function summary(config, opts) {
  const options = opts || {};
  const settings = settingsOf(config);
  const now = options.now == null ? Date.now() : options.now;
  /* `opts.shot` là khe cắm kiểm thử: đưa thẳng một ảnh chụp dựng trong bộ nhớ
     thì kiểm được mọi nhánh đếm mà không phải ghi tệp nào. Cùng lối
     `opts.snapshot` của `alerts.repoAlerts`. */
  const loaded = options.shot === undefined ? read(config) : { shot: options.shot, damaged: false };
  const shot = loaded.shot;
  const damaged = loaded.damaged;

  const base = {
    enabled: settings.enabled,
    ready: isReady(settings),
    synced: !!shot,
    damaged,
    at: shot ? num(shot.updatedAt) : null,
    day: shot ? shot.day : null,
    /* Ảnh chụp cũ: quét hôm khác thì hôm nay chưa quét. Chỗ gọi phải nói ra,
       vì "0 thư chưa trả lời" của một ảnh chụp ba hôm trước không có nghĩa là
       hôm nay không có thư nào. */
    stale: !shot || shot.day !== U.dayKey(now, config.dayStartHour),
    folder: settings.folder,
    sentFolder: settings.sentFolder || null,
    /* TÊN biến môi trường, không phải giá trị. Tên thì nói ra được — nó là
       chỉ dẫn, và giao diện cần nó để bảo huynh đặt biến nào. */
    passwordEnv: settings.passwordEnv,
    /* Thiếu thư mục Đã gửi thì tín hiệu CHÍNH tắt, và con số trở thành ước
       lượng thô dựa vào cờ `\Answered` — thứ đếm thừa. Cờ này để giao diện
       và cảnh báo nói ra điều đó thay vì trình bày một con số chắc chắn hơn
       thực tế. */
    weak: !settings.sentFolder,
    unansweredHours: settings.unansweredHours,
    error: shot ? (shot.error || null) : null,
    notes: shot && Array.isArray(shot.notes) ? shot.notes.map(String) : [],
    total: 0, answered: 0, waiting: 0, unseen: 0, undated: 0, oldestDays: 0, oldestHours: 0,
    sentCount: (shot && num(shot.sentCount)) || 0
  };

  if (!shot || !shot.ok) return base;
  const a = analyze(shot, settings, now);
  base.total = a.total;
  base.answered = a.answered;
  base.waiting = a.waiting.length;
  base.unseen = a.unseen;
  base.undated = a.undated;
  base.oldestDays = a.oldestDays;
  base.oldestHours = a.oldestHours;
  return base;
}

/* Như `summary`, CỘNG danh sách thư đang chờ — có tiêu đề và người gửi.

   Chỉ dùng cho `/api/mail`, tức là chỉ đi tới màn hình của chính huynh. Đừng
   gọi hàm này từ alert, từ digest, hay từ gói AI. */
function view(config, opts) {
  const options = opts || {};
  const out = summary(config, options);
  const shot = options.shot === undefined ? read(config).shot : options.shot;
  out.items = [];
  out.itemTotal = 0;
  out.listLimit = LIST_LIMIT;
  if (!shot || !shot.ok) return out;

  const settings = settingsOf(config);
  const now = options.now == null ? Date.now() : options.now;
  const waiting = analyze(shot, settings, now).waiting;
  out.itemTotal = waiting.length;
  out.items = waiting.slice(0, LIST_LIMIT).map((i) => ({
    uid: i.uid,
    subject: i.subject,
    from: i.from,
    fromAddress: i.fromAddress,
    dateMs: i.dateMs,
    days: i.days,
    hours: i.hours,
    seen: i.seen,
    replied: i.replied
  }));
  return out;
}

module.exports = {
  FETCH_SCRIPT, LIST_LIMIT,
  DEFAULT_PORT, DEFAULT_PASSWORD_ENV, DEFAULT_FOLDER, DEFAULT_SENT_FOLDER,
  DEFAULT_UNANSWERED_HOURS, DEFAULT_MAX_MESSAGES,
  mailDir, inboxFile,
  settingsOf, isReady,
  read, build, buildSentIndex, analyze, normalizeMessages,
  snapshot, summary, view,
  fetchViaChild
};
