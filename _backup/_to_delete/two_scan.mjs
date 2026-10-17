import fs from 'node:fs';
import { ShapeTracker, RemoteControl, remoteShape, remoteThresholds } from '../../js/gesture/remote.mjs';
import { fromCompact } from '../../js/gesture/features.mjs';
for (const f of ['tests/recordings/1m/2026-10-16_2241.json','tests/recordings/1m/2026-10-16_2244.json']) {
  const r = JSON.parse(fs.readFileSync(f,'utf8')).results[0];
  let rawTwo = {}; const tr = new ShapeTracker(); const rc = new RemoteControl(); const cmds=[]; let stableTwo={};
  for (const s of r.samples) {
    if (s.cf && remoteShape(fromCompact(s.cf)) === 'TWO') rawTwo[s.seg] = (rawTwo[s.seg]||0)+1;
    const st = tr.push(s.cf, s.t); if (st==='TWO') stableTwo[s.seg]=(stableTwo[s.seg]||0)+1;
    const c = rc.push(st, s.t); if (c) cmds.push(`${c}@${s.seg}${s.settle?'(T)':''}`);
  }
  console.log(f, 'raw TWO frames', JSON.stringify(rawTwo), 'stable TWO', JSON.stringify(stableTwo), '\n  cmds', cmds.join(' '));
}
