'use strict';

/* =====================================================================
   app/alerts.js — Một chỗ duy nhất gom những điều đáng lưu ý.

   `digest.warnings()` đã là hàm dày nhất dự án, và nó có sẵn tham số `parts`
   đúng để mở rộng. Tệp này là phần mở rộng đó: nó gom cảnh báo từ kế hoạch
   của huynh, từ sức khoẻ kho mã (và, ở bước sau, từ hộp thư), rồi trả về
   ĐÚNG dạng `{level, kind, source, title, detail, at, project, weight}` mà
   `warnings()` đang dùng.

   Vì sao tách ra tệp riêng thay vì nhét thẳng vào `digest.js`: `warnings()`
   trả lời câu hỏi "bằng chứng của NGÀY NÀY có gì đáng ngờ". Còn thứ ở đây
   trả lời "kế hoạch của huynh, và tình trạng kho mã LÚC NÀY, đang có gì
   chệch" — câu hỏi khác, đọc từ kho khác (`data/plans/`, `data/repohealth.json`,
   không phải `data/events/`). Trộn hai câu hỏi vào một hàm thì lần sau muốn
   sửa một bên phải đọc hiểu cả hai.

   Và vì có hai loại thời gian khác nhau trong cùng một tệp, chỗ nối giữa
   chúng phải nói rõ: cảnh báo kế hoạch thuộc về NGÀY ĐANG XEM, còn cảnh báo
   kho mã chỉ đúng LÚC NÀY — nên `gather()` chỉ phát phần thứ hai khi ngày
   đang xem đúng là hôm nay. Xem `isToday`.

   Nhờ đi qua `parts.alerts`, những cảnh báo này tự có mặt ở: thẻ Cảnh báo,
   huy hiệu trên thanh điều hướng, nút "Cảnh báo (N)" — và cả trong gói bằng
   chứng gửi cho AI. Không phải sửa gì thêm ở hạ nguồn.
   ===================================================================== */

const path = require('path');
const U = require('./util');
const Plans = require('./plans');
const RepoHealth = require('./repohealth');
const Mail = require('./mail');

/* --- Đọc dữ liệu méo một cách thận trọng ----------------------------- */

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function titleOf(task) {
  const text = String((task && task.title) || '').trim();
  return text || '(chưa đặt tên)';
}

function nameOf(sprint) {
  const text = String((sprint && sprint.name) || '').trim();
  return text || String((sprint && sprint.id) || 'không rõ');
}

function isOpen(task) {
  return isPlainObject(task) && task.status !== 'done' && task.status !== 'dropped';
}

/* Hạn của một việc: mục tiêu tính theo `targetDay`, còn lại theo `dueDay`.
   Việc cố định không có hạn — nó lặp, và "quá hạn" không có nghĩa gì với
   một thứ lặp lại. */
function dueOf(task) {
  const horizon = task && task.horizon;
  if (horizon === 'recurring') return null;
  if (horizon === 'goal') return task.targetDay || null;
  return task.dueDay || null;
}

/* --- Cảnh báo từ kế hoạch ------------------------------------------- */

/* Tệp kế hoạch hỏng là cảnh báo nặng nhất trong nhóm này, và nặng là đúng:
   DevTrace đang TỪ CHỐI GHI cho tới khi huynh xử lý. Nghĩa là mọi thay đổi
   huynh vừa bấm trên giao diện đều không được lưu — im lặng bỏ qua chuyện
   đó là để huynh mất việc mà không biết vì sao. */
function corruptedAlerts(store) {
  const out = [];
  for (const key of Object.keys(store.corrupt || {})) {
    const info = store.corrupt[key];
    out.push({
      level: 'bad',
      kind: 'plan',
      source: null,
      weight: 10,
      at: null,
      project: null,
      title: 'Tệp kế hoạch bị hỏng: ' + path.basename(info.file),
      detail: Plans.corruptMessage(info)
    });
  }
  return out;
}

