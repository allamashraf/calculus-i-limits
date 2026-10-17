// Tests for the slide remote (js/gesture/remote.mjs): unit rules + replay of every real recording.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RemoteControl, remoteThresholds, remoteInput } from '../js/gesture/remote.mjs';
import { replay } from '../js/gesture/replay.mjs';

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
  assert.deepEqual(cmds(run([['NONE', 300], ['OPEN', 200], ['NONE', 500], ['POINT', 200], ['NONE', 300]])), []);
});

test('a short dropout does not repeat; a real release does', () => {
  assert.deepEqual(cmds(run([['POINT', 1000], ['NONE', 100], ['POINT', 1000]])), ['NEXT']);
  assert.deepEqual(cmds(run([['POINT', 1000], ['NONE', 400], ['POINT', 1000]])), ['NEXT', 'NEXT']);
});

test('fist held 1 s pauses; while paused only the fist works; fist again resumes', () => {
  const out = cmds(run([
    ['FIST', 1500], ['NONE', 400],
    ['POINT', 1000], ['NONE', 400], ['OPEN', 1000], ['NONE', 400],   // ignored while paused
    ['FIST', 1500], ['NONE', 400],
    ['POINT', 1000],
  ]));
  assert.deepEqual(out, ['PAUSE', 'RESUME', 'NEXT']);
});

test('a short fist neither pauses nor moves', () => {
  assert.deepEqual(cmds(run([['FIST', 700], ['NONE', 500]])), []);
});

test('cooldown keeps two commands at least 700 ms apart', () => {
  const out = run([['POINT', 800], ['OPEN', 1500]]);
  assert.deepEqual(cmds(out), ['NEXT', 'PREV']);
  assert.ok(out[1].t - out[0].t >= 700);
});

test('PINCH, NONE and no-hand never send anything', () => {
  assert.deepEqual(cmds(run([['PINCH', 2000], [null, 1000], ['NONE', 1000]])), []);
});

test('remote thresholds switch PINCH off and leave everything else unchanged', () => {
  const th = remoteThresholds();
  assert.ok(th.pinchEnter < 0 && th.pinchRelease < 0);
});

// Every real recording: no command may fire outside the window of the shape that sends it.
const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'recordings', 'manifest.json'), 'utf8'));
const OWNER = { NEXT: 'POINT', PREV: 'OPEN', PAUSE: 'FIST', RESUME: 'FIST' };
for (const rec of manifest.recordings) {
  test(`recording ${rec.file}: no command outside its own gesture window`, () => {
    const rep = JSON.parse(fs.readFileSync(path.join(here, 'recordings', rec.file), 'utf8'));
    for (const r of rep.results) {
      if (!r.samples) continue;
      const tl = replay(r.samples, remoteThresholds());
      const rc = new RemoteControl();
      const wrong = [];
      let lastHand = -1e9;
      r.samples.forEach((s, i) => {
        if (s.cf) lastHand = s.t;
        const input = remoteInput(tl[i].stable, s.cf ? 0 : s.t - lastHand);   // same gate as live
        const c = input === undefined ? null : rc.push(input, s.t);
        if (c && OWNER[c] !== s.seg) wrong.push(`${c} during ${s.seg} at ${s.t} ms`);
      });
      assert.deepEqual(wrong, []);
    }
  });
}

test('pending() shows the held gesture filling toward its trigger, and clears once it fired', () => {
  const rc = new RemoteControl();
  rc.push('POINT', 0);
  assert.equal(rc.pending(300).shape, 'POINT');
  assert.ok(Math.abs(rc.pending(300).p - 0.5) < 1e-9);
  assert.equal(rc.push('POINT', 600), 'NEXT');
  assert.equal(rc.pending(700), null);
  rc.push('NONE', 800);
  assert.equal(rc.pending(800), null);
});

test('lowering the hand before the ring closes cancels the gesture', () => {
  assert.deepEqual(cmds(run([['OPEN', 450], ['NONE', 800]])), []);
});

test('lowering the hand cancels at once: the vote holding the shape for 250 ms cannot fire it', async () => {
  const { remoteInput, RemoteControl: RC } = await import('../js/gesture/remote.mjs');
  // ☝ shown for 500 ms (dwell is 600 ms), then the hand is gone; the vote would still say POINT for 250 ms
  const rc = new RC();
  const out = [];
  let lastHand = 0;
  for (let t = 0; t < 1500; t += 33) {
    const handHere = t < 500;
    if (handHere) lastHand = t;
    const stable = t < 750 ? 'POINT' : 'NONE';   // what the vote reports
    const input = remoteInput(stable, handHere ? 0 : t - lastHand);
    if (input !== undefined) { const c = rc.push(input, t); if (c) out.push(c); }
  }
  assert.deepEqual(out, []);
});

test('a dropout of up to 100 ms does not restart the hold', async () => {
  const { remoteInput } = await import('../js/gesture/remote.mjs');
  assert.equal(remoteInput('POINT', 0), 'POINT');
  assert.equal(remoteInput('POINT', 66), undefined);
  assert.equal(remoteInput('POINT', 150), 'NONE');
});
