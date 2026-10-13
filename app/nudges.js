'use strict';

/* =====================================================================
   app/nudges.js — Bốn điều đáng nói ngay, không phải mở ứng dụng ra xem.

   Vì sao tách khỏi `alerts.js`: cảnh báo ở kia là một DANH SÁCH để đọc khi
   huynh đã ngồi trước màn hình. Ở đây là chuyện ĐÁNH THỨC: một bong bóng
   hiện lên khi huynh đang làm việc khác. Tiêu chuẩn khác hẳn — danh sách
   dài không sao, nhưng bong bóng thừa một cái là huynh tắt cả tính năng đi.
   Nên mỗi loại ở đây phải trả lời được: "chuyện này có gấp tới mức đánh
   thức không?".

   Bốn loại, và tiêu chuẩn của từng loại:

     overdue   Việc đã quá hạn. Có hạn nghĩa là huynh đã tự hứa một mốc.
     slot      Buổi trong thời khoá biểu đã trôi qua mà không để lại dấu vết
               khớp. CHỈ khi ngày đó CÓ dấu vết — xem chốt chặn bên dưới.
     repo      Kho mã còn dở, hoặc có commit trên remote chưa kéo về.
     evening   Tổng kết cuối ngày, gửi một lần vào giờ huynh đặt.

   Hai điều tệp này KHÔNG làm, và đó là chủ ý:

   1. Nó không gửi gì cả. Nó chỉ NÓI RA những gì đáng nói. Việc hiện bong
      bóng là của ứng dụng để bàn, và chuyện gì đã báo rồi thì nó tự nhớ
      trong thư mục dữ liệu của Electron — không phải trong `data/`. Kho
      bằng chứng của huynh không được biết tới chuyện này.

   2. Nó không tự quyết định thời điểm. Mọi mốc thời gian đi qua `opts.now`.
      Một hàm tự gọi `Date.now()` thì không kiểm thử được, và một phép kiểm
      đổi kết quả theo lịch là phép kiểm sẽ đỏ vào một ngày nào đó rồi không
      ai hiểu vì sao.

   NGUYÊN TẮC KHÔNG ĐƯỢC VI PHẠM: `no-evidence` KHÔNG BAO GIỜ thành lời
   nhắc. Ngày mà bộ thu thập không chạy — máy tắt, nguồn bị tắt trong Cài
   đặt — thì mọi buổi đều là `no-evidence`, và biến nó thành "buổi này chưa
   làm" là nói dối về chính huynh. Xem `slotNudges`.
   ===================================================================== */

const path = require('path');
const U = require('./util');
const Plans = require('./plans');
const R = require('./correlate');
const Alerts = require('./alerts');
const RepoHealth = require('./repohealth');
const Git = require('./collect/git');

/* --- Cấu hình --------------------------------------------------------- */

const DEFAULTS = {
  enabled: true,
  pollMinutes: 5,
  repoEveryMinutes: 30,
  eveningHour: 21,
  repoRepeatMinutes: 360,
  kinds: { overdue: true, slot: true, repo: true, evening: true, plan: true }
};

function settingsOf(config) {
  const raw = (config && config.nudges) || {};
  const num = (value, fallback, lo, hi) => {
    const n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  };
  const kinds = Object.assign({}, DEFAULTS.kinds, (raw && raw.kinds) || {});
  return {
    enabled: raw.enabled !== false,
    pollMinutes: num(raw.pollMinutes, DEFAULTS.pollMinutes, 1, 1440),
    repoEveryMinutes: num(raw.repoEveryMinutes, DEFAULTS.repoEveryMinutes, 1, 1440),
    eveningHour: num(raw.eveningHour, DEFAULTS.eveningHour, 0, 23),
    repoRepeatMinutes: num(raw.repoRepeatMinutes, DEFAULTS.repoRepeatMinutes, 0, 10080),
    kinds: {
      overdue: kinds.overdue !== false,
      slot: kinds.slot !== false,
      repo: kinds.repo !== false,
      evening: kinds.evening !== false,
      /* Tắt được, nhưng tắt nó nghĩa là những lần bấm lưu của huynh cứ thế
         rơi mất mà không có gì nói ra. Cứ để nguyên. */
      plan: kinds.plan !== false
    }
  };
}

