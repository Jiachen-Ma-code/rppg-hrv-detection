// DSP/HRV analysis runs here, off the main thread, so the camera sampling loop
// never stalls — heavy CWT/FFT on the main thread would otherwise drag the frame
// rate down over time. The main thread posts { win, settings }; we post back the
// analyze() result (or an error marker).

import { analyze } from './pipeline.js';

self.onmessage = (e) => {
  const { win, settings } = e.data;
  let res;
  try {
    res = analyze(win, settings);
  } catch (err) {
    res = { ok: false, reason: 'error', message: String(err && err.message ? err.message : err) };
  }
  self.postMessage(res);
};
