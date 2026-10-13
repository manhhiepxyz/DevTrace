'use strict';

/* =====================================================================
   app/config.js — Cấu hình của DevTrace.

   Toàn bộ tuỳ chọn nằm trong một tệp JSON ở gốc dự án để huynh sửa tay
   cũng được. Tệp thiếu thì tự sinh; tệp cũ thiếu khoá thì tự bù mặc định.
   ===================================================================== */

const path = require('path');
const U = require('./util');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'devtrace.config.json');

function defaults() {
  return {
    version: 1,
    dayStartHour: 4,
    dataDir: './data',
    sources: {
      codex: { enabled: true, root: '~/.codex/sessions', maxFiles: 600 },
      git: {
        enabled: true,
        repos: [ROOT],
        /* Chỉ tính commit của chính huynh. Để trống thì DevTrace tự đọc
           `git config --global user.name` / `user.email`. Cần thiết vì phần
           lớn kho trên máy là bản sao của người khác: không lọc thì bảng
           "đã tạo ra kết quả gì" đầy việc của người ta, chứ không phải của
           huynh — và đó là kiểu sai khiến người đọc kết luận nhầm về chính
           mình. Khớp theo tên HOẶC theo thư điện tử, không phân biệt hoa
           thường. */
        authors: [],
        autoDiscover: { enabled: false, roots: [], maxDepth: 3, maxRepos: 40 },
        /* Sức khoẻ kho (app/repohealth.js) tốn khoảng sáu lệnh git MỖI KHO,
           nên quét cả danh sách là việc phải chọn chứ không phải mặc định.
           Máy này đang khai vài chục kho; 20 là mức còn quét xong trong vài
           giây. Phần bỏ qua được nói thẳng ra chứ không im lặng cắt bớt. */
        healthMaxRepos: 20,
        /* Quét nội dung tệp để tìm bí mật: đắt, và báo nhầm trên tệp thử.
           Mặc định tắt, và khi bật thì kết quả luôn được ghi là "DẤU HIỆU",
           không phải kết luận. */
        secretScan: false
      },
      files: {
        enabled: true,
        dirs: [ROOT],
        maxDepth: 4,
        ignore: ['(^|/)(node_modules|dist|build|target|out|\\.git|__pycache__|\\.venv|venv|data)/', '\\.(log|tmp|lock)$']
      },
      browser: { enabled: true, browsers: ['chrome', 'edge'], keepDays: 30 },
      shell: { enabled: true, maxCommands: 4000 },
      vscode: { enabled: true },
      /* Nguồn DUY NHẤT gửi dữ liệu ra khỏi máy trong lúc thu thập, nên mặc
         định tắt: bật nó là việc huynh phải tự chọn. `tokenEnv` giữ TÊN của
         biến môi trường chứa khoá, không bao giờ giữ giá trị — cấu hình còn
         đi ra ngoài qua /api/config và hai đường xuất dữ liệu. */
      github: {
        enabled: false,
        user: '',
        tokenEnv: 'DEVTRACE_GITHUB_TOKEN',
        apiBase: 'https://api.github.com',
        maxItems: 100,
        note: 'Đọc pull request, issue, review, sao — những thứ git trên máy không thấy.'
      }
    },
    projects: [],
    /* Dự án huynh tự khai (thêm từ một thư mục, đặt tên tuỳ ý). Tách khỏi
       `projects` là có lý do cơ học: `projects` là kết quả ĐÃ TÍNH, còn cái
       này là ý muốn của huynh, và `deriveProjects` chỉ chạy khi cái này
       rỗng. Gộp hai thứ vào một khoá thì hôm nào bộ dò kho tự thêm một mục,
       nó lẫn vào danh sách huynh tự khai, và lần lưu sau sẽ ghi luôn cả
       những mục huynh chưa từng nhập. */
    declaredProjects: [],
    /* Độ dài một đợt làm việc (sprint), tính bằng NGÀY chứ không phải tuần:
       cấu hình đợt 7 ngày là chuyện có thật, mà 7 ngày thì không diễn tả
       được bằng số tuần. */
    sprint: { lengthDays: 14 },
    /* Hộp thư. MẶC ĐỊNH TẮT: đây là chỗ đầu tiên DevTrace cần mật khẩu của
       người khác, và dữ liệu nó đọc là thư của NGƯỜI KHÁC viết — thứ nhạy
       cảm nhất trên máy. Bật là việc huynh phải tự chọn.

       `passwordEnv` giữ TÊN biến môi trường, không bao giờ giữ mật khẩu:
       cấu hình còn đi ra ngoài qua /api/config và qua hai đường xuất dữ
       liệu. Cùng nguyên tắc với `github.tokenEnv` ở trên.

       Chỉ hỗ trợ TLS ngầm ở cổng 993, không có STARTTLS — xem app/mail.js. */
    mail: {
      enabled: false,
      host: '',
      port: 993,
      user: '',
      passwordEnv: 'DEVTRACE_MAIL_PASSWORD',
      folder: 'INBOX',
      sentFolder: 'Sent',
      unansweredHours: 24,
      maxMessages: 200,
      note: 'Chỉ dùng được với hộp thư cho phép mật khẩu ứng dụng (Gmail, Outlook). Tài khoản chỉ cho OAuth thì không dùng được.'
    },
    // Mục "desktop" chỉ có tác dụng khi mở DevTrace như một ứng dụng để bàn
    // (xem desktop/launch.js). Chạy bằng node server.js thì không đụng tới.
    desktop: {
      port: 5173,
      openBrowser: true,
      separateProfile: true,
      collectOnLaunch: true,
      windowSize: '1360,900',
      waitMs: 25000
    },
    ai: {
      provider: 'none',
      baseUrl: '',
      model: '',
      apiKeyEnv: 'DEVTRACE_API_KEY',
      language: 'vi'
    },
    /* Che bí mật trước khi dữ liệu rời khỏi máy — xem app/redact.js.
       KHÔNG đụng tới kho bằng chứng: huynh luôn đọc được nguyên bản của
       chính mình. Mặc định bật, vì một lưới an toàn mặc định tắt thì gần
       như chắc chắn không bao giờ được bật. */
    privacy: { redactSecrets: true },
    /* Hạn lưu trữ bằng chứng. MẶC ĐỊNH TẮT — xem app/collect/index.js để
       biết vì sao: tự động xoá dữ liệu của huynh là việc huynh phải nói rõ
       mình muốn, không phải việc chương trình tự quyết. */
    retention: { enabled: false, days: 365, keepJournals: true }
  };
}