/* --- Khuôn chung ------------------------------------------------------ */

/* `repeatMs` là phần duy nhất chỗ nhận phải hiểu: quá bao lâu thì được nhắc
   LẠI về cùng một khoá. 0 nghĩa là không bao giờ — dùng cho mọi thứ đã nằm
   trong khoá của chính nó một ngày (`overdue:2026-10-13`), vì ngày mai khoá
   đã khác nên chẳng cần luật nhắc lại nào cả. */
function nudge(key, kind, level, title, body, repeatMs) {
  return { key, kind, level, title, body, repeatMs: repeatMs || 0 };
}

function listNames(items, limit) {
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;
  return shown.join(' · ') + (rest > 0 ? ' … và ' + rest + ' nữa' : '');
}

// Câu này phải đi kèm mọi con số lấy từ thời khoá biểu. Không có nó thì một
// phép so ước lượng bị đọc thành một lời buộc tội.
const ESTIMATE_NOTE = 'Đối chiếu là ước lượng từ dấu vết để lại trên máy này.';

/* --- 1. Việc quá hạn -------------------------------------------------- */

/* Gom thành MỘT lời nhắc, không mỗi việc một cái — cùng lý do `alerts.js`
   gom: năm bong bóng gần giống hệt nhau thì cái thứ năm bị tắt tiếng, và
   kèm theo đó là mọi lời nhắc khác của DevTrace. */
function overdueNudges(store, day, opts) {
  const overdue = [];
  for (const task of (store && store.tasks && store.tasks.tasks) || []) {
    if (!Alerts.isOpen(task)) continue;
    const due = Alerts.dueOf(task);
    if (due && due < day) overdue.push({ title: Alerts.titleOf(task), due });
  }
  if (!overdue.length) return [];
  overdue.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));

  const oldest = overdue[0];
  const days = Math.round((Date.parse(day + 'T00:00:00') - Date.parse(oldest.due + 'T00:00:00')) / 86400000);
  return [nudge(
    'overdue:' + day, 'overdue', overdue.length >= 3 ? 'bad' : 'warn',
    overdue.length + ' việc đã quá hạn',
    listNames(overdue.map((t) => '“' + t.title + '” (hạn ' + t.due + ')'), 3)
      + '. Cũ nhất: ' + (isFinite(days) && days > 0 ? days + ' ngày' : oldest.due) + '. '
      + 'Quá hạn không có nghĩa là phải xong ngay — nhưng nó là thứ dễ bị lọc mất nhất khi xem việc trong ngày.',
    0
  )];
}

/* --- 2. Buổi đã trôi qua mà không để lại dấu vết khớp ------------------ */

/* Đây là chỗ dễ nói dối nhất trong cả tệp, nên nói rõ ba chốt chặn:

   1. `no-evidence` bị LOẠI HẲN. Ngày mà DevTrace không đọc được dấu vết nào
      — máy tắt, nguồn bị tắt — thì mọi buổi đều mang trạng thái đó. Nhắc
      "buổi sáng 8–11:30 trôi qua không dấu vết" trong tình huống ấy là buộc
      tội huynh về một việc mà chính chương trình không nhìn thấy. Vắng dữ
      liệu không phải bằng chứng của việc không làm.

   2. Chỉ nhắc khi buổi đã kết thúc THẬT, và đã kết thúc được một lúc
      (`GRACE_MS`). Nhắc đúng lúc 11:30 khi huynh vừa làm xong lúc 11:29 —
      mà bộ thu thập chưa kịp ghi — là nhắc nhầm.

   3. Buổi chưa tới thì không có gì để nói, và `upcoming` không bao giờ lọt
      vào đây.

   Hai trạng thái còn lại mới đáng nói: `missed` (trong khung đó CÓ hoạt
   động, nhưng thuộc việc khác) và `partial` (có làm, chưa tới 80% thời
   lượng dự kiến). Cả hai đều kèm chữ "ước lượng". */
