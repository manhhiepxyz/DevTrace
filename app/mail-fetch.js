'use strict';

/* =====================================================================
   app/mail-fetch.js — Một phiên IMAP, chạy trong tiến trình riêng.

   ĐÂY LÀ TỆP DUY NHẤT TRONG app/ ĐƯỢC PHÉP `require('tls')`. Bộ kiểm thử soi
   thẳng mã nguồn để giữ đúng điều đó: mọi thứ cần mạng phải nằm gọn ở đây,
   còn app/mail.js phải chạy được ngoại tuyến, không mở kết nối nào.

   Vì sao tiến trình riêng: cả đường ống thu thập của DevTrace là ĐỒNG BỘ,
   còn IMAP thì không. Node không có cách nào chờ mạng một cách đồng bộ. Cùng
   lý do và cùng lối với app/collect/github-fetch.js.

   MẬT KHẨU KHÔNG BAO GIỜ ĐI QUA DÒNG LỆNH. Tệp này nhận TÊN biến môi trường
   rồi tự đọc `process.env` — dòng lệnh thì tiến trình khác đọc được, biến
   môi trường thì không. Cùng nguyên tắc với `github.tokenEnv`.

   CHỈ TLS NGẦM Ở CỔNG 993, KHÔNG STARTTLS. Một nâng cấp giao thức viết tay
   là chỗ để mắc lỗi âm thầm, và lỗi ở đúng chỗ đó nghĩa là mật khẩu đi ra
   ngoài mà không được mã hoá. Máy chủ không cho TLS ngầm thì DevTrace nói
   thẳng là không dùng được, thay vì thử một đường vòng kém chắc hơn.

   BA CHỖ CỐ TÌNH ĐƠN GIẢN HOÁ, và giá phải trả của từng chỗ:

   1. Đọc header thô bằng `BODY.PEEK[HEADER.FIELDS …]`, KHÔNG dùng ENVELOPE.
      ENVELOPE là danh sách lồng nhau có chuỗi trích dẫn và NIL — đúng chỗ
      các khách IMAP tự viết hay vỡ. Header RFC-822 thì parse như `Tên: giá
      trị` với dòng nối tiếp, dễ và chắc hơn hẳn. PEEK để không đánh dấu thư
      là đã đọc: mở DevTrace lên không được phép làm hỏng hộp thư của huynh.

   2. Chỉ giải mã chuỗi mã hoá RFC 2047 khi bảng mã là UTF-8. Bảng mã khác
      thì trả về nguyên chuỗi thô `=?…?=` và ghi một dòng ghi chú — đoán bừa
      sẽ cho ra chữ rác trông như một tiêu đề thư thật.

   3. Không có IDLE. Đây là hỏi-lúc-thu-thập, không phải thông báo đẩy.

   Tệp này chỉ in ra stdout MỘT đối tượng JSON. Nó không ghi đĩa, không sửa
   gì, không quyết định gì.
   ===================================================================== */

const tls = require('tls');

const CONNECT_TIMEOUT_MS = 20000;
const SESSION_TIMEOUT_MS = 90000;
/* Mặc định 30 ngày: đủ để thấy việc còn tồn, mà không kéo về cả hộp thư.
   Con số này KHÔNG nằm trong cấu hình — nó là chi tiết của khách IMAP, không
   phải một lựa chọn của huynh, và mỗi khoá cấu hình thêm vào là một khoá
   phải giải thích trong Cài đặt. */
const SEARCH_DAYS = 30;

/* --- Đọc giá trị header ---------------------------------------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* Ngày cho `SINCE` của IMAP: `dd-Mon-yyyy`, tháng viết tắt TIẾNG ANH.
   Dùng ngày cục bộ của máy: IMAP hiểu `SINCE` theo ngày của máy chủ, và máy
   này là máy duy nhất DevTrace chạy trên. Lệch một ngày ở rìa cửa sổ 30 ngày
   là sai số chấp nhận được, và nó lệch về phía lấy THỪA chứ không phải thiếu. */
