// End-to-end rPPG -> HRV pipeline.
// Takes a window of mean-RGB samples and produces a clean pulse + metrics.
//
//   RGB window
//     -> rPPG method (POS | CHROM)            -> raw pulse
//     -> HR engine  (bandpass+FFT | CWT)      -> clean pulse
//     -> peak detection -> R-R intervals      -> HRV + coherence

import { chrom } from './rppg/chrom.js';
import { pos } from './rppg/pos.js';
import { bandpass, detrend } from './dsp/filters.js';
import { dominantFrequency } from './dsp/fft.js';
import { cwtDenoise } from './dsp/cwt.js';
import { findPeaks, peakTimes } from './hrv/peaks.js';
import { hrvMetrics, rrIntervals } from './hrv/metrics.js';
import { coherence } from './hrv/coherence.js';

export const DEFAULTS = { f1: 0.7, f2: 4.0, minBpm: 40, maxBpm: 200, minSeconds: 6, minFps: 10 };

// win: { R, G, B, fs }  (typed/array channels + estimated sampling rate)
// opts: { method: 'pos'|'chrom', engine: 'fft'|'cwt', singleScale: boolean }
export function analyze(win, opts = {}) {
  const method = opts.method ?? 'pos';
  const engine = opts.engine ?? 'fft';
  const singleScale = opts.singleScale ?? false;
  const { R, G, B, fs } = win;

  if (!fs || !isFinite(fs) || R.length < fs * DEFAULTS.minSeconds) {
    return { ok: false, reason: 'collecting', haveSec: fs ? R.length / fs : 0 };
  }
  if (fs < DEFAULTS.minFps) {
    return { ok: false, reason: 'lowfps', fs, haveSec: R.length / fs };
  }

  const raw = method === 'chrom'
    ? chrom(R, G, B, fs, DEFAULTS)
    : pos(R, G, B, fs, DEFAULTS);

  let pulse;
  if (engine === 'cwt') {
    pulse = cwtDenoise(raw, fs, { f1: 0.75, f2: DEFAULTS.f2, singleScale });
  } else {
    pulse = bandpass(detrend(raw), DEFAULTS.f1, DEFAULTS.f2, fs);
  }

  const bpmSpectral = 60 * dominantFrequency(pulse, fs, DEFAULTS.f1, DEFAULTS.f2);
  const peaks = findPeaks(pulse, fs, { minBpm: DEFAULTS.minBpm, maxBpm: DEFAULTS.maxBpm });
  const pts = peakTimes(peaks, fs);
  const hrv = hrvMetrics(pts);
  const rr = rrIntervals(pts);
  const coh = coherence(rr);

  return {
    ok: true,
    method,
    engine,
    singleScale,
    fs,
    pulse,
    peaks,
    rr,
    bpmSpectral,
    bpmPeak: hrv.bpm,
    meanRR: hrv.meanRR,
    sdnn: hrv.sdnn,
    rmssd: hrv.rmssd,
    pnn50: hrv.pnn50,
    nBeats: hrv.n + (hrv.n >= 0 ? 1 : 0),
    coherence: coh,
  };
}
