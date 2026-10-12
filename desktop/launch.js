'use strict';

/* =====================================================================
   desktop/launch.js — Đưa DevTrace lên như một ứng dụng để bàn.

   Việc nó làm, theo thứ tự:

     1. Đọc cấu hình để biết cổng nào cần mở.
     2. Nếu DevTrace chưa chạy thì bật máy chủ thành tiến trình nền ẩn
        (không cửa sổ dòng lệnh, nhật ký ghi vào data/server.log).
     3. Chờ máy chủ trả lời, rồi mở một cửa sổ ứng dụng: Chrome/Edge ở
        chế độ --app, tức là không thanh địa chỉ, trông như phần mềm thật.
     4. Thu thập dấu vết một lượt ở hậu trường để mở lên là có dữ liệu mới.

   Tệp này không tự hiện cửa sổ nào. Muốn chạy mà không thấy dòng lệnh thì
   nhấp đúp desktop/DevTrace.vbs (hoặc desktop/start-devtrace.cmd).

   Cổng bị chương trình khác chiếm là tình huống thật: khi đó tệp này dừng
   lại và ghi rõ lý do ra desktop/.launch-out.log để DevTrace.vbs hiện lên
   cho huynh đọc, chứ không âm thầm mở nhầm trang.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const http = require('http');
const childProcess = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(__dirname, '.launch-out.log');
const SERVER_FILE = path.join(ROOT, 'server.js');

const DEFAULTS = {
  port: 5173,
  host: '127.0.0.1',
  openBrowser: true,
  separateProfile: true,
  collectOnLaunch: true,
  windowSize: '1360,900',
  waitMs: 25000
};

/* --- Cấu hình ------------------------------------------------------- */

function desktopConfig(config) {
  const raw = (config && config.desktop) || {};
  const desk = Object.assign({}, DEFAULTS, raw);
  desk.port = Number(desk.port) || DEFAULTS.port;
  desk.waitMs = Number(desk.waitMs) || DEFAULTS.waitMs;
  desk.host = desk.host || DEFAULTS.host;
  return desk;
}

function baseUrl(desk) {
  return 'http://' + desk.host + ':' + desk.port + '/';
}

// Hồ sơ trình duyệt riêng: cửa sổ DevTrace không lẫn vào phiên lướt web
// thường ngày, và đóng nó không ảnh hưởng gì tới trình duyệt của huynh.
function profileDir(config) {
  const dataDir = (config && config.dataDir) || path.join(ROOT, 'data');
  return path.join(dataDir, 'browser-profile');
}

/* --- Tìm trình duyệt ------------------------------------------------ */

// Chỉ Chrome và họ hàng Chromium mới có chế độ --app, tức là cửa sổ không
// thanh địa chỉ. Trình duyệt khác vẫn mở được nhưng sẽ có thanh địa chỉ —
// và ta nói thẳng là như vậy, không giả vờ.
function browserCandidates(env) {
  const e = env || process.env;
  const pf = e['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = e['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = e['LOCALAPPDATA'] || '';
  const join = (...parts) => path.join.apply(path, parts);

  const out = [];
  const push = (name, exe, appMode) => {
    if (exe) out.push({ name: name, exe: exe, appMode: !!appMode });
  };

  push('Chrome', join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), true);
  push('Chrome', join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'), true);
  if (local) push('Chrome', join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'), true);
  push('Edge', join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), true);
  push('Edge', join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), true);
  push('Brave', join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), true);
  push('Brave', join(pf86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), true);
  if (local) push('Vivaldi', join(local, 'Vivaldi', 'Application', 'vivaldi.exe'), true);
  return out;
}

function findBrowser(env, isFile) {
  const exists = isFile || ((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
  for (const item of browserCandidates(env)) {
    if (exists(item.exe)) return item;
  }
  return null;
}

function windowArgs(desk, url, profile) {
  const args = ['--app=' + url];
  if (desk.windowSize) args.push('--window-size=' + desk.windowSize);
  if (desk.separateProfile && profile) {
    args.push('--user-data-dir=' + profile);
    args.push('--no-first-run');
    args.push('--no-default-browser-check');
  }
  return args;
}

/* --- Nói chuyện với máy chủ ----------------------------------------- */

// Trả về { ok, listening, json }. "ok" nghĩa là ĐÚNG DevTrace đang trả lời,
// chứ không phải một chương trình nào khác tình cờ giữ cổng này.
function probe(desk, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const req = http.get({
      host: desk.host,
      port: desk.port,
      path: '/api/status',
      timeout: timeoutMs || 1200
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 400000) { try { req.destroy(); } catch (e) { /* thôi */ } }
      });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (e) { json = null; }
        const mine = res.statusCode === 200 && !!json && json.app === 'devtrace';
        done({ ok: mine, listening: true, statusCode: res.statusCode, json: json });
      });
    });
    req.on('timeout', () => {
      try { req.destroy(); } catch (e) { /* thôi */ }
      done({ ok: false, listening: true, reason: 'timeout' });
    });
    req.on('error', (error) => {
      const free = error && (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET');
      done({ ok: false, listening: !free, reason: (error && error.code) || String(error) });
    });
  });
}

function waitForServer(desk, ms) {
  const deadline = Date.now() + (ms || DEFAULTS.waitMs);
  const attempt = () => probe(desk, 1500).then((result) => {
    if (result.ok || Date.now() >= deadline) return result;
    return new Promise((r) => setTimeout(r, 250)).then(attempt);
  });
  return attempt();
}

