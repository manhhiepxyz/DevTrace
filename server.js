'use strict';

/* =====================================================================
   server.js — Máy chủ của DevTrace.

   Vừa phục vụ giao diện, vừa mở API để giao diện yêu cầu thu thập và đọc
   bằng chứng. Chạy:  node server.js   rồi mở http://localhost:5173

   Chỉ dùng mô-đun có sẵn của Node, không cần cài thêm gì.
   ===================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');

const C = require('./app/config');
const U = require('./app/util');
const E = require('./app/events');
const Collect = require('./app/collect');
const D = require('./app/digest');
const AI = require('./app/ai');
const Report = require('./app/report');
const R = require('./app/redact');
const Plans = require('./app/plans');
const RepoHealth = require('./app/repohealth');
const Mail = require('./app/mail');
const Nudges = require('./app/nudges');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5173;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

/* Chỉ những tệp thuộc giao diện mới được phục vụ. Thư mục app/ (mã máy
   chủ), data/ (bằng chứng cá nhân) và tệp cấu hình đều bị chặn. */
const ALLOW = [
  /^\/index\.html$/,
  /* Cửa sổ ghi nhanh (Ctrl + Alt + N) nạp từ chính máy chủ này chứ không mở
     từ đĩa. Cùng nguồn gốc thì nó dùng chung localStorage — bảng màu đang
     chọn đi theo — và gửi thẳng vào API được, khỏi phải mở CORS cho cả máy
     chủ chỉ vì một ô nhập. */
  /^\/capture\.html$/,
  /^\/styles\.css$/,
  /^\/favicon\.ico$/,
  /^\/(?:web|assets)\/[A-Za-z0-9._/-]+\.(?:js|css|svg|png|jpg|jpeg|webp|woff2)$/
];

/* Vài đường dẫn không nằm thẳng trong gốc dự án. Biểu tượng của cửa sổ ứng
   dụng lấy từ đúng tệp devtrace.ico mà lối tắt ngoài màn hình đang dùng —
   một nguồn duy nhất, không sinh thêm bản sao để rồi lệch nhau. */
const ALIASES = {
  '/favicon.ico': path.join('desktop', 'devtrace.ico')
};

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

/* --- Tệp pid: để desktop/stop.js biết cần tắt tiến trình nào --------- */

function pidFileFor(config) {
  return path.join(config.dataDir, 'server.pid');
}

function writePidFile() {
  try {
    const config = C.load();
    fs.writeFileSync(pidFileFor(config), JSON.stringify({
      pid: process.pid,
      port: PORT,
      root: ROOT,
      startedAt: new Date().toISOString()
    }, null, 2), 'utf8');
  } catch (e) { /* không ghi được thì thôi, không phải việc sống còn */ }
}

// Chỉ xoá khi tệp pid đúng là của tiến trình này — nếu không thì một máy chủ
// đang chạy sẽ bị xoá dấu của chính nó bởi một tiến trình vừa thoát vì bận cổng.
function removePidFile() {
  try {
    const file = pidFileFor(C.load());
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (record && record.pid === process.pid) fs.unlinkSync(file);
  } catch (e) { /* thôi */ }
}

function sendJson(res, status, value) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 4 * 1024 * 1024) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig || !data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

/* --- Duyệt thư mục để chọn gốc dự án ------------------------------- */

/* Chỉ TÊN THƯ MỤC đi ra khỏi đường này: không tên tệp, không nội dung tệp.
   Nó tồn tại để chọn một thư mục làm gốc dự án, không phải để đọc máy. */
const DIR_LIMIT = 500;

function dirEntry(full) {
  return {
    name: path.basename(full) || full,
    path: full,
    // Có sẵn `.git` thì giao diện biết đây là kho mã, và biết nên hỏi huynh
    // có nối vào nguồn Git hay không.
    git: U.isDir(path.join(full, '.git'))
  };
}

