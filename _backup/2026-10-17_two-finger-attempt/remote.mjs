// remote.mjs — turns hand shapes into presentation commands. Pure logic, no DOM, so the regression
// tests replay the real recordings through exactly the code that runs live.
//
//   ☝  POINT held         → NEXT    next screen (skips whatever is left on this one)
//   ✋  OPEN  held         → PREV    previous screen
//   ✌  TWO   held         → STEP    press this screen's own button / next step; keep holding to
//                                   repeat (one press every stepRepeatMs) — lower the hand to stop
//   ✊  FIST  held 1 s     → PAUSE / RESUME (while paused only the fist is listened to)
//
// Safety rules:
//   • NEXT / PREV fire once per appearance of the shape; the shape has to disappear for
//     `releaseMs` before it can fire again;
//   • every shape must be held (`dwellMs`, `stepDwellMs`) on top of the 300 ms vote — a hand passing
//     through a shape on its way to another is too brief to count. 600 ms for screen moves because
//     the longest such pass in the recordings was a 478 ms POINT while closing the hand (22:41);
//   • at least `cooldownMs` after any command before a screen move;
//   • PINCH is switched off: the presentation needs no click, and PINCH was the only shape that
//     ever produced a false trigger in the recordings;
//   • TWO is only checked when none of the validated shapes matched, so it can never take a frame
//     away from OPEN / FIST / POINT.

import { DEFAULT_THRESHOLDS, classifyDetailed, fingerState, fromCompact, FeatureSmoother, VoteStabilizer } from './features.mjs';

export const REMOTE_DEFAULTS = {
  dwellMs: 600, holdPauseMs: 1000, releaseMs: 200, cooldownMs: 700,
  stepDwellMs: 450, stepRepeatMs: 750,
};

/** Production thresholds with PINCH disabled (no distance can be below -1). */
export function remoteThresholds(th = DEFAULT_THRESHOLDS) {
  return { ...th, pinchEnter: -1, pinchRelease: -1 };
}

/** OPEN / FIST / POINT from the validated classifier; otherwise TWO (index + middle up, ring + pinky down). */
export function remoteShape(f, th = remoteThresholds()) {
  const shape = classifyDetailed(f, th, false).shape;
  if (shape !== 'NONE') return shape;
  const st = (n) => fingerState(f.fingers[n].straight, f.fingers[n].reach, th);
  if (st('index') === 'extended' && st('middle') === 'extended' && st('ring') === 'curled' && st('pinky') === 'curled') return 'TWO';
  return 'NONE';
}

/** Per-frame compact features (or null = no hand) → stable shape. Same steps live and in the tests. */
export class ShapeTracker {
  constructor(th = remoteThresholds()) { this.th = th; this.smooth = new FeatureSmoother(3); this.vote = new VoteStabilizer(); }
  reset() { this.smooth.reset(); this.vote.reset(); }
  push(cf, t) {
    if (!cf) { this.smooth.reset(); return this.vote.push(null, t); }
    return this.vote.push(remoteShape(fromCompact(this.smooth.push(cf, t)), this.th), t);
  }
}

const SHAPES = new Set(['OPEN', 'FIST', 'POINT', 'TWO']);

export class RemoteControl {
  constructor(opts = {}) {
    this.o = { ...REMOTE_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this.shape = 'NONE';    // current stable shape seen by the remote
    this.since = 0;         // when it appeared
    this.latch = null;      // the shape that last fired; blocked until it has been gone releaseMs
    this.goneAt = null;
    this.paused = false;
    this.lastCmdAt = -1e9;
    this.nextStepAt = null;
  }

  /**
   * shape: stable shape ('OPEN' | 'FIST' | 'POINT' | 'TWO' | 'NONE' | …) or null (no hand); t: ms.
   * Returns 'NEXT' | 'PREV' | 'STEP' | 'PAUSE' | 'RESUME' | null.
   */
  push(shape, t) {
    const s = SHAPES.has(shape) ? shape : 'NONE';
    if (s !== this.shape) { this.shape = s; this.since = t; this.nextStepAt = null; }

    if (this.latch) {
      if (s === this.latch) { this.goneAt = null; return null; }
      if (this.goneAt === null) this.goneAt = t;
      if (t - this.goneAt < this.o.releaseMs) return null;
      this.latch = null; this.goneAt = null;
    }

    const held = t - this.since;
    if (s === 'FIST' && held >= this.o.holdPauseMs) {
      this.paused = !this.paused;
      this.fire(s, t);
      return this.paused ? 'PAUSE' : 'RESUME';
    }
    if (this.paused) return null;
    if (s === 'TWO') {
      if (this.nextStepAt === null) this.nextStepAt = this.since + this.o.stepDwellMs;
      if (t >= this.nextStepAt) {
        this.nextStepAt = t + this.o.stepRepeatMs;
        this.lastCmdAt = t;
        return 'STEP';
      }
      return null;
    }
    if ((s === 'POINT' || s === 'OPEN') && held >= this.o.dwellMs && t - this.lastCmdAt >= this.o.cooldownMs) {
      this.fire(s, t);
      return s === 'POINT' ? 'NEXT' : 'PREV';
    }
    return null;
  }

  fire(s, t) { this.latch = s; this.goneAt = null; this.lastCmdAt = t; }

  /**
   * For the top indicator: the screen-level gesture being held and how close (0–1) it is to firing,
   * or null. Dropping the hand before 1 cancels it. (TWO has its own, quieter indicator.)
   */
  pending(t) {
    const s = this.shape;
    if (s === 'NONE' || s === 'TWO' || this.latch === s) return null;
    if (s === 'FIST') return { shape: s, p: Math.min(1, (t - this.since) / this.o.holdPauseMs) };
    if (this.paused) return null;
    return { shape: s, p: Math.min(1, (t - this.since) / this.o.dwellMs) };
  }

  /** For the small status chip: 0–1 progress of a fist being held toward pause/resume. */
  fistProgress(t) {
    if (this.shape !== 'FIST' || this.latch === 'FIST') return 0;
    return Math.min(1, (t - this.since) / this.o.holdPauseMs);
  }
}