const GRACE_MS = 15 * 60 * 1000;

function slotNudges(config, day, evidence, opts) {
  const options = opts || {};
  const now = options.now == null ? Date.now() : options.now;
  const sched = Plans.schedule(config, day, evidence, { store: options.store, now });
  const out = [];

  for (const row of sched.sessions) {
    if (row.status !== 'missed' && row.status !== 'partial') continue;
    if (!row.endMs || row.endMs > now) continue;
    if (now - row.endMs < GRACE_MS) continue;

    const what = row.title + ' (' + row.start + '–' + row.end + ')';
    const where = row.projectName ? ' cho ' + row.projectName : '';
    const body = row.status === 'missed'
      ? 'Khung giờ đó CÓ hoạt động, nhưng không thuộc việc này. Không có nghĩa là huynh không làm gì — '
        + 'chỉ nghĩa là dấu vết không khớp' + where + '. ' + ESTIMATE_NOTE
      : 'Khớp ' + row.matchedMinutes + '/' + row.plannedMinutes + ' phút dự kiến. ' + ESTIMATE_NOTE;

    out.push(nudge(
      'slot:' + day + ':' + row.id, 'slot', row.status === 'missed' ? 'warn' : 'info',
      row.status === 'missed' ? 'Buổi đã trôi qua: ' + what : 'Buổi chưa đủ dấu vết: ' + what,
      body, 0
    ));
  }
  return out;
}

/* --- 3. Kho mã: còn dở, hoặc tụt lại sau remote ------------------------ */

/* Bốn lệnh cho mỗi kho và KHÔNG hơn: hai lệnh của `repoInfo`, một của cây
   làm việc, một của `@{upstream}`. `repohealth.repoSnapshot` đọc tám thứ —
   stash, nhánh cũ, thẻ, tệp lớn, bí mật — vì nó trả lời "kho này có khoẻ
   không". Ở đây chỉ hỏi "có gì cần nói ngay không", nên đọc thừa là bắt
   huynh trả giá bằng thời gian cho những câu không ai hỏi.

   Vẫn phải chạy song song: 20 kho × 4 lệnh = 80 tiến trình git. Chạy lần
   lượt trên máy này là khoảng ba giây — quá lâu cho một việc chạy nền. */
const HEALTH_COMMANDS = [Git.BRANCH_ARGS, Git.REMOTE_ARGS, Git.STATUS_ARGS, RepoHealth.UPSTREAM_ARGS];

/* Dựng lại đúng khe cắm `run` mà `RepoHealth.aheadBehind` và `Git.workingTree`
   đang nhận: nhận (kho, tham số) và trả về CHUỖI, hoặc null khi lệnh hỏng.
   `null` ở đây phải giống hệt `Git.git` thật — nó là cách duy nhất để
   `aheadBehind` phân biệt được "kho không có remote" với "đọc được, bằng 0".
   Lẫn hai thứ đó là nói mọi kho đều tụt lại sau một nhánh không tồn tại. */
function runFromScan(map, commands) {
  const keys = commands.map((args) => args.join(' '));
  return function (repo, args) {
    const rec = map && map.get ? map.get(repo) : null;
    if (!rec || rec.isRepo !== true || !Array.isArray(rec.results)) return null;
    const index = keys.indexOf(args.join(' '));
    if (index === -1) return null;
    const result = rec.results[index];
    return result && result.ok ? result.out : null;
  };
}

