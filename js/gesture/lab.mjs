// lab.mjs — Phase 0 gesture feasibility lab.
// Live measurements of what this camera can track, plus a guided test per distance:
// countdown → OPEN → FIST → POINT → PINCH (3.5 s each). The first second of every
// segment is ignored (reaction time); the rest is scored against the prompted gesture.

import { createTracker, TRACKER_INFO } from './tracker.mjs';
import { handFeatures, classifyDetailed, compact, fromCompact, FeatureSmoother, VoteStabilizer, DEFAULT_THRESHOLDS, SHAPES, FINGER_NAMES } from './features.mjs';
import { replay } from './replay.mjs';
import { OneEuro, Window, RateMeter, mean, median, quantile, bandJitter } from './filters.mjs';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};

const SEG_MS = 5000;      // each prompted gesture: 5 s window …
const SETTLE_MS = 1500;   // … of which the first 1.5 s is the transition (hearing the prompt, changing hand shape) and is never scored
const SCREEN_W = 1920;    // jitter is reported in pixels of a 1920-px wide projector image
const PROMPT = {
  OPEN: { title: 'Open palm', say: 'Open palm', hint: 'Fingers spread, palm toward the camera, hand at shoulder height. Hold still.' },
  FIST: { title: 'Fist', say: 'Fist', hint: 'Close the same hand into a fist, facing the camera. Hold still.' },
  POINT: { title: 'Point', say: 'Point', hint: 'Index finger up, the other fingers folded. Hold still.' },
  PINCH: { title: 'Pinch', say: 'Pinch', hint: 'Touch the tips of thumb and index finger, other fingers relaxed. Hold still.' },
};
const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const POSE_LINKS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];

const el = {};
['video', 'overlay', 'stageEmpty', 'startBtn', 'stopBtn', 'camSelect', 'resSelect', 'modeSelect', 'poseSelect', 'engineStatus',
  'notice', 'tier', 'tierBox', 'tierWhy', 'shapeNow', 'shapeRaw', 'chips', 'raw', 'recordBtn', 'countSelect', 'voiceChk', 'lmChk',
  'nearIn', 'farIn', 'tierSource', 'resultsBody', 'recs', 'copyBtn', 'downloadBtn', 'clearBtn', 'exportMsg',
  'diagShape', 'diagFingers', 'diagMisc', 'diagShapes', 'thCode', 'thReset',
  'recDebug', 'recTimeline', 'debugChk', 'autoSaveChk',
  'rec', 'recDist', 'recBig', 'recSub', 'recBar', 'recSegs', 'recDet', 'recPalm', 'recShape', 'recPreview', 'recCancel']
  .forEach((id) => { el[id] = $(id); });
el.tierBox = document.getElementById('tierBox');
const M = {};
document.querySelectorAll('[data-m]').forEach((n) => { M[n.dataset.m] = n; });

const r1 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 10) / 10);
const r3 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 1000) / 1000);
const fmt = (v, d = 0) => (v === null || v === undefined || !isFinite(v) ? '—' : v.toFixed(d));
const pct = (v) => (v === null || v === undefined || !isFinite(v) ? '—' : Math.round(v * 100) + '%');

/* ------------------------------------------------------------------ state */
const S = {
  tracker: null,
  stream: null,
  running: false,
  thresholds: { ...DEFAULT_THRESHOLDS, ...store.get('gl.th.v2', {}) },
  tier: store.get('gl.tier', { near: 30, far: 14, source: 'provisional' }),
  smooth: new FeatureSmoother(3),     // median of 3 frames: removes isolated landmark glitches
  vote: new VoteStabilizer(),         // 300 ms time-window vote with hysteresis
  primaryAt: null,
  prevPx: null,
  last: null,
  lastUi: 0,
  rec: null,
  recTimer: 0,
  results: store.get('gl.results.v2', []),   // v2 results carry per-frame classifier inputs (v1 ones are not comparable)
  samplesById: {},          // raw samples kept in memory (localStorage only holds summaries)
  env: {},
};
const W = {
  cam: new Window(1500), latency: new Window(2000), handMs: new Window(2000), poseMs: new Window(3000),
  det: new Window(2000), conf: new Window(1000), palm: new Window(800), len: new Window(800),
  shoulder: new Window(2000), noise: new Window(1000), shapes: new Window(1500), jRaw: new Window(1500), jFilt: new Window(1500),
};
const rate = { hand: new RateMeter(1500), pose: new RateMeter(3000) };
// One Euro runs in screen px. Its beta multiplies speed in px/s: v1 used 0.007 (a value meant for much
// smaller units), so landmark noise alone pushed the cutoff to ~5–8 Hz and almost nothing was filtered.
const EURO = { minCutoff: 1.0, beta: 0.0015, dCutoff: 1.0 };
const euro = { x: new OneEuro(EURO), y: new OneEuro(EURO) };

/* --------------------------------------------------------------- notices */
function notice(msg) { el.notice.textContent = msg; el.notice.hidden = !msg; }

if (location.protocol === 'file:') {
  notice('The camera lab needs the local server. In the project folder run  npm start  and open  http://localhost:4173/gesture-lab.html');
  el.startBtn.disabled = true;
}

/* ---------------------------------------------------------------- camera */
async function startCamera() {
  notice('');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    notice('This browser cannot open the camera here. Use Chrome or Edge on http://localhost:4173/gesture-lab.html');
    return;
  }
  el.startBtn.disabled = true;
  stopStream();
  const [w, h] = el.resSelect.value.split('x').map(Number);
  const deviceId = el.camSelect.value;
  const video = { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 } };
  if (deviceId) video.deviceId = { exact: deviceId };
  try {
    el.engineStatus.textContent = 'Opening camera…';
    S.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
  } catch (err) {
    el.startBtn.disabled = false;
    el.engineStatus.textContent = 'Camera not started';
    const name = err && err.name;
    if (name === 'NotAllowedError') notice('Camera permission is blocked. Click the camera icon in the address bar, allow the camera, then press Start camera again.');
    else if (name === 'NotFoundError' || name === 'OverconstrainedError') notice('No matching camera was found. Pick another camera or resolution and try again.');
    else if (name === 'NotReadableError') notice('The camera is busy in another app (Teams, Zoom, the Camera app…). Close it and press Start camera again.');
    else notice('Could not open the camera: ' + (err && err.message ? err.message : String(err)));
    return;
  }
  el.video.srcObject = S.stream;
  await el.video.play().catch(() => {});
  await listCameras();
  const track = S.stream.getVideoTracks()[0];
  const settings = track.getSettings ? track.getSettings() : {};
  S.env.camera = track.label || 'camera';
  S.env.cameraSettings = { width: settings.width, height: settings.height, frameRate: settings.frameRate };

  if (!S.tracker) {
    try {
      const forced = new URLSearchParams(location.search).get('delegate');   // ?delegate=CPU forces the CPU path
      S.tracker = await createTracker({ delegate: forced && forced.toUpperCase(), onStatus: (m) => { el.engineStatus.textContent = 'Engine: ' + m; } });
    } catch (err) {
      notice('The tracking engine could not start: ' + (err && err.message ? err.message : String(err)));
      el.engineStatus.textContent = 'Engine failed to load';
      el.startBtn.disabled = false;
      return;
    }
  }
  applyTrackerSettings();
  el.engineStatus.textContent = `Engine: tasks-vision ${TRACKER_INFO.tasksVision} · hand ${S.tracker.delegates.hand} · pose ${S.tracker.delegates.pose} · ${S.env.camera}`;
  el.stageEmpty.hidden = true;
  el.stopBtn.disabled = false;
  el.startBtn.disabled = false;
  el.recordBtn.disabled = false;
  resetLive();
  setTimeout(resetLive, 2500);     // drop the warm-up frames (first inference compiles shaders)
  S.running = true;
  S.loop = (S.loop || 0) + 1;      // a new loop id: any older frame loop stops by itself
  scheduleFrame(S.loop);
}

function stopStream() {
  if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
  S.stream = null;
}

function stopCamera() {
  S.running = false;
  stopStream();
  el.video.srcObject = null;
  el.stageEmpty.hidden = false;
  el.stopBtn.disabled = true;
  el.recordBtn.disabled = true;
  if (S.rec) finishRecording(true);
  const ctx = el.overlay.getContext('2d');
  ctx.clearRect(0, 0, el.overlay.width, el.overlay.height);
}

async function listCameras() {
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const current = S.stream && S.stream.getVideoTracks()[0].getSettings().deviceId;
    el.camSelect.innerHTML = '';
    devices.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `Camera ${i + 1}`;
      if (d.deviceId === current) o.selected = true;
      el.camSelect.appendChild(o);
    });
  } catch (e) { /* keep the default entry */ }
}

