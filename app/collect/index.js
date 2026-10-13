'use strict';

/* =====================================================================
   app/collect/index.js — Bộ điều phối thu thập.

   Nguyên tắc kiến trúc của DevTrace nằm ở đây:
     1. THU THẬP sự kiện trước, từ nhiều nguồn độc lập.
     2. Mỗi nguồn chỉ ghi bằng chứng thô của mình, không diễn giải.
     3. Suy luận (đối chiếu, tổng hợp, nhận xét) để tầng sau làm.

   Nhờ vậy khi kết luận sai, ta luôn truy được về sự kiện gốc nào đã dẫn
   tới kết luận đó — thay vì tin vào một bản tóm tắt không kiểm chứng được.
   ===================================================================== */

/* node:sqlite còn ở dạng thử nghiệm nên Node in cảnh báo ra stderr mỗi lần
   nạp. Cảnh báo đó không phải lỗi và chỉ gây nhiễu log, nên lọc riêng nó. */
(function silenceSqliteWarning() {
  const original = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const text = typeof warning === 'string' ? warning : (warning && warning.message) || '';
    if (/SQLite is an experimental feature/i.test(text)) return;
    return original.call(process, warning, ...rest);
  };
})();

const E = require('../events');
const U = require('../util');
const C = require('../config');

const COLLECTORS = {
  codex: require('./codex'),
  git: require('./git'),
  files: require('./files'),
  browser: require('./browser'),
  shell: require('./shell'),
  vscode: require('./vscode'),
  github: require('./github')
};

function runCollector(config, name, opts) {
  const module = COLLECTORS[name];
  if (!module) return { events: [], notes: [name + ': không có bộ thu thập'] };
  try {
    // `opts` đi thẳng vào bộ thu thập để bài kiểm thử cắm được khe mạng/khe
    // git. Không bộ thu thập nào bắt buộc phải dùng.
    const result = module.collect(config, opts || {}) || { events: [], notes: [] };
    return {
      events: result.events || [],
      notes: result.notes || [],
      // Ba trạng thái: true = "đã đọc đủ, kết quả này là toàn bộ sự thật",
      // false = "đọc hụt", undefined = "bộ thu thập không nói gì".
      complete: result.complete
    };
  } catch (error) {
    return { events: [], notes: [name + ': lỗi — ' + (error && error.message)], error: String(error && error.message) };
  }
}

// Ghi sự kiện của một nguồn vào kho: nguồn suy ra được thì thay toàn bộ,
// nguồn dòng chảy thì chỉ ghi thêm phần chưa từng thấy.
//
// Chốt chặn chống mất dữ liệu: với nguồn suy ra được, thay toàn bộ nghĩa là
// xoá sạch nguồn đó trên mọi ngày rồi ghi lại — nên ghi lại bằng một kết quả
// thiếu chính là xoá dữ liệu thật. Vì vậy chỉ thay khi bộ thu thập khẳng định
// đã đọc đủ (complete === true); nếu nó không nói gì mà lại trả về rỗng thì
// coi như chưa chắc nguồn rỗng thật, và giữ nguyên bản cũ. Thà dữ liệu cũ còn
// hơn mất trắng. Muốn xoá thật thì dùng rebuild.
//
// Trả về { events, skipped } — skipped là lý do giữ bản cũ, để giao diện nói
// được cho huynh biết vì sao con số không đổi.
function persist(config, name, events, options) {
  const opts = options || {};
  const normalized = E.makeMany(config, events);

  if (E.DERIVED_SOURCES.indexOf(name) === -1) {
    const byDay = new Map();
    for (const event of normalized) {
      if (!byDay.has(event.day)) byDay.set(event.day, []);
      byDay.get(event.day).push(event);
    }
    for (const [day, list] of byDay) E.addEvents(config, day, list);
    return { events: normalized, skipped: null };
  }

  if (opts.complete === false) {
    return { events: [], skipped: 'nguồn đọc hụt' };
  }
  if (!normalized.length && opts.complete !== true && !opts.rebuild) {
    return { events: [], skipped: 'nguồn trả về rỗng' };
  }

  E.replaceSourceAllDays(config, name, normalized);
  return { events: normalized, skipped: null };
}

