/* =====================================================================
   web/charts.js — Biểu đồ SVG viết tay, không dùng thư viện ngoài.

   Mọi hàm nhận dữ liệu thuần và trả về chuỗi HTML. Màu truyền vào dưới
   dạng mã hex (lấy từ bảng màu ở app.js) vì thuộc tính SVG không phải lúc
   nào cũng hiểu var(--x).
   ===================================================================== */
(function (global) {
  'use strict';

  /* Màu dự phòng khi chỗ gọi không truyền màu nào. app.js gọi setDefaults()
     ngay sau khi đổi bảng màu, để biểu đồ không còn vẽ bằng tông mực đêm
     trên nền trắng. Mấy mã dưới đây chỉ còn là chốt chặn cuối cho những lời
     gọi trần (ví dụ trong bộ kiểm thử) — chúng không còn được dùng trong ứng
     dụng thật. */
  var defaults = {};
  function setDefaults(next) { defaults = next || {}; }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  function niceMax(value) {
    if (value <= 0) return 1;
    var pow = Math.pow(10, Math.floor(Math.log10(value)));
    var scaled = value / pow;
    var step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
    return step * pow;
  }

  /* Cột dọc, có trục và nhãn. */
  function bars(options) {
    var data = options.data || [];
    var height = options.height || 150;
    var width = options.width || 640;
    var padLeft = options.padLeft || 34;
    var padBottom = 22;
    var max = niceMax(Math.max(1, Math.max.apply(null, data.map(function (d) { return num(d.value); }))));
    var innerW = width - padLeft - 8;
    var innerH = height - padBottom - 8;
    var step = data.length ? innerW / data.length : innerW;
    var barW = Math.max(3, Math.min(38, step * 0.62));
    var parts = [];

    parts.push('<svg class="chart" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" role="img">');
    for (var g = 0; g <= 3; g++) {
      var y = 8 + innerH * (g / 3);
      parts.push('<line x1="' + padLeft + '" y1="' + y.toFixed(1) + '" x2="' + (width - 4) + '" y2="' + y.toFixed(1) + '" stroke="' + (options.grid || defaults.line || '#333') + '" stroke-width="1" opacity="0.45"/>');
      parts.push('<text x="' + (padLeft - 5) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" font-size="9" fill="' + (options.muted || defaults.muted || '#888') + '">' + esc(Math.round(max - max * (g / 3))) + '</text>');
    }
    data.forEach(function (item, i) {
      var value = num(item.value);
      var h = Math.round(innerH * (value / max));
      var x = padLeft + i * step + (step - barW) / 2;
      var y = 8 + innerH - h;
      parts.push('<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(0, h) + '" rx="2" fill="' + esc(item.color || options.color || defaults.cinabar || '#c8543c') + '"><title>' + esc(item.label) + ': ' + value + '</title></rect>');
      if (data.length <= 16) {
        parts.push('<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (height - 6) + '" text-anchor="middle" font-size="9" fill="' + (options.muted || defaults.muted || '#888') + '">' + esc(item.short || item.label) + '</text>');
      }
    });
    parts.push('</svg>');
    return parts.join('');
  }

  /* Đường nhỏ, không trục — để nhìn xu hướng. */
  function sparkline(values, options) {
    var opts = options || {};
    var width = opts.width || 260;
    var height = opts.height || 44;
    var list = (values || []).map(num);
    if (list.length < 2) return '<div class="empty">chưa đủ dữ liệu</div>';
    var max = Math.max.apply(null, list) || 1;
    var min = Math.min.apply(null, list);
    var span = (max - min) || 1;
    var stepX = width / (list.length - 1);
    var points = list.map(function (v, i) {
      var x = i * stepX;
      var y = height - 3 - ((v - min) / span) * (height - 8);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var color = opts.color || defaults.cinabar || '#c8543c';
    return '<svg class="chart" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">' +
      '<polyline points="' + points.join(' ') + '" fill="none" stroke="' + esc(color) + '" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<polygon points="0,' + height + ' ' + points.join(' ') + ' ' + width + ',' + height + '" fill="' + esc(color) + '" opacity="0.12"/>' +
      '</svg>';
  }

  /* Vòng tròn tỉ lệ. */
  function donut(segments, options) {
    var opts = options || {};
    var size = opts.size || 132;
    var thickness = opts.thickness || 16;
    var radius = (size - thickness) / 2;
    var center = size / 2;
    var total = (segments || []).reduce(function (a, s) { return a + num(s.value); }, 0);
    if (!total) return '<div class="empty">chưa có dữ liệu</div>';
    var circumference = 2 * Math.PI * radius;
    var offset = 0;
    var parts = ['<svg class="chart" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">'];
    parts.push('<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" fill="none" stroke="' + esc(opts.track || defaults.line || '#2a2420') + '" stroke-width="' + thickness + '"/>');
    segments.forEach(function (segment) {
      var value = num(segment.value);
      if (value <= 0) return;
      var length = circumference * (value / total);
      parts.push('<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" fill="none" stroke="' + esc(segment.color) + '" stroke-width="' + thickness + '" ' +
        'stroke-dasharray="' + length.toFixed(1) + ' ' + (circumference - length).toFixed(1) + '" stroke-dashoffset="' + (-offset).toFixed(1) + '" ' +
        'transform="rotate(-90 ' + center + ' ' + center + ')"><title>' + esc(segment.label) + ': ' + value + '</title></circle>');
      offset += length;
    });
    if (opts.center) {
      parts.push('<text x="' + center + '" y="' + (center + 2) + '" text-anchor="middle" font-size="17" font-family="monospace" fill="' + esc(opts.ink || defaults.ink || '#ebe0cd') + '">' + esc(opts.center) + '</text>');
      if (opts.centerLabel) parts.push('<text x="' + center + '" y="' + (center + 16) + '" text-anchor="middle" font-size="9" fill="' + esc(opts.muted || defaults.muted || '#888') + '">' + esc(opts.centerLabel) + '</text>');
    }
    parts.push('</svg>');
    return parts.join('');
  }

  /* Lưới nhiệt theo ngày — nhìn nhịp làm việc. */
  function heatmap(days, options) {
    var opts = options || {};
    var list = days || [];
    if (!list.length) return '<div class="empty">chưa có dữ liệu</div>';
    var cell = opts.cell || 13;
    var gap = 3;
    var perRow = opts.perRow || 14;
    var max = Math.max(1, Math.max.apply(null, list.map(function (d) { return num(d.value); })));
    var rows = Math.ceil(list.length / perRow);
    var width = perRow * (cell + gap);
    var height = rows * (cell + gap);
    var parts = ['<svg class="chart" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '">'];
    list.forEach(function (item, i) {
      var x = (i % perRow) * (cell + gap);
      var y = Math.floor(i / perRow) * (cell + gap);
      var ratio = num(item.value) / max;
      var opacity = num(item.value) ? (0.18 + 0.82 * ratio) : 0;
      parts.push('<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" rx="3" fill="' + esc(opts.color || defaults.cinabar || '#c8543c') + '" opacity="' + (num(item.value) ? opacity.toFixed(2) : 0.06) + '"><title>' + esc(item.label) + ': ' + num(item.value) + '</title></rect>');
    });
    parts.push('</svg>');
    return parts.join('');
  }

  /* Thanh ngang dạng HTML — dễ đọc nhãn dài hơn SVG. */
  function hbars(items, options) {
    var opts = options || {};
    var list = items || [];
    if (!list.length) return '<div class="empty">chưa có dữ liệu</div>';
    var max = Math.max(1, Math.max.apply(null, list.map(function (i) { return num(i.value); })));
    return '<div class="hbars">' + list.map(function (item) {
      var pct = (num(item.value) / max) * 100;
      return '<div class="hbar">' +
        '<div class="hbar-top"><span class="hbar-label">' + esc(item.label) + '</span>' +
        '<span class="hbar-value mono">' + esc(item.text != null ? item.text : num(item.value)) + '</span></div>' +
        '<div class="meter"><span style="width:' + pct.toFixed(1) + '%;background:' + esc(item.color || opts.color || defaults.cinabar || '#c8543c') + '"></span></div>' +
        '</div>';
    }).join('') + '</div>';
  }

  global.Charts = { esc: esc, bars: bars, sparkline: sparkline, donut: donut, heatmap: heatmap, hbars: hbars, niceMax: niceMax, setDefaults: setDefaults };
})(window);