function applyTrackerSettings() {
  if (!S.tracker) return;
  S.tracker.mode = el.modeSelect.value;
  S.tracker.poseIntervalMs = +el.poseSelect.value;
}

function resetLive() {
  Object.values(W).forEach((w) => w.clear());
  S.smooth.reset(); S.vote.reset(); S.primaryAt = null; S.prevPx = null;
  euro.x.reset(); euro.y.reset();
}

/* ------------------------------------------------------------ frame loop */
function scheduleFrame(id) {
  if (!S.running || id !== S.loop) return;
  if (el.video.requestVideoFrameCallback) el.video.requestVideoFrameCallback((now, meta) => onFrame(id, now, meta));
  else requestAnimationFrame((t) => onFrame(id, t, null));
}

function onFrame(id, now, meta) {
  if (!S.running || id !== S.loop) return;
  try { processFrame(now, meta); } catch (err) {
    console.error(err);
    notice('Tracking error: ' + (err && err.message ? err.message : String(err)));
  }
  scheduleFrame(id);
}

function camFps() {
  const it = W.cam.items;
  if (it.length < 2) return NaN;
  const a = it[0], b = it[it.length - 1];
  return b.t > a.t ? ((b.v - a.v) * 1000) / (b.t - a.t) : NaN;
}

function pickPrimary(hands) {
  if (!hands.length) { S.primaryAt = null; return null; }
  if (S.primaryAt) {
    let best = null, bd = Infinity;
    for (const h of hands) { const d = Math.hypot(h.px[0].x - S.primaryAt.x, h.px[0].y - S.primaryAt.y); if (d < bd) { bd = d; best = h; } }
    const palm = Math.hypot(best.px[5].x - best.px[17].x, best.px[5].y - best.px[17].y);
    if (bd < 3 * palm + 20) { S.primaryAt = best.px[0]; return best; }
  }
  let best = hands[0];
  for (const h of hands) if (h.px[0].y < best.px[0].y) best = h;     // the raised hand
  S.primaryAt = best.px[0];
  euro.x.reset(); euro.y.reset(); S.prevPx = null;
  return best;
}

function processFrame(now, meta) {
  const video = el.video;
  if (!video.videoWidth || !S.tracker) return;
  if (meta) W.cam.push(now, meta.presentedFrames);
  const hasCapture = !!(meta && meta.captureTime);
  const frameTime = hasCapture ? meta.captureTime : now;
  S.latKind = hasCapture ? 'Latency (capture → result)' : 'Latency (frame → result)';

  const r = S.tracker.process(video, now);
  const done = performance.now();
  const latency = done - frameTime;
  rate.hand.tick(done);
  W.latency.push(done, latency);
  W.handMs.push(done, r.handMs);
  for (const ev of r.poseEvents) { rate.pose.tick(ev.at); W.poseMs.push(ev.at, ev.ms); }

  const hand = pickPrimary(r.hands);
  let f = null, raw = null, cls = null;
  let cf = null, frameShape = null;
  if (hand) {
    f = handFeatures(hand.world, hand.px, S.thresholds);
    cf = compact(f);
    frameShape = classifyDetailed(f, S.thresholds, S.prevFrameShape === 'PINCH').shape;                       // this frame alone
    cls = classifyDetailed(fromCompact(S.smooth.push(cf, done)), S.thresholds, S.prevSmoothShape === 'PINCH');  // after the 3-frame median
    raw = cls.shape;
  } else S.smooth.reset();
  S.prevFrameShape = frameShape;   // PINCH hysteresis: a held pinch is judged by the release gap
  S.prevSmoothShape = raw;
  const clsAt = performance.now();
  const stable = S.vote.push(hand ? raw : null, done);
  W.det.push(done, hand ? 1 : 0);
  W.shapes.push(done, stable);
  if (hand) { W.conf.push(done, hand.score); W.palm.push(done, f.palmWidthPx); W.len.push(done, f.handLengthPx); }
  if (r.poseEvents.length && r.pose && r.pose.shouldersOk) W.shoulder.push(done, r.pose.shoulderPx);
  const shoulderPx = median(W.shoulder.values());

  // landmark stability: mean frame-to-frame motion of the 21 points, as % of palm width
  let noise = null;
  if (hand && S.prevPx) {
    let s = 0;
    for (let i = 0; i < 21; i++) s += Math.hypot(hand.px[i].x - S.prevPx[i].x, hand.px[i].y - S.prevPx[i].y);
    noise = ((s / 21) / f.palmWidthPx) * 100;
    W.noise.push(done, noise);
  }
  S.prevPx = hand ? hand.px : null;

  // pointer jitter: index knuckle through a virtual trackpad 0.9 shoulder-widths wide = 1920 screen px
  let ptr = null;
  // shoulders are normally 4–5 palm widths apart; a smaller value means a bad pose reading → use the palm instead
  const shoulderOk = f && isFinite(shoulderPx) && shoulderPx > 2.5 * f.palmWidthPx;
  const gain = shoulderOk ? SCREEN_W / (0.9 * shoulderPx) : (f ? SCREEN_W / (4.5 * f.palmWidthPx) : NaN);
  if (hand && isFinite(gain)) {
    const sx = f.anchor.x * gain, sy = f.anchor.y * gain;
    ptr = { sx, sy, fx: euro.x.filter(sx, done), fy: euro.y.filter(sy, done), gain, fromShoulder: shoulderOk };
    W.jRaw.push(done, { t: done, x: sx, y: sy });
    W.jFilt.push(done, { t: done, x: ptr.fx, y: ptr.fy });
  } else if (!hand) {
    euro.x.reset(); euro.y.reset(); W.jRaw.clear(); W.jFilt.clear();
  }

  S.last = { r, hand, f, cf, frameShape, raw, cls, clsAt, frameTime, stable, latency, noise, ptr, shoulderPx, done };
  if (S.rec) recordSample(S.last);
  drawOverlay(el.overlay, S.last, { screen: true });
  if (S.rec) drawPreview();
  if (done - S.lastUi > 140) { S.lastUi = done; renderLive(); }
}

/* ------------------------------------------------------------- live view */
function liveTier() {
  const det = mean(W.det.values());
  const palm = median(W.palm.values());
  if (!(det >= 0.6) || !isFinite(palm)) return { tier: 'LOST', why: det > 0 ? 'tracking: hand found in only ' + pct(det) + ' of frames' : 'no hand detected' };
  if (palm >= S.tier.near) return { tier: 'NEAR', why: `palm ${palm.toFixed(0)} px ≥ ${S.tier.near} px` };
  if (palm >= S.tier.far) return { tier: 'FAR', why: `palm ${palm.toFixed(0)} px (NEAR needs ${S.tier.near} px)` };
  return { tier: 'LOST', why: `palm ${palm.toFixed(0)} px < ${S.tier.far} px` };
}

function renderLive() {
  const L = S.last;
  if (!L) return;
  const v = el.video;
  M.camFps.textContent = fmt(camFps(), 0);
  M.camRes.textContent = `${v.videoWidth}×${v.videoHeight}`;
  M.handFps.textContent = fmt(rate.hand.rate(L.done), 0);
  M.poseFps.textContent = fmt(rate.pose.rate(L.done), 0);
  M.handMs.textContent = fmt(median(W.handMs.values()), 1);
  M.poseMs.textContent = fmt(median(W.poseMs.values()), 1);
  M.latKind.textContent = S.latKind || 'Latency';
  M.latency.textContent = fmt(median(W.latency.values()), 0);
  M.latency95.textContent = fmt(quantile(W.latency.values(), 0.95), 0);
  M.detRate.textContent = pct(mean(W.det.values()));
  M.hands.textContent = String(L.r.hands.length);
  M.conf.textContent = fmt(mean(W.conf.values()), 2);
  M.palm.textContent = fmt(median(W.palm.values()), 0);
  M.handLen.textContent = fmt(median(W.len.values()), 0);
  M.shoulder.textContent = fmt(L.shoulderPx, 0);
  M.noise.textContent = W.noise.size ? fmt(median(W.noise.values()), 1) + '%' : '—';
  const bj = bandJitter(W.jRaw.values()), bf = bandJitter(W.jFilt.values());
  M.jitRaw.textContent = fmt(bj.noise, 1);
  M.jitFilt.textContent = fmt(bf.noise, 1);
  M.sway.textContent = fmt(bj.sway, 1);
  M.input.textContent = L.r.crop.mode === 'hand' ? `hand ROI ${L.r.crop.w} px → 320 px` : L.r.crop.mode === 'body' ? `searching around you (${L.r.crop.w} px)` : `full frame ${L.r.W}×${L.r.H}`;

  const t = liveTier();
  el.tier.textContent = t.tier;
  el.tierBox.dataset.tier = t.tier;
  el.tierWhy.textContent = t.why;
  el.shapeNow.textContent = L.stable === 'NONE' ? '—' : L.stable;
  el.shapeRaw.textContent = L.hand ? `this frame: ${L.frameShape} · smoothed: ${L.raw}` : 'no hand';
  renderChips(L);
  renderDiag(L);
}

