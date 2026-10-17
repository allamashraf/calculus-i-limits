import fs from 'node:fs';
import { replay } from './js/gesture/replay.mjs';
import { RemoteControl, remoteThresholds } from './js/gesture/remote.mjs';
const r = JSON.parse(fs.readFileSync('tests/recordings/1m/2026-10-16_2241.json','utf8')).results[0];
const tl = replay(r.samples, remoteThresholds()); const rc = new RemoteControl(); let prev=null;
r.samples.forEach((s,i)=>{ const st=tl[i].stable; if(st!==prev){console.log('  stable',s.t,st,s.seg,s.settle?'T':''); prev=st;} const c=rc.push(st,s.t); if(c) console.log('CMD',s.t,c,s.seg,s.settle?'(transition)':''); });
