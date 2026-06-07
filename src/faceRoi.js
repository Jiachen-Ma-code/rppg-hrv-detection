// Face ROI sampling: locate forehead + cheeks with MediaPipe FaceLandmarker and
// return the mean RGB of skin pixels inside those patches.
//
// MediaPipe is loaded with a dynamic import() so that a CDN/network failure
// degrades gracefully to a fixed center-ROI fallback instead of breaking the app.

const TASKS_VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12';
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// FaceMesh landmark index groups whose bounding boxes give skin patches.
const GROUPS = {
  forehead: [107, 66, 69, 9, 336, 296, 299],
  leftCheek: [205, 50, 123, 118, 117],
  rightCheek: [425, 280, 352, 347, 346],
};

const PROC_W = 256;
const PROC_H = 192;

export class FaceRoi {
  constructor() {
    this.landmarker = null;
    this.ready = false;
    this.useSkin = true;
    this.rects = [];
    this.faceFound = false;
    this.canvas = document.createElement('canvas');
    this.canvas.width = PROC_W;
    this.canvas.height = PROC_H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  async init() {
    try {
      const vision = await import(/* @vite-ignore */ TASKS_VISION);
      const { FaceLandmarker, FilesetResolver } = vision;
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      this.ready = true;
    } catch (e) {
      console.warn('FaceLandmarker unavailable; using center-ROI fallback.', e);
      this.ready = false;
    }
    return this.ready;
  }

  // Returns { r, g, b, count, faceFound, rectsNorm } where rectsNorm are
  // {x,y,w,h} in normalized [0,1] coordinates for overlay drawing.
  // doDetect: run the (expensive) face detector on this call. When false, reuse
  // the last ROI rectangles — so the caller can sample colour every frame at full
  // frame-rate while only detecting a few times per second.
  sample(video, tsMs, doDetect = true) {
    this.ctx.drawImage(video, 0, 0, PROC_W, PROC_H);

    if (doDetect && this.ready && this.landmarker) {
      let res = null;
      try {
        // Detect on the downscaled canvas — far cheaper than full-res video.
        res = this.landmarker.detectForVideo(this.canvas, tsMs);
      } catch (e) {
        res = null;
      }
      if (res && res.faceLandmarks && res.faceLandmarks.length) {
        const lm = res.faceLandmarks[0];
        this.faceFound = true;
        const rects = [];
        for (const key of Object.keys(GROUPS)) {
          rects.push(this._rectFromGroup(lm, GROUPS[key]));
        }
        this.rects = rects;
      } else {
        this.faceFound = false;
        this.rects = [];
      }
    }

    const rects = this.rects.length
      ? this.rects
      : [{ x: 0.375, y: 0.18, w: 0.25, h: 0.18 }]; // center-ROI fallback

    let sr = 0, sg = 0, sb = 0, count = 0;
    for (const rc of rects) {
      const x = clampInt(rc.x * PROC_W, 0, PROC_W - 1);
      const y = clampInt(rc.y * PROC_H, 0, PROC_H - 1);
      const w = clampInt(rc.w * PROC_W, 1, PROC_W - x);
      const h = clampInt(rc.h * PROC_H, 1, PROC_H - y);
      const data = this.ctx.getImageData(x, y, w, h).data;
      for (let i = 0; i < data.length; i += 4) {
        const R = data[i], G = data[i + 1], B = data[i + 2];
        if (this.useSkin && !isSkin(R, G, B)) continue;
        sr += R; sg += G; sb += B; count++;
      }
    }

    if (count === 0) return { r: 0, g: 0, b: 0, count: 0, faceFound: this.faceFound, rectsNorm: rects };
    return { r: sr / count, g: sg / count, b: sb / count, count, faceFound: this.faceFound, rectsNorm: rects };
  }

  _rectFromGroup(lm, idxs) {
    let minx = 1, miny = 1, maxx = 0, maxy = 0;
    for (const i of idxs) {
      const p = lm[i];
      if (!p) continue;
      if (p.x < minx) minx = p.x;
      if (p.y < miny) miny = p.y;
      if (p.x > maxx) maxx = p.x;
      if (p.y > maxy) maxy = p.y;
    }
    return { x: minx, y: miny, w: Math.max(0.01, maxx - minx), h: Math.max(0.01, maxy - miny) };
  }
}

function clampInt(v, lo, hi) {
  v = Math.round(v);
  return v < lo ? lo : v > hi ? hi : v;
}

// YCbCr skin test using the original project's thresholds:
// 98 <= Cb <= 142 and 133 <= Cr <= 177 (8-bit, centered at 128).
export function isSkin(r, g, b) {
  const cb = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
  const cr = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
  return cb >= 98 && cb <= 142 && cr >= 133 && cr <= 177;
}
