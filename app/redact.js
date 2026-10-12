'use strict';

/* =====================================================================
   app/redact.js — Che bí mật trước khi dữ liệu RỜI khỏi máy.

   VÌ SAO CHỈ CHE LÚC ĐI RA, KHÔNG CHE LÚC LƯU
   -------------------------------------------
   Kho bằng chứng là của huynh. Che ngay từ lúc thu thập nghĩa là huynh
   không bao giờ đọc lại được chính lệnh mình đã gõ — mất dữ liệu, và mất
   âm thầm, đúng cái sai DevTrace vừa mất công sửa ở chỗ khác. Nên ở đây
   KHÔNG đụng tới data/events/*.jsonl, không đụng tới màn hình.

   Chỗ duy nhất cần che là chỗ dữ liệu đi ra khỏi máy:
     - gói bằng chứng gửi cho AI (app/ai.js), và
     - bản xuất chia sẻ (/api/export?redact=1).

   VÌ SAO CẦN
   ----------
   Một lệnh như `export OPENAI_API_KEY=sk-...` nằm nguyên trong lịch sử
   terminal. Một dòng lỗi dán vào phiên chat nằm nguyên trong lời nhắc gửi
   Codex. Cả hai đều trở thành bằng chứng hợp lệ của DevTrace, và cả hai đều
   được gửi thẳng cho nhà cung cấp AI nếu không có gì chặn ở giữa.

   Đây là lưới an toàn, không phải bảo đảm: nó bắt những khuôn mẫu đã biết.
   Một bí mật viết theo cách lạ thì lọt. Nói thẳng như vậy để không ai yên
   tâm sai chỗ.
   ===================================================================== */

// Dấu thay thế. Giữ ngắn và ASCII để không phá cú pháp của lệnh đã bị che.
const MARK = '[đã che]';

/* Thứ tự có ý nghĩa: khối khoá riêng (nhiều dòng) phải đi trước, nếu không
   luật JWT hay luật gán biến sẽ cắn vào giữa khối và để lại mảnh vụn. */
const RULES = [
  {
    name: 'private-key', label: 'khoá riêng',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: MARK
  },
  {
    name: 'bearer', label: 'Bearer token',
    re: /\bBearer\s+[A-Za-z0-9._~+/-]{13,}=*/g,
    replace: 'Bearer ' + MARK
  },
  {
    name: 'openai', label: 'khoá OpenAI',
    re: /\bsk-[A-Za-z0-9_-]{20,}/g, replace: MARK
  },
  {
    name: 'anthropic', label: 'khoá Anthropic',
    re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, replace: MARK
  },
  {
    name: 'github', label: 'mã GitHub',
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/g, replace: MARK
  },
  {
    name: 'aws', label: 'mã AWS',
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: MARK
  },
  {
    name: 'slack', label: 'mã Slack',
    re: /\bxox[abpros]-[A-Za-z0-9-]{10,}/g, replace: MARK
  },
  {
    name: 'google', label: 'khoá Google',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: MARK
  },
  {
    name: 'npm', label: 'mã npm',
    re: /\bnpm_[A-Za-z0-9]{36}\b/g, replace: MARK
  },
  {
    name: 'jwt', label: 'JWT',
    re: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, replace: MARK
  },
  {
    // https://user:matkhau@host — mật khẩu nằm ngay trong địa chỉ.
    name: 'url-password', label: 'mật khẩu trong địa chỉ',
    re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+):[^\s/@]+@/gi,
    replace: '$1:' + MARK + '@'
  },
  {
    // ?token=... &api_key=... — bí mật nằm trong tham số truy vấn.
    name: 'url-param', label: 'tham số bí mật trong địa chỉ',
    re: /([?&](?:token|access_token|refresh_token|api[_-]?key|apikey|secret|password|passwd|pwd|sig|signature|auth)=)[^&\s"'<>]+/gi,
    replace: '$1' + MARK
  },
  {
    /* MYSQL_PWD=..., DB_PWD=..., APP_PASS=... — mật khẩu viết tắt, trong tên
       không có chữ PASSWORD nào cho luật dưới bắt được. MySQL dùng đúng biến
       MYSQL_PWD, và `set MYSQL_PWD=...` nằm nguyên trong lịch sử terminal.

       Đòi phải có tiền tố kèm dấu gạch dưới. `PWD` trần là biến thư mục hiện
       hành của shell — `PWD=/d/dev` mà bị che thì dấu vết hỏng đi mà chẳng
       giấu được gì. Cùng lý do với `_PASS`: `BYPASS=x` không có gạch dưới nên
       không dính. */
    name: 'pwd-assignment', label: 'giá trị của biến mật khẩu viết tắt',
    re: /(["']?)\b([A-Za-z0-9]+_(?:PWD|PASS))\1(\s*[:=]\s*)(["']?)([^\s"',;]{4,})\4/gi,
    replace: '$1$2$1$3$4' + MARK + '$4'
  },
  {
    /* TOKEN=..., api_key: "...", PASSWORD='...' — giữ lại tên biến để còn
       hiểu ngữ cảnh, chỉ che giá trị. Đòi giá trị dài từ 6 ký tự để không
       cắn vào những chỗ vô hại như `secret = null`.

       Hai nhóm nháy (trước tên biến và trước giá trị) là để bắt được cả
       dạng JSON, nơi tên khoá nằm trong nháy kép:
           "password": "..."     chứ không phải     password: ...
       */
    name: 'assignment', label: 'giá trị của biến bí mật',
    re: /(["']?)\b([A-Za-z0-9_.]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|CREDENTIALS?)[A-Za-z0-9_.]*)\1(\s*[:=]\s*)(["']?)([^\s"',;]{6,})\4/gi,
    replace: '$1$2$1$3$4' + MARK + '$4'
  }
];