function sprintAlerts(store, day) {
  const out = [];
  for (const sprint of store.sprints.sprints) {
    if (!isPlainObject(sprint) || sprint.status !== 'active') continue;
    const endDay = sprint.endDay || null;
    if (endDay && endDay < day) {
      out.push({
        level: 'bad', kind: 'sprint', source: null, weight: 6, at: null, project: null,
        title: 'Sprint “' + nameOf(sprint) + '” đã qua ngày kết thúc mà chưa đóng',
        detail: 'Hộp thời gian ' + (sprint.startDay || '?') + ' → ' + endDay + '. Đóng nó thì việc còn dở '
          + 'được trả về backlog, và số lần mang sang mới đếm được — đó mới là con số đáng nhìn.'
      });
    } else if (endDay === day) {
      out.push({
        level: 'warn', kind: 'sprint', source: null, weight: 4, at: null, project: null,
        title: 'Sprint “' + nameOf(sprint) + '” kết thúc hôm nay',
        detail: 'Việc còn dở sẽ được trả về backlog khi huynh đóng sprint.'
      });
    }
  }
  return out;
}

/* Việc quá hạn được GOM thành một dòng, không kể từng việc một.

   Cùng lý do như cách `warnings()` gom nguồn im lặng: mười việc quá hạn cho
   ra mười dòng gần giống hệt nhau, và danh sách dài quá thì huynh thôi không
   đọc — kể cả những dòng thật sự đáng đọc ở dưới. */
function overdueAlerts(store, day) {
  const overdue = [];
  for (const task of store.tasks.tasks) {
    if (!isOpen(task)) continue;
    const due = dueOf(task);
    if (due && due < day) overdue.push({ title: titleOf(task), due });
  }
  if (!overdue.length) return [];
  overdue.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const shown = overdue.slice(0, 5).map((t) => '“' + t.title + '” (hạn ' + t.due + ')');
  return [{
    level: overdue.length >= 3 ? 'bad' : 'warn',
    kind: 'task', source: null, at: null, project: null,
    weight: Math.min(5, 2 + overdue.length),
    title: overdue.length + ' việc đã quá hạn',
    detail: shown.join(' · ') + (overdue.length > shown.length ? ' … và ' + (overdue.length - shown.length) + ' việc nữa' : '')
      + '. Quá hạn không có nghĩa là phải xong — nhưng nó là thứ dễ bị lọc mất nhất khi xem việc trong ngày.'
  }];
}

/* --- Cổng "bây giờ" -------------------------------------------------- */

/* Ngày DevTrace bắt đầu lúc 4 giờ sáng, nên "hôm nay" không phải
   `new Date().toISOString().slice(0,10)` — lúc 1 giờ sáng ngày 13 thì ngày
   DevTrace vẫn là 12. Dùng chung `U.dayKey` với phần còn lại của dự án. */
function todayKey(config, now) {
  return U.dayKey(now == null ? Date.now() : now, (config && config.dayStartHour) || 0);
}

function isToday(config, day, now) {
  return !!day && day === todayKey(config, now);
}

/* --- Cảnh báo sức khoẻ kho ------------------------------------------- */

function gitEnabled(config) {
  const git = (config && config.sources && config.sources.git) || {};
  return git.enabled !== false;
}

/* Gom theo LOẠI, không mỗi kho một dòng.

   Hai mươi kho, mỗi kho một dòng "cây làm việc còn dở", cho ra hai mươi dòng
   gần giống hệt nhau — và kinh nghiệm của chính dự án này (xem cách
   `digest.warnings` gom nguồn im lặng) là danh sách dài quá thì người đọc
   thôi đọc, kể cả những dòng thật sự đáng đọc ở dưới. Nên mỗi loại một dòng,
   kèm số lượng và tên vài kho đầu. */
function grouped(list, make) {
  return list.length ? [make(list)] : [];
}