function renderDiag(L) {
  if (!L.f) {
    el.diagFingers.innerHTML = '<tr><td colspan="6" class="dim">No hand in view</td></tr>';
    el.diagMisc.innerHTML = '';
    el.diagShapes.innerHTML = '';
    el.diagShape.textContent = '—';
    return;
  }
  const f = L.f, th = S.thresholds;
  el.diagFingers.innerHTML = FINGER_NAMES.map((n) => {
    const g = f.fingers[n];
    return `<tr><td>${n}</td><td>${g.straight.toFixed(2)}</td><td>${g.reach.toFixed(2)}</td><td>${g.pip.toFixed(0)}</td><td>${g.dip.toFixed(0)}</td><td class="st-${g.state}">${g.state}</td></tr>`;
  }).join('');
  const shapeConf = L.cls.shape === 'NONE'
    ? `none (nearest ${L.cls.nearest} ${L.cls.nearestConfidence.toFixed(2)})`
    : `${L.cls.shape} ${L.cls.confidence.toFixed(2)}`;
  el.diagMisc.innerHTML =
    `<div><dt>thumb ↔ index gap</dt><dd>${f.pinchDist.toFixed(2)} <span class="dim">pinch enter ≤ ${th.pinchEnter}, release > ${th.pinchRelease}</span></dd></div>` +
    `<div><dt>thumb out</dt><dd>${f.thumbOut.toFixed(2)} <span class="dim">fist ≤ ${th.fistThumbOut}</span></dd></div>` +
    `<div><dt>hand scale</dt><dd>${(f.palm * 100).toFixed(1)} cm · ${f.scalePx.toFixed(0)} px</dd></div>` +
    `<div><dt>palm facing</dt><dd>${f.facing.toFixed(2)} <span class="dim">1 = square on</span></dd></div>` +
    `<div><dt>model handedness</dt><dd>${L.hand.label || '?'} ${fmt(L.hand.score, 2)} <span class="dim">not used</span></dd></div>` +
    `<div><dt>shape confidence</dt><dd>${shapeConf}</dd></div>`;
  el.diagShape.textContent = `frame: ${L.cls.shape} · stable: ${L.stable}`;
  el.diagShapes.innerHTML = SHAPES.map((s) => {
    const e = L.cls.explain[s];
    const why = e.ok ? 'all conditions met' : 'fails: ' + e.failed.map((c) => `${c.label} — ${c.value}`).join('; ');
    return `<li class="${e.ok ? 'ok' : 'no'}"><b>${s}</b><span>${e.confidence.toFixed(2)}</span><span class="why">${why}</span></li>`;
  }).join('');
}

function renderThresholds() {
  const t = S.thresholds;
  el.thCode.textContent = `extended: straight ≥ ${t.extStraight}, reach ≥ ${t.extReach} · curled: reach ≤ ${t.curlReach} or straight ≤ ${t.curlStraight} · pinch: gap enter ≤ ${t.pinchEnter} / release > ${t.pinchRelease}, index reach ${t.pinchIndexMin}–${t.pinchIndexMax} (hold ${t.pinchIndexHoldMax}), middle+ring+pinky extended · open thumb gap ≥ ${t.openThumbGap} · fist thumb out ≤ ${t.fistThumbOut}`;
}

function expectedFor(shape) {
  const palm = median(W.palm.values());
  const mode = el.modeSelect.value;
  const pool = S.results.filter((r) => r.settings.mode === mode);
  const list = pool.length ? pool : S.results;
  if (!list.length || !isFinite(palm)) return null;
  let best = null, bd = Infinity;
  for (const r of list) { const d = Math.abs(Math.log(palm / r.summary.palm)); if (isFinite(d) && d < bd) { bd = d; best = r; } }
  return best ? { verdict: best.segments[shape].verdict, dist: best.distance } : null;
}

function renderChips(L) {
  if (!el.chips.childElementCount) {
    SHAPES.forEach((s) => {
      const li = document.createElement('li');
      li.className = 'chip';
      li.dataset.shape = s;
      li.innerHTML = `<span class="chip__name">${s}</span><span class="chip__now">—</span><span class="chip__exp">expected: record tests</span>`;
      el.chips.appendChild(li);
    });
  }
  const vals = W.shapes.values();
  el.chips.querySelectorAll('.chip').forEach((li) => {
    const s = li.dataset.shape;
    const share = vals.length ? vals.filter((v) => v === s).length / vals.length : 0;
    li.classList.toggle('is-now', L.stable === s);
    li.querySelector('.chip__now').textContent = L.stable === s ? `● ${pct(share)}` : pct(share);
    const exp = expectedFor(s);
    const e = li.querySelector('.chip__exp');
    e.className = 'chip__exp' + (exp ? ' exp-' + exp.verdict : '');
    e.textContent = exp ? `expected here: ${exp.verdict} (${exp.dist} m test)` : 'expected: record tests';
  });
}

/* --------------------------------------------------------------- drawing */
function drawOverlay(canvas, L, { screen } = {}) {
  const ctx = canvas.getContext('2d');
  const v = el.video;
  let cw, ch, dpr;
  if (screen) {
    dpr = window.devicePixelRatio || 1;
    cw = canvas.clientWidth; ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
  } else { cw = canvas.width; ch = canvas.height; ctx.setTransform(1, 0, 0, 1, 0, 0); }
  const s = Math.min(cw / v.videoWidth, ch / v.videoHeight);
  const ox = (cw - v.videoWidth * s) / 2, oy = (ch - v.videoHeight * s) / 2;
  const X = (x) => cw - (ox + x * s);   // mirrored, like a selfie view
  const Y = (y) => oy + y * s;
  const { r, hand } = L;

  if (r.crop.mode !== 'full') {
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(92,198,187,0.75)';
    ctx.lineWidth = 1;
    ctx.strokeRect(X(r.crop.x + r.crop.w), Y(r.crop.y), r.crop.w * s, r.crop.h * s);
    ctx.setLineDash([]);
  }
  if (r.pose) {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    for (const [a, b] of POSE_LINKS) {
      if (r.pose.vis[a] < 0.3 || r.pose.vis[b] < 0.3) continue;
      ctx.beginPath(); ctx.moveTo(X(r.pose.pts[a].x), Y(r.pose.pts[a].y)); ctx.lineTo(X(r.pose.pts[b].x), Y(r.pose.pts[b].y)); ctx.stroke();
    }
  }
  for (const h of r.hands) {
    const primary = h === hand;
    ctx.strokeStyle = primary ? '#33b0a5' : 'rgba(51,176,165,0.45)';
    ctx.lineWidth = primary ? 2 : 1.25;
    for (const [a, b] of HAND_LINKS) { ctx.beginPath(); ctx.moveTo(X(h.px[a].x), Y(h.px[a].y)); ctx.lineTo(X(h.px[b].x), Y(h.px[b].y)); ctx.stroke(); }
    for (let i = 0; i < 21; i++) {
      ctx.fillStyle = i === 4 || i === 8 ? '#e0c676' : '#eef2f8';
      ctx.beginPath(); ctx.arc(X(h.px[i].x), Y(h.px[i].y), primary ? 2.6 : 1.8, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (hand && L.f && screen) {
    const label = `${L.stable === 'NONE' ? '…' : L.stable} · palm ${L.f.palmWidthPx.toFixed(0)} px`;
    ctx.font = '600 13px "IBM Plex Mono", monospace';
    const tx = X(hand.px[0].x) - 40, ty = Y(hand.px[0].y) + 24;
    ctx.fillStyle = 'rgba(5,15,34,0.75)';
    ctx.fillRect(tx - 6, ty - 15, ctx.measureText(label).width + 12, 21);
    ctx.fillStyle = '#eef2f8';
    ctx.fillText(label, tx, ty);
  }
}

function drawPreview() {
  const c = el.recPreview, ctx = c.getContext('2d'), v = el.video;
  ctx.setTransform(-1, 0, 0, 1, c.width, 0);
  const s = Math.min(c.width / v.videoWidth, c.height / v.videoHeight);
  const w = v.videoWidth * s, h = v.videoHeight * s;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(v, (c.width - w) / 2, (c.height - h) / 2, w, h);
  drawOverlay(c, S.last, { screen: false });
}

/* -------------------------------------------------------- sound & voice */
let audio = null;
function beep(freq = 880, dur = 0.12, vol = 0.18) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + dur + 0.02);
  } catch (e) { /* sound is optional */ }
}
// Prefer a voice installed on this computer: network voices can start 0.3–1.5 s late.
let voice = null;
function pickVoice() {
  const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  const en = vs.filter((v) => /^en/i.test(v.lang));
  voice = en.find((v) => v.localService) || vs.find((v) => v.localService) || en[0] || null;
}
if (window.speechSynthesis) { pickVoice(); speechSynthesis.addEventListener('voiceschanged', pickVoice); }
/** Speak; onStart receives the time the voice actually started (performance.now()). */
function say(text, onStart) {
  if (!el.voiceChk.checked || !window.speechSynthesis) return false;
  try {
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 1.1;
    if (onStart) u.onstart = () => onStart(performance.now());
    speechSynthesis.speak(u);
    return true;
  } catch (e) { return false; }
}