function repoNudges(config, opts) {
  const options = opts || {};
  const git = (config.sources && config.sources.git) || {};
  if (git.enabled === false) return { nudges: [], notes: ['Git: đang tắt'] };

  const settings = RepoHealth.settingsOf(config);
  const all = RepoHealth.repoList(config);
  const chosen = all.slice(0, settings.maxRepos);
  if (!chosen.length) return { nudges: [], notes: ['Chưa khai kho nào trong sources.git.repos.'] };

  const scan = options.scanRepos
    ? options.scanRepos(chosen, HEALTH_COMMANDS)
    : Git.scanCommands(chosen, HEALTH_COMMANDS);

  if (!scan || !scan.map) {
    return {
      nudges: [],
      notes: ['Git: không quét được kho mã (' + ((scan && scan.error) || 'không rõ lý do')
        + ') — không nhắc gì về kho lần này.']
    };
  }

  const repeat = options.repoRepeatMs == null
    ? settings.repoRepeatMinutes * 60000
    : options.repoRepeatMs;
  const run = runFromScan(scan.map, HEALTH_COMMANDS);
  const dirty = [];
  const behind = [];
  const missing = [];

  for (const repo of chosen) {
    const name = path.basename(repo);
    const info = Git.repoInfo(repo, run);
    if (!info) { missing.push(name); continue; }
    const tree = Git.workingTree(repo, run);
    if (tree && tree.total >= RepoHealth.MANY_CHANGES) dirty.push({ name, total: tree.total });
    const ab = RepoHealth.aheadBehind(run, repo);
    if (ab.upstream && ab.behind > 0) behind.push({ name, behind: ab.behind, ahead: ab.ahead });
  }

  const notes = [];
  if (missing.length) notes.push('Git: ' + missing.length + ' kho không đọc được, đã bỏ qua.');
  if (all.length > chosen.length) {
    notes.push('Git: chỉ xem ' + chosen.length + '/' + all.length + ' kho (sources.git.healthMaxRepos = '
      + settings.maxRepos + ').');
  }

  const out = [];
  if (dirty.length) {
    dirty.sort((a, b) => b.total - a.total);
    out.push(nudge(
      'repo:dirty', 'repo', 'warn',
      dirty.length === 1 ? '“' + dirty[0].name + '” còn ' + dirty[0].total + ' thay đổi chưa ghi'
        : dirty.length + ' kho còn nhiều thay đổi chưa ghi',
      listNames(dirty.map((r) => r.name + ' (' + r.total + ' tệp)'), 4)
        + '. Chưa ghi lại thì chưa có gì để quay về khi hỏng.',
      repeat
    ));
  }
  if (behind.length) {
    behind.sort((a, b) => b.behind - a.behind);
    const diverged = behind.filter((r) => r.ahead > 0);
    out.push(nudge(
      'repo:behind', 'repo', diverged.length ? 'bad' : 'warn',
      behind.length === 1 ? '“' + behind[0].name + '” có commit trên remote chưa kéo về'
        : behind.length + ' kho có commit trên remote chưa kéo về',
      listNames(behind.map((r) => r.name + ' (' + r.behind + ' chưa kéo'
        + (r.ahead > 0 ? ', ' + r.ahead + ' chưa đẩy' : '') + ')'), 4)
        + (diverged.length
          ? '. ' + diverged.length + ' kho đã TÁCH HẲN khỏi remote — kéo về sẽ phải gộp hoặc rebase, '
            + 'và để càng lâu thì càng dễ đụng nhau.'
          : '. Việc đang làm dựa trên bản cũ.'),
      repeat
    ));
  }
  return { nudges: out, notes: notes };
}

/* --- 4. Tổng kết cuối ngày -------------------------------------------- */

/* Câu chốt của lời nhắc này phải là một câu ĐỌC ĐƯỢC MỘT LẦN là hiểu, vì
   nó hiện ra lúc huynh đang làm việc khác.

   Và nó không được nói "hôm nay 0 phút" khi thật ra là "hôm nay không đọc
   được gì": một ngày chưa thu thập lần nào cũng ra 0 phút, y hệt một ngày
   ngồi chơi. Hai chuyện khác hẳn nhau, và câu chữ phải tách chúng ra. */