function listDirs(raw) {
  const asked = String(raw == null ? '' : raw).trim();
  /* Không hỏi gì thì trả về danh sách ổ đĩa. Trên Windows không có một thư
     mục gốc chung để bắt đầu, nên chặng đầu tiên của việc duyệt phải là các ổ.
     Dò 26 chữ cái là cách rẻ nhất và không cần gọi thêm tiến trình nào. */
  if (!asked) {
    const dirs = [];
    for (let c = 65; c <= 90; c++) {
      const letter = String.fromCharCode(c) + ':\\';
      try { if (fs.existsSync(letter)) dirs.push(dirEntry(letter)); } catch (e) { /* thôi */ }
    }
    return { path: '', parent: null, dirs, drives: true };
  }

  const dir = U.expandPath(asked);
  if (!U.isDir(dir)) return { path: dir, parent: null, dirs: [], error: 'Không phải thư mục, hoặc không đọc được.' };

  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return { path: dir, parent: parentDir(dir), dirs: [], error: 'Không đọc được thư mục này.' };
  }

  const dirs = [];
  for (const item of items) {
    const full = path.join(dir, item.name);
    /* `isDirectory()` là false với lối tắt thư mục (junction) — mà trên
       Windows thì `C:\Users\All Users` và vài chỗ tương tự đều là junction,
       nên bỏ qua thẳng sẽ làm mất những thư mục có thật. */
    if (!item.isDirectory() && !(item.isSymbolicLink() && U.isDir(full))) continue;
    dirs.push(dirEntry(full));
  }
  dirs.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'vi'));

  const out = { path: dir, parent: parentDir(dir), dirs: dirs.slice(0, DIR_LIMIT), drives: false };
  // Cắt bớt thì phải nói ra, không im lặng — cùng lối với "Chỉ quét 20/52 kho".
  if (dirs.length > out.dirs.length) out.truncated = dirs.length - out.dirs.length;
  return out;
}

function parentDir(dir) {
  const up = path.dirname(dir);
  return up === dir ? null : up;
}