function postJson(desk, urlPath, body, timeoutMs) {
  return new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify(body || {}), 'utf8');
    const req = http.request({
      host: desk.host,
      port: desk.port,
      path: urlPath,
      method: 'POST',
      timeout: timeoutMs || 120000,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length }
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        resolve({ ok: res.statusCode === 200, statusCode: res.statusCode, json: json });
      });
    });
    req.on('timeout', () => {
      try { req.destroy(); } catch (e) { /* thôi */ }
      resolve({ ok: false, reason: 'timeout' });
    });
    req.on('error', (error) => resolve({ ok: false, reason: (error && error.code) || String(error) }));
    req.end(payload);
  });
}

/* --- Bật máy chủ và mở cửa sổ --------------------------------------- */

// Máy chủ chạy tách hẳn khỏi tiến trình này: đóng cửa sổ khởi động cũng
// không làm nó tắt. Nhật ký của nó ghi vào data/server.log.
function startServer(config, desk, spawn) {
  const dataDir = (config && config.dataDir) || path.join(ROOT, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const logFile = path.join(dataDir, 'server.log');
  const fd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [SERVER_FILE], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
    env: Object.assign({}, process.env, { PORT: String(desk.port), DEVTRACE_LAUNCHED: '1' })
  });
  child.unref();
  return { pid: child.pid, logFile: logFile };
}

function openWindow(config, desk, url, spawn) {
  const browser = findBrowser(process.env);
  if (browser && browser.appMode) {
    const child = spawn(browser.exe, windowArgs(desk, url, profileDir(config)), {
      detached: true, windowsHide: true, stdio: 'ignore'
    });
    child.unref();
    return { opened: true, browser: browser.name, app: true };
  }
  if (browser) {
    const child = spawn(browser.exe, [url], { detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
    return { opened: true, browser: browser.name, app: false };
  }
  // Không nhận ra trình duyệt nào: để Windows tự mở bằng trình duyệt mặc định.
  const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
  return { opened: true, browser: 'trình duyệt mặc định', app: false };
}

/* --- Đầu mối -------------------------------------------------------- */

// Thông báo lỗi ghi bằng UTF-16 kèm BOM để DevTrace.vbs (Scripting.FileSystemObject)
// đọc được tiếng Việt mà không cần thư viện ngoài.
function report(text) {
  try { fs.writeFileSync(OUT_FILE, '\uFEFF' + text, 'utf16le'); } catch (e) { /* thôi */ }
}

function clearReport() {
  try { fs.writeFileSync(OUT_FILE, '', 'utf8'); } catch (e) { /* thôi */ }
}

async function run(options) {
  const opts = options || {};
  const spawn = opts.spawn || childProcess.spawn;
  const config = opts.config || require('../app/config').load();
  const desk = desktopConfig(config);
  const url = baseUrl(desk);

  const before = await probe(desk, 1200);
  let started = null;

  if (before.ok) {
    // DevTrace đang chạy sẵn: chỉ việc mở cửa sổ.
  } else if (before.listening) {
    throw new Error(
      'Cổng ' + desk.port + ' đang bị một chương trình khác chiếm.\n' +
      'DevTrace không mở, vì không chắc cổng đó là của mình.\n\n' +
      'Cách xử lý: mở devtrace.config.json, đổi "desktop": { "port": 5180 },\n' +
      'hoặc tắt chương trình đang giữ cổng ' + desk.port + '.'
    );
  } else {
    started = startServer(config, desk, spawn);
    const ready = await waitForServer(desk, desk.waitMs);
    if (!ready.ok) {
      throw new Error(
        'Máy chủ không lên trong ' + Math.round(desk.waitMs / 1000) + ' giây.\n' +
        'Xem nhật ký ở: ' + started.logFile + '\n\n' +
        'Thường gặp: Node.js quá cũ (cần 22 trở lên), hoặc lần chạy trước chưa tắt hẳn.'
      );
    }
  }

  let opened = { opened: false };
  if (desk.openBrowser) opened = openWindow(config, desk, url, spawn);

  // Thu thập ở hậu trường. Cửa sổ đã mở rồi nên huynh không phải ngồi chờ.
  if (desk.collectOnLaunch) {
    try { await postJson(desk, '/api/collect', {}, 180000); } catch (e) { /* không sao */ }
  }

  return { url: url, startedServer: !!started, pid: started ? started.pid : null, opened: opened };
}

function main() {
  clearReport();
  return run().then(() => {
    process.stdout.write('DevTrace đã mở.\n');
  }).catch((error) => {
    const message = String((error && error.message) || error);
    report(message);
    process.stderr.write(message + '\n');
    process.exitCode = 1;
  });
}

if (require.main === module) main();

module.exports = {
  ROOT: ROOT,
  OUT_FILE: OUT_FILE,
  DEFAULTS: DEFAULTS,
  desktopConfig: desktopConfig,
  baseUrl: baseUrl,
  profileDir: profileDir,
  browserCandidates: browserCandidates,
  findBrowser: findBrowser,
  windowArgs: windowArgs,
  probe: probe,
  waitForServer: waitForServer,
  postJson: postJson,
  startServer: startServer,
  openWindow: openWindow,
  run: run
};
