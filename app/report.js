'use strict';

/* =====================================================================
   app/report.js — Các phép gộp dữ liệu phục vụ giao diện.

   Tách riêng khỏi server.js để có thể kiểm thử mà không cần mở cổng mạng.
   ===================================================================== */

const E = require('./events');
const R = require('./correlate');
const U = require('./util');

function publicConfig(config) {
  const clean = JSON.parse(JSON.stringify(config));
  delete clean.root;
  delete clean.file;
  return clean;
}

function projectLabels(config, work) {
  const projects = new Set();
  for (const event of work) {
    const name = R.projectLabel(config, event.project);
    if (name) projects.add(name);
  }
  return Array.from(projects).slice(0, 4);
}

function daySummary(config, day) {
  const events = E.readDay(config, day);
  const counts = {};
  for (const event of events) counts[event.source] = (counts[event.source] || 0) + 1;
  const work = events.filter((e) => !(e.meta && e.meta.internal));
  return {
    day, events: work.length, internal: events.length - work.length, counts,
    minutes: R.activeMinutes(work),
    projects: projectLabels(config, work)
  };
}

function filteredEvents(config, day, query) {
  let events = E.readDay(config, day);
  const source = query.get('source');
  const kind = query.get('kind');
  if (source) events = events.filter((e) => e.source === source);
  if (kind) events = events.filter((e) => e.kind === kind);
  if (query.get('internal') !== '1') events = events.filter((e) => !(e.meta && e.meta.internal));
  const q = (query.get('q') || '').trim().toLowerCase();
  if (q) events = events.filter((e) => ((e.title || '') + ' ' + (e.detail || '')).toLowerCase().indexOf(q) !== -1);
  const limit = Math.min(Number(query.get('limit')) || 300, 2000);
  return events.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/* Gộp bằng chứng nhiều ngày theo dự án — dùng cho màn "Dự án". */
function projectsRange(config, days) {
  const until = U.dayKey(Date.now(), config.dayStartHour);
  const span = Math.max(1, Math.min(Number(days) || 14, 365));
  const from = U.shiftDay(until, -(span - 1));
  const map = new Map();
  let totalEvents = 0;
  const usedDays = new Set();

  for (const day of E.listDays(config)) {
    if (day < from || day > until) continue;
    const evidence = R.evidence(config, day);
    if (!evidence.work.length) continue;
    usedDays.add(day);
    totalEvents += evidence.work.length;

    for (const project of evidence.projects) {
      if (!map.has(project.project)) {
        map.set(project.project, {
          project: project.project, minutes: 0, events: 0, aiTurns: 0, aiSessions: 0,
          files: 0, commits: 0, docVisits: 0, blocked: 0, days: new Set(), highlights: []
        });
      }
      const entry = map.get(project.project);
      entry.minutes += project.minutes;
      entry.events += project.events;
      entry.aiTurns += project.aiTurns;
      entry.aiSessions += project.aiSessions;
      entry.files += project.files.length;
      entry.commits += project.commits.length;
      entry.docVisits += project.docVisits;
      entry.blocked += project.blocked;
      if (project.events > 2) entry.days.add(day);
      for (const commit of project.commits) {
        entry.highlights.push({ day, at: commit.ts, title: commit.title, detail: commit.detail });
      }
    }

    for (const event of evidence.work) {
      if (event.source !== 'codex' || event.kind !== 'turn' || !event.projectName) continue;
      const entry = map.get(event.projectName);
      if (entry) entry.highlights.push({ day, at: event.ts, title: String(event.title || '').slice(0, 90), detail: 'lượt Codex' });
    }
  }

  const projects = Array.from(map.values()).map((entry) => {
    entry.activeDays = entry.days.size;
    delete entry.days;
    entry.highlights = entry.highlights.sort((a, b) => b.at - a.at).slice(0, 8);
    return entry;
  }).sort((a, b) => (b.minutes + b.files * 2 + b.commits * 5) - (a.minutes + a.files * 2 + a.commits * 5));

  return { days: usedDays.size, totalEvents, from, until, projects };
}

module.exports = { publicConfig, daySummary, filteredEvents, projectsRange, projectLabels };
