/* =====================================================================
   Chapter 03 — Why limits matter
   ---------------------------------------------------------------------
   01  Instantaneous velocity  s(t) = t², at t = 1. The secant through
       t and t + Δt has slope 2 + Δt → 2: it becomes the tangent.
   02  Area under f(x) = x² on [0, 2] with n right-endpoint rectangles:
       Rₙ = 4(n + 1)(2n + 1) / (3n²) → 8/3.
   03  Continuous change: four small curves, each settling on a limit.
   ===================================================================== */
(function () {
  'use strict';
  var EX = window.EX;

  /* ================================================================
     01 — Instantaneous velocity
     ================================================================ */
  (function velocity() {
    var root = document.querySelector('[data-app="velocity"]');
    if (!root) return;
    var T0 = 1, HMAX = 2, HMIN = 0.0005, RATIO = HMAX / HMIN;
    var s = function (t) { return t * t; };

    var svg = root.querySelector('[data-plot]');
    var input = root.querySelector('[data-dt-input]');
    var shrinkBtn = root.querySelector('[data-shrink]');
    var resetBtn = root.querySelector('[data-reset]');
    var formula = root.querySelector('[data-reveal-formula]');
    var out = {};
    ['dt', 'ds', 'avg'].forEach(function (k) { out[k] = root.querySelector('[data-out="' + k + '"]'); });

    var plot = new EX.Plot(svg, { x: [-0.25, 3.3], y: [-0.7, 9.9], pad: { t: 20, r: 24, b: 30, l: 34 } });
    var h = HMAX, els = {}, ax = null;

    function build() {
      ax = plot.axes({ xTicks: [1, 2, 3], yTicks: [2, 4, 6, 8], xLabel: '{t}', yLabel: '{s}',
        xFmt: function (v) { return v === T0 ? '' : String(v); } });
      var under = plot.layer('under'), main = plot.layer('main'), over = plot.layer('over'), ui = plot.layer('ui');
      var clip = plot.clipId();
      EX.mtext(ui, plot.X(T0), ax.xa + 19, '1', { 'class': 'p-limit-text', 'text-anchor': 'middle' });
      EX.svg('line', { 'class': 'p-limit-line', x1: plot.X(T0), x2: plot.X(T0), y1: ax.xa, y2: plot.Y(s(T0)) }, under);

      els.tri = EX.svg('path', { 'class': 'v-tri' }, under);
      els.triDt = EX.mtext(ui, 0, 0, 'Δ{t}', { 'class': 'v-tri-text', 'text-anchor': 'middle' });
      els.triDs = EX.mtext(ui, 0, 0, 'Δ{s}', { 'class': 'v-tri-text', 'text-anchor': 'start' });

      EX.svg('path', { 'class': 'p-fn', d: plot.fnPath(s, -0.25, 3.3), 'clip-path': clip }, main);
      EX.keepInside(EX.mtext(main, plot.X(2.6) + 10, plot.Y(s(2.6)) + 8, '{s} = {t}^2', { 'class': 'p-var', 'text-anchor': 'start' }), plot.W);

      els.tangent = EX.svg('line', { 'class': 'v-tangent', 'clip-path': clip,
        x1: plot.X(-0.25), y1: plot.Y(2 * -0.25 - 1), x2: plot.X(3.3), y2: plot.Y(2 * 3.3 - 1) }, main);
      // label written along the tangent, just below it
      var ax1 = plot.X(2.25), ay1 = plot.Y(3.5), ax2 = plot.X(2.75), ay2 = plot.Y(4.5);
      var len = Math.hypot(ax2 - ax1, ay2 - ay1), nx = -(ay2 - ay1) / len, ny = (ax2 - ax1) / len;
      var ang = Math.atan2(ay2 - ay1, ax2 - ax1) * 180 / Math.PI;
      var lx = (ax1 + ax2) / 2 + nx * 17, ly = (ay1 + ay2) / 2 + ny * 17;
      els.tanText = EX.mtext(ui, 0, 0, 'tangent at {t} = 1 · slope 2', { 'class': 'v-tan-text', 'text-anchor': 'middle',
        transform: 'translate(' + lx.toFixed(1) + ' ' + ly.toFixed(1) + ') rotate(' + ang.toFixed(2) + ')' });
      els.secant = EX.svg('line', { 'class': 'v-secant', 'clip-path': clip }, main);
      els.dropQ = EX.svg('line', { 'class': 'p-drop' }, over);
      els.markQ = EX.svg('circle', { 'class': 'p-axis-mark', r: 3.5 }, over);
      els.P = EX.svg('circle', { 'class': 'p-limit-dot', r: 5.5, cx: plot.X(T0), cy: plot.Y(s(T0)) }, over);
      els.haloQ = EX.svg('circle', { 'class': 'p-point-halo', r: 14 }, over);
      els.Q = EX.svg('circle', { 'class': 'p-point', r: 6 }, over);
      render();
    }

    function render() {
      if (!ax) return;
      var t1 = T0 + h, m = (s(t1) - s(T0)) / h;
      var line = function (t) { return s(T0) + m * (t - T0); };
      EX.set(els.secant, { x1: plot.X(-0.25), y1: plot.Y(line(-0.25)), x2: plot.X(3.3), y2: plot.Y(line(3.3)) });
      var Px = plot.X(T0), Py = plot.Y(s(T0)), Qx = plot.X(t1), Qy = plot.Y(s(t1));
      EX.set(els.Q, { cx: Qx, cy: Qy });
      EX.set(els.haloQ, { cx: Qx, cy: Qy });
      EX.set(els.dropQ, { x1: Qx, x2: Qx, y1: Qy, y2: ax.xa });
      EX.set(els.markQ, { cx: Qx, cy: ax.xa });
      var showTri = EX.clamp((h - 0.12) / 0.25, 0, 1);
      EX.set(els.tri, { d: 'M' + Px + ' ' + Py + 'H' + Qx + 'V' + Qy, opacity: showTri });
      EX.set(els.triDt, { x: (Px + Qx) / 2, y: Py + 17, opacity: showTri });
      EX.set(els.triDs, { x: Qx + 8, y: (Py + Qy) / 2 + 5, opacity: showTri });
      var closeness = EX.clamp((0.04 - h) / 0.035, 0, 1);  // 0 far … 1 the secant is the tangent
      svg.style.setProperty('--tangent', closeness.toFixed(3));
      svg.classList.toggle('is-tangent', h < 0.01);

      var n = EX.clamp(Math.ceil(-Math.log10(h)) + 1, 4, 6);
      out.dt.textContent = EX.fixed(h, n);
      out.ds.textContent = EX.fixed(s(t1) - s(T0), n);
      out.avg.textContent = EX.fixed(m, n);
      if (h < 0.01) formula.classList.add('is-revealed');
      input.setAttribute('aria-valuetext', 'Delta t equals ' + EX.fixed(h, n) + ' seconds; average velocity ' + EX.fixed(m, n) + ' metres per second');
    }

    function hToV(x) { return Math.log(x / HMIN) / Math.log(RATIO); }
    function vToH(v) { return HMIN * Math.pow(RATIO, v); }

    var cancel = null;
    function stop() { if (cancel) { cancel(); cancel = null; } }
    function animateTo(target, tau) {
      stop();
      cancel = EX.loop(function (dt) {
        if (target < h) h = Math.max(target, h * (EX.reduced ? 0 : Math.exp(-dt / tau)));
        else h = EX.approach(h, target, tau, dt);
        if (Math.abs(h - target) < 1e-7) h = target;
        input.value = hToV(h);
        render();
        if (h === target) { cancel = null; return false; }
        return true;
      });
    }

    input.addEventListener('input', function () { stop(); h = vToH(parseFloat(input.value)); render(); });
    shrinkBtn.addEventListener('click', function () { animateTo(HMIN, 0.42); });
    resetBtn.addEventListener('click', function () { animateTo(HMAX, 0.35); });
    plot.onResize(build);
  })();

  /* ================================================================
     02 — Area under a curve
     ================================================================ */
  (function area() {
    var root = document.querySelector('[data-app="area"]');
    if (!root) return;
    var f = function (x) { return x * x; };
    var B = 2, EXACT = 8 / 3;

    var svg = root.querySelector('[data-plot]');
    var group = root.querySelector('[data-n-group]');
    var lineEl = root.querySelector('[data-area-line]');
    var out = { rn: root.querySelector('[data-out="rn"]'), err: root.querySelector('[data-out="err"]') };

    var plot = new EX.Plot(svg, { x: [-0.2, 2.32], y: [-0.4, 4.5], pad: { t: 20, r: 24, b: 30, l: 34 } });
    var n = 4, heights = [], targets = [], visited = [], els = {}, ax = null;

    function exactSum(k) { return 4 * (k + 1) * (2 * k + 1) / (3 * k * k); }
    function setTargets() {
      targets = [];
      for (var k = 1; k <= n; k++) targets.push(f(k * B / n));
    }
    setTargets();
    heights = targets.slice();
    visited.push({ n: n, r: exactSum(n) });

    function build() {
      ax = plot.axes({ xTicks: [0.5, 1, 1.5, 2], yTicks: [1, 2, 3, 4], xLabel: '{x}', yLabel: '{y}',
        xFmt: function (v) { return String(v); } });
      var under = plot.layer('under'), main = plot.layer('main'), over = plot.layer('over');
      // gold: the exact region under the curve
      var d = 'M' + plot.X(0) + ' ' + plot.Y(0);
      for (var i = 0; i <= 120; i++) { var x = B * i / 120; d += 'L' + plot.X(x).toFixed(2) + ' ' + plot.Y(f(x)).toFixed(2); }
      d += 'L' + plot.X(B) + ' ' + plot.Y(0) + 'Z';
      EX.svg('path', { d: d, 'class': 'a-exact' }, under);
      els.rects = EX.svg('g', { 'class': 'a-rects' }, main);
      EX.svg('path', { 'class': 'p-fn', d: plot.fnPath(f, 0, 2.12) }, over);
      EX.mtext(over, plot.X(2.06) - 14, plot.Y(f(2.06)) + 6, '{f}({x}) = {x}^2', { 'class': 'p-var', 'text-anchor': 'end' });
      drawRects(true);
      buildLine();
    }

    function drawRects(rebuild) {
      if (!ax) return;
      if (rebuild || els.rects.childNodes.length !== n) {
        EX.empty(els.rects);
        for (var k = 0; k < n; k++) EX.svg('rect', null, els.rects);
      }
      var w = plot.X(B / n) - plot.X(0);
      var strokeOp = EX.clamp(1.15 - n / 56, 0.18, 1);
      els.rects.style.setProperty('--stroke-op', strokeOp);
      for (var j = 0; j < n; j++) {
        var top = plot.Y(heights[j]);
        EX.set(els.rects.childNodes[j], { x: (plot.X(0) + j * w).toFixed(2), y: top.toFixed(2), width: w.toFixed(2), height: Math.max(0, ax.xa - top).toFixed(2) });
      }
      var sum = 0;
      for (var q = 0; q < n; q++) sum += heights[q] * (B / n);
      out.rn.textContent = EX.fixed(sum, 4);
      out.err.textContent = EX.fixed(sum - EXACT, 4);
      renderLine(sum);
    }

    /* number line: where Rₙ sits relative to 8/3 */
    var line = { svg: null, x0: 2.55, x1: 3.85 };
    function buildLine() {
      EX.empty(lineEl);
      var W = lineEl.clientWidth || 400, H = lineEl.clientHeight || 54;
      var g = EX.svg('svg', { viewBox: '0 0 ' + W + ' ' + H }, lineEl);
      line.svg = g; line.W = W; line.H = H;
      line.X = function (v) { return 8 + (v - line.x0) / (line.x1 - line.x0) * (W - 16); };
      var y = 30;
      line.y = y;
      EX.svg('line', { x1: 0, x2: W, y1: y + 0.5, y2: y + 0.5, 'class': 'nl-axis' }, g);
      [3, 3.5].forEach(function (v) {
        EX.svg('line', { x1: line.X(v), x2: line.X(v), y1: y - 4, y2: y + 4, 'class': 'nl-axis' }, g);
        EX.mtext(g, line.X(v), y + 20, EX.fixed(v, 1), { 'class': 'p-text', 'text-anchor': 'middle' });
      });
      EX.svg('line', { x1: line.X(EXACT), x2: line.X(EXACT), y1: y - 9, y2: y + 9, 'class': 'nl-limit' }, g);
      EX.mtext(g, line.X(EXACT), y + 21, '8/3', { 'class': 'p-limit-text', 'text-anchor': 'middle' });
      line.trail = EX.svg('g', null, g);
      line.mark = EX.svg('circle', { r: 5, cy: y, 'class': 'p-point' }, g);
    }
    function renderLine(sum) {
      if (!line.svg) return;
      EX.empty(line.trail);
      var lastLabel = -1e9;
      visited.slice().sort(function (a, b) { return b.r - a.r; }).forEach(function (v) {
        var x = line.X(v.r);
        EX.svg('line', { x1: x, x2: x, y1: line.y - 6, y2: line.y + 6, 'class': 'nl-trail' }, line.trail);
        if (x - lastLabel > 22 || lastLabel === -1e9) {
          var t = EX.svg('text', { x: x, y: line.y - 12, 'text-anchor': 'middle', 'class': 'nl-n' }, line.trail);
          t.textContent = v.n;
          lastLabel = x;
        }
      });
      EX.set(line.mark, { cx: line.X(sum) });
    }

    var cancel = null;
    function setN(next) {
      if (next === n) return;
      // new rectangles start at the height of the old step function, then settle
      var oldN = n, old = heights.slice();
      n = next;
      setTargets();
      heights = [];
      for (var k = 0; k < n; k++) {
        var mid = (k + 0.5) * B / n;
        var idx = Math.min(oldN - 1, Math.floor(mid / (B / oldN)));
        heights.push(old[idx]);
      }
      if (!visited.some(function (v) { return v.n === n; })) visited.push({ n: n, r: exactSum(n) });
      group.querySelectorAll('[data-n]').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.n === n)); });
      if (cancel) cancel();
      drawRects(true);
      cancel = EX.loop(function (dt) {
        var done = true;
        for (var j = 0; j < n; j++) {
          heights[j] = EX.approach(heights[j], targets[j], 0.24, dt);
          if (Math.abs(heights[j] - targets[j]) > 1e-5) done = false; else heights[j] = targets[j];
        }
        drawRects(false);
        if (done) { cancel = null; return false; }
        return true;
      });
      EX.announce(n + ' rectangles. Estimate ' + EX.fixed(exactSum(n), 4) + ', error ' + EX.fixed(exactSum(n) - EXACT, 4));
    }

    group.addEventListener('click', function (e) {
      var b = e.target.closest('[data-n]');
      if (b) setN(+b.dataset.n);
    });
    plot.onResize(build);
    if (window.ResizeObserver) new ResizeObserver(function () { if (ax) { buildLine(); drawRects(false); } }).observe(lineEl);
  })();

  /* ================================================================
     03 — Continuous change: small multiples
     ================================================================ */
  (function multiples() {
    var list = document.querySelector('[data-multiples]');
    if (!list) return;

    var kinds = {
      temperature: { t: [0, 8], y: [12, 86], f: function (t) { return 22 + 58 * Math.exp(-t / 1.5); }, limit: 22, label: '22 °C' },
      motion: { t: [0, 10], y: [-1.15, 1.15], f: function (t) { return Math.exp(-t / 2.2) * Math.cos(2.7 * t); }, limit: 0, label: '0' },
      growth: { t: [0, 10], y: [-0.05, 1.18], f: function (t) { return 1 / (1 + 24 * Math.exp(-0.95 * t)); }, limit: 1, label: 'K' },
      signal: { t: [0, 1], y: [-1.25, 1.25], f: function (t) { return 0.62 * Math.sin(2 * Math.PI * 2 * t) + 0.38 * Math.sin(2 * Math.PI * 5 * t + 0.6); } }
    };

    list.querySelectorAll('.multiple').forEach(function (li) {
      var kind = li.dataset.kind, k = kinds[kind];
      var svg = li.querySelector('svg');
      var progress = EX.reduced ? 1 : 0, samples = EX.reduced ? 96 : 6, started = false;
      var curvePath = null, len = 0;

      function sx(W, t) { return 4 + (t - k.t[0]) / (k.t[1] - k.t[0]) * (W - 8); }
      function sy(H, y) { return H - 6 - (y - k.y[0]) / (k.y[1] - k.y[0]) * (H - 14); }

      function draw() {
        var W = Math.round(svg.getBoundingClientRect().width), H = Math.round(svg.getBoundingClientRect().height);
        if (!W || !H) return;
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        EX.empty(svg);
        var i, t, d = '';
        if (kind === 'signal') {
          // gold: the continuous signal (the limit); teal: what the samples trace
          for (i = 0; i <= 240; i++) { t = i / 240; d += (i ? 'L' : 'M') + sx(W, t).toFixed(1) + ' ' + sy(H, k.f(t)).toFixed(1); }
          EX.svg('line', { x1: 0, x2: W, y1: sy(H, 0), y2: sy(H, 0), 'class': 'm-base' }, svg);
          EX.svg('path', { d: d, 'class': 'm-limit', fill: 'none' }, svg);
          var pd = '';
          for (i = 0; i <= samples; i++) {
            t = i / samples;
            var X = sx(W, t), Y = sy(H, k.f(t));
            pd += (i ? 'L' : 'M') + X.toFixed(1) + ' ' + Y.toFixed(1);
            if (samples <= 48) EX.svg('line', { x1: X, x2: X, y1: sy(H, 0), y2: Y, 'class': 'm-stem' }, svg);
            EX.svg('circle', { cx: X, cy: Y, r: samples > 48 ? 1.3 : 2.2, 'class': 'm-sample' }, svg);
          }
          EX.svg('path', { d: pd, 'class': 'm-curve m-curve--approach' }, svg);
          var tx = EX.svg('text', { x: W - 2, y: 12, 'text-anchor': 'end', 'class': 'm-limit-text' }, svg);
          tx.textContent = samples + ' samples';
          return;
        }
        EX.svg('line', { x1: 0, x2: W, y1: H - 0.5, y2: H - 0.5, 'class': 'm-base' }, svg);
        var ly = sy(H, k.limit);
        EX.svg('line', { x1: 0, x2: W, y1: ly, y2: ly, 'class': 'm-limit' }, svg);
        var lt = EX.svg('text', { x: W - 2, y: ly - 6, 'text-anchor': 'end', 'class': 'm-limit-text' }, svg);
        lt.textContent = k.label;
        for (i = 0; i <= 200; i++) { t = k.t[0] + (k.t[1] - k.t[0]) * i / 200; d += (i ? 'L' : 'M') + sx(W, t).toFixed(1) + ' ' + sy(H, k.f(t)).toFixed(1); }
        curvePath = EX.svg('path', { d: d, 'class': 'm-curve' }, svg);
        len = curvePath.getTotalLength();
        paint();
      }
      function paint() {
        if (!curvePath) return;
        curvePath.style.strokeDasharray = len + ' ' + len;
        curvePath.style.strokeDashoffset = (len * (1 - progress)).toFixed(1);
      }

      function start() {
        if (started) return;
        started = true;
        if (EX.reduced) { progress = 1; samples = 96; draw(); return; }
        if (kind === 'signal') {
          var timer = setInterval(function () {
            samples *= 2;
            draw();
            if (samples >= 96) clearInterval(timer);
          }, 750);
          return;
        }
        EX.loop(function (dt) {
          progress = EX.approach(progress, 1, 0.55, dt);
          if (1 - progress < 0.0005) progress = 1;
          paint();
          return progress < 1;
        });
      }

      if (window.ResizeObserver) new ResizeObserver(draw).observe(svg);
      draw();
      EX.onEnter(li, start, 0.5);
    });
  })();
})();