function eveningNudge(config, day, evidence, opts) {
  const options = opts || {};
  const now = options.now == null ? Date.now() : options.now;
  const settings = settingsOf(config);
  if (new Date(now).getHours() < settings.eveningHour) return [];

  const totals = (evidence && evidence.totals) || { events: 0, commits: 0 };
  const minutes = (evidence && evidence.minutes) || 0;

  if (!totals.events) {
    return [nudge(
      'evening:' + day, 'evening', 'info', 'Hôm nay DevTrace không đọc được dấu vết nào',
      'Chưa có sự kiện nào của hôm nay trên máy này. Có thể là bộ thu thập chưa chạy lần nào, '
        + 'cũng có thể là một ngày không đụng tới máy. Vắng dữ liệu không có nghĩa là không làm gì — '
        + 'nên đây không phải một lời phê bình, chỉ là một chỗ trống.',
      0
    )];
  }

  const sched = Plans.schedule(config, day, evidence, { store: options.store, now });
  const done = sched.counts.done;
  const counted = sched.sessions.filter((row) =>
    row.status !== 'break' && row.status !== 'off' && row.status !== 'upcoming').length;

  const parts = [minutes + ' phút có dấu vết'];
  if (totals.events) parts.push(totals.events + ' sự kiện');
  if (totals.commits) parts.push(totals.commits + ' commit');
  if (totals.aiSessions) parts.push(totals.aiSessions + ' phiên AI');
  if (counted) parts.push(done + '/' + counted + ' buổi khớp phần lớn thời lượng');

  return [nudge(
    'evening:' + day, 'evening', 'info', 'Hôm nay: ' + parts.slice(0, 3).join(' · '),
    parts.join(' · ') + '. “Phút có dấu vết” là thời gian ĐỂ LẠI DẤU VẾT trên máy này, '
      + 'không phải thời gian ngồi trước máy — nghỉ giữa hai việc hay đọc tài liệu giấy đều không hiện ra. '
      + ESTIMATE_NOTE,
    0
  )];
}

/* --- Cổng vào --------------------------------------------------------- */

/* Trả về `{ day, now, nudges, notes }`.

   Mọi thứ đi qua `opts` — `now`, `store`, `evidence`, `scanRepos` — là khe
   cắm kiểm thử, cùng lối `opts.runGit`/`opts.fetchJson` đang có trong dự án.
   Bỏ trống thì đọc thật, và đường đọc thật KHÔNG sinh tiến trình nào trừ
   khi `opts.scanRepos` cũng bỏ trống — lúc đó `Git.scanCommands` mới dựng
   một tiến trình quét.

   `opts.repos === false` tắt hẳn phần quét kho. Đây là phần đắt nhất, và
   nó là việc PHẢI CHỌN giống hệt `repohealth`: chỗ gọi quyết định có trả
   giá hay không, chứ không phải một cái hẹn giờ ẩn nào đó. */
