// Time-domain HRV metrics from peak (beat) times.

// R-R intervals in milliseconds from peak times in seconds.
export function rrIntervals(peakTimesSec) {
  const rr = [];
  for (let i = 1; i < peakTimesSec.length; i++) {
    rr.push(1000 * (peakTimesSec[i] - peakTimesSec[i - 1]));
  }
  return rr;
}

export function hrvMetrics(peakTimesSec) {
  const rr = rrIntervals(peakTimesSec);
  const n = rr.length;
  const empty = { meanRR: NaN, sdnn: NaN, rmssd: NaN, pnn50: NaN, bpm: NaN, n };
  if (n < 2) return empty;

  let sum = 0;
  for (let i = 0; i < n; i++) sum += rr[i];
  const meanRR = sum / n;

  let v = 0;
  for (let i = 0; i < n; i++) { const d = rr[i] - meanRR; v += d * d; }
  const sdnn = Math.sqrt(v / (n - 1)); // SDNN == MATLAB SDRR

  let s = 0;
  let c = 0;
  for (let i = 1; i < n; i++) {
    const d = rr[i] - rr[i - 1];
    s += d * d;
    if (Math.abs(d) > 50) c++;
  }
  const rmssd = Math.sqrt(s / (n - 1));
  const pnn50 = (100 * c) / (n - 1);
  const bpm = 60000 / meanRR;

  return { meanRR, sdnn, rmssd, pnn50, bpm, n };
}
