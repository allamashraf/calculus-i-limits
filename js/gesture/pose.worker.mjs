// pose.worker.mjs — PoseLandmarker on its own thread, on the CPU.
// The hand model keeps the page's GPU and main thread to itself; pose only has to locate the
// presenter (shoulders, wrists) a few times per second, so it never blocks a hand frame.

import { FilesetResolver, PoseLandmarker } from '../../vendor/mediapipe/vision_bundle.mjs';

const ROOT = new URL('../../', import.meta.url);
let pose = null;
let lastTs = 0;

async function init() {
  const fileset = await FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm', ROOT).href, true); // true = module variant for workers
  pose = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: new URL('assets/models/pose_landmarker_lite.task', ROOT).href, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

const ready = init().then(
  () => self.postMessage({ type: 'ready' }),
  (err) => self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) }),
);

self.onmessage = async (e) => {
  const { bitmap, ts } = e.data;
  await ready;
  if (!pose) { bitmap.close(); return; }
  const t = Math.max(ts, lastTs + 1);
  lastTs = t;
  const t0 = performance.now();
  let lm = null;
  try {
    const res = pose.detectForVideo(bitmap, t);
    lm = res.landmarks && res.landmarks[0] ? res.landmarks[0].map((p) => [p.x, p.y, p.visibility === undefined ? 1 : p.visibility]) : null;
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
  }
  bitmap.close();
  self.postMessage({ type: 'pose', ts, ms: performance.now() - t0, lm });
};