function repoAlerts(config, day, opts) {
  const options = opts || {};
  if (!gitEnabled(config)) return [];

  /* Ảnh chụp cũ hơn hôm nay thì KHÔNG phát cảnh báo từ nó.

     Cây làm việc bẩn là sự thật của một khoảnh khắc. Đem con số của ba ngày
     trước ra nói như thể nó là bây giờ là đúng loại nói dối mà cả dự án này
     được dựng lên để tránh — và ở đây nó nguy hiểm hơn bình thường, vì người
     đọc sẽ đi kiểm tra một tình trạng đã không còn tồn tại. */
  const shot = options.snapshot === undefined ? RepoHealth.read(config) : options.snapshot;
  if (!shot) {
    return [{
      level: 'info', kind: 'repo', source: 'git', at: null, project: null, weight: 0,
      title: 'Chưa quét sức khoẻ kho lần nào',
      detail: 'Màn Dự án có nút quét: nó đọc cây làm việc, số commit chưa đẩy, stash, nhánh cũ và tệp lớn của từng kho.'
    }];
  }
  if (shot.day !== day) {
    return [{
      level: 'info', kind: 'repo', source: 'git', at: null, project: null, weight: 0,
      title: 'Sức khoẻ kho là ảnh chụp của ngày ' + shot.day + ', chưa quét lại hôm nay',
      detail: 'Cây làm việc đổi liên tục, nên con số cũ không nói được gì về lúc này. Quét lại ở màn Dự án nếu muốn xem.'
    }];
  }
  return repoAlertsOf(shot);
}

/* Tách khỏi `repoAlerts` để phần đọc ảnh chụp và phần suy ra cảnh báo kiểm
   được riêng — bộ kiểm thử dựng thẳng một ảnh chụp trong bộ nhớ rồi soi
   từng loại cảnh báo, không phải ghi tệp nào. */
