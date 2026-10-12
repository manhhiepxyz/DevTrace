'use strict';

/* =====================================================================
   app/collect/github.js — Hoạt động trên tài khoản GitHub.

   Git trên máy trả lời được "đã tạo ra kết quả gì", nhưng chỉ trong những
   kho có trên đĩa này. Nó không thấy pull request, issue, review, hay việc
   được người khác sao — những thứ chỉ tồn tại trên GitHub.

   BỐN RÀNG BUỘC, và lý do của từng cái:

   1. MẶC ĐỊNH TẮT. Đây là nguồn DUY NHẤT trong DevTrace gửi dữ liệu ra khỏi
      máy khi thu thập (app/ai.js chỉ gửi khi huynh bấm tổng kết). Một nguồn
      tự bật rồi tự gọi mạng là chuyện huynh phải tự chọn.

   2. KHOÁ CHỈ ĐƯỢC NHẮC TÊN, KHÔNG BAO GIỜ ĐƯỢC LƯU. Cấu hình giữ
      `tokenEnv` — TÊN của biến môi trường — đúng như cách ai.apiKeyEnv đang
      làm. Giá trị khoá không đi vào devtrace.config.json, không đi vào
      health.json, không đi vào ghi chú. `publicConfig` (app/report.js) là
      cửa duy nhất chặn rò rỉ và nó chỉ xoá `clean.root` với `clean.file` —
      nên bất cứ thứ gì lọt vào cấu hình là lọt ra ngoài.

   3. KHÔNG BAO GIỜ TỰ XOÁ. Đây là nguồn DÒNG CHẢY (ghi thêm, khử trùng theo
      id), không phải nguồn suy-ra-được. API sự kiện công khai của GitHub chỉ
      trả về khoảng 90 ngày gần nhất; nếu tính lại từ đầu thì mỗi lần thu
      thập lại là một lần xoá những gì đã rơi ra khỏi cửa sổ đó. Bằng chứng
      đã thấy một lần thì ở lại.

   4. CÓ KHE CẮM MẠNG. `opts.fetchJson` cho bài kiểm thử chạy hết đường đi
      mà không gọi mạng lần nào — bộ kiểm thử phải chạy được ngoại tuyến.
   ===================================================================== */

const { execFileSync } = require('child_process');
const path = require('path');

const FETCH_SCRIPT = path.join(__dirname, 'github-fetch.js');

/* Một lần gọi mạng thật, bằng tiến trình Node con. Xem github-fetch.js để
   biết vì sao lại là tiến trình riêng. */
function fetchViaChild(url, tokenEnv) {
  try {
    const out = execFileSync(process.execPath, [FETCH_SCRIPT, url, tokenEnv || ''], {
      encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, env: process.env
    });
    return JSON.parse(out);
  } catch (error) {
    return { status: 0, body: String((error && error.message) || error) };
  }
}

/* Từ loại sự kiện của GitHub sang cách gọi của DevTrace. Giữ nguyên tên gốc
   trong `meta.type` để còn đối chiếu với tài liệu GitHub. */
const KINDS = {
  PushEvent: { kind: 'push', weight: 3, verb: 'Đẩy mã lên' },
  PullRequestEvent: { kind: 'pr', weight: 3, verb: 'Pull request' },
  PullRequestReviewEvent: { kind: 'review', weight: 2, verb: 'Duyệt pull request' },
  PullRequestReviewCommentEvent: { kind: 'review', weight: 2, verb: 'Bình luận khi duyệt' },
  IssuesEvent: { kind: 'issue', weight: 2, verb: 'Issue' },
  IssueCommentEvent: { kind: 'comment', weight: 1, verb: 'Bình luận issue' },
  CreateEvent: { kind: 'create', weight: 1, verb: 'Tạo' },
  DeleteEvent: { kind: 'delete', weight: 1, verb: 'Xoá' },
  ReleaseEvent: { kind: 'release', weight: 3, verb: 'Phát hành' },
  ForkEvent: { kind: 'fork', weight: 1, verb: 'Sao chép kho' },
  WatchEvent: { kind: 'star', weight: 1, verb: 'Đánh dấu sao' },
  PublicEvent: { kind: 'public', weight: 2, verb: 'Công khai kho' }
};

