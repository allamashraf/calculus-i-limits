// replay.mjs — the gesture decision pipeline as a pure function, shared by the lab (live re-scoring)
// and the regression validator (tests/validate-gestures.mjs), so both always measure the same thing.
//
//   per-frame features → 3-frame median → classifier (with PINCH enter/hold hysteresis) → 300 ms vote

import { classifyDetailed, fromCompact, FeatureSmoother, VoteStabilizer } from './features.mjs';

/**
 * samples: recorded frames in time order, each { t, cf | null } (cf = compact features).
 * Returns one entry per frame: raw (single frame), smooth (after median), stable (after vote), ex (raw explanation).
 */
export function replay(samples, th) {
  const smooth = new FeatureSmoother(3), vote = new VoteStabilizer();
  let heldRaw = false, heldSmooth = false;
  return samples.map((s) => {
    if (!s.cf) {
      smooth.reset(); heldRaw = heldSmooth = false;
      return { raw: null, smooth: null, stable: vote.push(null, s.t), ex: null };
    }
    const frame = classifyDetailed(fromCompact(s.cf), th, heldRaw);
    const sm = classifyDetailed(fromCompact(smooth.push(s.cf, s.t)), th, heldSmooth);
    heldRaw = frame.shape === 'PINCH';
    heldSmooth = sm.shape === 'PINCH';
    return { raw: frame.shape, smooth: sm.shape, stable: vote.push(sm.shape, s.t), ex: frame.explain };
  });
}

export const LABELS = ['OPEN', 'FIST', 'POINT', 'PINCH'];
export const OUTPUTS = ['OPEN', 'FIST', 'POINT', 'PINCH', 'NONE', 'no hand'];

/**
 * Metrics for one recording. Recognition and confusion use SCORED frames (transition excluded);
 * "dangerous" counts PINCH onsets (a would-be click) at ANY time outside the PINCH window,
 * transitions included — because a real click can happen whenever the hand moves.
 */
export function metrics(samples, th) {
  const tl = replay(samples, th);
  const conf = {}, confRaw = {};
  for (const e of LABELS) { conf[e] = Object.fromEntries(OUTPUTS.map((o) => [o, 0])); confRaw[e] = Object.fromEntries(OUTPUTS.map((o) => [o, 0])); }
  samples.forEach((s, i) => {
    if (s.settle || !LABELS.includes(s.seg)) return;
    conf[s.seg][tl[i].stable === null ? 'no hand' : tl[i].stable] += 1;
    confRaw[s.seg][tl[i].raw === null ? 'no hand' : tl[i].raw] += 1;
  });
  const total = (row) => Object.values(row).reduce((a, b) => a + b, 0);
  const rate = (e, m = conf) => (total(m[e]) ? m[e][e] / total(m[e]) : NaN);
  const tp = conf.PINCH.PINCH;
  const fpBy = { OPEN: conf.OPEN.PINCH, FIST: conf.FIST.PINCH, POINT: conf.POINT.PINCH };
  const fp = fpBy.OPEN + fpBy.FIST + fpBy.POINT;
  const onsets = [];
  let prev = 'NONE';
  samples.forEach((s, i) => {
    const st = tl[i].stable;
    if (st === 'PINCH' && prev !== 'PINCH') onsets.push({ t: s.t, seg: s.seg, into: s.into, settle: !!s.settle });
    prev = st;
  });
  const dangerous = onsets.filter((o) => o.seg !== 'PINCH');
  return {
    frames: samples.length,
    recognition: Object.fromEntries(LABELS.map((e) => [e, rate(e)])),
    recognitionRaw: Object.fromEntries(LABELS.map((e) => [e, rate(e, confRaw)])),
    pinch: {
      precision: tp + fp ? tp / (tp + fp) : NaN,
      recall: total(conf.PINCH) ? tp / total(conf.PINCH) : NaN,
      stable: rate('PINCH'),
      falseOn: fpBy,
      falseOnRaw: { OPEN: confRaw.OPEN.PINCH, FIST: confRaw.FIST.PINCH, POINT: confRaw.POINT.PINCH },
      onsets: onsets.length,
      dangerousOnsets: dangerous,
    },
    confusion: conf,
    confusionRaw: confRaw,
  };
}

/** Quality gate used before any live test. */
export function gate(m) {
  const fails = [];
  for (const e of ['OPEN', 'FIST', 'POINT']) if (!(m.recognition[e] >= 0.95)) fails.push(`${e} ${(m.recognition[e] * 100).toFixed(1)}% < 95%`);
  if (!(m.recognition.PINCH >= 0.9)) fails.push(`PINCH ${(m.recognition.PINCH * 100).toFixed(1)}% < 90%`);
  if (m.pinch.dangerousOnsets.length > 0) fails.push(`${m.pinch.dangerousOnsets.length} dangerous PINCH onset(s)`);
  return { pass: fails.length === 0, fails };
}
