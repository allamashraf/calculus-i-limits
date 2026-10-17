// Unit tests for the gesture rules (run: npm test). Fixtures are median feature vectors measured on
// the user's real 1 m recordings, plus targeted edge cases around every PINCH boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, fromCompact, DEFAULT_THRESHOLDS as TH, VoteStabilizer } from '../js/gesture/features.mjs';

const vec = (straight, reach, pinchDist, thumbOut) => fromCompact({ straight, reach, pinchDist, thumbOut });
// medians from tests/recordings/1m/2026-10-16_2244.json (scored frames)
const OPEN = () => vec([0.910, 0.958, 0.963, 0.923], [1.785, 1.983, 1.871, 1.763], 0.908, 0.825);
const FIST = () => vec([0.446, 0.320, 0.488, 0.428], [0.790, 0.775, 0.698, 0.849], 0.366, 0.402);
const POINT = () => vec([0.962, 0.456, 0.505, 0.480], [1.785, 0.865, 0.740, 0.867], 0.715, 0.183);
const PINCH = (indexReach = 1.199, gap = 0.402) => vec([0.901, 0.985, 0.984, 0.976], [indexReach, 1.851, 1.671, 1.751], gap, 0.458);

test('real median shapes are classified correctly', () => {
  assert.equal(classify(OPEN(), TH), 'OPEN');
  assert.equal(classify(FIST(), TH), 'FIST');
  assert.equal(classify(POINT(), TH), 'POINT');
  assert.equal(classify(PINCH(), TH), 'PINCH');
});

test('fresh-run pinch (index reach 1.46–1.59) is recognised', () => {
  for (const r of [1.46, 1.55, 1.59, 1.64]) assert.equal(classify(PINCH(r), TH), 'PINCH', `reach ${r}`);
});

test('index-reach hysteresis: 1.66 cannot start a pinch but can hold one; 1.70 always releases', () => {
  assert.notEqual(classify(PINCH(1.66), TH, false), 'PINCH');
  assert.equal(classify(PINCH(1.66), TH, true), 'PINCH');
  assert.notEqual(classify(PINCH(1.70), TH, true), 'PINCH');
});

test('gap hysteresis: enter ≤ 0.56, hold ≤ 0.66', () => {
  assert.equal(classify(PINCH(1.2, 0.55), TH, false), 'PINCH');
  assert.notEqual(classify(PINCH(1.2, 0.60), TH, false), 'PINCH');
  assert.equal(classify(PINCH(1.2, 0.60), TH, true), 'PINCH');
  assert.notEqual(classify(PINCH(1.2, 0.67), TH, true), 'PINCH');
});

test('a fist can never be a pinch, even with the thumb on the index (gap 0.33–0.41)', () => {
  for (const gap of [0.30, 0.33, 0.366, 0.41]) {
    const f = FIST(); f.pinchDist = gap;
    assert.notEqual(classify(f, TH, false), 'PINCH');
    assert.notEqual(classify(f, TH, true), 'PINCH');
  }
});

test('a point can never be a pinch', () => {
  for (const gap of [0.2, 0.4, 0.7]) { const p = POINT(); p.pinchDist = gap; assert.notEqual(classify(p, TH, true), 'PINCH'); }
});

test('an open hand never enters a pinch: index reach ≥ 1.685 or gap ≥ 0.66 blocks it', () => {
  const o = OPEN(); o.fingers.index.reach = 1.685; o.pinchDist = 0.40;   // thumb close, but index fully out
  assert.notEqual(classify(o, TH, false), 'PINCH');
  const o2 = OPEN(); o2.fingers.index.reach = 1.60; o2.pinchDist = 0.66;  // index lower, but thumb clearly away
  assert.notEqual(classify(o2, TH, false), 'PINCH');
});

test('OPEN/FIST/POINT thresholds are frozen', () => {
  assert.deepEqual(
    { extStraight: TH.extStraight, extReach: TH.extReach, curlReach: TH.curlReach, curlStraight: TH.curlStraight, openThumbGap: TH.openThumbGap, fistThumbOut: TH.fistThumbOut },
    { extStraight: 0.80, extReach: 1.35, curlReach: 1.20, curlStraight: 0.60, openThumbGap: 0.45, fistThumbOut: 0.55 },
  );
});

test('vote stabiliser ignores a 2-frame blip at 30 fps', () => {
  const v = new VoteStabilizer();
  let t = 0, out;
  for (let i = 0; i < 15; i++) out = v.push('PINCH', (t += 33));
  out = v.push('OPEN', (t += 33)); out = v.push('OPEN', (t += 33));
  assert.equal(out, 'PINCH');
});