function repoOf(event) {
  const repo = event.repo && event.repo.name;
  if (repo) return repo;
  const payload = event.payload || {};
  if (payload.repository && payload.repository.full_name) return payload.repository.full_name;
  return null;
}

/* Mô tả một sự kiện bằng tiếng Việt, và nói rõ NÓ ĐẾN TỪ ĐÂU. Một dòng
   "Đẩy mã lên" không cho biết là đẩy lên nhánh nào hay đẩy bao nhiêu commit;
   mà đó lại đúng là thứ phân biệt một buổi làm việc thật với một cú nhấp
   nhầm. Không có gì để nói thì nói thẳng là không có, đừng bịa. */
function describe(event, verb) {
  const payload = event.payload || {};
  switch (event.type) {
    case 'PushEvent': {
      const commits = payload.commits || [];
      const branch = String(payload.ref || '').replace('refs/heads/', '');
      const last = commits.length ? commits[commits.length - 1].message : '';
      return {
        title: verb + ' ' + commits.length + ' commit' + (branch ? ' lên nhánh ' + branch : ''),
        detail: String(last || '').split('\n')[0].slice(0, 160)
      };
    }
    case 'PullRequestEvent': {
      const pr = payload.pull_request || {};
      return {
        title: verb + ' #' + (pr.number || payload.number || '?') + ' — ' + String(payload.action || ''),
        detail: String(pr.title || '').slice(0, 160)
      };
    }
    case 'IssuesEvent': {
      const issue = payload.issue || {};
      return {
        title: verb + ' #' + (issue.number || '?') + ' — ' + String(payload.action || ''),
        detail: String(issue.title || '').slice(0, 160)
      };
    }
    case 'IssueCommentEvent': {
      const issue = payload.issue || {};
      const comment = payload.comment || {};
      return {
        title: 'Bình luận ở #' + (issue.number || '?') + ' (' + String(issue.title || '').slice(0, 70) + ')',
        detail: String(comment.body || '').split('\n')[0].slice(0, 160)
      };
    }
    case 'CreateEvent':
    case 'DeleteEvent':
      return { title: verb + ' ' + String(payload.ref_type || 'kho') + ' ' + String(payload.ref || ''), detail: '' };
    case 'ReleaseEvent': {
      const release = payload.release || {};
      return { title: verb + ' ' + String(release.tag_name || ''), detail: String(release.name || '').slice(0, 160) };
    }
    case 'ForkEvent':
      return { title: verb, detail: String((payload.forkee && payload.forkee.full_name) || '') };
    case 'WatchEvent':
      return { title: verb, detail: '' };
    default:
      return { title: verb, detail: '' };
  }
}

/* Đổi mảng sự kiện thô của GitHub thành sự kiện của DevTrace.
   Hàm thuần: không mạng, không đĩa, nên kiểm thử được bằng dữ liệu mẫu. */
function toEvents(raw, limit) {
  const out = [];
  let skipped = 0;
  for (const event of Array.isArray(raw) ? raw : []) {
    const ts = Date.parse(event && event.created_at);
    if (!event || !event.id || !isFinite(ts)) { skipped++; continue; }
    const info = KINDS[event.type] || { kind: 'other', weight: 1, verb: String(event.type || 'Hoạt động') };
    const text = describe(event, info.verb);
    out.push({
      source: 'github',
      kind: info.kind,
      ts,
      // id lấy từ GitHub: ổn định qua mọi lần thu thập, nên ghi thêm bao nhiêu
      // lần cũng không nhân đôi.
      id: 'github:' + event.id,
      project: repoOf(event),
      title: text.title.slice(0, 160) || info.verb,
      detail: text.detail || '',
      weight: info.weight,
      meta: {
        type: event.type,
        actor: (event.actor && event.actor.login) || null,
        repo: repoOf(event),
        // `public` cho biết sự kiện này lấy được từ API công khai hay nhờ khoá.
        public: true
      }
    });
    if (limit && out.length >= limit) break;
  }
  return { events: out, skipped };
}

