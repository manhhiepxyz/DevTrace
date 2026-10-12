'use strict';

/* =====================================================================
   desktop/main.js — DevTrace mở như một ứng dụng Windows thật.

   Khác gì so với desktop/launch.js? launch.js mở Chrome ở chế độ --app:
   trông như phần mềm thật nhưng thực chất vẫn là Chrome, và Chrome có thể
   đổi cách chạy bất cứ lúc nào. Tệp này mở một cửa sổ của chính DevTrace,
   có biểu tượng riêng trên taskbar, có khay hệ thống, và chỉ chạy một bản.

   Việc nó làm:
     1. Chỉ cho một bản chạy. Mở lần thứ hai thì đưa cửa sổ cũ lên trước.
     2. Bảo đảm máy chủ đang chạy (chưa chạy thì bật lên, như launch.js).
     3. Mở cửa sổ trỏ vào máy chủ đó.
     4. Đóng cửa sổ thì thu xuống khay, không thoát — thoát là việc phải
        chọn rõ ràng.

   KHÔNG viết lại phần nói chuyện với máy chủ: nó dùng lại đúng những hàm
   đã có trong launch.js (probe, startServer, waitForServer, postJson).
   Một chỗ sửa, hai đường dùng chung.

   Tệp này nạp được bằng node thường (không có Electron) — xem chốt `E`
   ngay dưới đây. Nhờ vậy bộ kiểm thử soi được phần suy nghĩ thuần tuý của
   nó mà không phải cài Electron, và `npm test` vẫn chạy được trên máy sạch.
   ===================================================================== */

const path = require('path');
const childProcess = require('child_process');

const Launch = require('./launch');
const Stop = require('./stop');

const ICON_FILE = path.join(__dirname, 'devtrace.ico');

/* --- Nạp Electron mà không làm vỡ bộ kiểm thử -----------------------

   Trong Electron, require('electron') trả về đối tượng API. Chạy bằng node
   thường thì nó trả về một CHUỖI đường dẫn tới electron.exe (đúng như vậy,
   không phải lỗi đánh máy), và ném lỗi nếu chưa cài. Cả hai trường hợp đều
   phải chịu được: lúc đó E là null, phần khởi động không chạy, còn các hàm
   thuần bên dưới vẫn gọi được. */
let E = null;
try {
  const mod = require('electron');
  if (mod && typeof mod === 'object' && mod.app) E = mod;
} catch (error) {
  E = null;
}

const SIZE_FALLBACK = { width: 1360, height: 900 };

/* --- Phần thuần tuý: không đụng tới Electron, kiểm thử được ---------- */

/* Vì sao không nạp được Electron. Trả về null nghĩa là mọi thứ bình thường.

   Trường hợp thứ hai là một cái bẫy thật, đã gặp và đã mất thời gian vì nó:
   cửa sổ dòng lệnh mở NGAY TRONG VS Code có sẵn biến ELECTRON_RUN_AS_NODE=1.
   Biến đó khiến electron.exe chạy như node thường, nên require('electron')
   trả về một chuỗi đường dẫn thay vì bộ API, và ứng dụng chết ngay lúc mở.
   Nhìn từ ngoài thì không có gì gợi ý nguyên nhân, nên câu thông báo phải
   nói thẳng ra. */
function launchProblem(env, hasElectron) {
  if (hasElectron) return null;
  if (env && env.ELECTRON_RUN_AS_NODE) {
    return 'Electron đang bị buộc chạy như node thường, vì trong môi trường có\n' +
      'ELECTRON_RUN_AS_NODE=' + env.ELECTRON_RUN_AS_NODE + '.\n\n' +
      'Chuyện này hay gặp khi mở cửa sổ dòng lệnh NGAY TRONG VS Code — VS Code\n' +
      'đặt sẵn biến đó cho tiện việc của nó.\n\n' +
      'Cách xử lý: mở PowerShell hoặc CMD ở ngoài rồi chạy lại, hoặc xoá biến đi:\n' +
      '  PowerShell:  $env:ELECTRON_RUN_AS_NODE = ""\n' +
      '  CMD:         set ELECTRON_RUN_AS_NODE=\n\n' +
      'Còn nếu muốn mở ngay bây giờ thì dùng npm run app — bản chạy bằng Chrome,\n' +
      'không dính chuyện này.';
  }
  return 'Tệp này phải chạy bằng Electron (chưa cài Electron?).\n' +
    'Cài:  npm install\n' +
    'Chạy: npm run desktop';
}

