// App entry point: wires webcam -> face ROI -> ring buffer -> rPPG/HRV pipeline
// -> live metrics and plots. Build-less: plain ES modules, no bundler.

import { startCamera, stopCamera } from './camera.js';
import { FaceRoi } from './faceRoi.js';
import { RingBuffer } from './ringBuffer.js';
import { LinePlot } from './ui/plot.js';

// --- DOM ---
const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
const startBtn = $('startBtn');
const stopBtn = $('stopBtn');
const statusEl = $('status');
const faceBadge = $('faceBadge');

const out = {
  bpm: $('mBpm'), bpmSpec: $('mBpmSpec'), beats: $('mBeats'),
  sdnn: $('mSdnn'), rmssd: $('mRmssd'), pnn50: $('mPnn50'),
  capWin: $('capWin'), capHr: $('capHr'), capCoh: $('capCoh'), cohFill: $('cohFill'),
};

const pulsePlot = new LinePlot($('pulsePlot'));
const hrPlot = new LinePlot($('hrPlot'));

// Heavy DSP runs in a Web Worker so analysis can never stall the sampling loop.
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
worker.onmessage = (e) => handleResult(e.data);
worker.onerror = (e) => { analyzing = false; setStatus('Worker error: ' + e.message, true); };

// --- state ---
const SAMPLE_MIN_DT = 33;     // ~30 fps sampling cap
const DETECT_DT = 400;        // face re-detection interval (~2.5 Hz); detection is costly
const ANALYZE_DT = 1000;      // re-run heavy analysis at most this often (ms)
const BPM_HISTORY = 150;

const settings = { method: 'pos', engine: 'fft', singleScale: false, useSkin: true };

let stream = null;
let roi = null;
let buf = new RingBuffer(900);
let running = false;
let rafId = 0;
let lastSampleT = 0;
let lastDetectT = 0;
let lastAnalyzeT = 0;
let analyzing = false;
const bpmHistory = [];

// --- controls ---
function wireSegment(segId, key, attr) {
  const seg = $(segId);
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    settings[key] = btn.dataset[attr];
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('active', b === btn);
  });
}
wireSegment('methodSeg', 'method', 'method');
wireSegment('engineSeg', 'engine', 'engine');

$('singleScale').addEventListener('change', (e) => { settings.singleScale = e.target.checked; });
$('useSkin').addEventListener('change', (e) => {
  settings.useSkin = e.target.checked;
  if (roi) roi.useSkin = settings.useSkin;
});

startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);

// --- lifecycle ---
async function start() {
  if (running) return;
  setStatus('Requesting camera…');
  startBtn.disabled = true;
  try {
    stream = await startCamera(video, { width: 640, height: 480 });
  } catch (err) {
    setStatus('Camera error: ' + err.message, true);
    startBtn.disabled = false;
    return;
  }

  overlay.width = 640;
  overlay.height = 480;

  if (!roi) {
    roi = new FaceRoi();
    setStatus('Loading face model (first run downloads from CDN)…');
    await roi.init(); // resolves true/false; falls back to center ROI either way
  }
  roi.useSkin = settings.useSkin;

  buf.clear();
  bpmHistory.length = 0;
  lastSampleT = 0;
  lastDetectT = 0;
  lastAnalyzeT = 0;
  analyzing = false;
  running = true;
  stopBtn.disabled = false;
  setStatus(roi.ready ? 'Running — face tracking active.' : 'Running — center-ROI fallback (no face model).');
  rafId = requestAnimationFrame(loop);
}

function stop() {
  running = false;
  analyzing = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  stopCamera(stream);
  stream = null;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setFace(false);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  setStatus('Stopped.');
}

