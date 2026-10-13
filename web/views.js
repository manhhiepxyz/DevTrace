/* =====================================================================
   web/views.js — Sinh HTML cho từng màn hình.

   Không giữ trạng thái ở đây. Mọi thứ cần thiết do app.js chuẩn bị sẵn
   trong ctx: { state, data, colors }. Nhờ vậy mỗi màn hình là một hàm
   thuần, dễ đọc và dễ thử.
   ===================================================================== */
(function (global) {
  'use strict';

  var Charts = global.Charts;

  function esc(value) { return Charts.esc(value); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  function fmtTime(ms) {
    if (!ms) return '--:--';
    var d = new Date(ms);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function fmtDate(day) {
    var parts = String(day || '').split('-');
    if (parts.length !== 3) return day || '';
    var names = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return parts[2] + '/' + parts[1] + ' · ' + (isNaN(d.getTime()) ? '' : names[d.getDay()]);
  }

  function fmtMinutes(minutes) {
    var m = Math.round(num(minutes));
    if (m < 60) return m + ' phút';
    var h = Math.floor(m / 60);
    var rest = m % 60;
    return h + 'h' + (rest ? ('0' + rest).slice(-2) : '00');
  }

  function fmtNumber(value) {
    var n = Math.round(num(value));
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function fmtTokens(value) {
    var n = num(value);
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  }

  /* Mã tham chiếu trong văn bản: (B2), (P1, D3)… */
  var CODE_RE = /\b([BPCFDXQN])(\d{1,2})\b/g;

  function citedCodes(text) {
    var out = [];
    var seen = {};
    var match;
    CODE_RE.lastIndex = 0;
    while ((match = CODE_RE.exec(String(text || '')))) {
      var code = match[1] + match[2];
      if (seen[code]) continue;
      seen[code] = true;
      out.push(code);
    }
    return out;
  }

  /* Nhật ký do AI viết phải chỉ về mã có thật trong gói bằng chứng. Khối này
     nói thẳng mã nào khớp, mã nào không — để một câu nghe rất chắc chắn mà
     chẳng trỏ tới đâu không lọt qua được. */
  function citationHtml(journal) {
    var evidence = journal && journal.evidence;
    if (!evidence || !evidence.check) {
      return '<p class="muted tiny mt">Nhật ký này được lưu trước khi DevTrace biết soi trích dẫn, ' +
        'nên không có bảng mã đi kèm để đối chiếu.</p>';
    }
    var check = evidence.check;
    var codes = evidence.codes || {};
    var cited = citedCodes(journal.text);
    var rows = cited.filter(function (code) { return codes[code]; }).map(function (code) {
      return '<li><b class="mono">(' + esc(code) + ')</b> ' + esc(codes[code]) + '</li>';
    }).join('');

    var head;
    if (check.invalid && check.invalid.length) {
      head = '<div class="block-card mt" style="border-color:var(--cinabar)">' +
        '<b style="color:var(--cinabar)">Trích dẫn không kiểm chứng được</b>' +
        '<p class="tiny" style="margin:6px 0 0">Bản tổng kết nhắc tới ' +
        check.invalid.map(function (code) { return '<b class="mono">(' + esc(code) + ')</b>'; }).join(', ') +
        ' nhưng gói bằng chứng của ngày này không cấp mã đó. Những câu kèm mã ấy không có gì đỡ lưng — đọc lại trước khi tin.</p></div>';
    } else if (check.uncited) {
      head = '<div class="block-card mt" style="border-color:var(--gold)">' +
        '<b style="color:var(--gold)">Không có trích dẫn nào</b>' +
        '<p class="tiny" style="margin:6px 0 0">Văn bản này không kèm mã tham chiếu nào nên không đối chiếu được với bằng chứng. ' +
        'Có thể là huynh tự viết — cũng có thể là AI bỏ qua quy tắc.</p></div>';
    } else {
      head = '<p class="tiny muted mt">Đã đối chiếu ' + check.cited + ' trích dẫn với gói bằng chứng: khớp cả ' + check.valid + '.</p>';
    }

    return head + (rows
      ? '<details class="mt"><summary class="muted tiny">Các mã đã dùng nghĩa là gì (' + cited.length + ')</summary>' +
        '<ul class="list compact tiny">' + rows + '</ul></details>'
      : '');
  }

  function sourceBadge(name, extraClass) {
    var info = (global.DEVTRACE_SOURCES || {})[name] || { label: name, kind: 'other' };
    return '<span class="badge k-' + esc(info.kind) + (extraClass ? ' ' + extraClass : '') + '">' +
      '<i class="dot"></i>' + esc(info.label) + '</span>';
  }

  function card(title, han, body, headExtra) {
    return '<section class="card">' +
      '<div class="card-head"><span class="han">' + esc(han) + '</span><h2>' + esc(title) + '</h2>' +
      '<span class="spacer"></span>' + (headExtra || '') + '</div>' + body + '</section>';
  }

  function stat(label, value, note, cls) {
    return '<div class="stat ' + (cls || '') + '">' +
      '<div class="label">' + esc(label) + '</div>' +
      '<div class="value">' + value + '</div>' +
      (note ? '<div class="note">' + esc(note) + '</div>' : '') + '</div>';
  }

  function listItems(items, formatter) {
    if (!items || !items.length) return '<div class="empty">không có gì</div>';
    return '<ul class="list">' + items.map(function (item) { return '<li>' + formatter(item) + '</li>'; }).join('') + '</ul>';
  }

  /* ------------------------------------------------------------------
     Gấp / mở.

     Trạng thái mở nằm trong state của app.js chứ KHÔNG nằm ở đây, và cũng
     không dùng thẻ <details> sẵn có của trình duyệt: mỗi lần vẽ, app.js dựng
     lại #view từ đầu, nên <details> sẽ tự sập ngay sau lần thu thập kế tiếp.
     Chốt `ctx.state &&` là bắt buộc — bộ kiểm thử dựng màn hình bằng một
     fixture không có trường `open`.
     ------------------------------------------------------------------ */

  function isOpen(ctx, key) {
    return !!(ctx.state && ctx.state.open && ctx.state.open[key]);
  }

  function disclosure(ctx, key, label, bodyHtml, meta) {
    var open = isOpen(ctx, key);
    return '<div class="disclosure' + (open ? ' is-open' : '') + '">' +
      '<button class="disclosure-head" type="button" data-action="toggle-detail" data-value="' + esc(key) + '" ' +
      'aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="disclosure-caret" aria-hidden="true">' + (open ? '▾' : '▸') + '</span>' +
      '<span>' + esc(label) + '</span>' +
      (meta ? '<span class="muted">' + esc(meta) + '</span>' : '') +
      '</button>' +
      (open ? '<div class="disclosure-body">' + bodyHtml + '</div>' : '') +
      '</div>';
  }

  function legend(segments) {
    return '<div class="legend">' + segments.map(function (s) {
      return '<span><i style="background:' + esc(s.color) + '"></i>' + esc(s.label) + ' <b class="mono">' + fmtNumber(s.value) + '</b></span>';
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------------
     Màn hình 1: Hôm nay — trả lời trực tiếp ba câu hỏi của DevTrace.
     ------------------------------------------------------------------ */

  function question(number, cls, title, subtitle, body) {
    return '<div class="question is-' + cls + '">' +
      '<h3 class="question-title"><span class="num">' + number + '</span>' + esc(title) + '</h3>' +
      (subtitle ? '<p class="card-sub">' + subtitle + '</p>' : '') + body + '</div>';
  }

  function blockHtml(block, colors) {
    var badges = Object.keys(block.counts).sort().map(function (source) {
      return sourceBadge(source) + '<span class="muted tiny">×' + block.counts[source] + '</span>';
    }).join(' ');
    return '<div class="block-card">' +
      '<div class="block-head">' +
      '<span class="block-time">' + fmtTime(block.start) + ' – ' + fmtTime(block.end) + '</span>' +
      '<span class="block-mins">' + block.minutes + ' phút</span>' +
      '<span class="block-project">' + esc(block.project || 'chưa rõ dự án') + '</span>' +
      '</div>' +
      '<div class="block-sources">' + badges + '</div>' +
      (block.headline && block.headline.length
        ? '<p class="block-headline">' + block.headline.slice(0, 2).map(function (text) { return esc(String(text).slice(0, 110)); }).join(' · ') + '</p>'
        : '') +
      '</div>';
  }

  /* ------------------------------------------------------------------
     Kế hoạch: thời khoá biểu, bốn tầm nhìn, đợt làm việc.

     Ba khối này trả lời câu hỏi mà cả DevTrace trước đây không đặt ra:
     "hôm nay ĐỊNH làm gì, và thực tế lệch ở đâu". Chúng đứng trên cùng màn
     Hôm nay — đúng nghĩa "phía trên" — vì đó là thứ cần nhìn thấy trước khi
     đọc bất cứ con số nào về ngày hôm qua.

     Từ vựng ở đây phải khớp app/plans.js. Không nhập chung được vì tệp này
     chạy trong trình duyệt còn tệp kia chạy trong Node.
     ------------------------------------------------------------------ */

  var SLOT_CLASS = {
    done: 'slot-ok', partial: 'slot-partial', missed: 'slot-missed',
    'no-evidence': 'slot-unknown', break: 'slot-off', off: 'slot-off'
  };
  var SLOT_LABEL = {
    done: 'khớp phần lớn', partial: 'làm một phần', missed: 'dấu vết thuộc việc khác',
    'no-evidence': 'chưa có dấu vết', break: 'buổi nghỉ', off: 'đang tắt'
  };
  var KIND_LABEL = { deep: 'việc sâu', study: 'học', admin: 'hành chính', break: 'nghỉ' };
  var HORIZON_LABEL = { day: 'trong ngày', week: 'tuần này', goal: 'mục tiêu', recurring: 'cố định' };

  /* Một buổi: chip ở dải trên cùng. Bấm vào mở dòng đối chiếu ngay dưới
     chính nó — không mở hộp thoại, vì câu hỏi "buổi này lệch ở đâu" phải
     trả lời được mà không che mất phần còn lại của ngày. */
  function slotDetailHtml(s) {
    var minutes = 'Dự kiến <b>' + fmtMinutes(s.plannedMinutes) + '</b>';
    if (s.status === 'break' || s.status === 'off') return minutes + '.';
    var lines = [minutes + ', có dấu vết <b>' + fmtMinutes(s.matchedMinutes) + '</b> trong khung này.'];
    var tail;
    if (s.status === 'no-evidence') {
      /* Nguyên tắc 6 — câu này không được rút gọn cho gọn chữ. */
      tail = 'Cả ngày chưa đọc được dấu vết nào, nên buổi này <b>không đối chiếu được</b>. '
        + 'Vắng dữ liệu không có nghĩa là chưa làm.';
    } else if (s.status === 'missed') {
      tail = 'Trong khung này <b>có</b> hoạt động, nhưng không thuộc việc của buổi. '
        + 'Có thể huynh đã làm việc khác — DevTrace không biết là việc gì.';
    } else if (s.status === 'partial') {
      tail = 'Còn <b>' + fmtMinutes(s.unaccountedMinutes) + '</b> chưa rõ chỗ nào. Con số này là ước lượng, '
        + 'không phải phép đo: nghỉ giữa buổi làm nó bị tách khúc.';
    } else {
      tail = 'Phần lớn thời lượng có dấu vết khớp.';
    }
    return lines.concat('<div class="slot-note">' + tail + '</div>').join('') +
      (s.projectName ? '<div class="tiny muted">Dự án: ' + esc(s.projectName) + '</div>' : '');
  }

  /* --- Bảng tuần ------------------------------------------------------

     Bố cục lấy từ chính thời khoá biểu huynh đang dùng trên giấy: cột trái
     là mục tiêu dài hạn, bảy cột là bảy thứ, mỗi hàng là MỘT khung giờ, và
     hàng cuối là "Nguyên tắc".

     Một chỗ CỐ Ý khác tấm ảnh: màu trong ô là KẾT QUẢ ĐỐI CHIẾU, không
     phải màu mục tiêu. Màu mục tiêu chỉ nằm ở cột trái. Nếu một ô vừa mang
     màu mục tiêu vừa mang màu trạng thái thì người đọc sẽ tưởng ô xanh là
     "đã làm" — mà đó đúng là thứ DevTrace không được phép nói sai. */

  var WEEK_COLUMNS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

  function clockMinutes(value) {
    var parts = String(value == null ? '' : value).split(':');
    var h = Number(parts[0]);
    var m = Number(parts[1]);
    if (!isFinite(h) || !isFinite(m)) return 0;
    return h * 60 + m;
  }

  /* Dịch ngày thuần bằng chuỗi, không kéo múi giờ vào: chuỗi 'YYYY-MM-DD'
     đọc qua `new Date(chuỗi)` là UTC, còn `new Date(y, m, d)` là giờ máy —
     trộn hai lối đó là lệch một ngày ở nửa đêm. */
  function shiftDay(day, delta) {
    var parts = String(day || '').split('-');
    if (parts.length !== 3) return null;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + delta);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function dayShort(day) {
    var parts = String(day || '').split('-');
    return parts.length === 3 ? parts[2] + '/' + parts[1] : String(day || '');
  }

  /* Sáng / chiều / tối chỉ là NHÃN ĐỌC cho nhanh, không phải một trường dữ
     liệu. Mốc 12:00 và 18:00 lấy theo đúng ba khung trong ảnh; buổi nào lệch
     mốc thì vẫn nằm nguyên ở hàng của nó, chỉ khác chữ bên cạnh. */
  function periodLabel(start) {
    var minutes = clockMinutes(start);
    if (minutes < 12 * 60) return 'Sáng';
    if (minutes < 18 * 60) return 'Chiều';
    return 'Tối';
  }

  /* Màu mục tiêu là TRANG TRÍ để mắt tách hàng, không phải một bảng mã: năm
     màu cho bao nhiêu mục tiêu cũng được, nên hai mục tiêu khác nhau hoàn
     toàn có thể trùng màu. Băm ở đây chỉ cần ổn định qua các lần tải. */
  function goalClass(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return 'slot-goal-' + (h % 5 + 1);
  }

  /* Một buổi, trong ô của bảng. Không lặp lại giờ ở đây: giờ đã nằm ở đầu
     hàng, nhắc lại bảy lần chỉ tổ rối mắt. */
  function slotButton(ctx, s) {
    if (!s.status) {
      /* Máy chủ chưa trả kết quả đối chiếu cho tuần này. KHÔNG mượn
         `slot-unknown`: chữ đó có nghĩa khác hẳn — "cả ngày không đọc được
         dấu vết nào" — và mượn nó là nói sai về dữ liệu của huynh. */
      return '<span class="slot slot-pending">' +
        '<span class="slot-title">' + esc(s.title) + '</span>' +
        '<span class="slot-state">chưa đối chiếu</span>' +
        '</span>';
    }
    var key = 'slot-' + s.id;
    var open = isOpen(ctx, key);
    var cls = SLOT_CLASS[s.status] || 'slot-unknown';
    return '<button class="slot ' + cls + '" type="button" data-action="toggle-detail" data-value="' + esc(key) + '" ' +
      'aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="slot-title">' + esc(s.title) + '</span>' +
      '<span class="slot-state">' + esc(SLOT_LABEL[s.status] || s.status) + '</span>' +
      (s.kind && s.kind !== 'deep' ? '<span class="slot-kind">' + esc(KIND_LABEL[s.kind] || s.kind) + '</span>' : '') +
      '</button>';
  }

  /* Gom buổi thành HÀNG theo ĐÚNG cặp giờ. Hai buổi 09:00–11:00 và
     09:05–11:00 thành hai hàng riêng: giấu chuyện đó đi là nói dối về thời
     khoá biểu của chính huynh. */
  function weekRows(week, template) {
    var rows = [];
    var byKey = {};
    function add(weekday, s) {
      var key = s.start + '–' + s.end;
      if (!byKey[key]) {
        byKey[key] = { start: s.start, end: s.end, cells: {} };
        rows.push(byKey[key]);
      }
      if (!byKey[key].cells[weekday]) byKey[key].cells[weekday] = [];
      byKey[key].cells[weekday].push(s);
    }
    if (week) {
      week.days.forEach(function (d) { d.sessions.forEach(function (s) { add(s.weekday, s); }); });
    } else {
      (template || []).forEach(function (s) { add(s.weekday, s); });
    }
    rows.sort(function (a, b) {
      return (clockMinutes(a.start) - clockMinutes(b.start)) || (clockMinutes(a.end) - clockMinutes(b.end));
    });
    return rows;
  }

  /* Cột Target của một hàng. Hàng mà các thứ gắn mục tiêu KHÁC NHAU thì
     không tô màu: in thẳng ra là khác nhau, thay vì chọn bừa một cái rồi để
     hàng đó nói dối về sáu thứ còn lại. */
  function rowGoal(row) {
    var ids = [];
    Object.keys(row.cells).forEach(function (weekday) {
      row.cells[weekday].forEach(function (s) {
        if (s.goalId && ids.indexOf(s.goalId) === -1) ids.push(s.goalId);
      });
    });
    if (!ids.length) return { cls: 'slot-goal-none', label: 'chưa gắn mục tiêu' };
    if (ids.length > 1) return { cls: 'slot-goal-many', label: 'mục tiêu khác nhau giữa các thứ' };
    var title = null;
    Object.keys(row.cells).forEach(function (weekday) {
      row.cells[weekday].forEach(function (s) {
        if (!title && s.goalId === ids[0] && s.goalTitle) title = s.goalTitle;
      });
    });
    return { cls: goalClass(ids[0]), label: title || '(mục tiêu chưa đặt tên)' };
  }

  function detailOpenHtml(s, row) {
    return '<div class="slot-detail-open">' +
      '<div class="slot-detail-head">' + esc(WEEK_COLUMNS[s.weekday - 1] || '') + ' · ' +
      esc(row.start) + '–' + esc(row.end) + ' · <b>' + esc(s.title) + '</b></div>' +
      slotDetailHtml(s) +
      '<div class="row-actions mt">' +
      '<button class="btn btn-sm" data-action="slot-form" data-value="' + esc(s.id) + '">Sửa buổi</button>' +
      '<button class="btn btn-sm" data-action="slot-delete" data-value="' + esc(s.id) + '">Xoá buổi</button>' +
      '</div></div>';
  }

  function weekTableHtml(ctx, week, template) {
    var plans = ctx.data.plans || {};
    var rows = weekRows(week, template);
    var start = (week && week.weekStart) || plans.weekStart || plans.day || null;

    var columns = [];
    for (var i = 0; i < 7; i++) {
      var d = (week && week.days && week.days[i]) || null;
      columns.push({
        weekday: i + 1,
        label: WEEK_COLUMNS[i],
        day: (d && d.day) || (start ? shiftDay(start, i) : null),
        isViewed: !!(d && d.isViewed) || (!d && !!plans.day && shiftDay(start, i) === plans.day),
        upcoming: !!(d && d.upcoming)
      });
    }

    var html = ['<div class="timetable-wrap"><table class="timetable"><thead><tr>' +
      '<th class="slot-head">Khung giờ</th>'];
    columns.forEach(function (c) {
      html.push('<th class="slot-col' + (c.isViewed ? ' slot-today' : '') + '">' + esc(c.label) +
        (c.day ? '<span class="slot-date">' + esc(dayShort(c.day)) + '</span>' : '') +
        (c.upcoming ? '<span class="slot-upcoming">chưa tới</span>' : '') +
        '</th>');
    });
    html.push('</tr></thead><tbody>');

    rows.forEach(function (row) {
      var goal = rowGoal(row);
      html.push('<tr><th class="slot-head slot-head-time">' +
        '<span class="slot-time">' + esc(row.start) + '–' + esc(row.end) + '</span>' +
        '<span class="slot-period">' + esc(periodLabel(row.start)) + '</span>' +
        '<span class="slot-target ' + goal.cls + '">' + esc(goal.label) + '</span>' +
        '</th>');
      columns.forEach(function (c) {
        var list = row.cells[c.weekday] || [];
        html.push('<td class="slot-cell' + (c.isViewed ? ' slot-today' : '') + '">');
        if (list.length) {
          html.push(list.map(function (s) { return slotButton(ctx, s); }).join(''));
        } else {
          /* Ô trống vẫn phải bấm được: nó mang sẵn đúng thứ và đúng khung
             giờ của chính nó, nên mở form ra là điền sẵn — không phải chọn
             lại từ đầu. */
          html.push('<button class="slot-empty" type="button" data-action="slot-form" ' +
            'data-value="' + esc('new:' + c.weekday + ':' + row.start + ':' + row.end) + '" ' +
            'title="Thêm buổi vào ô này">+</button>');
        }
        html.push('</td>');
      });
      html.push('</tr>');

      /* Dòng đối chiếu nằm NGAY DƯỚI hàng của nó: câu hỏi "buổi này lệch ở
         đâu" phải trả lời được mà không che mất phần còn lại của tuần. */
      var open = [];
      columns.forEach(function (c) {
        (row.cells[c.weekday] || []).forEach(function (s) {
          if (s.status && isOpen(ctx, 'slot-' + s.id)) open.push(s);
        });
      });
      if (open.length) {
        html.push('<tr class="slot-detail-row"><td colspan="' + (columns.length + 1) + '">' +
          open.map(function (s) { return detailOpenHtml(s, row); }).join('') + '</td></tr>');
      }
    });

    var principle = (week && week.principle) || plans.principle || '';
    html.push('<tr class="slot-principle-row"><th class="slot-head">Nguyên tắc</th>' +
      '<td colspan="' + columns.length + '">' +
      (principle
        ? '<span class="slot-principle-text">' + esc(principle) + '</span>'
        : '<span class="muted">Chưa đặt nguyên tắc cho tuần này.</span>') +
      '<button class="btn btn-sm" data-action="timetable-note">Sửa nguyên tắc</button>' +
      '</td></tr>');

    html.push('</tbody></table></div>');
    return { html: html.join(''), rows: rows.length, pending: !week };
  }

  function timetableHtml(ctx) {
    var plans = ctx.data.plans || {};
    var week = plans.week || null;
    var template = plans.timetable || [];
    var schedule = (ctx.data.digest && ctx.data.digest.schedule) || null;

    var sub = 'Cả tuần huynh định làm gì, và tuần đó thực tế lệch ở đâu. ' +
      'Màu <b>trong ô</b> là kết quả đối chiếu; màu <b>ở cột trái</b> chỉ để phân biệt mục tiêu. ' +
      'Đối chiếu là <b>ước lượng</b> từ dấu vết máy đọc được, không phải bảng chấm công.';
    var head = '<button class="btn btn-sm" data-action="slot-form">Thêm buổi</button>';

    var table = weekTableHtml(ctx, week, template);
    if (!table.rows) {
      return card('Thời khoá biểu', '刻',
        '<p class="card-sub">' + sub + '</p>' +
        '<div class="empty">Chưa có thời khoá biểu. Thêm vài buổi cố định trong tuần — ' +
        'ví dụ “09:00–11:30 thứ Hai, học tiếng Nhật” — rồi DevTrace đối chiếu chúng với dấu vết thật. ' +
        'Ô trống trong bảng cũng bấm được: nó tự điền sẵn đúng thứ và đúng khung giờ.</div>',
        head);
    }

    var totals = '';
    if (schedule && schedule.sessions && schedule.sessions.length) {
      totals = '<div class="slot-totals">' +
        '<span class="badge">' + esc(schedule.weekdayLabel || 'Hôm nay') +
        ' — dự kiến <b class="mono">' + fmtMinutes(schedule.plannedMinutes) + '</b></span>' +
        '<span class="badge">Có dấu vết <b class="mono">' + fmtMinutes(schedule.matchedMinutes) + '</b></span>' +
        (schedule.unaccountedMinutes
          ? '<span class="badge">Chưa rõ chỗ <b class="mono">' + fmtMinutes(schedule.unaccountedMinutes) + '</b></span>' : '') +
        '</div>' +
        '<p class="tiny muted">' + esc(schedule.note || '') + '</p>';
    } else if (table.pending) {
      totals = '<p class="tiny muted">Chưa đối chiếu được tuần này — máy chủ chưa trả số liệu. ' +
        'Bảng dưới đây là mẫu lặp theo tuần, chưa có kết quả đối chiếu.</p>';
    }

    return card('Thời khoá biểu', '刻',
      '<p class="card-sub">' + sub + '</p>' + totals + table.html, head);
  }

  /* --- Bảng bốn tầm nhìn --------------------------------------------- */

  function taskMeta(t) {
    var bits = [];
    if (t.projectName) bits.push(t.projectName);
    else if (t.projectPath) bits.push(t.projectPath);
    if (t.horizon === 'day' && t.dueDay) bits.push('hạn ' + fmtDate(t.dueDay));
    if (t.horizon === 'week' && t.dueDay) bits.push('tuần ' + fmtDate(t.dueDay));
    if (t.horizon === 'goal' && t.targetDay) bits.push('đến ' + fmtDate(t.targetDay));
    if (t.recurLabel) bits.push(t.recurLabel);
    if (t.points) bits.push(t.points + ' điểm');
    if (t.carriedCount) bits.push('mang sang lần thứ ' + t.carriedCount);
    if (t.overdue) bits.push('quá hạn');
    return bits.join(' · ');
  }

  function taskItem(t) {
    var meta = taskMeta(t);
    return '<li class="task' + (t.status === 'done' ? ' task-done' : '') + '">' +
      '<button class="task-check" data-action="plan-toggle" data-value="' + esc(t.id) + '" ' +
      'aria-label="' + (t.status === 'done' ? 'Bỏ tích' : 'Tích xong') + '">' + (t.status === 'done' ? '✓' : '○') + '</button>' +
      '<span class="task-body">' +
      '<span class="task-title">' + esc(t.title) + '</span>' +
      (meta ? '<span class="task-meta">' + esc(meta) + '</span>' : '') +
      '</span>' +
      '<span class="row-actions">' +
      '<button class="btn btn-sm" data-action="plan-form" data-value="' + esc(t.id) + '">Sửa</button>' +
      '<button class="btn btn-sm" data-action="plan-delete" data-value="' + esc(t.id) + '">Xoá</button>' +
      '</span></li>';
  }

  function occurItem(o) {
    return '<li class="task' + (o.done ? ' task-done' : '') + '">' +
      '<button class="task-check" data-action="plan-occur-toggle" data-value="' + esc(o.taskId) + '" ' +
      'data-done="' + (o.done ? '1' : '0') + '" aria-label="Tích buổi hôm nay">' + (o.done ? '✓' : '○') + '</button>' +
      '<span class="task-body">' +
      '<span class="task-title">' + esc(o.title) + '</span>' +
      '<span class="task-meta">' + (o.done ? 'đã tích buổi hôm nay' : 'buổi hôm nay chưa tích') + '</span>' +
      '</span>' +
      '<span class="row-actions">' +
      '<button class="btn btn-sm" data-action="plan-form" data-value="' + esc(o.taskId) + '">Sửa</button>' +
      '</span></li>';
  }

  function boardColumn(key, title, han, items, emptyText, horizon) {
    var addBtn = key === 'recurring'
      ? '<button class="btn btn-sm" data-action="plan-form" data-horizon="recurring">Thêm</button>'
      : '<button class="btn btn-sm" data-action="plan-form" data-horizon="' + esc(horizon) + '">Thêm</button>';
    return '<div class="board-col">' +
      '<div class="board-head"><span class="han">' + esc(han) + '</span><h3>' + esc(title) + '</h3>' +
      '<span class="muted tiny">' + items.length + '</span></div>' +
      (items.length ? '<ul class="task-list">' + items.join('') + '</ul>'
        : '<div class="empty tiny">' + esc(emptyText) + '</div>') +
      addBtn + '</div>';
  }

  /* --- Hộp thư đến ---------------------------------------------------

     Chỗ hứng những gì huynh gõ trong ba giây. Nó KHÔNG phải một tầm nhìn
     thứ năm: mục ở đây chưa có tầm nhìn, chưa có dự án, chưa có hạn — đó
     chính là lý do ghi nhanh mới nhanh được. Ba nút bên mỗi mục là lúc
     PHÂN LOẠI, và phân loại là việc của lúc rảnh, không phải của lúc gõ.

     Ô nhập hiện ngay trên màn Hôm nay, không giấu sau một nút: phím tắt
     toàn cục chỉ giúp được khi huynh đã biết nó có ở đó. */
  /* Nhãn nút phân loại phải NGẮN và phải khớp tên cột của bảng việc ngay
     bên dưới — bấm "Tuần này" mà không thấy nó chui vào đâu thì nút đó vô
     nghĩa. Ba tầm nhìn, không phải bốn: việc cố định cần thêm kiểu lặp, mà
     hỏi kiểu lặp ngay lúc phân loại là bắt quyết định hai lần một lúc. */
  var INBOX_TRIAGE = [['day', 'Hôm nay'], ['week', 'Tuần này'], ['goal', 'Mục tiêu']];

  function inboxItemHtml(item) {
    var id = esc(item.id);
    var triage = INBOX_TRIAGE.map(function (pair) {
      return '<button class="btn btn-sm" data-action="inbox-promote" data-value="' + id +
        '" data-horizon="' + pair[0] + '">' + pair[1] + '</button>';
    }).join('');
    return '<li class="inbox-item">' +
      '<button class="inbox-text" data-action="inbox-edit" data-value="' + id + '" ' +
      'title="Bấm để sửa chữ">' + esc(item.text) + '</button>' +
      '<span class="inbox-actions">' + triage +
      '<button class="btn btn-sm btn-ghost" data-action="inbox-delete" data-value="' + id + '" ' +
      'title="Xoá khỏi hộp thư đến">✕</button></span>' +
      '</li>';
  }

  function inboxHtml(ctx) {
    var plans = ctx.data.plans;
    if (!plans) return '';
    var items = (plans.inbox || []).filter(function (i) { return i && i.text; });
    var count = items.length;

    var list = count
      ? '<ul class="inbox-list">' + items.map(inboxItemHtml).join('') + '</ul>'
      : '<p class="card-sub inbox-empty">Trống. Gõ một dòng ở trên — hoặc bấm <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> ' +
        'ở bất kỳ đâu, kể cả khi DevTrace đang thu xuống khay.</p>';

    return card('Hộp thư đến', '收',
      '<p class="card-sub">Ghi nhanh, phân loại sau. Mục ở đây chưa phải việc — ' +
      'nó chỉ thành việc khi huynh bấm một trong ba tầm nhìn.</p>' +
      '<div class="inbox-capture">' +
      '<input type="text" id="inboxText" data-role="inbox-text" maxlength="300" ' +
      'placeholder="Ghi nhanh một việc rồi bấm Enter…">' +
      '<button class="btn btn-primary" data-action="inbox-add">Ghi</button>' +
      '</div>' +
      (count ? '<div class="card-sub mt">' + count + ' mục chưa phân loại</div>' : '') +
      list);
  }

  function boardHtml(ctx) {
    var plans = ctx.data.plans;
    if (!plans) return '';
    var board = plans.board || {};
    var day = (board.day || []).map(taskItem);
    var week = (board.week || []).map(taskItem);
    var goal = (board.goal || []).map(taskItem);
    var occur = (plans.occurrences || []).map(occurItem);

    return card('Việc và mục tiêu', '課',
      '<p class="card-sub">Bốn tầm nhìn: việc trong ngày, việc trong tuần, mục tiêu dài hạn, và việc cố định ' +
      'lặp theo thứ. Việc cố định chỉ có <b>một dòng</b> trong kho — buổi của từng ngày được tính ra lúc đọc, ' +
      'nên mở rộng cả năm cũng không phình tệp.</p>' +
      (plans.warnings && plans.warnings.length
        ? '<div class="alert alert-bad"><b>Tệp kế hoạch có vấn đề</b>' +
          plans.warnings.map(function (w) { return '<div class="alert-detail">' + esc(w) + '</div>'; }).join('') + '</div>'
        : '') +
      '<div class="board">' +
      boardColumn('day', 'Hôm nay', '今', day, 'Chưa có việc nào cho hôm nay.', 'day') +
      boardColumn('week', 'Tuần này', '週', week, 'Chưa có việc nào cho tuần này.', 'week') +
      boardColumn('goal', 'Mục tiêu', '標', goal, 'Chưa đặt mục tiêu dài hạn nào.', 'goal') +
      boardColumn('recurring', 'Cố định hôm nay', '每', occur, 'Hôm nay không có việc cố định nào.', 'recurring') +
      '</div>');
  }

  /* --- Dải đợt làm việc (sprint) ------------------------------------- */

  function daysBetween(a, b) {
    var pa = String(a || '').split('-'); var pb = String(b || '').split('-');
    if (pa.length !== 3 || pb.length !== 3) return null;
    var da = Date.UTC(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
    var db = Date.UTC(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
    if (isNaN(da) || isNaN(db)) return null;
    return Math.round((db - da) / 86400000);
  }

  function sprintBandHtml(ctx) {
    var plans = ctx.data.plans;
    if (!plans) return '';
    var active = plans.activeSprint;
    var backlog = plans.backlog || [];
    var today = ctx.state && ctx.state.day;

    var head;
    if (!active) {
      head = '<div class="spread"><span class="muted small">Chưa mở đợt làm việc nào. ' +
        'Đợt là một hộp thời gian: mở ra, chốt một mục tiêu, hết hộp thì đóng và đếm thật.</span>' +
        '<button class="btn btn-sm btn-primary" data-action="sprint-start">Mở đợt</button></div>';
    } else {
      var left = daysBetween(today, active.endDay);
      head = '<div class="spread"><div>' +
        '<b>' + esc(active.name || active.id) + '</b>' +
        (active.goal ? ' <span class="muted">· ' + esc(active.goal) + '</span>' : '') +
        '<div class="tiny muted">' + fmtDate(active.startDay) + ' → ' + fmtDate(active.endDay) +
        (left === null ? '' : (left < 0 ? ' · đã quá hạn ' + Math.abs(left) + ' ngày' : ' · còn ' + left + ' ngày')) +
        '</div></div>' +
        '<button class="btn btn-sm" data-action="sprint-close">Đóng đợt</button></div>';
    }

    var backlogHtml = backlog.length
      ? '<div class="mt"><div class="card-sub">Việc chờ xếp vào đợt (' + backlog.length + ')</div>' +
        '<ul class="list compact">' + backlog.map(function (b) {
          return '<li>' + esc(b.title) +
            ' <span class="li-note">' + esc(HORIZON_LABEL[b.horizon] || b.horizon) +
            (b.points ? ' · ' + b.points + ' điểm' : '') +
            (b.carriedCount ? ' · mang sang lần thứ ' + b.carriedCount : '') + '</span>' +
            (active
              ? ' <button class="btn btn-sm" data-action="sprint-move" data-value="' + esc(b.id) + '">Vào đợt</button>'
              : '') +
            '</li>';
        }).join('') + '</ul></div>'
      : '<p class="tiny muted mt">Không còn việc nào chờ xếp đợt. Việc trong ngày và việc cố định không bao giờ ' +
        'thuộc đợt — chúng lặp theo lịch, không theo hộp thời gian.</p>';

    var velocity = plans.velocity || {};
    var velHtml;
    if (!velocity.available) {
      /* Cố ý KHÔNG vẽ biểu đồ vận tốc khi chưa đủ hai đợt: một điểm dữ liệu
         duy nhất bị đọc thành một lời hứa. */
      velHtml = '<p class="tiny muted mt">' + esc(velocity.note || 'Chưa đủ dữ liệu để nói về tốc độ.') + '</p>';
    } else {
      velHtml = '<div class="mt card-sub">Đã xong mỗi đợt (điểm · việc)</div>' +
        '<ul class="list compact">' + velocity.sprints.map(function (s) {
          return '<li>' + esc(s.name) + ' <span class="li-note">' + fmtDate(s.startDay) + ' → ' + fmtDate(s.endDay) + '</span> ' +
            '<b class="mono">' + s.points + '</b> điểm · <b class="mono">' + s.done + '</b> việc' +
            (s.carried ? ' <span class="li-note">· mang sang ' + s.carried + '</span>' : '') + '</li>';
        }).join('') + '</ul>' +
        '<p class="tiny muted">Trung bình ' + velocity.averagePoints + ' điểm · ' + velocity.averageDone + ' việc mỗi đợt.</p>';
    }

    return '<section class="card sprint-band">' +
      '<div class="card-head"><span class="han">迭</span><h2>Đợt làm việc</h2><span class="spacer"></span></div>' +
      head + backlogHtml + velHtml + '</section>';
  }

  /* --- Sức khoẻ kho mã ------------------------------------------------ */

  function repoChip(r) {
    if (r.error) {
      return '<button class="repo-chip is-bad" data-action="repo-detail" data-value="' + esc(r.path) + '">' +
        '<b>' + esc(r.name) + '</b><span>' + esc(r.error) + '</span></button>';
    }
    var w = r.working || {};
    var dirty = w.total || 0;
    var bits = [];
    if (r.branch) bits.push(r.branch);
    if (dirty) bits.push(dirty + ' thay đổi');
    else bits.push('sạch');
    if (r.behind) bits.push('sau remote ' + r.behind);
    if (r.ahead) bits.push('trước remote ' + r.ahead);
    if (r.stashes && r.stashes.length) bits.push(r.stashes.length + ' stash');
    if (r.secrets && r.secrets.hits && r.secrets.hits.length) bits.push(r.secrets.hits.length + ' dấu hiệu bí mật');
    return '<button class="repo-chip' + (dirty ? ' is-dirty' : '') +
      (r.secrets && r.secrets.hits && r.secrets.hits.length ? ' is-bad' : '') +
      '" data-action="repo-detail" data-value="' + esc(r.path) + '">' +
      '<b>' + esc(r.name) + '</b><span>' + esc(bits.join(' · ')) + '</span></button>';
  }

  function repoHealthHtml(ctx) {
    var health = ctx.data.repohealth;
    var refresh = '<button class="btn btn-sm" data-action="repo-refresh">Quét lại</button>';
    if (!health) return card('Sức khoẻ kho mã', '庫', '<div class="empty">Chưa đọc được ảnh chụp.</div>', refresh);

    var settings = health.settings || {};
    var shot = health.snapshot;
    if (!shot) {
      return card('Sức khoẻ kho mã', '庫',
        '<p class="card-sub">Sức khoẻ kho là ảnh chụp <b>lúc này</b>, không phải chuyện của một ngày — ' +
        'cây làm việc bẩn hôm nay không nói được gì về ba tháng trước. Nên nó không nằm trong bằng chứng, ' +
        'và cảnh báo về kho chỉ hiện khi huynh đang xem <b>hôm nay</b>.</p>' +
        '<div class="empty">Chưa quét lần nào. Quét tốn khoảng sáu lệnh git mỗi kho, tối đa ' +
        num(settings.maxRepos) + ' kho mỗi lần.</div>', refresh);
    }

    var repos = shot.repos || [];
    var failed = repos.filter(function (r) { return r.error; });
    var dirty = repos.filter(function (r) { return !r.error && ((r.working || {}).total || 0) > 0; });
    var off = repos.filter(function (r) { return !r.error && ((r.behind || 0) > 0 || (r.ahead || 0) > 0); });
    var secretRepos = repos.filter(function (r) { return r.secrets && r.secrets.hits && r.secrets.hits.length; });
    var secretHits = secretRepos.reduce(function (sum, r) { return sum + r.secrets.hits.length; }, 0);

    return card('Sức khoẻ kho mã', '庫',
      '<p class="card-sub">Ảnh chụp <b>lúc này</b>, không phải chuyện của một ngày. ' +
      'Cảnh báo về kho chỉ hiện ở màn Hôm nay khi huynh đang xem đúng hôm nay.</p>' +
      (health.stale
        ? '<div class="alert alert-warn"><span class="badge">ảnh chụp cũ</span> ' +
          'Ảnh chụp này là của ngày ' + esc(fmtDate(shot.day)) + ', chưa quét lại hôm nay.</div>' : '') +
      '<div class="grid cols-4">' +
      stat('Kho quét được', num(shot.scanned) + '/' + num(shot.total), shot.skipped ? 'bỏ qua ' + shot.skipped + ' kho' : 'quét hết', '') +
      stat('Đang bẩn', String(dirty.length), 'có thay đổi chưa ghi lại', dirty.length ? 'warn' : 'good') +
      stat('Lệch remote', String(off.length), 'trước hoặc sau bản trên mạng', off.length ? 'warn' : 'good') +
      stat('Dấu hiệu bí mật', String(secretHits), secretRepos.length ? 'trong ' + secretRepos.length + ' kho' : 'chưa quét hoặc không thấy', secretHits ? 'warn' : '') +
      '</div>' +
      '<div class="repo-list mt">' + repos.map(repoChip).join('') + '</div>' +
      (failed.length
        ? '<p class="tiny" style="color:var(--cinabar)">' + failed.length + ' kho không đọc được: ' +
          failed.map(function (r) { return esc(r.name) + ' (' + esc(r.error) + ')'; }).join(', ') + '</p>' : '') +
      (secretHits
        ? '<p class="tiny muted">Dấu hiệu bí mật là <b>dấu hiệu</b>, không phải kết luận — DevTrace chỉ nêu tên tệp, ' +
          'số dòng và loại quy tắc, tuyệt đối không in giá trị tìm được. Nếu có thật thì việc cần làm là xoay khoá, ' +
          'không phải xoá dòng đó khỏi mã.</p>' : '') +
      ((shot.notes || []).length
        ? '<p class="tiny muted">' + shot.notes.map(function (n) { return esc(n); }).join('<br>') + '</p>' : '') +
      '<p class="tiny muted">Quét lúc ' + fmtTime(shot.updatedAt) + ' · ' +
      'quét nội dung tệp để tìm bí mật đang ' + (settings.secretScan ? '<b>bật</b>' : 'tắt') +
      ' (đổi trong Cài đặt → Nâng cao).</p>', refresh);
  }

  /* ------------------------------------------------------------------
     Hộp thư — thẻ ở cột phải màn Hôm nay, cạnh nhật ký.

     ĐÂY LÀ CHỖ DUY NHẤT TRONG GIAO DIỆN HIỆN TIÊU ĐỀ THƯ, và nó chỉ đi tới
     màn hình của chính huynh: `/api/mail` là tuyến duy nhất mang tiêu đề ra
     khỏi máy chủ. Cảnh báo và gói bằng chứng gửi cho AI đi đường khác, qua
     `Mail.summary`, và bên đó chỉ có con số. Ai định thêm tiêu đề vào cảnh
     báo thì đọc điều 1 ở đầu `app/mail.js` trước.
     ------------------------------------------------------------------ */

  function mailRow(m) {
    var age = m.hours == null ? 'không rõ ngày'
      : m.hours < 24 ? 'hôm nay' : num(m.days) + ' ngày';
    return '<div class="mail-row">' +
      '<div class="mail-who"><span class="name">' + esc(m.from) + '</span>' +
      '<span class="muted tiny">' + esc(age) + (m.seen ? '' : ' · chưa mở') + '</span></div>' +
      '<div class="mail-subject">' + esc(m.subject) + '</div>' +
      '<button class="btn btn-sm" data-action="plan-form" data-value="" ' +
      'data-mail-subject="' + esc(m.subject) + '" title="Điền sẵn tiêu đề thư vào ô nhiệm vụ — huynh sửa được trước khi lưu">' +
      'Tạo nhiệm vụ</button>' +
      '</div>';
  }

  function mailCard(ctx) {
    var mail = ctx.data.mail;
    var head = '<span class="row-actions">' +
      '<button class="btn btn-sm" data-action="mail-refresh">Quét</button>' +
      '<button class="btn btn-sm" data-action="mail-toggle">' +
      (mail && mail.enabled ? 'Tắt theo dõi' : 'Bật theo dõi') + '</button></span>';

    if (!mail) {
      return card('Hộp thư', '郵', '<div class="empty">Chưa đọc được trạng thái hộp thư.</div>', head);
    }
    if (!mail.enabled) {
      return card('Hộp thư', '郵',
        '<p class="card-sub">DevTrace <b>không</b> đọc hộp thư của huynh trừ khi huynh bật. ' +
        'Khi bật, nó chỉ <b>đếm</b> thư có thể chưa được trả lời. Tiêu đề thư và người gửi không đi đâu cả: ' +
        'không vào cảnh báo, không vào gói bằng chứng gửi cho AI, không vào tệp xuất.</p>' +
        '<div class="empty">Đang tắt.</div>', head);
    }
    if (!mail.ready) {
      return card('Hộp thư', '郵',
        '<p class="card-sub">Đã bật nhưng chưa điền đủ máy chủ và tài khoản.</p>' +
        '<div class="empty">Vào Cài đặt để điền. Mật khẩu ứng dụng để trong biến môi trường <code>' +
        esc(mail.passwordEnv) + '</code> — DevTrace không lưu mật khẩu vào tệp cấu hình.</div>', head);
    }
    if (!mail.synced) {
      return card('Hộp thư', '郵',
        '<p class="card-sub">Chỉ TLS ngầm ở cổng 993, và chỉ mật khẩu ứng dụng. Tài khoản chỉ cho OAuth ' +
        'thì DevTrace nói thẳng là không dùng được, chứ không thử một đường vòng kém chắc hơn.</p>' +
        '<div class="empty">Chưa quét lần nào. Cần biến môi trường <code>' + esc(mail.passwordEnv) +
        '</code> đã đặt trước khi mở DevTrace.</div>', head);
    }
    if (mail.error) {
      return card('Hộp thư', '郵',
        '<div class="alert alert-warn"><span class="badge">lỗi</span> ' + esc(mail.error) + '</div>' +
        '<p class="card-sub">Đây là lỗi của riêng hộp thư. Mọi thứ khác của DevTrace vẫn chạy bình thường.</p>' +
        ((mail.notes || []).length
          ? '<p class="tiny muted">' + mail.notes.map(function (n) { return esc(n); }).join('<br>') + '</p>' : ''), head);
    }

    var body =
      '<p class="card-sub">Ước lượng từ hộp thư đồng bộ <b>trên máy này</b>. Trả lời từ máy khác vẫn bị tính là ' +
      'chưa trả lời, và thư quảng cáo thì nằm mãi trong danh sách — đây là ước lượng, không phải sự thật.</p>' +
      (mail.stale
        ? '<div class="alert alert-warn"><span class="badge">ảnh chụp cũ</span> Số liệu này là của ' +
          esc(fmtDate(mail.day)) + ', chưa quét lại hôm nay. Hộp thư đổi liên tục nên con số của ngày khác ' +
          'không nói được gì về lúc này.</div>' : '') +
      (mail.weak
        ? '<div class="alert alert-warn"><span class="badge">thiếu tín hiệu</span> Chưa đọc thư mục Đã gửi, nên ' +
          'DevTrace không biết thư nào đã được đáp — con số dưới đây chỉ dựa vào cờ đã-trả-lời của máy chủ, ' +
          'và nó thường đếm <b>thừa</b>. Điền thư mục Đã gửi ở Cài đặt rồi quét lại.</div>' : '') +
      '<div class="grid cols-3">' +
      stat('Có thể chưa trả lời', num(mail.waiting),
        mail.waiting ? 'cũ nhất ' + num(mail.oldestDays) + ' ngày' : 'không có gì đang chờ',
        mail.waiting ? 'warn' : 'good') +
      stat('Chưa mở lần nào', num(mail.unseen), 'quá ' + num(mail.unansweredHours) + ' giờ', mail.unseen ? 'warn' : 'good') +
      stat('Đã đối chiếu', num(mail.answered) + '/' + num(mail.total), 'thư đọc được trong ' + num(mail.sentCount) + ' thư đã gửi', '') +
      '</div>';

    if (!mail.items.length) {
      body += '<div class="empty mt">Không có thư nào đang chờ trả lời.</div>';
    } else {
      body += '<div class="mail-list mt">' + mail.items.map(mailRow).join('') + '</div>';
      if (mail.itemTotal > mail.items.length) {
        body += '<p class="tiny muted">Còn ' + num(mail.itemTotal - mail.items.length) + ' thư nữa chưa kể ra.</p>';
      }
    }
    body += '<p class="tiny muted">Hộp thư <b>' + esc(mail.folder) + '</b>' +
      (mail.sentFolder ? ' · đã gửi <b>' + esc(mail.sentFolder) + '</b>' : ' · <b>chưa</b> đọc thư mục đã gửi') +
      ' · quét lúc ' + fmtTime(mail.at) + '.</p>';
    if ((mail.notes || []).length) {
      body += '<p class="tiny muted">' + mail.notes.map(function (n) { return esc(n); }).join('<br>') + '</p>';
    }
    return card('Hộp thư', '郵', body, head);
  }

  /* ------------------------------------------------------------------
     Cảnh báo — một danh sách duy nhất.

     Phần lớn mục đến từ digest.warnings (máy chủ tính, nên gói bằng chứng
     gửi cho AI cũng mang đúng danh sách này). Hai thứ dưới đây chỉ có ở phía
     trình duyệt nên phải gộp thêm: cảnh báo trích dẫn của nhật ký, và báo cáo
     của lần thu thập vừa rồi.
     ------------------------------------------------------------------ */

  var WARN_LABEL = {
    friction: 'điểm vướng', gap: 'nguồn im lặng', source: 'nguồn',
    citation: 'trích dẫn', collect: 'thu thập', retention: 'lưu trữ',
    plan: 'kế hoạch', task: 'nhiệm vụ', sprint: 'đợt làm việc',
    schedule: 'thời khoá biểu', mail: 'hộp thư', repo: 'kho mã'
  };

  function mergeWarnings(ctx) {
    var out = [];
    var data = ctx.data || {};

    if (data.digest && data.digest.warnings && data.digest.warnings.length) {
      out = out.concat(data.digest.warnings);
    }

    var journal = data.journal;
    var check = journal && journal.evidence && journal.evidence.check;
    if (check && check.invalid && check.invalid.length) {
      out.push({
        level: 'warn', kind: 'citation', weight: 5,
        title: 'Nhật ký AI trích dẫn không kiểm chứng được',
        detail: check.invalid.join(', ')
      });
    } else if (check && check.uncited) {
      out.push({ level: 'info', kind: 'citation', weight: 0, title: 'Nhật ký không kèm trích dẫn nào', detail: null });
    }

    var last = ctx.state && ctx.state.lastCollect;
    if (last) {
      (last.failed || []).forEach(function (name) {
        out.push({ level: 'bad', kind: 'collect', weight: 8, title: 'Lần thu thập vừa rồi: nguồn “' + name + '” lỗi', detail: null });
      });
      (last.notes || []).forEach(function (note) {
        out.push({ level: 'info', kind: 'collect', weight: 0, title: String(note), detail: null });
      });
      if (last.retention && last.retention.removed && last.retention.removed.length) {
        out.push({
          level: 'warn', kind: 'retention', weight: 4,
          title: 'Hạn lưu trữ đã xoá ' + last.retention.removed.length + ' ngày cũ', detail: null
        });
      }
    }

    return out;
  }

  function warningsHtml(ctx, title) {
    var items = mergeWarnings(ctx);
    if (!items.length) return '';
    var rows = items.map(function (w) {
      return '<li class="alert alert-' + esc(w.level || 'info') + '">' +
        '<span class="badge">' + esc(WARN_LABEL[w.kind] || w.kind || 'cảnh báo') + '</span> ' +
        '<span class="alert-title">' + esc(w.title || '') + '</span>' +
        (w.project ? ' <span class="li-note">· ' + esc(w.project) + '</span>' : '') +
        (w.detail ? '<div class="alert-detail">' + esc(w.detail) + '</div>' : '') +
        '</li>';
    }).join('');
    return card(title || 'Cảnh báo', '警',
      '<p class="card-sub">' + items.length + ' điều đáng lưu ý cho ngày này — không phải mục nào cũng là lỗi. ' +
      'Vắng dữ liệu không có nghĩa là hôm đó không làm gì.</p>' +
      '<ul class="alert-list">' + rows + '</ul>');
  }

  function warnCount(ctx) { return mergeWarnings(ctx).length; }

  function todayView(ctx) {
    var digest = ctx.data.digest;
    var journal = ctx.data.journal;
    var status = ctx.data.status;
    var colors = ctx.colors;
    var t = digest.totals;

    /* --- Câu 1: đã làm gì --- */
    var blocksBody = digest.blocks.length
      ? digest.blocks.map(function (b) { return blockHtml(b, colors); }).join('')
      : '<div class="empty">Ngày này chưa thu được dấu vết nào. Bấm “Thu thập dấu vết” ở thanh bên.</div>';

    var projectRows = digest.projects.filter(function (p) { return p.events > 4; }).slice(0, 5);
    var projectsTable = projectRows.length
      ? '<table class="table"><thead><tr><th>Dự án</th><th class="num">Phút</th><th class="num">Lượt AI</th><th class="num">Tệp</th><th class="num">Commit</th><th class="num">Tra cứu</th></tr></thead><tbody>' +
        projectRows.map(function (p) {
          return '<tr><td>' + esc(p.project) + '</td><td class="num">' + p.minutes + '</td><td class="num">' + p.aiTurns +
            '</td><td class="num">' + p.files + '</td><td class="num">' + p.commits + '</td><td class="num">' + p.docVisits + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '';

    /* Tiêu đề và câu tóm tắt luôn hiện; phần chi tiết gấp lại. Đây là điều
       làm màn hình đọc được: ba câu trả lời nằm trong tầm mắt, còn bảng biểu
       thì chờ sẵn sau một cú bấm. */
    var q1Detail = blocksBody + (projectsTable ? '<div class="mt">' + projectsTable + '</div>' : '');
    var q1Meta = digest.blocks.length + ' khối' + (projectRows.length ? ' · ' + projectRows.length + ' dự án' : '');

    var questionOne = question('一', '1', 'Huynh đã làm gì',
      'Gom từ <b>' + fmtNumber(t.events) + '</b> sự kiện, chia thành <b>' + digest.blocks.length + '</b> khối làm việc, tổng <b>' + fmtMinutes(digest.minutes) + '</b> có hoạt động.',
      digest.blocks.length
        ? disclosure(ctx, 'today-q1', 'Xem chi tiết', q1Detail, q1Meta)
        : blocksBody);

    /* --- Câu 2: tạo ra kết quả gì --- */
    var outcomeRows = '';
    if (digest.outcomes.commits.length) {
      outcomeRows += '<table class="table"><thead><tr><th>Giờ</th><th>Commit</th><th>Dự án</th></tr></thead><tbody>' +
        digest.outcomes.commits.map(function (c) {
          return '<tr><td class="mono">' + fmtTime(c.ts) + '</td><td>' + esc(c.title) + '<div class="li-note">' + esc(c.detail) + '</div></td><td>' + esc(c.project || '—') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    var filesTop = digest.outcomes.files.slice(0, 10);
    if (filesTop.length) {
      outcomeRows += '<div class="mt"><div class="card-sub">Tệp vừa thay đổi</div>' + listItems(filesTop, function (f) {
        return '<span class="tl-time">' + fmtTime(f.ts) + '</span> <span class="mono li-title">' + esc(f.title) + '</span> ' +
          '<span class="li-note">' + esc(f.project || '') + (f.inferred ? ' · <i>suy ra</i>' : '') + '</span>';
      }) + '</div>';
    }
    if (!outcomeRows) outcomeRows = '<div class="empty">Không thấy kết quả nào được ghi lại trong ngày này.</div>';

    /* "Việc còn dở" là một cảnh báo, nên nó nằm trong thẻ Cảnh báo. Ở đây chỉ
       để lại một dòng trỏ sang, để không có hai chỗ cùng kể một chuyện rồi
       lệch nhau. */
    var uncommittedNotice = digest.outcomes.uncommitted.length
      ? '<div class="block-card" style="border-color:var(--gold)">' +
        '<b style="color:var(--gold)">Việc còn dở</b> — ' + digest.outcomes.uncommitted.length +
        ' mục chưa ghi lại · <a href="#" data-action="open-warnings">xem cảnh báo</a></div>'
      : '';

    var q2HasDetail = digest.outcomes.commits.length || digest.outcomes.files.length;
    var q2Meta = digest.outcomes.commits.length + ' commit · ' + digest.outcomes.files.length + ' tệp';

    var questionTwo = question('二', '2', 'Huynh đã tạo ra kết quả gì',
      'Đối chiếu hoạt động với thay đổi thật trong mã nguồn và dự án.',
      uncommittedNotice +
      (q2HasDetail ? disclosure(ctx, 'today-q2', 'Xem chi tiết', outcomeRows, q2Meta) : outcomeRows));

    /* --- Câu 3: học gì, mai làm gì ---
       Phần hành động được (gợi ý cho ngày mai) là thứ đáng đọc nhất nên để
       luôn hiện; hai mục chẩn đoán thì gấp lại. */
    var q3Detail = '';
    if (digest.frictions.length) {
      q3Detail += '<div class="card-sub">Điểm vướng</div>' + listItems(digest.frictions, function (f) {
        return '<span class="badge k-code">' + esc(f.type) + '</span> ' + esc(f.note) +
          (f.project ? ' <span class="li-note">· ' + esc(f.project) + '</span>' : '');
      });
    }
    if (digest.openQuestions.length) {
      q3Detail += '<div class="card-sub mt">Việc còn bỏ ngỏ</div>' + listItems(digest.openQuestions, function (q) {
        return '<span class="tl-time">' + fmtTime(q.at) + '</span> ' + esc(q.text) +
          (q.project ? ' <span class="li-note">· ' + esc(q.project) + '</span>' : '');
      });
    }

    var body3 = '<div class="card-sub">Gợi ý cho ngày mai</div>' +
      listItems(digest.nextSteps.slice(0, 2), function (s) {
        return '<b class="mono">' + esc(s.project || '—') + '</b> · ' + esc(s.text);
      });
    if (q3Detail) {
      body3 += '<div class="mt">' + disclosure(ctx, 'today-q3', 'Xem chi tiết', q3Detail,
        digest.frictions.length + ' điểm vướng · ' + digest.openQuestions.length + ' câu bỏ ngỏ') + '</div>';
    }

    var questionThree = question('三', '3', 'Học được gì, mai làm gì',
      'Rút từ bằng chứng ở hai mục trên, không phải từ cảm giác.',
      body3);

    /* --- Cột phải --- */
    var sourceSegments = Object.keys(t).length ? [] : [];
    var dist = ctx.data.distribution || [];
    var donutHtml = Charts.donut(dist, { center: fmtNumber(t.events), centerLabel: 'sự kiện', track: colors.line, ink: colors.ink, muted: colors.muted });

    var momentum = digest.momentum;
    var spark = Charts.sparkline(momentum.series.map(function (s) { return s.minutes; }), { color: colors.cinabar });

    var docsItems = digest.learning.docs.slice(0, 7).map(function (d) {
      return { label: d.host + ' · ' + d.category, value: d.visits, text: d.visits + ' lượt', color: d.category === 'học' ? colors.jade : (d.category === 'giải trí' ? colors.gold : colors.muted) };
    });

    /* Bốn ô số liệu là phần đáng nhìn nhất nên luôn hiện; biểu đồ và danh
       sách tra cứu gấp lại — chúng hữu ích khi cần soi, nhưng để thường trực
       thì cột phải dài gấp ba lần cột trả lời ba câu hỏi. */
    var sideDetail =
      '<div class="mt">' + donutHtml + '</div>' + legend(dist) +
      '<div class="mt card-sub">Nhịp 7 ngày (phút/ngày, trung bình ' + momentum.averageMinutes + ')</div>' + spark +
      (docsItems.length ? '<div class="mt card-sub">Nguồn đã tra cứu</div>' + Charts.hbars(docsItems) : '') +
      (t.internal ? '<p class="muted tiny mt">Ngoài ra có ' + t.internal + ' sự kiện nội bộ (phiên kiểm duyệt của hệ thống) đã được tách riêng, không tính vào hoạt động của huynh.</p>' : '');

    var sideBody =
      '<div class="grid cols-2">' +
      stat('Thời gian', fmtMinutes(digest.minutes), digest.window ? fmtTime(digest.window.start) + ' – ' + fmtTime(digest.window.end) : '', '') +
      stat('Chuỗi ngày', momentum.streakDays + ' ngày', 'liên tục có làm việc', 'good') +
      stat('Lượt Codex', fmtNumber(t.aiTurns), t.aiSessions + ' phiên · ' + fmtTokens(t.tokens) + ' token', '') +
      stat('Tệp đã sửa', fmtNumber(t.files), t.commits + ' commit', t.commits ? 'good' : 'warn') +
      '</div>' +
      disclosure(ctx, 'today-side', 'Xem chi tiết', sideDetail, 'biểu đồ · nguồn tra cứu');

    /* --- Khung nhật ký --- */
    var journalBody;
    if (journal && journal.text) {
      journalBody = '<div class="journal-text">' + esc(journal.text) + '</div>' +
        citationHtml(journal) +
        '<div class="spread mt"><span class="muted tiny">' + esc(journal.source || '') + (journal.model ? ' · ' + esc(journal.model) : '') +
        ' · cập nhật ' + fmtTime(journal.updatedAt) + '</span>' +
        '<span class="row-actions"><button class="btn btn-sm" data-action="journal-edit">Sửa</button>' +
        '<button class="btn btn-sm" data-action="journal-prompt">Xem gói bằng chứng</button></span></div>';
    } else {
      journalBody = '<p class="card-sub">Chưa có nhật ký cho ngày này. DevTrace có thể dựng sẵn một gói bằng chứng rồi để AI viết thành lời — hoặc huynh tự dán kết quả vào.</p>' +
        '<div class="row-actions">' +
        '<button class="btn btn-primary btn-sm" data-action="ai-run">Gọi AI tổng hợp</button>' +
        '<button class="btn btn-sm" data-action="journal-prompt">Xem và sao chép lời nhắc</button>' +
        '<button class="btn btn-sm" data-action="journal-edit">Tự viết</button>' +
        '</div>';
    }

    var journalCard = card('Nhật ký có ngữ cảnh', '記', journalBody);

    /* Bảng số liệu ở trên trông y hệt nhau dù "hôm nay không có commit" hay
       "hôm nay không đọc được git". Thẻ cảnh báo nói thẳng chỗ trống, để
       không ai đọc con số 0 thành "hôm đó không làm gì". */
    /* Ba khối kế hoạch đứng TRÊN ba câu hỏi, và đó là chủ ý: câu hỏi "hôm nay
       định làm gì" phải trả lời được trước khi đọc bất cứ con số nào về ngày
       hôm qua. Kế hoạch không có dữ liệu thì các khối này tự thuật lại việc
       chúng chưa có gì — không im lặng biến mất. */
    /* Hộp thư đến đứng TRÊN bảng tuần. Trên màn này chỉ nó là thứ đang
       ĐỢI huynh; mọi khối còn lại là thông tin để đọc. Đặt nó dưới cùng thì
       mục ghi nhanh ba hôm trước nằm khuất dưới ba cuộn giấy. */
    return inboxHtml(ctx) + timetableHtml(ctx) + sprintBandHtml(ctx) + boardHtml(ctx) +
      '<div class="grid hero">' +
      '<div>' + questionOne + questionTwo + questionThree + '</div>' +
      '<div>' + card('Số liệu trong ngày', '數', sideBody) + warningsHtml(ctx) + journalCard + mailCard(ctx) +
      card('Lịch sử thu thập', '源',
        disclosure(ctx, 'today-sources', 'Xem chi tiết', sourceStatusTable(status),
          status && status.sources ? status.sources.length + ' nguồn' : '')) +
      '</div>' +
      '</div>';
  }

  function sourceStatusTable(status) {
    if (!status || !status.sources) return '<div class="empty">chưa có thông tin</div>';
    return '<div>' + status.sources.map(function (s) {
      var health = s.health || {};
      var state = !s.enabled ? '<span class="muted">đang tắt</span>'
        : health.ok === false ? '<span class="bad">lỗi</span>'
          : health.lastRun ? '<span class="ok">' + fmtNumber(health.events || 0) + ' sự kiện · ' + (health.ms || 0) + 'ms</span>'
            : '<span class="muted">chưa chạy</span>';
      return '<div class="source-row"><span class="name">' + esc(s.label) + '</span>' +
        '<span class="meta">' + esc(s.evidence) + '</span>' + state + '</div>';
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------------
     Màn hình 2: Dòng thời gian — bằng chứng thô, lọc được.
     ------------------------------------------------------------------ */

  function timelineView(ctx) {
    var events = ctx.data.events || [];
    var filters = ctx.state.filters || {};
    var sources = Object.keys(global.DEVTRACE_SOURCES || {});

    var chips = '<button class="btn btn-sm' + (!filters.source ? ' btn-primary' : '') + '" data-action="filter-source" data-value="">Tất cả</button>' +
      sources.map(function (name) {
        var info = global.DEVTRACE_SOURCES[name];
        return '<button class="btn btn-sm' + (filters.source === name ? ' btn-primary' : '') + '" data-action="filter-source" data-value="' + esc(name) + '">' + esc(info.label) + '</button>';
      }).join('');

    var searchBox = '<div class="field" style="margin:0"><input type="search" data-role="event-search" placeholder="Tìm trong tiêu đề và chi tiết…" value="' + esc(filters.q || '') + '"></div>';

    var groups = {};
    events.forEach(function (event) {
      var hour = new Date(event.ts).getHours();
      if (!groups[hour]) groups[hour] = [];
      groups[hour].push(event);
    });
    var hours = Object.keys(groups).map(Number).sort(function (a, b) { return b - a; });

    var body = hours.length ? hours.map(function (hour) {
      var items = groups[hour];
      return '<div class="card-sub mt">' + ('0' + hour).slice(-2) + ':00 — ' + items.length + ' sự kiện</div>' +
        '<ul class="timeline">' + items.map(function (event) {
          var meta = event.meta || {};
          var extra = '';
          if (event.source === 'codex' && meta.model) extra = meta.model;
          if (event.source === 'browser' && meta.host) extra = meta.host + ' · ' + (meta.category || '');
          if (event.source === 'git' && meta.sha) extra = meta.sha + ' · ' + (meta.branch || '');
          if (event.source === 'files' && meta.path) extra = meta.path;
          if (event.durationMs) extra = fmtMinutes(event.durationMs / 60000) + (extra ? ' · ' + extra : '');
          return '<li class="tl-item" data-source="' + esc(event.source) + '">' +
            '<span class="tl-time">' + fmtTime(event.ts) + '</span>' +
            '<span class="tl-title">' + esc(event.title) + '</span>' +
            '<div class="tl-detail">' + sourceBadge(event.source) + ' ' + esc(event.detail || '') +
            (extra ? ' <span class="muted">· ' + esc(String(extra).slice(0, 120)) + '</span>' : '') +
            (event.inferred ? ' <span class="badge inferred">suy ra</span>' : '') + '</div></li>';
        }).join('') + '</ul>';
    }).join('') : '<div class="empty">Không có sự kiện nào khớp bộ lọc.</div>';

    var headExtra = '<span class="muted small">' + fmtNumber(events.length) + ' sự kiện</span>';
    return card('Dòng thời gian bằng chứng', '時',
      '<div class="spread mb">' + '<div class="row-actions">' + chips + '</div>' + searchBox + '</div>' + body, headExtra);
  }

  /* ------------------------------------------------------------------
     Màn hình 3: Dự án — bảng bằng chứng gộp theo khoảng ngày.
     ------------------------------------------------------------------ */

  function projectsView(ctx) {
    var data = ctx.data;
    var colors = ctx.colors;
    var rangeChips = [7, 14, 30, 90].map(function (days) {
      return '<button class="btn btn-sm' + (ctx.state.range === days ? ' btn-primary' : '') + '" data-action="set-range" data-value="' + days + '">' + days + ' ngày</button>';
    }).join('');

    /* Việc đang mở của mỗi dự án, gom theo NHÃN dự án — cùng nhãn mà bằng
       chứng đang dùng, vì cả hai đều đi qua R.projectLabel. Nên đổi tên dự án
       là việc cũ lẫn việc mới đổi theo cùng một lúc, không lệch nhau. */
    var openByProject = {};
    var plans = ctx.data.plans;
    if (plans && plans.tasks) {
      plans.tasks.forEach(function (t) {
        if (t.status !== 'open') return;
        var key = t.projectName || '(chưa gắn dự án)';
        openByProject[key] = (openByProject[key] || 0) + 1;
      });
    }

    var head = '<div class="spread mb"><div class="row-actions">' + rangeChips + '</div>' +
      '<button class="btn btn-sm" data-action="project-form">Thêm dự án</button></div>';

    if (!data.projects.length) {
      return card('Bảng bằng chứng theo dự án', '案',
        '<p class="card-sub">Mỗi thư mục huynh chọn là một dự án, đặt tên tuỳ ý hoặc lấy tên theo thư mục. ' +
        'Đổi tên chỉ đổi cái nhãn — bằng chứng cũ hiện ngay dưới tên mới, và <b>không một sự kiện nào bị viết lại</b>.</p>' +
        head +
        '<div class="empty">Chưa gom được bằng chứng nào trong khoảng này.</div>') +
        repoHealthHtml(ctx);
    }

    var body = data.projects.map(function (p) {
      var metrics = [
        { label: 'Phút', value: p.minutes, text: p.minutes + ' phút', color: colors.indigo },
        { label: 'Lượt AI', value: p.aiTurns, text: p.aiTurns + ' lượt', color: colors.plum },
        { label: 'Tệp sửa', value: p.files, text: p.files + ' tệp', color: colors.cinabar },
        { label: 'Commit', value: p.commits, text: p.commits + ' commit', color: colors.jade },
        { label: 'Tra cứu', value: p.docVisits, text: p.docVisits + ' lượt', color: colors.gold }
      ];
      var highlights = (p.highlights || []).map(function (h) {
        return '<li><span class="tl-time">' + fmtDate(h.day) + '</span> ' + esc(h.title) + ' <span class="li-note">' + esc(h.detail || '') + '</span></li>';
      }).join('');
      var open = openByProject[p.project];
      return '<div class="block-card">' +
        '<div class="block-head"><span class="block-project">' + esc(p.project) + '</span>' +
        '<span class="block-mins">' + fmtNumber(p.events) + ' sự kiện trong ' + p.activeDays + ' ngày' +
        (open ? ' · <b>' + open + '</b> việc đang mở' : '') + '</span></div>' +
        '<div class="grid cols-4 mt">' + metrics.slice(0, 4).map(function (m) { return stat(m.label, fmtNumber(m.value), '', ''); }).join('') + '</div>' +
        (highlights ? '<ul class="list compact mt">' + highlights + '</ul>' : '<div class="empty mt">chưa có hoạt động đáng kể</div>') +
        '</div>';
    }).join('');

    return card('Bảng bằng chứng theo dự án', '案',
      '<p class="card-sub">Mỗi thư mục huynh chọn là một dự án. Đổi tên chỉ đổi cái nhãn — bằng chứng cũ hiện ngay ' +
      'dưới tên mới, và không một sự kiện nào bị viết lại. Xoá dự án cũng không xoá bằng chứng.</p>' +
      head +
      '<div class="spread mb"><span class="muted small">' + data.days + ' ngày · ' + fmtNumber(data.totalEvents) + ' sự kiện</span></div>' + body) +
      repoHealthHtml(ctx);
  }

  /* ------------------------------------------------------------------
     Màn hình 4: Nguồn — sức khoẻ từng nguồn dữ liệu.
     ------------------------------------------------------------------ */

  function sourcesView(ctx) {
    var status = ctx.data.status;
    var config = ctx.data.config;

    var rows = status.sources.map(function (s) {
      var settings = (config.sources || {})[s.name] || {};
      var health = s.health || {};
      var detail = '';
      if (s.name === 'codex') detail = 'Đọc ' + settings.root;
      if (s.name === 'git') detail = (settings.repos || []).length + ' kho: ' + (settings.repos || []).map(function (r) { return '<code>' + esc(r) + '</code>'; }).join(', ');
      if (s.name === 'github') detail = settings.user
        ? 'tài khoản <code>' + esc(settings.user) + '</code> · khoá đọc từ biến môi trường <code>' + esc(settings.tokenEnv || 'DEVTRACE_GITHUB_TOKEN') + '</code>'
        : 'chưa khai <code>sources.github.user</code> — chưa biết đọc hoạt động của ai';
      if (s.name === 'files') detail = (settings.dirs || []).length + ' thư mục: ' + (settings.dirs || []).map(function (d) { return '<code>' + esc(d) + '</code>'; }).join(', ');
      if (s.name === 'browser') detail = (settings.browsers || []).join(', ') + ' · giữ ' + (settings.keepDays || 30) + ' ngày';
      if (s.name === 'shell') detail = 'lịch sử PSReadLine (chỉ ghi lệnh mới từ lúc cài)';
      if (s.name === 'vscode') detail = 'workspaceStorage của VS Code';
      if (s.name === 'manual') detail = 'ghi chú huynh tự thêm';

      var notes = (health.notes || []).map(function (n) { return esc(n); }).join('<br>');
      var state = !s.enabled ? '<span class="badge">đang tắt</span>'
        : health.ok === false ? '<span class="badge" style="color:var(--cinabar)">lỗi</span>'
          : '<span class="badge" style="color:var(--jade)">hoạt động</span>';

      return '<div class="block-card">' +
        '<div class="spread"><div class="block-head">' + sourceBadge(s.name) +
        '<span class="block-project">' + esc(s.label) + '</span>' + state + '</div>' +
        '<div class="row-actions">' +
        '<button class="btn btn-sm" data-action="collect-one" data-value="' + esc(s.name) + '">Thu thập</button>' +
        '<button class="btn btn-sm" data-action="toggle-source" data-value="' + esc(s.name) + '">' + (s.enabled ? 'Tắt' : 'Bật') + '</button>' +
        '</div></div>' +
        '<p class="card-sub" style="margin:8px 0 4px">' + detail + '</p>' +
        '<p class="tiny muted">' + (s.evidence ? 'Bằng chứng: ' + esc(s.evidence) + '. ' : '') +
        (health.lastRun ? 'Lần cuối ' + fmtTime(health.lastRun) + ' · ' + fmtNumber(health.events || 0) + ' sự kiện · ' + (health.ms || 0) + 'ms' : 'chưa chạy lần nào') + '</p>' +
        (notes ? '<p class="tiny muted">' + notes + '</p>' : '') +
        (health.error ? '<p class="tiny" style="color:var(--cinabar)">' + esc(health.error) + '</p>' : '') +
        '</div>';
    }).join('');

    return card('Nguồn dữ liệu', '源',
      '<p class="card-sub">DevTrace không đoán. Mỗi nguồn chỉ đóng góp đúng loại bằng chứng nó có, và nói rõ khi không có dữ liệu.</p>' +
      rows +
      '<div class="spread mt"><span class="muted small">' + status.days + ' ngày đã lưu' + (status.latest ? ' · mới nhất ' + fmtDate(status.latest) : '') + '</span>' +
      '<div class="row-actions"><button class="btn btn-sm" data-action="collect">Thu thập tất cả</button>' +
      '<button class="btn btn-sm" data-action="collect-rebuild">Thu thập lại từ đầu</button></div></div>');
  }

  /* ------------------------------------------------------------------
     Màn hình 5: Lịch sử — nhịp làm việc dài hạn.
     ------------------------------------------------------------------ */

  function historyView(ctx) {
    var days = ctx.data.days || [];
    var colors = ctx.colors;
    if (!days.length) return card('Lịch sử hoạt động', '史', '<div class="empty">Chưa có ngày nào được lưu.</div>');

    var ordered = days.slice().reverse();
    var heat = Charts.heatmap(ordered.map(function (d) {
      return { label: fmtDate(d.day) + ' · ' + fmtNumber(d.events) + ' sự kiện', value: d.events };
    }), { color: colors.cinabar, perRow: 14 });

    var totals = ordered.reduce(function (acc, d) {
      acc.events += d.events; acc.minutes += d.minutes; return acc;
    }, { events: 0, minutes: 0 });

    var rows = ordered.slice(0, 60).map(function (d) {
      var chips = Object.keys(d.counts).sort().map(function (source) {
        return sourceBadge(source) + '<span class="muted tiny">×' + d.counts[source] + '</span>';
      }).join(' ');
      return '<tr><td class="nowrap"><a href="#/today" data-action="open-day" data-value="' + esc(d.day) + '">' + fmtDate(d.day) + '</a></td>' +
        '<td class="num">' + fmtNumber(d.events) + '</td>' +
        '<td class="num">' + fmtMinutes(d.minutes) + '</td>' +
        '<td>' + chips + '</td>' +
        '<td class="muted">' + esc((d.projects || []).join(', ')) + '</td></tr>';
    }).join('');

    return card('Nhịp làm việc', '史',
      '<p class="card-sub">' + ordered.length + ' ngày · ' + fmtNumber(totals.events) + ' sự kiện · ' + fmtMinutes(totals.minutes) + ' có hoạt động. Càng đậm là càng nhiều dấu vết.</p>' +
      '<div class="chart-wrap">' + heat + '</div>') +
      card('Từng ngày', '日',
        '<div class="scroll-y"><table class="table"><thead><tr><th>Ngày</th><th class="num">Sự kiện</th><th class="num">Thời gian</th><th>Nguồn</th><th>Dự án</th></tr></thead><tbody>' +
        rows + '</tbody></table></div>');
  }

  /* ------------------------------------------------------------------
     Màn hình 6: Cài đặt.
     ------------------------------------------------------------------ */

  function settingsView(ctx) {
    var config = ctx.data.config;
    var sources = config.sources || {};
    var ai = config.ai || {};

    function area(label, path, values, hint) {
      return '<div class="field"><label>' + esc(label) + '</label>' +
        '<textarea data-config="' + esc(path) + '" spellcheck="false">' + esc((values || []).join('\n')) + '</textarea>' +
        '<span class="hint">' + esc(hint) + '</span></div>';
    }
    function numberField(label, path, value, hint) {
      return '<div class="field"><label>' + esc(label) + '</label>' +
        '<input type="number" data-config="' + esc(path) + '" value="' + num(value) + '">' +
        (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>';
    }
    function textField(label, path, value, hint, placeholder) {
      return '<div class="field"><label>' + esc(label) + '</label>' +
        '<input data-config="' + esc(path) + '" value="' + esc(value || '') + '"' +
        (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + '>' +
        (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>';
    }
    function flag(label, path, on, hint) {
      return '<label class="badge' + (hint ? '' : '') + '" style="cursor:pointer">' +
        '<input type="checkbox" data-config-flag="' + esc(path) + '" data-autosave' + (on ? ' checked' : '') + '> ' + esc(label) + '</label>' +
        (hint ? '<p class="tiny muted mt mb">' + hint + '</p>' : '');
    }

    /* Bảng màu không phải khoá cấu hình — máy chủ không cần biết. Nó nằm
       ngay đây, cạnh những thứ huynh nhìn thấy trước tiên, chứ không lẫn
       xuống tận thẻ "Dữ liệu" như trước. */
    var THEMES = [['trang', 'Trắng — nền sáng, mặc định'], ['muc', 'Mực đêm — nền tối'], ['giay', 'Giấy dó — nền ngà']];
    var general =
      '<div class="grid cols-2">' +
      '<div class="field"><label>Bảng màu</label><select data-theme-pick data-autosave>' +
      THEMES.map(function (t) {
        return '<option value="' + t[0] + '"' + (ctx.state.theme === t[0] ? ' selected' : '') + '>' + esc(t[1]) + '</option>';
      }).join('') + '</select><span class="hint">Đổi là thấy ngay, không cần bấm Lưu.</span></div>' +
      '<div class="field"><label>Giờ bắt đầu một ngày</label><input type="number" min="0" max="12" data-config="dayStartHour" value="' + num(config.dayStartHour) + '">' +
      '<span class="hint">Đặt 4 nghĩa là làm việc tới 3h sáng vẫn tính vào ngày hôm trước.</span></div>' +
      '</div>' +
      '<div class="field"><label>Thư mục dữ liệu</label><input readonly value="' + esc(config.dataDir || '') + '">' +
      '<span class="hint">Bằng chứng thô nằm ở đây, huynh có thể mở bằng trình soạn thảo. Đổi chỗ này phải sửa tay trong devtrace.config.json.</span></div>';

    var toggles = '<div class="mb">' + ctx.data.status.sources.map(function (s) {
      var settings = sources[s.name] || {};
      return '<label class="badge" style="cursor:pointer"><input type="checkbox" data-config-toggle="' + esc(s.name) + '" data-autosave' +
        (settings.enabled !== false ? ' checked' : '') + '> ' + esc(s.label) + '</label>';
    }).join(' ') + '</div>';

    var sourceFields =
      area('Kho mã Git', 'sources.git.repos', sources.git && sources.git.repos,
        'Mỗi dòng một đường dẫn. Đây là nguồn bằng chứng "đã tạo ra kết quả gì" mạnh nhất. Dùng npm run repos để máy tự dò.') +
      area('Thư mục theo dõi tệp', 'sources.files.dirs', sources.files && sources.files.dirs,
        'Mỗi dòng một thư mục. DevTrace so sánh ảnh chụp giữa hai lần thu thập để biết tệp nào bị sửa.') +
      disclosure(ctx, 'settings-advanced', 'Nâng cao', advancedFields(sources, config), 'đường dẫn, độ sâu, bộ lọc');

    /* Chỉ mở những khoá sửa được mà không làm hỏng bộ khởi động. `desktop.*`
       cố ý KHÔNG có mặt: sửa cổng hay hồ sơ trình duyệt ở đây thì lần sau
       mở ứng dụng sẽ không tìm thấy máy chủ. `projects` cũng không: đó là
       dữ liệu máy tự suy ra, sửa tay là tự bắn vào chân. */
    function advancedFields(sources, config) {
      var codex = sources.codex || {};
      var files = sources.files || {};
      var browser = sources.browser || {};
      var shell = sources.shell || {};
      var auto = (sources.git && sources.git.autoDiscover) || {};
      var git = sources.git || {};
      var retention = config.retention || {};
      return '<div class="grid cols-2">' +
        textField('Thư mục phiên Codex', 'sources.codex.root', codex.root, 'Mặc định ~/.codex/sessions.') +
        numberField('Số tệp Codex đọc tối đa', 'sources.codex.maxFiles', codex.maxFiles) +
        numberField('Độ sâu dò tệp', 'sources.files.maxDepth', files.maxDepth) +
        numberField('Số lệnh terminal giữ lại', 'sources.shell.maxCommands', shell.maxCommands) +
        numberField('Số ngày giữ lịch sử trình duyệt', 'sources.browser.keepDays', browser.keepDays) +
        numberField('Số nhật ký AI giữ lại', 'retention.keepJournals', retention.keepJournals === false ? 0 : 1,
          'Để 1 là giữ nhật ký khi dọn bằng chứng cũ. Đặt 0 là xoá luôn — chỉ có tác dụng khi bật tự xoá ở thẻ trên.') +
        '</div>' +
        flag('Tự dò kho git trong các thư mục dưới đây', 'sources.git.autoDiscover.enabled', auto.enabled) +
        area('Chỉ tính commit của những danh tính này', 'sources.git.authors', sources.git && sources.git.authors,
          'Mỗi dòng một tên hoặc thư điện tử. Để trống thì lấy theo git config --global. Phần lớn kho trên máy là bản sao của người khác, nên không lọc thì bảng kết quả đầy việc của họ.') +
        '<div class="mt">' + area('Thư mục gốc để dò kho git', 'sources.git.autoDiscover.roots', auto.roots,
          'Máy sẽ tự tìm kho git trong các thư mục này, thay vì huynh phải liệt kê từng kho.') + '</div>' +
        '<div class="grid cols-2">' +
        numberField('Độ sâu dò', 'sources.git.autoDiscover.maxDepth', auto.maxDepth) +
        numberField('Số kho tối đa', 'sources.git.autoDiscover.maxRepos', auto.maxRepos) +
        numberField('Số kho quét sức khoẻ tối đa', 'sources.git.healthMaxRepos', git.healthMaxRepos,
          'Sức khoẻ kho tốn khoảng sáu lệnh git mỗi kho. Quét quá số này thì phần còn lại bị bỏ qua, và DevTrace nói rõ đã quét bao nhiêu trên tổng bao nhiêu.') +
        '</div>' +
        flag('Quét nội dung tệp để tìm bí mật', 'sources.git.secretScan', git.secretScan,
          'Rất chậm, và báo nhầm trên tệp thử. Kết quả luôn được ghi là <b>dấu hiệu</b>, không phải kết luận — ' +
          'DevTrace chỉ nêu tên tệp, số dòng và loại quy tắc, tuyệt đối không in giá trị tìm được ra.') +
        area('Bỏ qua khi dò tệp', 'sources.files.ignore', files.ignore,
          'Mỗi dòng một biểu thức chính quy. Đường dẫn khớp thì không tính là tệp bị sửa.');
    }

    /* Đợt làm việc (sprint). Độ dài tính bằng NGÀY chứ không phải tuần: đợt
       7 ngày là chuyện có thật, mà 7 ngày thì không diễn tả nổi bằng số tuần. */
    var sprint = config.sprint || {};
    var planCard = card('Kế hoạch', '計',
      '<div class="grid cols-2">' +
      numberField('Độ dài một đợt làm việc', 'sprint.lengthDays', sprint.lengthDays,
        'Tính bằng ngày. Mặc định 14. Đổi ở đây chỉ ảnh hưởng tới đợt mở SAU — đợt đang chạy giữ nguyên ngày kết thúc đã chốt.') +
      '</div>' +
      '<p class="tiny muted">Thời khoá biểu, bốn tầm nhìn nhiệm vụ và mục tiêu dài hạn nằm ở màn <b>Hôm nay</b>, ' +
      'không phải ở đây — chúng là việc huynh sửa hằng ngày, còn Cài đặt là chỗ sửa một lần rồi thôi.</p>');

    /* Hộp thư. Đây là chỗ đầu tiên DevTrace cần mật khẩu của người khác, và
       dữ liệu nó đọc là thư của NGƯỜI KHÁC viết. Ba điều được giữ chặt, và
       cả ba đều nói thẳng ra ngay trên giao diện chứ không chỉ trong mã:
       mật khẩu chỉ đọc từ biến môi trường; cảnh báo về thư chỉ có con số và
       số ngày; ảnh chụp hộp thư không nằm trong bản xuất dữ liệu. */
    var mail = config.mail || {};
    var mailCard = card('Hộp thư', '信',
      flag('Đọc hộp thư', 'mail.enabled', mail.enabled) +
      '<p class="tiny muted mt mb">Thư là chữ của <b>người khác viết</b>, và đây là ranh giới chịu lực của cả phần này: ' +
      'chữ huynh tự viết (nhiệm vụ, tên buổi, mục tiêu) thì đi cùng gói bằng chứng tới AI nếu huynh bật AI; ' +
      'còn tiêu đề thư, địa chỉ người gửi và nội dung thư <b>không đi đâu cả</b>. Cảnh báo về thư chỉ là con số và số ngày, ' +
      'ví dụ “5 thư chưa trả lời, cũ nhất 3 ngày”.</p>' +
      '<div class="grid cols-2">' +
      textField('Máy chủ IMAP', 'mail.host', mail.host,
        'Chỉ hỗ trợ TLS ngầm ở cổng 993. Máy chủ chỉ cho STARTTLS thì DevTrace không kết nối được, và sẽ nói thẳng như vậy.',
        'imap.gmail.com') +
      numberField('Cổng', 'mail.port', mail.port, 'Mặc định 993.') +
      textField('Tài khoản', 'mail.user', mail.user, null, 'ten@example.com') +
      textField('Tên biến môi trường chứa mật khẩu', 'mail.passwordEnv', mail.passwordEnv,
        'DevTrace KHÔNG lưu mật khẩu, chỉ đọc từ biến môi trường có tên này. Với Gmail và Outlook phải là MẬT KHẨU ỨNG DỤNG, không phải mật khẩu đăng nhập.') +
      textField('Thư mục nhận', 'mail.folder', mail.folder, 'Mặc định INBOX.') +
      textField('Thư mục đã gửi', 'mail.sentFolder', mail.sentFolder,
        'Dùng để biết thư nào đã được trả lời. Tên thư mục không phải chữ ASCII thì chưa hỗ trợ.') +
      numberField('Quá bao nhiêu giờ thì tính là tồn', 'mail.unansweredHours', mail.unansweredHours, 'Mặc định 24.') +
      numberField('Số thư đọc tối đa', 'mail.maxMessages', mail.maxMessages) +
      '</div>' +
      '<p class="tiny muted mt">Cách đếm “chưa trả lời” là <b>ước lượng</b>, và nó sai cả hai chiều: ' +
      'trả lời từ máy khác thì vẫn bị tính là chưa trả lời, còn thư quảng cáo thì nằm mãi trong danh sách. ' +
      'Giao diện luôn ghi rõ chữ “ước lượng”.</p>');

    /* Dự án. Danh sách ở đây là `declaredProjects` — Ý MUỐN của huynh, không
       phải `config.projects` (kết quả đã tính). Hai thứ tách nhau có lý do cơ
       học: bộ dò kho tự thêm một mục thì nó không được lẫn vào danh sách
       huynh tự khai, kẻo lần lưu sau ghi luôn cả những mục huynh chưa từng nhập.

       Chú ý: KHÔNG dùng `data-config` cho mấy ô này. Tên khoá `declaredProjects`
       phải đi qua `data-action` chứ không qua `data-config` — phép kiểm trong
       bộ kiểm thử chặn hẳn chuỗi `data-config="projects` vì `projects` là dữ
       liệu máy tự suy ra, sửa tay là tự bắn vào chân. */
    var declared = config.declaredProjects || [];
    var projectRows = declared.length
      ? '<ul class="list">' + declared.map(function (p) {
        return '<li>' +
          '<b>' + esc(p.name) + '</b>' +
          ' <span class="badge">' + (p.kind === 'git' ? 'kho git' : 'thư mục') + '</span>' +
          '<div class="li-note mono tiny">' + esc(p.path) + '</div>' +
          '<div class="row-actions mt">' +
          '<button class="btn btn-sm" data-action="project-rename" data-value="' + esc(p.id) + '">Đổi tên</button>' +
          '<button class="btn btn-sm" data-action="project-scan" data-value="' + esc(p.id) + '">Nối vào nguồn</button>' +
          '<button class="btn btn-sm" data-action="project-delete" data-value="' + esc(p.id) + '">Xoá</button>' +
          '</div></li>';
      }).join('') + '</ul>'
      : '<div class="empty">Chưa khai dự án nào, nên DevTrace đang tự suy ra: mỗi kho git trong ' +
        '<span class="mono">sources.git.repos</span> và mỗi thư mục theo dõi là một dự án, lấy tên theo thư mục. ' +
        'Khai ở đây thì danh sách này thắng.</div>';

    var projectCard = card('Dự án', '案',
      '<p class="card-sub">Mỗi thư mục huynh chọn là một dự án, đặt tên tuỳ ý hoặc lấy tên theo thư mục. ' +
      'Đổi tên chỉ sửa <b>một trường</b> trong cấu hình: sự kiện lưu dự án dưới dạng đường dẫn, tên chỉ được ' +
      'đọc ra lúc hiển thị — nên bằng chứng cũ hiện ngay dưới tên mới mà không phải viết lại một dòng nào.</p>' +
      '<div class="row-actions mb"><button class="btn btn-sm btn-primary" data-action="project-form">Thêm dự án</button></div>' +
      projectRows +
      '<p class="tiny muted mt"><b>Xoá dự án không xoá bằng chứng.</b> Bỏ mục khỏi danh sách thì DevTrace thôi gom ' +
      'theo dự án đó, và bằng chứng cũ hiện dưới tên thư mục. Xoá hết thì nó quay lại tự suy ra từ kho git và ' +
      'thư mục theo dõi.</p>');

    var aiFields =
      '<div class="grid cols-2">' +
      '<div class="field"><label>Nhà cung cấp</label><select data-config="ai.provider" data-autosave>' +
      ['none', 'openai-compatible'].map(function (p) {
        return '<option value="' + p + '"' + (ai.provider === p ? ' selected' : '') + '>' + (p === 'none' ? 'Không dùng AI (chỉ dựng lời nhắc)' : 'OpenAI-compatible') + '</option>';
      }).join('') + '</select></div>' +
      textField('Model', 'ai.model', ai.model, null, 'ví dụ: gpt-4o-mini') +
      textField('Địa chỉ API', 'ai.baseUrl', ai.baseUrl, null, 'https://api.openai.com/v1') +
      textField('Tên biến môi trường chứa khoá', 'ai.apiKeyEnv', ai.apiKeyEnv || 'DEVTRACE_API_KEY',
        'DevTrace không lưu khoá vào tệp cấu hình, chỉ đọc từ biến môi trường.') +
      '</div>' +
      '<p class="tiny muted">Kể cả khi không bật AI, DevTrace vẫn hoạt động đầy đủ: nó dựng sẵn gói bằng chứng và lời nhắc để huynh dán vào bất kỳ trợ lý nào.</p>';

    /* Mấy công tắc bảo vệ dữ liệu. Đặt ngay dưới phần AI vì cả hai đều nói
       về cùng một câu hỏi: cái gì được phép rời khỏi máy này. */
    var privacy = config.privacy || {};
    var retention = config.retention || {};
    var guardFields =
      flag('Che bí mật trước khi dữ liệu rời khỏi máy', 'privacy.redactSecrets', privacy.redactSecrets !== false,
        'Lọc những khuôn mẫu bí mật đã biết (Bearer token, <span class="mono">sk-…</span>, ' +
        '<span class="mono">ghp_…</span>, <span class="mono">AKIA…</span>, <span class="mono">TOKEN=…</span>, mật khẩu nằm trong địa chỉ) ' +
        'khỏi gói bằng chứng gửi cho AI. Kho bằng chứng trên máy KHÔNG bị đụng tới — huynh luôn đọc được nguyên bản của chính mình. ' +
        'Đây là lưới an toàn theo khuôn mẫu, không phải bảo đảm: bí mật viết theo cách lạ thì vẫn lọt.') +
      flag('Tự xoá bằng chứng cũ hơn mốc dưới đây', 'retention.enabled', retention.enabled, null) +
      '<div class="field mt"><label>Số ngày giữ lại</label><input type="number" min="1" data-config="retention.days" value="' + num(retention.days || 365) + '">' +
      '<span class="hint">Mặc định tắt, và nên để tắt trừ khi huynh thật sự cần: DevTrace không tự xoá dữ liệu của huynh. ' +
      'Bật rồi thì cuối mỗi lần thu thập nó xoá sự kiện của những ngày cũ hơn mốc này và ghi rõ đã xoá ngày nào.</span></div>';

    var dataCard = card('Dữ liệu', '數',
      '<div class="row-actions">' +
      '<button class="btn" data-action="export-data">Xuất toàn bộ (.json)</button>' +
      '<button class="btn" data-action="export-redacted">Xuất bản đã che để chia sẻ</button>' +
      '<button class="btn" data-action="collect">Thu thập ngay</button>' +
      '<button class="btn" data-action="collect-rebuild">Thu thập lại từ đầu</button>' +
      '<button class="btn" style="border-color:var(--cinabar);color:var(--cinabar)" data-action="reset-data">Xoá hết dữ liệu đã thu</button>' +
      '</div>' +
      '<p class="tiny muted mt">“Xuất toàn bộ” là bản sao lưu nguyên vẹn, kể cả bí mật nếu chúng lọt vào dấu vết — gửi cho ai thì cân nhắc. ' +
      '“Xuất bản đã che” đi qua đúng bộ lọc ở mục trên, dùng khi cần đưa dấu vết cho người khác xem.</p>' +
      '<p class="tiny muted mt">“Thu thập lại từ đầu” xoá kho bằng chứng rồi dựng lại từ các nguồn. Với những nguồn không có mốc thời gian trong quá khứ (terminal), lịch sử cũ sẽ không thể phục hồi — đó là giới hạn thật, không phải lỗi.</p>');

    return card('Cài đặt chung', '設', general) +
      card('Nguồn dữ liệu', '源', toggles + sourceFields) +
      projectCard +
      planCard +
      mailCard +
      card('Suy luận bằng AI', '智', aiFields) +
      card('Rời khỏi máy', '密', guardFields) +
      dataCard +
      '<div class="settings-actions">' +
      '<span class="tiny muted">Hộp kiểm và ô chọn tự lưu ngay. Ô nhập chữ cần bấm Lưu.</span>' +
      '<button class="btn btn-primary" data-action="save-config">Lưu cài đặt</button>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */

  global.Views = {
    today: { title: 'Hôm nay', han: '今', subtitle: function (ctx) { return ctx.state.day ? fmtDate(ctx.state.day) + ' · ba câu hỏi của DevTrace' : ''; }, render: todayView, picker: true },
    timeline: { title: 'Dòng thời gian', han: '時', subtitle: function (ctx) { return 'Bằng chứng thô, chưa qua suy luận'; }, render: timelineView, picker: true },
    projects: { title: 'Dự án', han: '案', subtitle: function () { return 'Gộp bằng chứng theo dự án để thấy kết quả thật'; }, render: projectsView },
    history: { title: 'Lịch sử', han: '史', subtitle: function () { return 'Nhịp làm việc dài hạn'; }, render: historyView },
    sources: { title: 'Nguồn', han: '源', subtitle: function () { return 'Mỗi nguồn đóng góp một loại bằng chứng'; }, render: sourcesView },
    settings: { title: 'Cài đặt', han: '設', subtitle: function () { return 'Cấu hình nguồn, dữ liệu và AI'; }, render: settingsView }
  };

  /* Cảnh báo KHÔNG phải một màn hình, nên không nhét vào bảng Views: bộ kiểm
     thử đi qua mọi khoá của bảng đó và đòi mỗi khoá phải có hàm render. Đây
     là chỗ riêng cho app.js lấy số đếm và lấy HTML. */
  global.Warnings = { count: warnCount, html: warningsHtml };

  global.DT = {
    esc: esc, fmtTime: fmtTime, fmtDate: fmtDate, fmtMinutes: fmtMinutes,
    fmtNumber: fmtNumber, fmtTokens: fmtTokens, sourceBadge: sourceBadge, stat: stat
  };
})(window);
