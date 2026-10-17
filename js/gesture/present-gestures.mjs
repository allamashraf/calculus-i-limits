// present-gestures.mjs — hand-gesture remote for presentation mode.
//
//   G            turn the camera remote on / off
//   ☝  finger    next screen          (same as ↓)
//   ✋  open hand previous screen      (same as ↑)
//   ✊  fist 1 s  pause / resume the remote
//
// Gestures act only in presentation mode (P), exactly like the arrow keys, and the keyboard keeps
// working at all times. Same pipeline as the Gesture Lab and the regression validator:
// features → 3-frame median → classifier (PINCH off) → 300 ms vote → RemoteControl (remote.mjs).

import { handFeatures, classifyDetailed, compact, fromCompact, FeatureSmoother, VoteStabilizer } from './features.mjs';
import { RemoteControl, remoteThresholds, remoteInput } from './remote.mjs';

const TH = remoteThresholds();
// When the shoulders are visible, a hand only counts above ~waist height (shoulder line + 1 shoulder
// width), so a resting arm can never send a command.
const ZONE_SHOULDERS = 1.0;

const S = {
  on: false, starting: false, loop: 0,
  tracker: null, stream: null,
  smooth: new FeatureSmoother(3), vote: new VoteStabilizer(), remote: new RemoteControl(),
  primaryAt: null, flashUntil: 0, lastText: '', lastState: '',
};

/* ------------------------------------------------------------- indicator */
const chip = document.createElement('div');
chip.className = 'gx';
chip.setAttribute('aria-live', 'polite');
chip.innerHTML = '<video class="gx__cam" muted playsinline></video><span class="gx__dot"></span><span class="gx__text"></span>';
document.body.appendChild(chip);
const video = chip.querySelector('video');
const textEl = chip.querySelector('.gx__text');

// big indicator, top centre, readable from 2 m (same language as the PRESENT [P] button): the key it
// stands for, what will happen, and a bar that fills until it fires — lower the hand before the bar
// is full to cancel.
const big = document.createElement('div');
big.className = 'gx-big';
big.setAttribute('aria-hidden', 'true');
big.innerHTML = '<span class="gx-big__key"></span><span class="gx-big__label"></span><span class="gx-big__bar"></span>';
document.body.appendChild(big);
const bigIcon = big.querySelector('.gx-big__key');
const bigLabel = big.querySelector('.gx-big__label');
const BIG = { last: '', until: 0 };
const ICON = { POINT: '↓', OPEN: '↑', FIST: 'Ⅱ' };
function showBig(kind, icon, label, p) {
  const key = kind + icon + label;
  if (key !== BIG.last) { big.dataset.kind = kind; bigIcon.textContent = icon; bigLabel.textContent = label; BIG.last = key; }
  big.style.setProperty('--p', p.toFixed(3));
  big.classList.add('is-on');
}
function hideBig() { if (big.classList.contains('is-on')) { big.classList.remove('is-on'); BIG.last = ''; } }
function confirmBig(kind, icon, label) { BIG.until = performance.now() + 750; showBig(kind + ' is-done', icon, label, 1); }

function paint(state, text, progress = 0) {
  if (state !== S.lastState) { chip.dataset.state = state; S.lastState = state; }
  if (text !== S.lastText) { textEl.textContent = text; S.lastText = text; }
  chip.style.setProperty('--hold', progress.toFixed(3));
}
function flash(text, ms = 900) { S.flashUntil = performance.now() + ms; paint(S.lastState || 'live', text); }

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
  S.smooth.reset(); S.vote.reset(); S.remote.reset(); S.primaryAt = null;
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

// same rule as the Gesture Lab: keep following the hand we had; otherwise take the raised one
function pickPrimary(hands) {
  if (!hands.length) { S.primaryAt = null; return null; }
  if (S.primaryAt) {
    let best = null, bd = Infinity;
    for (const h of hands) { const d = Math.hypot(h.px[0].x - S.primaryAt.x, h.px[0].y - S.primaryAt.y); if (d < bd) { bd = d; best = h; } }
    const palm = Math.hypot(best.px[5].x - best.px[17].x, best.px[5].y - best.px[17].y);
    if (bd < 3 * palm + 20) { S.primaryAt = best.px[0]; return best; }
  }
  let best = hands[0];
  for (const h of hands) if (h.px[0].y < best.px[0].y) best = h;
  S.primaryAt = best.px[0];
  return best;
}

function handRaised(hand, pose) {
  if (!pose || !pose.shouldersOk) return true;   // shoulders not visible (e.g. close to the laptop): no height rule
  const shoulderY = (pose.pts[11].y + pose.pts[12].y) / 2;
  const handY = (hand.px[0].y + hand.px[9].y) / 2;
  return handY < shoulderY + ZONE_SHOULDERS * pose.shoulderPx;
}

const LABEL = { POINT: '☝ next', OPEN: '✋ back', FIST: '✊ hold to pause' };

/* ------------------------------------------------------------------ beats */
// ☝ works like a clicker with build steps: it first runs the current screen's own action (the
// button you would otherwise walk to the laptop to press), and only moves on when there is none
// left. ✋ always goes back one screen. The keyboard is unchanged.
const HALVE_BEATS = 4;   // "Halve the distance to 2" pressed at most this many times per visit
const own = (stop, sel) => Array.from(stop.querySelectorAll(sel)).filter((el) => el.closest('[data-stop]') === stop);
let beatStop = null;

