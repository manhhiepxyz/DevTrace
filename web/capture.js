'use strict';

/* =====================================================================
   web/capture.js — cửa sổ GHI NHANH (Ctrl + Alt + N).

   Cả tệp này chỉ làm một việc: gửi câu huynh vừa gõ vào
   /api/plans/inbox. Nó không đọc gì, không vẽ gì, không giữ trạng thái
   nào ngoài nội dung ô nhập.

   Ba điều nó phải giữ, và vì sao:

   1. KHÔNG BAO GIỜ xoá chữ huynh gõ khi chưa ghi được. Ghi hỏng thì câu
      đó nằm nguyên trong ô kèm lời giải thích. Một cửa sổ ghi nhanh nuốt
      mất câu huynh vừa nghĩ ra là thứ tệ hơn hẳn việc nó không tồn tại —
      huynh mất chữ mà không biết mình mất, vì cửa sổ đã đóng.

   2. Ghi xong thì ĐÓNG. Đây không phải một màn hình, nó là một cử chỉ.
      Ở lại chờ bấm thêm một nút thì lần sau huynh phải đóng nó bằng tay,
      và phím tắt mất hết ý nghĩa.

   3. Mở lại thì câu cũ được CHỌN SẴN, không bị xoá. Gõ tiếp là thay ngay,
      mà lỡ tay đóng ngang thì câu cũ vẫn còn nguyên.

   Trang này do chính máy chủ DevTrace phục vụ (capture.html), nên nó cùng
   nguồn gốc với ứng dụng: gửi thẳng vào API được, và không phải mở CORS
   cho máy chủ chỉ vì một ô nhập.
   ===================================================================== */

(function () {
  var form = document.getElementById('captureForm');
  var input = document.getElementById('captureText');
  var msg = document.getElementById('captureMsg');
  if (!form || !input || !msg) return;

  var busy = false;

  function say(text, bad) {
    msg.textContent = text || '';
    msg.className = bad ? 'capture-msg capture-bad' : 'capture-msg';
  }

  /* Trong ứng dụng Desktop, window.close() đi qua chốt chặn của
     desktop/main.js và chỉ THU cửa sổ xuống — giữ lại để lần bấm phím tắt
     sau hiện ra tức thì. Mở trang này bằng trình duyệt thường thì không có
     chốt đó, và với thẻ do người dùng tự mở thì trình duyệt bỏ qua
     window.close(). Lúc đó phải nói ra, đừng để huynh ngồi chờ một cái thẻ
     không chịu đóng.

     Dòng nhắc này không bao giờ chạy tới khi cửa sổ đã đóng thật: đóng rồi
     thì cả trang đi theo, hẹn giờ cũng biến mất. */
  function tryClose(fallback) {
    window.close();
    setTimeout(function () { say(fallback); }, 250);
  }

  /* Chọn sẵn chữ cũ. Gọi ở đây chứ không phải lúc trang tải xong: cửa sổ
     được giữ lại và chỉ hiện khi bấm phím tắt, nên "vừa hiện ra" mới đúng
     là lúc cần đặt con trỏ. */
  function arm() {
    busy = false;
    input.disabled = false;
    say('');
    input.focus();
    input.select();
  }

  window.addEventListener('focus', arm);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) arm();
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy) return;

    var text = input.value.replace(/\s+/g, ' ').trim();
    if (!text) {
      say('Chưa gõ gì để ghi.', true);
      input.focus();
      return;
    }

    busy = true;
    input.disabled = true;
    say('Đang ghi…');

    fetch('/api/plans/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', text: text, source: 'hotkey' })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (out) {
        return { ok: res.ok, out: out || {} };
      });
    }).then(function (r) {
      if (!r.ok || !r.out.ok) throw new Error(r.out.error || 'Máy chủ không nhận.');
      input.value = '';
      say('Đã ghi vào hộp thư đến.');
      tryClose('Đã ghi. Đóng thẻ này được rồi.');
    }).catch(function (error) {
      /* Câu vừa gõ Ở LẠI nguyên trong ô. Đây là dòng quan trọng nhất của cả
         tệp này. */
      busy = false;
      input.disabled = false;
      say('Chưa ghi được: ' + String((error && error.message) || error), true);
      input.focus();
      input.select();
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    // Đóng ngang thì KHÔNG xoá gì: lần sau mở lại câu này vẫn còn.
    tryClose('Bấm dấu X của thẻ để đóng.');
  });
})();
