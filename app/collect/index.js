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
  window: require('./window'),
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
  return { sources: list, days: days.length, latest: days.length ? days[days.length - 1] : null, updatedAt: health.updatedAt || null };
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

module.exports = { run, status, persist, clearCollected, COLLECTORS, sourceEnabled, retentionOf, prune };
