/* =====================================================================
   charts.js — Biểu đồ SVG viết tay, không dùng thư viện ngoài.
   ===================================================================== */
(function (global) {
  'use strict';

  var W = 720;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function niceMax(v) {
    if (v <= 10) return 10;
    var pow = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / pow;
    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * pow;
  }

  function fmt(v) { return String(Math.round(v * 10) / 10); }

  /* Biến CSS (var(--jade)) không phải lúc nào cũng đọc được trong thuộc tính
     trình bày của SVG, nên đổi sang mã màu cụ thể theo chủ đề đang bật. */
  function resolve(color) {
    if (typeof color !== 'string' || color.indexOf('var(') !== 0) return color;
    var name = color.slice(4, color.length - 1).trim();
    try {
      var v = global.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || '#2f6b52';
    } catch (e) { return '#2f6b52'; }
  }

  function emptyBox(h, text) { return '<div class="chart-empty" style="height:' + h + 'px">' + esc(text) + '</div>'; }

  function gridLines(padL, padR, padT, plotH, maxNice) {
    var out = '', i, y, val;
    for (i = 0; i <= 4; i++) {
      y = padT + plotH - (plotH * i / 4);
      val = Math.round(maxNice * i / 4);
      out += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" class="grid"/>';
      out += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" class="axis axis-y">' + val + '</text>';
    }
    return out;
  }

  /* ---------------------- Cột xếp chồng theo thời gian ---------------------- */
  function stackedBars(opts) {
    var rows = opts.rows || [];
    var keys = opts.keys || [];
    var H = opts.height || 210;
    if (!rows.length) return emptyBox(H, opts.emptyText || 'Chưa có dữ liệu');

    var padL = 40, padR = 14, padT = 18, padB = 30;
    var plotH = H - padT - padB, plotW = W - padL - padR;
    var totals = rows.map(function (r) { return keys.reduce(function (a, k) { return a + (r.values[k.key] || 0); }, 0); });
    var maxNice = niceMax(Math.max.apply(null, totals.concat([1])));
    var step = plotW / rows.length;
    var barW = Math.max(6, Math.min(40, step * 0.62));
    var out = gridLines(padL, padR, padT, plotH, maxNice);

    rows.forEach(function (r, idx) {
      var cx = padL + step * idx + step / 2;
      var x = cx - barW / 2;
      var top = padT + plotH;
      keys.forEach(function (k) {
        var v = r.values[k.key] || 0;
        if (v <= 0) return;
        var h = plotH * v / maxNice;
        top -= h;
        out += '<rect x="' + x + '" y="' + top + '" width="' + barW + '" height="' + h + '" rx="2" fill="' + resolve(k.color) + '" opacity="0.92">' +
          '<title>' + esc(r.label) + ' — ' + esc(k.label) + ': ' + v + ' phút</title></rect>';
      });
      out += '<text x="' + cx + '" y="' + (H - 9) + '" class="axis" text-anchor="middle">' + esc(r.label) + '</text>';
      if (totals[idx] > 0) out += '<text x="' + cx + '" y="' + (top - 6) + '" class="axis axis-total" text-anchor="middle">' + totals[idx] + '</text>';
    });

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" preserveAspectRatio="xMidYMid meet" role="img">' + out + '</svg>';
  }

  /* ---------------------------- Cột một chuỗi ---------------------------- */
  function bars(opts) {
    var rows = opts.rows || [];
    var H = opts.height || 190;
    if (!rows.length) return emptyBox(H, opts.emptyText || 'Chưa có dữ liệu');

    var padL = 40, padR = 14, padT = 18, padB = 30;
    var plotH = H - padT - padB, plotW = W - padL - padR;
    var color = resolve(opts.color || '#2f6b52');
    var unit = opts.unit || '';
    var maxNice = niceMax(Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1])));
    var step = plotW / rows.length;
    var barW = Math.max(4, Math.min(30, step * 0.6));
    var out = gridLines(padL, padR, padT, plotH, maxNice);

    rows.forEach(function (r, idx) {
      var cx = padL + step * idx + step / 2;
      var h = plotH * Math.max(0, r.value) / maxNice;
      if (r.value > 0) {
        out += '<rect x="' + (cx - barW / 2) + '" y="' + (padT + plotH - h) + '" width="' + barW + '" height="' + h + '" rx="2" fill="' + color + '">' +
          '<title>' + esc(r.label) + ': ' + r.value + ' ' + esc(unit) + '</title></rect>';
      }
      out += '<text x="' + cx + '" y="' + (H - 9) + '" class="axis" text-anchor="middle">' + esc(r.label) + '</text>';
    });

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" preserveAspectRatio="xMidYMid meet" role="img">' + out + '</svg>';
  }

  /* ------------------------------ Đường miền ------------------------------ */
  function area(opts) {
    var pts = opts.points || [];
    var H = opts.height || 200;
    if (!pts.length) return emptyBox(H, opts.emptyText || 'Chưa có buổi học nào');

    var padL = 40, padR = 14, padT = 18, padB = 30;
    var plotH = H - padT - padB, plotW = W - padL - padR;
    var max = opts.max || 100;
    var color = resolve(opts.color || '#2f6b52');
    var step = pts.length > 1 ? plotW / (pts.length - 1) : 0;
    var coords = pts.map(function (p, i) {
      return [padL + step * i, padT + plotH - plotH * Math.max(0, Math.min(max, p.value)) / max];
    });

    var out = '', i;
    for (i = 0; i <= 4; i++) {
      var y = padT + plotH - (plotH * i / 4);
      out += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" class="grid"/>';
      out += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" class="axis axis-y">' + Math.round(max * i / 4) + '</text>';
    }

    if (opts.goal) {
      var gy = padT + plotH - plotH * Math.min(max, opts.goal) / max;
      out += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" class="goal-line"/>';
      out += '<text x="' + (W - padR) + '" y="' + (gy - 6) + '" class="axis axis-goal" text-anchor="end">' + esc(opts.goalLabel || ('mốc ' + opts.goal)) + '</text>';
    }

    var line = coords.map(function (c, idx) { return (idx ? 'L' : 'M') + fmt(c[0]) + ' ' + fmt(c[1]); }).join(' ');
    var fill = line + ' L' + fmt(coords[coords.length - 1][0]) + ' ' + (padT + plotH) + ' L' + fmt(coords[0][0]) + ' ' + (padT + plotH) + ' Z';

    out += '<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.34"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>';
    out += '<path d="' + fill + '" fill="url(#areaGrad)"/>';
    out += '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>';

    var lastLabel = -99;
    pts.forEach(function (p, idx) {
      var c = coords[idx];
      out += '<circle cx="' + fmt(c[0]) + '" cy="' + fmt(c[1]) + '" r="3.4" fill="' + color + '" stroke="none">' +
        '<title>' + esc(p.label) + ': ' + p.value + '/100</title></circle>';
      if (idx - lastLabel >= Math.ceil(pts.length / 8) || idx === pts.length - 1) {
        out += '<text x="' + fmt(c[0]) + '" y="' + (H - 9) + '" class="axis" text-anchor="middle">' + esc(p.label) + '</text>';
        lastLabel = idx;
      }
    });

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" preserveAspectRatio="xMidYMid meet" role="img">' + out + '</svg>';
  }

  /* ------------------------------- Burndown ------------------------------- */
  function burndown(opts) {
    var rows = opts.rows || [];
    var H = opts.height || 220;
    if (rows.length < 2) return emptyBox(H, opts.emptyText || 'Cần ít nhất hai ngày để vẽ biểu đồ');

    var padL = 40, padR = 16, padT = 20, padB = 30;
    var plotH = H - padT - padB, plotW = W - padL - padR;
    var max = niceMax(Math.max.apply(null, rows.map(function (r) { return Math.max(r.ideal, r.actual); }).concat([1])));
    var step = plotW / (rows.length - 1);
    var out = gridLines(padL, padR, padT, plotH, max);
    var X = function (i) { return padL + step * i; };
    var Y = function (v) { return padT + plotH - plotH * Math.max(0, v) / max; };

    out += '<path d="' + rows.map(function (r, i) { return (i ? 'L' : 'M') + fmt(X(i)) + ' ' + fmt(Y(r.ideal)); }).join(' ') +
      '" fill="none" stroke="' + resolve('var(--gold)') + '" stroke-width="2" stroke-dasharray="6 5"/>';

    var done = rows.filter(function (r) { return r.actual === 0; }).length;
    var actual = rows.slice(0, rows.length - (done > 1 ? done - 1 : 0));
    out += '<path d="' + actual.map(function (r) { return 'L' + fmt(X(rows.indexOf(r))) + ' ' + fmt(Y(r.actual)); }).join(' ').replace(/^L/, 'M') +
      '" fill="none" stroke="' + resolve('var(--jade)') + '" stroke-width="2.6" stroke-linejoin="round"/>';

    rows.forEach(function (r, i) {
      if (i % Math.ceil(rows.length / 8) === 0 || i === rows.length - 1) {
        out += '<text x="' + fmt(X(i)) + '" y="' + (H - 9) + '" class="axis" text-anchor="middle">' + esc(r.label) + '</text>';
      }
    });
    out += '<text x="' + (W - padR) + '" y="14" class="axis axis-goal" text-anchor="end">— — lý tưởng　|　— thực tế</text>';

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" preserveAspectRatio="xMidYMid meet" role="img">' + out + '</svg>';
  }

  /* -------------------------------- Vành khuyên -------------------------------- */
  function arcPath(cx, cy, R, a0, a1) {
    var large = (a1 - a0) > Math.PI ? 1 : 0;
    var x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
    var x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    return 'M ' + fmt(x0) + ' ' + fmt(y0) + ' A ' + fmt(R) + ' ' + fmt(R) + ' 0 ' + large + ' 1 ' + fmt(x1) + ' ' + fmt(y1);
  }

  function donut(opts) {
    var segs = (opts.segments || []).filter(function (s) { return s.value > 0; });
    var size = opts.size || 190;
    var thick = opts.thickness || 24;
    var c = size / 2, R = c - thick / 2 - 3;
    var total = segs.reduce(function (a, s) { return a + s.value; }, 0);
    var out = '<circle cx="' + c + '" cy="' + c + '" r="' + fmt(R) + '" fill="none" stroke="rgba(120,100,70,0.18)" stroke-width="' + thick + '"/>';
    if (total > 0) {
      var a0 = -Math.PI / 2;
      segs.forEach(function (s) {
        var a1 = a0 + 2 * Math.PI * s.value / total;
        out += '<path d="' + arcPath(c, c, R, a0, a1) + '" stroke="' + resolve(s.color) + '" stroke-width="' + thick + '" fill="none">' +
          '<title>' + esc(s.label) + ': ' + s.value + '</title></path>';
        a0 = a1;
      });
    }
    out += '<text x="' + c + '" y="' + (c - 2) + '" class="donut-main" text-anchor="middle">' + esc(opts.main || '') + '</text>';
    out += '<text x="' + c + '" y="' + (c + 20) + '" class="donut-sub" text-anchor="middle">' + esc(opts.sub || '') + '</text>';
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" class="donut" width="' + size + '" height="' + size + '" role="img">' + out + '</svg>';
  }

  function ring(opts) {
    var size = opts.size || 132;
    var thick = opts.thickness || 12;
    var c = size / 2, R = c - thick / 2 - 3;
    var pct = Math.max(0, Math.min(100, opts.pct || 0));
    var color = resolve(opts.color || '#2f6b52');
    var out = '<circle cx="' + c + '" cy="' + c + '" r="' + fmt(R) + '" fill="none" stroke="rgba(120,100,70,0.18)" stroke-width="' + thick + '"/>';
    if (pct > 0) out += '<path d="' + arcPath(c, c, R, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * pct / 100) + '" stroke="' + color + '" stroke-width="' + thick + '" fill="none"/>';
    out += '<text x="' + c + '" y="' + (c + 2) + '" class="ring-main" text-anchor="middle">' + esc(opts.main !== undefined ? opts.main : (pct + '%')) + '</text>';
    if (opts.sub) out += '<text x="' + c + '" y="' + (c + 22) + '" class="ring-sub" text-anchor="middle">' + esc(opts.sub) + '</text>';
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img">' + out + '</svg>';
  }

  function hbars(opts) {
    var items = opts.items || [];
    if (!items.length) return emptyBox(80, opts.emptyText || 'Chưa có dữ liệu');
    var max = Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
    return '<div class="hbars">' + items.map(function (i) {
      return '<div class="hbar-row">' +
        '<span class="hbar-label">' + esc(i.label) + '</span>' +
        '<span class="hbar-track"><span class="hbar-fill" style="width:' + Math.round(i.value / max * 100) + '%;background:' + (i.color || '#2f6b52') + '"></span></span>' +
        '<span class="hbar-value">' + esc(i.display !== undefined ? i.display : i.value) + '</span>' +
        '</div>';
    }).join('') + '</div>';
  }

  function legend(keys) {
    return '<div class="legend">' + keys.map(function (k) {
      return '<span class="legend-item"><i style="background:' + k.color + '"></i>' + esc(k.label) + '</span>';
    }).join('') + '</div>';
  }

  global.Charts = {
    esc: esc, stackedBars: stackedBars, bars: bars, area: area, burndown: burndown,
    donut: donut, ring: ring, hbars: hbars, legend: legend, emptyBox: emptyBox
  };
})(window);