function imapDate(ms) {
  const d = new Date(ms);
  return String(d.getDate()).padStart(2, '0') + '-' + MONTHS[d.getMonth()] + '-' + d.getFullYear();
}

/* Chuỗi trích dẫn của IMAP. Từ chối thẳng những ký tự không nhét vừa: gửi
   một lệnh vỡ vì tài khoản có dấu nháy là gửi một lệnh khác với ý muốn, và
   ở đây lệnh đó mang theo mật khẩu. */
function quote(value) {
  const text = String(value == null ? '' : value);
  if (/["\\\r\n]/.test(text)) throw new Error('giá trị chứa ký tự không hợp lệ cho IMAP: ' + JSON.stringify(text.slice(0, 40)));
  return '"' + text + '"';
}

/* Gỡ dòng nối tiếp (dòng bắt đầu bằng space/tab thuộc về header trên nó)
   rồi đọc từng dòng `Tên: giá trị`. Giữ dòng ĐẦU khi một header xuất hiện
   nhiều lần — `Received` và `References` là hai thứ hay bị lặp. */
function parseHeader(raw) {
  const out = {};
  const unfolded = String(raw || '').replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    const name = line.slice(0, at).trim().toLowerCase();
    if (!name || out[name] !== undefined) continue;
    out[name] = line.slice(at + 1).trim();
  }
  return out;
}

function decodeWords(value) {
  return String(value == null ? '' : value).replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset, enc, data) => {
    const cs = String(charset).toUpperCase().replace(/[^A-Z0-9]/g, '');
    /* Chỉ UTF-8. Bảng mã khác thì để nguyên chuỗi thô — trả về chữ rác còn tệ
       hơn trả về thứ còn nhìn ra là chưa giải mã được. */
    if (cs !== 'UTF8') return whole;
    try {
      if (enc.toUpperCase() === 'B') return Buffer.from(data, 'base64').toString('utf8');
      const bytes = [];
      for (let i = 0; i < data.length; i++) {
        if (data[i] === '_') { bytes.push(32); continue; }
        if (data[i] === '=' && i + 2 < data.length + 1) {
          const hex = data.slice(i + 1, i + 3);
          if (/^[0-9A-Fa-f]{2}$/.test(hex)) { bytes.push(parseInt(hex, 16)); i += 2; continue; }
        }
        bytes.push(data.charCodeAt(i));
      }
      return Buffer.from(bytes).toString('utf8');
    } catch (error) { return whole; }
  });
}

/* `<abc@def>` → `abc@def`. Trả về mảng vì `References` chứa NHIỀU id, và bỏ
   sót một cái trong đó nghĩa là coi một thư đã trả lời là chưa trả lời. */
function idsOf(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return [];
  const found = text.match(/<[^<>]+>/g);
  if (found && found.length) return found.map((s) => s.slice(1, -1).trim().toLowerCase()).filter(Boolean);
  return [text.toLowerCase()];
}

function addressOf(raw) {
  const text = decodeWords(String(raw == null ? '' : raw).trim());
  const angle = /<([^>]*)>/.exec(text);
  if (angle) {
    const name = text.slice(0, angle.index).replace(/^"|"$/g, '').trim();
    return { name: name || angle[1], address: angle[1] };
  }
  return { name: text, address: text };
}

function dateOf(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return null;
  const ms = Date.parse(text);
  return isFinite(ms) ? ms : null;
}

/* --- Kết nối --------------------------------------------------------- */

