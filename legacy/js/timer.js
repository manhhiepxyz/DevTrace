/* =====================================================================
   timer.js — Đồng hồ "nén hương": bấm giờ một phiên học.
   Nén hương cháy ngắn dần theo thời gian; khi tàn thì ngân một tiếng chuông.
   Trạng thái được lưu lại nên tải lại trang vẫn tiếp tục đếm.
   ===================================================================== */
(function (global) {
  'use strict';

  var Store = global.Store;
  var U = global.Utils;
  var BASE_TITLE = 'Tu Luyện Ký · Nhật ký học tập';

  var handle = null;

  function t() {
    if (!Store.state.timer) {
      Store.state.timer = { running: false, endsAt: null, remainingMs: 45 * 60000, minutes: 45, label: '', finished: false };
    }
    return Store.state.timer;
  }

  function remaining() {
    var s = t();
    if (s.running && s.endsAt) return Math.max(0, s.endsAt - Date.now());
    return Math.max(0, U.num(s.remainingMs, 0));
  }

  function totalMs() { return Math.max(60000, U.num(t().minutes, 45) * 60000); }

  function fmtMs(ms) {
    var total = Math.ceil(ms / 1000);
    var m = Math.floor(total / 60);
    var sec = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function pct() { return Math.max(0, Math.min(1, remaining() / totalMs())); }

  /* ------------------------------ Điều khiển ------------------------------ */
  function start(minutes, label) {
    var min = Math.max(1, U.num(minutes, t().minutes));
    Store.setTimer({ running: true, endsAt: Date.now() + min * 60000, remainingMs: min * 60000, minutes: min, label: label || '', finished: false });
    ensureTick();
  }

  function pause() {
    if (!t().running) return;
    Store.setTimer({ running: false, endsAt: null, remainingMs: remaining() });
  }

  function resume() {
    var rem = Math.max(0, U.num(t().remainingMs, 0));
    if (rem <= 0) return;
    Store.setTimer({ running: true, endsAt: Date.now() + rem, finished: false });
    ensureTick();
  }

  function reset() {
    var min = U.num(t().minutes, 45);
    Store.setTimer({ running: false, endsAt: null, remainingMs: min * 60000, finished: false });
  }

  function setPreset(minutes) {
    if (t().running) return;
    var min = Math.max(1, U.num(minutes, 45));
    Store.setTimer({ minutes: min, remainingMs: min * 60000, finished: false });
  }

  function finish() {
    var s = t();
    var min = U.num(s.minutes, 45);
    Store.setTimer({ running: false, endsAt: null, remainingMs: 0, finished: true });
    chime();
    if (global.App && global.App.toast) global.App.toast('Nén hương đã tàn — ' + min + ' phút trọn vẹn.', 'ok');
  }

  function chime() {
    try {
      var Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var now = ctx.currentTime;
      [523.25, 784.0, 1046.5].forEach(function (f, i) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        var at = now + i * 0.16;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.11, at + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 1.8);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(at);
        o.stop(at + 1.9);
      });
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 2600);
    } catch (e) { /* trình duyệt chặn âm thanh thì bỏ qua */ }
  }

  /* -------------------------------- Giao diện -------------------------------- */
  function stickSVG(p) {
    var topY = 196 - 168 * p;
    return '<svg viewBox="0 0 80 230" class="incense" role="img" aria-label="Nén hương">' +
      '<defs><radialGradient id="emberGlow"><stop offset="0%" stop-color="#ffb37a" stop-opacity="0.9"/>' +
      '<stop offset="100%" stop-color="#c0392b" stop-opacity="0"/></radialGradient></defs>' +
      '<rect x="26" y="196" width="28" height="20" rx="4" fill="#8a6a3d"/>' +
      '<rect x="22" y="212" width="36" height="7" rx="3" fill="#6d5330"/>' +
      '<rect id="incenseStick" x="36.5" y="' + topY + '" width="7" height="' + Math.max(2, 196 - topY) + '" rx="3" fill="#a98552"/>' +
      '<rect id="incenseAsh" x="36.5" y="' + topY + '" width="7" height="4" rx="2" fill="#5a4630" opacity="0.85"/>' +
      '<circle id="emberGlow" cx="40" cy="' + topY + '" r="13" fill="url(#emberGlow)"/>' +
      '<circle id="incenseEmber" cx="40" cy="' + topY + '" r="3.6" fill="#e05a3a"/>' +
      '<circle cx="34" cy="' + (topY - 22) + '" r="4" fill="#8ea3bd" opacity="0.12"/>' +
      '<circle cx="45" cy="' + (topY - 46) + '" r="5.5" fill="#8ea3bd" opacity="0.08"/>' +
      '<circle cx="38" cy="' + (topY - 74) + '" r="7" fill="#8ea3bd" opacity="0.05"/>' +
      '</svg>';
  }

  function view() {
    var s = t();
    var min = U.num(s.minutes, 45);
    var presets = [25, 45, 90];
    var blocks = global.SEED.schedule;
    return '<div class="timer">' +
      '<div class="timer-visual" data-role="timer-visual">' + stickSVG(pct()) + '</div>' +
      '<div class="timer-main">' +
      '<div class="timer-clock" data-role="clock">' + fmtMs(remaining()) + '</div>' +
      '<p class="timer-caption" data-role="caption">' + esc(esc_attr(s)) + '</p>' +
      '<div class="timer-row">' +
      presets.map(function (p) {
        return '<button class="btn btn-sm' + (min === p && !s.running ? ' is-on' : '') + '" data-action="timer-preset" data-min="' + p + '">' + p + ' phút</button>';
      }).join('') +
      '</div>' +
      '<div class="timer-row">' +
      (s.running
        ? '<button class="btn btn-sm" data-action="timer-pause">Tạm dừng</button>'
        : (remaining() > 0 && remaining() < totalMs()
          ? '<button class="btn btn-primary btn-sm" data-action="timer-resume">Tiếp tục</button>'
          : '<button class="btn btn-primary btn-sm" data-action="timer-start">Thắp hương</button>')) +
      '<button class="btn btn-ghost btn-sm" data-action="timer-reset">Tắt</button>' +
      '</div>' +
      '<label class="timer-field"><span>Ghi chú phiên</span>' +
      '<input type="text" data-role="timer-label" placeholder="Ví dụ: viết API tạo tài liệu" value="' + esc(s.label || '') + '"></label>' +
      '<label class="timer-field"><span>Khi tàn thì tính vào</span>' +
      '<select data-role="timer-block">' + blocks.map(function (b, i) {
        return '<option value="' + b.id + '"' + (i === 2 ? ' selected' : '') + '>' + esc(b.short || b.label) + ' (' + b.minutes + ' phút)</option>';
      }).join('') + '</select></label>' +
      '<button class="btn btn-sm full" data-action="timer-log">Ghi ' + min + ' phút vào hôm nay</button>' +
      '</div></div>';
  }

  function esc_attr(s) {
    if (s.running) return 'Nén hương đang cháy…';
    if (s.finished) return 'Hương đã tàn. Ghi lại rồi nghỉ một chút nhé.';
    if (remaining() < totalMs()) return 'Đang tạm dừng.';
    return 'Chọn thời lượng rồi thắp hương để bắt đầu một phiên học.';
  }

  function esc(v) { return global.Charts.esc(v); }

  function paint(root) {
    if (!root) return;
    var s = t();
    var p = pct();
    var clock = root.querySelector('[data-role="clock"]');
    if (clock) clock.textContent = fmtMs(remaining());

    var stick = root.querySelector('#incenseStick');
    var ash = root.querySelector('#incenseAsh');
    var ember = root.querySelector('#incenseEmber');
    var glow = root.querySelector('#emberGlow');
    var topY = 196 - 168 * p;
    if (stick) { stick.setAttribute('y', String(topY)); stick.setAttribute('height', String(Math.max(2, 196 - topY))); }
    if (ash) ash.setAttribute('y', String(topY));
    if (ember) ember.setAttribute('cy', String(topY));
    if (glow) glow.setAttribute('cy', String(topY));

    var visual = root.querySelector('[data-role="timer-visual"]');
    if (visual) visual.classList.toggle('is-burning', !!s.running);

    var caption = root.querySelector('[data-role="caption"]');
    if (caption) caption.textContent = esc_attr(s);

    syncTitle();
  }

  function syncTitle() {
    var s = t();
    try {
      document.title = s.running ? fmtMs(remaining()) + ' · Tu Luyện Ký' : BASE_TITLE;
    } catch (e) {}
  }

  function tick() {
    var root = document.getElementById('timerWidget');
    if (t().running && remaining() <= 0) {
      finish();
      if (root) mount(root); else syncTitle();
      return;
    }
    if (!root) {
      // Vẫn giữ nhịp đếm khi huynh sang trang khác để chuông kịp ngân.
      if (!t().running) stopTick();
      syncTitle();
      return;
    }
    paint(root);
  }

  function ensureTick() {
    if (handle) return;
    handle = global.setInterval(tick, 250);
  }

  function stopTick() {
    if (handle) { global.clearInterval(handle); handle = null; }
  }

  function mount(root) {
    if (!root) { stopTick(); syncTitle(); return; }
    root.innerHTML = view();
    ensureTick();
    paint(root);
  }

  /* -------------------------- Xử lý nút trong widget -------------------------- */
  function handleAction(action, el) {
    var root = document.getElementById('timerWidget');
    if (!root) return;
    var labelEl = root.querySelector('[data-role="timer-label"]');

    switch (action) {
      case 'timer-preset': setPreset(U.num(el.dataset.min, 45)); mount(root); return;
      case 'timer-start': start(t().minutes, labelEl ? labelEl.value : ''); mount(root); return;
      case 'timer-pause': pause(); mount(root); return;
      case 'timer-resume': resume(); mount(root); return;
      case 'timer-reset': reset(); mount(root); return;
      case 'timer-log': {
        var blockEl = root.querySelector('[data-role="timer-block"]');
        var block = blockEl ? blockEl.value : 'build';
        var min = U.num(t().minutes, 45);
        Store.logTodayBlock(block, min);
        if (global.App && global.App.toast) global.App.toast('Đã ghi ' + min + ' phút vào hôm nay.');
        reset();
        mount(root);
        global.App.render();
        return;
      }
      default: return;
    }
  }

  function isRunning() { return !!t().running; }

  global.Timer = {
    mount: mount,
    handleAction: handleAction,
    isRunning: isRunning,
    remaining: remaining,
    fmtMs: fmtMs,
    syncTitle: syncTitle,
    baseTitle: BASE_TITLE
  };
})(window);