function nextBeat(stop) {
  if (!stop) return null;
  if (stop !== beatStop) {   // arrived at a new screen: forget what we pressed on the last visit
    own(stop, '[data-gx-used]').forEach((b) => b.removeAttribute('data-gx-used'));
    beatStop = stop;
  }
  const stepper = own(stop, '[data-stepper]')[0];
  if (stepper) {
    const next = stepper.querySelector('[data-next]');
    return stepper.querySelector('[data-step]:not(.is-shown)') && next ? { label: 'Next step', run: () => next.click() } : null;
  }
  const group = own(stop, '[data-n-group]')[0];
  if (group) {
    const bs = Array.from(group.querySelectorAll('[data-n]'));
    const i = bs.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
    return i < bs.length - 1 ? { label: 'n = ' + bs[i + 1].dataset.n, run: () => bs[i + 1].click() } : null;
  }
  const b = own(stop, '[data-halve], [data-approach], [data-shrink]')[0];
  if (b && !b.disabled) {
    const max = b.matches('[data-halve]') ? HALVE_BEATS : 1;
    const used = +(b.dataset.gxUsed || 0);
    const label = b.matches('[data-halve]') ? 'Halve' : b.matches('[data-approach]') ? 'Approach' : 'Δt → 0';
    if (used < max) return { label, run: () => { b.dataset.gxUsed = used + 1; b.click(); } };
  }
  return null;
}
// pressing Reset on a screen lets ☝ run its action again
document.addEventListener('click', (e) => {
  const r = e.target.closest && e.target.closest('[data-reset]');
  const stop = r && r.closest('[data-stop]');
  if (stop) own(stop, '[data-gx-used]').forEach((b) => b.removeAttribute('data-gx-used'));
}, true);

function presenter() { const P = window.EX && window.EX.presentation; return P && P.isPresenting() ? P : null; }

function frame(now) {
  const r = S.tracker.process(video, now);
  const t = performance.now();
  const hand = pickPrimary(r.hands);
  let shape = null, raised = true;
  if (hand) {
    const f = handFeatures(hand.world, hand.px, TH);
    shape = classifyDetailed(fromCompact(S.smooth.push(compact(f), t)), TH, false).shape;
    raised = handRaised(hand, r.pose);
  } else S.smooth.reset();
  const stable = S.vote.push(hand ? shape : null, t);
  const seen = hand && !raised ? 'NONE' : stable;
  if (hand) S.lastHandAt = t;
  const input = remoteInput(seen, hand ? 0 : t - (S.lastHandAt || -1e9));
  const cmd = input === undefined ? null : S.remote.push(input, t);
  if (cmd) act(cmd);

  // speed readout for the chip: frames per second over the last ~second
  S.fpsTimes = (S.fpsTimes || []).filter((x) => t - x < 1000);
  S.fpsTimes.push(t);
  const info = ` · ${S.fpsTimes.length} fps` + (hand ? ` · hand ${Math.round(Math.hypot(hand.px[5].x - hand.px[17].x, hand.px[5].y - hand.px[17].y))} px` : '');

  // big indicator
  if (t >= BIG.until) {
    const pend = hand && raised ? S.remote.pending(t) : null;
    if (pend) {
      const paused = S.remote.paused;
      let label = pend.shape === 'OPEN' ? 'Back' : paused ? 'Resume' : 'Pause';
      if (pend.shape === 'POINT') { const P = presenter(); const beat = P && nextBeat(P.currentStop()); label = beat ? beat.label : 'Next'; }
      showBig(pend.shape === 'FIST' ? 'fist' : 'move', ICON[pend.shape], label, pend.p);
    } else hideBig();
  }

  if (t < S.flashUntil) return;   // keep the command label up for a moment
  const paused = S.remote.paused;
  const hold = S.remote.fistProgress(t);
  let text;
  if (paused) text = hold > 0 ? 'Resuming…' : 'Paused · hold ✊ to resume';
  else if (hold > 0) text = 'Pausing…';
  else if (!hand) text = 'No hand';
  else if (!raised) text = 'Raise your hand';
  else text = LABEL[seen] || 'Hand';
  paint(paused ? 'paused' : 'live', text + info, hold);
}

function act(cmd) {
  if (cmd === 'PAUSE') { paint('paused', 'Paused'); flash('Paused'); confirmBig('fist', 'Ⅱ', 'Paused'); return; }
  if (cmd === 'RESUME') { paint('live', 'Resumed'); flash('Resumed'); confirmBig('fist', '▶', 'Resumed'); return; }
  const P = presenter();
  if (!P) { flash('Press P to present'); confirmBig('warn', 'P', 'Press P to present'); return; }
  if (cmd === 'NEXT') {
    const beat = nextBeat(P.currentStop());
    if (beat) { beat.run(); flash(beat.label); confirmBig('move', '↓', beat.label); return; }
    P.step(1); flash('Next ▸'); confirmBig('move', '↓', 'Next');
  } else {
    P.step(-1); flash('◂ Back'); confirmBig('move', '↑', 'Back');
  }
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