async function api(req, res, urlPath, query) {
  const config = C.load();

  if (urlPath === '/api/status' && req.method === 'GET') {
    return sendJson(res, 200, { app: 'devtrace', status: Collect.status(config), config: Report.publicConfig(config) });
  }

  /* Thu thập chạy trong TIẾN TRÌNH RIÊNG, không phải ngay tại đây.

     Gọi thẳng `Collect.run` ở chỗ này là khoá cả máy chủ suốt lượt thu
     thập: đo được 15,2 giây không trả lời nổi một yêu cầu nào. Mở ứng dụng
     lên là màn hình trắng đúng bằng chừng ấy. Xem app/collect-run.js.

     Đổi lại, tuyến này chờ lâu hơn — nhưng chờ ở đây là chờ của MỘT yêu
     cầu, không phải của cả máy chủ. */
  if (urlPath === '/api/collect' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await Collect.runDetached(config, { sources: body.sources, rebuild: !!body.rebuild });
    // 409 khi đang có một lượt KHÁC chạy: yêu cầu này không được đáp, và
    // im lặng trả về bản tổng kết của lượt kia là nói dối.
    return sendJson(res, result.ok ? 200 : (result.busy ? 409 : 500), result);
  }

  if (urlPath === '/api/days' && req.method === 'GET') {
    const days = E.listDays(config).slice().reverse().slice(0, 180);
    return sendJson(res, 200, { days: days.map((day) => Report.daySummary(config, day)) });
  }

  if (urlPath === '/api/projects' && req.method === 'GET') {
    return sendJson(res, 200, Report.projectsRange(config, Number(query.get('days')) || 14));
  }

  const dayMatch = urlPath.match(/^\/api\/day\/([^/]+)(?:\/([a-z]+))?$/);
  if (dayMatch) {
    const day = dayMatch[1];
    const part = dayMatch[2] || 'digest';
    if (!DAY_RE.test(day)) return sendJson(res, 400, { error: 'Ngày không hợp lệ.' });

    if (part === 'digest' && req.method === 'GET') {
      return sendJson(res, 200, { digest: D.build(config, day) });
    }
    if (part === 'events' && req.method === 'GET') {
      return sendJson(res, 200, { events: Report.filteredEvents(config, day, query) });
    }
    if (part === 'pack' && req.method === 'GET') {
      const pack = AI.evidencePack(config, day);
      return sendJson(res, 200, { pack, prompt: AI.buildPrompt(pack) });
    }
    if (part === 'journal') {
      if (req.method === 'GET') return sendJson(res, 200, { journal: AI.readJournal(config, day) });
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body.text || !String(body.text).trim()) return sendJson(res, 400, { error: 'Chưa có nội dung.' });
        const saved = AI.saveJournal(config, day, { text: String(body.text), source: body.source || 'dán tay' });
        return sendJson(res, 200, { journal: saved });
      }
    }
    if (part === 'synthesize' && req.method === 'POST') {
      return sendJson(res, 200, await AI.synthesize(config, day));
    }
    return sendJson(res, 404, { error: 'Không rõ yêu cầu.' });
  }

  /* ---- Kế hoạch của huynh: nhiệm vụ, thời khoá biểu, đợt làm việc ----

     Đối chiếu kế hoạch với thực tế KHÔNG có route riêng: nó đi kèm trong
     `digest.schedule`, vì đó là cùng một câu hỏi — "ngày này định làm gì, và
     thực tế lệch ở đâu". Tách thành hai route thì hai bên có thể lệch ngày
     mà không ai phát hiện.

     Khai báo dự án cũng không có route riêng: nó đi qua POST /api/config như
     mọi khoá cấu hình khác.

     Mọi thao tác ghi đều trả về `{ok: false, error}` kèm mã 400 khi bị từ
     chối — ví dụ khi tệp kế hoạch hỏng và DevTrace đang từ chối ghi đè. Giao
     diện phải hiện đúng câu đó cho huynh, không được nuốt đi. */
  if (urlPath === '/api/plans' && req.method === 'GET') {
    const day = query.get('day') || '';
    if (!DAY_RE.test(day)) return sendJson(res, 400, { error: 'Thiếu hoặc sai tham số day (YYYY-MM-DD).' });
    // `week=1` là phần THÊM, không phải route riêng — xem chú thích ngay
    // trên. Màn Dự án gọi route này mà không kèm cờ, nên nó không phải trả
    // giá đọc bằng chứng của bảy ngày cho một thứ nó không hiển thị.
    return sendJson(res, 200, Plans.view(config, day, query.get('week') === '1' ? { week: true } : undefined));
  }

  if (urlPath === '/api/plans/task' && req.method === 'POST') {
    const body = await readBody(req);
    const result = Plans.applyTask(config, String(body.action || ''), body);
    return sendJson(res, result.ok ? 200 : 400, result);
  }

  if (urlPath === '/api/plans/slot' && req.method === 'POST') {
    const body = await readBody(req);
    const result = Plans.applySlot(config, String(body.action || ''), body);
    return sendJson(res, result.ok ? 200 : 400, result);
  }

  if (urlPath === '/api/plans/sprint' && req.method === 'POST') {
    const body = await readBody(req);
    const result = Plans.applySprint(config, String(body.action || ''), body);
    return sendJson(res, result.ok ? 200 : 400, result);
  }

  /* Hộp thư đến — đường GHI NHANH.

     Đây là route mà cửa sổ ghi nhanh gọi, và nó phải trả lời trong vài
     mili giây: nó ghi vào tệp việc, không đọc bằng chứng, không chạy git,
     không mở mạng. Nếu chỗ này chậm thì phím tắt thành vô dụng, và ghi một
     việc lại đắt hơn mở Notepad.

     `source` chỉ để biết mục tới từ phím tắt hay từ giao diện — không bao
     giờ được dùng làm bằng chứng. Nó là chữ huynh gõ, không phải máy đọc. */
  if (urlPath === '/api/plans/inbox' && req.method === 'POST') {
    const body = await readBody(req);
    const result = Plans.applyInbox(config, String(body.action || ''), body);
    return sendJson(res, result.ok ? 200 : 400, result);
  }

  /* ---- Sức khoẻ kho mã ----

     Quét là việc PHẢI CHỌN: mỗi kho tốn khoảng sáu lệnh git, nên GET chỉ đọc
     ảnh chụp đã lưu, còn POST mới thật sự quét. Nhờ vậy mở màn Dự án không
     bao giờ treo vài chục giây vì một việc huynh không yêu cầu. */
  if (urlPath === '/api/repohealth' && req.method === 'GET') {
    const shot = RepoHealth.read(config);
    return sendJson(res, 200, {
      snapshot: shot,
      stale: RepoHealth.isStale(shot, config),
      settings: RepoHealth.settingsOf(config)
    });
  }

  if (urlPath === '/api/repohealth/refresh' && req.method === 'POST') {
    const body = await readBody(req);
    // Quét bí mật chỉ chạy khi huynh bật trong Cài đặt, hoặc khi yêu cầu rõ
    // trong lần gọi này. Nó đắt, và nó báo nhầm trên tệp thử.
    const opts = { secretScan: body.secretScan === true ? true : undefined };
    return sendJson(res, 200, RepoHealth.snapshot(config, opts));
  }

  /* ---- Hộp thư ----

     GET chỉ ĐỌC ảnh chụp đã lưu; POST mới thật sự mở kết nối IMAP. Cùng lý
     do như sức khoẻ kho: mở màn Hôm nay không được phép chờ mạng, và một
     hộp thư chậm không được phép làm chậm cả ứng dụng.

     GET trả về `Mail.view` — tức là CÓ tiêu đề thư. Đó là chủ ý: đây là
     tuyến chỉ đi tới màn hình của chính huynh. Cảnh báo và gói bằng chứng
     gửi cho AI đi đường khác, qua `Mail.summary`, và bên đó chỉ có con số.
     Đừng đổi tuyến này thành nguồn cho alert/digest/AI. */
  if (urlPath === '/api/mail' && req.method === 'GET') {
    return sendJson(res, 200, Mail.view(config));
  }

  if (urlPath === '/api/mail/refresh' && req.method === 'POST') {
    return sendJson(res, 200, Mail.snapshot(config));
  }

  /* ---- Lời nhắc cho khay hệ thống ----

     Chạy trong TIẾN TRÌNH RIÊNG, không phải ngay tại đây. Phần quét kho mã
     của nó là 80 tiến trình git chạy đồng bộ, và gọi thẳng thì mỗi lần ứng
     dụng để bàn hỏi "có gì mới không" là máy chủ đứng hình chừng ấy — đúng
     cái lỗi đã đo được ở đường thu thập, khi một `GET /api/status` vài
     mili giây bị trả lời sau 15,2 giây.

     `?repos=1` mới quét kho. Mặc định KHÔNG quét: đây là tuyến bị hỏi vài
     phút một lần, còn quét kho tốn bốn lệnh git mỗi kho. */
  if (urlPath === '/api/nudges' && req.method === 'GET') {
    const result = await Nudges.spawnNudges({ repos: query.get('repos') === '1' });
    return sendJson(res, result.ok ? 200 : 500, result);
  }

  /* ---- Duyệt thư mục để chọn dự án ----

     Cần thiết vì trình duyệt KHÔNG đọc được đường dẫn tuyệt đối từ ô chọn
     thư mục: nó trả về `C:\fakepath\…`, một chuỗi vô dụng. Nên việc duyệt
     phải làm ở phía máy chủ.

     Chỉ đọc tên thư mục, không đọc nội dung, và chỉ đường dẫn thư mục —
     không có cách nào đọc nội dung một tệp qua đường này. */
  if (urlPath === '/api/fs/dirs' && req.method === 'GET') {
    return sendJson(res, 200, listDirs(query.get('path')));
  }

  if (urlPath === '/api/config' && req.method === 'POST') {
    const body = await readBody(req);
    const next = C.merge(C.load(), body || {});
    C.save(next);
    return sendJson(res, 200, { saved: true, config: Report.publicConfig(C.load()) });
  }

  if (urlPath === '/api/export' && req.method === 'GET') {
    const days = E.listDays(config);
    /* Bản xuất mặc định là bản SAO LƯU đầy đủ — che bí mật ở đây là âm thầm
       làm hỏng bản sao lưu của huynh. Nhưng bản xuất cũng là thứ hay được
       gửi cho người khác, nên có sẵn bản đã che: thêm ?redact=1.

       Tệp tự khai nó là bản nào, để một tệp đã che nằm lẫn trong thư mục
       tải về vẫn nói được sự thật về chính nó. */
    const wantRedact = query && (query.get('redact') === '1' || query.get('redact') === 'true');
    const store = Plans.loadStore(config, {});
    const payload = {
      kind: 'devtrace-export', version: 1, exportedAt: new Date().toISOString(),
      redacted: !!wantRedact,
      config: Report.publicConfig(config),
      days: days.map((day) => ({ day, events: E.readDay(config, day) })),
      journals: days.map((day) => ({ day, journal: AI.readJournal(config, day) })).filter((item) => item.journal),
      /* Kế hoạch đi cùng bản sao lưu, và đây là chỗ DUY NHẤT nó rời khỏi máy
         theo đường xuất. Ba tệp này là chữ huynh tự viết — mất chúng là mất
         thứ không dựng lại được từ dấu vết, khác hẳn mọi thứ còn lại trong
         tệp xuất.

         `hong` nói ra tệp nào không đọc nổi. Không có nó thì một tệp hỏng
         biến thành kế hoạch rỗng trong bản sao lưu, và bản sao lưu trông vẫn
         đầy đủ — đúng kiểu im lặng mà cả dự án này cấm.

         Ảnh chụp hộp thư thì KHÔNG có ở đây: nó là cache dựng lại được, và
         là chữ của người khác. */
      plans: {
        tasks: store.tasks,
        timetable: store.timetable,
        sprints: store.sprints,
        hong: Object.keys(store.corrupt || {}).map((name) => path.basename(store.corrupt[name].file))
      }
    };
    if (!wantRedact) {
      payload.note = 'Bản sao lưu đầy đủ, còn nguyên dữ liệu gốc — kể cả khoá/bí mật nếu chúng lọt vào dấu vết. '
        + 'Cân nhắc trước khi gửi tệp này cho người khác; muốn bản đã che thì dùng /api/export?redact=1.';
      return sendJson(res, 200, payload);
    }
    const redacted = R.redactValue(payload, R.optionsFrom(config));
    redacted.value.note = redacted.hits.length
      ? 'Bản chia sẻ: ' + R.summarize(redacted.hits) + ' trước khi xuất.'
      : 'Bản chia sẻ: không thấy chuỗi nào khớp khuôn mẫu bí mật đã biết.';
    return sendJson(res, 200, redacted.value);
  }

  /* Xoá sạch kho — nhưng KHÔNG trong lúc một lượt thu thập đang chạy.

     Tiến trình con đang ghi vào chính những tệp sắp bị xoá, và nó ghi bằng
     cách thay cả tệp ngày. Xen vào giữa chừng thì kết quả là một kho nửa
     mới nửa cũ, không cách nào dựng lại — mà đây lại đúng là thao tác
     người ta bấm khi muốn "làm lại từ đầu". */
  if (urlPath === '/api/reset' && req.method === 'POST') {
    if (Collect.collecting()) {
      return sendJson(res, 409, { error: 'Đang thu thập dấu vết — đợi lượt này xong rồi xoá.' });
    }
    Collect.clearCollected(config);
    return sendJson(res, 200, { cleared: true });
  }

  return sendJson(res, 404, { error: 'Không rõ đường dẫn API: ' + urlPath });
}

