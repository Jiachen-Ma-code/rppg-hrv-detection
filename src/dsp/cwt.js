// Continuous Wavelet Transform (analytic Morlet) via FFT, with band-select
// denoising and inverse reconstruction. Follows the Torrence & Compo (1998)
// formulation, mirroring the original MATLAB cwt('amor')/icwt denoising step.

import { fft, ifft, nextPow2 } from './fft.js';
import { variance } from './filters.js';

const OMEGA0 = 6;                       // Morlet central frequency
const PI_M14 = Math.pow(Math.PI, -0.25);
const CDELTA = 0.776;                   // reconstruction constant for Morlet w0=6
const PSI0_0 = PI_M14;                  // psi0(0) for Morlet

// Fourier wavelength = factor * scale.
function periodFactor(omega0) {
  return (4 * Math.PI) / (omega0 + Math.sqrt(2 + omega0 * omega0));
}

export function scaleToFreq(s, omega0 = OMEGA0) {
  return 1 / (periodFactor(omega0) * s);
}

// Forward CWT. Returns complex coefficients per scale (Wre[j], Wim[j]),
// the scales, and their Fourier-equivalent frequencies.
export function cwtMorlet(signal, dt, opts = {}) {
  const omega0 = opts.omega0 ?? OMEGA0;
  const dj = opts.dj ?? 0.125;
  const s0 = opts.s0 ?? 2 * dt;
  const N0 = signal.length;
  const N = nextPow2(N0);

  const xre = new Float64Array(N);
  const xim = new Float64Array(N);
  let m = 0;
  for (let i = 0; i < N0; i++) m += signal[i];
  m /= N0;
  for (let i = 0; i < N0; i++) xre[i] = signal[i] - m;
  fft(xre, xim);

  const omega = new Float64Array(N);
  const base = 2 * Math.PI / (N * dt);
  for (let k = 0; k < N; k++) omega[k] = (k <= N / 2 ? k : k - N) * base;

  const J = opts.J ?? Math.max(1, Math.floor(Math.log2((N0 * dt) / s0) / dj));
  const nScales = J + 1;
  const scales = new Float64Array(nScales);
  const freqs = new Float64Array(nScales);
  const Wre = [];
  const Wim = [];

  for (let j = 0; j < nScales; j++) {
    const s = s0 * Math.pow(2, j * dj);
    scales[j] = s;
    freqs[j] = scaleToFreq(s, omega0);
    const norm = Math.sqrt((2 * Math.PI * s) / dt) * PI_M14;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      let psi = 0;
      if (omega[k] > 0) {
        const x = s * omega[k] - omega0;
        psi = norm * Math.exp(-0.5 * x * x); // Morlet daughter (real, analytic)
      }
      re[k] = xre[k] * psi; // multiply by conj(psi); psi is real
      im[k] = xim[k] * psi;
    }
    ifft(re, im);
    Wre.push(re);
    Wim.push(im);
  }

  return { Wre, Wim, scales, freqs, N0, dt, dj };
}

// Inverse CWT (Torrence & Compo eq. 11), real reconstruction.
export function icwtMorlet(Wre, scales, dt, dj, N0) {
  const nScales = scales.length;
  const factor = (dj * Math.sqrt(dt)) / (CDELTA * PSI0_0);
  const out = new Float64Array(N0);
  for (let n = 0; n < N0; n++) {
    let s = 0;
    for (let j = 0; j < nScales; j++) s += Wre[j][n] / Math.sqrt(scales[j]);
    out[n] = factor * s;
  }
  return out;
}

// Denoise by keeping only wavelet scales whose frequency lies in [f1, f2].
// If singleScale is true, keep only the single most energetic in-band scale
// (this reproduces the original MATLAB behaviour; it suppresses true HRV, so
// it is off by default).
export function cwtDenoise(signal, fs, opts = {}) {
  const f1 = opts.f1 ?? 0.75;
  const f2 = opts.f2 ?? 4.0;
  const singleScale = opts.singleScale ?? false;
  const dt = 1 / fs;

  const { Wre, Wim, scales, freqs, N0, dj } = cwtMorlet(signal, dt, opts);
  const nScales = scales.length;
  const energy = new Float64Array(nScales);

  for (let j = 0; j < nScales; j++) {
    if (freqs[j] < f1 || freqs[j] > f2) {
      Wre[j].fill(0);
      Wim[j].fill(0);
      continue;
    }
    let e = 0;
    for (let n = 0; n < N0; n++) e += Math.hypot(Wre[j][n], Wim[j][n]);
    energy[j] = e;
  }

  if (singleScale) {
    let bj = -1, be = -1;
    for (let j = 0; j < nScales; j++) {
      if (energy[j] > be) { be = energy[j]; bj = j; }
    }
    for (let j = 0; j < nScales; j++) {
      if (j !== bj) { Wre[j].fill(0); Wim[j].fill(0); }
    }
  }

  const rec = icwtMorlet(Wre, scales, dt, dj, N0);

  // Rescale to the original variance (matches MATLAB wt_rec*(var(S)/var(wt_rec))^0.5).
  const vs = variance(signal);
  const vr = variance(rec);
  if (vr > 0) {
    const g = Math.sqrt(vs / vr);
    for (let i = 0; i < rec.length; i++) rec[i] *= g;
  }
  return rec;
}
