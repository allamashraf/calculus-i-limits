// tracker.mjs — hand tracking at camera rate, presenter location in the background.
//
// v2.1 pipeline (after the 1 m measurements: hand 14 fps / 81 ms):
//  • PoseLandmarker runs in a Web Worker on the CPU, a few times per second, on a 640-px copy of
//    the frame. It never blocks a hand frame and never competes with the hand model for the GPU.
//  • HandLandmarker runs on every camera frame. Once a hand is found, it gets a small square that
//    follows the hand (the "hand ROI"), copied at full detail into a fixed 320×320 canvas — instead
//    of v2's 768×768 copy of the whole upper body (4× the pixels, which caused the slowdown).
//  • Only when the hand is lost does it search a wider area: around the body (from pose), or the
//    full frame.

import { FilesetResolver, HandLandmarker, PoseLandmarker } from '../../vendor/mediapipe/vision_bundle.mjs';

const ROOT = new URL('../../', import.meta.url);
export const TRACKER_INFO = {
  tasksVision: '0.10.35',
  handModel: 'hand_landmarker.task (float16, v1)',
  poseModel: 'pose_landmarker_lite.task (float16, v1)',
};

const ROI_PX = 320;            // fixed canvas handed to the hand model
const POSE = { lShoulder: 11, rShoulder: 12, lWrist: 15, rWrist: 16, lIndex: 19, rIndex: 20 };

async function createTask(Task, fileset, model, options, onStatus, label, order) {
  let lastErr = null;
  for (const delegate of order) {
    try {
      onStatus?.(`Loading ${label} on ${delegate}…`);
      const task = await Task.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: new URL(model, ROOT).href, delegate },
        runningMode: 'VIDEO',
        ...options,
      });
      return { task, delegate };
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error(`Could not create ${label}`);
}

function startPoseWorker() {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./pose.worker.mjs', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { w.terminate(); reject(new Error('pose worker did not start')); }, 30000);
    w.onmessage = (e) => {
      if (e.data.type === 'ready') { clearTimeout(timer); w.onmessage = null; resolve(w); }
      else if (e.data.type === 'error') { clearTimeout(timer); w.terminate(); reject(new Error(e.data.message)); }
    };
    w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error(e.message || 'pose worker error')); };
  });
}

export async function createTracker({ onStatus, delegate } = {}) {
  const order = delegate === 'CPU' ? ['CPU'] : ['GPU', 'CPU'];
  onStatus?.('Loading MediaPipe engine…');
  const fileset = await FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm', ROOT).href);
  const hand = await createTask(HandLandmarker, fileset, 'assets/models/hand_landmarker.task', {
    numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  }, onStatus, 'hand model', order);
  let worker = null, posePlain = null;
  try {
    onStatus?.('Starting pose worker…');
    worker = await startPoseWorker();
  } catch (err) {
    onStatus?.('Pose worker unavailable — pose on the main thread');
    posePlain = await createTask(PoseLandmarker, fileset, 'assets/models/pose_landmarker_lite.task', {
      numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    }, onStatus, 'pose model', order);
  }
  onStatus?.('Ready');
  return new Tracker(hand, worker, posePlain);
}

export class Tracker {
  constructor(hand, worker, posePlain) {
    this.hand = hand.task;
    this.worker = worker;
    this.posePlain = posePlain ? posePlain.task : null;
    this.delegates = { hand: hand.delegate, pose: worker ? 'CPU worker' : `${posePlain.delegate} main thread` };
    this.mode = 'auto';          // 'auto' | 'full'
    this.poseIntervalMs = 200;   // 5 Hz
    this.lastTs = 0;
    this.lastPose = null;
    this.poseBusy = false;
    this.lastPoseSent = -1e9;
    this.poseEvents = [];
    this.poseSize = { W: 0, H: 0 };
    this.roi = null;             // smoothed hand ROI {cx, cy, side}
    this.body = null;            // smoothed body crop
    this.lastHand = null;        // {x0,y0,x1,y1,ts} union box of the hands, full-frame px
    this.miss = 0;
    this.frame = 0;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = ROI_PX;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingQuality = 'high';
    if (worker) worker.onmessage = (e) => this.onPose(e.data);
  }

  onPose(d) {
    if (d.type !== 'pose') return;
    this.poseBusy = false;
    this.poseEvents.push({ ms: d.ms, at: performance.now() });
    this.lastPose = d.lm ? summarizePose(d.lm, this.poseSize.W, this.poseSize.H) : null;
  }

  /** Pose a few times per second, asynchronously; hand frames never wait for it. */
  schedulePose(video, ts) {
    if (this.poseBusy && ts - this.lastPoseSent > 1500) this.poseBusy = false;   // watchdog
    if (this.poseBusy || ts - this.lastPoseSent < this.poseIntervalMs) return;
    this.lastPoseSent = ts;
    const W = video.videoWidth, H = video.videoHeight;
    this.poseSize = { W, H };
    if (this.worker) {
      this.poseBusy = true;
      createImageBitmap(video, { resizeWidth: 640, resizeHeight: Math.round((640 * H) / W), resizeQuality: 'medium' })
        .then((bitmap) => this.worker.postMessage({ bitmap, ts }, [bitmap]))
        .catch(() => { this.poseBusy = false; });
    } else if (this.posePlain) {
      const t0 = performance.now();
      const res = this.posePlain.detectForVideo(video, ts);
      const lm = res.landmarks && res.landmarks[0] ? res.landmarks[0].map((p) => [p.x, p.y, p.visibility === undefined ? 1 : p.visibility]) : null;
      this.onPose({ type: 'pose', ms: performance.now() - t0, lm });
    }
  }

