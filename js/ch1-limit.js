/* =====================================================================
   Chapter 01 — What is a limit?   f(x) = x + 3,  x → 2,  f(x) → 5
   ---------------------------------------------------------------------
   The reader moves x (drag, slider, or "halve the distance"). Two teal
   segments show |x − 2| on the x-axis and |f(x) − 5| on the y-axis:
   watching both close together *is* the idea of a limit.
   ===================================================================== */
(function () {
  'use strict';
  var EX = window.EX;
  var root = document.getElementById('ch1');
  if (!root) return;

  var A = 2, L = 5, START = 0.5, XMIN = -0.25, XMAX = 4.25;
  var f = function (x) { return x + 3; };

  var svg = root.querySelector('[data-plot]');
  var input = root.querySelector('[data-x-input]');
  var sliderWrap = root.querySelector('[data-axis-slider]');
  var halveBtn = root.querySelector('[data-halve]');
  var resetBtn = root.querySelector('[data-reset]');
  var out = {};
  ['x', 'fx', 'dx', 'dfx', 'note'].forEach(function (k) { out[k] = root.querySelector('[data-out="' + k + '"]'); });
  var noteDefault = out.note.innerHTML;

  var plot = new EX.Plot(svg, { x: [-0.5, 4.5], y: [-0.6, 8.6], pad: { t: 20, r: 24, b: 30, l: 34 } });
  svg.classList.add('plot--draggable');

  var state = { target: START, shown: START, tau: 0.08, trail: [] };
  var els = {}, ax = null;

  /* ---------- static drawing (on every resize) ---------- */
  function build() {
    ax = plot.axes({
      xTicks: [1, 2, 3, 4],
      yTicks: [1, 2, 3, 4, 5, 6, 7, 8],
      xFmt: function (v) { return v === A ? '' : String(v); },
      yFmt: function (v) { return v === L ? '' : String(v); },
      xLabel: '{x}',
      yLabel: '{y}'
    });
    var under = plot.layer('under'), main = plot.layer('main'), over = plot.layer('over'), ui = plot.layer('ui');
    var clip = plot.clipId();

    // gold: the target point (2, 5) and its projections
    EX.svg('path', { 'class': 'p-limit-line', d: 'M' + plot.X(A) + ' ' + ax.xa + 'V' + plot.Y(L) + 'H' + ax.ya }, under);
    EX.mtext(ui, plot.X(A), ax.xa + 19, '2', { 'class': 'p-limit-text', 'text-anchor': 'middle' });
    EX.mtext(ui, ax.ya - 9, plot.Y(L) + 5, '5', { 'class': 'p-limit-text', 'text-anchor': 'end' });

    // teal: the two distances that shrink together
    els.gapX = EX.svg('line', { 'class': 'p-gap' }, under);
    els.gapY = EX.svg('line', { 'class': 'p-gap' }, under);

    // blue: the function
    EX.svg('path', { 'class': 'p-fn', d: plot.fnPath(f, -0.5, 4.5, 2), 'clip-path': clip }, main);
    EX.keepInside(EX.mtext(main, plot.X(3.85) + 10, plot.Y(f(3.85)) + 22, '{f}({x}) = {x} + 3', { 'class': 'p-var', 'text-anchor': 'start' }), plot.W);

    els.trail = EX.svg('g', { 'class': 'p-trail' }, over);
    els.dropX = EX.svg('line', { 'class': 'p-drop' }, over);
    els.dropY = EX.svg('line', { 'class': 'p-drop' }, over);
    EX.svg('circle', { 'class': 'p-limit-dot', cx: plot.X(A), cy: plot.Y(L), r: 5.5 }, over);
    els.markX = EX.svg('circle', { 'class': 'p-axis-mark', r: 3.5 }, over);
    els.markY = EX.svg('circle', { 'class': 'p-axis-mark', r: 3.5 }, over);
    els.halo = EX.svg('circle', { 'class': 'p-point-halo', r: 15 }, over);
    els.pt = EX.svg('circle', { 'class': 'p-point', r: 6.5 }, over);

    // keep the slider's thumb exactly under the x-axis position
    sliderWrap.style.setProperty('--px0', (plot.X(XMIN) - 9) + 'px');
    sliderWrap.style.setProperty('--px1r', (plot.W - plot.X(XMAX) - 9) + 'px');
    render();
  }

  /* ---------- digits: the closer you are, the more you need ---------- */
  function digitsFor(d) {
    if (d < 1e-12) return 3;
    return EX.clamp(Math.ceil(-Math.log10(d)) + 2, 3, 8);
  }

  function render() {
    if (!ax) return;
    var x = state.shown, y = f(x);
    var X = plot.X(x), Y = plot.Y(y), XA = plot.X(A), YL = plot.Y(L);
    EX.set(els.gapX, { x1: X, x2: XA, y1: ax.xa, y2: ax.xa });
    EX.set(els.gapY, { x1: ax.ya, x2: ax.ya, y1: Y, y2: YL });
    EX.set(els.dropX, { x1: X, x2: X, y1: Y, y2: ax.xa });
    EX.set(els.dropY, { x1: X, x2: ax.ya, y1: Y, y2: Y });
    EX.set(els.markX, { cx: X, cy: ax.xa });
    EX.set(els.markY, { cx: ax.ya, cy: Y });
    EX.set(els.pt, { cx: X, cy: Y });
    EX.set(els.halo, { cx: X, cy: Y });

    // trail of earlier positions left by "halve the distance"
    EX.empty(els.trail);
    state.trail.forEach(function (tx, i) {
      var age = state.trail.length - i;
      var op = Math.max(0.12, 0.7 - age * 0.09);
      EX.svg('line', { x1: plot.X(tx), x2: plot.X(tx), y1: ax.xa - 7, y2: ax.xa + 7, opacity: op }, els.trail);
      EX.svg('line', { x1: ax.ya - 7, x2: ax.ya + 7, y1: plot.Y(f(tx)), y2: plot.Y(f(tx)), opacity: op }, els.trail);
    });

    var d = Math.abs(x - A), n = digitsFor(d);
    out.x.textContent = EX.fixed(x, n);
    out.fx.textContent = EX.fixed(y, n);
    out.dx.textContent = EX.fixed(d, n);
    out.dfx.textContent = EX.fixed(Math.abs(y - L), n);
    var atA = Math.abs(state.target - A) < 1e-12 && d < 1e-12;
    var html = atA
      ? 'At <i>x</i> = 2 exactly, <i>f</i>(2) = 5 — but the limit never needed that value. Chapter 02 shows why.'
      : noteDefault;
    if (out.note.innerHTML !== html) out.note.innerHTML = html;
    halveBtn.disabled = Math.abs(state.target - A) < 1e-7;
  }

  /* ---------- motion: shown value approaches the target ---------- */
  var running = false;
  function animate() {
    if (running) return;
    running = true;
    EX.loop(function (dt) {
      state.shown = EX.approach(state.shown, state.target, state.tau, dt);
      if (Math.abs(state.shown - state.target) < 1e-11) state.shown = state.target;
      render();
      if (state.shown === state.target) { running = false; return false; }
      return true;
    });
  }

  function setTarget(x, tau, fromInput) {
    state.target = EX.clamp(x, XMIN, XMAX);
    state.tau = tau;
    if (!fromInput) input.value = state.target;
    input.setAttribute('aria-valuetext', 'x equals ' + EX.fixed(state.target, 4));
    animate();
    EX.announce('x is ' + EX.fixed(state.target, 4) + ', f of x is ' + EX.fixed(f(state.target), 4));
  }

  input.addEventListener('input', function () {
    state.trail = [];
    setTarget(parseFloat(input.value), 0.07, true);
  });
  input.addEventListener('keydown', function (e) {
    var step = e.shiftKey ? 0.005 : 0.05;
    var map = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step };
    if (e.key in map) {
      e.preventDefault();
      state.trail = [];
      setTarget(Math.round((state.target + map[e.key]) * 1e6) / 1e6, 0.12);
    }
  });

  EX.drag(svg, {
    start: function (px) { state.trail = []; setTarget(plot.invX(px), 0.06); },
    move: function (px) { setTarget(plot.invX(px), 0.06); }
  });

  halveBtn.addEventListener('click', function () {
    var d = state.target - A;
    if (Math.abs(d) < 1e-7) return;
    state.trail.push(state.target);
    if (state.trail.length > 10) state.trail.shift();
    setTarget(A + d / 2, 0.32);
  });

  resetBtn.addEventListener('click', function () {
    state.trail = [];
    setTarget(START, 0.45);
  });

  plot.onResize(build);
})();
