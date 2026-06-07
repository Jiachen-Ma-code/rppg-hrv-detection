// POS rPPG — Plane Orthogonal to Skin (Wang et al., 2017).
// Canonical sliding-window overlap-add implementation.

import { std } from '../dsp/filters.js';

export function pos(R, G, B, fs, opts = {}) {
  const n = R.length;
  const L = Math.max(2, Math.round((opts.windowSec ?? 1.6) * fs)); // ~1.6 s window
  const H = new Float64Array(n);
  if (n < L) return H;

  for (let t = 0; t + L <= n; t++) {
    let mr = 0, mg = 0, mb = 0;
    for (let i = t; i < t + L; i++) { mr += R[i]; mg += G[i]; mb += B[i]; }
    mr = (mr / L) || 1e-9;
    mg = (mg / L) || 1e-9;
    mb = (mb / L) || 1e-9;

    // S = [[0, 1, -1], [-2, 1, 1]] * normalized RGB
    const s1 = new Float64Array(L);
    const s2 = new Float64Array(L);
    for (let i = 0; i < L; i++) {
      const rn = R[t + i] / mr;
      const gn = G[t + i] / mg;
      const bn = B[t + i] / mb;
      s1[i] = gn - bn;
      s2[i] = -2 * rn + gn + bn;
    }

    const alpha = std(s1) / (std(s2) || 1e-9);

    let hm = 0;
    const h = new Float64Array(L);
    for (let i = 0; i < L; i++) { h[i] = s1[i] + alpha * s2[i]; hm += h[i]; }
    hm /= L;
    for (let i = 0; i < L; i++) H[t + i] += h[i] - hm; // overlap-add
  }

  return H;
}
