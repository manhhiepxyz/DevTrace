/* =====================================================================
   server.js — Máy chủ tĩnh tối giản, không cần cài thư viện nào.
   Chạy:  node server.js     rồi mở  http://localhost:5173
   Mục đích: phục vụ qua http:// để localStorage có origin ổn định.
   ===================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
};

/* Danh sách trắng theo đường dẫn: chỉ những tệp thuộc giao diện web mới được
   phục vụ. Nhờ vậy server.js, README.md, thư mục tools/ hay bất kỳ bản sao lưu
   .json nào nằm trong thư mục dự án cũng không bị tải qua trình duyệt.
   Muốn phục vụ thêm thư mục mới (ví dụ assets/), hãy thêm một dòng vào đây. */
const ALLOW = [
  /^\/index\.html$/,
  /^\/styles\.css$/,
  /^\/(?:js|assets|img)\/[A-Za-z0-9._/-]+\.(?:js|css|svg|png|jpg|jpeg|webp|woff2)$/
];

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(String(req.url).split('?')[0]);
  } catch (e) {
    send(res, 400, 'text/plain; charset=utf-8', '400 — Đường dẫn không hợp lệ.');
    return;
  }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const filePath = path.resolve(ROOT, '.' + urlPath);

  // Chặn mọi nỗ lực đi ra ngoài thư mục dự án (../, %2e%2e, ...).
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    send(res, 403, 'text/plain; charset=utf-8', '403 — Không được phép truy cập ngoài thư mục dự án.');
    return;
  }

  if (!ALLOW.some((rule) => rule.test(urlPath))) {
    send(res, 404, 'text/plain; charset=utf-8', '404 — Không tìm thấy: ' + urlPath);
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, 'text/plain; charset=utf-8', '404 — Không tìm thấy: ' + urlPath);
      return;
    }
    const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    send(res, 200, type, data);
  });
});

server.listen(PORT, () => {
  console.log('Tu Luyện Ký đang chạy tại:  http://localhost:' + PORT);
  console.log('Nhấn Ctrl + C để dừng.');
});
