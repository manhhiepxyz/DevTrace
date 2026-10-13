'use strict';

/* =====================================================================
   app/collect/git-scan.js — quét nhiều kho mã CÙNG LÚC.

   Vì sao có tệp này: `app/collect/git.js` chạy bốn lệnh git cho mỗi kho,
   lần lượt. Đo trên máy này với 53 kho: **12,2 giây**, tức 75% của cả một
   lượt thu thập. Nhưng bốn lệnh của kho này chẳng liên quan gì tới bốn
   lệnh của kho kia — chờ nhau là chờ vô ích, phần lớn thời gian đó là ổ
   đĩa và git khởi động, không phải CPU.

   Song song không làm được ngay trong git.js: cả đường ống thu thập là
   ĐỒNG BỘ, và nó phải ở nguyên như thế — bộ kiểm thử và tệp lệnh gọi thẳng
   `collect()`. Nên việc quét nằm trong tiến trình riêng, cùng lối
   `app/collect-run.js`, `app/collect/github-fetch.js` và `app/mail-fetch.js`.

   Tệp này KHÔNG quyết định gì cả. Nó không lọc commit của ai, không dựng
   sự kiện, không nói kho nào "đọc hụt". Nó chỉ chạy lệnh và trả về nguyên
   chuỗi git in ra, để `git.js` xử lý y như trước — hai đường đọc cùng một
   kho mà ra hai kết quả khác nhau là thứ không được phép xảy ra.

   Hỏng thì trả `{ ok: false }`; `git.js` quay về lối tuần tự cũ. Không có
   chuyện "quét song song hỏng" biến thành "không kho nào có commit".
   ===================================================================== */

const path = require('path');
const { execFile } = require('child_process');
const U = require('../util');

/* Bốn lệnh của MỘT kho chạy lần lượt với nhau: chúng cùng đọc một ổ đĩa, và
   bốn tiến trình git cùng nhảy vào một thư mục .git chỉ làm đầu đọc qua lại.
   Song song nằm ở tầng KHO.

   Mười sáu, và con số này là ĐO ĐƯỢC chứ không phải chọn cho đẹp — trên máy
   này (12 nhân), quét 53 kho: 8 → 6,0 giây, 16 → 3,4 giây, 32 → 3,2 giây.
   Vượt 16 thì không còn đáng gì mà lại thêm ba chục tiến trình git cùng
   tranh một ổ đĩa.

   Đáng chú ý: một lệnh git trên máy này tốn **40 ms dù nó làm gì** — đo cả
   `rev-parse`, `config` lẫn `status`, đều 40 ms. Nghĩa là phần lớn 12,2 giây
   của lối tuần tự không phải thời gian ĐỌC, mà là thời gian Windows dựng
   tiến trình và git nạp thư viện. Song song đánh trúng đúng chỗ đó. */
const CONCURRENCY = 16;

const PER_COMMAND_TIMEOUT_MS = 20000;

function gitOut(repo, args) {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd: repo || undefined,
      encoding: 'utf8',
      timeout: PER_COMMAND_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      /* Không có dòng này thì 212 tiến trình git làm 212 cửa sổ đen nháy
         lên trên màn hình Windows. */
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, out: stdout || '', err: stderr || '' });
        return;
      }
      resolve({ ok: true, out: stdout || '', err: '' });
    });
  });
}

/* Một kho chưa `git init` xong, hoặc chưa commit lần nào, làm `git log` báo
   lỗi. Với git đó là lỗi; với DevTrace đó là "kho rỗng", một câu trả lời
   hoàn toàn hợp lệ. Phân biệt sai chỗ này thì một kho vừa tạo khoá cứng
   đường cập nhật của cả nguồn git — nên phép phân loại ở đây phải giống
   hệt phép phân loại trong git.js, và nó dùng chung đúng khuôn mẫu đó. */
function classifyLog(result, emptyRepoRe) {
  if (result.ok) return { logOk: true, logEmpty: !String(result.out).trim(), log: String(result.out) };
  if (emptyRepoRe.test(result.err || '')) return { logOk: true, logEmpty: true, log: '' };
  return { logOk: false, logEmpty: false, log: '' };
}

/* Đọc trọn một kho. `runGit` là khe cắm để bài kiểm thử chạy được toàn bộ
   đường này mà không cần một kho thật trên đĩa — cùng lối `opts.runGit`
   của git.js. Bỏ trống thì gọi git thật. */
async function runOne(repo, runGit, args) {
  const run = runGit || gitOut;
  if (!U.isDir(path.join(repo, '.git'))) return { repo: repo, isRepo: false };

  const a = args || require('./git');
  const branch = await run(repo, a.BRANCH_ARGS);
  const remote = await run(repo, a.REMOTE_ARGS);
  const log = await run(repo, a.logArgs());
  const status = await run(repo, a.STATUS_ARGS);
  const classified = classifyLog(log, a.EMPTY_REPO_RE);

  return {
    repo: repo,
    isRepo: true,
    /* `null` và chuỗi rỗng là hai chuyện khác nhau: `null` nghĩa là lệnh
       hỏng (kho chưa có commit nào thì `rev-parse HEAD` không trả lời được),
       chuỗi rỗng nghĩa là git trả lời rằng không có gì. Chỗ đọc phân biệt
       hai thứ này, nên đừng gộp chúng lại ở đây. */
    branch: branch.ok ? branch.out : null,
    remote: remote.ok ? remote.out : null,
    logOk: classified.logOk,
    logEmpty: classified.logEmpty,
    log: classified.log,
    statusOk: status.ok,
    status: status.ok ? status.out : null
  };
}

/* Chạy `worker` trên từng mục, tối đa `limit` việc một lúc, và GIỮ NGUYÊN
   thứ tự kết quả — thứ tự ấy là thứ tự kho trong cấu hình, và đổi nó đi
   thì danh sách ghi chú của huynh nhảy loạn giữa hai lần thu thập. */
async function inPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function pull() {
    while (next < items.length) {
      // Không có `await` giữa lúc đọc và lúc tăng, nên hai người thợ không
      // bao giờ lấy trùng một mục.
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  const workers = [];
  const count = Math.max(1, Math.min(limit, items.length));
  for (let i = 0; i < count; i++) workers.push(pull());
  await Promise.all(workers);
  return results;
}

async function main(argv) {
  const args = argv || process.argv;
  let payload;
  try {
    payload = JSON.parse(args[2]);
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'Tham số không đọc được.' }));
    return 1;
  }
  const repos = (payload && payload.repos) || [];
  if (!Array.isArray(repos)) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'Thiếu danh sách kho.' }));
    return 1;
  }
  const results = await inPool(repos, CONCURRENCY, (repo) => runOne(repo));
  process.stdout.write(JSON.stringify({ ok: true, repos: results }));
  return 0;
}

if (require.main === module) {
  /* Gán vào `process.exitCode` chứ KHÔNG gọi `process.exit()`: thoát ngay có
     thể cắt ngang dòng JSON cuối cùng đang chờ được ghi ra, và tiến trình
     cha nhận được một chuỗi cụt. */
  main(process.argv).then((code) => { process.exitCode = code; }, (error) => {
    process.stdout.write(JSON.stringify({ ok: false, error: String((error && error.message) || error) }));
    process.exitCode = 1;
  });
}

module.exports = { main, runOne, inPool, classifyLog, CONCURRENCY };