function repoAlertsOf(shot) {
  const repos = Array.isArray(shot.repos) ? shot.repos : [];
  const good = repos.filter((r) => r && !r.error);
  const out = [];

  const failed = repos.filter((r) => r && r.error);
  if (failed.length) {
    out.push({
      level: 'warn', kind: 'repo', source: 'git', at: shot.updatedAt || null, project: null, weight: 3,
      title: failed.length + ' kho không đọc được',
      detail: failed.slice(0, 5).map((r) => '“' + r.name + '”: ' + r.error).join(' · ')
    });
  }

  /* Bí mật là cảnh báo nặng nhất ở đây, và nặng là đúng: mọi thứ khác chỉ là
     bừa bộn, còn cái này là thứ đã đi lên remote và không rút lại được. */
  const withSecrets = good.filter((r) => r.secrets && r.secrets.hits && r.secrets.hits.length);
  if (withSecrets.length) {
    const total = withSecrets.reduce((sum, r) => sum + r.secrets.hits.length, 0);
    const sample = [];
    for (const repo of withSecrets) {
      for (const hit of repo.secrets.hits.slice(0, 3)) {
        /* CHỈ đường dẫn, số dòng và TÊN quy tắc. Không bao giờ giá trị khớp
           được. Một bảng cảnh báo bí mật mà in cả bí mật ra thì tự nó thành
           chỗ phát tán đúng thứ nó đang cảnh báo. */
        sample.push(repo.name + '/' + hit.path + ':' + hit.line + ' (' + hit.label + ')');
      }
    }
    out.push({
      level: 'bad', kind: 'repo', source: 'git', at: shot.updatedAt || null, project: null, weight: 9,
      title: 'Có thể có bí mật trong ' + total + ' chỗ thuộc ' + withSecrets.length + ' kho',
      detail: sample.slice(0, 5).join(' · ')
        + (total > sample.length ? ' … và ' + (total - sample.length) + ' chỗ nữa' : '')
        + '. Đây là DẤU HIỆU, không phải kết luận — quy tắc dò bí mật báo nhầm trên tệp thử. '
        + 'Mở tệp ra xem; nếu đúng là bí mật thì xoay khoá, vì nó đã nằm trong lịch sử commit.'
    });
  }

  grouped(good.filter((r) => r.behind > 0), (list) => ({
    level: 'warn', kind: 'repo', source: 'git', at: shot.updatedAt || null, project: null, weight: 3,
    title: list.length === 1 ? '“' + list[0].name + '” có commit trên remote chưa kéo về'
      : list.length + ' kho có commit trên remote chưa kéo về',
    detail: list.slice(0, 5).map((r) => r.name + ' (' + r.behind + ' commit)').join(' · ')
      + '. Việc đang làm dựa trên bản cũ, và càng để lâu thì càng dễ đụng nhau khi kéo về.'
  })).forEach((a) => out.push(a));

  grouped(good.filter((r) => r.ahead > 0), (list) => ({
    level: 'info', kind: 'repo', source: 'git', at: shot.updatedAt || null, project: null, weight: 1,
    title: list.length === 1 ? '“' + list[0].name + '” có commit chưa đẩy lên'
      : list.length + ' kho có commit chưa đẩy lên',
    detail: list.slice(0, 5).map((r) => r.name + ' (' + r.ahead + ' commit)').join(' · ')
      + '. Chưa mất gì cả — nhưng công việc này chỉ đang nằm trên một máy.'
  })).forEach((a) => out.push(a));

  const dirty = good.filter((r) => r.working && r.working.total >= RepoHealth.MANY_CHANGES);
  grouped(dirty, (list) => ({
    level: 'warn', kind: 'repo', source: 'git', at: shot.updatedAt || null, project: null, weight: 2,
    title: list.length === 1 ? '“' + list[0].name + '” còn ' + list[0].working.total + ' thay đổi chưa ghi'
      : list.length + ' kho còn nhiều thay đổi chưa ghi',
    detail: list.slice(0, 5).map((r) => r.name + ' (' + r.working.total + ' tệp)').join(' · ')
      + '. Chưa ghi lại thì chưa có gì để quay về khi hỏng — và đây cũng là thứ dễ mất nhất khi cài lại máy.'
  })).forEach((a) => out.push(a));

  grouped(good.filter((r) => r.bigFiles && r.bigFiles.length), (list) => ({
    level: 'warn', kind: 'repo', source: 'git', at: shot.updatedAt || null, project: null, weight: 2,
    title: list.reduce((sum, r) => sum + r.bigFiles.length, 0) + ' tệp lớn nằm trong ' + list.length + ' kho',
    detail: list.slice(0, 5).map((r) => r.name + ': ' + r.bigFiles[0].path + ' (' + mb(r.bigFiles[0].bytes) + ')').join(' · ')
      + '. Tệp lớn đã vào lịch sử thì ở lại đó mãi — mỗi lần clone là mỗi lần tải lại.'
  })).forEach((a) => out.push(a));

  grouped(good.filter((r) => r.stashes && r.stashes.length >= RepoHealth.MANY_STASHES), (list) => ({
    level: 'info', kind: 'repo', source: 'git', at: shot.updatedAt || null, project: null, weight: 1,
    title: list.reduce((sum, r) => sum + r.stashes.length, 0) + ' bản stash đang nằm trong ' + list.length + ' kho',
    detail: list.slice(0, 5).map((r) => r.name + ' (' + r.stashes.length + ')').join(' · ')
      + '. Stash là chỗ để tạm, không phải chỗ để cất: nằm lâu quá thì chính mình cũng không nhớ nó là gì.'
  })).forEach((a) => out.push(a));

  /* Nhánh cũ CHƯA GỘP mới đáng nói. Nhánh đã gộp thì xoá được bất cứ lúc nào
     và không chứa gì đang dở — kể cả nó cũng chỉ làm loãng danh sách. */
  const stale = [];
  for (const repo of good) {
    const list = (repo.branches || []).filter((b) =>
      b && !b.merged && b.ageDays != null && b.ageDays >= RepoHealth.STALE_BRANCH_DAYS);
    if (list.length) stale.push({ name: repo.name, list });
  }
  grouped(stale, (list) => ({
    level: 'info', kind: 'repo', source: 'git', at: shot.updatedAt || null, project: null, weight: 1,
    title: list.reduce((sum, r) => sum + r.list.length, 0) + ' nhánh cũ chưa gộp',
    detail: list.slice(0, 5).map((r) => r.name + ': ' + r.list.map((b) => b.name + ' (' + b.ageDays + ' ngày)').join(', ')).join(' · ')
      + '. Chưa gộp nghĩa là còn việc trong đó, hoặc là đã bỏ quên — cả hai đều đáng nhìn một lần.'
  })).forEach((a) => out.push(a));

  /* Nói ra phần ĐÃ BỎ QUA. Quét 20 trên 52 kho mà chỉ báo "đã quét 20 kho"
     là để người đọc tin rằng mọi thứ đều ổn, trong khi 32 kho chưa từng được
     nhìn tới. */
  if (shot.skipped > 0) {
    out.push({
      level: 'info', kind: 'repo', source: 'git', at: shot.updatedAt || null, project: null, weight: 0,
      title: 'Chỉ quét ' + shot.scanned + '/' + shot.total + ' kho',
      detail: 'Nâng sources.git.healthMaxRepos trong devtrace.config.json nếu muốn quét hết. '
        + 'Mỗi kho tốn khoảng sáu lệnh git, nên quét cả ' + shot.total + ' kho là việc phải chọn chứ không phải mặc định.'
    });
  }
  return out;
}

