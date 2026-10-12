'use strict';

/* =====================================================================
   app/collect/github-fetch.js — Một lần gọi mạng, chạy trong tiến trình riêng.

   Vì sao lại là một tệp riêng chạy bằng `node` con: cả đường ống thu thập của
   DevTrace là ĐỒNG BỘ (Collect.run trả về thẳng bản tổng kết, không phải một
   Promise). Node không có fetch đồng bộ. Đổi cả đường ống sang bất đồng bộ chỉ
   để phục vụ một nguồn mặc định tắt là cái giá quá đắt, và đụng vào đúng chỗ
   đang giữ chốt chặn "không bao giờ xoá nhầm bằng chứng".

   Nên chỗ duy nhất cần mạng được tách hẳn ra đây, và chạy bằng một tiến trình
   Node con — cùng cách app/collect/git.js gọi `git`. Khoá đọc từ biến môi
   trường được TRUYỀN TÊN, không bao giờ truyền giá trị qua dòng lệnh: dòng
   lệnh thì tiến trình khác đọc được, còn biến môi trường thì không.

   Tệp này chỉ in ra stdout một đối tượng JSON { status, body }. Nó không ghi
   đĩa, không sửa gì, không quyết định gì.
   ===================================================================== */

const url = process.argv[2];
const tokenEnv = process.argv[3] || '';
const token = tokenEnv ? process.env[tokenEnv] : '';

function reply(payload) {
  process.stdout.write(JSON.stringify(payload));
}

if (!url) {
  reply({ status: 0, body: 'thiếu địa chỉ cần gọi' });
} else {
  const headers = {
    // GitHub từ chối yêu cầu không có User-Agent.
    'User-Agent': 'DevTrace',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (token) headers.Authorization = 'Bearer ' + token;

  const timer = setTimeout(() => {
    reply({ status: 0, body: 'hết thời gian chờ sau 20 giây' });
    process.exit(0);
  }, 20000);

  fetch(url, { headers })
    .then((response) => response.text().then((text) => ({ status: response.status, text })))
    .then((r) => {
      clearTimeout(timer);
      // Nói rõ khi bị chặn vì hạn mức: đây là lỗi hay gặp nhất và nó không
      // phải lỗi của huynh, nên đừng để huynh ngồi đoán. Ghi vào trường
      // riêng chứ không nhét vào `body` — body là JSON thô còn phải parse.
      const note = r.status === 403 || r.status === 429
        ? 'GitHub đang chặn vì hạn mức (HTTP ' + r.status + ') — chờ chút rồi thử lại, hoặc dùng khoá có quyền đọc.'
        : null;
      reply({ status: r.status, body: r.text.slice(0, 400000), note });
    })
    .catch((error) => {
      clearTimeout(timer);
      reply({ status: 0, body: String((error && error.message) || error) });
    });
}
