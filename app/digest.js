'use strict';

/* =====================================================================
   app/digest.js — Bản tổng hợp một ngày, trả lời ba câu hỏi của DevTrace.

     1. Huynh đã làm gì?            -> blocks, projects, timeline
     2. Huynh đã tạo ra kết quả gì? -> outcomes (commit, tệp, việc còn dở)
     3. Học gì và mai làm gì?       -> learning, frictions, nextSteps

   Tầng này vẫn chưa gọi AI. Nó chỉ gom và tính. AI (nếu huynh bật) sẽ đọc
   đúng bản tổng hợp này rồi viết lại thành lời — nhờ vậy câu chữ có thể
   khác, nhưng con số thì không thể bịa.
   ===================================================================== */

const E = require('./events');
const R = require('./correlate');
const U = require('./util');
const Plans = require('./plans');
const Alerts = require('./alerts');

const TOP = 6;

/* Những dấu hiệu cho thấy có điều gì đó còn dở hoặc đáng nghi. */
function frictions(evidence) {
  const out = [];
  for (const event of evidence.work) {
    if (event.source === 'codex' && event.kind === 'turn' && event.meta && event.meta.error) {
      out.push({
        type: 'lượt bị ngắt', at: event.ts, project: event.projectName, weight: 3,
        note: (event.meta.prompt ? '“' + event.meta.prompt.slice(0, 80) + '” — ' : '') + event.meta.error
      });
    }
    if (event.source === 'git' && event.kind === 'worktree') {
      out.push({
        type: 'chưa ghi lại', at: event.ts, project: event.projectName, weight: 2,
        note: event.title + ' (' + event.detail + ')'
      });
    }
  }
  for (const project of evidence.projects) {
    if (project.blocked) {
      out.push({ type: 'dự án vướng', at: null, project: project.project, weight: 2, note: project.blocked + ' lượt làm việc bị lỗi hoặc bị ngắt' });
    }
  }
  return out.sort((a, b) => b.weight - a.weight || (b.at || 0) - (a.at || 0)).slice(0, 8);
}

/* Câu hỏi còn bỏ ngỏ: suy ra từ bằng chứng, không phải từ cảm giác. */
function openQuestions(evidence) {
  const out = [];
  for (const event of evidence.work) {
    if (event.source === 'codex' && event.kind === 'turn') {
      const prompt = (event.meta && event.meta.prompt) || '';
      if (/[?？]|tại sao|vì sao|lỗi|không chạy|sai|why|error/i.test(prompt) && prompt.length > 12) {
        out.push({ at: event.ts, project: event.projectName, text: prompt.slice(0, 140) });
      }
    }
  }
  for (const project of evidence.projects) {
    if (project.files.length && !project.commits.length) {
      out.push({
        at: project.files.length ? project.files[project.files.length - 1].ts : null,
        project: project.project,
        text: 'đã sửa ' + project.files.length + ' tệp nhưng chưa có commit nào — phần việc này còn dở'
      });
    }
  }
  return out.slice(0, TOP);
}

/* Việc nên làm ngày mai, xếp theo mức độ cụ thể. */
function nextSteps(config, evidence, day) {
  const out = [];
  for (const project of evidence.projects) {
    if (project.files.length && !project.commits.length) {
      out.push({ weight: 3, project: project.project, text: 'Xem lại ' + project.files.length + ' tệp vừa sửa và chốt lại thành một commit có ý nghĩa' });
    }
    if (project.blocked) {
      out.push({ weight: 4, project: project.project, text: 'Giải quyết ' + project.blocked + ' lượt làm việc còn dở trước khi mở việc mới' });
    }
    if (project.aiTurns >= 5 && !project.commits.length && !project.files.length) {
      out.push({ weight: 2, project: project.project, text: 'Phiên AI dài nhưng chưa thấy kết quả trong mã nguồn — kiểm tra xem đã lưu lại gì chưa' });
    }
  }
  // Dự án có hoạt động hôm qua mà hôm nay im lặng: dễ bị bỏ quên.
  const yesterday = U.shiftDay(day, -1);
  const before = R.evidence(config, yesterday);
  for (const project of before.projects) {
    if (!project.aiTurns && !project.files.length) continue;
    const today = evidence.projects.find((p) => p.project === project.project);
    if (!today) out.push({ weight: 2, project: project.project, text: 'Hôm qua có làm nhưng hôm nay chưa đụng tới — quyết định bỏ hay tiếp' });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, TOP);
}