// Gộp nông theo khoá: đủ cho cấu hình dạng này và dễ đoán.
function merge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const key of Object.keys(override)) {
    const value = override[key];
    if (value && typeof value === 'object' && !Array.isArray(value)
        && base && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = merge(base[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function load() {
  const raw = U.readJson(CONFIG_FILE, null);
  const config = merge(defaults(), raw || {});
  // Lần chạy đầu chưa có tệp thì ghi ra để huynh mở sửa tay được.
  if (raw === null) { try { save(config); } catch (e) { /* không ghi được thì thôi */ } }
  config.root = ROOT;
  config.file = CONFIG_FILE;

  // Quy đổi mọi đường dẫn về tuyệt đối ngay khi nạp.
  config.dataDir = U.expandPath(config.dataDir === './data' ? path.join(ROOT, 'data') : config.dataDir);
  config.sources.codex.root = U.expandPath(config.sources.codex.root);
  config.sources.git.repos = (config.sources.git.repos || []).map(U.expandPath);
  config.sources.files.dirs = (config.sources.files.dirs || []).map(U.expandPath);
  config.sources.git.autoDiscover.roots = (config.sources.git.autoDiscover.roots || []).map(U.expandPath);

  /* Dự án huynh tự khai thắng; không khai gì thì suy ra như cũ.

     Đây là chỗ duy nhất quyết định `config.projects` là gì, nên đổi tên dự
     án chỉ cần sửa `declaredProjects[i].name` — và vì sự kiện lưu dự án dưới
     dạng ĐƯỜNG DẪN, còn `R.projectLabel` mới đổi đường dẫn thành tên lúc
     đọc, nên toàn bộ bằng chứng cũ hiện ngay dưới tên mới. Viết lại
     `data/events/` để đổi một cái nhãn là đúng thứ dự án này cấm. */
  config.projects = projectsFrom(config);
  return config;
}

/* Chỗ DUY NHẤT quyết định `config.projects` là gì. Hàm thuần, tách ra để
   kiểm được mà không phải động vào tệp cấu hình thật. */
function projectsFrom(config) {
  const declared = normalizeDeclared(config.declaredProjects);
  config.declaredProjects = declared;
  // Có khai thì khai thắng. Không khai gì thì suy ra như cũ, nên người dùng
  // cũ không thấy gì đổi.
  if (declared.length) return declared.map((p) => Object.assign({ declared: true }, p));
  return deriveProjects(config);
}

/* Chuẩn hoá danh sách dự án huynh tự khai: điền `id`, `name`, `kind` còn
   thiếu và quy đường dẫn về tuyệt đối.

   Trả về danh sách ĐÃ chuẩn hoá và gán ngược vào `config.declaredProjects`,
   để tệp cấu hình lưu xuống là bản tự mô tả đầy đủ — giao diện cần `id` để
   đổi tên và xoá, mà id sinh lại mỗi lần nạp thì không trỏ vào đâu được.

   Bỏ qua mục méo thay vì ném lỗi: một dòng hỏng trong tệp cấu hình không
   được phép làm cả DevTrace không mở lên được. */
function normalizeDeclared(list) {
  const seen = new Set();
  const out = [];
  for (const raw of (Array.isArray(list) ? list : [])) {
    if (!raw || typeof raw !== 'object') continue;
    const dir = U.expandPath(String(raw.path || '').trim());
    if (!dir) continue;
    const key = U.norm(dir);
    if (seen.has(key)) continue; // cùng một thư mục khai hai lần: chỉ tính một
    seen.add(key);
    const kind = raw.kind === 'folder' || raw.kind === 'git' ? raw.kind
      : (U.isDir(path.join(dir, '.git')) ? 'git' : 'folder');
    out.push({
      id: String(raw.id || '').trim() || U.hash(key).slice(0, 8),
      name: String(raw.name || '').trim() || path.basename(dir) || dir,
      path: dir,
      kind
    });
  }
  return out;
}

function save(config) {
  const clean = JSON.parse(JSON.stringify(config));
  delete clean.root;
  delete clean.file;
  /* `projects` là kết quả ĐÃ TÍNH, không phải ý muốn của huynh — `load()`
     luôn dựng lại nó từ `declaredProjects` hoặc từ danh sách nguồn. Ghi nó
     xuống tệp là để lại một mảng tên dự án mà chương trình không đọc tới,
     và người mở tệp ra sửa sẽ tưởng sửa được. Một nguồn sự thật, không hai. */
  delete clean.projects;
  U.writeJson(CONFIG_FILE, clean);
  return clean;
}

// Khi huynh chưa khai báo dự án nào: lấy mỗi thư mục git/thư mục theo dõi làm một dự án.
function deriveProjects(config) {
  const seen = new Map();
  const add = (dir, kind) => {
    const key = U.norm(dir);
    if (seen.has(key)) return;
    seen.set(key, {
      id: U.hash(key).slice(0, 8),
      name: path.basename(dir) || dir,
      path: dir,
      kind
    });
  };
  config.sources.git.repos.forEach((r) => add(r, 'git'));
  config.sources.files.dirs.forEach((d) => add(d, 'folder'));
  return Array.from(seen.values());
}

// Tìm dự án chứa một đường dẫn bất kỳ (khớp dài nhất thắng).
function projectFor(config, somePath) {
  if (!somePath) return null;
  const target = U.norm(somePath);
  let best = null;
  for (const project of config.projects) {
    const base = U.norm(project.path);
    if (target === base || target.startsWith(base + '/')) {
      if (!best || base.length > U.norm(best.path).length) best = project;
    }
  }
  return best;
}

module.exports = {
  ROOT, CONFIG_FILE, defaults, load, save, merge, projectFor, deriveProjects,
  normalizeDeclared, projectsFrom
};