// "1360,900" trong cấu hình thành con số thật. Hỏng thì lấy cỡ mặc định,
// không đoán bừa một cửa sổ cao 3 pixel.
function parseSize(text) {
  const parts = String(text == null ? '' : text).split(/[,x]/);
  const width = Math.round(Number(parts[0]));
  const height = Math.round(Number(parts[1]));
  const sane = isFinite(width) && isFinite(height) && width >= 480 && height >= 360;
  return sane ? { width: width, height: height } : Object.assign({}, SIZE_FALLBACK);
}

function windowOptions(desk) {
  const size = parseSize(desk && desk.windowSize);
  return {
    width: size.width,
    height: size.height,
    minWidth: 900,
    minHeight: 600,
    // Hiện khi trang đã vẽ xong: nếu không, người dùng thấy một khung trắng
    // nháy lên rồi mới có nội dung.
    show: false,
    // Cùng màu nền với bảng màu sáng mặc định (--bg trong styles.css).
    backgroundColor: '#f5f6f8',
    icon: ICON_FILE,
    title: 'DevTrace',
    autoHideMenuBar: true,
    webPreferences: {
      /* Trang của DevTrace là trang web bình thường, không cần quyền gì của
         hệ điều hành. Đóng hết cửa: không cho trang gọi Node, tách ngữ cảnh,
         và bật sandbox. Ba dòng này là mặc định của Electron nhưng ghi ra
         đây để lần sau có ai sửa thì thấy ngay mình đang mở cái gì. */
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  };
}

/* Tiến trình con phải chạy bằng Node thật, không phải Electron: trong
   Electron, process.execPath là electron.exe. Đặt ELECTRON_RUN_AS_NODE=1
   thì chính electron.exe chạy như node thường — không phải đi tìm node.exe
   trên máy, cũng không phụ thuộc Node cài rời.

   Tách phần dựng biến môi trường ra khỏi phần chạy tiến trình: bộ kiểm thử
   kiểm được đúng dòng quan trọng nhất mà không phải bật tiến trình nào. */
function nodeEnv(env) {
  return Object.assign({}, env, { ELECTRON_RUN_AS_NODE: '1' });
}

function spawnNode(exe, args, options) {
  const opts = Object.assign({}, options || {});
  opts.env = nodeEnv(opts.env);
  return childProcess.spawn(exe, args, opts);
}

function busyMessage(desk) {
  return 'Cổng ' + desk.port + ' đang bị một chương trình khác chiếm.\n' +
    'DevTrace không mở, vì không chắc cổng đó là của mình.\n\n' +
    'Cách xử lý: mở devtrace.config.json, đổi "desktop": { "port": 5180 },\n' +
    'hoặc tắt chương trình đang giữ cổng ' + desk.port + '.';
}

function deadMessage(desk, started) {
  return 'Máy chủ không lên trong ' + Math.round(desk.waitMs / 1000) + ' giây.\n' +
    (started && started.logFile ? 'Xem nhật ký ở: ' + started.logFile + '\n\n' : '') +
    'Thường gặp: Node.js quá cũ (cần 22 trở lên), hoặc lần chạy trước chưa tắt hẳn.';
}

/* Bảo đảm máy chủ đang trả lời. Trả về { ok, started, reason, message } —
   trả về chứ không ném lỗi, để chỗ gọi hiện được hộp thoại tử tế thay vì
   một vệt lỗi trong cửa sổ dòng lệnh không ai nhìn thấy.

   `seams` chỉ để bộ kiểm thử chạy được toàn bộ đường đi mà không bật tiến
   trình nào — cùng cách stop.js đang có opts.kill. */
async function ensureServer(config, desk, seams) {
  const opts = seams || {};
  const probe = opts.probe || Launch.probe;
  const startServer = opts.startServer || Launch.startServer;
  const waitForServer = opts.waitForServer || Launch.waitForServer;
  const spawn = opts.spawn || spawnNode;

  const before = await probe(desk, 1500);
  if (before.ok) return { ok: true, started: false };

  // Cổng có người trả lời nhưng không phải DevTrace: dừng lại, đừng mở nhầm
  // trang của chương trình khác dưới tên DevTrace.
  if (before.listening) {
    return { ok: false, reason: 'port-busy', message: busyMessage(desk) };
  }

  const started = startServer(config, desk, spawn);
  const ready = await waitForServer(desk, desk.waitMs);
  if (!ready.ok) {
    return {
      ok: false, reason: 'no-server', message: deadMessage(desk, started),
      logFile: (started && started.logFile) || null
    };
  }
  return { ok: true, started: true, pid: (started && started.pid) || null, logFile: started.logFile };
}

/* Khay hệ thống. Nhãn nút thoát nói thẳng nó có tắt máy chủ hay không —
   người dùng không phải đoán xem máy chủ còn chạy nền hay đã tắt. */
function trayTemplate(handlers, options) {
  const h = handlers || {};
  const opts = options || {};
  return [
    { label: 'Mở DevTrace', click: h.open },
    { label: 'Thu thập dấu vết ngay', click: h.collect },
    { label: 'Mở bằng trình duyệt', click: h.browser },
    { type: 'separator' },
    { label: opts.ownsServer ? 'Thoát DevTrace (dừng máy chủ)' : 'Thoát DevTrace', click: h.quit }
  ];
}

/* Nút X của cửa sổ: thu xuống khay, trừ khi đang thoát thật. Trả về true
   nghĩa là đã thu, false nghĩa là cứ để cửa sổ đóng. */
function onWindowClose(event, state) {
  if (!state || !state.window || state.quitting) return false;
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  state.window.hide();
  return true;
}

function revealWindow(win) {
  if (!win) return false;
  if (typeof win.isMinimized === 'function' && win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}

/* Khoá một-bản-chạy. Mở lần thứ hai thì lần thứ nhất được báo và đưa cửa sổ
   lên, còn tiến trình mới tự thoát. Không có khoá này thì mỗi cú nhấp đúp
   lại đẻ thêm một biểu tượng trên khay. */
function requestSingleInstance(application, onSecond) {
  if (!application.requestSingleInstanceLock()) {
    application.quit();
    return false;
  }
  application.on('second-instance', onSecond);
  return true;
}

/* --- Phần cần Electron ---------------------------------------------- */

function createWindow(desk, targetUrl, state) {
  const win = new E.BrowserWindow(windowOptions(desk));

  win.on('close', (event) => {
    const hidden = onWindowClose(event, state);
    // Nói một lần cho biết cửa sổ đi đâu, để không phải đi tìm. Nói lại mỗi
    // lần đóng thì thành phiền.
    if (hidden && !state.notified && state.tray) {
      state.notified = true;
      try {
        state.tray.displayBalloon({
          title: 'DevTrace vẫn đang chạy',
          content: 'Cửa sổ đã thu xuống khay hệ thống. Nhấp đúp biểu tượng để mở lại, chuột phải để thoát hẳn.'
        });
      } catch (error) { /* khay không hiện được thông báo thì thôi */ }
    }
  });

  win.once('ready-to-show', () => win.show());

  /* Nạp hỏng thì cửa sổ vẫn phải hiện ra. ready-to-show chỉ bắn khi trang đã
     vẽ xong; nạp hỏng thì nó không bao giờ bắn, và người dùng ngồi trước một
     ứng dụng không có gì: không cửa sổ, không thông báo, không lỗi. Thấy một
     cửa sổ trống kèm dòng lỗi vẫn hơn không thấy gì. */
  win.webContents.on('did-fail-load', (event, code, description, failedUrl, isMainFrame) => {
    if (isMainFrame === false) return;
    process.stdout.write('Không nạp được ' + failedUrl + ' (' + code + ' ' + description + ')\n');
    win.show();
  });

  /* Liên kết ra ngoài mở bằng trình duyệt thật. Mở trong cửa sổ Electron
     thì người dùng rơi vào một cửa sổ không có nút lùi, không thanh địa chỉ
     — đúng thứ gây hoang mang. */
  win.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//i.test(details.url)) E.shell.openExternal(details.url);
    return { action: 'deny' };
  });

  win.loadURL(targetUrl);
  return win;
}

