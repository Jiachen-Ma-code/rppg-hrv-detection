// CHROM rPPG (de Haan & Jeanne, 2013).
// RGB time series -> chrominance pulse signal S = Xf - alpha * Yf.

import { bandpass, std, mean } from '../dsp/filters.js';

export function chrom(R, G, B, fs, opts = {}) {
  const f1 = opts.f1 ?? 0.7;
  const f2 = opts.f2 ?? 4.0;
  const n = R.length;

  const mr = mean(R) || 1e-9;
  const mg = mean(G) || 1e-9;
  const mb = mean(B) || 1e-9;

  const Xs = new Float64Array(n);
  const Ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const rn = R[i] / mr;
    const gn = G[i] / mg;
    const bn = B[i] / mb;
    Xs[i] = 3 * rn - 2 * gn;
    Ys[i] = 1.5 * rn + gn - 1.5 * bn;
  }

  const Xf = bandpass(Xs, f1, f2, fs);
  const Yf = bandpass(Ys, f1, f2, fs);
  const a = std(Xf) / (std(Yf) || 1e-9);

  const S = new Float64Array(n);
  for (let i = 0; i < n; i++) S[i] = Xf[i] - a * Yf[i];
  return S;
}