/* ------------------------------------------------------------ recording */
// Timeline of one test (t = 0 at the first prompt):
//   gesture k occupies [k·SEG_MS, (k+1)·SEG_MS): the first SETTLE_MS are the transition (never scored),
//   the remaining SEG_MS − SETTLE_MS are scored. Frames are labelled by CAMERA CAPTURE time.
function startRecording() {
  if (!S.running || S.rec) return;
  const dist = +document.querySelector('input[name="dist"]:checked').value;
  const countdown = +el.countSelect.value * 1000;
  if (audio && audio.state === 'suspended') audio.resume();
  beep(440, 0.05, 0.001); // unlock audio inside the click
  S.rec = {
    id: 'r' + Date.now(),
    dist,
    t0: performance.now() + countdown,
    samples: [],
    events: [],
    segIdx: -1,
    lastSec: null,
    lastCap: -Infinity,
    outOfOrder: 0,
    includeLm: el.lmChk.checked,
    settings: {
      mode: el.modeSelect.value,
      poseIntervalMs: +el.poseSelect.value,
      requested: el.resSelect.value,
      actual: `${el.video.videoWidth}x${el.video.videoHeight}`,
      camera: S.env.camera,
      delegates: { ...S.tracker.delegates },
      thresholds: { ...S.thresholds },
      protocol: { segmentMs: SEG_MS, settleMs: SETTLE_MS, scoreMs: SEG_MS - SETTLE_MS, order: SHAPES, labelClock: 'camera capture time' },
      voice: voice ? `${voice.name} (${voice.localService ? 'local' : 'network'})` : (el.voiceChk.checked ? 'default' : 'off'),
    },
  };
  el.recDist.textContent = `Test at ${dist} m`;
  el.recBig.classList.remove('is-gesture');
  el.recSegs.querySelectorAll('li').forEach((li) => li.classList.remove('is-now', 'is-done'));
  el.rec.hidden = false;
  el.recDebug.hidden = el.recTimeline.hidden = !el.debugChk.checked;
  say(`Walk to ${dist} meter${dist > 1 ? 's' : ''}`);
  S.recRaf = requestAnimationFrame(recTick);
}

function recTick() {
  const rec = S.rec;
  if (!rec) return;
  const now = performance.now();
  const t = now - rec.t0;
  const L = S.last;
  el.recDet.textContent = L && L.hand ? 'Hand: seen' : 'Hand: not seen';
  el.recDet.className = L && L.hand ? 'ok' : 'no';
  el.recPalm.textContent = `Palm: ${L && L.f ? L.f.palmWidthPx.toFixed(0) : '—'} px`;
  el.recShape.textContent = `Seen: ${L && L.stable !== 'NONE' ? L.stable : '—'}`;
  if (t < 0) {
    const secs = Math.ceil(-t / 1000);
    if (secs !== rec.lastSec) { rec.lastSec = secs; el.recBig.textContent = String(secs); if (secs <= 3) beep(660, 0.09); }
    el.recSub.textContent = `Walk to the ${rec.dist} m mark, face the camera, and raise your presenting hand to shoulder height.`;
    el.recBar.style.width = '0%';
    if (el.debugChk.checked) { el.recDebug.textContent = `countdown ${(-t / 1000).toFixed(1)} s`; drawTimeline(el.recTimeline, rec, -1); }
    S.recRaf = requestAnimationFrame(recTick);
    return;
  }
  const idx = Math.floor(t / SEG_MS);
  if (idx >= SHAPES.length) { finishRecording(false); return; }
  if (idx !== rec.segIdx) {
    rec.segIdx = idx;
    const p = PROMPT[SHAPES[idx]];
    const ev = { seg: SHAPES[idx], scheduled: idx * SEG_MS, scoreFrom: idx * SEG_MS + SETTLE_MS, scoreTo: (idx + 1) * SEG_MS };
    el.recBig.textContent = p.title;
    el.recBig.classList.add('is-gesture');
    el.recSub.textContent = p.hint;
    el.recSegs.querySelectorAll('li').forEach((li, i) => { li.classList.toggle('is-now', i === idx); li.classList.toggle('is-done', i < idx); });
    ev.shown = Math.round(performance.now() - rec.t0);
    beep(990, 0.12);
    ev.beep = Math.round(performance.now() - rec.t0);
    ev.voiceRequested = say(p.say, (at) => { ev.voiceStart = Math.round(at - rec.t0); });
    rec.events.push(ev);
  }
  const into = t - idx * SEG_MS;
  el.recBar.style.width = Math.min(100, (t / (SEG_MS * SHAPES.length)) * 100) + '%';
  if (el.debugChk.checked) {
    const last = rec.samples[rec.samples.length - 1];
    el.recDebug.innerHTML =
      `EXPECTED <b>${SHAPES[idx]}</b> · into gesture <b>${(into / 1000).toFixed(2)} s</b> · ` +
      `<b class="${into < SETTLE_MS ? 'ph-settle' : 'ph-score'}">${into < SETTLE_MS ? 'TRANSITION (not scored)' : 'SCORING'}</b> · ` +
      `raw <b>${last ? last.raw || 'no hand' : '—'}</b> · stable <b>${last ? last.stable : '—'}</b> · frame age <b>${last ? last.age + ' ms' : '—'}</b>`;
    drawTimeline(el.recTimeline, rec, t);
  }
  S.recRaf = requestAnimationFrame(recTick);
}

function recordSample(L) {
  const rec = S.rec;
  const t = L.frameTime - rec.t0;                     // label by when the camera captured the frame
  if (t < 0 || t >= SEG_MS * SHAPES.length) return;
  if (t <= rec.lastCap) rec.outOfOrder++;             // should never happen (inference is synchronous)
  rec.lastCap = t;
  const idx = Math.floor(t / SEG_MS);
  const into = t - idx * SEG_MS;
  const f = L.f, h = L.hand;
  const s = {
    t: Math.round(t),                                 // camera capture time, ms since the first prompt
    res: Math.round(L.done - rec.t0),                 // MediaPipe result time
    cls: Math.round(L.clsAt - rec.t0),                // classifier finished
    age: Math.round(L.done - L.frameTime),            // frame age when its result arrived
    seg: SHAPES[idx],                                 // expected gesture
    into: Math.round(into),                           // time into the current gesture window
    settle: into < SETTLE_MS,                         // transition frames are never scored
    det: !!h,
    nHands: L.r.hands.length,
    conf: h ? r3(h.score) : null,
    palm: f ? r1(f.palmWidthPx) : null,
    len: f ? r1(f.handLengthPx) : null,
    shoulder: L.r.pose && L.r.pose.shouldersOk ? r1(L.r.pose.shoulderPx) : null,
    raw: h ? L.frameShape : null,                     // this frame alone
    smooth: h ? L.raw : null,                         // after the 3-frame median
    stable: L.stable,                                 // after the vote
    cf: L.cf,                                         // classifier inputs → the recording can be re-scored
    shapeConf: L.cls ? r3(L.cls.shape === 'NONE' ? 0 : L.cls.confidence) : null,
    fail: L.cls ? L.cls.explain[SHAPES[idx]].failed.map((c) => c.label) : null,
    facing: f ? r3(f.facing) : null,
    ptr: L.ptr ? [r1(L.ptr.sx), r1(L.ptr.sy), r1(L.ptr.fx), r1(L.ptr.fy)] : null,
    noise: L.noise !== null ? r1(L.noise) : null,
    lat: r1(L.latency),
    handMs: r1(L.r.handMs),
    poseMs: L.r.poseEvents.length ? r1(L.r.poseEvents[L.r.poseEvents.length - 1].ms) : null,
    cam: r1(camFps()),
    handFps: r1(rate.hand.rate(L.done)),
    poseFps: r1(rate.pose.rate(L.done)),
    crop: L.r.crop.mode !== 'full' ? L.r.crop.w : 0,
    cropMode: L.r.crop.mode,
  };
  if (rec.includeLm && h) {
    s.world = h.world.flatMap((p) => [r3(p.x * 100) / 100, r3(p.y * 100) / 100, r3(p.z * 100) / 100]);
    s.px = h.px.flatMap((p) => [r1(p.x), r1(p.y)]);
  }
  rec.samples.push(s);
}

