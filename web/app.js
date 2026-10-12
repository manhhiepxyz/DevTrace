/* =====================================================================
   web/app.js — Định tuyến, gọi API, bắt sự kiện.

   Nguyên tắc: màn hình (views.js) chỉ sinh HTML thuần; mọi thứ có trạng
   thái nằm ở đây. Nhờ vậy chỗ nào sai thì biết ngay là sai ở dữ liệu hay
   ở cách hiển thị.
   ===================================================================== */
(function (global) {
  'use strict';

  var Sources = {};      // bảng mô tả nguồn, lấy từ /api/status
  var lastData = {};     // dữ liệu của lần tải gần nhất (dùng lại khi chỉ đổi bộ lọc)
  var lastDataRoute = null; // dữ liệu đang giữ thuộc màn hình nào

  var state = {
    route: 'today',
    day: null,
    range: 14,
    filters: { source: '', q: '' },
    /* Giá trị đã lưu LUÔN thắng. localStorage chỉ được ghi khi huynh tự tay
       đổi ô chọn bảng màu, nên một giá trị nằm sẵn trong đó gần như chắc chắn
       là lựa chọn có ý thức — ghi đè nó là sửa đồ của huynh mà không hỏi.
       Ai chưa từng đổi thì chưa có khoá nào, và nhận bảng màu mới. */
    theme: localStorage.getItem('devtrace.theme') || 'trang',
    lastStatus: null,
    /* Mục nào đang mở trong các khối gấp/mở của màn "Hôm nay".
       Để ở đây chứ không để trong DOM: mỗi lần vẽ, #view bị dựng lại từ đầu,
       nên <details> sẽ tự sập ngay sau lần thu thập kế tiếp. */
    open: {},
    /* Báo cáo của lần thu thập gần nhất. Trước đây phần này bị tính ra rồi
       vứt đi, nên nguồn lỗi và thông báo xoá dữ liệu cũ không ai thấy. */
    lastCollect: null,
    /* Số điều đáng lưu ý của màn đang xem, để gắn huy hiệu lên thanh bên. */
    warningCount: 0
  };

  /* ---- Tiện ích ---- */

  /* Thoát ký tự HTML. Mọi chỗ nội suy dữ liệu vào chuỗi HTML đều phải đi qua
     đây — kể cả nội dung trong <textarea>. Trước đây nội dung nhật ký được
     nhét thẳng vào thẻ, nên một tệp nhật ký chứa "</textarea><script>…" là
     chạy được mã trong trang, và nhật ký thì huynh dán từ bất kỳ đâu vào. */
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function palette() {
    var style = getComputedStyle(document.body);
    function v(name) { return style.getPropertyValue(name).trim() || '#888'; }
    return {
      bg: v('--bg'), panel: v('--panel'), line: v('--line'), ink: v('--ink'), muted: v('--muted'),
      cinabar: v('--cinabar'), jade: v('--jade'), indigo: v('--indigo'), gold: v('--gold'), plum: v('--plum')
    };
  }

  function toast(message, kind) {
    var root = $('#toastRoot');
    var node = document.createElement('div');
    node.className = 'toast' + (kind ? ' ' + kind : '');
    node.textContent = message;
    root.appendChild(node);
    setTimeout(function () { node.remove(); }, 5200);
  }

  function api(path, options) {
    var opts = options || {};
    return fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).catch(function (error) {
      // Phân biệt "không gọi được máy chủ" với "máy chủ trả lỗi": hai chuyện
      // khác hẳn nhau và phải hiện thông báo khác nhau.
      var wrapped = new Error('Không gọi được máy chủ DevTrace (' + (error && error.message) + ').');
      wrapped.network = true;
      throw wrapped;
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || ('Lỗi ' + response.status));
        return data;
      });
    });
  }

  /* ---- Định tuyến ---- */

  function parseHash() {
    var raw = String(location.hash || '').replace(/^#\/?/, '');
    var parts = raw.split('/');
    var route = parts[0] || 'today';
    if (!global.Views[route]) route = 'today';
    return { route: route, param: parts[1] || '' };
  }

  function go(route, param) {
    location.hash = '#/' + route + (param ? '/' + param : '');
  }

  /* ---- Tải dữ liệu theo màn hình ---- */

  function loadFor(route) {
    if (route === 'today') {
      /* Kế hoạch, sức khoẻ kho và hộp thư đi kèm màn Hôm nay vì chúng là mấy
         nửa của cùng một câu hỏi: "định làm gì", "kho mã đang thế nào", "còn
         nợ ai câu trả lời". Tách ra gọi riêng thì màn hình vẽ xong mới có dữ
         liệu, và người đọc thấy nó nhảy.

         `/api/mail` là tuyến DUY NHẤT mang tiêu đề thư ra khỏi máy chủ, và nó
         chỉ đi tới đây — màn hình của chính huynh. Đừng đưa dữ liệu này vào
         chỗ nào khác. */
      return Promise.all([
        api('/api/status'),
        api('/api/day/' + state.day),
        api('/api/day/' + state.day + '/journal'),
        api('/api/plans?day=' + state.day),
        api('/api/repohealth'),
        api('/api/mail')
      ]).then(function (out) {
        return {
          status: out[0].status, config: out[0].config, digest: out[1].digest,
          journal: out[2].journal, distribution: distributionOf(out[1].digest),
          plans: out[3], repohealth: out[4], mail: out[5]
        };
      });
    }
    if (route === 'timeline') {
      var query = [];
      if (state.filters.source) query.push('source=' + encodeURIComponent(state.filters.source));
      if (state.filters.q) query.push('q=' + encodeURIComponent(state.filters.q));
      query.push('limit=400');
      return api('/api/day/' + state.day + '/events?' + query.join('&')).then(function (out) { return { events: out.events }; });
    }
    if (route === 'projects') {
      return Promise.all([
        api('/api/projects?days=' + state.range),
        api('/api/repohealth'),
        api('/api/plans?day=' + state.day)
      ]).then(function (out) {
        var data = out[0];
        data.repohealth = out[1];
        data.plans = out[2];
        return data;
      });
    }
    if (route === 'history') {
      return api('/api/days');
    }
    return api('/api/status').then(function (out) { return { status: out.status, config: out.config }; });
  }

  // Phân bố sự kiện theo nguồn, để vẽ vòng tròn.
  function distributionOf(digest) {
    var totals = {};
    Object.keys(digest.counts || {}).forEach(function (key) {
      var source = key.split(':')[0];
      totals[source] = (totals[source] || 0) + digest.counts[key];
    });
    var colors = palette();
    var pick = { codex: colors.plum, browser: colors.jade, files: colors.cinabar, git: colors.cinabar, shell: colors.gold, vscode: colors.indigo, window: colors.indigo };
    return Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; }).map(function (source) {
      return { label: (Sources[source] && Sources[source].label) || source, value: totals[source], color: pick[source] || colors.muted };
    });
  }

  /* ---- Vẽ ---- */

  function applyTheme() {
    document.body.setAttribute('data-theme', state.theme);
    /* Biểu đồ vẽ bằng mã màu hex chứ không đọc được var(--x), nên phải đưa
       bảng màu vừa đổi cho nó. Không có bước này thì đổi sang bảng sáng vẫn
       còn vệt mực đêm trong các hình. */
    if (global.Charts && global.Charts.setDefaults) global.Charts.setDefaults(palette());
  }

  function renderNav() {
    var groups = [
      { title: 'Dấu vết', items: [['today', '今'], ['timeline', '時'], ['projects', '案']] },
      { title: 'Hệ thống', items: [['history', '史'], ['sources', '源'], ['settings', '設']] }
    ];
    var warn = state.warningCount || 0;
    $('#nav').innerHTML = groups.map(function (group) {
      return '<div class="nav-group"><div class="nav-group-title">' + group.title + '</div>' +
        group.items.map(function (item) {
          var view = global.Views[item[0]];
          /* Huy hiệu chỉ hiện ở màn "Hôm nay" — đó là màn duy nhất tổng hợp
             cảnh báo của một ngày. Gắn nó lên cả sáu mục thì nó thành trang
             trí, và người đọc sẽ học cách phớt lờ nó. */
          var badge = (item[0] === 'today' && warn)
            ? '<span class="count warn">' + warn + '</span>' : '';
          return '<button class="nav-item' + (state.route === item[0] ? ' is-active' : '') + '" data-route="' + item[0] + '">' +
            '<span class="han">' + item[1] + '</span><span>' + view.title + '</span>' + badge + '</button>';
        }).join('') + '</div>';
    }).join('');
  }

  function renderStatusChips(status) {
    if (!status) { $('#statusChips').innerHTML = ''; return; }
    var enabled = status.sources.filter(function (s) { return s.enabled; }).length;
    $('#statusChips').innerHTML =
      '<span class="badge">' + enabled + '/' + status.sources.length + ' nguồn</span>' +
      '<span class="badge">' + status.days + ' ngày</span>' +
      (status.latest ? '<span class="badge">mới nhất ' + status.latest.slice(5) + '</span>' : '');
  }

  function render() {
    var view = global.Views[state.route];
    var ctx = { state: state, data: lastData, colors: palette() };

    $('#viewTitle').textContent = view.title;
    $('#viewSubtitle').textContent = typeof view.subtitle === 'function' ? view.subtitle(ctx) : '';

    /* Đếm cảnh báo trước khi vẽ thanh bên, để huy hiệu có số ngay từ nhịp
       đầu. `|| 0` là chốt chặn: ghi ra chữ "undefined" lên giao diện là lỗi
       mà bộ kiểm thử cố tình canh. */
    state.warningCount = (global.Warnings && lastDataRoute === state.route)
      ? (global.Warnings.count(ctx) || 0) : 0;

    var warnBtn = state.warningCount
      ? '<button class="btn btn-sm" data-action="open-warnings">Cảnh báo (' + state.warningCount + ')</button>'
      : '';
    $('#topbarActions').innerHTML = (view.picker
      ? '<div class="row-actions"><input type="date" data-role="day-input" value="' + esc(state.day) + '" style="padding:6px 9px;border-radius:6px;border:1px solid var(--line);background:var(--bg-2);color:var(--ink);font-family:var(--font-mono)">' +
      '<button class="btn btn-sm" data-action="day-prev">←</button><button class="btn btn-sm" data-action="day-next">→</button>' +
      '<button class="btn btn-sm" data-action="day-latest">Mới nhất</button></div>'
      : '<button class="btn btn-primary btn-sm" data-action="collect">Thu thập dấu vết</button>') + warnBtn;

    /* Dữ liệu đang giữ thuộc màn hình khác thì chưa được vẽ. Nếu vẽ liều,
       màn hình sẽ đọc phải trường không tồn tại và vỡ — đúng lỗi đã xảy ra
       ở lần chạy đầu. Thà hiện chỗ chờ còn hơn hiện lỗi. */
    if (lastDataRoute !== state.route) {
      $('#view').innerHTML = '<div class="loading">Đang đọc dấu vết…</div>';
      renderNav();
      renderStatusChips(state.lastStatus);
      return;
    }

    try {
      $('#view').innerHTML = view.render(ctx);
    } catch (error) {
      $('#view').innerHTML = '<div class="card"><h2>Không dựng được màn hình</h2><p class="mono">' + esc(error && error.message) + '</p></div>';
      throw error;
    }
    renderNav();
    renderStatusChips(state.lastStatus);
  }

  function refresh(keepFocus) {
    var view = global.Views[state.route];
    if (view.picker && !state.day) {
      return api('/api/status').then(function (out) {
        state.day = out.status.latest || new Date().toISOString().slice(0, 10);
        return loadFor(state.route);
      }).then(finish);
    }
    return loadFor(state.route).then(finish);

    function finish(data) {
      lastData = data;
      lastDataRoute = state.route;
      if (data.status) state.lastStatus = data.status;
      render();
    }
  }

  /* ---- Điều hướng ngày ---- */

  function shiftDay(delta) {
    var parts = state.day.split('-');
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    date.setDate(date.getDate() + delta);
    state.day = date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2);
    /* Đổi ngày thì đóng hết mục đang mở. Một bảng đang mở mà nói về ngày
       khác là thứ dễ đọc sai nhất trên màn hình này. */
    state.open = {};
    refresh();
  }

  /* ---- Hộp thoại ---- */

  function openModal(title, bodyHtml, actions) {
    var root = $('#modalRoot');
    root.hidden = false;
    root.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><h2>' + esc(title) + '</h2>' +
      '<button class="icon-btn" data-action="close-modal" aria-label="Đóng">✕</button></div>' +
      bodyHtml +
      (actions ? '<div class="spread mt"><span></span><div class="row-actions">' + actions + '</div></div>' : '') +
      '</div>';
  }

  function closeModal() {
    var root = $('#modalRoot');
    root.hidden = true;
    root.innerHTML = '';
  }

  function openJournalEditor(text) {
    openModal('Nhật ký ngày ' + state.day,
      '<div class="field"><label>Nội dung nhật ký</label>' +
      '<textarea id="journalText" style="min-height:240px">' + esc(text || '') + '</textarea>' +
      '<span class="hint">Dán kết quả từ trợ lý AI vào đây, hoặc tự viết. DevTrace lưu kèm ngày và mã tham chiếu.</span></div>',
      '<button class="btn" data-action="journal-prompt">Xem gói bằng chứng</button>' +
      '<button class="btn btn-primary" data-action="journal-save">Lưu nhật ký</button>');
  }

  function openPromptView() {
    api('/api/day/' + state.day + '/pack').then(function (out) {
      openModal('Gói bằng chứng ngày ' + state.day,
        '<p class="card-sub">Đây là toàn bộ dữ liệu DevTrace gửi cho AI: đã nén, có mã tham chiếu, không chứa ảnh chụp màn hình. Huynh có thể dán vào bất kỳ trợ lý nào.</p>' +
        '<div class="field"><label>Lời nhắc kèm bằng chứng</label><textarea id="promptText" readonly style="min-height:300px">' + esc(out.prompt) + '</textarea></div>' +
        '<details><summary class="muted small">Xem gói bằng chứng dạng JSON (' + Math.round(JSON.stringify(out.pack).length / 1024) + ' KB)</summary>' +
        '<pre class="mono tiny" style="max-height:260px;overflow:auto;background:var(--panel-2);padding:10px;border-radius:6px">' + esc(JSON.stringify(out.pack, null, 1)) + '</pre></details>',
        '<button class="btn" data-action="copy-prompt">Sao chép lời nhắc</button>' +
        '<button class="btn" data-action="journal-edit">Tự viết kết quả</button>');
    }).catch(function (error) { toast('Không dựng được gói bằng chứng: ' + error.message, 'bad'); });
  }

  /* ---- Kế hoạch: đọc dữ liệu và dựng biểu mẫu -------------------------

     Nhiệm vụ, buổi và đợt đều đi qua `POST /api/plans/*`. Khi từ chối, máy
     chủ trả mã 400 kèm một câu tiếng Việt — ví dụ khi tệp kế hoạch hỏng và
     DevTrace đang từ chối ghi đè. Câu đó phải tới tai huynh nguyên vẹn, nên
     không nhánh nào ở dưới được nuốt lỗi. */

  function plansData() { return (lastData && lastData.plans) || null; }

  function planTasks() {
    var part = plansData();
    return (part && part.tasks) || [];
  }

  function taskById(id) {
    var found = null;
    if (!id) return null;
    planTasks().forEach(function (t) { if (t && t.id === id) found = t; });
    return found;
  }

  function slotById(id) {
    var found = null;
    var part = plansData();
    ((part && part.timetable) || []).forEach(function (s) { if (s && s.id === id) found = s; });
    return found;
  }

  /* Danh sách dự án huynh tự khai, chép sang dạng tối giản. Gửi lại nguyên
     đối tượng nhận từ máy chủ là gửi kèm cả trường chỉ có nghĩa phía máy
     chủ, rồi lần lưu sau chúng nằm lại trong tệp cấu hình như dữ liệu thừa. */
  function declaredProjects() {
    var list = (lastData.config && lastData.config.declaredProjects) || [];
    return list.map(function (p) { return { id: p.id, name: p.name, path: p.path, kind: p.kind }; });
  }

  function projectList() { return (lastData.config && lastData.config.projects) || []; }

  function projectByPath(p) {
    var found = null;
    projectList().forEach(function (x) { if (x.path === p) found = x; });
    return found;
  }

  function postPlan(route, body) {
    return api(route, { method: 'POST', body: body }).then(function (out) {
      /* Một tệp khác hỏng thì máy chủ vẫn ghi được, nhưng kèm lời nhắc. Hiện
         ngay — nếu không, lần ghi sau bị từ chối mà huynh không hiểu vì sao. */
      (out.warnings || []).forEach(function (w) { toast(w, 'bad'); });
      refresh();
      return out;
    }).catch(function (error) { toast(error.message, 'bad'); });
  }

  function saveDeclared(list, message) {
    return api('/api/config', { method: 'POST', body: { declaredProjects: list } })
      .then(function () { closeModal(); toast(message, 'good'); refresh(); })
      .catch(function (error) { toast(error.message, 'bad'); });
  }

  function val(id) {
    var node = $('#' + id);
    return node ? String(node.value == null ? '' : node.value) : '';
  }

  function fieldHtml(label, inner, hint) {
    return '<div class="field"><label>' + label + '</label>' + inner +
      (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>';
  }

  function optionsHtml(pairs, current) {
    return pairs.map(function (pair) {
      return '<option value="' + esc(pair[0]) + '"' + (String(pair[0]) === String(current) ? ' selected' : '') + '>' +
        esc(pair[1]) + '</option>';
    }).join('');
  }

  function projectOptionsHtml(selectedPath) {
    var html = '<option value="">(không gắn dự án)</option>';
    projectList().forEach(function (p) {
      html += '<option value="' + esc(p.path) + '"' + (p.path === selectedPath ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    });
    return html;
  }

  function basenameOf(p) {
    var parts = String(p || '').split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(p || '');
  }

  /* Cộng ngày trên chuỗi YYYY-MM-DD. Không dùng `Date` cục bộ vì đổi giờ
     mùa hè làm lệch mất một ngày; `Date.UTC` thì không. */
  function shiftDayString(day, delta) {
    var parts = String(day || '').split('-');
    if (parts.length !== 3) return day;
    var ms = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])) + delta * 86400000;
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }

  var HORIZON_TEXT = [['day', 'Trong ngày'], ['week', 'Trong tuần'], ['goal', 'Mục tiêu dài hạn'], ['recurring', 'Việc cố định']];
  var FREQ_TEXT = [['daily', 'Hằng ngày'], ['weekdays', 'Các ngày trong tuần'], ['weekly', 'Theo thứ']];
  var WEEKDAY_OPTS = [[1, 'Thứ Hai'], [2, 'Thứ Ba'], [3, 'Thứ Tư'], [4, 'Thứ Năm'], [5, 'Thứ Sáu'], [6, 'Thứ Bảy'], [7, 'Chủ nhật']];
  var KIND_TEXT = [['deep', 'Việc sâu'], ['study', 'Học'], ['admin', 'Hành chính'], ['break', 'Nghỉ']];

  /* --- Biểu mẫu nhiệm vụ --- */

  /* `mailSubject` là tiêu đề một thư, điền sẵn vào ô nhiệm vụ khi huynh bấm
     “Tạo nhiệm vụ” ở thẻ Hộp thư. Huynh sửa lại trước khi lưu — và một khi đã
     lưu thì đó là CHỮ HUYNH VIẾT, nên nó đi theo gói bằng chứng như mọi nhiệm
     vụ khác. Đây là chỗ DUY NHẤT chữ của người khác có thể nhập vào kho chữ
     của huynh, nên hộp thoại phải nói thẳng điều đó ra. */
  function openTaskEditor(task, horizon, mailSubject) {
    var editing = !!task;
    var h = (task && task.horizon) || horizon || 'day';
    var recur = (task && task.recur) || null;
    var due = (task && (task.dueDay || task.targetDay)) || state.day || '';
    var body =
      fieldHtml('Nhiệm vụ', '<input id="taskTitle" value="' + esc(task ? task.title : (mailSubject || '')) + '" placeholder="Việc này là gì?">') +
      fieldHtml('Tầm nhìn', '<select id="taskHorizon">' + optionsHtml(HORIZON_TEXT, h) + '</select>',
        'Việc trong ngày và việc cố định lặp theo lịch; việc trong tuần và mục tiêu mới xếp được vào đợt làm việc.') +
      fieldHtml('Ngày', '<input id="taskDay" type="date" value="' + esc(due) + '">',
        'Với mục tiêu dài hạn, đây là ngày đích — để trống cũng được.') +
      fieldHtml('Dự án', '<select id="taskProject">' + projectOptionsHtml(task ? task.projectPath : '') + '</select>') +
      fieldHtml('Điểm', '<input id="taskPoints" type="number" min="0" step="1" value="' +
        esc(task && task.points != null ? task.points : '') + '">',
        'Không bắt buộc. Chỉ dùng để tính tốc độ, và tốc độ chỉ hiện sau khi đã đóng đủ hai đợt.') +
      fieldHtml('Kiểu lặp', '<select id="taskFreq">' + optionsHtml(FREQ_TEXT, recur ? recur.freq : 'weekdays') + '</select>',
        'Chỉ có nghĩa với việc cố định.') +
      fieldHtml('Thứ trong tuần', '<input id="taskWeekdays" value="' +
        esc(recur && recur.byWeekday && recur.byWeekday.length ? recur.byWeekday.join(',') : '') +
        '" placeholder="1,3,5">',
        '1 là thứ Hai, 7 là Chủ nhật. Để trống nghĩa là mọi thứ. Chỉ dùng khi kiểu lặp là “theo thứ”.') +
      fieldHtml('Ghi chú', '<textarea id="taskNote" style="min-height:70px">' + esc(task ? task.note : '') + '</textarea>');
    openModal(editing ? 'Sửa nhiệm vụ' : (mailSubject ? 'Tạo nhiệm vụ từ thư' : 'Thêm nhiệm vụ'),
      (mailSubject
        ? '<p class="card-sub">Ô nhiệm vụ đã điền sẵn tiêu đề thư. Sửa lại thành việc của chính huynh trước khi lưu — ' +
          'một khi đã lưu thì đây là <b>chữ huynh viết</b>, và nó sẽ đi cùng gói bằng chứng tới AI nếu huynh bật AI. ' +
          'Không sửa gì mà bấm lưu nghĩa là chữ của người khác đi theo gói đó.</p>' : '') + body,
      (editing ? '<button class="btn" data-action="plan-delete" data-value="' + esc(task.id) + '">Xoá</button>' : '') +
      '<button class="btn btn-primary" data-action="plan-save"' +
      (editing ? ' data-value="' + esc(task.id) + '"' : '') + '>Lưu</button>');
  }

  /* --- Biểu mẫu buổi --- */

  function openSlotEditor(slot) {
    var editing = !!slot;
    var body =
      fieldHtml('Thứ', '<select id="slotWeekday">' + optionsHtml(WEEKDAY_OPTS, slot ? Number(slot.weekday) : 1) + '</select>') +
      fieldHtml('Bắt đầu', '<input id="slotStart" value="' + esc(slot ? slot.start : '09:00') + '" placeholder="09:00">') +
      fieldHtml('Kết thúc', '<input id="slotEnd" value="' + esc(slot ? slot.end : '11:00') + '" placeholder="11:00">') +
      fieldHtml('Buổi này để làm gì', '<input id="slotTitle" value="' + esc(slot ? slot.title : '') + '" placeholder="Làm dự án Nexus">') +
      fieldHtml('Loại', '<select id="slotKind">' + optionsHtml(KIND_TEXT, slot ? slot.kind : 'deep') + '</select>',
        'Việc sâu và hành chính tô màu khác nhau, để nhìn một dải là biết ngày đó nặng hay nhẹ.') +
      fieldHtml('Dự án', '<select id="slotProject">' + projectOptionsHtml(slot ? slot.projectPath : '') + '</select>');
    openModal(editing ? 'Sửa buổi' : 'Thêm buổi',
      '<p class="card-sub">Buổi là mẫu lặp theo tuần, không phải một lần cụ thể. DevTrace đối chiếu nó với ' +
      'dấu vết thật của từng ngày — và đối chiếu là <b>ước lượng</b>, không phải bảng chấm công.</p>' + body,
      (editing ? '<button class="btn" data-action="slot-delete" data-value="' + esc(slot.id) + '">Xoá buổi</button>' : '') +
      '<button class="btn btn-primary" data-action="slot-save"' +
      (editing ? ' data-value="' + esc(slot.id) + '"' : '') + '>Lưu</button>');
  }

  /* --- Biểu mẫu đợt làm việc --- */

  function openSprintForm() {
    var lengthDays = Number((lastData.config.sprint || {}).lengthDays) || 14;
    var start = state.day || '';
    openModal('Mở đợt làm việc',
      '<p class="card-sub">Một đợt là một hộp thời gian: chốt mục tiêu, làm, hết hộp thì đóng và đếm thật. ' +
      'Việc trong ngày và việc cố định không thuộc đợt — chúng lặp theo lịch, không theo hộp thời gian.</p>' +
      fieldHtml('Tên đợt', '<input id="sprintName" value="" placeholder="Để trống thì DevTrace tự đánh số">') +
      fieldHtml('Mục tiêu', '<input id="sprintGoal" value="" placeholder="Xong luồng đăng nhập">') +
      fieldHtml('Bắt đầu', '<input id="sprintStart" type="date" value="' + esc(start) + '">') +
      fieldHtml('Kết thúc', '<input id="sprintEnd" type="date" value="' + esc(shiftDayString(start, lengthDays - 1)) + '">',
        'Mặc định ' + lengthDays + ' ngày, theo khoá sprint.lengthDays trong Cài đặt.'),
      '<button class="btn btn-primary" data-action="sprint-start">Mở đợt</button>');
  }

  /* --- Chọn thư mục làm gốc dự án ---

     Trình duyệt không đọc được đường dẫn tuyệt đối từ ô chọn thư mục — nó
     trả về `C:\fakepath\…`, một chuỗi vô dụng. Nên việc duyệt làm ở phía
     máy chủ, qua `/api/fs/dirs`, và đường đó chỉ trả về TÊN THƯ MỤC. */

  function openProjectPicker(dirPath) {
    openModal('Thêm dự án', '<div class="loading">Đang đọc thư mục…</div>');
    api('/api/fs/dirs' + (dirPath ? '?path=' + encodeURIComponent(dirPath) : ''))
      .then(function (out) {
        var rows = (out.dirs || []).map(function (d) {
          return '<li><button class="btn btn-sm" data-action="project-form" data-value="' + esc(d.path) + '">' +
            esc(d.name) + (d.git ? ' <span class="li-note">kho git</span>' : '') + '</button></li>';
        }).join('');
        var chosen = out.path || '';
        var body =
          '<p class="card-sub">Chọn thư mục làm gốc dự án. Bước này chỉ đọc <b>tên thư mục</b> — ' +
          'không đọc tệp, không đọc nội dung tệp.</p>' +
          '<div class="spread"><span class="mono small">' + esc(chosen || 'Các ổ đĩa') + '</span>' +
          (out.parent
            ? '<span class="row-actions"><button class="btn btn-sm" data-action="project-form" data-value="' +
              esc(out.parent) + '">↑ Lên một cấp</button></span>'
            : '') + '</div>' +
          (out.error ? '<div class="alert alert-bad">' + esc(out.error) + '</div>' : '') +
          (rows ? '<ul class="list compact">' + rows + '</ul>'
                : '<div class="empty tiny">Không có thư mục con nào.</div>') +
          (out.truncated ? '<p class="tiny muted">Còn ' + out.truncated +
            ' thư mục nữa chưa hiện ra. Đi vào bớt một cấp để thấy.</p>' : '') +
          (chosen
            ? fieldHtml('Tên dự án', '<input id="projectName" value="' + esc(basenameOf(chosen)) + '">',
                'Đặt tên khác tên thư mục cũng được. Đổi tên chỉ đổi nhãn hiển thị — bằng chứng đã thu ' +
                'vẫn giữ nguyên đường dẫn cũ, không tệp nào bị viết lại.') +
              '<input type="hidden" id="projectPath" value="' + esc(chosen) + '">'
            : '');
        openModal('Thêm dự án', body,
          chosen ? '<button class="btn btn-primary" data-action="project-save">Dùng thư mục này</button>'
                 : '<button class="btn" data-action="close-modal">Đóng</button>');
      }).catch(function (error) { toast('Không đọc được thư mục: ' + error.message, 'bad'); });
  }

  /* --- Chi tiết một kho mã --- */

  function repoDetailHtml(repo, shot) {
    var rows = [];
    function row(label, value) {
      if (value === null || value === undefined || value === '') return;
      rows.push('<div class="spread"><span class="muted small">' + esc(label) + '</span>' +
        '<span class="mono small">' + esc(value) + '</span></div>');
    }
    row('Đường dẫn', repo.path);
    if (repo.error) {
      rows.push('<div class="alert alert-bad"><b>Không đọc được kho này</b>' +
        '<div class="alert-detail">' + esc(repo.error) + '</div></div>');
      return rows.join('');
    }
    var w = repo.working || {};
    row('Nhánh', repo.branch);
    row('Remote', repo.remote);
    row('Nhánh theo dõi', repo.upstream);
    row('Thay đổi chưa commit', w.total);
    row('Đã chuẩn bị', w.staged);
    row('Chưa chuẩn bị', w.unstaged);
    row('Chưa theo dõi', w.untracked);
    row('Sau remote', repo.behind);
    row('Trước remote', repo.ahead);

    var stashes = repo.stashes || [];
    if (stashes.length) {
      rows.push('<div class="card-sub mt">Stash (' + stashes.length + ')</div><ul class="list compact">' +
        stashes.map(function (s) {
          return '<li>' + esc(s.ref || '') + ' <span class="li-note">' + esc(s.subject || '') + '</span></li>';
        }).join('') + '</ul>');
    }

    /* Nhánh cũ chỉ đáng nhìn khi nó vừa cũ vừa đã gộp xong — đó mới là nhánh
       xoá được. Nhánh cũ mà chưa gộp thì vẫn có thể đang là việc dở. */
    var branches = (repo.branches || []).filter(function (b) { return b.ageDays >= 60; });
    if (branches.length) {
      rows.push('<div class="card-sub mt">Nhánh không đụng tới (' + branches.length + ')</div><ul class="list compact">' +
        branches.slice(0, 12).map(function (b) {
          return '<li>' + esc(b.name) + ' <span class="li-note">' + b.ageDays + ' ngày' +
            (b.merged ? ' · đã gộp xong' : '') + '</span></li>';
        }).join('') + '</ul>');
    }

    var tags = repo.tags || [];
    if (tags.length) {
      rows.push('<div class="card-sub mt">Thẻ mới nhất</div><ul class="list compact">' +
        tags.slice(0, 6).map(function (t) { return '<li>' + esc(t.name) + '</li>'; }).join('') + '</ul>');
    }

    var big = repo.bigFiles || [];
    if (big.length) {
      rows.push('<div class="card-sub mt">Tệp lớn trong HEAD</div><ul class="list compact">' +
        big.slice(0, 10).map(function (f) {
          return '<li class="mono small">' + esc(f.path) + ' <span class="li-note">' +
            Math.round(f.bytes / 1024) + ' KB</span></li>';
        }).join('') + '</ul>');
    }

    var secrets = repo.secrets;
    if (secrets && secrets.hits && secrets.hits.length) {
      rows.push('<div class="alert alert-bad mt"><b>Có thể là bí mật</b>' +
        '<div class="alert-detail">Đây là <b>dấu hiệu</b>, không phải kết luận — bộ quy tắc báo nhầm trên ' +
        'tệp thử và tệp mẫu. DevTrace chỉ ghi tên quy tắc và số dòng, không bao giờ ghi giá trị tìm thấy.</div>' +
        secrets.hits.slice(0, 20).map(function (h) {
          return '<div class="alert-detail mono tiny">' + esc(h.path) + ':' + h.line + ' · ' + esc(h.label) + '</div>';
        }).join('') +
        (secrets.truncated ? '<div class="alert-detail">Còn nữa — danh sách đã bị cắt.</div>' : '') + '</div>');
    } else if (secrets) {
      rows.push('<p class="tiny muted mt">Đã quét ' + secrets.scanned + ' tệp, không thấy dấu hiệu bí mật nào.</p>');
    } else {
      rows.push('<p class="tiny muted mt">Chưa quét bí mật trong lần này. Bật ở Cài đặt nếu muốn — ' +
        'quét đọc nội dung mọi tệp trong kho nên nó đắt, và nó báo nhầm trên tệp thử.</p>');
    }

    (repo.notes || []).forEach(function (n) {
      rows.push('<p class="tiny muted">' + esc(n) + '</p>');
    });
    if (shot && shot.updatedAt) {
      rows.push('<p class="tiny muted mt">Ảnh chụp lúc ' + esc(new Date(shot.updatedAt).toLocaleString('vi-VN')) +
        ' — sức khoẻ kho là chuyện “bây giờ”, không phải chuyện của một ngày.</p>');
    }
    return rows.join('');
  }

  /* ---- Hành động ---- */

  var actions = {
    'toggle-nav': function () { document.body.classList.toggle('nav-open'); },
    'collect': function () { runCollect({}); },
    'collect-rebuild': function () {
      if (!confirm('Thu thập lại từ đầu sẽ xoá toàn bộ bằng chứng đã lưu rồi dựng lại. Tiếp tục?')) return;
      runCollect({ rebuild: true });
    },
    'collect-one': function (value) { runCollect({ sources: [value] }); },
    'day-prev': function () { shiftDay(-1); },
    'day-next': function () { shiftDay(1); },
    'day-latest': function () {
      api('/api/status').then(function (out) { state.day = out.status.latest || new Date().toISOString().slice(0, 10); state.open = {}; refresh(); });
    },
    'open-day': function (value) { state.day = value; state.open = {}; go('today'); },
    /* Gấp/mở chỉ là chuyện hiển thị — dùng render() chứ không refresh(), để
       không gọi máy chủ chỉ vì một cú bấm mở bảng. */
    'toggle-detail': function (value) {
      state.open[value] = !state.open[value];
      render();
    },
    'open-warnings': function () {
      var ctx = { state: state, data: lastData, colors: palette() };
      openModal('Cảnh báo', global.Warnings.html(ctx) ||
        '<p class="muted">Ngày này không có gì đáng lưu ý.</p>',
        '<button class="btn" data-action="close-modal">Đóng</button>');
    },
    'filter-source': function (value) { state.filters.source = value; refresh(); },
    'set-range': function (value) { state.range = Number(value); refresh(); },
    'export-data': function () {
      window.location.href = '/api/export';
      toast('Đang tải tệp sao lưu…');
    },
    'export-redacted': function () {
      // Đi qua đúng bộ lọc ở app/redact.js, chạy phía máy chủ — bản đã che
      // không bao giờ tồn tại trong bộ nhớ của trang này.
      window.location.href = '/api/export?redact=1';
      toast('Đang tải bản đã che bí mật…');
    },
    'reset-data': function () {
      if (!confirm('Xoá toàn bộ bằng chứng đã thu thập? Thao tác này không hoàn tác được.')) return;
      api('/api/reset', { method: 'POST', body: {} }).then(function () {
        toast('Đã xoá kho bằng chứng.', 'good');
        refresh();
      }).catch(function (error) { toast(error.message, 'bad'); });
    },
    'save-config': function () { saveConfig(); },
    'journal-edit': function () {
      closeModal();
      var journal = lastData.journal;
      openJournalEditor(journal && journal.text ? journal.text : '');
    },
    'journal-prompt': function () { closeModal(); openPromptView(); },
    'journal-save': function () {
      var text = $('#journalText') ? $('#journalText').value : '';
      api('/api/day/' + state.day + '/journal', { method: 'POST', body: { text: text } }).then(function (out) {
        var check = out.journal && out.journal.evidence && out.journal.evidence.check;
        if (check && check.invalid && check.invalid.length) {
          // Vẫn lưu, nhưng nói ngay — đừng để tới lúc đọc lại mới phát hiện.
          toast('Đã lưu, nhưng ' + check.invalid.length + ' trích dẫn không có trong gói bằng chứng: ' + check.invalid.join(', '), 'bad');
        } else {
          toast('Đã lưu nhật ký.', 'good');
        }
        closeModal();
        refresh();
      }).catch(function (error) { toast(error.message, 'bad'); });
    },
    'copy-prompt': function () {
      var node = $('#promptText');
      if (!node) return;
      node.removeAttribute('readonly');
      node.select();
      try {
        document.execCommand('copy');
        toast('Đã sao chép lời nhắc.', 'good');
      } catch (error) {
        toast('Không tự sao chép được, huynh chọn tay nhé.', 'bad');
      }
    },
    'ai-run': function () {
      var button = $('[data-action="ai-run"]');
      if (button) { button.disabled = true; button.textContent = 'Đang tổng hợp…'; }
      api('/api/day/' + state.day + '/synthesize', { method: 'POST', body: {} }).then(function (out) {
        if (out.mode === 'api') {
          var check = out.check;
          if (check && check.invalid && check.invalid.length) {
            toast('AI đã tổng hợp, nhưng ' + check.invalid.length + ' trích dẫn không khớp gói bằng chứng: ' + check.invalid.join(', '), 'bad');
          } else if (check && check.uncited) {
            toast('AI đã tổng hợp nhưng không kèm trích dẫn nào — đọc kỹ trước khi tin.', 'bad');
          } else {
            toast('AI đã tổng hợp xong.', 'good');
          }
          refresh();
          return;
        }
        toast(out.reason || 'Chưa gọi được AI — đệ mở sẵn gói bằng chứng để huynh dán tay.', 'bad');
        openPromptView();
      }).catch(function (error) { toast(error.message, 'bad'); })
        .then(function () { if (button) { button.disabled = false; button.textContent = 'Gọi AI tổng hợp'; } });
    },
    'toggle-source': function (value) {
      var config = lastData.config;
      var enabled = !(config.sources[value] && config.sources[value].enabled !== false);
      api('/api/config', { method: 'POST', body: { sources: buildSourcePatch(value, enabled) } })
        .then(function () { toast((enabled ? 'Đã bật ' : 'Đã tắt ') + (Sources[value] ? Sources[value].label : value), 'good'); refresh(); })
        .catch(function (error) { toast(error.message, 'bad'); });
    },
    /* ---- Nhiệm vụ ---- */

    'plan-form': function (value, node) {
      var horizon = node ? node.getAttribute('data-horizon') : null;
      /* Nút ở thẻ Hộp thư mang theo tiêu đề thư. Nó KHÔNG mang `data-horizon`
         và cũng không mang id nhiệm vụ — nên nó rơi vào nhánh mở biểu mẫu
         trống, đúng như mong muốn. */
      var fromMail = node ? node.getAttribute('data-mail-subject') : null;
      /* Không có `data-value` là nút “Thêm” ở đầu cột: mở biểu mẫu trống với
         đúng tầm nhìn của cột đó, để ô chọn đứng sẵn ở chỗ huynh vừa bấm. */
      openTaskEditor(taskById(value), horizon || 'day', fromMail);
    },
    'plan-save': function (value) {
      var horizon = val('taskHorizon') || 'day';
      var project = projectByPath(val('taskProject'));
      var day = val('taskDay');
      var recur = null;
      if (horizon === 'recurring') {
        recur = {
          freq: val('taskFreq') || 'weekdays',
          byWeekday: val('taskWeekdays').split(/[^0-9]+/)
            .map(Number).filter(function (n) { return n >= 1 && n <= 7; })
        };
      }
      var pointsRaw = val('taskPoints').trim();
      var points = pointsRaw === '' ? null : Number(pointsRaw);
      if (points !== null && !isFinite(points)) points = null;
      postPlan('/api/plans/task', {
        action: 'save',
        id: value || null,
        title: val('taskTitle'),
        horizon: horizon,
        // Mục tiêu dài hạn dùng `targetDay`, ba tầm nhìn kia dùng `dueDay`.
        // Gửi lẫn hai trường thì máy chủ nhận cả hai và tầm nhìn nào cũng
        // thấy mình có ngày — sai âm thầm.
        dueDay: horizon === 'goal' ? null : (day || null),
        targetDay: horizon === 'goal' ? (day || null) : null,
        projectId: project ? project.id : null,
        projectPath: project ? project.path : null,
        points: points,
        recur: recur,
        note: val('taskNote')
      }).then(function (out) {
        if (!out) return;   // bị từ chối: giữ hộp thoại để huynh sửa lại
        closeModal();
        toast('Đã lưu nhiệm vụ.', 'good');
      });
    },
    'plan-delete': function (value) {
      if (!confirm('Xoá nhiệm vụ này khỏi kế hoạch?\n\nDấu đã-xong của nó ở mọi ngày cũng đi theo. ' +
        'Bằng chứng đã thu thập không bị đụng tới.')) return;
      closeModal();
      postPlan('/api/plans/task', { action: 'delete', id: value });
    },
    'plan-toggle': function (value) {
      /* `taskToggle` tự lật trạng thái, nên ở đây không gửi trạng thái đích.
         Nhưng phải gửi NGÀY: tích một việc khi đang xem ngày cũ mà để máy
         chủ tự lấy hôm nay là ghi sai ngày hoàn thành. */
      postPlan('/api/plans/task', { action: 'toggle', id: value, doneDay: state.day });
    },
    'plan-occur-toggle': function (value, node) {
      var done = !!(node && node.getAttribute('data-done') === '1');
      /* Tích theo TỪNG NGÀY: việc cố định chỉ có một dòng trong kho, nên
         trạng thái của nó phải nói rõ là của ngày nào. Thiếu `day` thì máy
         chủ lấy hôm nay — và tích một buổi của thứ Ba sẽ rơi sang thứ Tư. */
      postPlan('/api/plans/task', { action: 'occur-toggle', id: value, day: state.day, done: !done });
    },

    /* ---- Thời khoá biểu ---- */

    'slot-form': function (value) { openSlotEditor(slotById(value)); },
    'slot-save': function (value) {
      var project = projectByPath(val('slotProject'));
      postPlan('/api/plans/slot', {
        action: 'save',
        id: value || null,
        weekday: Number(val('slotWeekday')) || 1,
        start: val('slotStart'),
        end: val('slotEnd'),
        title: val('slotTitle'),
        kind: val('slotKind') || 'deep',
        projectId: project ? project.id : null,
        projectPath: project ? project.path : null
      }).then(function (out) {
        if (!out) return;
        closeModal();
        toast('Đã lưu buổi.', 'good');
      });
    },
    'slot-delete': function (value) {
      if (!confirm('Xoá buổi này khỏi thời khoá biểu? Dấu vết đã thu thập không bị đụng tới.')) return;
      closeModal();
      postPlan('/api/plans/slot', { action: 'delete', id: value });
    },

    /* ---- Đợt làm việc ---- */

    /* `sprint-start` làm hai việc: chưa mở hộp thoại thì mở nó, đang mở thì
       gửi đi. Cùng một action vì nút xác nhận trong hộp thoại cũng là nút
       “Mở đợt” — và thêm một action chỉ để đặt tên khác cho cùng một việc
       thì bảng action phình ra mà không ai được lợi. */
    'sprint-start': function () {
      if (!$('#sprintName')) { openSprintForm(); return; }
      postPlan('/api/plans/sprint', {
        action: 'start',
        name: val('sprintName'),
        goal: val('sprintGoal'),
        startDay: val('sprintStart') || null,
        endDay: val('sprintEnd') || null
      }).then(function (out) {
        if (!out) return;
        closeModal();
        toast('Đã mở ' + ((out.sprint && out.sprint.name) || 'đợt làm việc') + '.', 'good');
      });
    },
    'sprint-close': function () {
      var part = plansData();
      var active = part && part.activeSprint;
      if (!active) { toast('Chưa có đợt nào đang chạy.', 'bad'); return; }
      var hanging = planTasks().filter(function (t) {
        return t.sprintId === active.id && t.status !== 'done';
      }).length;
      if (!confirm('Đóng “' + (active.name || active.id) + '”?\n\n' + hanging +
        ' việc còn dở sẽ trả về danh sách chờ và được ghi nhận là mang sang lần sau. ' +
        'Không việc nào bị xoá.')) return;
      postPlan('/api/plans/sprint', { action: 'close', id: active.id }).then(function (out) {
        if (out) toast('Đã đóng đợt. ' + (out.carried || 0) + ' việc mang sang lần sau.', 'good');
      });
    },
    'sprint-move': function (value) {
      var part = plansData();
      var active = part && part.activeSprint;
      if (!active) { toast('Chưa có đợt nào đang chạy — mở một đợt trước.', 'bad'); return; }
      postPlan('/api/plans/task', { action: 'move', id: value, sprintId: active.id });
    },

    /* ---- Dự án ---- */

    'project-form': function (value) {
      /* Có `data-value` là bấm vào một thư mục con để đi vào; không có là mở
         đầu từ danh sách ổ đĩa. Trên Windows không có một thư mục gốc chung
         để bắt đầu, nên chặng đầu tiên phải là các ổ. */
      openProjectPicker(value || '');
    },
    /* Không dùng `data-value`: nút lưu mang `data-project` khi là đổi tên, và
       mang `#projectPath` trong hộp thoại khi là thêm mới. Hai chế độ, một
       action — cùng lối `sprint-start` ở trên. */
    'project-save': function (_value, node) {
      var renameId = node ? node.getAttribute('data-project') : null;
      var name = val('projectName').trim();
      var list = declaredProjects();
      if (renameId) {
        if (!name) { toast('Tên dự án không được để trống.', 'bad'); return; }
        saveDeclared(list.map(function (p) {
          return { id: p.id, path: p.path, kind: p.kind, name: p.id === renameId ? name : p.name };
        }), 'Đã đổi tên dự án. Bằng chứng cũ hiện ngay dưới tên mới.');
        return;
      }
      var path = val('projectPath');
      if (!path) { toast('Chưa chọn thư mục nào.', 'bad'); return; }
      var clash = null;
      list.forEach(function (p) { if (p.path === path) clash = p; });
      if (clash) { toast('Thư mục này đã có trong danh sách dự án (“' + clash.name + '”).', 'bad'); return; }
      list.push({ id: null, name: name || basenameOf(path), path: path, kind: null });
      saveDeclared(list, 'Đã thêm dự án “' + (name || basenameOf(path)) + '”.');
    },
    'project-rename': function (value) {
      var list = declaredProjects();
      var found = null;
      list.forEach(function (p) { if (p.id === value) found = p; });
      if (!found) { toast('Không thấy dự án này.', 'bad'); return; }
      openModal('Đổi tên dự án',
        '<p class="card-sub">Đổi tên chỉ sửa đúng một trường trong cấu hình. Sự kiện lưu dự án dưới dạng ' +
        '<b>đường dẫn</b>, nên toàn bộ bằng chứng cũ hiện ngay dưới tên mới — không tệp bằng chứng nào bị viết lại.</p>' +
        '<div class="field"><label>Tên hiển thị</label><input id="projectName" value="' + esc(found.name) + '">' +
        '<span class="hint">Thư mục: ' + esc(found.path) + '</span></div>',
        '<button class="btn btn-primary" data-action="project-save" data-project="' + esc(found.id) + '">Lưu tên</button>');
    },
    'project-delete': function (value) {
      var list = declaredProjects();
      var found = null;
      list.forEach(function (p) { if (p.id === value) found = p; });
      if (!found) { toast('Không thấy dự án này.', 'bad'); return; }
      var last = list.length === 1;
      if (!confirm('Bỏ “' + found.name + '” khỏi danh sách dự án?\n\n' +
        'Bằng chứng đã thu thập KHÔNG bị xoá — nó vẫn nằm nguyên trong kho, và vẫn hiện dưới tên thư mục “' +
        basenameOf(found.path) + '”.' +
        (last ? '\n\nĐây là dự án khai báo cuối cùng: sau khi bỏ, DevTrace quay lại tự suy ra dự án từ kho git ' +
          'và các thư mục đang theo dõi.' : ''))) return;
      saveDeclared(list.filter(function (p) { return p.id !== value; })
        .map(function (p) { return { id: p.id, path: p.path, kind: p.kind, name: p.name }; }),
      'Đã bỏ dự án khỏi danh sách. Bằng chứng vẫn còn nguyên.');
    },
    /* Nối thư mục vào nguồn thu thập — việc này TỰ ĐỘNG sinh bằng chứng mới,
       nên phải hỏi trước. Thêm một dự án vào danh sách chỉ là đổi nhãn hiển
       thị; nối vào nguồn mới là bắt đầu đọc thư mục đó. */
    'project-scan': function (value) {
      var list = declaredProjects();
      var found = null;
      list.forEach(function (p) { if (p.id === value) found = p; });
      if (!found) { toast('Không thấy dự án này.', 'bad'); return; }
      var config = lastData.config || {};
      var isGit = found.kind === 'git';
      var key = isGit ? 'repos' : 'dirs';
      var current = (((config.sources || {})[isGit ? 'git' : 'files']) || {})[key] || [];
      var already = current.some(function (p) { return String(p).toLowerCase() === found.path.toLowerCase(); });
      if (already) { toast('Thư mục này đã nằm trong nguồn ' + (isGit ? 'Git' : 'thư mục') + ' rồi.', 'good'); return; }
      if (!confirm('Nối “' + found.name + '” vào nguồn ' + (isGit ? 'Git' : 'thư mục') + '?\n\n' +
        'Từ lần thu thập sau, DevTrace sẽ đọc ' + (isGit ? 'lịch sử commit của kho này'
          : 'các tệp được sửa trong thư mục này') +
        ' và ghi vào kho bằng chứng. Đây là thay đổi nguồn thu thập, không phải chỉ đổi nhãn.')) return;
      var patch = { sources: {} };
      patch.sources[isGit ? 'git' : 'files'] = {};
      patch.sources[isGit ? 'git' : 'files'][key] = current.concat([found.path]);
      api('/api/config', { method: 'POST', body: patch }).then(function () {
        toast('Đã nối vào nguồn. Thu thập dấu vết để thấy kết quả.', 'good');
        refresh();
      }).catch(function (error) { toast(error.message, 'bad'); });
    },

    /* ---- Kho mã ---- */

    'repo-refresh': function () {
      var button = $('[data-action="repo-refresh"]');
      if (button) { button.disabled = true; button.textContent = 'Đang quét…'; }
      api('/api/repohealth/refresh', { method: 'POST', body: {} }).then(function (out) {
        /* Quét có chặn: `scanned` là số kho quét được, `total` là số kho đáng
           lẽ phải quét. Chỉ nói “đã quét 20 kho” khi trong cấu hình có 52 là
           để huynh tin rằng mọi thứ đều ổn. */
        var skipped = Number(out.skipped) || 0;
        var message = 'Đã quét ' + (out.scanned || 0) + '/' + (out.total || 0) + ' kho';
        toast(skipped ? message + ' — còn ' + skipped + ' kho chưa nhìn tới (giới hạn ở Cài đặt).'
                      : message + '.', skipped ? 'bad' : 'good');
        refresh();
      }).catch(function (error) { toast(error.message, 'bad'); })
        .then(function () { if (button) { button.disabled = false; button.textContent = 'Quét lại'; } });
    },
    'repo-detail': function (value) {
      var health = lastData.repohealth || {};
      var shot = health.snapshot || {};
      var repo = null;
      (shot.repos || []).forEach(function (r) { if (r.path === value) repo = r; });
      /* Ảnh chụp cũ có thể không còn kho này — ví dụ huynh vừa bỏ nó khỏi
         cấu hình. Nói thẳng thay vì mở một hộp thoại rỗng. */
      if (!repo) { toast('Không thấy kho này trong ảnh chụp. Bấm “Quét lại” rồi thử lại.', 'bad'); return; }
      openModal(repo.name || repo.path, repoDetailHtml(repo, shot),
        '<button class="btn" data-action="close-modal">Đóng</button>');
    },

    /* ---- Hộp thư ---- */

    'mail-refresh': function () {
      var button = $('[data-action="mail-refresh"]');
      if (button) { button.disabled = true; button.textContent = 'Đang đọc…'; }
      api('/api/mail/refresh', { method: 'POST', body: {} }).then(function (out) {
        /* Kết quả trả về có thể là một ảnh chụp HỎNG (`ok: false`) — khi đó
           HTTP vẫn là 200 vì máy chủ đã trả lời được. Nói đúng chuyện đã xảy
           ra, đừng báo "xong" rồi để huynh tự phát hiện ở thẻ. */
        if (out && out.ok === false) {
          toast(out.off ? 'Hộp thư đang tắt.' : (out.error || 'Không đọc được hộp thư.'), 'bad');
        } else {
          toast('Đã đọc hộp thư.', 'good');
        }
        refresh();
      }).catch(function (error) { toast(error.message, 'bad'); })
        .then(function () { if (button) { button.disabled = false; button.textContent = 'Quét'; } });
    },
    'mail-toggle': function () {
      var mail = lastData.mail || {};
      var next = !mail.enabled;
      api('/api/config', { method: 'POST', body: { mail: { enabled: next } } })
        .then(function () {
          toast(next ? 'Đã bật theo dõi hộp thư. Cần mật khẩu ứng dụng trong biến môi trường đã đặt TRƯỚC khi mở DevTrace.'
                     : 'Đã tắt theo dõi hộp thư. Ảnh chụp cũ vẫn nằm trên đĩa nhưng không ai đọc nữa.', 'good');
          refresh();
        })
        .catch(function (error) { toast(error.message, 'bad'); });
    },

    'close-modal': function () { closeModal(); }
  };

  function buildSourcePatch(name, enabled) {
    var patch = { sources: {} };
    patch.sources[name] = { enabled: enabled };
    return patch;
  }

  function runCollect(options) {
    var button = $('#collectBtn');
    if (button) { button.disabled = true; button.textContent = 'Đang thu thập…'; }
    api('/api/collect', { method: 'POST', body: options || {} }).then(function (out) {
      var summary = out.summary || {};
      /* Nguồn lỗi là nguồn có `ok === false`. Bản cũ đoán qua "không có ghi
         chú nào" — ngược hoàn toàn, vì nguồn chạy tốt thường chẳng có ghi
         chú, còn nguồn hỏng thì luôn có. Kết quả là danh sách ấy vừa sai vừa
         bị vứt đi ngay sau khi tính. */
      var failed = Object.keys(summary.sources || {}).filter(function (name) {
        return summary.sources[name] && summary.sources[name].ok === false;
      });
      state.lastCollect = {
        at: Date.now(),
        total: summary.total || 0,
        failed: failed,
        notes: summary.notes || [],
        retention: summary.retention || null
      };
      if (failed.length) {
        toast('Đã thu ' + summary.total + ' sự kiện, nhưng ' + failed.length + ' nguồn báo lỗi: ' + failed.join(', ') + '.', 'bad');
      } else {
        toast('Đã thu ' + summary.total + ' sự kiện trong ' + summary.ms + 'ms.', 'good');
      }
      state.lastStatus = out.status;
      return api('/api/status').then(function (fresh) {
        state.lastStatus = fresh.status;
        refresh();
      });
    }).catch(function (error) { toast('Thu thập lỗi: ' + error.message, 'bad'); })
      .then(function () { if (button) { button.disabled = false; button.textContent = 'Thu thập dấu vết'; } });
  }

  /* ---------------------------------------------------------------------
     Lưu cài đặt.

     Trước đây chỗ này là một chuỗi if/else cứng theo từng khoá, nên mỗi ô
     cấu hình mới phải sửa thêm một nhánh — và quên là ô đó im lặng không
     lưu. Nay mọi ô tự khai đường dẫn có dấu chấm trong `data-config`, và
     hàm dưới đây chỉ việc đọc đường dẫn. Thêm ô mới không phải sửa gì ở
     đây, trừ khi ô đó chứa danh sách hoặc số (hai bảng ngay dưới).
     --------------------------------------------------------------------- */

  /* Ô chứa danh sách: mỗi dòng một mục. Phải là mảng chứ không phải chuỗi,
     vì `E.readDay` và bộ dò kho đều duyệt qua từng phần tử. */
  var ARRAY_KEYS = {
    'sources.git.repos': true,
    'sources.git.authors': true,
    'sources.git.autoDiscover.roots': true,
    'sources.files.dirs': true,
    'sources.files.ignore': true,
    'sources.browser.browsers': true
  };
  /* Ô chứa số. Gõ chữ vào đây cho ra NaN, mà NaN lọt vào cấu hình thì mọi
     phép so sánh sau đó đều sai một cách im lặng — nên NaN bị bỏ qua hẳn,
     giữ nguyên giá trị cũ. */
  var NUMBER_KEYS = {
    dayStartHour: true,
    'sources.codex.maxFiles': true,
    'sources.files.maxDepth': true,
    'sources.git.autoDiscover.maxDepth': true,
    'sources.git.autoDiscover.maxRepos': true,
    'sources.browser.keepDays': true,
    'sources.shell.maxCommands': true,
    'retention.days': true,
    'retention.keepJournals': true,
    'sources.git.healthMaxRepos': true,
    'sprint.lengthDays': true,
    'mail.port': true,
    'mail.unansweredHours': true,
    'mail.maxMessages': true
  };

  function setPath(target, path, value) {
    var parts = path.split('.');
    var node = target;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  }

  function linesOf(text) {
    return String(text || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function valueOf(path, node) {
    if (ARRAY_KEYS[path]) return linesOf(node.value);
    if (!NUMBER_KEYS[path]) return node.value;
    // Ô số để trống: giữ nguyên giá trị đang có, đừng ghi 0 hay NaN.
    if (String(node.value).trim() === '') return undefined;
    var n = Number(node.value);
    if (!isFinite(n)) return undefined;
    if (path === 'dayStartHour') return Math.min(12, Math.max(0, Math.round(n)));
    return n;
  }

  function collectPatch() {
    var patch = {};
    $$('[data-config]').forEach(function (node) {
      var path = node.getAttribute('data-config');
      var value = valueOf(path, node);
      if (value !== undefined) setPath(patch, path, value);
    });
    $$('[data-config-toggle]').forEach(function (node) {
      setPath(patch, 'sources.' + node.getAttribute('data-config-toggle') + '.enabled', node.checked);
    });
    // Công tắc dạng đường dẫn có dấu chấm, sâu bao nhiêu cũng được — dùng
    // chung một đường cho mọi mục cấu hình.
    $$('[data-config-flag]').forEach(function (node) {
      setPath(patch, node.getAttribute('data-config-flag'), node.checked);
    });
    return patch;
  }

  /* Bảng màu là chuyện của riêng trình duyệt, không phải khoá cấu hình:
     máy chủ không cần biết huynh thích nền sáng hay nền tối. Nên nó được
     xử lý trước, và nếu nó là thứ DUY NHẤT đổi thì không gọi máy chủ làm gì.
     `localStorage` chỉ được ghi ở đây — tức là chỉ khi huynh tự tay đổi ô
     chọn. Không có mã nào tự ghi đè lựa chọn đó. */
  function applyThemePick() {
    var pick = $('[data-theme-pick]');
    if (!pick || pick.value === state.theme) return false;
    state.theme = pick.value;
    localStorage.setItem('devtrace.theme', pick.value);
    applyTheme();
    return true;
  }

  function saveConfig(fromAutosave) {
    var themeChanged = applyThemePick();
    var patch = collectPatch();
    if (!Object.keys(patch).length) {
      if (themeChanged && !fromAutosave) toast('Đã đổi bảng màu.', 'good');
      return; // chỉ đổi bảng màu thì không có gì để gửi lên máy chủ
    }
    api('/api/config', { method: 'POST', body: patch }).then(function () {
      toast(fromAutosave ? 'Đã lưu.' : 'Đã lưu cài đặt.', 'good');
      refresh();
    }).catch(function (error) { toast(error.message, 'bad'); });
  }

  /* ---- Gắn sự kiện ---- */

  document.addEventListener('click', function (event) {
    var routeNode = event.target.closest('[data-route]');
    if (routeNode) {
      event.preventDefault();
      go(routeNode.getAttribute('data-route'));
      document.body.classList.remove('nav-open');
      return;
    }
    var node = event.target.closest('[data-action]');
    if (!node) return;
    var action = node.getAttribute('data-action');
    var handler = actions[action];
    if (!handler) return;
    event.preventDefault();
    /* Truyền cả nút, không chỉ `data-value`: một nút có thể mang thêm
       `data-horizon`, `data-done` hay `data-project` — thứ không nhét vừa
       vào một chuỗi giá trị. Hàm xử lý cũ nhận thừa tham số thì bỏ qua. */
    handler(node.getAttribute('data-value'), node);
  });

  document.addEventListener('change', function (event) {
    var node = event.target;
    if (node.matches('[data-role="day-input"]')) {
      state.day = node.value;
      state.open = {};
      refresh();
      return;
    }
    /* Ô rời rạc (hộp kiểm, ô chọn) tự lưu ngay khi đổi — huynh không phải
       nhớ bấm nút. Ô nhập chữ thì KHÔNG: tự lưu theo từng phím gõ sẽ bắn
       liên tục vào máy chủ, và vì `config.merge` chỉ gộp nông, một đường
       dẫn đang gõ dở có thể đè mất danh sách lành. */
    if (node.matches('[data-autosave]')) saveConfig(true);
  });

  document.addEventListener('input', function (event) {
    var node = event.target;
    if (node.matches('[data-role="event-search"]')) {
      clearTimeout(node._timer);
      node._timer = setTimeout(function () {
        state.filters.q = node.value.trim();
        var caret = node.selectionStart;
        refresh().then(function () {
          var again = $('[data-role="event-search"]');
          if (again) { again.focus(); again.setSelectionRange(caret, caret); }
        });
      }, 320);
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeModal();
  });

  $('#modalRoot').addEventListener('click', function (event) {
    if (event.target === $('#modalRoot')) closeModal();
  });

  window.addEventListener('hashchange', function () {
    var parsed = parseHash();
    if (parsed.route !== state.route) {
      state.route = parsed.route;
      state.open = {};   // mục đang mở thuộc về màn cũ, không mang sang màn mới
      render();
      window.scrollTo(0, 0);
      refresh();
    }
  });

  /* ---- Khởi động ---- */

  function boot() {
    applyTheme();
    var parsed = parseHash();
    state.route = parsed.route;

    return api('/api/status').then(function (out) {
      state.lastStatus = out.status;
      (out.status.sources || []).forEach(function (source) { Sources[source.name] = source; });
      global.DEVTRACE_SOURCES = Sources;
      state.day = out.status.latest || new Date().toISOString().slice(0, 10);
      return refresh();
    }).catch(function (error) {
      showFailure(error);
    });
  }

  function showFailure(error) {
    var offline = !!(error && error.network);
    var head = offline ? 'Không kết nối được máy chủ' : 'Máy chủ trả lời nhưng không dùng được';
    var hint = offline
      ? '<p>Hãy chắc rằng DevTrace đang chạy: nhấp đúp biểu tượng <strong>DevTrace</strong> ngoài màn hình, ' +
        'hoặc chạy <code>npm start</code> (hay <code>node server.js</code>) rồi mở <code>http://localhost:5173</code>.</p>'
      : '<p>DevTrace đã kết nối tới máy chủ nhưng yêu cầu không thành công.</p>' +
        '<p class="muted small">Thử tải lại trang. Nếu vẫn vậy, chạy <code>npm test</code> để khoanh vùng.</p>';
    $('#view').innerHTML = '<div class="card"><h2>' + head + '</h2>' + hint +
      '<p class="mono small">' + esc((error && error.message) || String(error)) + '</p></div>';
  }

  global.DevTrace = {
    refresh: refresh, render: render, state: state, toast: toast,
    openModal: openModal, closeModal: closeModal, showFailure: showFailure, boot: boot
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
