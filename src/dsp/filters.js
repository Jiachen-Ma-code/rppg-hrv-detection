// Basic time-series helpers and an FFT-based rectangular band-pass filter.
// The band-pass mirrors the `bpfilt` used in the original MATLAB pipeline:
// FFT -> zero bins outside [f1, f2] -> inverse FFT -> real part.

import { fft, ifft, nextPow2 } from './fft.js';

export function mean(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}

// Sample standard deviation (ddof = 1), matching MATLAB std / numpy std(ddof=1).
export function std(a) {
  const n = a.length;
  if (n < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - m;
    s += d * d;
  }
  return Math.sqrt(s / (n - 1));
}

export function variance(a) {
  const s = std(a);
  return s * s;
}

export function removeMean(a) {
  const m = mean(a);
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] - m;
  return out;
}

// Remove a least-squares linear trend.
export function detrend(a) {
  const n = a.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += a[i]; sxx += i * i; sxy += i * a[i];
  }
  const d = n * sxx - sx * sx;
  const slope = d !== 0 ? (n * sxy - sx * sy) / d : 0;
  const inter = (sy - slope * sx) / n;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] - (slope * i + inter);
  return out;
}

export function bandpass(signal, f1, f2, fs) {
  const N0 = signal.length;
  const N = nextPow2(N0);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const m = mean(signal);
  for (let i = 0; i < N0; i++) re[i] = signal[i] - m; // zero-mean, zero-padded
  fft(re, im);
  for (let k = 0; k < N; k++) {
    const f = (k <= N / 2 ? k : k - N) * fs / N;
    const af = Math.abs(f);
    if (af < f1 || af > f2) { re[k] = 0; im[k] = 0; }
  }
  ifft(re, im);
  const out = new Float64Array(N0);
  for (let i = 0; i < N0; i++) out[i] = re[i];
  return out;
}

// Linear interpolation of (xp, fp) sampled at monotonically increasing x.
export function interp1(xp, fp, x) {
  const out = new Float64Array(x.length);
  let j = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    while (j < xp.length - 2 && xp[j + 1] < xi) j++;
    const x0 = xp[j], x1 = xp[j + 1], y0 = fp[j], y1 = fp[j + 1];
    const t = x1 > x0 ? (xi - x0) / (x1 - x0) : 0;
    out[i] = y0 + t * (y1 - y0);
  }
  return out;
}