function finishRecording(cancelled) {
  cancelAnimationFrame(S.recRaf);
  const rec = S.rec;
  S.rec = null;
  el.rec.hidden = true;
  if (!rec) return;
  if (cancelled) { say('Test cancelled'); return; }
  beep(520, 0.3);
  say('Test complete');
  const result = analyze(rec);
  S.samplesById[result.id] = rec.samples;
  S.results = S.results.filter((r) => !(r.distance === result.distance && r.settings.mode === result.settings.mode));
  S.results.push(result);
  S.results.sort((a, b) => a.distance - b.distance || a.settings.mode.localeCompare(b.settings.mode));
  saveResults();
  renderResults();
  if (el.autoSaveChk.checked) downloadReport();   // keep the per-frame data for the regression suite
}

/* ------------------------------------------------------------- timeline */
const SHAPE_COLOR = { OPEN: '#5cc6bb', FIST: '#e0c676', POINT: '#8fb4ee', PINCH: '#e58fb0', NONE: '#4a5568' };

/**
 * Debug timeline: EXPECTED (transition part hatched), RAW, SMOOTHED, STABLE shape per frame,
 * FRAME AGE, plus prompt markers (white = text shown, gold = voice started).
 * `rec` needs .samples and .events; nowT < 0 hides the cursor.
 */
function drawTimeline(canvas, rec, nowT) {
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth || 900, ch = canvas.clientHeight || 160;
  if (canvas.width !== Math.round(cw * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const total = SEG_MS * SHAPES.length, left = 112, right = cw - 8;
  const X = (t) => left + (t / total) * (right - left);
  const rows = ['EXPECTED', 'RAW SHAPE', 'SMOOTHED', 'STABLE SHAPE', 'FRAME AGE'];
  const rh = (ch - 18) / rows.length;
  ctx.font = '600 10px "Libre Franklin", sans-serif';
  rows.forEach((r, i) => { ctx.fillStyle = 'rgba(238,242,248,0.55)'; ctx.fillText(r, 4, 12 + i * rh + rh / 2); });
  // expected
  SHAPES.forEach((s, k) => {
    const x0 = X(k * SEG_MS), x1 = X((k + 1) * SEG_MS), xs = X(k * SEG_MS + SETTLE_MS);
    ctx.fillStyle = SHAPE_COLOR[s]; ctx.globalAlpha = 0.9; ctx.fillRect(xs, 4, x1 - xs, rh - 6);
    ctx.globalAlpha = 0.28; ctx.fillRect(x0, 4, xs - x0, rh - 6);
    ctx.globalAlpha = 1; ctx.fillStyle = '#050f22'; ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.fillText(s, xs + 4, 4 + rh / 2 + 2);
  });
  // per-frame rows
  const rowY = (i) => 4 + i * rh;
  const samples = rec.samples;
  for (let j = 0; j < samples.length; j++) {
    const s = samples[j], x0 = X(s.t), x1 = j + 1 < samples.length ? X(samples[j + 1].t) : x0 + 2;
    const w = Math.max(1, Math.min(x1 - x0, 6));
    [[1, s.raw], [2, s.smooth], [3, s.stable]].forEach(([row, shape]) => {
      ctx.fillStyle = shape ? SHAPE_COLOR[shape] || SHAPE_COLOR.NONE : '#000';
      ctx.globalAlpha = s.settle ? 0.45 : 1;
      ctx.fillRect(x0, rowY(row), w, rh - 6);
    });
    ctx.globalAlpha = 1;
    const age = Math.min(s.age, 150) / 150;
    ctx.fillStyle = s.age > 80 ? '#ff7a6b' : '#5cc6bb';
    ctx.fillRect(x0, rowY(4) + (rh - 6) * (1 - age), w, (rh - 6) * age);
  }
  ctx.fillStyle = 'rgba(238,242,248,0.5)'; ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillText('150 ms', right - 40, rowY(4) + 9);
  // prompt markers
  for (const ev of rec.events) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(X(ev.shown), 0, 1.5, ch - 14);
    if (ev.voiceStart !== undefined) { ctx.fillStyle = '#e0c676'; ctx.fillRect(X(ev.voiceStart), 0, 1.5, ch - 14); }
  }
  // seconds axis + cursor
  ctx.fillStyle = 'rgba(238,242,248,0.45)';
  for (let s = 0; s <= total / 1000; s += 5) ctx.fillText(s + ' s', X(s * 1000) - 6, ch - 3);
  if (nowT >= 0) { ctx.fillStyle = '#ff7a6b'; ctx.fillRect(X(Math.min(nowT, total)), 0, 2, ch - 14); }
}

/* --------------------------------------------------------------- analysis */
function verdictFor(seg) {
  if (seg.frames < 12) return 'insufficient';   // fewer than ~12 scored frames: too slow to judge
  if (seg.detection >= 0.9 && seg.stableRate >= 0.9 && seg.flickerPerSec <= 0.8) return 'reliable';
  if (seg.detection >= 0.7 && seg.stableRate >= 0.7) return 'marginal';
  return 'disable';
}

/**
 * Score each prompted gesture by replaying the stored per-frame features through exactly the live
 * pipeline (3-frame feature median → classifier → 300 ms vote) with thresholds `th`.
 * Also separates failures into short glitches (1–2 frames in a row) and sustained failures (≥3).
 */
function scoreSegments(samples, th) {
  const tl = replay(samples, th);   // the same pipeline the regression validator uses
  const segments = {};
  for (const shape of SHAPES) {
    const idx = samples.map((s, i) => i).filter((i) => samples[i].seg === shape && !samples[i].settle);
    const n = idx.length;
    let dn = 0, rawHit = 0, smoothHit = 0, stableHit = 0, changes = 0, glitch = 0, sustained = 0;
    const fails = {}, glitchFails = {};
    let run = [];
    const closeRun = () => {
      if (!run.length) return;
      const short = run.length <= 2;
      if (short) glitch += run.length; else sustained += run.length;
      for (const j of run) {
        const t = tl[j], bucket = short ? glitchFails : fails;
        if (!t.ex) bucket['hand not detected'] = (bucket['hand not detected'] || 0) + 1;
        else if (t.ex[shape].ok) bucket[`classified as ${t.raw} instead`] = (bucket[`classified as ${t.raw} instead`] || 0) + 1;
        else t.ex[shape].failed.forEach((x) => { bucket[x.label] = (bucket[x.label] || 0) + 1; });
      }
      run = [];
    };
    let prev = idx.length ? tl[idx[0] - 1 >= 0 ? idx[0] - 1 : idx[0]].stable : 'NONE';
    for (const i of idx) {
      const t = tl[i];
      if (samples[i].cf) dn++;
      if (t.raw === shape) { rawHit++; closeRun(); } else run.push(i);
      if (t.smooth === shape) smoothHit++;
      if (t.stable === shape) stableHit++;
      if (t.stable !== prev) changes++;
      prev = t.stable;
    }
    closeRun();
    const secs = n > 1 ? (samples[idx[n - 1]].t - samples[idx[0]].t) / 1000 : 0;
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, k]) => ({ label, share: n ? k / n : 0 }));
    const seg = {
      frames: n,
      detection: n ? dn / n : 0,
      rawRate: n ? rawHit / n : 0,          // single frames, no smoothing
      smoothRate: n ? smoothHit / n : 0,    // after the 3-frame feature median
      stableRate: n ? stableHit / n : 0,    // after the vote — what a gesture system would act on
      flickerPerSec: secs ? changes / secs : 0,
      glitchShare: n ? glitch / n : 0,      // failing frames in runs of 1–2
      sustainedShare: n ? sustained / n : 0, // failing frames in runs of 3 or more
      topFailures: top(fails),
      glitchReasons: top(glitchFails),
    };
    seg.verdict = verdictFor(seg);
    segments[shape] = seg;
  }
  return segments;
}

/** p10 / median / p90 of the classifier inputs inside each prompted gesture (detected frames). */
function featureStats(samples) {
  const out = {};
  const q = (arr) => (arr.length ? { p10: r3(quantile(arr, 0.1)), med: r3(median(arr)), p90: r3(quantile(arr, 0.9)) } : null);
  for (const shape of SHAPES) {
    const ss = samples.filter((s) => !s.settle && s.seg === shape && s.cf);
    const o = { n: ss.length };
    FINGER_NAMES.forEach((name, i) => {
      o[name] = { straight: q(ss.map((s) => s.cf.straight[i])), reach: q(ss.map((s) => s.cf.reach[i])) };
    });
    o.pinchDist = q(ss.map((s) => s.cf.pinchDist));
    o.thumbOut = q(ss.map((s) => s.cf.thumbOut));
    o.facing = q(ss.map((s) => s.facing).filter((v) => v !== null));
    out[shape] = o;
  }
  return out;
}