function connect(settings) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: settings.host,
      port: settings.port,
      servername: settings.host,
      rejectUnauthorized: true
    });
    /* Giải mã latin1 chứ không utf8: mọi ký tự thành đúng MỘT byte, nên đếm
       ký tự là đếm byte — và IMAP đếm literal bằng BYTE. Giải mã utf8 thì một
       tiêu đề tiếng Việt làm lệch độ dài, và bộ đọc lấy thiếu hoặc thừa dữ
       liệu rồi lệch luôn từ đó về sau. */
    socket.setEncoding('latin1');

    let buf = '';
    let ended = false;
    let failure = null;
    let wake = null;

    const bump = () => { if (wake) { const w = wake; wake = null; w(); } };
    const wait = () => new Promise((res) => {
      if (buf.length || ended) return res();
      wake = res;
    });

    socket.on('data', (chunk) => { buf += chunk; bump(); });
    socket.on('error', (error) => { failure = error; ended = true; bump(); });
    socket.on('end', () => { ended = true; bump(); });
    socket.on('close', () => { ended = true; bump(); });

    const connectTimer = setTimeout(() => {
      failure = new Error('hết thời gian chờ kết nối sau ' + (CONNECT_TIMEOUT_MS / 1000) + ' giây');
      socket.destroy();
      bump();
    }, CONNECT_TIMEOUT_MS);

    socket.once('secureConnect', () => {
      clearTimeout(connectTimer);
      resolve({ socket, readLine, readBytes, run, close });
    });

    socket.once('error', (error) => {
      clearTimeout(connectTimer);
      reject(error);
    });

    async function readLine() {
      for (;;) {
        const at = buf.indexOf('\r\n');
        if (at !== -1) { const line = buf.slice(0, at); buf = buf.slice(at + 2); return line; }
        if (ended) throw failure || new Error('máy chủ đóng kết nối');
        await wait();
      }
    }

    async function readBytes(n) {
      for (;;) {
        if (buf.length >= n) { const out = buf.slice(0, n); buf = buf.slice(n); return out; }
        if (ended) throw failure || new Error('máy chủ đóng kết nối giữa chừng');
        await wait();
      }
    }

    /* Đọc MỘT phản hồi. Một phản hồi có thể gồm nhiều dòng, và dòng kết thúc
       bằng `{N}` nghĩa là N byte DỮ LIỆU THÔ đi ngay sau — dữ liệu đó có thể
       chứa CRLF và cả dấu `)`, nên không được đọc nó như dòng. Chỗ này là
       chỗ dễ vỡ nhất của một khách IMAP, nên nó chỉ nằm đúng một lần, ở đây. */
    async function readResponse(literals) {
      let text = '';
      for (;;) {
        const line = await readLine();
        const marker = /\{(\d+)\}$/.exec(line);
        if (!marker) return text + line;
        text += line.slice(0, marker.index);
        const data = await readBytes(Number(marker[1]));
        literals.push(data);
        /* Chỗ giữ chỗ để ghép dữ liệu thô lại sau. Không nhét thẳng dữ liệu
           vào đây: nó có thể chứa `)`, và mọi phép tách chuỗi phía sau sẽ
           hiểu sai ranh giới phản hồi. */
        text += '\u0000' + (literals.length - 1) + '\u0000';
      }
    }

    /* Gửi một lệnh, đọc tới khi gặp dòng mang thẻ của chính nó.
       `pendingLiteral` là dữ liệu thô gửi sau khi máy chủ trả lời `+` —
       dùng cho mật khẩu, vì mật khẩu có thể chứa ký tự làm vỡ chuỗi trích dẫn. */
    async function run(tag, text, pendingLiteral) {
      const literals = [];
      const chunks = [];
      socket.write(tag + ' ' + text + '\r\n');
      let pending = pendingLiteral == null ? null : String(pendingLiteral);
      for (;;) {
        const res = await readResponse(literals);
        chunks.push(res);
        if (pending !== null && res.charAt(0) === '+') {
          socket.write(Buffer.from(pending, 'utf8'));
          socket.write('\r\n');
          pending = null;
          continue;
        }
        if (res.indexOf(tag + ' ') === 0) {
          return { ok: /^\S+ OK/i.test(res), text: chunks.join('\n'), reply: res, literals };
        }
      }
    }

    function close() {
      try { socket.end(); } catch (error) { /* đã đóng rồi thì thôi */ }
      try { socket.destroy(); } catch (error) { /* thôi */ }
    }
  });
}