function topDocs(evidence) {
  const map = new Map();
  for (const event of evidence.work) {
    if (event.source !== 'browser') continue;
    const host = event.meta && event.meta.host;
    if (!host) continue;
    const entry = map.get(host) || { host, visits: 0, category: event.meta.category, titles: [] };
    entry.visits++;
    if (entry.titles.length < 3 && event.title) entry.titles.push(event.title.slice(0, 80));
    map.set(host, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.visits - a.visits).slice(0, 8);
}

function categoryTotals(evidence) {
  const out = { 'học': 0, 'giải trí': 0, 'khác': 0 };
  for (const event of evidence.work) {
    if (event.source !== 'browser' || event.kind !== 'visit') continue;
    const category = (event.meta && event.meta.category) || 'khác';
    out[category] = (out[category] || 0) + 1;
  }
  return out;
}

/* So sánh với những ngày trước để biết đang tiến hay lùi. */
function momentum(config, day, days) {
  const span = days || 7;
  const series = [];
  for (let i = span; i >= 1; i--) {
    const key = U.shiftDay(day, -i);
    const ev = R.evidence(config, key);
    series.push({
      day: key, minutes: ev.minutes, aiTurns: ev.totals.aiTurns, files: ev.totals.files,
      commits: ev.totals.commits, docs: ev.totals.docs, events: ev.work.length
    });
  }
  const active = series.filter((s) => s.events > 0);
  const average = (pick) => (active.length ? Math.round(U.sum(active, pick) / active.length) : 0);
  let streak = 0;
  for (let i = 1; i <= 60; i++) {
    const key = U.shiftDay(day, -i);
    const ev = R.evidence(config, key);
    const busy = ev.totals.aiTurns > 0 || ev.totals.files > 0 || ev.totals.commits > 0;
    if (!busy) break;
    streak++;
  }
  return {
    series,
    averageMinutes: average((s) => s.minutes),
    averageAiTurns: average((s) => s.aiTurns),
    averageFiles: average((s) => s.files),
    streakDays: streak
  };
}

/* Độ phủ bằng chứng: nguồn nào có đóng góp cho ngày này, nguồn nào im lặng.

   Mục đích không phải khoe thêm một con số, mà để người đọc biết bức tranh
   còn thiếu gì. "Hôm nay không có commit" và "hôm nay không đọc được git"
   là hai chuyện rất khác nhau, mà nhìn vào bảng số liệu thì giống hệt nhau.
   Ở đây nói thẳng cái nào im lặng và vì sao. */
function coverage(config, evidence, day) {
  const counts = {};
  for (const event of evidence.work) counts[event.source] = (counts[event.source] || 0) + 1;
  const health = E.readHealth(config) || {};

  const rows = Object.keys(E.SOURCES).map((name) => {
    const info = E.SOURCES[name];
    const settings = (config.sources || {})[name] || {};
    const entry = (health.sources || {})[name] || null;
    return {
      name,
      label: info.label,
      kind: info.kind,
      evidence: info.evidence,
      enabled: settings.enabled !== false,
      events: counts[name] || 0,
      // Vì sao im lặng: lỗi đọc, hay ghi chú của chính bộ thu thập.
      reason: entry && entry.error ? entry.error
        : (entry && entry.notes && entry.notes.length ? String(entry.notes[0]) : null)
    };
  });

  /* "Im lặng" chỉ tính những nguồn ĐÁNG LẼ phải có dữ liệu:
     - nguồn đã tắt thì không được kỳ vọng chạy;
     - nguồn "Tự ghi" là ghi chú huynh tự thêm, rỗng là chuyện bình thường;
     - nguồn có ghi chú giải thích (chưa cấu hình, không thấy thư mục) thì
       lý do đã rõ ràng, không cần kể thêm là im lặng. */
  const silent = rows.filter((row) => row.enabled && row.events === 0
    && row.kind !== 'manual' && !row.reason)
    .map((row) => ({ name: row.name, label: row.label }));
  const contributing = rows.filter((row) => row.events > 0);

  return {
    day,
    rows,
    contributing: contributing.length,
    total: rows.length,
    silent,
    // Câu này đi thẳng vào gói bằng chứng gửi cho AI, để nó cũng biết chỗ trống.
    note: contributing.length
      ? 'Ngày này có ' + contributing.length + '/' + rows.length + ' nguồn đóng góp bằng chứng.'
        + (silent.length ? ' Im lặng: ' + silent.map((s) => s.label).join(', ') + '.' : '')
      : 'Ngày này không nguồn nào đóng góp bằng chứng — mọi con số bằng 0 vì thiếu dữ liệu, không phải vì không có việc gì.'
  };
}

/* Một chỗ duy nhất gom mọi điều đáng lưu ý của một ngày.

   Vì sao gom ở đây mà không gom ở tầng giao diện: gói bằng chứng gửi cho AI
   được dựng thẳng từ hàm build() này. Gom ở đây thì AI nhìn thấy ĐÚNG danh
   sách mà huynh nhìn thấy — không còn cảnh AI viết rất tự tin trong khi màn
   hình đang báo có chuyện không ổn.

   Không phải mục nào cũng là lỗi. Phần lớn chỉ là "nguồn này đang tắt" hoặc
   "ngày này nguồn kia không có dữ liệu" — vẫn phải nói ra, nhưng nói ở mức
   nhẹ, vì hù người đọc bằng chuyện bình thường thì lần sau họ bỏ qua cảnh
   báo thật. */
function warnings(config, evidence, day, parts) {
  const out = [];
  const frictionsList = (parts && parts.frictions) || [];
  const coverageObj = (parts && parts.coverage) || coverage(config, evidence, day);

  /* Cảnh báo từ KẾ HOẠCH của huynh, do `app/alerts.js` gom.

     Chúng đi vào đây chứ không được giao diện tự thêm, vì `build()` là chỗ
     dựng gói bằng chứng gửi cho AI: đi qua đây thì AI nhìn thấy đúng danh
     sách huynh nhìn thấy. Thêm ở tầng giao diện thì AI viết trơn tru trong
     khi màn hình đang đỏ. */
  for (const alert of (parts && parts.alerts) || []) {
    out.push({
      level: alert.level || 'info',
      kind: alert.kind || 'plan',
      source: alert.source || null,
      title: alert.title,
      detail: alert.detail || null,
      at: alert.at || null,
      project: alert.project || null,
      weight: alert.weight == null ? 0 : alert.weight
    });
  }

  /* Điểm vướng cùng loại cũng được gom khi có nhiều. Một buổi chiều sửa dở
     năm kho khác nhau cho ra năm dòng "chưa ghi lại" giống hệt nhau — đúng về
     mặt dữ liệu, nhưng người đọc chỉ cần biết một điều: năm kho đang dở. */
  const byType = new Map();
  for (const f of frictionsList) {
    const list = byType.get(f.type) || [];
    list.push(f);
    byType.set(f.type, list);
  }
  for (const [type, list] of byType) {
    if (list.length <= 2) {
      for (const f of list) {
        out.push({
          level: f.weight >= 3 ? 'bad' : 'warn', kind: 'friction', source: null,
          title: f.type, detail: f.note, at: f.at, project: f.project, weight: f.weight
        });
      }
    } else {
      const worst = list.slice().sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
      out.push({
        level: worst.weight >= 3 ? 'bad' : 'warn', kind: 'friction', source: null,
        title: type + ' — ' + list.length + ' chỗ',
        detail: list.map((f) => (f.project ? f.project + ': ' : '') + f.note).join(' · '),
        at: list[0].at, project: null, weight: worst.weight,
        count: list.length, projects: list.map((f) => f.project).filter(Boolean)
      });
    }
  }

  /* Chỗ trống được GOM LẠI, không kể từng nguồn một.

     Một ngày bình thường có thể có sáu nguồn cùng im lặng, và sáu dòng "ngày
     này không có dữ liệu" nói đúng một điều giống hệt nhau — đó là loại thông
     tin khiến người đọc thôi không đọc nữa. Gom thành một dòng kèm tên các
     nguồn thì vẫn đủ để biết chuyện gì, mà không lấn át những cảnh báo thật. */
  const silent = [];
  const off = [];
  for (const row of coverageObj.rows) {
    if (!row.enabled) off.push(row);
    else if (row.kind === 'manual') continue;
    else if (row.events === 0) silent.push(row);
  }
  if (off.length) {
    out.push({
      level: 'info', kind: 'gap', source: null, weight: 0, at: null,
      title: off.length + ' nguồn đang tắt trong Cài đặt',
      detail: off.map((r) => r.label).join(', ')
    });
  }
  if (silent.length) {
    // Có nguồn im lặng mà không nêu được lý do là chuyện khác hẳn với nguồn
    // im lặng vì lý do đã biết (chưa cài, chưa dùng hôm nay).
    const unexplained = silent.filter((r) => !r.reason);
    out.push({
      level: unexplained.length ? 'warn' : 'info', kind: 'gap', source: null,
      weight: unexplained.length ? 1 : 0, at: null,
      title: silent.length + ' nguồn không ghi được gì trong ngày này',
      detail: silent.map((r) => r.label + (r.reason ? ' (' + r.reason + ')' : '')).join('; ')
        + '. Vắng dữ liệu không có nghĩa là hôm đó không làm gì.'
    });
  }

  /* Sức khoẻ nguồn là chuyện của lần thu thập gần nhất, không phải của riêng
     ngày đang xem — nhưng nó vẫn là điều đáng nói, và nói ở đây thì huynh
     không phải mở màn "Nguồn" mới thấy.

     Chỉ nói khi có chuyện. Một nguồn chạy tốt và có đóng góp trong ngày thì
     danh sách ghi chú của nó (mỗi kho một dòng, có kho hai mươi kho) là bản
     kiểm kê, không phải cảnh báo — đổ hết vào đây thì thẻ cảnh báo dài hơn cả
     trang, và huynh thôi không đọc nó nữa. Bản kiểm kê vẫn còn nguyên ở màn
     "Nguồn" và ở lịch sử thu thập. */
  const health = (E.readHealth(config) || {}).sources || {};
  const eventsOf = {};
  coverageObj.rows.forEach((r) => { eventsOf[r.name] = r.events; });
  for (const name of Object.keys(health)) {
    const entry = health[name] || {};
    if (entry.ok === false) {
      out.push({
        level: 'bad', kind: 'source', source: name, weight: 9, at: entry.lastRun || null,
        title: (entry.label || name) + ' báo lỗi',
        detail: [entry.error, (entry.notes || []).join('; ')].filter(Boolean).join(' — ') || null
      });
    } else if (entry.notes && entry.notes.length && eventsOf[name] === 0) {
      // KHÔNG kể lại ở đây. Nguồn im lặng đã được gom một dòng phía trên, và
      // lý do trong dòng đó chính là ghi chú đầu tiên của nguồn — kể thêm là
      // nói hai lần đúng một chuyện, bằng hai câu chữ khác nhau.
      continue;
    }
  }

  const order = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) =>
    (order[a.level] === undefined ? 3 : order[a.level]) - (order[b.level] === undefined ? 3 : order[b.level])
    || (b.weight || 0) - (a.weight || 0));
}