const server = http.createServer((req, res) => {
  let urlPath;
  let query;
  try {
    const raw = String(req.url);
    urlPath = decodeURIComponent(raw.split('?')[0]);
    query = new URLSearchParams(raw.split('?')[1] || '');
  } catch (e) {
    return send(res, 400, 'text/plain; charset=utf-8', '400 — Đường dẫn không hợp lệ.');
  }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  if (urlPath.startsWith('/api/')) {
    api(req, res, urlPath, query).catch((error) => {
      sendJson(res, 500, { error: String((error && error.message) || error) });
    });
    return;
  }

  const alias = ALIASES[urlPath];
  const filePath = alias ? path.join(ROOT, alias) : path.resolve(ROOT, '.' + urlPath);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'text/plain; charset=utf-8', '403 — Không được phép truy cập ngoài thư mục dự án.');
  }
  if (!ALLOW.some((rule) => rule.test(urlPath))) {
    return send(res, 404, 'text/plain; charset=utf-8', '404 — Không tìm thấy: ' + urlPath);
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'text/plain; charset=utf-8', '404 — Không tìm thấy: ' + urlPath);
    send(res, 200, TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream', data);
  });
});

function shutdown() {
  removePidFile();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

if (require.main === module) {
  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.error('Cổng ' + PORT + ' đang được dùng.');
      console.error('Nếu DevTrace đang chạy sẵn, mở thẳng: http://localhost:' + PORT);
      console.error('Muốn dùng cổng khác:  $env:PORT=5180; node server.js');
      process.exit(2);
    }
    throw error;
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', removePidFile);
  server.listen(PORT, () => {
    writePidFile();
    console.log('DevTrace đang chạy tại:  http://localhost:' + PORT);
    console.log('Dữ liệu: ' + C.load().dataDir);
    console.log('Nhấn Ctrl + C để dừng.');
  });
}

module.exports = { server, api, ALLOW, PORT, pidFileFor, writePidFile, removePidFile, listDirs };