/* --- Đọc một thư mục -------------------------------------------------- */

function parseFetches(text, literals) {
  const out = [];
  const marks = [];
  const re = /\*\s+\d+\s+FETCH\s+\(/g;
  let m;
  while ((m = re.exec(text))) marks.push(m.index + m[0].length);
  for (let i = 0; i < marks.length; i++) {
    const limit = i + 1 < marks.length ? marks[i + 1] : text.length;
    const close = text.lastIndexOf(')', limit);
    const body = text.slice(marks[i], close === -1 ? limit : close);
    const uid = Number((/UID\s+(\d+)/.exec(body) || [])[1]);
    if (!uid) continue;
    const flags = ((/FLAGS\s+\(([^)]*)\)/.exec(body) || [])[1] || '');
    const holder = /\u0000(\d+)\u0000/.exec(body);
    const header = holder ? parseHeader(literals[Number(holder[1])] || '') : {};
    out.push({ uid, flags, header });
  }
  return out;
}

async function fetchMailbox(conn, tag, folder, settings, notes) {
  const selected = await conn.run(tag, 'SELECT ' + quote(folder));
  if (!selected.ok) {
    return {
      messages: [],
      error: 'Không mở được thư mục “' + folder + '”: ' + (selected.reply || '').slice(0, 200)
        + '. Kiểm lại tên thư mục trong Cài đặt — tên phải đúng như máy chủ đặt (Gmail dùng “INBOX” '
        + 'và “[Gmail]/Đã gửi”, và tên có dấu có thể phải viết ở dạng khác).'
    };
  }

  const since = imapDate(Date.now() - SEARCH_DAYS * 86400000);
  const search = await conn.run(tag + '1', 'UID SEARCH SINCE ' + since);
  if (!search.ok) return { messages: [], error: 'Máy chủ từ chối tìm kiếm: ' + (search.reply || '').slice(0, 160) };

  const line = (/\*\s+SEARCH([^\n]*)/.exec(search.text) || [])[1] || '';
  const uids = line.trim().split(/\s+/).map(Number).filter((n) => n > 0);
  if (!uids.length) return { messages: [] };

  /* Lấy những uid CUỐI: `SEARCH` trả về theo thứ tự tăng dần, nên cắt đuôi
     là giữ thư mới nhất. Cắt đầu thì giữ đúng những thư cũ nhất — thứ không
     ai muốn khi giới hạn số lượng. */
  const chosen = uids.slice(Math.max(0, uids.length - settings.maxMessages));
  if (chosen.length < uids.length) {
    notes.push('Thư mục “' + folder + '”: chỉ đọc ' + chosen.length + '/' + uids.length
      + ' thư trong ' + SEARCH_DAYS + ' ngày gần nhất (giới hạn mail.maxMessages).');
  }

  const fetched = await conn.run(tag + '2',
    'UID FETCH ' + chosen.join(',')
    + ' (UID FLAGS BODY.PEEK[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO REFERENCES SUBJECT FROM DATE)])');
  if (!fetched.ok) return { messages: [], error: 'Không đọc được thư: ' + (fetched.reply || '').slice(0, 160) };

  const messages = [];
  for (const item of parseFetches(fetched.text, fetched.literals)) {
    const h = item.header;
    const from = addressOf(h.from);
    messages.push({
      uid: item.uid,
      messageId: (idsOf(h['message-id'])[0] || null),
      /* `References` chứa cả chuỗi tổ tiên, nên nó là nguồn tốt hơn
         `In-Reply-To` để biết một thư nằm trong mạch nào. Giữ cả hai. */
      inReplyTo: idsOf(h['in-reply-to']),
      references: idsOf(h.references),
      subject: decodeWords(h.subject) || '(không có tiêu đề)',
      from: from.name,
      fromAddress: from.address,
      dateMs: dateOf(h.date),
      seen: item.flags.indexOf('\\Seen') !== -1,
      answered: item.flags.indexOf('\\Answered') !== -1
    });
  }
  return { messages };
}

