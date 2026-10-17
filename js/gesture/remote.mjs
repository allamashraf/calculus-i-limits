// remote.mjs — turns the stable hand shape into slide commands. Pure logic, no DOM, so the
// regression tests can replay real recordings through exactly the code that runs live.
//
//   ☝  POINT held  → NEXT
//   ✋  OPEN  held  → PREV
//   ✊  FIST  held 1 s → PAUSE / RESUME (while paused only the fist is listened to)
//
// Safety rules:
//   • one command per appearance of a shape: holding a finger up never repeats;
//     the shape has to disappear for `releaseMs` before it can fire again;
//   • a shape must be held `dwellMs` (on top of the 300 ms vote) — a hand passing
//     through OPEN or POINT on its way to a fist is too brief to count. 600 ms because the
//     longest such pass in the recordings was a 478 ms POINT while closing the hand (22:41);
//   • at least `cooldownMs` between two slide commands;
//   • PINCH is switched off: the presentation needs no click, and PINCH was the
//     only shape that ever produced a false trigger in the recordings.

import { DEFAULT_THRESHOLDS } from './features.mjs';

export const REMOTE_DEFAULTS = { dwellMs: 600, holdPauseMs: 1000, releaseMs: 200, cooldownMs: 700 };

/** Production thresholds with PINCH disabled (no distance can be below -1). */
export function remoteThresholds(th = DEFAULT_THRESHOLDS) {
  return { ...th, pinchEnter: -1, pinchRelease: -1 };
}

/**
 * What the remote should see this frame. The 300 ms vote keeps the last shape alive for a moment
 * after the hand disappears; the remote must not, or a gesture could still fire after the hand was
 * lowered (and lowering the hand would not cancel). handAgeMs: 0 when the hand is in this frame,
 * otherwise ms since it was last seen. A gap of up to gapMs (a frame or three lost at a distance)
 * holds still; anything longer is NONE.
 * Returns the shape to push, or undefined = skip this frame.
 */
export function remoteInput(stable, handAgeMs, gapMs = 100) {
  if (handAgeMs === 0) return stable;
  if (handAgeMs <= gapMs) return undefined;
  return 'NONE';
}

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
  }

  /**
   * shape: stable shape from the vote ('OPEN' | 'FIST' | 'POINT' | 'NONE' | …) or null (no hand);
   * t: milliseconds. Returns 'NEXT' | 'PREV' | 'PAUSE' | 'RESUME' | null.
   */
  push(shape, t) {
    const s = shape === 'OPEN' || shape === 'FIST' || shape === 'POINT' ? shape : 'NONE';
    if (s !== this.shape) { this.shape = s; this.since = t; }

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
    if ((s === 'POINT' || s === 'OPEN') && held >= this.o.dwellMs && t - this.lastCmdAt >= this.o.cooldownMs) {
      this.fire(s, t);
      return s === 'POINT' ? 'NEXT' : 'PREV';
    }
    return null;
  }

  fire(s, t) { this.latch = s; this.goneAt = null; this.lastCmdAt = t; }

  /**
   * For the big on-screen indicator: the gesture that is being held and how close (0–1) it is to
   * firing, or null. Dropping the hand before 1 cancels it — that is how the presenter corrects a
   * gesture the camera misread.
   */
  pending(t) {
    const s = this.shape;
    if (s === 'NONE' || this.latch === s) return null;
    if (s === 'FIST') return { shape: s, p: Math.min(1, (t - this.since) / this.o.holdPauseMs) };
    if (this.paused) return null;
    return { shape: s, p: Math.min(1, (t - this.since) / this.o.dwellMs) };
  }

  /** For the on-screen indicator: 0–1 progress of a fist being held toward pause/resume. */
  fistProgress(t) {
    if (this.shape !== 'FIST' || this.latch === 'FIST') return 0;
    return Math.min(1, (t - this.since) / this.o.holdPauseMs);
  }
}