function build(config, day) {
  const evidence = R.evidence(config, day);
  const blocks = evidence.blocks.map((block) => ({
    start: block.start, end: block.end, minutes: Math.round(block.ms / 60000),
    project: block.project, counts: block.counts, projects: block.projects,
    headline: block.events.filter((e) => e.source !== 'browser').slice(0, 4).map((e) => e.title).filter(Boolean)
  }));

  const outcomes = {
    commits: evidence.work.filter((e) => e.source === 'git' && e.kind === 'commit')
      .map((e) => ({ ts: e.ts, project: e.projectName, title: e.title, detail: e.detail, id: e.id })),
    files: evidence.work.filter((e) => e.source === 'files' && e.kind === 'change')
      .sort((a, b) => b.ts - a.ts).slice(0, 24)
      .map((e) => ({ ts: e.ts, project: e.projectName, title: e.title, detail: e.detail, inferred: !!e.inferred })),
    uncommitted: evidence.work.filter((e) => e.source === 'git' && e.kind === 'worktree')
      .map((e) => ({ project: e.projectName, detail: e.detail }))
  };

  /* Tính một lần rồi dùng lại. Bản cũ tính frictions và coverage riêng lẻ,
     còn giao diện thì tự dựng lại danh sách chỗ trống theo cách của nó — hai
     bên lệch nhau. Giờ chỉ còn một nguồn sự thật. */
  const frictionsList = frictions(evidence);
  const coverageObj = coverage(config, evidence, day);

  /* Đối chiếu kế hoạch với thực tế. Đây là chỗ DevTrace thôi kể lại quá khứ
     và bắt đầu nói được câu "hôm nay định làm gì, thực tế lệch chỗ nào".

     Cắt bớt hình dạng trước khi trả ra: `Plans.compareSessions` trả về khá
     nhiều trường nội bộ (mốc milli-giây, đường dẫn dự án), mà thứ dùng thật
     chỉ là giờ, tên buổi và mấy con số phút. Giữ nguyên cả gói thì giao diện
     phải tự lọc, và gói gửi cho AI phình lên vì những trường không ai đọc.

     `note` đi theo bắt buộc, không phải cho đẹp: đó là câu nói thẳng rằng
     ngày không có dấu vết thì KHÔNG phải ngày không làm gì. Bỏ nó đi thì
     một danh sách toàn buổi `no-evidence` đọc ra y hệt một danh sách toàn
     buổi bị bỏ lỡ — và đó là cách nói dối dễ xảy ra nhất ở đây. */
  const scheduleObj = Plans.schedule(config, day, evidence);
  const schedule = {
    weekday: scheduleObj.weekday,
    weekdayLabel: scheduleObj.weekdayLabel,
    hasEvidence: scheduleObj.hasEvidence,
    plannedMinutes: scheduleObj.plannedMinutes,
    matchedMinutes: scheduleObj.matchedMinutes,
    unaccountedMinutes: scheduleObj.unaccountedMinutes,
    counts: scheduleObj.counts,
    note: scheduleObj.note,
    sessions: scheduleObj.sessions.map((s) => ({
      id: s.id, title: s.title, start: s.start, end: s.end,
      kind: s.kind, project: s.projectName,
      plannedMinutes: s.plannedMinutes, matchedMinutes: s.matchedMinutes,
      unaccountedMinutes: s.unaccountedMinutes, status: s.status
    }))
  };

  return {
    day,
    generatedAt: Date.now(),
    window: blocks.length ? { start: blocks[0].start, end: blocks[blocks.length - 1].end } : null,
    minutes: evidence.minutes,
    totals: evidence.totals,
    blocks,
    projects: evidence.projects.map((p) => ({
      project: p.project, minutes: p.minutes, events: p.events, aiSessions: p.aiSessions,
      aiTurns: p.aiTurns, files: p.files.length, commits: p.commits.length,
      docVisits: p.docVisits, blocked: p.blocked, tokens: p.tokens
    })),
    links: evidence.links.slice(0, 12),
    outcomes,
    schedule,
    learning: { docs: topDocs(evidence), categories: categoryTotals(evidence) },
    frictions: frictionsList,
    openQuestions: openQuestions(evidence),
    nextSteps: nextSteps(config, evidence, day),
    momentum: momentum(config, day, 7),
    counts: evidence.counts,
    coverage: coverageObj,
    warnings: warnings(config, evidence, day, {
      frictions: frictionsList,
      coverage: coverageObj,
      alerts: Alerts.gather(config, day)
    }),
    internalEvents: evidence.totals.internal
  };
}

module.exports = { build, frictions, openQuestions, nextSteps, momentum, topDocs, categoryTotals, coverage, warnings };
