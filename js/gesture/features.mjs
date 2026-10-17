// features.mjs — pure geometry on MediaPipe hand landmarks (no DOM, no camera), reusable by the
// gesture engine and testable with Node.
//
// Landmarks: 0 wrist · thumb 1-4 · index 5-8 · middle 9-12 · ring 13-16 · pinky 17-20
// (each finger: MCP knuckle, PIP, DIP, TIP). Shape features use the metric `worldLandmarks`,
// so they do not depend on distance, image aspect ratio or mirroring.
//
// v2 (after the real 1 m test): finger state no longer uses "bend relative to the wrist→knuckle
// line" — a straight but spread finger points away from that line and looked bent, so OPEN failed.
// Each finger is now judged by two spread-independent measures:
//   straightness = |knuckle→tip| / (sum of the three bone lengths)   1.0 = perfectly straight
//   reach        = |wrist→tip| / |wrist→knuckle|                     ~2 extended, ~1 curled into the palm

export const FINGER_NAMES = ['index', 'middle', 'ring', 'pinky'];
export const FINGERS = { thumb: [1, 2, 3, 4], index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };
export const SHAPES = ['OPEN', 'FIST', 'POINT', 'PINCH'];

export const DEFAULT_THRESHOLDS = {
  // Values are set inside the gaps measured on real MediaPipe output (photos of open hands, fists,
  // pointing, victory and thumbs-up, at full size and shrunk to 35 px and 20 px palms):
  //   extended fingers: straightness 0.89–0.99, reach 1.52–2.34 · curled fingers: straightness 0.21–0.65, reach 0.71–1.10
  extStraight: 0.80,   // extended: straightness at least this …
  extReach: 1.35,      // … and reach at least this
  curlReach: 1.20,     // curled: reach at most this …
  curlStraight: 0.60,  // … or straightness at most this   (between the two zones a finger is "partial")
  // PINCH (v3) is a composite "OK sign" gesture, set from the user's own 1 m recording (22:44, p5–p95):
  //   PINCH: middle/ring/pinky reach 1.63–1.92 (extended) · index reach 1.12–1.30 · thumb–index gap 0.34–0.45
  //   FIST : middle/ring/pinky reach 0.64–0.89 · index 0.75–0.82 · gap 0.33–0.41   ← gap overlaps PINCH
  //   POINT: middle/ring/pinky reach 0.72–0.90 · index 1.76–1.82 · gap 0.67–0.76
  //   OPEN : middle/ring/pinky reach 1.74–2.00 · index 1.77–1.80 · gap 0.88–0.93
  // "other three fingers extended" separates PINCH from FIST and POINT; index reach and gap separate it from OPEN.
  pinchEnter: 0.56,    // gap to START a pinch: 25% of the way from PINCH p95 (0.45) to OPEN p5 (0.88)
  pinchRelease: 0.66,  // gap to END a held pinch: 50% of the way — hysteresis, so click/drag cannot chatter
  pinchIndexMin: 0.97, // index reach: midway between FIST p95 (0.82) and PINCH p5 (1.12)
  // index reach upper bound, re-calibrated on the 22:41 recording + the fresh 1 m run (NOT on the 22:44 validation set):
  //   fresh PINCH reach p10 1.46 · p50 1.55 · p90 1.59   |   open-hand frames (22:41) p1 1.685 · p5 1.714; fresh OPEN p10 1.74, POINT p10 1.76
  pinchIndexMax: 1.65,     // ENTER: midway between the pinch upper tail (~1.62) and open-hand p1 (1.685)
  pinchIndexHoldMax: 1.68, // HOLD: a held pinch tolerates slightly more reach — still below open-hand p1 (1.685)
  openThumbGap: 0.45,  // open: thumb clearly away from the index finger (open hands measured 0.62–0.91)
  fistThumbOut: 0.55,  // fist: thumb tip near the folded fingers (fist 0.18–0.20, thumbs-up 0.84–0.88)
  stableFrames: 4,     // frames a shape must persist before it is accepted
};

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
const len = (v) => Math.hypot(v.x, v.y, v.z);
export const dist = (a, b) => len(sub(a, b));
export const dist2D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function angleAt(a, b, c) { // bend at joint b, degrees (0 = straight)
  const u = sub(b, a), v = sub(c, b), lu = len(u), lv = len(v);
  if (!lu || !lv) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / (lu * lv)))) * 180) / Math.PI;
}
function segDist(p, a, b) { // distance from point p to segment ab
  const ab = sub(b, a), ap = sub(p, a), L2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const t = L2 ? clamp01((ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / L2) : 0;
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t, z: (a.z || 0) + ab.z * t });
}