function run(config, options) {
  const opts = options || {};
  const names = opts.sources && opts.sources.length ? opts.sources : Object.keys(COLLECTORS);
  if (opts.rebuild) clearCollected(config);
  const startedAt = Date.now();
  const summary = { startedAt, finishedAt: 0, ms: 0, sources: {}, notes: [], total: 0 };
  const health = {};

  for (const name of names) {
    const t0 = Date.now();
    const info = E.SOURCES[name] || { label: name };

    // Nguồn đã tắt thì không chạy và không đụng tới kho. Trước đây nguồn tắt
    // vẫn được chạy, trả về rỗng, rồi bị ghi đè — nghĩa là tắt một nguồn
    // trong màn Cài đặt là xoá sạch lịch sử của chính nguồn đó.
    if (!sourceEnabled(config, name)) {
      const note = info.label + ': đang tắt';
      summary.sources[name] = { label: info.label, events: 0, ms: 0, notes: [note], ok: true };
      summary.notes.push(note);
      health[name] = { label: info.label, lastRun: Date.now(), ms: 0, events: 0, ok: true, notes: [note], error: null };
      continue;
    }

    const result = runCollector(config, name, opts.collectorOpts);
    let events = [];
    if (!result.error) {
      const outcome = persist(config, name, result.events, { complete: result.complete, rebuild: opts.rebuild });
      events = outcome.events;
      if (outcome.skipped) {
        result.notes = result.notes.concat([info.label + ': giữ nguyên dữ liệu cũ (' + outcome.skipped + ')']);
      }
    }
    const ms = Date.now() - t0;

    /* `ok` nói thẳng nguồn này chạy được hay không. Trước đây giao diện đoán
       qua "có ghi chú hay không" — ngược hoàn toàn, vì nguồn khoẻ mạnh thường
       chẳng có ghi chú nào, còn nguồn lỗi thì luôn có. */
    summary.sources[name] = { label: info.label, events: events.length, ms, notes: result.notes, ok: !result.error };
    for (const note of result.notes) summary.notes.push(note);
    summary.total += events.length;

    health[name] = {
      label: info.label, lastRun: Date.now(), ms, events: events.length,
      ok: !result.error, notes: result.notes, error: result.error || null
    };
  }

  /* Dọn dữ liệu quá hạn, nếu huynh đã bật. Chạy SAU khi thu thập xong, để
     một lần dọn không bao giờ cắt ngang việc ghi bằng chứng mới. */
  const policy = retentionOf(config);
  if (policy.enabled && policy.days) {
    const pruned = prune(config, policy);
    summary.retention = { days: policy.days, removed: pruned.removed, kept: pruned.kept };
    if (pruned.removed.length) {
      const note = 'Hạn lưu trữ ' + policy.days + ' ngày: đã xoá ' + pruned.removed.length +
        ' ngày cũ (' + pruned.removed[0] + ' → ' + pruned.removed[pruned.removed.length - 1] + ').';
      summary.notes.push(note);
    }
  }

  summary.finishedAt = Date.now();
  summary.ms = summary.finishedAt - startedAt;
  E.writeHealth(config, health);
  return summary;
}

/* =====================================================================
   Thu thập ở HẬU TRƯỜNG — chạy trong tiến trình riêng.

   `run` ở trên là đường ĐỒNG BỘ và vẫn là đường chính: bộ kiểm thử, tệp
   lệnh, và chính tiến trình con đều gọi nó. Phần dưới đây chỉ là lớp bọc
   cho MÁY CHỦ, để một lượt thu thập không khoá máy chủ lại.

   Vì sao cần: `run` chặn cả vòng lặp sự kiện. Đo trên máy này — một lượt
   thu thập mất 15,2 giây, và trong suốt chừng ấy giây `GET /api/status`
   không trả lời nổi (hỏi lúc +250ms, trả lời lúc +15453ms). Mở ứng dụng
   lên là màn hình trắng đúng bằng chừng ấy.

   Đọc tệp này cùng app/collect-run.js: đây là phía máy chủ, kia là phía
   tiến trình con.
   ===================================================================== */

/* Chờ tối đa bao lâu. Rộng hơn 180 giây mà desktop/main.js đang chờ ở đầu
   bên kia, để bên nói ra lý do luôn là tiến trình con chứ không phải một
   lần hết giờ câm lặng ở giữa. */
const RUN_TIMEOUT_MS = 240000;

/* Lượt đang chạy, hoặc null. Sống trong tiến trình máy chủ và KHÔNG ghi ra
   đĩa: đây là chuyện của riêng tiến trình này. Ghi nó xuống đĩa thì một
   tệp mốc cũ nằm lại sau khi máy chủ chết sẽ khoá cứng mọi lượt thu thập
   sau đó — đúng kiểu hỏng mà `stop.js` đã phải phòng ở chỗ khác. */
let inFlight = null;

/* Cùng một yêu cầu thì được NHẬP vào lượt đang chạy; khác yêu cầu thì bị
   từ chối. Gộp bừa hai yêu cầu khác nhau lại là trả về một bản tổng kết
   không chứa thứ người gọi vừa hỏi — im lặng, và sai. */
function runKey(options) {
  const opts = options || {};
  const names = opts.sources && opts.sources.length ? opts.sources.slice() : Object.keys(COLLECTORS);
  return JSON.stringify({ sources: names.slice().sort(), rebuild: !!opts.rebuild });
}