function createTray(handlers, options) {
  const tray = new E.Tray(ICON_FILE);
  tray.setToolTip('DevTrace');
  tray.setContextMenu(E.Menu.buildFromTemplate(trayTemplate(handlers, options)));
  tray.on('double-click', handlers.open);
  return tray;
}

// Thu thập ở hậu trường rồi báo bằng bong bóng khay — nhưng chỉ khi cửa sổ
// đang ẩn hoặc không được chọn, vì lúc đó người dùng mới cần biết.
async function collectNow(state, desk) {
  let result = null;
  try {
    result = await Launch.postJson(desk, '/api/collect', {}, 180000);
  } catch (error) {
    result = { ok: false, reason: String((error && error.message) || error) };
  }
  const ok = !!(result && result.ok);
  const total = ok && result.json && result.json.total != null ? result.json.total : null;
  const text = ok
    ? 'Đã thu ' + (total == null ? 'xong' : total + ' sự kiện') + '.'
    : 'Thu thập không xong: ' + ((result && (result.reason || result.statusCode)) || 'không rõ lý do');

  const watching = state.window && state.window.isVisible() && state.window.isFocused();
  if (!watching && state.tray) {
    try { state.tray.displayBalloon({ title: 'DevTrace', content: text }); } catch (error) { /* thôi */ }
  }
  return text;
}