/**
 * Range tier = what the TRACKING can do at this distance (detection + apparent hand size).
 * It used to require all four gestures to be reliable as well, which mixed two questions: your
 * 1 m run (98% detected, 49 px palm) was labelled LIMITED only because recognition was at 79–89%.
 * Recognition is now reported separately (the gesture columns and "n/4 reliable").
 */
function tierFor(summary) {
  if (summary.detection < 0.7 || !isFinite(summary.palm)) return 'LOST';
  if (summary.detection >= 0.9 && summary.palm >= S.tier.near) return 'NEAR';
  if (summary.palm >= S.tier.far) return 'FAR';
  return 'LOST';
}

/** Recorder audit: when each prompt really happened, when scoring began, how fast you reacted, frame ages. */
function buildAudit(rec) {
  const s = rec.samples;
  const perGesture = SHAPES.map((shape, k) => {
    const ev = rec.events.find((e) => e.seg === shape) || {};
    const seg = s.filter((x) => x.seg === shape);
    const sc = seg.filter((x) => !x.settle);
    // reaction: first frame where the single-frame shape matches and keeps matching (≥70% of the next 300 ms)
    let reaction = null;
    for (let i = 0; i < seg.length && reaction === null; i++) {
      if (seg[i].raw !== shape) continue;
      const win = seg.filter((x) => x.t >= seg[i].t && x.t < seg[i].t + 300);
      if (win.length >= 3 && win.filter((x) => x.raw === shape).length / win.length >= 0.7) reaction = seg[i].into;
    }
    const ages = seg.map((x) => x.age);
    return {
      seg: shape,
      scheduled: k * SEG_MS,
      shown: ev.shown ?? null,
      beep: ev.beep ?? null,
      voiceStart: ev.voiceStart ?? null,
      scoreFrom: k * SEG_MS + SETTLE_MS,
      firstScoredFrame: sc.length ? sc[0].t : null,
      settleFrames: seg.length - sc.length,
      scoredFrames: sc.length,
      reactionMs: reaction,
      lateReaction: reaction === null || reaction > SETTLE_MS,
      ageMedian: ages.length ? Math.round(median(ages)) : null,
      ageMax: ages.length ? Math.max(...ages) : null,
    };
  });
  return {
    labelClock: 'camera capture time',
    frames: s.length,
    outOfOrder: rec.outOfOrder,
    transitionFramesScored: s.filter((x) => x.settle && x.into >= SETTLE_MS).length + s.filter((x) => !x.settle && x.into < SETTLE_MS).length,
    perGesture,
  };
}

function auditHtml(r) {
  if (!r.audit) return '';
  const ms = (v) => (v === null || v === undefined ? '—' : `${(v / 1000).toFixed(2)} s`);
  const d = (v, ref) => (v === null || v === undefined ? '' : ` <span class="dim">(+${v - ref} ms)</span>`);
  const rows = r.audit.perGesture.map((g) => `<tr>
    <td>${g.seg}</td><td>${ms(g.scheduled)}</td><td>${ms(g.shown)}${d(g.shown, g.scheduled)}</td><td>${ms(g.voiceStart)}${d(g.voiceStart, g.scheduled)}</td>
    <td>${ms(g.scoreFrom)}</td><td>${ms(g.firstScoredFrame)}</td><td>${g.settleFrames} / ${g.scoredFrames}</td>
    <td class="${g.lateReaction ? 'v-disable' : 'v-reliable'}">${g.reactionMs === null ? 'never stable' : (g.reactionMs / 1000).toFixed(2) + ' s'}</td>
    <td>${g.ageMedian ?? '—'} / ${g.ageMax ?? '—'} ms</td></tr>`).join('');
  return `<p>Recorder audit — frames labelled by ${r.audit.labelClock}; ${r.audit.frames} frames; out-of-order frames: ${r.audit.outOfOrder}; transition frames scored: ${r.audit.transitionFramesScored}.</p>
  <table><thead><tr><th>Gesture</th><th>Scheduled</th><th>Text shown</th><th>Voice started</th><th>Scoring from</th><th>First scored frame</th><th>Frames transition / scored</th><th>Your reaction</th><th>Frame age med / max</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="dim">Reaction = time from the prompt until the camera saw the new gesture steadily. Red means it took longer than the ${SETTLE_MS / 1000} s transition, so some of your previous gesture fell into the scored window.</p>`;
}

function finalizeResult(r) {
  r.reliable = SHAPES.filter((s) => r.segments[s].verdict === 'reliable');
  r.marginal = SHAPES.filter((s) => r.segments[s].verdict === 'marginal');
  r.disable = SHAPES.filter((s) => r.segments[s].verdict === 'disable' || r.segments[s].verdict === 'insufficient');
  r.tier = tierFor(r.summary);
  r.gestureCount = r.reliable.length;
  return r;
}

function analyze(rec) {
  const scored = rec.samples.filter((s) => !s.settle);
  const det = scored.filter((s) => s.det);
  const noiseR = [], noiseF = [], sway = [];
  for (const shape of ['OPEN', 'POINT']) {
    const pts = scored.filter((s) => s.seg === shape && s.ptr);
    const a = bandJitter(pts.map((s) => ({ t: s.t, x: s.ptr[0], y: s.ptr[1] })));
    const b = bandJitter(pts.map((s) => ({ t: s.t, x: s.ptr[2], y: s.ptr[3] })));
    if (isFinite(a.noise)) { noiseR.push(a.noise); sway.push(a.sway); }
    if (isFinite(b.noise)) noiseF.push(b.noise);
  }
  const val = (key, from = scored) => from.map((s) => s[key]).filter((v) => v !== null && v !== undefined && isFinite(v));
  const summary = {
    frames: scored.length,
    detection: scored.length ? det.length / scored.length : 0,
    confidence: r3(mean(val('conf', det))),
    palm: r1(mean(val('palm', det))),
    handLength: r1(mean(val('len', det))),
    shoulder: r1(mean(val('shoulder'))),
    camFps: r1(mean(val('cam'))),
    handFps: r1(mean(val('handFps'))),
    poseFps: r1(mean(val('poseFps'))),
    latencyMedian: r1(median(val('lat'))),
    latencyP95: r1(quantile(val('lat'), 0.95)),
    handMs: r1(median(val('handMs'))),
    poseMs: r1(median(val('poseMs'))),
    landmarkNoise: r1(median(val('noise', det))),
    pointerNoiseRaw: r1(mean(noiseR)),
    pointerNoiseFiltered: r1(mean(noiseF)),
    pointerSway: r1(mean(sway)),
    cropPx: r1(median(val('crop').filter((v) => v > 0))),
  };
  return finalizeResult({
    id: rec.id, distance: rec.dist, recordedAt: new Date().toISOString(), settings: rec.settings,
    summary, segments: scoreSegments(rec.samples, S.thresholds), features: featureStats(rec.samples),
    thresholdsUsed: { ...S.thresholds }, hasSamples: true,
    events: rec.events, audit: buildAudit(rec),
  });
}

/**
 * Threshold suggestions from a recording: each boundary goes into the gap between the classes it
 * separates (p95 of one side, p5 of the other). If the classes overlap, nothing is moved: overlap
 * means the signal is not there, and loosening would only add false gestures.
 */