/* --- Cổng vào --------------------------------------------------------- */

async function main() {
  const settings = JSON.parse(process.argv[2] || '{}');
  const notes = [];
  const password = process.env[settings.passwordEnv] || '';
  if (!password) {
    return { ok: false, error: 'Chưa có mật khẩu trong biến môi trường “' + settings.passwordEnv
      + '”. Đặt nó rồi mở lại DevTrace — DevTrace không bao giờ lưu mật khẩu vào tệp cấu hình.' };
  }
  if (!settings.host) return { ok: false, error: 'Chưa điền máy chủ IMAP.' };
  if (!settings.user) return { ok: false, error: 'Chưa điền tài khoản.' };

  let conn;
  try {
    conn = await connect(settings);
  } catch (error) {
    return {
      ok: false,
      error: 'Không mở được kết nối TLS tới ' + settings.host + ':' + settings.port + ' — '
        + String((error && error.message) || error)
        + '. DevTrace chỉ dùng TLS ngầm ở cổng 993; máy chủ chỉ cho STARTTLS thì không dùng được.'
    };
  }

  try {
    const greeting = await conn.run('A1', 'CAPABILITY');
    if (!greeting.ok) {
      return { ok: false, error: 'Máy chủ không chào bằng CAPABILITY: ' + (greeting.reply || '').slice(0, 160) };
    }

    /* Mật khẩu đi bằng literal, không bằng chuỗi trích dẫn: nó là thứ duy
       nhất ở đây có thể chứa ký tự làm vỡ cú pháp, và một cú vỡ ở đây nghĩa
       là gửi đi một lệnh khác với ý muốn. */
    const login = await conn.run('A2', 'LOGIN ' + quote(settings.user) + ' {' + Buffer.byteLength(password, 'utf8') + '}', password);
    if (!login.ok) {
      return { ok: false, error: 'Đăng nhập bị từ chối: ' + (login.reply || '').slice(0, 200)
        + '. Gmail và Outlook chỉ cho mật khẩu ứng dụng riêng, không nhận mật khẩu tài khoản chính.' };
    }

    const inbox = await fetchMailbox(conn, 'A3', settings.folder, settings, notes);
    if (inbox.error) return { ok: false, error: inbox.error };

    let sent = { messages: [] };
    if (settings.sentFolder) {
      sent = await fetchMailbox(conn, 'A4', settings.sentFolder, settings, notes);
      /* Thư mục Đã gửi không mở được thì KHÔNG phải lỗi chặn: vẫn còn cách
         đọc hộp thư nhận, và tín hiệu "chưa mở" vẫn dùng được. Chỉ nói ra
         rằng tín hiệu chính đang thiếu. */
      if (sent.error) {
        notes.push('Không đọc được thư mục đã gửi nên chưa đối chiếu được thư nào đã được trả lời. ' + sent.error);
        sent = { messages: [] };
      }
    }

    await conn.run('A5', 'LOGOUT');
    return {
      ok: true,
      folder: settings.folder,
      sentFolder: settings.sentFolder || null,
      days: SEARCH_DAYS,
      messages: inbox.messages,
      sent: sent.messages,
      notes
    };
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) };
  } finally {
    if (conn) conn.close();
  }
}

const deadline = setTimeout(() => {
  process.stdout.write(JSON.stringify({ ok: false, error: 'Hết thời gian chờ sau ' + (SESSION_TIMEOUT_MS / 1000) + ' giây.' }));
  process.exit(0);
}, SESSION_TIMEOUT_MS);

main().then((result) => {
  clearTimeout(deadline);
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}).catch((error) => {
  clearTimeout(deadline);
  process.stdout.write(JSON.stringify({ ok: false, error: String((error && error.message) || error) }));
  process.exit(0);
});