async function start() {
  const problem = launchProblem(process.env, !!E);
  if (problem) throw new Error(problem);

  const app = E.app;
  app.setName('DevTrace');
  // Windows dùng mã này để gom cửa sổ và thông báo về đúng một ứng dụng.
  if (process.platform === 'win32') app.setAppUserModelId('DevTrace');

  const config = require('../app/config').load();
  const desk = Launch.desktopConfig(config);
  const targetUrl = Launch.baseUrl(desk);

  const state = { window: null, tray: null, quitting: false, ownsServer: false, notified: false };

  if (!requestSingleInstance(app, () => revealWindow(state.window))) return;

  app.on('before-quit', () => { state.quitting = true; });
  // Cửa sổ đóng không phải là thoát: biểu tượng còn ở khay. Không có dòng
  // này thì Windows coi như hết việc và tắt cả ứng dụng.
  app.on('window-all-closed', () => { /* ở lại khay */ });

  await app.whenReady();

  const server = await ensureServer(config, desk, {});
  if (!server.ok) {
    if (E.dialog) E.dialog.showErrorBox('DevTrace không mở được', server.message);
    state.quitting = true;
    app.exit(1);
    return;
  }
  state.ownsServer = server.started;

  let quitting = false;
  const quitApp = async () => {
    if (quitting) return;
    quitting = true;
    state.quitting = true;
    /* Chỉ dừng máy chủ khi chính mình bật nó lên. Máy chủ có trước — do
       `npm start` hay một cửa sổ DevTrace khác — là việc của người đã bật
       nó, không phải của mình. */
    if (state.ownsServer) {
      try { await Stop.stop({ config: config, port: desk.port }); } catch (error) { /* thôi */ }
    }
    app.exit(0);
  };

  const handlers = {
    open: () => revealWindow(state.window),
    collect: () => { collectNow(state, desk).catch(() => { /* đã báo qua bong bóng */ }); },
    browser: () => E.shell.openExternal(targetUrl),
    quit: () => { quitApp(); }
  };

  state.window = createWindow(desk, targetUrl, state);
  state.tray = createTray(handlers, { ownsServer: state.ownsServer });

  // Nói ra khi cửa sổ đã sẵn sàng, để `npm run desktop` trong cửa sổ dòng
  // lệnh có cái mà đọc thay vì ngồi đoán xem ứng dụng đã lên chưa.
  process.stdout.write('DevTrace đã mở: ' + targetUrl +
    (state.ownsServer ? ' (máy chủ do ứng dụng này bật)' : ' (dùng máy chủ đang chạy sẵn)') + '\n');

  if (desk.collectOnLaunch) {
    collectNow(state, desk).catch(() => { /* không sao, lần thu sau sẽ bù */ });
  }

  return { url: targetUrl, startedServer: state.ownsServer };
}

/* Điều kiện vào KHÔNG phải `require.main === module` như mọi tệp khác trong
   dự án. Dưới Electron, require.main trỏ vào "electron" chứ không phải tệp
   này — đã thử và xác nhận. Dùng điều kiện đó thì nó luôn sai, và ứng dụng
   im lặng không làm gì: không cửa sổ, không thông báo, không lỗi. Đúng kiểu
   hỏng tệ nhất, vì không có gì để lần theo.

   Nên điều kiện là: có Electron thì đây là ứng dụng. Chạy bằng node thường
   (bộ kiểm thử) thì E là null, tệp vẫn nạp được mà không khởi động gì. */
if (E) {
  start().catch((error) => {
    const message = String((error && error.message) || error);
    if (E.dialog) E.dialog.showErrorBox('DevTrace không mở được', message);
    else process.stderr.write(message + '\n');
    process.exitCode = 1;
  });
}

module.exports = {
  ICON_FILE: ICON_FILE,
  SIZE_FALLBACK: SIZE_FALLBACK,
  launchProblem: launchProblem,
  parseSize: parseSize,
  windowOptions: windowOptions,
  nodeEnv: nodeEnv,
  spawnNode: spawnNode,
  busyMessage: busyMessage,
  deadMessage: deadMessage,
  ensureServer: ensureServer,
  trayTemplate: trayTemplate,
  onWindowClose: onWindowClose,
  revealWindow: revealWindow,
  requestSingleInstance: requestSingleInstance,
  collectNow: collectNow,
  start: start
};
