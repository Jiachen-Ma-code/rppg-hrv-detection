// Peak detection for pulse waves: local maxima above a relative threshold,
// with a refractory (minimum-distance) constraint from the max plausible HR.

export function findPeaks(x, fs, opts = {}) {
  const minBpm = opts.minBpm ?? 40;
  const maxBpm = opts.maxBpm ?? 200;
  const prominence = opts.prominence ?? 0.3; // fraction of (max - mean)
  const n = x.length;
  if (n < 3) return [];

  const minDist = Math.max(1, Math.round((fs * 60) / maxBpm));

  let m = 0;
  let mx = -Infinity;
  for (let i = 0; i < n; i++) { m += x[i]; if (x[i] > mx) mx = x[i]; }
  m /= n;
  const thr = m + prominence * (mx - m);

  const peaks = [];
  for (let i = 1; i < n - 1; i++) {
    if (x[i] >= x[i - 1] && x[i] > x[i + 1] && x[i] >= thr) {
      if (peaks.length === 0) { peaks.push(i); continue; }
      const last = peaks[peaks.length - 1];
      if (i - last < minDist) {
        if (x[i] > x[last]) peaks[peaks.length - 1] = i; // keep the taller
      } else {
        peaks.push(i);
      }
    }
  }
  return peaks; // sample indices
}

export function peakTimes(peaks, fs) {
  return peaks.map((i) => i / fs);
}