function mb(bytes) {
  return (Math.round(bytes / (1024 * 1024) * 10) / 10) + ' MB';
}

/* --- Cảnh báo hộp thư ------------------------------------------------ */

/* CHỈ CON SỐ VÀ SỐ NGÀY. Không tiêu đề thư, không địa chỉ, không nội dung —
   kể cả khi hàm này có sẵn chúng trong tay qua `Mail.view`.

   Đây không phải chuyện giữ ý: `gather()` chảy thẳng vào `digest.warnings`,
   rồi vào thẻ Cảnh báo, rồi vào gói bằng chứng gửi cho AI. Một tiêu đề thư
   lọt vào đây là chữ của người khác đi ra khỏi máy này. Nên hàm này chỉ gọi
   `Mail.summary` — bản chỉ có số — và không bao giờ gọi `Mail.view`.

   Vì cùng lý do, phần lỗi cũng KHÔNG kèm lời đáp của máy chủ IMAP. Lời đáp
   đó có thể nhắc lại tên tài khoản. Thẻ Hộp thư trên màn hình hiện đủ câu
   của máy chủ, vì đó là màn hình của chính huynh; ở đây thì không. */
function mailAlerts(config, day, opts) {
  const options = opts || {};
  const settings = Mail.settingsOf(config);
  /* Tắt thì im lặng. Huynh tắt nó là đã quyết rồi, và một dòng "hộp thư đang
     tắt" ở mọi bản tổng hợp là đúng kiểu ồn ào khiến người ta thôi đọc cả
     danh sách cảnh báo. */
  if (!settings.enabled) return [];

  if (!settings.host || !settings.user) {
    return [{
      level: 'info', kind: 'mail', source: 'mail', at: null, project: null, weight: 0,
      title: 'Hộp thư đã bật nhưng chưa điền đủ máy chủ và tài khoản',
      detail: 'Vào Cài đặt để điền. DevTrace không tự đi tìm — nó không đoán máy chủ thư của huynh.'
    }];
  }

  const shot = options.mail === undefined ? Mail.read(config).shot : options.mail;
  if (!shot) {
    return [{
      level: 'info', kind: 'mail', source: 'mail', at: null, project: null, weight: 0,
      title: 'Chưa quét hộp thư lần nào',
      detail: 'Thẻ Hộp thư ở màn Hôm nay có nút quét. Cần mật khẩu ứng dụng trong biến môi trường '
        + '“' + settings.passwordEnv + '” — DevTrace không lưu mật khẩu vào tệp cấu hình.'
    }];
  }

  const st = Mail.summary(config, { now: options.now, shot });
  if (!shot.ok) {
    return [{
      level: 'warn', kind: 'mail', source: 'mail', at: st.at, project: null, weight: 3,
      title: 'Lần quét hộp thư gần nhất không thành công',
      detail: 'Thẻ Hộp thư ở màn Hôm nay ghi đầy đủ lời máy chủ trả về. Mọi thứ khác của DevTrace vẫn chạy bình thường.'
    }];
  }

  if (shot.day !== day) {
    return [{
      level: 'info', kind: 'mail', source: 'mail', at: st.at, project: null, weight: 0,
      title: 'Hộp thư là ảnh chụp của ngày ' + shot.day + ', chưa quét lại hôm nay',
      detail: 'Hộp thư đổi liên tục, nên con số của ngày khác không nói được gì về lúc này.'
    }];
  }

  const out = [];
  if (st.waiting > 0) {
    const parts = ['Cũ nhất ' + st.oldestDays + ' ngày.'];
    if (st.unseen > 0) parts.push(st.unseen + ' thư trong đó chưa mở lần nào.');
    parts.push('Đây là ước lượng từ hộp thư đồng bộ trên máy này: trả lời từ máy khác vẫn bị tính là chưa trả lời, '
      + 'và thư quảng cáo thì nằm mãi trong danh sách.');
    if (!settings.sentFolder) {
      parts.push('Chưa đọc thư mục Đã gửi, nên con số này chỉ dựa vào cờ đã-trả-lời của máy chủ — nó thường đếm THỪA.');
    }
    out.push({
      level: st.waiting >= 3 ? 'bad' : 'warn',
      kind: 'mail', source: 'mail', at: st.at, project: null,
      weight: Math.min(6, 2 + st.waiting + st.oldestDays),
      title: st.waiting + ' thư có thể chưa được trả lời',
      detail: parts.join(' ')
    });
    return out;
  }

  /* Không có thư nào đang chờ, NHƯNG tín hiệu chính đang mù: thiếu thư mục
     Đã gửi thì "0 thư chưa trả lời" là một câu nói dối rất dễ tin. Nói ra. */
  if (!settings.sentFolder) {
    out.push({
      level: 'info', kind: 'mail', source: 'mail', at: st.at, project: null, weight: 0,
      title: 'Chưa đối chiếu được thư nào đã trả lời',
      detail: 'Chưa đọc thư mục Đã gửi nên DevTrace không biết thư nào trong hộp nhận đã được đáp. '
        + 'Điền thư mục Đã gửi ở Cài đặt (Gmail thường là “[Gmail]/Đã gửi”) rồi quét lại.'
    });
  }
  return out;
}

