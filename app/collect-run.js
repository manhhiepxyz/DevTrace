'use strict';

/* =====================================================================
   app/collect-run.js — Một lượt thu thập, chạy trong TIẾN TRÌNH RIÊNG.

   VÌ SAO LẠI PHẢI TÁCH RA. Cả đường ống thu thập là đồng bộ: mỗi kho git
   tốn bốn lệnh `execFileSync`, và với hai chục kho thì một lượt thu thập
   chiếm hơn mười lăm giây. Node chỉ có một luồng, nên chừng ấy giây máy
   chủ KHÔNG trả lời nổi một yêu cầu nào — kể cả một `GET /api/status` vài
   mili giây. Đo trên máy này trước khi sửa: hỏi lúc +250ms, trả lời lúc
   +15453ms.

   Đó là toàn bộ lý do mở DevTrace lên là màn hình trắng: trang đã tải
   xong, nhưng mọi lời gọi dữ liệu của nó nằm xếp hàng sau lượt thu thập.
   Đẩy lượt thu thập sang tiến trình riêng thì máy chủ rảnh ngay, còn việc
   thu thập vẫn chạy y nguyên — cùng một `Collect.run`, cùng một kho, không
   thêm luồng nào trong tiến trình máy chủ.

   Cùng lý do và cùng lối với app/collect/github-fetch.js và
   app/mail-fetch.js: chỗ nào đồng bộ mà phải chạy lâu thì đẩy ra tiến
   trình con.

   HAI ĐIỀU TỆP NÀY KHÔNG LÀM:

   1. Không quyết định gì. Nó nhận tham số, chạy, rồi in ra đúng MỘT đối
      tượng JSON. Nó không tự chọn nguồn, không tự đọc cấu hình từ chỗ nào
      khác ngoài `C.load()` như mọi tiến trình khác của DevTrace.

   2. Không in gì khác ra stdout. Một dòng lọt vào stdout ngoài đối tượng
      JSON cuối cùng là tiến trình cha đọc hỏng kết quả — và nó sẽ báo
      "dữ liệu không đọc được" mà không ai hiểu vì sao.
   ===================================================================== */

const C = require('./config');
const Collect = require('./collect');

function fail(message) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(message) }));
  return 1;
}

/* Trả về mã thoát. Gán vào `process.exitCode` chứ KHÔNG gọi `process.exit()`:
   thoát ngay có thể cắt ngang dòng JSON cuối cùng đang chờ được ghi ra, và
   tiến trình cha nhận được một chuỗi cụt. */
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
    const summary = Collect.run(C.load(), {
      /* Mảng rỗng nghĩa là "mọi nguồn" — cùng quy ước với `Collect.run` và
         với `POST /api/collect`. */
      sources: Array.isArray(options.sources) && options.sources.length ? options.sources : undefined,
      rebuild: options.rebuild === true
    });
    process.stdout.write(JSON.stringify({ ok: true, summary: summary }));
    return 0;
  } catch (error) {
    return fail((error && error.message) || error);
  }
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { main };
