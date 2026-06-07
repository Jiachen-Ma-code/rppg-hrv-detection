// Heart-rate "coherence" (HeartMath-style): the share of spectral power in the
// LF band that is concentrated around the dominant peak. Mirrors the original
// MATLAB GetCoherence: resample the R-R tachogram, take a Hamming periodogram,
// and compute peak-band power / total-band power within [0.04, 0.4] Hz.

import { fft, nextPow2 } from '../dsp/fft.js';
import { interp1 } from '../dsp/filters.js';

export function coherence(rrMs, opts = {}) {
  const bandLow = opts.bandLow ?? 0.04;
  const bandHigh = opts.bandHigh ?? 0.4;
  const peakHalf = opts.peakHalf ?? 0.03;
  const fsResample = opts.fsResample ?? 4; // Hz (standard HRV resampling rate)

  const rr = Array.from(rrMs, (v) => v / 1000); // seconds
  if (rr.length < 4) return NaN;

  // Cumulative beat times, then resample the tachogram on a uniform grid.
  const rrTime = [];
  let acc = 0;
  for (const x of rr) { acc += x; rrTime.push(acc); }
  const total = acc;
  const dt = 1 / fsResample;
  const tq = [];
  for (let t = 0; t <= total; t += dt) tq.push(t);
  if (tq.length < 8) return NaN;

  const sig = interp1(rrTime, rr, tq);
  let m = 0;
  for (let i = 0; i < sig.length; i++) m += sig[i];
  m /= sig.length;

  const N = sig.length;
  const Np = nextPow2(N);
  const re = new Float64Array(Np);
  const im = new Float64Array(Np);
  for (let i = 0; i < N; i++) {
    const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (N - 1)); // Hamming
    re[i] = (sig[i] - m) * w;
  }
  fft(re, im);

  const half = Np >> 1;
  let peakP = -1;
  let peakF = 0;
  const idx = [];
  for (let k = 0; k < half; k++) {
    const f = (k * fsResample) / Np;
    if (f > bandLow && f < bandHigh) {
      const p = re[k] * re[k] + im[k] * im[k];
      idx.push({ f, p });
      if (p > peakP) { peakP = p; peakF = f; }
    }
  }
  if (idx.length === 0) return NaN;

  let peakBand = 0;
  let totalBand = 0;
  for (const { f, p } of idx) {
    totalBand += p;
    if (f > peakF - peakHalf && f < peakF + peakHalf) peakBand += p;
  }
  return totalBand > 0 ? peakBand / totalBand : NaN;
}
