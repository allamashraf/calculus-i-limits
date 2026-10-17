// present-gestures.mjs — hand-gesture remote for presentation mode.
//
//   G             turn the camera remote on / off
//   ☝  finger     next screen                      (same as ↓)
//   ✋  open hand  previous screen                  (same as ↑)
//   ✌  two up     press this screen's button / next step — keep holding to repeat
//   ✊  fist 1 s   pause / resume the remote
//
// Gestures act only in presentation mode (P), and the keyboard keeps working at all times.
// Only the presenter's hand counts: when the body tracker sees the presenter, a hand that is not at
// one of the presenter's own wrists (someone walking behind, a raised hand in the audience) is ignored.
// Pipeline (same code as the tests): features → 3-frame median → classifier → 300 ms vote
// (ShapeTracker) → RemoteControl, all in remote.mjs.

import { handFeatures, compact } from './features.mjs';
import { RemoteControl, ShapeTracker } from './remote.mjs';

// When the shoulders are visible, a hand only counts above ~waist height (shoulder line + 1 shoulder
// width), so a resting arm can never send a command.
const ZONE_SHOULDERS = 1.0;
// A hand belongs to the presenter if its wrist is within this many shoulder widths of one of the
// presenter's wrists (pose runs ~5×/s, so this leaves room for the pose to lag a moving hand).
const OWNER_SHOULDERS = 1.0;

const S = {
  on: false, starting: false, loop: 0,
  tracker: null, stream: null,
  shapes: new ShapeTracker(), remote: new RemoteControl(),
  primaryAt: null, flashUntil: 0, lastText: '', lastState: '',
};

/* ------------------------------------------------------------- status chip (bottom left) */
const chip = document.createElement('div');
chip.className = 'gx';
chip.setAttribute('aria-live', 'polite');
chip.innerHTML = '<video class="gx__cam" muted playsinline></video><span class="gx__dot"></span><span class="gx__text"></span>';
document.body.appendChild(chip);
const video = chip.querySelector('video');
const textEl = chip.querySelector('.gx__text');

function paint(state, text, progress = 0) {
  if (state !== S.lastState) { chip.dataset.state = state; S.lastState = state; }
  if (text !== S.lastText) { textEl.textContent = text; S.lastText = text; }
  chip.style.setProperty('--hold', progress.toFixed(3));
}
function flash(text, ms = 900) { S.flashUntil = performance.now() + ms; paint(S.lastState || 'live', text); }

/* ------------------------------------------------------------- screen indicator (top centre) */
// Same language as the PRESENT [P] button: key cap · label · a bar that fills until the gesture
// fires — lower the hand before the bar is full to cancel.
const big = document.createElement('div');
big.className = 'gx-big';
big.setAttribute('aria-hidden', 'true');
big.innerHTML = '<span class="gx-big__key"></span><span class="gx-big__label"></span><span class="gx-big__bar"></span>';
document.body.appendChild(big);
const bigKey = big.querySelector('.gx-big__key');
const bigLabel = big.querySelector('.gx-big__label');
const BIG = { last: '', until: 0 };
const KEY = { POINT: '↓', OPEN: '↑', FIST: 'Ⅱ' };
function showBig(kind, key, label, p) {
  const id = kind + key + label;
  if (id !== BIG.last) { big.dataset.kind = kind; bigKey.textContent = key; bigLabel.textContent = label; BIG.last = id; }
  big.style.setProperty('--p', p.toFixed(3));
  big.classList.add('is-on');
}
function hideBig() { if (big.classList.contains('is-on')) { big.classList.remove('is-on'); BIG.last = ''; } }
function confirmBig(kind, key, label) { BIG.until = performance.now() + 750; showBig(kind + ' is-done', key, label, 1); }

/* ------------------------------------------------------------- step indicator (bottom centre, quiet) */
const stepEl = document.createElement('div');
stepEl.className = 'gx-step';
stepEl.setAttribute('aria-hidden', 'true');
stepEl.innerHTML = '<span class="gx-step__label"></span><span class="gx-step__dots"></span>';
document.body.appendChild(stepEl);
const stepLabel = stepEl.querySelector('.gx-step__label');
const stepDots = stepEl.querySelector('.gx-step__dots');
let stepTimer = 0;
function showStep(label, k, n) {
  stepLabel.textContent = label;
  stepDots.innerHTML = n > 1 ? Array.from({ length: n }, (_, i) => `<i${i < k ? ' class="on"' : ''}></i>`).join('') : '';
  stepEl.classList.add('is-on');
  clearTimeout(stepTimer);
  stepTimer = setTimeout(() => stepEl.classList.remove('is-on'), 1600);
}

/* ---------------------------------------------------------------- camera */
function cameraError(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError') return 'Camera blocked — allow it in the address bar, then press G';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found';
  if (name === 'NotReadableError') return 'Camera busy in another app (Teams, Zoom…)';
  return 'Camera error: ' + (err && err.message ? err.message : String(err));
}

