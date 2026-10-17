/* =====================================================================
   Chapter 04 — Limits in computer science
   ---------------------------------------------------------------------
   • Algorithm analysis: an n × n square holds n² operations; a strip of
     width log₂n inside it holds n·log₂n. The strip's share of the square
     is (n log₂ n)/n² = (log₂ n)/n → 0.
   • Numerical methods: x_{k+1} = (x_k + 2)/2, x₁ = 3, error 1/2^(k−1).
   • Machine learning: gradient descent on L(w) = 0.2 + 0.3(w − 3)².
   • Graphics: a mesh refined 3 → 48 approaches a smooth surface.
   ===================================================================== */
(function () {
  'use strict';
  var EX = window.EX;

  function sizeOf(svg) {
    var r = svg.getBoundingClientRect();
    var W = Math.round(r.width), H = Math.round(r.height);
    if (W && H) svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    return { W: W, H: H };
  }

  /* ================================================================
     Algorithm analysis — n log₂ n versus n²
     ================================================================ */
  (function algorithms() {
    var input = document.querySelector('[data-n-input]');
    if (!input) return;
    var sq = document.querySelector('[data-square]');
    var rp = document.querySelector('[data-ratio]');
    var out = {};
    ['n', 'nlogn', 'n2', 'ratio'].forEach(function (k) { out[k] = document.querySelector('[data-out="' + k + '"]'); });

    var target = +input.value, shown = target;
    var S = {}, R = {};

    /* ---- the square ---- */
    function buildSquare() {
      var s = sizeOf(sq);
      if (!s.W) return;
      EX.empty(sq);
      var side = Math.min(s.W, s.H) - 34;
      var x0 = Math.round((s.W - side) / 2) + 0.5, y0 = 26.5;
      S = { x0: x0, y0: y0, side: side };
      S.title = EX.svg('text', { x: x0, y: 14, 'class': 'sq-text' }, sq);
      S.frame = EX.svg('rect', { x: x0, y: y0, width: side, height: side, 'class': 'sq-frame' }, sq);
      S.cells = EX.svg('g', { 'class': 'sq-cell' }, sq);
      S.strip = EX.svg('rect', { x: x0, y: y0, height: side, 'class': 'sq-strip' }, sq);
      S.leader = EX.svg('path', { 'class': 'sq-leader' }, sq);
      S.label = EX.svg('text', { 'class': 'sq-text sq-text--approach' }, sq);
      S.share = EX.svg('text', { 'class': 'sq-text sq-text--approach' }, sq);
      renderSquare();
    }
    function renderSquare() {
      if (!S.side) return;
      var u = shown, n = Math.pow(2, u), ratio = u / n;
      var w = Math.max(1, S.side * ratio);
      EX.set(S.strip, { width: w });
      // the grid of n × n cells, visible while n is small enough to count
      EX.empty(S.cells);
      var vis = EX.clamp((64 - n) / 40, 0, 1);
      if (vis > 0) {
        S.cells.setAttribute('opacity', vis);
        var step = S.side / n, d = '';
        for (var i = 1; i < n; i++) {
          var p = (i * step).toFixed(2);
          d += 'M' + (S.x0 + +p) + ' ' + S.y0 + 'v' + S.side + 'M' + S.x0 + ' ' + (S.y0 + +p) + 'h' + S.side;
        }
        EX.svg('path', { d: d }, S.cells);
      }
      var nInt = Math.pow(2, target);
      S.title.textContent = 'n² = ' + EX.commas(nInt * nInt);
      var lx = S.x0 + w + 12, ly = S.y0 + 22;
      var narrow = w < 46;
      EX.set(S.label, { x: narrow ? lx + 16 : lx, y: ly });
      EX.set(S.share, { x: narrow ? lx + 16 : lx, y: ly + 17 });
      S.label.textContent = 'n log₂n = ' + EX.commas(nInt * target);
      S.share.textContent = shareText(target / nInt) + ' of the square';
      EX.set(S.leader, { d: narrow ? 'M' + (S.x0 + w + 2) + ' ' + (ly - 4) + 'h' + 22 : '', opacity: narrow ? 1 : 0 });
    }
    function shareText(r) {
      var pct = r * 100;
      if (pct >= 10) return pct.toFixed(1) + '%';
      if (pct >= 0.1) return pct.toFixed(2) + '%';
      return pct.toPrecision(2) + '%';
    }

    /* ---- the ratio curve ---- */
    function buildRatio() {
      var s = sizeOf(rp);
      if (!s.W) return;
      EX.empty(rp);
      var pl = 36, pr = 14, pt = 26, pb = 30;
      R = {
        X: function (u) { return pl + (u - 1) / 19.5 * (s.W - pl - pr); },
        Y: function (v) { return s.H - pb - v / 0.56 * (s.H - pt - pb); },
        W: s.W, H: s.H
      };
      var g = EX.svg('g', { 'class': 'p-grid' }, rp);
      [0.25, 0.5].forEach(function (v) { EX.svg('line', { x1: R.X(1), x2: R.X(20.5), y1: Math.round(R.Y(v)) + 0.5, y2: Math.round(R.Y(v)) + 0.5 }, g); });
      var ax = EX.svg('g', null, rp);
      EX.svg('path', { d: 'M' + R.X(1) + ' ' + (Math.round(R.Y(0)) + 0.5) + 'H' + R.X(20.5), 'class': 'p-axis' }, ax);
      EX.svg('path', { d: 'M' + (Math.round(R.X(1)) + 0.5) + ' ' + R.Y(0) + 'V' + R.Y(0.56), 'class': 'p-axis' }, ax);
      [1, 5, 10, 15, 20].forEach(function (u) {
        EX.mtext(ax, R.X(u), R.Y(0) + 19, '2^' + u, { 'class': 'p-text', 'text-anchor': 'middle' });
      });
      [0.25, 0.5].forEach(function (v) {
        EX.mtext(ax, R.X(1) - 7, R.Y(v) + 4, String(v), { 'class': 'p-text', 'text-anchor': 'end' });
      });
      EX.mtext(ax, R.X(1), 13, 'ratio  {n} log_2{n} / {n}^2', { 'class': 'sq-text', 'text-anchor': 'start' });
      EX.svg('line', { x1: R.X(1), x2: R.X(20.5), y1: R.Y(0) - 0.5, y2: R.Y(0) - 0.5, 'class': 'p-limit-line' }, ax);
      EX.mtext(ax, R.X(20.5), R.Y(0) - 8, '→ 0', { 'class': 'p-limit-text', 'text-anchor': 'end' });
      var d = '';
      for (var i = 0; i <= 400; i++) {
        var u = 1 + 19.5 * i / 400;
        d += (i ? 'L' : 'M') + R.X(u).toFixed(2) + ' ' + R.Y(u / Math.pow(2, u)).toFixed(2);
      }
      EX.svg('path', { d: d, 'class': 'p-fn' }, rp);
      R.drop = EX.svg('line', { 'class': 'p-drop' }, rp);
      R.halo = EX.svg('circle', { 'class': 'p-point-halo', r: 12 }, rp);
      R.dot = EX.svg('circle', { 'class': 'p-point', r: 5 }, rp);
      renderRatio();
    }
    function renderRatio() {
      if (!R.X) return;
      var u = shown, x = R.X(u), y = R.Y(u / Math.pow(2, u));
      EX.set(R.dot, { cx: x, cy: y });
      EX.set(R.halo, { cx: x, cy: y });
      EX.set(R.drop, { x1: x, x2: x, y1: y, y2: R.Y(0) });
    }

    function renderTable() {
      var u = target, n = Math.pow(2, u);
      out.n.textContent = EX.commas(n);
      out.nlogn.textContent = EX.commas(n * u);
      out.n2.textContent = EX.commas(n * n);
      out.ratio.textContent = (u / n).toFixed(7);
      input.setAttribute('aria-valuetext', 'n equals ' + EX.commas(n) + '; ratio ' + (u / n).toPrecision(3));
    }

    var running = false;
    function animate() {
      if (running) return;
      running = true;
      EX.loop(function (dt) {
        shown = EX.approach(shown, target, 0.16, dt);
        if (Math.abs(shown - target) < 0.0005) shown = target;
        renderSquare();
        renderRatio();
        if (shown === target) { running = false; return false; }
        return true;
      });
    }

    input.addEventListener('input', function () {
      target = +input.value;
      renderTable();
      animate();
    });
    renderTable();
    if (window.ResizeObserver) {
      new ResizeObserver(buildSquare).observe(sq);
      new ResizeObserver(buildRatio).observe(rp);
    }
    buildSquare();
    buildRatio();
  })();

  /* ================================================================
     Numerical methods — a sequence that converges to 2
     ================================================================ */
  (function sequence() {
    var svg = document.querySelector('[data-seq-line]');
    if (!svg) return;
    var list = document.querySelector('[data-seq-list]');
    var replay = document.querySelector('[data-seq-replay]');
    var K = 8;
    var terms = [];
    for (var k = 1; k <= K; k++) terms.push(2 + Math.pow(2, -(k - 1)));   // 3, 2.5, 2.25, …

    // the list: exact binary fractions, so every digit is honest
    function fmt(v) { return String(+v.toFixed(10)); }
    terms.forEach(function (x, i) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="k">x<sub>' + (i + 1) + '</sub></span><span>' + fmt(x) + '</span><span class="e">' + fmt(x - 2) + '</span>';
      list.appendChild(li);
    });
    var limitLi = document.createElement('li');
    limitLi.className = 'is-limit';
    limitLi.innerHTML = '<span class="k">⋮</span><span>→ 2</span><span class="e">→ 0</span>';
    list.appendChild(limitLi);
    var head = document.createElement('li');
    head.className = 'seq__head is-in';
    head.setAttribute('aria-hidden', 'true');
    head.innerHTML = '<span class="k">k</span><span>x<sub>k</sub></span><span class="e">|x<sub>k</sub> − 2|</span>';
    list.insertBefore(head, list.firstChild);
    var rows = Array.prototype.slice.call(list.querySelectorAll('li:not(.seq__head)'));

    var G = {}, shownCount = 0, hop = null, timer = 0;
    var X0 = 1.86, X1 = 3.1;

    function build() {
      var s = sizeOf(svg);
      if (!s.W) return;
      EX.empty(svg);
      var base = s.H - 34;
      G = { W: s.W, H: s.H, base: base, X: function (v) { return 10 + (v - X0) / (X1 - X0) * (s.W - 20); } };
      EX.svg('line', { x1: 0, x2: s.W, y1: base + 0.5, y2: base + 0.5, 'class': 'p-axis' }, svg);
      [2.5, 3].forEach(function (v) {
        EX.svg('line', { x1: G.X(v), x2: G.X(v), y1: base - 4, y2: base + 4, 'class': 'p-axis' }, svg);
      });
      EX.svg('line', { x1: G.X(2), x2: G.X(2), y1: base - 10, y2: base + 10, 'class': 'nl-limit' }, svg);
      EX.mtext(svg, G.X(2), base + 22, '2', { 'class': 'p-limit-text', 'text-anchor': 'middle' });
      G.arcs = EX.svg('g', null, svg);
      G.dots = EX.svg('g', null, svg);
      G.labels = EX.svg('g', null, svg);
      G.mover = EX.svg('circle', { r: 5, 'class': 's-point', opacity: 0 }, svg);
      paint();
    }

    function arcPath(a, b) {
      var xa = G.X(a), xb = G.X(b), hgt = Math.min(G.base - 14, Math.max(8, Math.abs(xb - xa) * 0.55));
      return { xa: xa, xb: xb, cy: G.base - hgt * 2, d: 'M' + xa + ' ' + G.base + 'Q' + ((xa + xb) / 2) + ' ' + (G.base - hgt * 2) + ' ' + xb + ' ' + G.base };
    }

    function paint() {
      if (!G.W) return;
      EX.empty(G.arcs); EX.empty(G.dots); EX.empty(G.labels);
      for (var i = 0; i < shownCount; i++) {
        if (i > 0) EX.svg('path', { d: arcPath(terms[i - 1], terms[i]).d, 'class': 's-hop' }, G.arcs);
        var current = i === shownCount - 1 && !hop;
        EX.svg('circle', { cx: G.X(terms[i]), cy: G.base, r: current ? 5 : 3.6, 'class': current ? 's-point' : 's-point s-point--old' }, G.dots);
        if (i < 3) EX.mtext(G.labels, G.X(terms[i]), G.base + 22, '{x}_' + (i + 1), { 'class': 's-label', 'text-anchor': 'middle' });
      }
      if (hop) {
        var a = arcPath(terms[hop.i - 1], terms[hop.i]), t = hop.p;
        var mx = (1 - t) * (1 - t) * a.xa + 2 * (1 - t) * t * ((a.xa + a.xb) / 2) + t * t * a.xb;
        var my = (1 - t) * (1 - t) * G.base + 2 * (1 - t) * t * a.cy + t * t * G.base;
        EX.set(G.mover, { cx: mx, cy: my, opacity: 1 });
        var partial = EX.svg('path', { d: a.d, 'class': 's-hop' }, G.arcs);
        var len = partial.getTotalLength();
        partial.style.strokeDasharray = len;
        partial.style.strokeDashoffset = len * (1 - t);
      } else if (G.mover) {
        G.mover.setAttribute('opacity', 0);
      }
    }

    function showRow(i) { if (rows[i]) rows[i].classList.add('is-in'); }

    function play() {
      clearTimeout(timer);
      shownCount = 0; hop = null;
      rows.forEach(function (r) { r.classList.remove('is-in'); });
      if (EX.reduced) {
        shownCount = K; rows.forEach(function (r) { r.classList.add('is-in'); }); paint(); return;
      }
      var next = function () {
        if (shownCount === 0) { shownCount = 1; showRow(0); paint(); timer = setTimeout(next, 700); return; }
        if (shownCount >= K) { showRow(K); return; }
        hop = { i: shownCount, p: 0 };
        EX.loop(function (dt) {
          if (!hop) return false;
          hop.p = EX.approach(hop.p, 1, 0.11, dt);
          if (1 - hop.p < 0.01) {
            hop = null; shownCount++; showRow(shownCount - 1); paint();
            timer = setTimeout(next, shownCount < 4 ? 420 : 300);
            return false;
          }
          paint();
          return true;
        });
      };
      next();
    }

    if (window.ResizeObserver) new ResizeObserver(build).observe(svg);
    build();
    EX.onEnter(svg, play, 0.6);
    replay.addEventListener('click', play);
  })();

  /* ================================================================
     Machine learning — gradient descent toward a minimum
     ================================================================ */
  (function learning() {
    var svg = document.querySelector('[data-ml-plot]');
    if (!svg) return;
    var spark = document.querySelector('[data-ml-spark]');
    var replay = document.querySelector('[data-ml-replay]');
    var outIter = document.querySelector('[data-out="iter"]');
    var outLoss = document.querySelector('[data-out="loss"]');

    var Lmin = 0.2, Wstar = 3, ETA = 0.6, W0 = -0.6, K = 16;
    var loss = function (w) { return Lmin + 0.3 * (w - Wstar) * (w - Wstar); };
    var grad = function (w) { return 0.6 * (w - Wstar); };
    var path = [W0];
    for (var k = 0; k < K; k++) path.push(path[k] - ETA * grad(path[k]));

    var P = {}, Q = {}, iter = 0, wShown = W0, timer = 0, cancel = null;

    function build() {
      var s = sizeOf(svg);
      if (!s.W) return;
      EX.empty(svg);
      var pl = 18, pr = 12, pt = 22, pb = 26;
      P = { X: function (w) { return pl + (w + 1) / 7.4 * (s.W - pl - pr); }, Y: function (l) { return s.H - pb - l / 5.5 * (s.H - pt - pb); }, W: s.W, H: s.H };
      EX.svg('path', { d: 'M' + pl + ' ' + (P.Y(0) + 0.5) + 'H' + (s.W - pr) + 'M' + (pl + 0.5) + ' ' + P.Y(0) + 'V' + (pt - 4), 'class': 'p-axis' }, svg);
      var ty = EX.svg('text', { x: pl + 8, y: pt - 6, 'class': 'ml-axis-label' }, svg); ty.textContent = 'Loss';
      EX.mtext(svg, s.W - pr, P.Y(0) + 19, 'parameter {w}', { 'class': 'p-text', 'text-anchor': 'end' });
      EX.svg('line', { x1: pl, x2: s.W - pr, y1: P.Y(Lmin), y2: P.Y(Lmin), 'class': 'p-limit-line' }, svg);
      var tm = EX.svg('text', { x: s.W - pr, y: P.Y(Lmin) - 7, 'text-anchor': 'end', 'class': 'p-limit-text' }, svg); tm.textContent = 'minimum';
      var d = '';
      for (var i = 0; i <= 200; i++) { var w = -1 + 7.4 * i / 200, l = loss(w); if (l > 5.4) continue; d += (d ? 'L' : 'M') + P.X(w).toFixed(2) + ' ' + P.Y(l).toFixed(2); }
      EX.svg('path', { d: d, 'class': 'p-fn' }, svg);
      P.steps = EX.svg('g', null, svg);
      P.halo = EX.svg('circle', { 'class': 'p-point-halo', r: 13 }, svg);
      P.dot = EX.svg('circle', { 'class': 'p-point', r: 5.5 }, svg);
      buildSpark();
      paint();
    }
    function buildSpark() {
      var s = sizeOf(spark);
      if (!s.W) return;
      EX.empty(spark);
      var pl = 18, pr = 12, pt = 14, pb = 18;
      Q = { X: function (k) { return pl + k / K * (s.W - pl - pr); }, Y: function (l) { return s.H - pb - l / 4.3 * (s.H - pt - pb); } };
      EX.svg('path', { d: 'M' + pl + ' ' + (Q.Y(0) + 0.5) + 'H' + (s.W - pr) + 'M' + (pl + 0.5) + ' ' + Q.Y(0) + 'V' + (pt - 4), 'class': 'p-axis' }, spark);
      EX.svg('line', { x1: pl, x2: s.W - pr, y1: Q.Y(Lmin), y2: Q.Y(Lmin), 'class': 'p-limit-line' }, spark);
      var a = EX.svg('text', { x: s.W - pr, y: s.H - 2, 'text-anchor': 'end', 'class': 'ml-axis-label' }, spark); a.textContent = 'Iteration';
      var b = EX.svg('text', { x: pl + 8, y: pt - 2, 'class': 'ml-axis-label' }, spark); b.textContent = 'Loss';
      Q.line = EX.svg('path', { 'class': 'ml-step' }, spark);
      Q.dots = EX.svg('g', null, spark);
    }

    function paint() {
      if (!P.X) return;
      EX.empty(P.steps);
      for (var i = 0; i <= iter; i++) {
        var w = i === iter ? wShown : path[i];
        if (i > 0) EX.svg('line', { x1: P.X(path[i - 1]), y1: P.Y(loss(path[i - 1])), x2: P.X(w), y2: P.Y(loss(w)), 'class': 'ml-step' }, P.steps);
        if (i < iter) EX.svg('circle', { cx: P.X(path[i]), cy: P.Y(loss(path[i])), r: 3.2, 'class': 'ml-dot--old' }, P.steps);
        if (i < 3 && i < iter) {
          var t = EX.svg('text', { x: P.X(path[i]) + 9, y: P.Y(loss(path[i])) + 4, 'class': 'sq-text' }, P.steps);
          t.textContent = String(i);
        }
      }
      EX.set(P.dot, { cx: P.X(wShown), cy: P.Y(loss(wShown)) });
      EX.set(P.halo, { cx: P.X(wShown), cy: P.Y(loss(wShown)) });
      if (Q.X) {
        EX.empty(Q.dots);
        var d = '';
        for (var j = 0; j <= iter; j++) {
          var lj = loss(path[j]);
          d += (j ? 'L' : 'M') + Q.X(j).toFixed(2) + ' ' + Q.Y(lj).toFixed(2);
          EX.svg('circle', { cx: Q.X(j), cy: Q.Y(lj), r: j === iter ? 3.4 : 2.2, 'class': j === iter ? 'ml-dot' : 'ml-dot--old' }, Q.dots);
        }
        Q.line.setAttribute('d', d);
      }
      outIter.textContent = String(iter);
      outLoss.textContent = EX.fixed(loss(wShown), 4);
    }

    function play() {
      clearTimeout(timer);
      if (cancel) { cancel(); cancel = null; }
      iter = 0; wShown = W0;
      if (EX.reduced) { iter = K; wShown = path[K]; paint(); return; }
      paint();
      var step = function () {
        if (iter >= K) return;
        iter++;
        var target = path[iter];
        cancel = EX.loop(function (dt) {
          wShown = EX.approach(wShown, target, 0.11, dt);
          if (Math.abs(P.X(wShown) - P.X(target)) < 0.3) {
            wShown = target; paint(); cancel = null;
            timer = setTimeout(step, iter < 5 ? 380 : 220);
            return false;
          }
          paint();
          return true;
        });
      };
      timer = setTimeout(step, 400);
    }

    if (window.ResizeObserver) { new ResizeObserver(build).observe(svg); new ResizeObserver(function () { buildSpark(); paint(); }).observe(spark); }
    build();
    EX.onEnter(svg, play, 0.6);
    replay.addEventListener('click', play);
  })();

  /* ================================================================
     Computer graphics — mesh refinement
     ================================================================ */
  (function graphics() {
    var svg = document.querySelector('[data-mesh]');
    if (!svg) return;
    var replay = document.querySelector('[data-mesh-replay]');
    var outMesh = document.querySelector('[data-out="mesh"]');
    var LEVELS = [3, 6, 12, 24, 48];
    var level = EX.reduced ? LEVELS.length - 1 : 0, timer = 0;

    var z = function (x, y) {
      return 1.3 * Math.exp(-((x - 0.7) * (x - 0.7) + (y - 0.5) * (y - 0.5)) / 1.7)
           + 0.75 * Math.exp(-((x + 1.3) * (x + 1.3) + (y + 1.1) * (y + 1.1)) / 1.1);
    };
    var TH = 0.62, C = Math.cos(TH), Sn = Math.sin(TH);
    function project(x, y) {
      var xr = x * C - y * Sn, yr = x * Sn + y * C;
      return { x: xr, y: yr * 0.52 - z(x, y) * 0.95, depth: yr };
    }

    function draw() {
      var s = sizeOf(svg);
      if (!s.W) return;
      EX.empty(svg);
      // fit the projected surface into the box
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (var i = 0; i <= 24; i++) for (var j = 0; j <= 24; j++) {
        var p = project(-3 + 6 * i / 24, -3 + 6 * j / 24);
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      var sc = Math.min((s.W - 20) / (maxX - minX), (s.H - 20) / (maxY - minY));
      var ox = (s.W - (maxX - minX) * sc) / 2 - minX * sc, oy = (s.H - (maxY - minY) * sc) / 2 - minY * sc;
      var N = LEVELS[level];
      var line = function (fixed, isU) {
        var d = '', depth = 0;
        for (var k = 0; k <= N; k++) {
          var t = -3 + 6 * k / N, q = isU ? project(fixed, t) : project(t, fixed);
          d += (k ? 'L' : 'M') + (ox + q.x * sc).toFixed(1) + ' ' + (oy + q.y * sc).toFixed(1);
          depth += q.depth;
        }
        var path = EX.svg('path', { d: d }, svg);
        if (depth / (N + 1) < -0.6) path.setAttribute('class', 'mesh-far');
      };
      for (var a = 0; a <= N; a++) { var f = -3 + 6 * a / N; line(f, true); line(f, false); }
      outMesh.textContent = N + ' × ' + N;
    }

    function play() {
      clearTimeout(timer);
      if (EX.reduced) { level = LEVELS.length - 1; draw(); return; }
      level = 0; draw();
      var next = function () {
        if (level >= LEVELS.length - 1) return;
        level++; draw();
        timer = setTimeout(next, 850);
      };
      timer = setTimeout(next, 900);
    }

    if (window.ResizeObserver) new ResizeObserver(draw).observe(svg);
    draw();
    EX.onEnter(svg, play, 0.5);
    replay.addEventListener('click', play);
  })();
})();