/* Lượt đang chạy, để giao diện nói được "đang thu thập" thay vì để người
   đọc tự đoán vì sao số liệu đứng yên. Trả về bản sao, không phải chính
   đối tượng đang chạy — chỗ gọi không được sửa vào đó. */
function collecting() {
  if (!inFlight) return null;
  return { startedAt: inFlight.startedAt, ms: Date.now() - inFlight.startedAt, sources: inFlight.names.slice() };
}

/* Sinh tiến trình con và chờ nó. Trả về Promise, KHÔNG BAO GIỜ ném lỗi:
   mọi đường hỏng đều thành `{ ok: false, error }` để chỗ gọi chỉ phải xử
   lý một hình dạng duy nhất. */
function spawnCollect(options, seams) {
  const childProcess = require('child_process');
  const path = require('path');
  const opts = seams || {};
  const script = opts.script || path.join(__dirname, '..', 'collect-run.js');
  const args = [script, JSON.stringify({ sources: options.sources, rebuild: !!options.rebuild })];

  return new Promise((resolve) => {
    childProcess.execFile(opts.execPath || process.execPath, args, {
      encoding: 'utf8',
      timeout: opts.timeoutMs || RUN_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      /* Không có dòng này thì mỗi lượt thu thập làm một cửa sổ đen nháy lên
         trên màn hình Windows — đúng thứ khiến người ta tưởng ứng dụng hỏng. */
      windowsHide: true,
      env: opts.env || process.env
    }, (error, stdout) => {
      if (error) {
        /* Nói ra ĐÚNG thứ đọc được, không đoán. `stdout` có thể chứa nửa
           đối tượng JSON; cắt ngắn để nó không tràn đi chỗ khác. */
        const said = stdout ? String(stdout).slice(0, 200) : '';
        resolve({
          ok: false,
          error: 'Không chạy được lượt thu thập: ' + String((error && error.message) || error) +
            (said ? ' — nó nói: ' + said : '')
        });
        return;
      }
      let parsed = null;
      try { parsed = JSON.parse(String(stdout)); } catch (e) { parsed = null; }
      if (!parsed || typeof parsed !== 'object') {
        resolve({ ok: false, error: 'Tiến trình thu thập trả về dữ liệu không đọc được.' });
        return;
      }
      resolve(parsed);
    });
  });
}

/* Bắt đầu một lượt thu thập ở hậu trường.

   Trả về Promise của:
     { ok: true, summary, status }                  — chạy xong
     { ok: true, summary, status, joined: true }    — nhập vào lượt đang chạy
     { ok: false, busy: true, error }               — đang chạy một yêu cầu KHÁC
     { ok: false, error, status }                   — tiến trình con hỏng

   `seams` chỉ để bộ kiểm thử chạy hết đường đi mà không sinh tiến trình
   nào — cùng lối `opts.kill` của stop.js và `opts.runGit` của git.js. */
function runDetached(config, options, seams) {
  const opts = options || {};
  const deps = seams || {};
  const key = runKey(opts);

  if (inFlight) {
    if (inFlight.key !== key) {
      return Promise.resolve({
        ok: false, busy: true,
        error: 'Đang thu thập dấu vết — đợi lượt này xong rồi thử lại.'
      });
    }
    return inFlight.promise.then((out) => Object.assign({}, out, { joined: true }));
  }

  const names = opts.sources && opts.sources.length ? opts.sources.slice() : Object.keys(COLLECTORS);
  const record = { key: key, names: names, startedAt: Date.now(), promise: null };

  /* `status` đọc lại health.json mà tiến trình con VỪA ghi, nên nó phải
     được dựng sau khi con xong.

     Và khoá phải được dọn TRƯỚC khi dựng `status`, không phải sau. Dựng
     trước rồi mới dọn là trả về một bản trạng thái nói "vẫn đang thu thập"
     cho một lượt vừa xong — mà giao diện đọc đúng trường đó để quyết định
     còn theo dõi nữa hay không, nên nó sẽ quay lại hỏi mãi một việc đã
     xong. */
  const clear = () => { if (inFlight === record) inFlight = null; };
  const finish = (out) => {
    clear();
    return Object.assign({}, out, { status: status(config) });
  };
  const failed = (error) => {
    clear();
    return { ok: false, error: String((error && error.message) || error) };
  };

  record.promise = (deps.spawn || spawnCollect)(opts, deps).then(finish, failed);

  inFlight = record;
  return record.promise;
}

/* ---------------------------------------------------------------------
   Dọn dữ liệu cũ theo hạn lưu trữ.

   MẶC ĐỊNH TẮT, và đây là chủ ý. DevTrace vừa mất công dựng một chốt chặn
   để không xoá nhầm dữ liệu của huynh; thêm một chỗ tự động xoá nữa mà bật
   sẵn thì hai việc đó triệt tiêu nhau. Xoá dữ liệu là việc huynh phải nói
   rõ mình muốn.

   Khi huynh bật, nó chạy ở CUỐI mỗi lần thu thập (không phải đầu), và trả
   về đúng những gì đã xoá để câu chuyện hiện lên trong phần ghi chú của lần
   chạy đó — không có chuyện dữ liệu biến mất trong im lặng.
   --------------------------------------------------------------------- */

