'use strict';

/* =====================================================================
   desktop/stop.js — Tắt máy chủ DevTrace.

   Máy chủ chạy nền nên huynh không thấy nó trong danh sách cửa sổ. Tệp
   này tìm đúng tiến trình đó để tắt:

     1. Đọc data/server.pid — nhưng đọc để THAM KHẢO, không phải để tin.
     2. Hỏi netstat xem ai đang giữ cổng, và hỏi thẳng cổng đó xem nó là ai.
     3. Chỉ tắt khi tiến trình qua được mọi cửa canh — thà báo không tắt
        được còn hơn tắt nhầm phần mềm của huynh.

   Chạy:  node desktop/stop.js   (hoặc nhấp đúp desktop/stop-devtrace.cmd)
   ===================================================================== */

const fs = require('fs');
const http = require('http');
const path = require('path');
const childProcess = require('child_process');

const C = require('../app/config');
const pidFileFor = require('../server').pidFileFor;

function defaultPort() {
  return Number(process.env.PORT) || 5173;
}

function targetPort(config) {
  const desk = (config && config.desktop) || {};
  return Number(desk.port) || defaultPort();
}

function readPidFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// process.kill(pid, 0) không gửi tín hiệu nào, chỉ hỏi "còn sống không".
function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

function defaultRun(cmd, args, callback) {
  childProcess.execFile(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 20000 },
    (error, stdout) => callback(error, stdout));
}

// Ai đang giữ cổng? Trả về số pid hoặc null.
function portOwner(port, run) {
  return new Promise((resolve) => {
    const exec = run || defaultRun;
    exec('netstat', ['-ano', '-p', 'TCP'], (error, stdout) => {
      if (error || !stdout) return resolve(null);
      for (const line of String(stdout).split(/\r?\n/)) {
        if (line.indexOf('LISTENING') === -1) continue;
        if (line.indexOf(':' + port + ' ') === -1) continue;
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (pid) return resolve(pid);
      }
      resolve(null);
    });
  });
}

// Tên tiến trình, để chắc chắn đó là node chứ không phải phần mềm khác.
function processName(pid, run) {
  return new Promise((resolve) => {
    const exec = run || defaultRun;
    exec('tasklist', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], (error, stdout) => {
      if (error || !stdout) return resolve(null);
      const first = String(stdout).split(/\r?\n/)[0] || '';
      if (first.trim().charAt(0) !== '"') return resolve(null);
      const name = first.split('","')[0].replace(/^"|"$/g, '').trim();
      resolve(name || null);
    });
  });
}

/* Cổng đang trả lời thì tự nó khai được nó là ai: /api/status trả về
   app: 'devtrace'. Đây là bằng chứng mạnh hơn tên tiến trình — tên chỉ nói
   "có ai đó là node", còn lời khai nói đúng "đây là DevTrace".

   Trả về 'devtrace' | 'other' | 'unknown'. 'unknown' nghĩa là không hỏi được
   (không phải HTTP, hoặc không trả lời) — KHÔNG phải bằng chứng buộc tội, nên
   chỗ gọi vẫn phải dựa vào những cửa canh khác. */
function claimsDevTrace(port, host) {
  return new Promise((resolve) => {
    const req = http.get({ host: host, port: port, path: '/api/status', timeout: 1200 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (body.length < 8192) body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body).app === 'devtrace' ? 'devtrace' : 'other'); }
        catch (error) { resolve('unknown'); }
      });
    });
    req.on('timeout', () => { try { req.destroy(); } catch (e) { /* thôi */ } resolve('unknown'); });
    req.on('error', () => resolve('unknown'));
  });
}

/* So hai đường dẫn có phải cùng một chỗ không. Windows không phân biệt hoa
   thường, và dấu \ ở cuối thì vô nghĩa. */
