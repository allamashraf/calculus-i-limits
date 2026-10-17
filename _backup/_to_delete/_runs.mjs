import fs from 'node:fs';
import { replay } from './js/gesture/replay.mjs';
import { remoteThresholds } from './js/gesture/remote.mjs';
for (const f of process.argv.slice(2)) {
  const r = JSON.parse(fs.readFileSync(f,'utf8')).results[0];
  const tl = replay(r.samples, remoteThresholds());
  const runs=[]; let cur=null;
  r.samples.forEach((s,i)=>{const st=tl[i].stable; if(!cur||cur.st!==st){ if(cur) {cur.end=s.t; runs.push(cur);} cur={st,start:s.t,segs:new Set()}; } cur.segs.add(s.seg);});
  cur.end=r.samples.at(-1).t; runs.push(cur);
  const own={POINT:'POINT',OPEN:'OPEN',FIST:'FIST'};
  console.log(f);
  for (const x of runs) if (own[x.st]) { const ok=[...x.segs].every(s=>s===x.st); console.log(`  ${x.st.padEnd(5)} ${x.start}-${x.end} ${x.end-x.start}ms segs=${[...x.segs]} ${ok?'':'<-- WRONG'}`); }
}
