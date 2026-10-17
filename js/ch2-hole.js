/* =====================================================================
   Chapter 02 — The hole.   f(x) = (x² − 1)/(x − 1) = x + 1,  x ≠ 1
   ---------------------------------------------------------------------
   Two points approach x = 1, one from each side. Their distance to 1
   decays as d(t) = d0·e^(−t/τ): it shrinks forever and never reaches 0.
   A loupe magnifies the neighbourhood of the hole, zooming ×10 each time
   the points look as if they touch — there is always a gap left.
   When both sides settle on 2, the one-sided limits merge into one.
   ===================================================================== */
(function () {
  'use strict';
  var EX = window.EX;
  var root = document.getElementById('ch2');
  if (!root) return;

  var A = 1, L = 2, D0 = 1.5, DMIN = 1e-4;
  var f = function (x) { return x + 1; };

  var svg = root.querySelector('[data-plot]');
  var approachBtn = root.querySelector('[data-approach]');
  var resetBtn = root.querySelector('[data-reset]');
  var resolveEl = root.querySelector('[data-resolve]');
  var sideL = root.querySelector('[data-side="left"]');
  var sideR = root.querySelector('[data-side="right"]');
  var out = {};
  ['lx', 'lfx', 'rx', 'rfx'].forEach(function (k) { out[k] = root.querySelector('[data-out="' + k + '"]'); });

  var plot = new EX.Plot(svg, { x: [-1.4, 3.4], y: [-0.6, 4.6], pad: { t: 20, r: 24, b: 30, l: 34 } });
  svg.style.touchAction = 'pan-y';

  var state = { dL: D0, dR: D0, phase: 'idle', zoomLog: 0, loupe: 0 };
  var els = {}, ax = null, timers = [];
  var HOLE_R = 7.5, PT_R = 6, MIN_SEP = HOLE_R + PT_R + 1.5;

  /* ---------- static drawing ---------- */
  function build() {
    ax = plot.axes({
      xTicks: [-1, 1, 2, 3],
      yTicks: [1, 2, 3, 4],
      xFmt: function (v) { return v === A ? '' : EX.fixed(v, 0); },
      yFmt: function (v) { return v === L ? '' : String(v); },
      xLabel: '{x}',
      yLabel: '{y}'
    });
    var under = plot.layer('under'), main = plot.layer('main'), over = plot.layer('over'), ui = plot.layer('ui');
    var clip = plot.clipId();
    var H = { x: plot.X(A), y: plot.Y(L) };
    els.H = H;

    // gold: the limit value, projected onto both axes
    els.guide = EX.svg('path', { 'class': 'p-limit-line ch2-guide', d: 'M' + H.x + ' ' + ax.xa + 'V' + (H.y + HOLE_R) + 'M' + (H.x - HOLE_R) + ' ' + H.y + 'H' + ax.ya }, under);
    els.label1 = EX.mtext(ui, H.x, ax.xa + 19, '1', { 'class': 'p-limit-text', 'text-anchor': 'middle' });
    els.label2 = EX.mtext(ui, ax.ya - 9, H.y + 5, '2', { 'class': 'p-limit-text ch2-two', 'text-anchor': 'end' });

    // blue: y = x + 1 (the open circle is drawn on top of it)
    EX.svg('path', { 'class': 'p-fn', d: plot.fnPath(f, -1.4, 3.4, 2), 'clip-path': clip }, main);
    EX.keepInside(EX.mtext(main, plot.X(2.55) + 12, plot.Y(f(2.55)) + 20, '{y} = {x} + 1', { 'class': 'p-var' }), plot.W);

    // teal: the travellers, their drops to the x-axis, their marks on the y-axis
    els.dropL = EX.svg('line', { 'class': 'p-drop' }, over);
    els.dropR = EX.svg('line', { 'class': 'p-drop' }, over);
    els.markLy = EX.svg('circle', { 'class': 'p-axis-mark', r: 3.5 }, over);
    els.markRy = EX.svg('circle', { 'class': 'p-axis-mark', r: 3.5 }, over);
    els.markLx = EX.svg('circle', { 'class': 'p-axis-mark', r: 3.5 }, over);
    els.markRx = EX.svg('circle', { 'class': 'p-axis-mark', r: 3.5 }, over);
    els.haloL = EX.svg('circle', { 'class': 'p-point-halo', r: 15 }, over);
    els.haloR = EX.svg('circle', { 'class': 'p-point-halo', r: 15 }, over);
    els.hole = EX.svg('circle', { 'class': 'p-hole', cx: H.x, cy: H.y, r: HOLE_R }, over);
    els.ptL = EX.svg('circle', { 'class': 'p-point ch2-pt', r: PT_R }, over);
    els.ptR = EX.svg('circle', { 'class': 'p-point ch2-pt', r: PT_R }, over);

    // annotation for the missing value
    var ann = EX.svg('g', { 'class': 'ch2-ann' }, ui);
    EX.svg('line', { x1: H.x - 9, y1: H.y - 9, x2: H.x - 30, y2: H.y - 30, 'class': 'ch2-ann__line' }, ann);
    EX.mtext(ann, H.x - 34, H.y - 36, '{f}(1) undefined', { 'class': 'ch2-ann__text', 'text-anchor': 'end' });

    // the loupe (bottom-right of the hole, below the line)
    var R = EX.clamp(Math.min(plot.W, plot.H) * 0.13, 40, 74);
    var C = { x: Math.min(plot.X(2.6), plot.px1 - R - 6), y: Math.min(plot.Y(0.95), ax.xa - R - 12) };
    els.loupeR = R; els.C = C;
    var lg = EX.svg('g', { 'class': 'loupe', opacity: 0 }, ui);
    els.loupe = lg;
    var cid = 'loupe-' + Math.random().toString(36).slice(2, 7);
    EX.svg('circle', { r: R, cx: C.x, cy: C.y }, EX.svg('clipPath', { id: cid }, EX.svg('defs', null, lg)));
    els.leader = EX.svg('line', { 'class': 'loupe__leader' }, lg);
    EX.svg('circle', { 'class': 'loupe__bg', cx: C.x, cy: C.y, r: R }, lg);
    var inner = EX.svg('g', { 'clip-path': 'url(#' + cid + ')' }, lg);
    els.lLine = EX.svg('line', { 'class': 'p-fn' }, inner);
    els.lHole = EX.svg('circle', { 'class': 'p-hole', cx: C.x, cy: C.y, r: HOLE_R - 1.5 }, inner);
    els.lPtL = EX.svg('circle', { 'class': 'p-point', r: PT_R - 1.5 }, inner);
    els.lPtR = EX.svg('circle', { 'class': 'p-point', r: PT_R - 1.5 }, inner);
    EX.svg('circle', { 'class': 'loupe__ring', cx: C.x, cy: C.y, r: R }, lg);
    els.zoomText = EX.svg('text', { 'class': 'loupe__zoom', x: C.x, y: C.y + R + 18, 'text-anchor': 'middle' }, lg);

    // leader from the hole toward the loupe
    var vx = C.x - H.x, vy = C.y - H.y, vl = Math.hypot(vx, vy);
    EX.set(els.leader, { x1: H.x + vx / vl * (HOLE_R + 4), y1: H.y + vy / vl * (HOLE_R + 4), x2: C.x - vx / vl * (R + 3), y2: C.y - vy / vl * (R + 3) });

    // direction of the line in pixels (slope 1 in data units)
    var ux = plot.X(1) - plot.X(0), uy = plot.Y(1) - plot.Y(0), ul = Math.hypot(ux, uy);
    els.u = { x: ux / ul, y: uy / ul };
    els.ppu = ul; // pixels per unit of x, measured along the line
    EX.set(els.lLine, { x1: C.x - els.u.x * R * 1.2, y1: C.y - els.u.y * R * 1.2, x2: C.x + els.u.x * R * 1.2, y2: C.y + els.u.y * R * 1.2 });

    render();
  }

  /* point position on screen, kept just outside the hole so it never "arrives" */
  function screenPoint(x) {
    var px = plot.X(x), py = plot.Y(f(x));
    var dx = px - els.H.x, dy = py - els.H.y, s = Math.hypot(dx, dy);
    if (s < MIN_SEP) {
      var sign = x < A ? -1 : 1;
      px = els.H.x + sign * els.u.x * MIN_SEP;
      py = els.H.y + sign * els.u.y * MIN_SEP;
    }
    return { x: px, y: py };
  }

  function render() {
    if (!ax) return;
    var xl = A - state.dL, xr = A + state.dR;
    var pl = screenPoint(xl), pr = screenPoint(xr);
    EX.set(els.ptL, { cx: pl.x, cy: pl.y }); EX.set(els.haloL, { cx: pl.x, cy: pl.y });
    EX.set(els.ptR, { cx: pr.x, cy: pr.y }); EX.set(els.haloR, { cx: pr.x, cy: pr.y });
    EX.set(els.dropL, { x1: pl.x, x2: pl.x, y1: pl.y, y2: ax.xa });
    EX.set(els.dropR, { x1: pr.x, x2: pr.x, y1: pr.y, y2: ax.xa });
    EX.set(els.markLx, { cx: pl.x, cy: ax.xa });
    EX.set(els.markRx, { cx: pr.x, cy: ax.xa });
    EX.set(els.markLy, { cx: ax.ya, cy: plot.Y(f(xl)) });
    EX.set(els.markRy, { cx: ax.ya, cy: plot.Y(f(xr)) });

    // loupe: separation inside the magnifier = true distance × zoom
    var R = els.loupeR, C = els.C, Z = Math.pow(10, state.zoomLog);
    var sepL = Math.max(state.dL * els.ppu * Z, MIN_SEP - 1.5);
    var sepR = Math.max(state.dR * els.ppu * Z, MIN_SEP - 1.5);
    EX.set(els.lPtL, { cx: C.x - els.u.x * Math.min(sepL, R * 1.3), cy: C.y - els.u.y * Math.min(sepL, R * 1.3) });
    EX.set(els.lPtR, { cx: C.x + els.u.x * Math.min(sepR, R * 1.3), cy: C.y + els.u.y * Math.min(sepR, R * 1.3) });
    els.loupe.setAttribute('opacity', state.loupe.toFixed(3));
    els.zoomText.textContent = 'magnified ×' + EX.commas(Math.pow(10, Math.round(state.zoomLog)));

    out.lx.textContent = EX.fixed(xl, 4);
    out.lfx.textContent = EX.fixed(f(xl), 4);
    out.rx.textContent = EX.fixed(xr, 4);
    out.rfx.textContent = EX.fixed(f(xr), 4);
  }

  /* zoom level that keeps the closer point comfortably visible in the loupe */
  function zoomTarget() {
    var d = Math.max(state.dL, state.dR) * els.ppu;
    if (!d) return state.zoomLog;
    return Math.max(0, Math.floor(Math.log10((els.loupeR * 0.85) / d)));
  }

  /* ---------- the one animation loop for this chapter ---------- */
  var running = false, mode = 'idle', tau = 0.4;
  function run() {
    if (running) return;
    running = true;
    EX.loop(function (dt) {
      if (mode === 'approach') {
        var k = EX.reduced ? 0 : Math.exp(-dt / tau);
        state.dL = Math.max(DMIN, state.dL * k);
        state.dR = Math.max(DMIN, state.dR * k);
        if (state.dL <= DMIN && state.dR <= DMIN) { mode = 'idle'; resolve(); }
      } else if (mode === 'reset') {
        state.dL = EX.approach(state.dL, D0, 0.35, dt);
        state.dR = EX.approach(state.dR, D0, 0.35, dt);
        if (Math.abs(state.dL - D0) < 1e-4 && Math.abs(state.dR - D0) < 1e-4) { state.dL = state.dR = D0; mode = 'idle'; }
      }
      var near = Math.max(state.dL, state.dR) < 0.2 ? 1 : 0;
      state.loupe = EX.approach(state.loupe, near, 0.25, dt);
      state.zoomLog = EX.approach(state.zoomLog, zoomTarget(), 0.2, dt);
      render();
      var settled = mode === 'idle' && Math.abs(state.loupe - near) < 0.002 && Math.abs(state.zoomLog - zoomTarget()) < 0.002;
      if (settled) { state.loupe = near; state.zoomLog = zoomTarget(); render(); running = false; return false; }
      return true;
    });
  }

  /* ---------- the resolution: two one-sided limits become one ---------- */
  function later(fn, s) { timers.push(setTimeout(fn, EX.reduced ? 0 : s * 1000)); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  function resolve() {
    if (state.phase === 'resolved') return;
    state.phase = 'resolved';
    svg.classList.add('is-resolved');
    later(function () { sideL.classList.add('is-reached'); }, 0.1);
    later(function () { sideR.classList.add('is-reached'); }, 0.3);
    later(function () { resolveEl.classList.add('is-sides'); }, 0.6);
    later(function () { resolveEl.classList.add('is-final'); }, 1.6);
    EX.announce('From the left, f of x approaches 2. From the right, f of x approaches 2. Therefore the limit of f of x as x approaches 1 is 2.', 200);
  }

  function unresolve() {
    clearTimers();
    state.phase = 'idle';
    svg.classList.remove('is-resolved');
    sideL.classList.remove('is-reached');
    sideR.classList.remove('is-reached');
    resolveEl.classList.remove('is-sides', 'is-final');
  }

  approachBtn.addEventListener('click', function () {
    if (state.phase === 'resolved') return;
    mode = 'approach';
    run();
  });
  resetBtn.addEventListener('click', function () {
    unresolve();
    mode = 'reset';
    run();
  });

  /* ---------- drag either point (optional exploration) ---------- */
  var dragging = null;
  EX.drag(svg, {
    start: function (px, py) {
      if (!ax) return false;
      var pl = screenPoint(A - state.dL), pr = screenPoint(A + state.dR);
      var hl = Math.hypot(px - pl.x, py - pl.y), hr = Math.hypot(px - pr.x, py - pr.y);
      if (Math.min(hl, hr) > 26) return false;
      dragging = hl <= hr ? 'L' : 'R';
      mode = 'idle';
      return true;
    },
    move: function (px) {
      var x = plot.invX(px);
      if (dragging === 'L') state.dL = EX.clamp(A - x, DMIN, 2.3);
      else state.dR = EX.clamp(x - A, DMIN, 2.3);
      if (state.dL <= 0.002 && state.dR <= 0.002) resolve();
      else if (state.phase === 'resolved' && Math.max(state.dL, state.dR) > 0.01) unresolve();
      run();
    },
    end: function () { dragging = null; }
  });

  plot.onResize(build);
})();
