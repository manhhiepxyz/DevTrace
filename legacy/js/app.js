/* =====================================================================
   app.js — Bộ điều khiển: định tuyến, sự kiện, modal, kéo thả, thông báo.
   ===================================================================== */
(function (global) {
  'use strict';

  var Store = global.Store;
  var Views = global.Views;
  var SEED = global.SEED;
  var U = global.Utils;
  var esc = global.Charts.esc;
  var Timer = global.Timer;

  var NAV = [
    { group: 'Tu thân', items: [
      { id: 'today', icon: '日', label: 'Hôm nay' },
      { id: 'journal', icon: '記', label: 'Nhật ký' },
      { id: 'rules', icon: '戒', label: 'Giới luật' },
      { id: 'roadmap', icon: '山', label: 'Lộ trình' },
      { id: 'recreate', icon: '匠', label: 'Tái tạo' }
    ] },
    { group: 'Tri thức', items: [
      { id: 'reading', icon: '書', label: 'Việc đọc' }
    ] },
    { group: 'Đồng đội', items: [
      { id: 'team', icon: '陣', label: 'Nhóm Scrum' }
    ] },
    { group: 'Tổng kết', items: [
      { id: 'stats', icon: '鑑', label: 'Đánh giá' },
      { id: 'settings', icon: '設', label: 'Cài đặt' }
    ] }
  ];

  var ROUTES = [];
  NAV.forEach(function (g) { g.items.forEach(function (it) { ROUTES.push(it); }); });

  var ui = { range: 30, navOpen: false };

  function currentId() {
    var h = String(global.location.hash || '').replace(/^#\/?/, '').trim();
    return ROUTES.some(function (r) { return r.id === h; }) ? h : 'today';
  }

  /* ------------------------------- Thông báo ------------------------------- */
  function toast(msg, type) {
    var root = document.getElementById('toastRoot');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.classList.add('out'); }, 2600);
    setTimeout(function () { el.remove(); }, 3200);
  }

  /* --------------------------------- Modal --------------------------------- */
  function openModal(title, contentHTML) {
    var root = document.getElementById('modalRoot');
    root.hidden = false;
    root.innerHTML =
      '<div class="modal-backdrop" data-action="close-modal"></div>' +
      '<div class="modal" role="dialog" aria-modal="true">' +
      '<header class="modal-head"><h3>' + esc(title) + '</h3>' +
      '<button class="icon-btn" data-action="close-modal" aria-label="Đóng">✕</button></header>' +
      '<div class="modal-body">' + contentHTML + '</div></div>';
    document.body.classList.add('modal-open');
    var first = root.querySelector('input:not([type=hidden]), select, textarea');
    if (first) first.focus();
    updateMinutesTotal();
  }

  function closeModal() {
    var root = document.getElementById('modalRoot');
    root.hidden = true;
    root.innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  function openSessionModal(session, prefill) {
    openModal(session ? 'Sửa buổi học' : 'Ghi buổi học mới', Views.sessionForm(Store.state, session, prefill));
  }

  /* ------------------------------ Định tuyến ------------------------------ */
  function renderNav(activeId) {
    document.getElementById('nav').innerHTML = NAV.map(function (g) {
      return '<div class="nav-group"><span class="nav-group-label">' + esc(g.group) + '</span>' +
        g.items.map(function (r) {
          return '<button class="nav-item' + (r.id === activeId ? ' active' : '') + '" data-route="#/' + r.id + '">' +
            '<span class="nav-icon">' + r.icon + '</span><span class="nav-label">' + esc(r.label) + '</span></button>';
        }).join('') + '</div>';
    }).join('');
  }

  function updateStreakChip() {
    var el = document.getElementById('streakChip');
    if (!el) return;
    var n = global.Metrics.streak(Store.state);
    el.innerHTML = '<b>' + n + '</b><span>ngày liên tiếp</span>';
    el.className = 'streak-chip' + (n > 0 ? ' on' : '');
  }

  function updateMinutesTotal() {
    var inputs = document.querySelectorAll('[data-minutes-input]');
    if (!inputs.length) return;
    var total = 0;
    inputs.forEach(function (i) { total += U.num(i.value, 0); });
    var out = document.querySelector('[data-role="minutes-total"]');
    if (out) out.textContent = total;
  }

  var lastRenderedId = null;

  function render() {
    var id = currentId();
    var view = Views[id] || Views.notFound;
    var routeChanged = id !== lastRenderedId;
    lastRenderedId = id;

    document.body.setAttribute('data-theme', Store.state.profile.theme || 'giay');
    document.getElementById('viewTitle').textContent = view.title;
    document.getElementById('viewSubtitle').textContent =
      typeof view.subtitle === 'function' ? view.subtitle(Store.state) : (view.subtitle || '');
    document.getElementById('view').innerHTML = view.render(Store.state, ui);

    renderNav(id);
    updateStreakChip();

    var tw = document.getElementById('timerWidget');
    if (tw) Timer.mount(tw);
    else Timer.syncTitle();

    document.body.classList.remove('nav-open');
    ui.navOpen = false;
    if (routeChanged) global.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* -------------------------------- Hành động -------------------------------- */
  function handleAction(action, el) {
    var Metrics = global.Metrics;

    if (action.indexOf('timer-') === 0) { Timer.handleAction(action, el); return; }

    switch (action) {
      case 'toggle-nav':
        ui.navOpen = !ui.navOpen;
        document.body.classList.toggle('nav-open', ui.navOpen);
        break;

      case 'new-session': openSessionModal(null); break;
      case 'edit-session': openSessionModal(Store.getSession(el.dataset.id)); break;
      case 'repeat-last': {
        var last = Store.lastSession();
        if (!last) { toast('Chưa có buổi nào để nhân bản.', 'error'); break; }
        openSessionModal(null, {
          date: U.today(), level: last.level, mode: last.mode,
          minutes: Object.assign({}, last.minutes), tags: last.tags
        });
        break;
      }
      case 'delete-session':
        if (global.confirm('Xoá buổi học này khỏi nhật ký?')) { Store.removeSession(el.dataset.id); toast('Đã xoá buổi học.'); }
        break;
      case 'close-modal': closeModal(); break;

      case 'focus-timer': {
        var tw = document.getElementById('timerWidget');
        if (!tw) { toast('Mở trang Hôm nay để dùng đồng hồ.'); break; }
        tw.scrollIntoView({ behavior: 'smooth', block: 'center' });
        var labelInput = tw.querySelector('[data-role="timer-label"]');
        if (labelInput) setTimeout(function () { labelInput.focus(); }, 380);
        break;
      }

      case 'quick-log': {
        var key = el.dataset.key;
        var min = U.num(el.dataset.minutes, 0);
        var block = SEED.schedule.filter(function (b) { return b.id === key; })[0];
        var current = Metrics.categoryTotals(Store.state, 1)[key] || 0;
        Store.logTodayBlock(key, current > 0 ? 0 : min);
        toast(current > 0 ? 'Đã bỏ ghi mục ' + (block ? block.short : key) : 'Đã ghi ' + min + ' phút · ' + (block ? block.short : key));
        break;
      }

      case 'set-level': Store.setCurrentLevel(U.num(el.dataset.level, 1)); toast('Đã đặt cảnh giới hiện tại.'); break;
      case 'set-confidence': Store.setConfidence(U.num(el.dataset.level, 1), U.num(el.dataset.value, 1)); break;

      case 'task-done': Store.moveTask(el.dataset.id, 'done'); toast('Xong một việc. Gọn ghẽ!'); break;
      case 'task-move': Store.moveTask(el.dataset.id, el.dataset.to); break;
      case 'task-add-sprint': {
        var sp = Store.activeSprint();
        if (!sp) { toast('Chưa có sprint đang chạy.', 'error'); break; }
        Store.setTaskSprint(el.dataset.id, sp.id);
        toast('Đã đưa việc vào ' + sp.name + '.');
        break;
      }
      case 'new-task': openModal('Thêm việc', Views.taskForm(Store.state, null)); break;
      case 'edit-task': openModal('Sửa việc', Views.taskForm(Store.state, Store.getTask(el.dataset.id))); break;
      case 'delete-task':
        if (global.confirm('Xoá việc này?')) { Store.removeTask(el.dataset.id); toast('Đã xoá việc.'); }
        break;

      case 'new-book': openModal('Thêm tài liệu', Views.bookForm(Store.state, null)); break;
      case 'edit-book': openModal('Sửa tài liệu', Views.bookForm(Store.state, Store.getBook(el.dataset.id))); break;
      case 'log-progress': {
        var book = Store.getBook(el.dataset.id);
        if (book) openModal('Ghi tiến độ đọc', Views.progressForm(book));
        break;
      }
      case 'delete-book':
        if (global.confirm('Xoá tài liệu này và toàn bộ nhật ký đọc của nó?')) { Store.removeBook(el.dataset.id); toast('Đã xoá tài liệu.'); }
        break;
      case 'delete-reading-log':
        if (global.confirm('Xoá lần ghi này?')) { Store.removeReadingLog(el.dataset.id); toast('Đã xoá.'); }
        break;

      case 'new-member': openModal('Thêm thành viên', Views.memberForm(Store.state)); break;
      case 'delete-member':
        if (global.confirm('Xoá thành viên này?')) { Store.removeMember(el.dataset.id); toast('Đã xoá thành viên.'); }
        break;

      case 'new-sprint': openModal('Mở sprint', Views.sprintForm(null)); break;
      case 'edit-sprint': openModal('Sửa sprint', Views.sprintForm(Store.getSprint(el.dataset.id))); break;
      case 'close-sprint':
        if (global.confirm('Kết thúc sprint này? Việc chưa xong vẫn nằm lại trong sprint.')) {
          Store.closeSprint(el.dataset.id);
          toast('Đã kết thúc sprint. Nhớ họp retro nhé.');
        }
        break;

      case 'delete-recreation':
        if (global.confirm('Xoá lần tái tạo này?')) { Store.removeRecreation(el.dataset.id); toast('Đã xoá.'); }
        break;

      case 'set-range': ui.range = U.num(el.dataset.range, 30); render(); break;

      case 'export-data':
        download('tu-luyen-ky-' + U.today() + '.json', Store.exportJSON());
        toast('Đã xuất file sao lưu.');
        break;

      case 'pick-import': {
        var f = document.getElementById('importFile');
        if (f) f.click();
        break;
      }

      case 'reset-data':
        if (global.confirm('Xoá TOÀN BỘ dữ liệu tu luyện? Hành động này không thể hoàn tác.')) {
          Store.reset();
          toast('Đã xoá toàn bộ dữ liệu.');
        }
        break;

      default: break;
    }
  }

  function handleCheckedChange(el) {
    switch (el.getAttribute('data-action')) {
      case 'toggle-rule': Store.setRule(U.today(), U.num(el.dataset.rule, 0), el.checked); break;
      case 'toggle-task': Store.setTask(U.num(el.dataset.level, 1), U.num(el.dataset.index, 0), el.checked); break;
      case 'toggle-pass': Store.setPass(U.num(el.dataset.level, 1), el.checked); break;
      case 'set-theme': Store.setTheme(el.value); break;
      default: break;
    }
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  /* --------------------------------- Biểu mẫu --------------------------------- */
  function sessionFromForm(form) {
    var fd = new FormData(form);
    var minutes = {}, journal = {};
    SEED.schedule.forEach(function (i) { minutes[i.id] = U.num(fd.get('min_' + i.id), 0); });
    SEED.journalQuestions.forEach(function (q) { journal[q.id] = String(fd.get('q_' + q.id) || '').trim(); });
    return {
      date: String(fd.get('date') || U.today()),
      level: U.num(fd.get('level'), 1),
      mode: String(fd.get('mode') || 'B'),
      minutes: minutes,
      selfSolved: U.num(fd.get('selfSolved'), 0),
      conceptsExplained: U.num(fd.get('conceptsExplained'), 0),
      debugWithoutAI: fd.get('debugWithoutAI') === 'on',
      journal: journal,
      tags: String(fd.get('tags') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean)
    };
  }

  function handleSubmit(e) {
    var form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    var kind = form.getAttribute('data-form');
    var fd = new FormData(form);

    if (kind === 'session') {
      var data = sessionFromForm(form);
      var id = form.querySelector('input[name="id"]').value;
      if (id) { Store.updateSession(id, data); toast('Đã cập nhật buổi học.'); }
      else { Store.addSession(data); toast('Đã lưu buổi học. Giữ vững nhịp độ!'); }
      closeModal();
      return;
    }

    if (kind === 'recreation') {
      var feature = String(fd.get('feature') || '').trim();
      if (!feature) { toast('Hãy nhập tên tính năng đã tái tạo.', 'error'); return; }
      Store.addRecreation({
        date: String(fd.get('date') || U.today()), feature: feature,
        minutes: U.num(fd.get('minutes'), 0), result: String(fd.get('result') || 'fail'),
        notes: String(fd.get('notes') || '').trim()
      });
      toast('Đã ghi lại lần tái tạo.');
      return;
    }

    if (kind === 'profile') {
      Store.saveProfile({
        name: String(fd.get('name') || '').trim(),
        startDate: String(fd.get('startDate') || U.today()),
        goalMinutes: U.num(fd.get('goalMinutes'), 210),
        currentLevel: U.num(fd.get('currentLevel'), 1)
      });
      toast('Đã lưu hồ sơ.');
      return;
    }

    if (kind === 'book') {
      var book = {
        title: String(fd.get('title') || '').trim(),
        author: String(fd.get('author') || '').trim(),
        kind: String(fd.get('kind') || 'sach'),
        unit: String(fd.get('unit') || 'trang'),
        total: U.num(fd.get('total'), 0),
        progress: U.num(fd.get('progress'), 0),
        status: String(fd.get('status') || 'reading'),
        rating: U.num(fd.get('rating'), 0),
        startedAt: String(fd.get('startedAt') || U.today()),
        takeaways: String(fd.get('takeaways') || '').trim(),
        tags: String(fd.get('tags') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean)
      };
      if (!book.title) { toast('Hãy nhập tên tài liệu.', 'error'); return; }
      var bid = String(fd.get('id') || '');
      if (bid) { Store.updateBook(bid, book); toast('Đã cập nhật tài liệu.'); }
      else { Store.addBook(book); toast('Đã thêm vào giá sách.'); }
      closeModal();
      return;
    }

    if (kind === 'progress') {
      Store.addReadingLog({
        bookId: String(fd.get('bookId') || ''),
        date: String(fd.get('date') || U.today()),
        amount: U.num(fd.get('amount'), 0),
        minutes: U.num(fd.get('minutes'), 0),
        note: String(fd.get('note') || '').trim()
      });
      toast('Đã ghi tiến độ đọc.');
      closeModal();
      return;
    }

    if (kind === 'task') {
      var task = {
        title: String(fd.get('title') || '').trim(),
        desc: String(fd.get('desc') || '').trim(),
        points: U.num(fd.get('points'), 1),
        priority: String(fd.get('priority') || 'vua'),
        status: String(fd.get('status') || 'todo'),
        assigneeId: String(fd.get('assigneeId') || '') || null,
        sprintId: String(fd.get('sprintId') || '') || null
      };
      if (!task.title) { toast('Hãy nhập tên việc.', 'error'); return; }
      var tid = String(fd.get('id') || '');
      if (tid) {
        var old = Store.getTask(tid);
        if (old && old.status !== 'done' && task.status === 'done') task.doneAt = U.today();
        Store.updateTask(tid, task);
        toast('Đã cập nhật việc.');
      } else {
        Store.addTask(task);
        toast('Đã thêm việc.');
      }
      closeModal();
      return;
    }

    if (kind === 'member') {
      var name = String(fd.get('name') || '').trim();
      if (!name) { toast('Hãy nhập tên thành viên.', 'error'); return; }
      Store.addMember({ name: name, role: String(fd.get('role') || '').trim() });
      toast('Đã thêm thành viên.');
      closeModal();
      return;
    }

    if (kind === 'sprint') {
      var sprint = {
        name: String(fd.get('name') || '').trim(),
        goal: String(fd.get('goal') || '').trim(),
        startDate: String(fd.get('startDate') || U.today()),
        endDate: String(fd.get('endDate') || U.addDays(U.today(), 13))
      };
      if (!sprint.name) { toast('Hãy nhập tên sprint.', 'error'); return; }
      var sid = String(fd.get('id') || '');
      if (sid) { Store.updateSprint(sid, sprint); toast('Đã cập nhật sprint.'); }
      else { Store.addSprint(sprint); toast('Đã mở sprint mới.'); }
      closeModal();
      return;
    }

    if (kind === 'retro') {
      var retro = {};
      SEED.retroQuestions.forEach(function (q) { retro[q.id] = String(fd.get('retro_' + q.id) || '').trim(); });
      Store.saveRetro(String(fd.get('sprintId') || ''), retro);
      toast('Đã lưu biên bản họp cải tiến.');
      return;
    }
  }

  function handleImportFile(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try { Store.importJSON(String(reader.result)); toast('Đã nhập dữ liệu thành công.'); }
      catch (err) { console.error(err); toast('File không hợp lệ.', 'error'); }
      input.value = '';
    };
    reader.readAsText(file);
  }

  /* -------------------------------- Kéo thả bảng việc -------------------------------- */
  var dragId = null;

  function clearOver() {
    var cols = document.querySelectorAll('.board-col.over');
    for (var i = 0; i < cols.length; i++) cols[i].classList.remove('over');
  }

  document.addEventListener('dragstart', function (e) {
    var el = e.target.closest ? e.target.closest('[data-drag]') : null;
    if (!el) return;
    dragId = el.getAttribute('data-drag');
    try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
    el.classList.add('dragging');
  });

  document.addEventListener('dragend', function (e) {
    var el = e.target.closest ? e.target.closest('[data-drag]') : null;
    if (el) el.classList.remove('dragging');
    clearOver();
  });

  document.addEventListener('dragover', function (e) {
    var col = e.target.closest ? e.target.closest('[data-drop]') : null;
    if (!col) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
    col.classList.add('over');
  });

  document.addEventListener('dragleave', function (e) {
    var col = e.target.closest ? e.target.closest('[data-drop]') : null;
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('over');
  });

  document.addEventListener('drop', function (e) {
    var col = e.target.closest ? e.target.closest('[data-drop]') : null;
    if (!col) return;
    e.preventDefault();
    clearOver();
    var id = dragId;
    try { id = e.dataTransfer.getData('text/plain') || id; } catch (err) {}
    if (id) Store.moveTask(id, col.getAttribute('data-drop'));
  });

  /* --------------------------------- Sự kiện --------------------------------- */
  document.addEventListener('click', function (e) {
    var routeEl = e.target.closest('[data-route]');
    if (routeEl) {
      e.preventDefault();
      var target = routeEl.getAttribute('data-route');
      if (global.location.hash === target) render();
      else global.location.hash = target;
      return;
    }
    var el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.tagName === 'INPUT') return;
    handleAction(el.getAttribute('data-action'), el);
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'importFile') { handleImportFile(el); return; }
    if (el.tagName === 'INPUT' && el.hasAttribute('data-action')) handleCheckedChange(el);
  });

  document.addEventListener('input', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-minutes-input')) updateMinutesTotal();
  });

  document.addEventListener('submit', handleSubmit);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  global.addEventListener('hashchange', render);

  /* ---------------------------------- Khởi động ---------------------------------- */
  function init() {
    Store.init();
    Store.subscribe(render);
    if (!global.location.hash) global.location.hash = '#/today';
    render();
  }

  global.App = { toast: toast, openModal: openModal, closeModal: closeModal, render: render };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
