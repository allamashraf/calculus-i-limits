/* =====================================================================
   core.js — small shared toolkit for the exhibit
   ---------------------------------------------------------------------
   • EX.svg / EX.set      create and update SVG nodes
   • EX.loop              one requestAnimationFrame ticker for everything
   • EX.approach          the only easing in the project:
                          x(t) = L + (x0 − L)·e^(−t/τ)
   • EX.Plot              a tiny 2-D plotting surface (scales, axes, layers)
   • EX.stepper           step-by-step reveal (worked example, proof)
   • EX.Motif             two points approaching an open circle
   ===================================================================== */
(function () {
  'use strict';

  var EX = (window.EX = window.EX || {});
  var NS = 'http://www.w3.org/2000/svg';

  /* ---------- reduced motion ---------- */
  var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  EX.reduced = mq.matches;
  var onReduce = function (e) { EX.reduced = e.matches; };
  if (mq.addEventListener) mq.addEventListener('change', onReduce);

  /* ---------- tiny helpers ---------- */
  EX.clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  EX.lerp = function (a, b, t) { return a + (b - a) * t; };

  /** Exponential approach toward a target. After time τ, 63% of the gap is gone. */
  EX.approach = function (current, target, tau, dt) {
    if (tau <= 0 || EX.reduced) return target;
    return target + (current - target) * Math.exp(-dt / tau);
  };

  /** Fixed decimals with a true minus sign (U+2212). */
  EX.fixed = function (v, digits) {
    var s = Math.abs(v).toFixed(digits);
    if (v < 0 && Number(s) !== 0) s = '−' + s;
    return s;
  };
  EX.commas = function (n) { return Math.round(n).toLocaleString('en-US'); };

  EX.svg = function (tag, attrs, parent) {
    var node = document.createElementNS(NS, tag);
    if (attrs) EX.set(node, attrs);
    if (parent) parent.appendChild(node);
    return node;
  };
  EX.set = function (node, attrs) {
    for (var k in attrs) {
      if (attrs[k] === null || attrs[k] === undefined) node.removeAttribute(k);
      else node.setAttribute(k, attrs[k]);
    }
    return node;
  };
  EX.empty = function (node) { while (node.firstChild) node.removeChild(node.firstChild); return node; };

  /**
   * Math-style SVG text. Mini markup:
   *   {f}(x)   → braces make italic (math variables)
   *   x_1      → subscript (next char or digit run)
   *   2^5      → superscript
   */
  EX.mtext = function (parent, x, y, markup, attrs) {
    var t = EX.svg('text', Object.assign({ x: x, y: y }, attrs || {}), parent);
    EX.setMtext(t, markup);
    return t;
  };
  EX.setMtext = function (t, markup) {
    EX.empty(t);
    var i = 0, italic = false, buf = '';
    var flush = function (extra) {
      if (!buf) return;
      var span = EX.svg('tspan', extra || {}, t);
      if (italic) span.setAttribute('class', 'i');
      if (italic) { span.style.fontFamily = 'KaTeX_Math, serif'; span.style.fontStyle = 'italic'; }
      span.textContent = buf;
      buf = '';
    };
    while (i < markup.length) {
      var c = markup[i];
      if (c === '{') { flush(); italic = true; i++; continue; }
      if (c === '}') { flush(); italic = false; i++; continue; }
      if (c === '_' || c === '^') {
        flush();
        var run = '';
        i++;
        if (/\d/.test(markup[i])) { while (i < markup.length && /\d/.test(markup[i])) run += markup[i++]; }
        else run = markup[i++] || '';
        var s = EX.svg('tspan', { 'baseline-shift': c === '_' ? '-28%' : '42%', 'font-size': '72%' }, t);
        s.textContent = run;
        continue;
      }
      buf += c;
      i++;
    }
    flush();
  };

  /** Nudge an SVG label left if it would run past the right edge (narrow screens). */
  EX.keepInside = function (text, W, pad) {
    pad = pad === undefined ? 6 : pad;
    try {
      var b = text.getBBox();
      var over = b.x + b.width - (W - pad);
      if (over > 0) text.setAttribute('x', (parseFloat(text.getAttribute('x')) - over).toFixed(1));
    } catch (err) { /* not rendered yet */ }
    return text;
  };

  /* ---------- one ticker for every animation ---------- */
  var jobs = [];
  var rafId = 0, last = 0;
  function frame(now) {
    var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    var keep = [];
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      if (job.dead) continue;
      if (job.fn(dt) !== false) keep.push(job);
    }
    jobs = keep;
    rafId = jobs.length ? requestAnimationFrame(frame) : 0;
  }
  /** Run fn(dt) every frame until it returns false. Returns a cancel function. */
  EX.loop = function (fn) {
    var job = { fn: fn, dead: false };
    jobs.push(job);
    if (!rafId) { last = performance.now(); rafId = requestAnimationFrame(frame); }
    return function () { job.dead = true; };
  };

  /* ---------- drag helper (pointer events, works for mouse, pen and touch) ---------- */
  EX.drag = function (el, handlers) {
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var r = el.getBoundingClientRect();
      if (handlers.start && handlers.start(e.clientX - r.left, e.clientY - r.top, e) === false) return;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      var move = function (ev) {
        var rr = el.getBoundingClientRect();
        handlers.move(ev.clientX - rr.left, ev.clientY - rr.top, ev);
      };
      var up = function (ev) {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (handlers.end) handlers.end(ev);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  };

  /* ---------- screen-reader announcements (debounced) ---------- */
  var live = document.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  document.body.appendChild(live);
  var liveTimer = 0;
  EX.announce = function (text, delay) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { live.textContent = text; }, delay === undefined ? 450 : delay);
  };

  /* =====================================================================
     Plot — maps data coordinates to pixels. The SVG viewBox always equals
     its CSS pixel size, so a 1-unit stroke is a crisp 1px line.
     ===================================================================== */
  var plots = [];
  // Labels are measured when drawn; redraw once the web fonts have arrived.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      plots.forEach(function (p) { if (p.W) p.listeners.forEach(function (fn) { fn(p); }); });
    });
  }

  function Plot(svg, opts) {
    this.svg = svg;
    this.x = opts.x;
    this.y = opts.y;
    this.pad = Object.assign({ t: 16, r: 16, b: 34, l: 42 }, opts.pad || {});
    this.padFn = opts.padFn || null;
    this.layers = {};
    this.listeners = [];
    var names = ['grid', 'under', 'axes', 'main', 'over', 'ui'];
    for (var i = 0; i < names.length; i++) this.layers[names[i]] = EX.svg('g', { 'class': 'layer-' + names[i] }, svg);
    var self = this;
    this.W = 0; this.H = 0;
    plots.push(this);
    if (window.ResizeObserver) {
      new ResizeObserver(function () { self.resize(); }).observe(svg);
    }
    window.addEventListener('resize', function () { self.resize(); });
    this.resize();
  }
  Plot.prototype.resize = function () {
    var r = this.svg.getBoundingClientRect();
    var W = Math.round(r.width), H = Math.round(r.height);
    if (!W || !H || (W === this.W && H === this.H)) return;
    this.W = W; this.H = H;
    this.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var p = this.padFn ? this.padFn(W, H) : this.pad;
    this.p = p;
    this.px0 = p.l; this.px1 = W - p.r;
    this.py0 = H - p.b; this.py1 = p.t;
    for (var i = 0; i < this.listeners.length; i++) this.listeners[i](this);
  };
  Plot.prototype.onResize = function (fn) { this.listeners.push(fn); if (this.W) fn(this); };
  Plot.prototype.X = function (x) { return this.px0 + (x - this.x[0]) / (this.x[1] - this.x[0]) * (this.px1 - this.px0); };
  Plot.prototype.Y = function (y) { return this.py0 + (y - this.y[0]) / (this.y[1] - this.y[0]) * (this.py1 - this.py0); };
  Plot.prototype.invX = function (px) { return this.x[0] + (px - this.px0) / (this.px1 - this.px0) * (this.x[1] - this.x[0]); };
  Plot.prototype.invY = function (py) { return this.y[0] + (py - this.py0) / (this.py1 - this.py0) * (this.y[1] - this.y[0]); };
  Plot.prototype.layer = function (name) { return EX.empty(this.layers[name]); };
  /** Path of y = f(x) sampled between a and b, clipped to the y-range. */
  Plot.prototype.fnPath = function (f, a, b, n) {
    n = n || 240;
    var d = '', pen = false;
    var y0 = this.y[0] - (this.y[1] - this.y[0]) * 0.05, y1 = this.y[1] + (this.y[1] - this.y[0]) * 0.05;
    for (var i = 0; i <= n; i++) {
      var x = a + (b - a) * i / n, y = f(x);
      if (!isFinite(y) || y < y0 || y > y1) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + this.X(x).toFixed(2) + ' ' + this.Y(y).toFixed(2);
      pen = true;
    }
    return d;
  };
  /** A clip path covering the plotting area, so lines never spill out. */
  Plot.prototype.clipId = function () {
    if (!this._clip) {
      this._clipId = 'clip-' + Math.random().toString(36).slice(2, 8);
      var defs = EX.svg('defs', null, this.svg);
      this._clip = EX.svg('rect', null, EX.svg('clipPath', { id: this._clipId }, defs));
    }
    EX.set(this._clip, { x: this.px0, y: this.py1, width: this.px1 - this.px0, height: this.py0 - this.py1 });
    return 'url(#' + this._clipId + ')';
  };
  /**
   * Axes with arrowheads, ticks and grid.
   * opts: xTicks, yTicks, xLabel, yLabel, grid, xFmt, yFmt, xAt, yAt
   */
  Plot.prototype.axes = function (opts) {
    var self = this;
    var grid = this.layer('grid'), ax = this.layer('axes');
    var xAxisY = opts.xAt !== undefined ? this.Y(opts.xAt) : (this.y[0] <= 0 && this.y[1] >= 0 ? this.Y(0) : this.py0);
    var yAxisX = opts.yAt !== undefined ? this.X(opts.yAt) : (this.x[0] <= 0 && this.x[1] >= 0 ? this.X(0) : this.px0);
    var xFmt = opts.xFmt || function (v) { return EX.fixed(v, 0); };
    var yFmt = opts.yFmt || function (v) { return EX.fixed(v, 0); };

    if (opts.grid !== false) {
      (opts.xGrid || opts.xTicks || []).forEach(function (v) {
        var x = Math.round(self.X(v)) + 0.5;
        EX.svg('line', { x1: x, x2: x, y1: self.py1, y2: self.py0 }, grid);
      });
      (opts.yGrid || opts.yTicks || []).forEach(function (v) {
        var y = Math.round(self.Y(v)) + 0.5;
        EX.svg('line', { x1: self.px0, x2: self.px1, y1: y, y2: y }, grid);
      });
      grid.setAttribute('class', 'layer-grid p-grid');
    }

    var xa = Math.round(xAxisY) + 0.5, ya = Math.round(yAxisX) + 0.5;
    EX.svg('path', { d: 'M' + this.px0 + ' ' + xa + 'H' + (this.px1 + 6), 'class': 'p-axis' }, ax);
    EX.svg('path', { d: 'M' + ya + ' ' + this.py0 + 'V' + (this.py1 - 6), 'class': 'p-axis' }, ax);
    // arrowheads
    EX.svg('path', { d: 'M' + (this.px1 + 11) + ' ' + xa + 'l-7 -3.2v6.4z', 'class': 'p-arrow' }, ax);
    EX.svg('path', { d: 'M' + ya + ' ' + (this.py1 - 11) + 'l-3.2 7h6.4z', 'class': 'p-arrow' }, ax);

    var ticks = EX.svg('g', { 'class': 'p-tick' }, ax);
    (opts.xTicks || []).forEach(function (v) {
      if (opts.skipZero !== false && v === 0 && opts.yAt === undefined && self.x[0] < 0) return;
      var x = Math.round(self.X(v)) + 0.5;
      EX.svg('line', { x1: x, x2: x, y1: xa - 3, y2: xa + 3 }, ticks);
      var t = EX.svg('text', { x: x, y: xa + 19, 'text-anchor': 'middle' }, ticks);
      t.textContent = xFmt(v);
    });
    (opts.yTicks || []).forEach(function (v) {
      if (opts.skipZero !== false && v === 0 && self.y[0] < 0) return;
      var y = Math.round(self.Y(v)) + 0.5;
      EX.svg('line', { x1: ya - 3, x2: ya + 3, y1: y, y2: y }, ticks);
      var t = EX.svg('text', { x: ya - 9, y: y + 4.5, 'text-anchor': 'end' }, ticks);
      t.textContent = yFmt(v);
    });
    if (opts.origin !== false && this.x[0] < 0 && this.y[0] < 0) {
      var o = EX.svg('text', { x: ya - 8, y: xa + 17, 'text-anchor': 'end' }, ticks);
      o.textContent = '0';
    }
    if (opts.xLabel) EX.mtext(ax, this.px1 + 6, xa - 9, opts.xLabel, { 'class': 'p-var', 'text-anchor': 'end' });
    if (opts.yLabel) EX.mtext(ax, ya + 10, this.py1 - 2, opts.yLabel, { 'class': 'p-var', 'text-anchor': 'start' });
    return { xa: xa, ya: ya };
  };
  EX.Plot = Plot;

  /* =====================================================================
     KaTeX — typeset every .tex element once, at load
     ===================================================================== */
  EX.renderMath = function (root) {
    var nodes = (root || document).querySelectorAll('.tex:not(.is-rendered)');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var src = el.textContent;
      if (window.katex) {
        try {
          window.katex.render(src, el, {
            displayMode: el.hasAttribute('data-display'),
            throwOnError: false,
            strict: 'ignore',
            trust: function (ctx) { return ctx.command === '\\htmlClass'; },
            output: 'htmlAndMathml'
          });
        } catch (err) { el.textContent = src; }
      }
      el.classList.add('is-rendered');
    }
  };
  EX.renderMath();

  /* =====================================================================
     Reveal on scroll — elements settle into alignment once
     ===================================================================== */
  var revealIO = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('is-in'); revealIO.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }) : null;

  EX.reveal = function (el) {
    if (!revealIO || EX.reduced) { el.classList.add('is-in'); return; }
    revealIO.observe(el);
  };
  document.querySelectorAll('[data-reveal], [data-laws], [data-quote]').forEach(EX.reveal);
  document.querySelectorAll('.laws .law').forEach(function (li, i) { li.style.setProperty('--i', i); });

  /** Call cb the first time el becomes visible (threshold = share of el visible). */
  EX.onEnter = function (el, cb, threshold) {
    if (!('IntersectionObserver' in window)) { cb(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { io.disconnect(); cb(); }
      });
    }, { threshold: threshold === undefined ? 0.35 : threshold });
    io.observe(el);
  };

  /** Track whether el is on screen (for pausing animations). */
  EX.watch = function (el, cb, threshold) {
    if (!('IntersectionObserver' in window)) { cb(true); return; }
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { cb(e.isIntersecting); });
    }, { threshold: threshold === undefined ? 0.2 : threshold }).observe(el);
  };

  /* =====================================================================
     Stepper — reveal steps one at a time (buttons, ← → keys)
     ===================================================================== */
  EX.stepper = function (root, onChange) {
    var steps = Array.prototype.slice.call(root.querySelectorAll('[data-step]'));
    var prev = root.querySelector('[data-prev]');
    var next = root.querySelector('[data-next]');
    var count = root.querySelector('[data-count]');
    var i = 0;
    function set(n) {
      i = EX.clamp(n, 0, steps.length);
      steps.forEach(function (s, k) {
        s.classList.toggle('is-shown', k < i);
        s.classList.toggle('is-current', k === i - 1);
        s.setAttribute('aria-hidden', k < i ? 'false' : 'true');
      });
      var atStart = i === 0, atEnd = i === steps.length;
      if (atStart && document.activeElement === prev) next.focus();
      prev.disabled = atStart;
      next.textContent = atEnd ? 'Start over ↺' : 'Next step →';
      count.textContent = i + ' / ' + steps.length;
      if (onChange) onChange(i, steps[i - 1] || null);
    }
    next.addEventListener('click', function () { set(i === steps.length ? 0 : i + 1); });
    prev.addEventListener('click', function () { set(i - 1); });
    root.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') { set(i + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { set(i - 1); e.preventDefault(); }
    });
    set(0);
    return { set: set, get index() { return i; }, get length() { return steps.length; } };
  };

  /* =====================================================================
     Motif — two points travel in from the edges toward an open circle.
     They close the gap exponentially and never touch it.
     ===================================================================== */
  function Motif(container) {
    this.el = container;
    this.svg = EX.svg('svg', { 'aria-hidden': 'true', focusable: 'false' }, container);
    var id = 'mg' + Math.random().toString(36).slice(2, 7);
    var defs = EX.svg('defs', null, this.svg);
    var gl = EX.svg('linearGradient', { id: id + 'l', x1: '0', x2: '1', y1: '0', y2: '0' }, defs);
    EX.svg('stop', { offset: '0', 'stop-color': 'currentColor', 'stop-opacity': '0' }, gl);
    EX.svg('stop', { offset: '1', 'stop-color': 'currentColor', 'stop-opacity': '1' }, gl);
    var gr = EX.svg('linearGradient', { id: id + 'r', x1: '0', x2: '1', y1: '0', y2: '0' }, defs);
    EX.svg('stop', { offset: '0', 'stop-color': 'currentColor', 'stop-opacity': '1' }, gr);
    EX.svg('stop', { offset: '1', 'stop-color': 'currentColor', 'stop-opacity': '0' }, gr);
    this.lineL = EX.svg('line', { 'class': 'm-line', stroke: 'url(#' + id + 'l)' }, this.svg);
    this.lineR = EX.svg('line', { 'class': 'm-line', stroke: 'url(#' + id + 'r)' }, this.svg);
    this.hole = EX.svg('circle', { 'class': 'm-hole', r: 6.5 }, this.svg);
    this.pL = EX.svg('circle', { 'class': 'm-point', r: 3 }, this.svg);
    this.pR = EX.svg('circle', { 'class': 'm-point', r: 3 }, this.svg);
    this.p = 0; // progress 0 → 1 (never exactly 1 while animating)
    var self = this;
    if (window.ResizeObserver) new ResizeObserver(function () { self.draw(); }).observe(container);
    this.draw();
  }
  Motif.prototype.draw = function () {
    var W = this.el.clientWidth || 600, H = this.el.clientHeight || 22, cy = H / 2, cx = W / 2;
    this.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var rest = 6.5 + 9; // where the points come to rest, measured from the centre
    var xl = this.p * (cx - rest), xr = W - this.p * (cx - rest);
    EX.set(this.lineL, { x1: 0, x2: Math.max(0.01, xl), y1: cy, y2: cy });
    EX.set(this.lineR, { x1: Math.min(W - 0.01, xr), x2: W, y1: cy, y2: cy });
    EX.set(this.hole, { cx: cx, cy: cy });
    EX.set(this.pL, { cx: xl, cy: cy, opacity: this.p > 0.002 ? 1 : 0 });
    EX.set(this.pR, { cx: xr, cy: cy, opacity: this.p > 0.002 ? 1 : 0 });
  };
  Motif.prototype.play = function (delay, tau) {
    var self = this, t = -(delay || 0);
    tau = tau || 0.5;
    if (EX.reduced) { this.p = 1; this.draw(); return; }
    this.p = 0; this.draw();
    EX.loop(function (dt) {
      t += dt;
      if (t < 0) return true;
      self.p = 1 - Math.exp(-t / tau);
      if (1 - self.p < 0.0004) { self.p = 1; self.draw(); return false; }
      self.draw();
      return true;
    });
  };
  EX.Motif = Motif;
})();
