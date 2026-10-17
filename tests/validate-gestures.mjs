// Gesture regression validator.
//   npm run validate:gestures                      → all recordings in tests/recordings/manifest.json
//   npm run validate:gestures -- --add <file.json> → also validate an extra report (e.g. straight from Downloads)
//
// Replays every recorded frame through the production pipeline (js/gesture/replay.mjs) with the
// production thresholds (DEFAULT_THRESHOLDS — never the thresholds stored in the recording), prints
// the metrics and confusion matrices, and exits with code 1 if a VALIDATION recording fails the gate.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_THRESHOLDS } from '../js/gesture/features.mjs';
import { metrics, gate, LABELS, OUTPUTS } from '../js/gesture/replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'recordings', 'manifest.json'), 'utf8'));
const entries = manifest.recordings.map((r) => ({ ...r, file: path.join(here, 'recordings', r.file) }));
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) if (args[i] === '--add') entries.push({ file: path.resolve(args[++i]), role: 'validation', note: 'added on the command line' });

const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : '—');
const th = { ...DEFAULT_THRESHOLDS };
console.log('Production thresholds:', JSON.stringify(th));
let failed = false;
const pooled = { validation: [], calibration: [] };

for (const e of entries) {
  const rep = JSON.parse(fs.readFileSync(e.file, 'utf8'));
  for (const r of rep.results) {
    if (!r.samples) { console.log(`\n${path.basename(e.file)}: no per-frame samples, skipped`); continue; }
    const m = metrics(r.samples, th);
    const g = gate(m);
    pooled[e.role === 'validation' ? 'validation' : 'calibration'].push(r.samples);
    console.log(`\n=== ${path.basename(e.file)} — ${r.distance} m — ${e.role.toUpperCase()}${e.note ? ` (${e.note})` : ''}`);
    console.log(`frames ${m.frames}`);
    console.log(`recognition (stable): ${LABELS.map((l) => `${l} ${pct(m.recognition[l])}`).join('  ')}`);
    console.log(`recognition (single frame): ${LABELS.map((l) => `${l} ${pct(m.recognitionRaw[l])}`).join('  ')}`);
    console.log(`PINCH precision ${pct(m.pinch.precision)} · recall ${pct(m.pinch.recall)} · stable ${pct(m.pinch.stable)}`);
    console.log(`false PINCH (stable frames) on OPEN ${m.pinch.falseOn.OPEN} · FIST ${m.pinch.falseOn.FIST} · POINT ${m.pinch.falseOn.POINT}   (single frame: ${m.pinch.falseOnRaw.OPEN} / ${m.pinch.falseOnRaw.FIST} / ${m.pinch.falseOnRaw.POINT})`);
    console.log(`PINCH onsets ${m.pinch.onsets} · dangerous onsets (outside the PINCH window, transitions included) ${m.pinch.dangerousOnsets.length}${m.pinch.dangerousOnsets.length ? ' → ' + m.pinch.dangerousOnsets.map((o) => `${o.seg} @ ${(o.into / 1000).toFixed(2)} s${o.settle ? ' (transition)' : ''}`).join(', ') : ''}`);
    console.log('confusion (rows = expected, columns = stable output, scored frames):');
    console.log('        ' + OUTPUTS.map((o) => o.padStart(8)).join(''));
    for (const l of LABELS) console.log(l.padEnd(8) + OUTPUTS.map((o) => String(m.confusion[l][o]).padStart(8)).join(''));
    console.log(`gate: ${g.pass ? 'PASS' : 'FAIL — ' + g.fails.join('; ')}${e.role === 'validation' ? '' : ' (calibration data — informational only)'}`);
    if (e.role === 'validation' && !g.pass) failed = true;
  }
}

if (pooled.validation.length > 1) {
  // pooled metrics: concatenate recordings with a time gap so smoothing state cannot leak between them
  let offset = 0;
  const all = [];
  for (const sm of pooled.validation) { for (const s of sm) all.push({ ...s, t: s.t + offset }); offset = all[all.length - 1].t + 10000; }
  const m = metrics(all, th);
  console.log(`\n=== POOLED VALIDATION (${pooled.validation.length} recordings): ${LABELS.map((l) => `${l} ${pct(m.recognition[l])}`).join('  ')} · dangerous onsets ${m.pinch.dangerousOnsets.length} · gate ${gate(m).pass ? 'PASS' : 'FAIL'}`);
}
console.log(`\nVALIDATION ${failed ? 'FAILED' : 'PASSED'}`);
process.exit(failed ? 1 : 0);