function suggestThresholds(samples) {
  const pick = (shape) => samples.filter((s) => !s.settle && s.seg === shape && s.cf);
  const take = (ss, idxs, key) => ss.flatMap((s) => idxs.map((i) => s.cf[key][i]));
  const open = pick('OPEN'), fist = pick('FIST'), point = pick('POINT'), pinch = pick('PINCH');
  const ALL = [0, 1, 2, 3];
  const extS = [...take(open, ALL, 'straight'), ...take(point, [0], 'straight')];
  const extR = [...take(open, ALL, 'reach'), ...take(point, [0], 'reach')];
  const curS = [...take(fist, ALL, 'straight'), ...take(point, [1, 2, 3], 'straight')];
  const curR = [...take(fist, ALL, 'reach'), ...take(point, [1, 2, 3], 'reach')];
  const out = [];
  const gap = (name, low, high, make) => {
    if (low.length < 10 || high.length < 10) { out.push({ name, note: 'not enough frames' }); return; }
    const lo = quantile(low, 0.95), hi = quantile(high, 0.05);
    if (hi <= lo) { out.push({ name, lo: r3(lo), hi: r3(hi), overlap: true, note: 'classes overlap — not separable at this range; threshold left unchanged' }); return; }
    out.push({ name, lo: r3(lo), hi: r3(hi), set: make(lo, hi) });
  };
  gap('finger straightness: curled p95 | extended p5', curS, extS, (lo, hi) => ({ curlStraight: r3(lo + (hi - lo) * 0.3), extStraight: r3(lo + (hi - lo) * 0.7) }));
  gap('finger reach: curled p95 | extended p5', curR, extR, (lo, hi) => ({ curlReach: r3(lo + (hi - lo) * 0.3), extReach: r3(lo + (hi - lo) * 0.7) }));
  gap('thumb–index gap: pinch p95 | open p5', pinch.map((s) => s.cf.pinchDist), open.map((s) => s.cf.pinchDist), (lo, hi) => ({ pinchEnter: r3(lo + (hi - lo) * 0.25), pinchRelease: r3(lo + (hi - lo) * 0.5) }));
  gap('index reach: fist p95 | pinch p5', fist.map((s) => s.cf.reach[0]), pinch.map((s) => s.cf.reach[0]), (lo, hi) => ({ pinchIndexMin: r3((lo + hi) / 2) }));
  gap('index reach: pinch p95 | open+point p5', pinch.map((s) => s.cf.reach[0]), [...open, ...point].map((s) => s.cf.reach[0]), (lo, hi) => ({ pinchIndexMax: r3((lo + hi) / 2), pinchIndexHoldMax: r3(lo + (hi - lo) * 0.7) }));
  gap('thumb out: fist p95 | open p5', fist.map((s) => s.cf.thumbOut), open.map((s) => s.cf.thumbOut), (lo, hi) => ({ fistThumbOut: r3((lo + hi) / 2) }));
  return out;
}

function suggestTiers() {
  const best = {};
  for (const r of S.results) {
    if (!isFinite(r.summary.palm)) continue;
    if (r.segments.PINCH.verdict === 'reliable') best.near = Math.min(best.near || Infinity, r.summary.palm);
    if (['OPEN', 'FIST', 'POINT'].every((s) => r.segments[s].verdict === 'reliable')) best.far = Math.min(best.far || Infinity, r.summary.palm);
  }
  return { near: best.near ? Math.floor(best.near * 0.9) : null, far: best.far ? Math.floor(best.far * 0.9) : null };
}

/* ---------------------------------------------------------------- results */
function saveResults() {
  if (!store.set('gl.results.v2', S.results)) el.exportMsg.textContent = 'Results could not be saved in the browser; download the report before closing.';
}

function vcell(seg) {
  return `<span class="v v-${seg.verdict}">${seg.verdict}</span><small>${pct(seg.stableRate)} recognised</small><small>frame ${pct(seg.rawRate)} · glitch ${pct(seg.glitchShare)} · sustained ${pct(seg.sustainedShare)}</small>`;
}

const q3 = (o) => (o ? `${fmt(o.p10, 2)} · ${fmt(o.med, 2)} · ${fmt(o.p90, 2)}` : '—');

