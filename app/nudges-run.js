'use strict';

/* =====================================================================
   app/nudges-run.js — Đọc lời nhắc, chạy trong TIẾN TRÌNH RIÊNG.

   Cùng lý do và cùng lối với app/collect-run.js: phần quét kho mã của
   `Nudges.compute` là 80 tiến trình git chạy ĐỒNG BỘ (20 kho × 4 lệnh).
   Gọi thẳng trong hàm xử lý yêu cầu thì mỗi lần ứng dụng để bàn hỏi "có gì
   mới không" là máy chủ đứng hình chừng ấy — đúng cái lỗi đã đo được ở
   đường thu thập, khi một `GET /api/status` vài mili giây bị trả lời sau
   15,2 giây.

   HAI ĐIỀU TỆP NÀY KHÔNG LÀM:

   1. Không quyết định gì. Nó nhận tham số, chạy `Nudges.compute` y như mọi
      chỗ gọi khác, rồi in ra đúng MỘT đối tượng JSON.

   2. Không in gì khác ra stdout. Một dòng lọt vào stdout ngoài đối tượng
      JSON cuối cùng là tiến trình cha đọc hỏng kết quả — và nó sẽ báo "dữ
      liệu không đọc được" mà không ai hiểu vì sao.
   ===================================================================== */

const C = require('./config');
const Nudges = require('./nudges');

function fail(message) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(message) }));
  return 1;
}

/* Trả về mã thoát. Gán vào `process.exitCode` chứ KHÔNG gọi `process.exit()`:
   thoát ngay có thể cắt ngang dòng JSON cuối cùng đang chờ được ghi ra. */
function main(argv) {
  const args = argv || process.argv;
  let options = {};
  const raw = args[2];
  if (raw) {
    try {
      options = JSON.parse(raw) || {};
    } catch (error) {
      return fail('Tham số không đọc được: ' + String((error && error.message) || error));
    }
  }

  try {
    const result = Nudges.compute(C.load(), {
      /* Phần quét kho là phần đắt nhất, nên MẶC ĐỊNH KHÔNG QUÉT — chỗ gọi
         phải nói rõ `{ "repos": true }`. Một việc tốn tám chục tiến trình
         git mà tự chạy khi không ai xin thì đúng là thứ sẽ bị gỡ đi sau
         vài tuần vì "sao máy chậm thế". */
      repos: options.repos === true
    });
    process.stdout.write(JSON.stringify({
      ok: true,
      day: result.day,
      now: result.now,
      nudges: result.nudges,
      notes: result.notes
    }));
    return 0;
  } catch (error) {
    return fail((error && error.message) || error);
  }
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { main };