// --- main loop ---
function loop(t) {
  if (!running) return;
  rafId = requestAnimationFrame(loop);

  if (t - lastSampleT < SAMPLE_MIN_DT) return;
  lastSampleT = t;

  const doDetect = t - lastDetectT >= DETECT_DT;
  if (doDetect) lastDetectT = t;

  let s;
  try {
    s = roi.sample(video, t, doDetect);
  } catch (err) {
    setStatus('Sampling error: ' + err.message, true);
    return;
  }

  setFace(s.faceFound);
  drawOverlay(s.rectsNorm, s.faceFound);

  if (s.count > 0) buf.push(t, s.r, s.g, s.b);

  if (!analyzing && t - lastAnalyzeT >= ANALYZE_DT) {
    lastAnalyzeT = t;
    postAnalysis();
  }
}

function postAnalysis() {
  const win = buf.window();
  out.capWin.textContent = `window ${buf.durationSec().toFixed(1)} s @ ${Math.round(win.fs)} fps`;
  analyzing = true;
  worker.postMessage({ win, settings });
}

function handleResult(res) {
  analyzing = false;
  if (!running) return;

  if (!res.ok) {
    if (res.reason === 'lowfps') {
      setStatus(`Frame rate too low (~${res.fs.toFixed(1)} fps) for reliable HR — aim for ≥10 fps. Close other tabs and ensure good lighting.`, true);
    } else if (res.reason === 'error') {
      setStatus('Analysis error: ' + res.message, true);
    } else {
      setStatus(`Collecting… ${res.haveSec ? res.haveSec.toFixed(1) : '0.0'} s of ~6 s needed.`);
    }
    return;
  }
  setStatus(roi.ready ? 'Running — face tracking active.' : 'Running — center-ROI fallback.');

  // pulse waveform + peak markers
  pulsePlot.draw(res.pulse, { color: '#37d6c4', markers: res.peaks });

  // bpm history (prefer peak-based bpm; fall back to spectral)
  const bpm = res.bpmPeak && isFinite(res.bpmPeak) ? res.bpmPeak : res.bpmSpectral;
  if (bpm && isFinite(bpm)) {
    bpmHistory.push(bpm);
    if (bpmHistory.length > BPM_HISTORY) bpmHistory.shift();
  }
  hrPlot.draw(bpmHistory, { color: '#6ea8fe' });
  out.capHr.textContent = bpmHistory.length ? `last ${bpmHistory.length} estimates` : 'last --';

  // metrics
  out.bpm.textContent = fmt(bpm, 0);
  out.bpmSpec.textContent = fmt(res.bpmSpectral, 0);
  out.beats.textContent = res.nBeats ?? '--';
  out.sdnn.textContent = fmt(res.sdnn, 1);
  out.rmssd.textContent = fmt(res.rmssd, 1);
  out.pnn50.textContent = fmt(res.pnn50, 0);

  // coherence
  const coh = res.coherence ?? 0;
  out.cohFill.style.width = Math.max(0, Math.min(1, coh)) * 100 + '%';
  out.capCoh.textContent = `${coh.toFixed(2)} — ${cohLabel(coh)}`;
}

// --- overlay ---
function drawOverlay(rectsNorm, faceFound) {
  const W = overlay.width, H = overlay.height;
  octx.clearRect(0, 0, W, H);
  if (!rectsNorm || !rectsNorm.length) return;
  octx.lineWidth = 2;
  octx.strokeStyle = faceFound ? 'rgba(55,214,196,0.9)' : 'rgba(255,93,108,0.8)';
  for (const r of rectsNorm) {
    octx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
  }
}

// --- helpers ---
function setStatus(msg, isErr = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('err', !!isErr);
}
function setFace(found) {
  faceBadge.textContent = found ? 'face' : 'no face';
  faceBadge.classList.toggle('on', found);
  faceBadge.classList.toggle('off', !found);
}
function fmt(v, d) {
  return v == null || !isFinite(v) ? '--' : Number(v).toFixed(d);
}
function cohLabel(c) {
  if (c >= 0.6) return 'coherent';
  if (c >= 0.35) return 'mixed';
  return 'low';
}

window.addEventListener('beforeunload', () => stopCamera(stream));
