# Gesture Lab — Phase 0 (camera feasibility)

This lab measures what **your** laptop camera can reliably track before any gesture control is built.
It does not change the exhibit. Nothing is recorded or uploaded: all processing happens in the browser.

## Start

```bash
npm start
```

Open **http://localhost:4173/gesture-lab.html** in Chrome or Edge → **Start camera** → allow the camera.

(The lab does not work from a double-clicked file: the browser only allows the camera and the tracking engine on `localhost`.)

## Before you test

1. Plug the laptop in (battery mode slows the GPU).
2. Close Teams / Zoom / the Camera app (they lock the camera).
3. Tilt the laptop screen so that, standing at 4 m, you are fully in the picture.
4. Mark 1 m, 2 m, 3 m and 4 m on the floor, measured from the camera.
5. Light the room as it will be in the presentation, ideally with no bright window behind you.
6. Leave **Resolution 1280 × 720** and **Hand input: Auto** for the first pass.

## For each distance (1 m, then 2 m, 3 m, 4 m)

1. Click the distance button (1 m / 2 m / 3 m / 4 m).
2. Press **Record test**. You have a 10-second countdown.
3. Walk to the mark and face the camera. Raise your presenting hand to shoulder height, next to your body (not in front of your face). Keep the other hand down.
4. Follow the voice and the big text. Each gesture lasts 5 seconds: the first 1.5 s are for changing your hand (not scored), then hold it still for 3.5 s (scored):
   - **Open palm**: fingers spread, palm toward the camera.
   - **Fist**: the same hand closed, facing the camera.
   - **Point**: index finger up, the other fingers folded.
   - **Pinch**: tips of thumb and index finger touching.
5. A low tone and "Test complete" end the test. A row appears in the results table.

Frames are labelled by the time the camera captured them. The first 1.5 s of every gesture (the transition) is never scored.

With **Debug timeline** on (the default), the test screen shows a live timeline with these rows: EXPECTED (transition part dimmed), RAW SHAPE, SMOOTHED, STABLE SHAPE and FRAME AGE. White markers show when each prompt's text appeared; gold markers show when the voice started.

After the test, the same timeline and a **recorder audit** are shown. For each gesture the audit lists:
- the scheduled prompt time, and when the text and the voice actually appeared;
- when scoring began, and the first scored frame;
- the number of transition and scored frames;
- your reaction time;
- the frame age.

All per-frame timestamps and expected labels are saved in the JSON report.

Optional extra runs:
- Repeat 3 m and 4 m with **Resolution 1920 × 1080** (if your camera supports it).
- Repeat 3 m and 4 m with **Hand input: Full frame**, to see how much the zoom helps.

A run replaces the earlier result for the same distance and input mode.

## Send me the results

- **Copy summary** → paste it into the chat, and
- **Download report (JSON)** → keep the file. It holds the raw measurements and landmarks, so the gesture thresholds for Phase 1 can be tuned on your real data.

## What each number means

| Measurement | Meaning |
| --- | --- |
| Camera fps | Frames the camera actually delivers (drops in low light) |
| Hand / pose tracking fps | Frames the models process per second |
| Latency | Time from camera capture to result (median and 95th percentile) |
| Hand detected | Share of frames in which a hand was found |
| Confidence | The hand model's score for the detected hand (0–1) |
| Palm width | Distance between index and pinky knuckles, in camera pixels |
| Shoulder width | From the body model, in camera pixels |
| Landmark stability | Average frame-to-frame movement of the 21 hand points, as % of palm width (lower is steadier) |
| Pointer jitter | Tremor + noise of a future laser pointer, in pixels of a 1920-px wide projector image, raw and after smoothing |
| Range tier | NEAR = all four gestures, FAR = open, fist and point only, LOST = unreliable. The live thresholds are provisional until you press "Use these for the live tier" after testing |

**Verdict per gesture:**
- **reliable**: detected ≥ 90%, recognised ≥ 90%, and at most 0.8 changes per second.
- **marginal**: both detection and recognition ≥ 70%.
- **disable**: anything below that.

## Classifier diagnostics (v2)

The **Classifier — live features** panel shows exactly what the classifier sees:

