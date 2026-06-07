// Minimal radix-2 Cooley-Tukey FFT, in-place, no dependencies.
// Operates on separate real/imag Float64Array buffers whose length is a power of 2.

export function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error('FFT length must be a power of 2, got ' + n);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wpr = Math.cos(ang);
    const wpi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = wr * re[b] - wi * im[b];
        const ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr;        im[a] += ti;
        const nwr = wr * wpr - wi * wpi;
        wi = wr * wpi + wi * wpr;
        wr = nwr;
      }
    }
  }
}

export function ifft(re, im) {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  const inv = 1 / n;
  for (let i = 0; i < n; i++) {
    re[i] *= inv;
    im[i] = -im[i] * inv;
  }
}

// One-sided power spectrum of a real signal (Hann-windowed, zero-padded to pow2).
// Returns { freqs, power } of length N/2.
export function powerSpectrum(signal, fs) {
  const N0 = signal.length;
  const N = nextPow2(N0);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let m = 0;
  for (let i = 0; i < N0; i++) m += signal[i];
  m /= N0;
  const denom = N0 > 1 ? N0 - 1 : 1;
  for (let i = 0; i < N0; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / denom); // Hann
    re[i] = (signal[i] - m) * w;
  }
  fft(re, im);
  const half = N >> 1;
  const freqs = new Float64Array(half);
  const power = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    freqs[k] = k * fs / N;
    power[k] = re[k] * re[k] + im[k] * im[k];
  }
  return { freqs, power };
}

// Frequency (Hz) of the largest spectral peak within [f1, f2].
export function dominantFrequency(signal, fs, f1, f2) {
  const { freqs, power } = powerSpectrum(signal, fs);
  let best = -1;
  let bf = 0;
  for (let k = 0; k < freqs.length; k++) {
    if (freqs[k] >= f1 && freqs[k] <= f2 && power[k] > best) {
      best = power[k];
      bf = freqs[k];
    }
  }
  return bf;
}
