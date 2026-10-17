// filters.mjs — small, pure signal tools used by the gesture lab (and later by the gesture engine).

/**
 * One Euro filter (Casiez, Roussel & Vogel, CHI 2012): a low-pass filter whose cutoff
 * rises with speed — smooth when the hand is still, responsive when it moves.
 */
export class OneEuro {
  constructor({ minCutoff = 1.0, beta = 0.007, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }
  reset() { this.x = null; this.dx = 0; this.t = null; }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  /** value at time tMs (milliseconds) → filtered value */
  filter(value, tMs) {
    if (this.x === null) { this.x = value; this.t = tMs; return value; }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const dxRaw = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dxRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/** Keeps (time, value) samples for the last `spanMs` milliseconds. */
export class Window {
  constructor(spanMs) { this.spanMs = spanMs; this.items = []; }
  push(t, v) {
    this.items.push({ t, v });
    const cut = t - this.spanMs;
    while (this.items.length && this.items[0].t < cut) this.items.shift();
  }
  values() { return this.items.map((i) => i.v); }
  clear() { this.items.length = 0; }
  get size() { return this.items.length; }
}

/** Events per second over a sliding window. */
export class RateMeter {
  constructor(spanMs = 1500) { this.w = new Window(spanMs); }
  tick(t) { this.w.push(t, 1); }
  rate(now) {
    const items = this.w.items;
    if (items.length < 2) return 0;
    const span = Math.max(items[items.length - 1].t - items[0].t, 1);
    if (now - items[items.length - 1].t > 1000) return 0;   // stalled
    return ((items.length - 1) * 1000) / span;
  }
}

/* ---------- plain statistics ---------- */
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
export function quantile(a, q) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = (a) => quantile(a, 0.5);

/**
 * Jitter of a 2-D track: RMS distance between each point and a centred moving
 * average (±halfMs). Slow, intentional drift is removed; what remains is tremor + noise.
 * pts: [{t, x, y}] in any unit; returns the RMS in the same unit.
 */
export function jitterRMS(pts, halfMs = 250) {
  if (pts.length < 5) return NaN;
  let sum = 0, n = 0, lo = 0, hi = 0, sx = 0, sy = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = pts[i].t;
    while (hi < pts.length && pts[hi].t <= t + halfMs) { sx += pts[hi].x; sy += pts[hi].y; hi++; }
    while (pts[lo].t < t - halfMs) { sx -= pts[lo].x; sy -= pts[lo].y; lo++; }
    const k = hi - lo;
    if (k < 3) continue;
    const dx = pts[i].x - sx / k, dy = pts[i].y - sy / k;
    sum += dx * dx + dy * dy;
    n++;
  }
  return n ? Math.sqrt(sum / n) : NaN;
}

/** Centred moving average of a {t,x,y} track (±halfMs). */
function centredMA(pts, halfMs) {
  const out = new Array(pts.length);
  let lo = 0, hi = 0, sx = 0, sy = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = pts[i].t;
    while (hi < pts.length && pts[hi].t <= t + halfMs) { sx += pts[hi].x; sy += pts[hi].y; hi++; }
    while (pts[lo].t < t - halfMs) { sx -= pts[lo].x; sy -= pts[lo].y; lo++; }
    const k = hi - lo;
    out[i] = { x: sx / k, y: sy / k, k };
  }
  return out;
}

/**
 * Split pointer wobble into two bands (RMS, same unit as the input):
 *   noise — faster than ~4 Hz: landmark noise + tremor. Smoothing can and should remove this.
 *   sway  — about 0.6–4 Hz: the arm really moving. Smoothing cannot remove it without lag;
 *           it is handled later by pointer gain and a dead-zone.
 */
export function bandJitter(pts) {
  if (pts.length < 9) return { noise: NaN, sway: NaN };
  const fast = centredMA(pts, 80), slow = centredMA(pts, 400);
  let n2 = 0, s2 = 0, n = 0;
  for (let i = 0; i < pts.length; i++) {
    if (fast[i].k < 3 || slow[i].k < 6) continue;
    n2 += (pts[i].x - fast[i].x) ** 2 + (pts[i].y - fast[i].y) ** 2;
    s2 += (fast[i].x - slow[i].x) ** 2 + (fast[i].y - slow[i].y) ** 2;
    n++;
  }
  return n ? { noise: Math.sqrt(n2 / n), sway: Math.sqrt(s2 / n) } : { noise: NaN, sway: NaN };
}