function samePath(a, b) {
  if (!a || !b) return false;
  const norm = (value) => path.resolve(String(value)).replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/* ---------------------------------------------------------------------
   Tệp pid có đáng tin không.

   Nó do chính DevTrace ghi ra, nhưng ghi ra rồi thì nó chỉ còn là dữ liệu
   trên đĩa: có thể của bản chạy khác, có thể cũ, và — chuyện nguy hiểm nhất
   — số pid sau khi tiến trình chết thì Windows đem cấp cho tiến trình khác.
   Bản trước tin tệp pid vô điều kiện, chỉ kiểm tra tên tiến trình khi pid
   đến từ netstat, với lý do "pid trong tệp là do DevTrace tự ghi". Lý do đó
   chỉ đúng vào lúc ghi. Sau đó thì không.

   Ba cửa, theo thứ tự rẻ tới đắt:
     1. Tệp có ghi cho DỰ ÁN NÀY không? (khác dự án thì đó là chuyện của
        người khác, không đụng vào)
     2. Tiến trình còn sống không?
     3. Nó có thật sự đang giữ cổng mình định tắt không? Nếu cổng đang do
        pid khác giữ thì con số trong tệp đã trỏ nhầm người.
   --------------------------------------------------------------------- */
function trustedPid(record, config, owner) {
  if (!record || !(Number(record.pid) > 0)) return { pid: 0, why: 'no-file' };
  const claimed = Number(record.pid);
  if (record.root && !samePath(record.root, config.root)) {
    return { pid: 0, why: 'wrong-root', detail: String(record.root) };
  }
  if (!isAlive(claimed)) return { pid: 0, why: 'dead' };
  if (owner && owner !== claimed) return { pid: 0, why: 'not-port-owner', detail: String(owner) };
  return { pid: claimed, why: 'ok' };
}

function trustNote(trust, record, port) {
  if (trust.why === 'wrong-root') {
    return 'Bỏ qua tệp pid: nó ghi cho dự án khác (' + trust.detail + ').';
  }
  if (trust.why === 'not-port-owner') {
    return 'Bỏ qua tệp pid: nó ghi pid ' + record.pid + ', nhưng cổng ' + port + ' do pid ' + trust.detail + ' giữ.';
  }
  return null;
}

/* --- Chờ cổng thật sự rả ------------------------------------------------- */

function portFree(port, host) {
  return new Promise((resolve) => {
    const req = http.get({ host: host, port: port, path: '/api/status', timeout: 900 }, (res) => {
      res.resume();
      resolve(false);
    });
    req.on('timeout', () => {
      try { req.destroy(); } catch (e) { /* thôi */ }
      resolve(false);
    });
    req.on('error', (error) => resolve(!!(error && error.code === 'ECONNREFUSED')));
  });
}

function waitPortFree(port, host, ms) {
  const deadline = Date.now() + ms;
  const attempt = () => portFree(port, host).then((free) => {
    if (free || Date.now() >= deadline) return free;
    return new Promise((r) => setTimeout(r, 300)).then(attempt);
  });
  return attempt();
}

/* --- Tắt ------------------------------------------------------------- */

async function stop(options) {
  const opts = options || {};
  const config = opts.config || C.load();
  const host = '127.0.0.1';
  const file = pidFileFor(config);
  const record = readPidFile(file);

  /* Cổng thật của máy chủ đang chạy là cổng trong tệp pid — nó ghi lúc máy
     chủ mở cổng. Nếu huynh đổi cổng trong cấu hình SAU đó thì cấu hình đã
     lệch khỏi thực tế, và tệp mới là chỗ đáng tin. */
  const filePort = record && Number(record.port) > 0 ? Number(record.port) : 0;
  const port = opts.port || filePort || targetPort(config);

  const owner = await portOwner(port, opts.run);
  const trust = trustedPid(record, config, owner);
  let pid = trust.pid;
  const fromFile = pid > 0;
  const note = trustNote(trust, record || {}, port);

  if (!pid) {
    if (!owner) {
      /* Không có pid dùng được, cũng không ai giữ cổng. Tệp pid còn nằm đó
         nhưng nó trỏ vào hư không — nói rõ chuyện đó thay vì im lặng, để
         huynh không phải đoán vì sao có tệp mà bảo là "không chạy". */
      return {
        stopped: false,
        reason: trust.why === 'no-file' ? 'not-running' : 'stale-pid-file',
        port: port, pidFile: file, why: trust.why, note: note,
        pid: record && Number(record.pid) > 0 ? Number(record.pid) : 0
      };
    }
    pid = owner;
  }

  /* Hai cửa canh cuối, áp cho MỌI pid — kể cả pid đọc từ tệp. Tệp pid chỉ
     chứng minh được điều nó ghi lúc được ghi; còn tiến trình đang mang số đó
     ngay bây giờ thì phải hỏi chính nó. */
  const name = await processName(pid, opts.run);
  if (name && !/^node(\.exe)?$/i.test(name)) {
    return { stopped: false, reason: 'not-ours', port: port, pid: pid, process: name, why: 'process-name', note: note };
  }

  // Cổng đang có người trả lời, và người đó khai mình KHÔNG phải DevTrace.
  // Tin lời khai hơn tin số pid. Chỉ hỏi khi chính pid sắp tắt đang giữ cổng,
  // vì lời khai đó là về kẻ giữ cổng chứ không phải về số pid nói chung.
  if (owner === pid) {
    const claim = await (opts.claim || claimsDevTrace)(port, host);
    if (claim === 'other') {
      return { stopped: false, reason: 'not-ours', port: port, pid: pid, process: name, why: 'foreign-server', note: note };
    }
  }

  /* Hai khe cắm dưới đây chỉ để bộ kiểm thử chạy được TOÀN BỘ đường đi của
     hàm này mà không tắt tiến trình thật và không ngồi chờ cổng. Không có
     chúng thì phép thử duy nhất chạm tới được là phép thử đường từ chối —
     đúng những đường ít nguy hiểm nhất. */
  const kill = opts.kill || ((target) => process.kill(target));
  try {
    kill(pid);
  } catch (error) {
    return { stopped: false, reason: 'failed', port: port, pid: pid, note: note, error: String((error && error.message) || error) };
  }

  const freed = await (opts.waitFree || waitPortFree)(port, host, 8000);
  // Chỉ xoá tệp pid khi đúng nó là tệp đã dẫn mình tới pid này. Xoá bừa thì
  // có ngày xoá mất dấu của một máy chủ khác vừa khởi động xong.
  if (fromFile && record && Number(record.pid) === pid) {
    try { fs.unlinkSync(file); } catch (e) { /* thôi */ }
  }
  return { stopped: true, port: port, pid: pid, freed: freed, note: note };
}

/* --- Lối vào dòng lệnh ----------------------------------------------- */

function describe(result) {
  if (result.stopped) {
    return 'Đã tắt DevTrace (pid ' + result.pid + ').' +
      (result.freed ? ' Cổng ' + result.port + ' đã rảnh.' : ' Cổng ' + result.port + ' chưa rảnh hẳn, thử lại sau vài giây.') +
      (result.note ? '\n' + result.note : '');
  }
  if (result.reason === 'not-running') {
    return 'DevTrace không chạy (không thấy tệp pid, cũng không ai giữ cổng ' + result.port + ').';
  }
  if (result.reason === 'stale-pid-file') {
    const why = {
      'wrong-root': 'tệp ghi cho một dự án khác',
      'not-port-owner': 'tệp ghi pid ' + (result.pid || '?') + ', nhưng cổng đang do pid khác giữ',
      'dead': 'tiến trình trong tệp đã chết'
    }[result.why] || 'không dùng được';
    return 'DevTrace không chạy trên cổng ' + result.port + ' (' + why + ').\n' +
      'Tệp pid cũ: ' + result.pidFile + ' — xoá được, lần chạy sau sẽ ghi lại.';
  }
  if (result.reason === 'not-ours') {
    const because = result.why === 'foreign-server'
      ? 'Cổng ' + result.port + ' có trả lời nhưng tự khai không phải DevTrace.'
      : 'Cổng ' + result.port + ' do "' + result.process + '" (pid ' + result.pid + ') giữ, không phải node.';
    return because + '\n' +
      'Không tắt, để tránh đụng vào phần mềm khác của huynh.' +
      (result.note ? '\n' + result.note : '');
  }
  return 'Không tắt được (pid ' + result.pid + '): ' + (result.error || 'không rõ lý do');
}

function main() {
  return stop().then((result) => {
    process.stdout.write(describe(result) + '\n');
    return result.stopped || result.reason === 'not-running' ? 0 : 1;
  }).catch((error) => {
    process.stdout.write('Lỗi khi tắt: ' + String((error && error.message) || error) + '\n');
    return 1;
  });
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}

module.exports = {
  stop: stop, describe: describe, portOwner: portOwner, processName: processName,
  claimsDevTrace: claimsDevTrace, trustedPid: trustedPid, trustNote: trustNote, main: main
};