- For each finger: **straightness** (|knuckle→tip| ÷ bone length; 1 = straight), **reach** (|wrist→tip| ÷ |wrist→knuckle|; about 2 when extended, about 1 when curled into the palm), the PIP/DIP joint angles, and the resulting state: extended, curled or partial.
- **Thumb ↔ index gap**: the closest distance between the last thumb bone and the last index bone, divided by palm size.
- **Thumb out**: how far the thumb tip is from the folded fingers.
- **Palm facing**: diagnostic only.
- **Hand scale**.
- For each gesture: its confidence, and the exact condition that failed, with values.

After a recording, the results show for each gesture:
- the most common failure reasons;
- the 10th percentile, median and 90th percentile of every feature;
- suggested thresholds, placed in the measured gap between classes. If the classes overlap, the lab says so and changes nothing.

**Apply these thresholds** re-scores the recording. Confirm it with a fresh recording.

Results from classifier v1 are not shown any more: they were scored with the faulty finger geometry.

## Pipeline v2.1 (speed and stability)

- **Pose** runs in a background worker on the CPU, by default 5 times per second, so it never blocks a hand frame or competes for the GPU.
- **Hand tracking** runs on every camera frame. Once your hand is found, the model gets only a small square that follows your hand (copied into 320×320), not the whole upper body. It searches wider only when the hand is lost.
- **Temporal robustness:**
  - a 3-frame median on the features removes isolated landmark glitches;
  - a 300 ms vote keeps the current gesture through short blips, and switches only when a new gesture clearly takes over.

  The gesture thresholds are unchanged.
- **Results** split each gesture's failures into:
  - **glitches**: 1–2 bad frames in a row, absorbed by the smoothing;
  - **sustained**: 3 or more in a row, with their reasons.

  The single-frame rate is shown next to the final rate, so nothing is hidden.
- **Range tier** describes tracking only: detection and hand size. How many gestures are reliable is shown next to it ("n/4 gestures reliable").

## PINCH v3 (composite, with hysteresis)

PINCH is the "OK sign" you actually make: thumb meets index, the index tilts toward the thumb, and middle, ring and pinky stay extended. The thresholds come from your own 1 m recording:

- **Start (enter):** thumb–index gap ≤ 0.56.
- **Keep (release):** a held pinch ends only when the gap goes above 0.66, so click and drag cannot chatter.
- **Index reach** between 0.97 and 1.53.
- **Middle, ring and pinky** extended, using the same rule as OPEN.

A fist can never be a pinch, because in a fist the other three fingers are curled. OPEN, FIST and POINT thresholds are unchanged.

## Regression suite (no more manual trial and error)

```bash
npm test
```
Unit tests for the gesture rules and every PINCH safety boundary.

```bash
npm run validate:gestures
```
Replays every real recording in `tests/recordings/manifest.json` through the production pipeline (`js/gesture/replay.mjs`, the same code the lab uses). It prints:
- recognition for each gesture;
- PINCH precision and recall;
- false PINCH frames on OPEN, FIST and POINT;
- the confusion matrix;
- dangerous PINCH onsets: would-be clicks outside the PINCH window, transitions included.

It exits with an error if a **validation** recording fails the gate. The gate is OPEN, FIST and POINT ≥ 95%, PINCH ≥ 90%, and 0 dangerous onsets.

```bash
npm run validate:gestures -- --add path/to/report.json
```
Validates a fresh capture straight from your Downloads folder.

**Rules:**
- **Calibration** recordings may be used to choose thresholds. **Validation** recordings are only ever used to measure them.
- The lab now saves the JSON report automatically after each test, so per-frame data is never lost.

## Options

- `http://localhost:4173/gesture-lab.html?delegate=CPU`: forces the CPU path, if the GPU path fails on your graphics driver.

## Files (Phase 0)

```text
gesture-lab.html          the lab page
css/gesture-lab.css       its styles
js/gesture/tracker.mjs    MediaPipe pose + hand, zoom around the presenter
js/gesture/features.mjs   hand geometry and the OPEN / FIST / POINT / PINCH rules (pure, reusable)
js/gesture/filters.mjs    One Euro filter, rolling windows, jitter (pure, reusable)
js/gesture/lab.mjs        live view, guided tests, analysis, report
vendor/mediapipe/         @mediapipe/tasks-vision 0.10.35 (Apache-2.0), see NOTICE.md
assets/models/            hand_landmarker.task, pose_landmarker_lite.task
server.mjs                + .wasm / .task file types (the only change to existing files)
```
