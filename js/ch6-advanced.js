/* =====================================================================
   Chapter 06 — Advanced / optional
   ---------------------------------------------------------------------
   ε–δ for f(x) = 2x + 1 at a = 2, L = 5.
   |f(x) − 5| = 2|x − 2|, so δ = ε/2 is the largest δ that works.
   The reader can also choose δ by hand: if δ > ε/2 the part of the
   graph that escapes the ε-band is drawn as a counterexample.
   ===================================================================== */
(function () {
  'use strict';
  var EX = window.EX;
  var root = document.getElementById('ch6');
  if (!root) return;

  var A = 2, L = 5, XLO = 0, XHI = 4;
  var f = function (x) { return 2 * x + 1; };

  var svg = root.querySelector('[data-plot]');
  var epsIn = root.querySelector('[data-eps-input]');
  var delIn = root.querySelector('[data-del-input]');
  var autoIn = root.querySelector('[data-auto-delta]');
  var out = {};
  ['eps', 'del', 'px', 'py'].forEach(function (k) { out[k] = root.querySelector('[data-out="' + k + '"]'); });
  var cmpX = root.querySelector('[data-cmp="x"]');
  var cmpY = root.querySelector('[data-cmp="y"]');
  var verdict = root.querySelector('[data-verdict]');

  var plot = new EX.Plot(svg, { x: [-0.25, 4.35], y: [-0.5, 9.7], pad: { t: 26, r: 24, b: 30, l: 34 } });
  svg.classList.add('plot--draggable');
  svg.setAttribute('tabindex', '0');

  var st = { eps: 1, del: 0.5, epsShown: 1, delShown: 0.5, probe: 2.3, auto: true };
  var els = {}, ax = null;

  function build() {
    ax = plot.axes({
      xTicks: [1, 2, 3, 4],
      yTicks: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      xFmt: function (v) { return v === A ? '' : String(v); },
      yFmt: function (v) { return v === L ? '' : String(v); },
      xLabel: '{x}',
      yLabel: '{y}'
    });
    var under = plot.layer('under'), main = plot.layer('main'), over = plot.layer('over'), ui = plot.layer('ui');
    var clip = plot.clipId();

    // ε-band: a fine gold hatch, so it never blends with the solid teal δ-band
    var pat = EX.svg('pattern', { id: 'eps-hatch', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, EX.svg('defs', null, under));
    EX.svg('line', { x1: 0, y1: 0, x2: 0, y2: 7, 'class': 'e-hatch' }, pat);
    els.epsBand = EX.svg('rect', { 'class': 'e-band-eps' }, under);
    els.epsHatch = EX.svg('rect', { fill: 'url(#eps-hatch)' }, under);
    els.delBand = EX.svg('rect', { 'class': 'e-band-del' }, under);
    els.epsHi = EX.svg('line', { 'class': 'e-edge-eps' }, under);
    els.epsLo = EX.svg('line', { 'class': 'e-edge-eps' }, under);
    els.delLo = EX.svg('line', { 'class': 'e-edge-del' }, under);
    els.delHi = EX.svg('line', { 'class': 'e-edge-del' }, under);

    EX.svg('path', { 'class': 'p-fn p-fn--soft', d: plot.fnPath(f, -0.25, 4.35, 2), 'clip-path': clip }, main);
    els.box = EX.svg('rect', { 'class': 'e-box' }, main);
    els.segOk = EX.svg('line', { 'class': 'e-seg-ok' }, main);
    els.segNoL = EX.svg('line', { 'class': 'e-seg-no' }, main);
    els.segNoR = EX.svg('line', { 'class': 'e-seg-no' }, main);
    EX.keepInside(EX.mtext(main, plot.X(3.62) + 10, plot.Y(f(3.62)) + 18, '{f}({x}) = 2{x} + 1', { 'class': 'p-var' }), plot.W);

    EX.mtext(ui, plot.X(A), ax.xa + 19, '2', { 'class': 'p-limit-text', 'text-anchor': 'middle' });
    EX.mtext(ui, ax.ya - 9, plot.Y(L) + 5, '5', { 'class': 'p-limit-text', 'text-anchor': 'end' });
    els.lEpsHi = EX.mtext(ui, 0, 0, '{L} + ε', { 'class': 'e-label-eps', 'text-anchor': 'end' });
    els.lEpsLo = EX.mtext(ui, 0, 0, '{L} − ε', { 'class': 'e-label-eps', 'text-anchor': 'end' });
    els.lDelLo = EX.mtext(ui, 0, 0, '{a} − δ', { 'class': 'e-label-del', 'text-anchor': 'end' });
    els.lDelHi = EX.mtext(ui, 0, 0, '{a} + δ', { 'class': 'e-label-del', 'text-anchor': 'start' });

    els.dropX = EX.svg('line', { 'class': 'e-probe-drop' }, over);
    els.dropY = EX.svg('line', { 'class': 'e-probe-drop' }, over);
    EX.svg('circle', { 'class': 'p-limit-dot', cx: plot.X(A), cy: plot.Y(L), r: 4.5 }, over);
    els.halo = EX.svg('circle', { 'class': 'e-probe-halo', r: 15 }, over);
    els.probe = EX.svg('circle', { 'class': 'e-probe', r: 7 }, over);
    render();
  }

  function render() {
    if (!ax) return;
    var e = st.epsShown, d = st.delShown;
    var top = plot.py1, bot = ax.xa, left = plot.px0, right = plot.px1;
    var yHi = plot.Y(L + e), yLo = plot.Y(L - e), xLo = plot.X(A - d), xHi = plot.X(A + d);
    EX.set(els.epsBand, { x: left, y: yHi, width: right - left, height: yLo - yHi });
    EX.set(els.epsHatch, { x: left, y: yHi, width: right - left, height: yLo - yHi });
    EX.set(els.delBand, { x: xLo, y: top, width: xHi - xLo, height: bot - top });
    EX.set(els.epsHi, { x1: left, x2: right, y1: yHi, y2: yHi });
    EX.set(els.epsLo, { x1: left, x2: right, y1: yLo, y2: yLo });
    EX.set(els.delLo, { x1: xLo, x2: xLo, y1: top, y2: bot });
    EX.set(els.delHi, { x1: xHi, x2: xHi, y1: top, y2: bot });
    EX.set(els.box, { x: xLo, y: yHi, width: xHi - xLo, height: yLo - yHi });
    EX.set(els.lEpsHi, { x: right - 4, y: yHi - 6 });
    EX.set(els.lEpsLo, { x: right - 4, y: yLo + 16 });
    EX.set(els.lDelLo, { x: xLo - 6, y: top + 12 });
    EX.set(els.lDelHi, { x: xHi + 6, y: top + 12 });

    // the graph inside the δ-band: teal where it stays in the ε-band, red where it escapes
    var inside = Math.min(d, e / 2);
    EX.set(els.segOk, { x1: plot.X(A - inside), y1: plot.Y(f(A - inside)), x2: plot.X(A + inside), y2: plot.Y(f(A + inside)) });
    var fails = d > e / 2 + 1e-9;
    EX.set(els.segNoL, { x1: plot.X(A - d), y1: plot.Y(f(A - d)), x2: plot.X(A - e / 2), y2: plot.Y(f(A - e / 2)), opacity: fails ? 1 : 0 });
    EX.set(els.segNoR, { x1: plot.X(A + e / 2), y1: plot.Y(f(A + e / 2)), x2: plot.X(A + d), y2: plot.Y(f(A + d)), opacity: fails ? 1 : 0 });

    var px = plot.X(st.probe), py = plot.Y(f(st.probe));
    EX.set(els.probe, { cx: px, cy: py });
    EX.set(els.halo, { cx: px, cy: py });
    EX.set(els.dropX, { x1: px, x2: px, y1: py, y2: ax.xa });
    EX.set(els.dropY, { x1: px, x2: ax.ya, y1: py, y2: py });
    renderChecks();
  }

  function renderChecks() {
    var e = st.eps, d = st.del;
    var dx = Math.abs(st.probe - A), dy = Math.abs(f(st.probe) - L);
    out.px.textContent = EX.fixed(dx, 3);
    out.py.textContent = EX.fixed(dy, 3);
    out.eps.textContent = EX.fixed(e, 2);
    out.del.textContent = EX.fixed(d, 2);

    var inDel = dx > 0 && dx < d, inEps = dy < e;
    cmpX.textContent = dx === 0 ? '(x = a is excluded)' : (inDel ? '< δ  ✓' : '≥ δ');
    cmpX.className = 'eps-check__cmp ' + (inDel ? 'is-ok' : '');
    cmpY.textContent = inEps ? '< ε  ✓' : '≥ ε  ✗';
    cmpY.className = 'eps-check__cmp ' + (inEps ? 'is-ok' : 'is-no');

    var html, ok = d <= e / 2 + 1e-9;
    if (ok) {
      html = '<strong>δ = ' + EX.fixed(d, 2) + ' works.</strong> Every <i>x</i> with 0 &lt; |<i>x</i> − 2| &lt; δ gives |<i>f</i>(<i>x</i>) − 5| &lt; ' + EX.fixed(e, 2) + '.';
    } else {
      var cx = inDel && !inEps ? st.probe : A + (e / 2 + d) / 2;
      html = '<strong>δ = ' + EX.fixed(d, 2) + ' is too large.</strong> <i>x</i> = ' + EX.fixed(cx, 2) + ' is within δ of 2, but |<i>f</i>(<i>x</i>) − 5| = ' + EX.fixed(Math.abs(f(cx) - L), 2) + ' ≥ ε. Try δ ≤ ε/2 = ' + EX.fixed(e / 2, 3) + '.';
    }
    if (verdict.innerHTML !== html) verdict.innerHTML = html;
    verdict.className = 'eps-check__verdict ' + (ok ? 'is-ok' : 'is-no');
  }

  var running = false;
  function animate() {
    if (running) return;
    running = true;
    EX.loop(function (dt) {
      st.epsShown = EX.approach(st.epsShown, st.eps, 0.09, dt);
      st.delShown = EX.approach(st.delShown, st.del, 0.09, dt);
      if (Math.abs(st.epsShown - st.eps) < 1e-4) st.epsShown = st.eps;
      if (Math.abs(st.delShown - st.del) < 1e-4) st.delShown = st.del;
      render();
      if (st.epsShown === st.eps && st.delShown === st.del) { running = false; return false; }
      return true;
    });
  }

  function syncDelta() {
    if (st.auto) {
      st.del = st.eps / 2;
      delIn.value = st.del;
    }
    delIn.disabled = st.auto;
    epsIn.setAttribute('aria-valuetext', 'epsilon ' + EX.fixed(st.eps, 2));
    delIn.setAttribute('aria-valuetext', 'delta ' + EX.fixed(st.del, 2));
  }

  epsIn.addEventListener('input', function () { st.eps = parseFloat(epsIn.value); syncDelta(); animate(); renderChecks(); });
  delIn.addEventListener('input', function () { st.del = parseFloat(delIn.value); syncDelta(); animate(); renderChecks(); });
  autoIn.addEventListener('change', function () { st.auto = autoIn.checked; syncDelta(); animate(); renderChecks(); });

  function setProbe(x) { st.probe = EX.clamp(x, XLO, XHI); render(); }
  EX.drag(svg, {
    start: function (px) { setProbe(plot.invX(px)); },
    move: function (px) { setProbe(plot.invX(px)); }
  });
  svg.addEventListener('keydown', function (e) {
    var step = e.shiftKey ? 0.005 : 0.02;
    if (e.key === 'ArrowLeft') { setProbe(st.probe - step); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { setProbe(st.probe + step); e.preventDefault(); }
  });

  syncDelta();
  plot.onResize(build);

  /* ---------- proof of the Sum Law ---------- */
  var proof = root.querySelector('[data-stepper-name="proof"]');
  if (proof) EX.stepper(proof);
})();