/**
 * Features of one hand.
 * world: 21 metric landmarks → shape;  px: 21 image landmarks in camera pixels → size and pointer.
 */
export function handFeatures(world, px, th = DEFAULT_THRESHOLDS) {
  const w = world;
  // palm size: mean wrist→knuckle length over four fingers (steadier than one bone)
  const palm = (dist(w[0], w[5]) + dist(w[0], w[9]) + dist(w[0], w[13]) + dist(w[0], w[17])) / 4 || 1e-6;
  const fingers = {};
  for (const name of FINGER_NAMES) {
    const [m, p, d, t] = FINGERS[name];
    const path = dist(w[m], w[p]) + dist(w[p], w[d]) + dist(w[d], w[t]);
    const straight = path ? dist(w[m], w[t]) / path : 0;
    const reach = dist(w[0], w[t]) / (dist(w[0], w[m]) || 1e-6);
    fingers[name] = {
      straight, reach,
      pip: angleAt(w[m], w[p], w[d]),
      dip: angleAt(w[p], w[d], w[t]),
      state: fingerState(straight, reach, th),
    };
  }
  // closest approach between the thumb's last bone and the index finger's last bone (pads touch before tips do)
  const pinchDist = Math.min(segDist(w[4], w[7], w[8]), segDist(w[8], w[3], w[4]), dist(w[4], w[8])) / palm;
  const tipGap = dist(w[4], w[8]) / palm;
  const thumbOut = Math.min(dist(w[4], w[6]), dist(w[4], w[10])) / palm;   // thumb tip vs. index / middle PIP
  // palm plane orientation: 1 = palm (or back) square to the camera, 0 = edge-on. Diagnostic only.
  const a = sub(w[5], w[0]), b = sub(w[17], w[0]);
  const n = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  const facing = len(n) ? Math.abs(n.z) / len(n) : 0;
  // apparent size and pointer anchor (image pixels)
  const palmWidthPx = dist2D(px[5], px[17]);
  const anchor = {
    x: (px[0].x + px[5].x + px[9].x + px[13].x + px[17].x) / 5,   // palm centre: 5 points averaged → steadier
    y: (px[0].y + px[5].y + px[9].y + px[13].y + px[17].y) / 5,
  };
  return {
    palm, fingers, pinchDist, tipGap, thumbOut, facing,
    palmWidthPx,
    handLengthPx: dist2D(px[0], px[12]),
    scalePx: dist2D(px[0], px[9]),
    anchor,
    knuckle: { x: px[5].x, y: px[5].y },
  };
}

export function fingerState(straight, reach, th = DEFAULT_THRESHOLDS) {
  if (straight >= th.extStraight && reach >= th.extReach) return 'extended';
  if (reach <= th.curlReach || straight <= th.curlStraight) return 'curled';
  return 'partial';
}

/** The few numbers the classifier needs — stored per frame so a recording can be re-scored later. */
export function compact(f) {
  return {
    straight: FINGER_NAMES.map((n) => +f.fingers[n].straight.toFixed(3)),
    reach: FINGER_NAMES.map((n) => +f.fingers[n].reach.toFixed(3)),
    pinchDist: +f.pinchDist.toFixed(3),
    thumbOut: +f.thumbOut.toFixed(3),
  };
}
/** Rebuild a feature object from `compact()` output. */
export function fromCompact(c) {
  const fingers = {};
  FINGER_NAMES.forEach((n, i) => { fingers[n] = { straight: c.straight[i], reach: c.reach[i] }; });
  return { fingers, pinchDist: c.pinchDist, thumbOut: c.thumbOut };
}

/* ---------- classification with an explanation ---------- */

// soft margin: 0.5 exactly at the threshold, 1 (or 0) one `width` beyond it
const atLeast = (v, t, wd) => clamp01(0.5 + (v - t) / (2 * wd));
const atMost = (v, t, wd) => clamp01(0.5 + (t - v) / (2 * wd));

function fingerExtScore(f, th) { return Math.min(atLeast(f.straight, th.extStraight, 0.08), atLeast(f.reach, th.extReach, 0.25)); }
function fingerCurlScore(f, th) { return Math.max(atMost(f.reach, th.curlReach, 0.2), atMost(f.straight, th.curlStraight, 0.1)); }