function stopStream() {
  if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
  S.stream = null;
  video.srcObject = null;
}

function resetLive() {
  S.shapes.reset(); S.remote.reset(); S.primaryAt = null;
}

async function start() {
  if (S.on || S.starting) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    chip.classList.add('is-on');
    paint('error', 'Camera needs Chrome/Edge on http://localhost:4173');
    return;
  }
  S.starting = true;
  chip.classList.add('is-on');
  paint('loading', 'Starting camera…');
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },   // same as the recordings
    });
  } catch (err) {
    if (!S.starting) return;   // turned off while the permission prompt was open
    S.starting = false;
    paint('error', cameraError(err));
    return;
  }
  if (!S.starting) { stopStream(); return; }
  video.srcObject = S.stream;
  await video.play().catch(() => {});
  if (!S.tracker) {
    try {
      const { createTracker } = await import('./tracker.mjs');   // MediaPipe loads only when G is pressed
      S.tracker = await createTracker({ onStatus: (m) => paint('loading', m) });
    } catch (err) {
      stopStream();
      S.starting = false;
      paint('error', 'Gesture engine failed: ' + (err && err.message ? err.message : String(err)));
      return;
    }
  }
  if (!S.starting) return;   // turned off while loading
  S.starting = false;
  S.on = true;
  resetLive();
  const id = ++S.loop;
  schedule(id);
}

function stop() {
  S.on = false; S.starting = false; S.loop++;
  stopStream();
  resetLive();
  chip.classList.remove('is-on');
  hideBig();
}

/* ------------------------------------------------------------ frame loop */
function schedule(id) {
  if (!S.on || id !== S.loop) return;
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback((now) => tick(id, now));
  else requestAnimationFrame((now) => tick(id, now));
}

let lastVideoTime = -1;
function tick(id, now) {
  if (!S.on || id !== S.loop) return;
  try {
    if (video.videoWidth && video.currentTime !== lastVideoTime) { lastVideoTime = video.currentTime; frame(now); }
  } catch (err) {
    console.error(err);
    paint('error', 'Tracking error: ' + (err && err.message ? err.message : String(err)));
  }
  schedule(id);
}

/** Is this hand at one of the presenter's wrists? Without a usable body reading, every hand counts. */
function ownedByPresenter(hand, pose) {
  if (!pose || !pose.shouldersOk) return true;
  const wrists = [15, 16].filter((i) => pose.vis[i] > 0.2);
  if (!wrists.length) return true;
  const lim = OWNER_SHOULDERS * pose.shoulderPx;
  return wrists.some((i) => Math.hypot(hand.px[0].x - pose.pts[i].x, hand.px[0].y - pose.pts[i].y) < lim);
}

// keep following the hand we had; otherwise take the raised one — among the presenter's hands only
function pickPrimary(hands, pose) {
  const mine = hands.filter((h) => ownedByPresenter(h, pose));
  S.others = hands.length - mine.length;
  if (!mine.length) { S.primaryAt = null; return null; }
  if (S.primaryAt) {
    let best = null, bd = Infinity;
    for (const h of mine) { const d = Math.hypot(h.px[0].x - S.primaryAt.x, h.px[0].y - S.primaryAt.y); if (d < bd) { bd = d; best = h; } }
    const palm = Math.hypot(best.px[5].x - best.px[17].x, best.px[5].y - best.px[17].y);
    if (bd < 3 * palm + 20) { S.primaryAt = best.px[0]; return best; }
  }
  let best = mine[0];
  for (const h of mine) if (h.px[0].y < best.px[0].y) best = h;
  S.primaryAt = best.px[0];
  return best;
}

function handRaised(hand, pose) {
  if (!pose || !pose.shouldersOk) return true;   // shoulders not visible (e.g. close to the laptop): no height rule
  const shoulderY = (pose.pts[11].y + pose.pts[12].y) / 2;
  const handY = (hand.px[0].y + hand.px[9].y) / 2;
  return handY < shoulderY + ZONE_SHOULDERS * pose.shoulderPx;
}

const LABEL = { POINT: '☝ next screen', OPEN: '✋ back', TWO: '✌ step', FIST: '✊ hold to pause' };

function frame(now) {
  const r = S.tracker.process(video, now);
  const t = performance.now();
  const hand = pickPrimary(r.hands, r.pose);
  const raised = hand ? handRaised(hand, r.pose) : true;
  const cf = hand && raised ? compact(handFeatures(hand.world, hand.px)) : null;
  const seen = S.shapes.push(cf, t);
  const cmd = S.remote.push(seen, t);
  if (cmd) act(cmd);

  // screen indicator
  if (t >= BIG.until) {
    const pend = hand && raised ? S.remote.pending(t) : null;
    if (pend) {
      const label = pend.shape === 'POINT' ? 'Next' : pend.shape === 'OPEN' ? 'Back' : S.remote.paused ? 'Resume' : 'Pause';
      showBig(pend.shape === 'FIST' ? 'fist' : 'move', KEY[pend.shape], label, pend.p);
    } else hideBig();
  }

  if (t < S.flashUntil) return;   // keep the command label up for a moment
  const paused = S.remote.paused;
  const hold = S.remote.fistProgress(t);
  let text;
  if (paused) text = hold > 0 ? 'Resuming…' : 'Paused · hold ✊ to resume';
  else if (hold > 0) text = 'Pausing…';
  else if (!hand) text = S.others ? 'Someone else’s hand — ignored' : 'Gestures on';
  else if (!raised) text = 'Raise your hand';
  else text = LABEL[seen] || 'Gestures on';
  paint(paused ? 'paused' : 'live', text, hold);
}