  takePoseEvents() { const e = this.poseEvents; this.poseEvents = []; return e; }

  /** Process one camera frame. ts: monotonically increasing milliseconds. */
  process(video, ts) {
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    const dt = this.lastTs ? ts - this.lastTs : 33;
    this.lastTs = ts;
    this.frame++;
    const W = video.videoWidth, H = video.videoHeight;
    this.schedulePose(video, ts);

    const pose = this.lastPose;
    const handFresh = this.lastHand && ts - this.lastHand.ts < 300;
    let crop;
    if (this.mode !== 'full' && handFresh) crop = this.handRoi(W, H, dt);
    else if (this.mode !== 'full' && pose && pose.shouldersOk && !(this.miss >= 8 && this.frame % 2)) crop = this.bodyCrop(pose, W, H, dt);
    else crop = { x: 0, y: 0, w: W, h: H, mode: 'full' };
    if (crop.mode !== 'hand') this.roi = null;

    let input = video;
    if (crop.mode !== 'full') {
      this.ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, ROI_PX, ROI_PX);
      input = this.canvas;
    }
    const t1 = performance.now();
    const res = this.hand.detectForVideo(input, ts);
    const handMs = performance.now() - t1;

    const handed = res.handedness || res.handednesses || [];
    const hands = (res.landmarks || []).map((lm, i) => ({
      px: lm.map((p) => ({ x: crop.x + p.x * crop.w, y: crop.y + p.y * crop.h, z: p.z * crop.w })),
      world: res.worldLandmarks[i],
      score: handed[i] && handed[i][0] ? handed[i][0].score : NaN,
      label: handed[i] && handed[i][0] ? handed[i][0].categoryName : '',
    }));
    if (hands.length) {
      this.miss = 0;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const h of hands) for (const p of h.px) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      this.lastHand = { x0, y0, x1, y1, ts };
    } else this.miss++;
    return { W, H, poseEvents: this.takePoseEvents(), pose, crop, hands, handMs };
  }

  /** Small square that follows the hand(s): ~2.4× the hand box, re-centred smoothly, resized only on real change. */
  handRoi(W, H, dt) {
    const b = this.lastHand;
    const size = Math.max(b.x1 - b.x0, b.y1 - b.y0);
    const target = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, side: Math.min(Math.max(2.4 * size, 120), W, H) };
    let r = this.roi;
    if (!r) r = this.roi = { ...target };
    const k = 1 - Math.exp(-dt / 90);
    if (Math.hypot(target.cx - r.cx, target.cy - r.cy) > 0.06 * r.side) { r.cx += (target.cx - r.cx) * k; r.cy += (target.cy - r.cy) * k; }
    if (target.side > r.side * 1.1 || target.side < r.side * 0.75) r.side += (target.side - r.side) * Math.min(1, k * 1.5);
    return squareIn(r.cx, r.cy, r.side, W, H, 'hand');
  }

  /** Wider search area around shoulders + wrists (used only while no hand is tracked). */
  bodyCrop(pose, W, H, dt) {
    const S = pose.shoulderPx;
    const pts = [pose.pts[POSE.lShoulder], pose.pts[POSE.rShoulder]];
    for (const i of [POSE.lWrist, POSE.rWrist, POSE.lIndex, POSE.rIndex]) if (pose.vis[i] > 0.3) pts.push(pose.pts[i]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const m = 0.8 * S;
    const target = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, side: Math.min(Math.max(x1 - x0 + 2 * m, y1 - y0 + 2 * m, 2.2 * S), W, H) };
    let c = this.body;
    if (!c) c = this.body = { ...target };
    const k = 1 - Math.exp(-dt / 350);
    c.cx += (target.cx - c.cx) * k; c.cy += (target.cy - c.cy) * k; c.side += (target.side - c.side) * k;
    return squareIn(c.cx, c.cy, c.side, W, H, 'body');
  }
}

function squareIn(cx, cy, side, W, H, mode) {
  const s = Math.round(Math.min(side, W, H));
  const x = Math.round(Math.max(0, Math.min(W - s, cx - s / 2)));
  const y = Math.round(Math.max(0, Math.min(H - s, cy - s / 2)));
  return { x, y, w: s, h: s, mode };
}

function summarizePose(lm, W, H) {
  const pts = lm.map((p) => ({ x: p[0] * W, y: p[1] * H }));
  const vis = lm.map((p) => p[2]);
  const shouldersOk = vis[POSE.lShoulder] > 0.5 && vis[POSE.rShoulder] > 0.5;
  const shoulderPx = Math.hypot(pts[11].x - pts[12].x, pts[11].y - pts[12].y);
  return { pts, vis, shouldersOk, shoulderPx, shoulderVis: Math.min(vis[11], vis[12]) };
}

export const POSE_INDEX = POSE;