/**
 * For every shape: the conditions it needs, their measured values, pass/fail and a 0–1 confidence
 * (the weakest condition). Used for the decision AND for the "why did it fail" readout.
 */
export function explain(f, th = DEFAULT_THRESHOLDS, pinchHeld = false) {
  const F = f.fingers;
  const st = (n) => fingerState(F[n].straight, F[n].reach, th);
  const ext = (n) => ({ label: `${n} extended`, ok: st(n) === 'extended', score: fingerExtScore(F[n], th), value: `straight ${F[n].straight.toFixed(2)} (≥${th.extStraight}), reach ${F[n].reach.toFixed(2)} (≥${th.extReach})` });
  const curl = (n) => ({ label: `${n} curled`, ok: st(n) === 'curled', score: fingerCurlScore(F[n], th), value: `reach ${F[n].reach.toFixed(2)} (≤${th.curlReach}) or straight ${F[n].straight.toFixed(2)} (≤${th.curlStraight})` });
  const cond = {
    OPEN: [...FINGER_NAMES.map(ext),
      { label: 'thumb away from index', ok: f.pinchDist >= th.openThumbGap, score: atLeast(f.pinchDist, th.openThumbGap, 0.12), value: `gap ${f.pinchDist.toFixed(2)} (≥${th.openThumbGap})` }],
    FIST: [...FINGER_NAMES.map(curl),
      { label: 'thumb tucked', ok: f.thumbOut <= th.fistThumbOut, score: atMost(f.thumbOut, th.fistThumbOut, 0.15), value: `thumb out ${f.thumbOut.toFixed(2)} (≤${th.fistThumbOut})` }],
    POINT: [ext('index'), curl('middle'), curl('ring'), curl('pinky')],
    PINCH: (() => {
      const gapMax = pinchHeld ? th.pinchRelease : th.pinchEnter;   // hysteresis: easier to keep than to start
      const r = F.index.reach;
      const reachMax = pinchHeld ? (th.pinchIndexHoldMax ?? th.pinchIndexMax) : th.pinchIndexMax;   // index-reach hysteresis
      return [
        { label: pinchHeld ? 'thumb still near index (release gap)' : 'thumb meets index (enter gap)', ok: f.pinchDist <= gapMax, score: atMost(f.pinchDist, gapMax, 0.08), value: `gap ${f.pinchDist.toFixed(2)} (≤${gapMax})` },
        { label: 'index tilted toward thumb', ok: r >= th.pinchIndexMin && r <= reachMax, score: Math.min(atLeast(r, th.pinchIndexMin, 0.12), atMost(r, reachMax, 0.06)), value: `index reach ${r.toFixed(2)} (${th.pinchIndexMin}–${reachMax}${pinchHeld ? ', hold' : ''})` },
        ext('middle'), ext('ring'), ext('pinky'),
      ];
    })(),
  };
  const out = {};
  for (const s of SHAPES) {
    const c = cond[s];
    out[s] = { ok: c.every((x) => x.ok), confidence: Math.min(...c.map((x) => x.score)), conditions: c, failed: c.filter((x) => !x.ok) };
  }
  return out;
}

/** Per-frame shape (before temporal smoothing) and its confidence. Priority resolves rare overlaps. */
/** pinchHeld: was the previous frame (of this same stream) a PINCH? Selects the release gap. */
export function classifyDetailed(f, th = DEFAULT_THRESHOLDS, pinchHeld = false) {
  const ex = explain(f, th, pinchHeld);
  for (const s of ['PINCH', 'POINT', 'FIST', 'OPEN']) if (ex[s].ok) return { shape: s, confidence: ex[s].confidence, explain: ex };
  let best = SHAPES[0], conf = -1;
  for (const s of SHAPES) if (ex[s].confidence > conf) { conf = ex[s].confidence; best = s; }
  return { shape: 'NONE', confidence: 0, nearest: best, nearestConfidence: conf, explain: ex };
}
export function classify(f, th = DEFAULT_THRESHOLDS, pinchHeld = false) { return classifyDetailed(f, th, pinchHeld).shape; }