// Thay $1, $2… bằng nhóm bắt được, giống String.replace nhưng gọi được tay.
function applyTemplate(template, args) {
  return template.replace(/\$(\d)/g, (whole, index) => {
    const value = args[Number(index)];
    return value === undefined ? whole : value;
  });
}

/* Che một chuỗi. Trả về cả văn bản đã che lẫn danh sách chỗ đã cắn, để chỗ
   gọi nói được với huynh rằng đã che cái gì — im lặng sửa dữ liệu của người
   khác là chuyện không nên làm, kể cả khi sửa để tốt hơn. */
function redactText(value, options) {
  const opts = options || {};
  let text = value == null ? '' : String(value);
  if (opts.on === false || !text) return { text: text, hits: [] };

  const hits = [];
  for (const rule of RULES) {
    // Mỗi luật dùng lại một regex có cờ g, nên lastIndex phải về 0 mỗi lượt.
    rule.re.lastIndex = 0;
    let count = 0;
    text = text.replace(rule.re, (match, ...rest) => {
      count += 1;
      // rest = các nhóm bắt được, rồi tới vị trí và cả chuỗi — applyTemplate
      // chỉ chạm tới những chỉ số $n mà luật thật sự dùng.
      return typeof rule.replace === 'function'
        ? rule.replace(match)
        : applyTemplate(rule.replace, [match].concat(rest));
    });
    if (count) hits.push({ rule: rule.name, label: rule.label, count: count });
  }
  return { text: text, hits: hits };
}

/* Duyệt sâu một giá trị bất kỳ và che mọi chuỗi trong đó. Không sửa giá trị
   gốc — trả về bản mới. Khoá của đối tượng giữ nguyên: khoá là cấu trúc, giá
   trị mới là chỗ bí mật nằm. */
function redactValue(value, options) {
  const opts = options || {};
  if (opts.on === false) return { value: value, hits: [] };

  const hits = new Map();
  const merge = (list) => {
    for (const hit of list) {
      const seen = hits.get(hit.rule);
      if (seen) seen.count += hit.count;
      else hits.set(hit.rule, { rule: hit.rule, label: hit.label, count: hit.count });
    }
  };

  const walk = (node) => {
    if (typeof node === 'string') {
      const out = redactText(node, opts);
      merge(out.hits);
      return out.text;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out = {};
      for (const key of Object.keys(node)) out[key] = walk(node[key]);
      return out;
    }
    return node;
  };

  return { value: walk(value), hits: Array.from(hits.values()) };
}

// Câu tóm tắt cho người đọc: "đã che 3 chỗ (2 khoá OpenAI, 1 Bearer token)".
function summarize(hits) {
  const list = hits || [];
  if (!list.length) return '';
  const total = list.reduce((sum, hit) => sum + hit.count, 0);
  return 'đã che ' + total + ' chỗ (' +
    list.map((hit) => hit.count + ' ' + hit.label).join(', ') + ')';
}

/* Đọc công tắc từ cấu hình. Mặc định BẬT: đây là lưới an toàn, và một lưới
   an toàn mặc định tắt thì gần như chắc chắn không bao giờ được bật. */
function optionsFrom(config) {
  const privacy = (config && config.privacy) || {};
  return { on: privacy.redactSecrets !== false };
}

module.exports = { redactText, redactValue, summarize, optionsFrom, RULES, MARK };