function compute(config, opts) {
  const options = opts || {};
  const settings = settingsOf(config);
  const now = options.now == null ? Date.now() : options.now;
  const day = U.dayKey(now, (config && config.dayStartHour) || 0);

  if (!settings.enabled) {
    return { day: day, now: now, nudges: [], notes: ['Nhắc việc đang tắt.'], settings: settings };
  }

  const store = options.store || Plans.loadStore(config, options);
  /* Dựng bằng chứng MỘT LẦN rồi dùng cho cả hai phần. Đọc lại lần thứ hai
     vừa phí, vừa mở đường cho hai phần nhìn thấy hai bản dữ liệu khác nhau
     nếu có gì đó ghi vào đúng lúc. */
  const evidence = options.evidence || R.evidence(config, day, options);

  const notes = [];
  let out = [];

  if (settings.kinds.overdue) out = out.concat(overdueNudges(store, day, options));
  if (settings.kinds.slot) out = out.concat(slotNudges(config, day, evidence, Object.assign({}, options, { store: store })));
  if (settings.kinds.repo && options.repos !== false) {
    const repoPart = repoNudges(config, Object.assign({}, options, { repoRepeatMs: settings.repoRepeatMinutes * 60000 }));
    out = out.concat(repoPart.nudges);
    for (const note of repoPart.notes) notes.push(note);
  }
  if (settings.kinds.evening) out = out.concat(eveningNudge(config, day, evidence, Object.assign({}, options, { store: store })));

  /* Kế hoạch hỏng là chuyện phải nói, và phải nói ngay: DevTrace đang TỪ
     CHỐI GHI cho tới khi huynh xử lý, nên mọi thứ huynh vừa bấm trên giao
     diện đều không được lưu. Không có lời nhắc này thì huynh mất việc mà
     không biết vì sao. */
  const corrupt = settings.kinds.plan ? Object.values((store && store.corrupt) || {}) : [];
  for (const info of corrupt) {
    out.push(nudge(
      'corrupt:' + path.basename(info.file), 'plan', 'bad',
      'Tệp kế hoạch bị hỏng: ' + path.basename(info.file),
      Plans.corruptMessage(info) + ' DevTrace đang TỪ CHỐI GHI cho tới khi tệp này được xử lý, '
        + 'nên những gì huynh vừa thay đổi chưa được lưu.', 0
    ));
  }

  // Nặng lên trước: bong bóng chỉ hiện được vài dòng, và cái đáng nhất phải
  // là cái đọc được trước.
  const rank = { bad: 0, warn: 1, info: 2 };
  out.sort((a, b) => (rank[a.level] - rank[b.level]) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return { day: day, now: now, nudges: out, notes: notes, settings: settings };
}

/* =====================================================================
   Phía máy chủ: chạy trong tiến trình riêng.

   Vì sao không gọi thẳng `compute` trong hàm xử lý yêu cầu: phần quét kho
   mã là 80 tiến trình git chạy ĐỒNG BỘ. Gọi thẳng thì mỗi lần ứng dụng để
   bàn hỏi "có gì mới không" là máy chủ đứng hình chừng ấy — đúng cái lỗi
   đã đo được ở đường thu thập (15,2 giây không trả lời nổi một yêu cầu).

   Đọc tệp này cùng app/nudges-run.js: đây là phía máy chủ, kia là phía
   tiến trình con.
   ===================================================================== */

const RUN_TIMEOUT_MS = 60000;

function spawnNudges(options, seams) {
  const childProcess = require('child_process');
  const opts = seams || {};
  const script = opts.script || path.join(__dirname, 'nudges-run.js');
  const args = [script, JSON.stringify(options || {})];

  return new Promise((resolve) => {
    childProcess.execFile(opts.execPath || process.execPath, args, {
      encoding: 'utf8',
      timeout: opts.timeoutMs || RUN_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: opts.env || process.env
    }, (error, stdout) => {
      if (error) {
        const said = stdout ? String(stdout).slice(0, 200) : '';
        resolve({
          ok: false,
          error: 'Không đọc được lời nhắc: ' + String((error && error.message) || error) + (said ? ' — nó nói: ' + said : '')
        });
        return;
      }
      let parsed = null;
      try { parsed = JSON.parse(String(stdout)); } catch (e) { parsed = null; }
      if (!parsed || typeof parsed !== 'object') {
        resolve({ ok: false, error: 'Tiến trình đọc lời nhắc trả về dữ liệu không đọc được.' });
        return;
      }
      resolve(parsed);
    });
  });
}

module.exports = {
  compute, settingsOf, overdueNudges, slotNudges, repoNudges, eveningNudge,
  runFromScan, listNames, nudge, spawnNudges,
  HEALTH_COMMANDS, GRACE_MS, DEFAULTS, RUN_TIMEOUT_MS
};