/* --- Cổng vào -------------------------------------------------------- */

/* Gom mọi cảnh báo KHÔNG đến từ bằng chứng của một ngày: kế hoạch của huynh,
   sức khoẻ kho mã, và hộp thư.

   `opts.store` và `opts.snapshot` là khe cắm kiểm thử, cùng lối
   `opts.fetchJson`/`opts.runGit` đang có trong dự án: truyền vào một kho dựng
   sẵn thì kiểm được mọi nhánh mà không phải ghi tệp nào.

   `opts.now` khoá phép so "hôm nay" lại, để bài kiểm thử không phụ thuộc vào
   ngày chạy — một phép kiểm đổi kết quả theo lịch là phép kiểm sẽ đỏ vào một
   ngày nào đó rồi không ai hiểu vì sao. */
function gather(config, day, opts) {
  const options = opts || {};
  const store = options.store || Plans.loadStore(config, options);
  const planAlerts = []
    .concat(corruptedAlerts(store))
    .concat(sprintAlerts(store, day))
    .concat(overdueAlerts(store, day));

  /* Kế hoạch là chuyện của ngày đang xem, nên luôn có mặt. Sức khoẻ kho là
     chuyện của BÂY GIỜ, nên chỉ có mặt khi ngày đang xem đúng là hôm nay —
     nhờ vậy bản tổng hợp của một ngày cũ đọc lại mười lần vẫn ra y hệt, và
     không bao giờ đi hỏi một ảnh chụp có thể đã đổi. */
  const now = isToday(config, day, options.now);
  const repoPart = now ? repoAlerts(config, day, options) : [];
  const mailPart = now ? mailAlerts(config, day, options) : [];
  return planAlerts.concat(repoPart).concat(mailPart);
}

module.exports = {
  gather, dueOf, titleOf, nameOf, isOpen,
  isToday, todayKey, repoAlerts, repoAlertsOf, mailAlerts
};