function retentionOf(config) {
  const policy = (config && config.retention) || {};
  const days = Number(policy.days);
  return {
    enabled: policy.enabled === true,
    days: isFinite(days) && days > 0 ? Math.floor(days) : 0,
    keepJournals: policy.keepJournals !== false
  };
}

/* Ngày nhỏ nhất còn được giữ. Mọi ngày TRƯỚC mốc này bị coi là quá hạn.
   Dùng dayKey để mốc tính theo cùng cách với mọi chỗ khác trong dự án —
   "ngày" ở đây bắt đầu lúc 4 giờ sáng, không phải nửa đêm. */
function retentionCutoff(config, days) {
  return U.dayKey(Date.now() - days * 86400000, config.dayStartHour);
}

/* Trả về { removed: [ngày...], kept: n }. Không ném lỗi: dọn dẹp hỏng thì
   lần thu thập vẫn phải xong. */
function prune(config, policy) {
  const fs = require('fs');
  const path = require('path');
  const result = { removed: [], kept: 0 };
  if (!policy || !policy.enabled || !policy.days) return result;

  const cutoff = retentionCutoff(config, policy.days);
  for (const day of E.listDays(config)) {
    if (day >= cutoff) { result.kept += 1; continue; }
    try {
      fs.unlinkSync(E.dayFilePath(config, day));
      result.removed.push(day);
    } catch (error) { /* không xoá được thì thôi, lần sau thử lại */ }
    // Nhật ký là chữ huynh viết, không phải dữ liệu máy đọc được — mặc định
    // giữ lại kể cả khi sự kiện của ngày đó đã hết hạn.
    if (!policy.keepJournals) {
      const journal = path.join(config.dataDir, 'journals', day + '.json');
      try { if (fs.existsSync(journal)) fs.unlinkSync(journal); } catch (error) { /* thôi */ }
    }
  }
  return result;
}

// Trạng thái các nguồn cho giao diện: lần chạy cuối, số sự kiện, ghi chú.
function status(config) {
  const health = E.readHealth(config);
  const days = E.listDays(config);
  const list = Object.keys(E.SOURCES).map((name) => {
    const info = E.SOURCES[name];
    const entry = (health.sources || {})[name] || null;
    const enabled = sourceEnabled(config, name);
    return {
      name, label: info.label, kind: info.kind, evidence: info.evidence, color: info.color,
      enabled, health: entry
    };
  });
  return {
    sources: list, days: days.length, latest: days.length ? days[days.length - 1] : null,
    updatedAt: health.updatedAt || null,
    /* Giao diện PHẢI biết điều này. Một lượt thu thập chạy ở hậu trường
       nghĩa là những con số đang hiện trên màn hình là của lần thu TRƯỚC;
       không nói ra thì một bảng ghi "0 sự kiện hôm nay" bị đọc thành "hôm
       nay chưa làm gì" — đúng kiểu sai mà cả dự án này cấm. */
    collecting: collecting()
  };
}

function sourceEnabled(config, name) {
  const settings = (config.sources || {})[name];
  if (!settings) return name === 'manual';
  return settings.enabled !== false;
}

/* Xoá sạch kho đã thu thập và các mốc theo dõi. Dùng khi huynh muốn dựng
   lại toàn bộ bằng chứng từ đầu (ví dụ sau khi sửa bộ thu thập), hoặc khi
   muốn xoá dấu vết cũ. */
function clearCollected(config) {
  const fs = require('fs');
  const path = require('path');
  const eventsDir = E.eventsDir(config);
  for (const name of fs.existsSync(eventsDir) ? fs.readdirSync(eventsDir) : []) {
    if (name.endsWith('.jsonl')) { try { fs.unlinkSync(path.join(eventsDir, name)); } catch (e) { /* bỏ qua */ } }
  }
  const snapDir = path.join(config.dataDir, 'snapshots');
  for (const name of fs.existsSync(snapDir) ? fs.readdirSync(snapDir) : []) {
    try { fs.unlinkSync(path.join(snapDir, name)); } catch (e) { /* bỏ qua */ }
  }
  const health = E.healthPath(config);
  if (fs.existsSync(health)) { try { fs.unlinkSync(health); } catch (e) { /* bỏ qua */ } }
}

module.exports = {
  run, status, persist, clearCollected, COLLECTORS, sourceEnabled, retentionOf, prune,
  runDetached, collecting, runKey, RUN_TIMEOUT_MS
};