function collect(config, opts) {
  const settings = config.sources.github;
  if (!settings.enabled) return { events: [], notes: ['GitHub: đang tắt'] };

  const user = String(settings.user || '').trim();
  if (!user) {
    return {
      events: [],
      notes: ['GitHub: chưa khai tài khoản cần đọc. Điền sources.github.user trong devtrace.config.json (ví dụ: manhhiepxyz).'],
      complete: false
    };
  }

  const fetchJson = (opts && opts.fetchJson) || fetchViaChild;
  const tokenEnv = String(settings.tokenEnv || 'DEVTRACE_GITHUB_TOKEN');
  const hasToken = !!process.env[tokenEnv];
  const apiBase = String(settings.apiBase || 'https://api.github.com').replace(/\/$/, '');
  const perPage = Math.max(1, Math.min(100, Number(settings.maxItems) || 100));
  const url = apiBase + '/users/' + encodeURIComponent(user) + '/events?per_page=' + perPage;

  const response = fetchJson(url, tokenEnv);
  const notes = [];

  if (!response || response.status === 0) {
    return {
      events: [],
      notes: ['GitHub: không gọi được API — ' + String((response && response.body) || 'không rõ lý do')],
      complete: false
    };
  }
  if (response.status === 404) {
    return {
      events: [],
      notes: ['GitHub: không thấy tài khoản "' + user + '". Sửa sources.github.user cho đúng.'],
      complete: false
    };
  }
  if (response.status !== 200) {
    return {
      events: [],
      notes: ['GitHub: API trả về HTTP ' + response.status +
        (response.note ? ' — ' + response.note : '') + '. ' + String(response.body || '').slice(0, 200)],
      complete: false
    };
  }

  let raw;
  try {
    raw = JSON.parse(response.body);
  } catch (error) {
    return { events: [], notes: ['GitHub: trả về dữ liệu không đọc được — ' + String((error && error.message))], complete: false };
  }

  const mapped = toEvents(raw, Number(settings.maxItems) || 300);
  if (mapped.skipped) notes.push('GitHub: bỏ qua ' + mapped.skipped + ' mục thiếu mã hoặc thiếu thời gian.');

  const oldest = mapped.events.length ? mapped.events[mapped.events.length - 1].ts : 0;
  notes.push('GitHub: ' + mapped.events.length + ' hoạt động của ' + user +
    (oldest ? ' (cũ nhất ' + new Date(oldest).toISOString().slice(0, 10) + ')' : ''));

  /* Nói thẳng hai điều mà con số ở trên không nói được. Thứ nhất: API công
     khai chỉ trả về khoảng 90 ngày gần nhất, nên một tài khoản yên ắng có
     thể trông y hệt một tài khoản đang làm việc trong kho riêng. Thứ hai:
     không có khoá thì không thấy được hoạt động trong kho riêng — mà với
     phần lớn người dùng, đó mới là chỗ có việc thật. */
  if (!hasToken) {
    notes.push('GitHub: đang đọc ở chế độ công khai. Hoạt động trong kho riêng không hiện ra — ' +
      'đặt khoá vào biến môi trường ' + tokenEnv + ' rồi thu thập lại nếu cần.');
  }
  if (mapped.events.length >= perPage) {
    notes.push('GitHub: đã lấy đủ ' + perPage + ' mục của một trang — có thể còn hoạt động cũ hơn chưa lấy.');
  }

  // Dòng chảy: KHÔNG khai `complete`. Nguồn này chỉ ghi thêm, chưa bao giờ
  // thay thế, nên chốt chặn "đọc hụt thì giữ bản cũ" không áp dụng ở đây.
  return { events: mapped.events, notes };
}

module.exports = { collect, toEvents, describe, KINDS, repoOf, fetchViaChild, FETCH_SCRIPT };