/* ------------------------------------------------------------------ steps */
// ✌ presses the current screen's own control: the button you would otherwise walk to the laptop
// for, or the next step of a step-by-step panel. ☝ always moves to the next screen (skips the rest).
const HALVE_STEPS = 4;   // "Halve the distance to 2" pressed at most this many times per visit
const own = (stop, sel) => Array.from(stop.querySelectorAll(sel)).filter((el) => el.closest('[data-stop]') === stop);
let stepStop = null;

function nextStep(stop) {
  if (!stop) return null;
  if (stop !== stepStop) {   // arrived at a new screen: forget what we pressed on the last visit
    own(stop, '[data-gx-used]').forEach((b) => b.removeAttribute('data-gx-used'));
    stepStop = stop;
  }
  const stepper = own(stop, '[data-stepper]')[0];
  if (stepper) {
    const next = stepper.querySelector('[data-next]');
    const all = stepper.querySelectorAll('[data-step]');
    if (!next || !stepper.querySelector('[data-step]:not(.is-shown)')) return null;
    return { label: 'Next step', run: () => next.click(), progress: () => [stepper.querySelectorAll('[data-step].is-shown').length, all.length] };
  }
  const group = own(stop, '[data-n-group]')[0];
  if (group) {
    const bs = Array.from(group.querySelectorAll('[data-n]'));
    const i = bs.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
    if (i >= bs.length - 1) return null;
    return { label: 'n = ' + bs[i + 1].dataset.n, run: () => bs[i + 1].click(), progress: () => [i + 1, bs.length - 1] };
  }
  const b = own(stop, '[data-halve], [data-approach], [data-shrink]')[0];
  if (b && !b.disabled) {
    const max = b.matches('[data-halve]') ? HALVE_STEPS : 1;
    const used = +(b.dataset.gxUsed || 0);
    const label = b.matches('[data-halve]') ? 'Halve' : b.matches('[data-approach]') ? 'Approach' : 'Δt → 0';
    if (used < max) return { label, run: () => { b.dataset.gxUsed = used + 1; b.click(); }, progress: () => [used + 1, max] };
  }
  return null;
}
// pressing Reset on a screen lets ✌ run its button again
document.addEventListener('click', (e) => {
  const r = e.target.closest && e.target.closest('[data-reset]');
  const stop = r && r.closest('[data-stop]');
  if (stop) own(stop, '[data-gx-used]').forEach((b) => b.removeAttribute('data-gx-used'));
}, true);

function presenter() { const P = window.EX && window.EX.presentation; return P && P.isPresenting() ? P : null; }

function act(cmd) {
  if (cmd === 'PAUSE') { paint('paused', 'Paused'); flash('Paused'); confirmBig('fist', 'Ⅱ', 'Paused'); return; }
  if (cmd === 'RESUME') { paint('live', 'Resumed'); flash('Resumed'); confirmBig('fist', '▶', 'Resumed'); return; }
  const P = presenter();
  if (!P) { flash('Press P to present'); confirmBig('warn', 'P', 'Press P to present'); return; }
  if (cmd === 'STEP') {
    const s = nextStep(P.currentStop());
    if (!s) { showStep('No steps here', 0, 0); flash('No steps here'); return; }
    s.run();
    const [k, n] = s.progress();
    showStep(s.label, k, n);
    flash('✌ ' + s.label);
    return;
  }
  if (cmd === 'NEXT') { P.step(1); flash('Next ▸'); confirmBig('move', '↓', 'Next'); }
  else { P.step(-1); flash('◂ Back'); confirmBig('move', '↑', 'Back'); }
}

/* ------------------------------------------------------------------- key */
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.key !== 'g' && e.key !== 'G' && e.code !== 'KeyG') return;   // e.code: works with an Arabic keyboard too
  const t = e.target;
  const typing = t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === 'INPUT' && !/^(range|checkbox|button)$/.test(t.type)));
  if (typing) return;
  e.preventDefault();
  if (S.on || S.starting) stop(); else start();
});

document.addEventListener('visibilitychange', () => { if (document.hidden && S.on) resetLive(); });

// test hook (used by the headless smoke test): run a command as if the gesture had fired
if (window.EX) window.EX.gestureRemote = { act };