function featureTable(r) {
  if (!r.features) return '';
  const rows = SHAPES.map((s) => {
    const f = r.features[s];
    if (!f || !f.n) return `<tr><td>${s}</td><td colspan="7" class="dim">no detected frames</td></tr>`;
    return `<tr><td>${s}</td>${FINGER_NAMES.map((n) => `<td>${q3(f[n].straight)}<br><span class="dim">${q3(f[n].reach)}</span></td>`).join('')}<td>${q3(f.pinchDist)}</td><td>${q3(f.thumbOut)}</td><td>${q3(f.facing)}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>Prompted</th>${FINGER_NAMES.map((n) => `<th>${n}<br>straight / reach</th>`).join('')}<th>thumb–index gap</th><th>thumb out</th><th>palm facing</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="dim">Each cell: 10th percentile · median · 90th percentile while you held that gesture.</p>`;
}

function renderResults() {
  const has = S.results.length > 0;
  el.copyBtn.disabled = el.downloadBtn.disabled = el.clearBtn.disabled = !has;
  if (!has) {
    el.resultsBody.innerHTML = '<tr class="empty"><td colspan="14">No tests recorded yet.</td></tr>';
    el.recs.innerHTML = '';
    return;
  }
  el.resultsBody.innerHTML = S.results.map((r) => {
    const s = r.summary;
    return `<tr>
      <td><b>${r.distance} m</b><small>${r.settings.mode === 'full' ? 'full frame' : 'auto zoom'} · ${r.settings.actual}</small></td>
      <td>${pct(s.detection)}<small>${s.frames} frames</small></td>
      <td>${fmt(s.confidence, 2)}</td>
      <td>${fmt(s.palm, 0)} / ${fmt(s.handLength, 0)} px</td>
      <td>${fmt(s.shoulder, 0)} px</td>
      <td>${fmt(s.camFps, 0)} / ${fmt(s.handFps, 0)} / ${fmt(s.poseFps, 0)}</td>
      <td>${fmt(s.latencyMedian, 0)} ms<small>p95 ${fmt(s.latencyP95, 0)} ms</small></td>
      <td>${fmt(s.pointerNoiseRaw, 1)} → ${fmt(s.pointerNoiseFiltered, 1)} px<small>sway ${fmt(s.pointerSway, 1)} px</small></td>
      <td>${vcell(r.segments.OPEN)}</td><td>${vcell(r.segments.FIST)}</td><td>${vcell(r.segments.POINT)}</td><td>${vcell(r.segments.PINCH)}</td>
      <td><b>${r.tier}</b><small>${r.reliable.length}/4 gestures reliable</small></td>
      <td><button class="del" type="button" data-del="${r.id}" aria-label="Delete the ${r.distance} m result">×</button></td>
    </tr>`;
  }).join('');

  const blocks = S.results.map((r) => {
    const fails = SHAPES.filter((s) => r.segments[s].verdict !== 'reliable').map((s) => {
      const tf = r.segments[s].topFailures;
      const g = r.segments[s];
      const sus = tf.length ? tf.map((x) => `${x.label} (${pct(x.share)})`).join('; ') : 'none';
      const gl = g.glitchReasons && g.glitchReasons.length ? g.glitchReasons.map((x) => `${x.label} (${pct(x.share)})`).join('; ') : 'none';
      return `<li><b>${s}</b> ${pct(g.stableRate)} — sustained failures (3+ frames): ${sus}. Short glitches (1–2 frames, absorbed by smoothing): ${gl}.</li>`;
    }).join('');
    let sug = '';
    const samples = S.samplesById[r.id];
    if (samples) {
      const list = suggestThresholds(samples);
      const merged = Object.assign({}, ...list.filter((x) => x.set).map((x) => x.set));
      const preview = Object.keys(merged).length ? scoreSegments(samples, { ...S.thresholds, ...merged }) : null;
      sug = `<h3>Thresholds from this recording (${r.distance} m)</h3><table><thead><tr><th>Boundary</th><th>one side</th><th>other side</th><th>result</th></tr></thead><tbody>${
        list.map((x) => `<tr><td>${x.name}</td><td>${fmt(x.lo, 3)}</td><td>${fmt(x.hi, 3)}</td><td>${x.set ? Object.entries(x.set).map(([k, v]) => `${k} = ${v}`).join(', ') : x.note}</td></tr>`).join('')
      }</tbody></table>${preview ? `<p>Re-scoring this same recording with them: ${SHAPES.map((s) => `${s} ${pct(preview[s].stableRate)}`).join(' · ')}. <button class="btn" type="button" data-apply="${r.id}">Apply these thresholds</button></p>` : ''}`;
    }
    return `<h3>${r.distance} m — ${r.tier}</h3>
      <p>Reliable: ${r.reliable.length ? r.reliable.join(', ') : 'none'}. ${r.marginal.length ? `Marginal (keep off for critical actions): ${r.marginal.join(', ')}. ` : ''}Disable: ${r.disable.length ? r.disable.join(', ') : 'none'}.${r.summary.camFps && r.summary.camFps < 24 ? ` Camera delivered only ${fmt(r.summary.camFps, 0)} fps (usually low light).` : ''}</p>
      ${fails ? `<p>Why gestures failed:</p><ul>${fails}</ul>` : ''}
      ${S.samplesById[r.id] ? `<canvas class="timeline" data-timeline="${r.id}"></canvas>` : ''}
      ${auditHtml(r)}
      ${featureTable(r)}
      ${sug}`;
  });
  const t = suggestTiers();
  const tierLine = t.near || t.far
    ? `<p>From your measurements: <b>NEAR</b> needs a palm of at least <b>${t.near ? t.near + ' px' : '— (PINCH never reliable)'}</b>; <b>FAR</b> needs at least <b>${t.far ? t.far + ' px' : '—'}</b>. <button class="btn" type="button" id="applyTiers">Use these for the live tier</button></p>`
    : '<p>Not enough reliable results yet to derive range thresholds.</p>';
  el.recs.innerHTML = `${blocks.join('')}<h3>Range thresholds</h3>${tierLine}`;
  el.recs.querySelectorAll('[data-timeline]').forEach((c) => {
    const r = S.results.find((x) => x.id === c.dataset.timeline);
    if (r) drawTimeline(c, { samples: S.samplesById[r.id], events: r.events || [] }, -1);
  });
  const apply = document.getElementById('applyTiers');
  if (apply) apply.addEventListener('click', () => {
    if (t.near) S.tier.near = t.near;
    if (t.far) S.tier.far = t.far;
    S.tier.source = 'measured';
    store.set('gl.tier', S.tier);
    renderTierInputs();
  });
}

function applySuggested(id) {
  const samples = S.samplesById[id];
  if (!samples) return;
  const merged = Object.assign({}, ...suggestThresholds(samples).filter((x) => x.set).map((x) => x.set));
  S.thresholds = { ...S.thresholds, ...merged };
  store.set('gl.th.v2', S.thresholds);
  // re-score every result that still has its frames, so the table reflects the new thresholds
  S.results = S.results.map((r) => (S.samplesById[r.id] ? finalizeResult({ ...r, segments: scoreSegments(S.samplesById[r.id], S.thresholds), thresholdsUsed: { ...S.thresholds } }) : r));
  saveResults();
  renderThresholds();
  renderResults();
  el.exportMsg.textContent = 'Thresholds applied and saved. Record the 1 m test again to confirm on fresh data.';
}

function renderTierInputs() {
  el.nearIn.value = S.tier.near;
  el.farIn.value = S.tier.far;
  el.tierSource.textContent = S.tier.source === 'measured' ? 'from your measurements' : 'provisional — record tests, then apply the measured values';
}

function summaryText() {
  const env = `Camera: ${S.env.camera || '?'} · ${navigator.userAgent.match(/(Edg|Chrome)\/[\d.]+/g)?.join(' ') || navigator.userAgent}`;
  const head = 'dist | input | detected | conf | palm/hand px | shoulder px | cam/hand/pose fps | latency med/p95 | pointer noise raw→filt, sway | OPEN | FIST | POINT | PINCH | tier';
  const rows = S.results.map((r) => {
    const s = r.summary, v = (k) => `${r.segments[k].verdict} ${pct(r.segments[k].stableRate)}`;
    return `${r.distance} m | ${r.settings.mode} ${r.settings.actual} | ${pct(s.detection)} | ${fmt(s.confidence, 2)} | ${fmt(s.palm, 0)}/${fmt(s.handLength, 0)} | ${fmt(s.shoulder, 0)} | ${fmt(s.camFps, 0)}/${fmt(s.handFps, 0)}/${fmt(s.poseFps, 0)} | ${fmt(s.latencyMedian, 0)}/${fmt(s.latencyP95, 0)} ms | ${fmt(s.pointerNoiseRaw, 1)}→${fmt(s.pointerNoiseFiltered, 1)}, sway ${fmt(s.pointerSway, 1)} px | ${v('OPEN')} | ${v('FIST')} | ${v('POINT')} | ${v('PINCH')} | ${r.tier} (${r.reliable.length}/4 reliable)`;
  });
  const why = S.results.map((r) => SHAPES.filter((s) => r.segments[s].verdict !== 'reliable')
    .map((s) => {
      const g = r.segments[s];
      const list = (a) => (a && a.length ? a.map((x) => `${x.label} ${pct(x.share)}`).join(', ') : 'none');
      return `${r.distance} m ${s}: stable ${pct(g.stableRate)} · single-frame ${pct(g.rawRate)} · glitch ${pct(g.glitchShare)} · sustained ${pct(g.sustainedShare)} | sustained: ${list(g.topFailures)} | glitches: ${list(g.glitchReasons)}`;
    }).join('\n')).filter(Boolean);
  const feat = S.results.filter((r) => r.features).map((r) => `${r.distance} m features (p10·median·p90):\n` + SHAPES.map((s) => {
    const f = r.features[s];
    if (!f || !f.n) return `  ${s}: no frames`;
    return `  ${s}: ${FINGER_NAMES.map((n) => `${n} S ${q3(f[n].straight)} R ${q3(f[n].reach)}`).join(' | ')} | gap ${q3(f.pinchDist)} | thumbOut ${q3(f.thumbOut)}`;
  }).join('\n')).join('\n');
  return `Gesture Lab — Phase 0 results (classifier v2)\n${env}\nEngine: tasks-vision ${TRACKER_INFO.tasksVision}, hand ${S.tracker ? S.tracker.delegates.hand : '?'}, pose ${S.tracker ? S.tracker.delegates.pose : '?'}\nThresholds: ${JSON.stringify(S.thresholds)}\n\n${head}\n${rows.join('\n')}\n\n${why.length ? 'Failures:\n' + why.join('\n') + '\n\n' : ''}${feat}\n`;
}

function downloadReport() {
  const report = {
    lab: 'Limits exhibit — Gesture Lab (Phase 0)',
    version: 1,
    createdAt: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      camera: S.env.camera,
      cameraSettings: S.env.cameraSettings,
      devicePixelRatio: window.devicePixelRatio,
      screen: `${screen.width}x${screen.height}`,
      engine: { ...TRACKER_INFO, delegates: S.tracker ? S.tracker.delegates : null },
      protocol: { segmentMs: SEG_MS, settleMs: SETTLE_MS, order: SHAPES, jitterScreenWidth: SCREEN_W },
      liveTier: S.tier,
    },
    results: S.results.map((r) => ({ ...r, samples: S.samplesById[r.id] || null })),
  };
  const blob = new Blob([JSON.stringify(report)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  a.href = URL.createObjectURL(blob);
  a.download = `gesture-lab-report-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  const missing = S.results.filter((r) => !S.samplesById[r.id]).length;
  el.exportMsg.textContent = missing ? `Saved. ${missing} older result(s) have summaries only (raw samples exist only for tests recorded in this session).` : 'Report saved to your Downloads folder.';
}

/* ----------------------------------------------------------------- wiring */
el.startBtn.addEventListener('click', startCamera);
el.stopBtn.addEventListener('click', stopCamera);
el.camSelect.addEventListener('change', () => { if (S.running) startCamera(); });
el.resSelect.addEventListener('change', () => { if (S.running) startCamera(); });
el.modeSelect.addEventListener('change', () => { applyTrackerSettings(); resetLive(); });
el.poseSelect.addEventListener('change', applyTrackerSettings);
el.recordBtn.addEventListener('click', startRecording);
el.recCancel.addEventListener('click', () => finishRecording(true));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.rec) finishRecording(true); });
el.nearIn.addEventListener('change', () => { S.tier.near = Math.max(1, +el.nearIn.value || S.tier.near); S.tier.source = 'manual'; store.set('gl.tier', S.tier); renderTierInputs(); });
el.farIn.addEventListener('change', () => { S.tier.far = Math.max(1, +el.farIn.value || S.tier.far); S.tier.source = 'manual'; store.set('gl.tier', S.tier); renderTierInputs(); });
el.resultsBody.addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  S.results = S.results.filter((r) => r.id !== b.dataset.del);
  delete S.samplesById[b.dataset.del];
  saveResults();
  renderResults();
});
el.clearBtn.addEventListener('click', () => {
  if (!confirm('Delete all recorded test results?')) return;
  S.results = []; S.samplesById = {};
  saveResults(); renderResults();
});
el.copyBtn.addEventListener('click', async () => {
  const text = summaryText();
  try { await navigator.clipboard.writeText(text); el.exportMsg.textContent = 'Summary copied — paste it into the chat.'; }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); el.exportMsg.textContent = 'Summary copied — paste it into the chat.'; } catch (err) { el.exportMsg.textContent = 'Copy failed — use Download report instead.'; }
    ta.remove();
  }
});
el.downloadBtn.addEventListener('click', downloadReport);
el.recs.addEventListener('click', (e) => { const b = e.target.closest('[data-apply]'); if (b) applySuggested(b.dataset.apply); });
el.thReset.addEventListener('click', () => {
  S.thresholds = { ...DEFAULT_THRESHOLDS };
  store.set('gl.th.v2', {});
  S.results = S.results.map((r) => (S.samplesById[r.id] ? finalizeResult({ ...r, segments: scoreSegments(S.samplesById[r.id], S.thresholds), thresholdsUsed: { ...S.thresholds } }) : r));
  saveResults(); renderThresholds(); renderResults();
});

renderTierInputs();
renderThresholds();
renderResults();
// expose for debugging and automated checks
window.gestureLab = { S, W, analyze, summaryText, scoreSegments, suggestThresholds };