/** Accept a new shape only after it has persisted for `frames` consecutive frames. */
export class ShapeStabilizer {
  constructor(frames = DEFAULT_THRESHOLDS.stableFrames, dropAfter = 3) {
    this.frames = frames;
    this.dropAfter = dropAfter;
    this.reset();
  }
  reset() { this.stable = 'NONE'; this.candidate = 'NONE'; this.count = 0; this.missing = 0; this.changes = 0; }
  /** raw: shape string, or null when no hand was detected this frame */
  push(raw) {
    if (raw === null) {
      if (++this.missing >= this.dropAfter && this.stable !== 'NONE') { this.stable = 'NONE'; this.changes++; }
      this.candidate = 'NONE'; this.count = 0;
      return this.stable;
    }
    this.missing = 0;
    if (raw === this.candidate) this.count++;
    else { this.candidate = raw; this.count = 1; }
    if (this.candidate !== this.stable && this.count >= this.frames) { this.stable = this.candidate; this.changes++; }
    return this.stable;
  }
}

/** Old v1 bend measure, kept only so the lab can show why v1 failed. */
export function legacyBend(world, [a, b, c, d]) {
  const base = sub(world[a], world[0]);
  const s1 = sub(world[b], world[a]), s2 = sub(world[c], world[b]), s3 = sub(world[d], world[c]);
  const ang = (u, v) => { const lu = len(u), lv = len(v); return lu && lv ? (Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / (lu * lv)))) * 180) / Math.PI : 0; };
  return { mcp: ang(base, s1), total: ang(base, s1) + ang(s1, s2) + ang(s2, s3) };
}

/* ---------- temporal robustness (v2.1) ----------
   A single bad landmark frame (motion blur, the tracker's crop lagging the hand) can make one
   finger look bent for 1–2 frames. These two stages absorb that without changing what a gesture
   is: the thresholds above are untouched. */

/** Element-wise median of the last `k` compact feature vectors (k = 3 removes isolated 1-frame glitches). */
export class FeatureSmoother {
  constructor(k = 3, gapMs = 200) { this.k = k; this.gapMs = gapMs; this.buf = []; this.lastT = -1e9; }
  reset() { this.buf = []; this.lastT = -1e9; }
  push(c, t) {
    if (t - this.lastT > this.gapMs) this.buf = [];
    this.lastT = t;
    this.buf.push(c);
    if (this.buf.length > this.k) this.buf.shift();
    const b = this.buf;
    if (b.length < 3) return c;
    const med = (vals) => { const s = [...vals].sort((x, y) => x - y); return s[(s.length - 1) >> 1]; };
    return {
      straight: c.straight.map((_, i) => med(b.map((x) => x.straight[i]))),
      reach: c.reach.map((_, i) => med(b.map((x) => x.reach[i]))),
      pinchDist: med(b.map((x) => x.pinchDist)),
      thumbOut: med(b.map((x) => x.thumbOut)),
    };
  }
}

/**
 * Time-window vote. The current shape stays while it holds at least `stay` of the frames in the last
 * `windowMs`; another shape takes over only when it reaches `enter`. If nothing is clear, the output
 * is NONE — for a command system, "unsure" must mean "do nothing".
 */
export class VoteStabilizer {
  constructor({ windowMs = 300, enter = 0.6, stay = 0.35, dropMs = 250 } = {}) {
    Object.assign(this, { windowMs, enter, stay, dropMs });
    this.reset();
  }
  reset() { this.items = []; this.stable = 'NONE'; this.lastSeen = -1e9; }
  /** shape: string, or null when no hand was detected; t: milliseconds */
  push(shape, t) {
    if (shape === null) {
      if (t - this.lastSeen > this.dropMs) { this.stable = 'NONE'; this.items = []; }
      return this.stable;
    }
    this.lastSeen = t;
    this.items.push({ t, s: shape });
    // keep the last 300 ms, but never fewer than 3 frames (at ≥24 fps the window holds 7+ frames anyway)
    while (this.items.length > 3 && this.items[0].t < t - this.windowMs) this.items.shift();
    const n = this.items.length;
    if (n < 3) return this.stable;
    const counts = {};
    for (const it of this.items) counts[it.s] = (counts[it.s] || 0) + 1;
    let top = shape, topN = 0;
    for (const s in counts) if (counts[s] > topN) { top = s; topN = counts[s]; }
    const share = (s) => (counts[s] || 0) / n;
    if (top !== this.stable && share(top) >= this.enter) this.stable = top;
    else if (share(this.stable) < this.stay) this.stable = share(top) >= this.enter ? top : 'NONE';
    return this.stable;
  }
}
