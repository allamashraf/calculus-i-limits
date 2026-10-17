// Tests for the slide remote (js/gesture/remote.mjs): unit rules + replay of every real recording.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RemoteControl, ShapeTracker, remoteShape, remoteThresholds } from '../js/gesture/remote.mjs';
import { fromCompact } from '../js/gesture/features.mjs';

// feed a sequence of [shape, durationMs] at 30 fps; returns [{t, cmd}]
function run(seq, rc = new RemoteControl()) {
  const out = [];
  let t = 0;
  for (const [shape, ms] of seq) {
    for (const end = t + ms; t < end; t += 33) { const c = rc.push(shape, t); if (c) out.push({ t, cmd: c }); }
  }
  return out;
}
const cmds = (o) => o.map((x) => x.cmd);

test('holding a finger up sends NEXT exactly once', () => {
  assert.deepEqual(cmds(run([['NONE', 500], ['POINT', 3000], ['NONE', 500]])), ['NEXT']);
});

test('open hand sends PREV once', () => {
  assert.deepEqual(cmds(run([['NONE', 500], ['OPEN', 2000]])), ['PREV']);
});

test('a shape shorter than the dwell time does nothing', () => {
  assert.deepEqual(cmds(run([['NONE', 300], ['OPEN', 200], ['NONE', 500], ['POINT', 200], ['NONE', 300], ['TWO', 300], ['NONE', 300]])), []);
});

test('a short dropout does not repeat; a real release does', () => {
  assert.deepEqual(cmds(run([['POINT', 1000], ['NONE', 100], ['POINT', 1000]])), ['NEXT']);
  assert.deepEqual(cmds(run([['POINT', 1000], ['NONE', 400], ['POINT', 1000]])), ['NEXT', 'NEXT']);
});

test('two fingers: one STEP after the dwell, then one more every 750 ms while held', () => {
  const out = run([['NONE', 300], ['TWO', 2300], ['NONE', 500]]);
  assert.deepEqual(cmds(out), ['STEP', 'STEP', 'STEP']);
  assert.ok(out[1].t - out[0].t >= 750 && out[2].t - out[1].t >= 750);
});

test('two quick two-finger shows give two steps', () => {
  assert.deepEqual(cmds(run([['TWO', 600], ['NONE', 300], ['TWO', 600], ['NONE', 300]])), ['STEP', 'STEP']);
});

test('fist held 1 s pauses; while paused only the fist works; fist again resumes', () => {
  const out = cmds(run([
    ['FIST', 1500], ['NONE', 400],
    ['POINT', 1000], ['NONE', 400], ['OPEN', 1000], ['NONE', 400], ['TWO', 1500], ['NONE', 400],   // ignored while paused
    ['FIST', 1500], ['NONE', 400],
    ['POINT', 1000],
  ]));
  assert.deepEqual(out, ['PAUSE', 'RESUME', 'NEXT']);
});

test('a short fist neither pauses nor moves', () => {
  assert.deepEqual(cmds(run([['FIST', 700], ['NONE', 500]])), []);
});

test('cooldown keeps a screen move at least 700 ms after the previous command', () => {
  const out = run([['POINT', 800], ['OPEN', 1500]]);
  assert.deepEqual(cmds(out), ['NEXT', 'PREV']);
  assert.ok(out[1].t - out[0].t >= 700);
});

test('PINCH, NONE and no-hand never send anything', () => {
  assert.deepEqual(cmds(run([['PINCH', 2000], [null, 1000], ['NONE', 1000]])), []);
});

test('pending() fills toward a screen move and clears once it fired; TWO has no top indicator', () => {
  const rc = new RemoteControl();
  rc.push('POINT', 0);
  assert.equal(rc.pending(300).shape, 'POINT');
  assert.ok(Math.abs(rc.pending(300).p - 0.5) < 1e-9);
  assert.equal(rc.push('POINT', 600), 'NEXT');
  assert.equal(rc.pending(700), null);
  rc.push('TWO', 1500);
  assert.equal(rc.pending(1600), null);
});

test('lowering the hand before the bar is full cancels the move', () => {
  assert.deepEqual(cmds(run([['OPEN', 450], ['NONE', 800]])), []);
});

test('remote shapes: PINCH off, TWO = index + middle up, ring + pinky down', () => {
  const th = remoteThresholds();
  assert.ok(th.pinchEnter < 0 && th.pinchRelease < 0);
  const vec = (straight, reach) => fromCompact({ straight, reach, pinchDist: 0.8, thumbOut: 0.3 });
  assert.equal(remoteShape(vec([0.95, 0.95, 0.45, 0.45], [1.8, 1.9, 0.75, 0.8])), 'TWO');
  assert.equal(remoteShape(vec([0.95, 0.45, 0.45, 0.45], [1.8, 0.8, 0.75, 0.8])), 'POINT');
  assert.equal(remoteShape(vec([0.95, 0.95, 0.95, 0.45], [1.8, 1.9, 1.85, 0.8])), 'NONE');   // three fingers: nothing
});

// Every real recording: no command may fire outside the window of the shape that sends it.
// The recordings contain no two-finger window, so any STEP at all is a false trigger.
const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'recordings', 'manifest.json'), 'utf8'));
const OWNER = { NEXT: 'POINT', PREV: 'OPEN', PAUSE: 'FIST', RESUME: 'FIST', STEP: null };
for (const rec of manifest.recordings) {
  test(`recording ${rec.file}: no command outside its own gesture window`, () => {
    const rep = JSON.parse(fs.readFileSync(path.join(here, 'recordings', rec.file), 'utf8'));
    for (const r of rep.results) {
      if (!r.samples) continue;
      const tracker = new ShapeTracker();
      const rc = new RemoteControl();
      const wrong = [];
      for (const s of r.samples) {
        const c = rc.push(tracker.push(s.cf, s.t), s.t);
        if (c && OWNER[c] !== s.seg) wrong.push(`${c} during ${s.seg} at ${s.t} ms`);
      }
      assert.deepEqual(wrong, []);
    }
  });
}
