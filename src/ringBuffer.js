// Sliding-window buffer of timestamped mean-RGB samples.
// Timestamps are in milliseconds; the sampling rate is estimated from them.

export class RingBuffer {
  constructor(maxSamples = 900) {
    this.max = maxSamples;
    this.t = [];
    this.r = [];
    this.g = [];
    this.b = [];
  }

  push(tMs, r, g, b) {
    this.t.push(tMs);
    this.r.push(r);
    this.g.push(g);
    this.b.push(b);
    if (this.t.length > this.max) {
      this.t.shift();
      this.r.shift();
      this.g.shift();
      this.b.shift();
    }
  }

  clear() {
    this.t.length = 0;
    this.r.length = 0;
    this.g.length = 0;
    this.b.length = 0;
  }

  size() {
    return this.t.length;
  }

  // Estimated frames-per-second from timestamp span.
  fps() {
    const n = this.t.length;
    if (n < 2) return 0;
    const durSec = (this.t[n - 1] - this.t[0]) / 1000;
    return durSec > 0 ? (n - 1) / durSec : 0;
  }

  durationSec() {
    const n = this.t.length;
    return n < 2 ? 0 : (this.t[n - 1] - this.t[0]) / 1000;
  }

  window() {
    return {
      R: this.r.slice(),
      G: this.g.slice(),
      B: this.b.slice(),
      fs: this.fps(),
    };
  }
}
