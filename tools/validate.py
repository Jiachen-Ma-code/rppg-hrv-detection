"""
Numeric validation of the rppg-hrv DSP core.

This script re-implements the JavaScript algorithms (src/dsp, src/rppg, src/hrv)
in NumPy using the *same formulas*, then checks them on synthetic signals with a
known heart rate. It de-risks the JS port: if the math is right here, the JS
(a faithful line-by-line port) is right too.

Run:  python tools/validate.py
"""
import numpy as np

# ----------------------------------------------------------------------------
# dsp/filters.js + dsp/fft.js
# ----------------------------------------------------------------------------

def bandpass(signal, f1, f2, fs):
    signal = np.asarray(signal, float)
    N0 = signal.size
    N = 1 << (N0 - 1).bit_length()
    x = np.zeros(N)
    x[:N0] = signal - signal.mean()
    X = np.fft.fft(x)
    freqs = np.fft.fftfreq(N, d=1.0 / fs)
    mask = (np.abs(freqs) >= f1) & (np.abs(freqs) <= f2)
    X[~mask] = 0
    return np.real(np.fft.ifft(X))[:N0]

def dominant_frequency(signal, fs, f1, f2):
    signal = np.asarray(signal, float)
    N0 = signal.size
    N = 1 << (N0 - 1).bit_length()
    w = np.hanning(N0)
    x = np.zeros(N)
    x[:N0] = (signal - signal.mean()) * w
    P = np.abs(np.fft.rfft(x)) ** 2
    freqs = np.fft.rfftfreq(N, d=1.0 / fs)
    band = (freqs >= f1) & (freqs <= f2)
    if not band.any():
        return 0.0
    idx = np.where(band)[0]
    return float(freqs[idx[np.argmax(P[idx])]])

def std1(a):
    a = np.asarray(a, float)
    return a.std(ddof=1) if a.size > 1 else 0.0

# ----------------------------------------------------------------------------
# rppg/chrom.js + rppg/pos.js
# ----------------------------------------------------------------------------

def chrom(R, G, B, fs, f1=0.7, f2=4.0):
    R, G, B = map(lambda a: np.asarray(a, float), (R, G, B))
    rn, gn, bn = R / R.mean(), G / G.mean(), B / B.mean()
    Xs = 3 * rn - 2 * gn
    Ys = 1.5 * rn + gn - 1.5 * bn
    Xf, Yf = bandpass(Xs, f1, f2, fs), bandpass(Ys, f1, f2, fs)
    a = std1(Xf) / (std1(Yf) or 1e-9)
    return Xf - a * Yf

def pos(R, G, B, fs, window_sec=1.6):
    R, G, B = map(lambda a: np.asarray(a, float), (R, G, B))
    n = R.size
    L = max(2, round(window_sec * fs))
    H = np.zeros(n)
    for t in range(0, n - L + 1):
        mr = R[t:t + L].mean() or 1e-9
        mg = G[t:t + L].mean() or 1e-9
        mb = B[t:t + L].mean() or 1e-9
        rn, gn, bn = R[t:t + L] / mr, G[t:t + L] / mg, B[t:t + L] / mb
        s1 = gn - bn
        s2 = -2 * rn + gn + bn
        alpha = std1(s1) / (std1(s2) or 1e-9)
        h = s1 + alpha * s2
        H[t:t + L] += h - h.mean()
    return H

# ----------------------------------------------------------------------------
# dsp/cwt.js
# ----------------------------------------------------------------------------

OMEGA0 = 6.0
PI_M14 = np.pi ** -0.25
CDELTA = 0.776
PSI0_0 = PI_M14

def _period_factor(w0):
    return (4 * np.pi) / (w0 + np.sqrt(2 + w0 * w0))

def scale_to_freq(s, w0=OMEGA0):
    return 1.0 / (_period_factor(w0) * s)

def cwt_morlet(signal, dt, dj=0.125):
    signal = np.asarray(signal, float)
    N0 = signal.size
    N = 1 << (N0 - 1).bit_length()
    x = np.zeros(N)
    x[:N0] = signal - signal.mean()
    X = np.fft.fft(x)
    k = np.arange(N)
    omega = np.where(k <= N / 2, k, k - N) * (2 * np.pi / (N * dt))
    s0 = 2 * dt
    J = max(1, int(np.floor(np.log2((N0 * dt) / s0) / dj)))
    scales = s0 * 2.0 ** (np.arange(J + 1) * dj)
    freqs = scale_to_freq(scales)
    W = np.zeros((scales.size, N), complex)
    for j, s in enumerate(scales):
        norm = np.sqrt(2 * np.pi * s / dt) * PI_M14
        psi = np.where(omega > 0, norm * np.exp(-0.5 * (s * omega - OMEGA0) ** 2), 0.0)
        W[j] = np.fft.ifft(X * psi)
    return W, scales, freqs, N0

def icwt_morlet(W, scales, dt, dj, N0):
    factor = (dj * np.sqrt(dt)) / (CDELTA * PSI0_0)
    return factor * np.sum(np.real(W[:, :N0]) / np.sqrt(scales)[:, None], axis=0)

def cwt_denoise(signal, fs, f1=0.75, f2=4.0, single_scale=False, dj=0.125):
    signal = np.asarray(signal, float)
    dt = 1.0 / fs
    W, scales, freqs, N0 = cwt_morlet(signal, dt, dj)
    inband = (freqs >= f1) & (freqs <= f2)
    W[~inband] = 0
    if single_scale:
        energy = np.sum(np.abs(W), axis=1)
        bj = int(np.argmax(energy))
        keep = np.zeros(scales.size, bool)
        keep[bj] = True
        W[~keep] = 0
    rec = icwt_morlet(W, scales, dt, dj, N0)
    vr = rec.var(ddof=1)
    if vr > 0:
        rec *= np.sqrt(signal.var(ddof=1) / vr)
    return rec

# ----------------------------------------------------------------------------
# hrv/peaks.js + hrv/metrics.js + hrv/coherence.js
# ----------------------------------------------------------------------------

def find_peaks(x, fs, min_bpm=40, max_bpm=200, prominence=0.3):
    x = np.asarray(x, float)
    n = x.size
    if n < 3:
        return []
    min_dist = max(1, round(fs * 60 / max_bpm))
    thr = x.mean() + prominence * (x.max() - x.mean())
    peaks = []
    for i in range(1, n - 1):
        if x[i] >= x[i - 1] and x[i] > x[i + 1] and x[i] >= thr:
            if not peaks:
                peaks.append(i)
            elif i - peaks[-1] < min_dist:
                if x[i] > x[peaks[-1]]:
                    peaks[-1] = i
            else:
                peaks.append(i)
    return peaks

def hrv_metrics(peak_times):
    rr = 1000 * np.diff(peak_times)
    n = rr.size
    if n < 2:
        return dict(meanRR=np.nan, sdnn=np.nan, rmssd=np.nan, pnn50=np.nan, bpm=np.nan, n=n)
    d = np.diff(rr)
    return dict(
        meanRR=rr.mean(),
        sdnn=rr.std(ddof=1),
        rmssd=np.sqrt(np.mean(d ** 2)),
        pnn50=100 * np.sum(np.abs(d) > 50) / d.size,
        bpm=60000 / rr.mean(),
        n=n,
    )

def coherence(rr_ms, band_low=0.04, band_high=0.4, peak_half=0.03, fs_resample=4.0):
    rr = np.asarray(rr_ms, float) / 1000.0
    if rr.size < 4:
        return np.nan
    rr_time = np.cumsum(rr)
    tq = np.arange(0, rr_time[-1], 1.0 / fs_resample)
    sig = np.interp(tq, rr_time, rr)
    N = sig.size
    Np = 1 << (N - 1).bit_length()
    w = np.hamming(N)
    x = np.zeros(Np)
    x[:N] = (sig - sig.mean()) * w
    P = np.abs(np.fft.rfft(x)) ** 2
    F = np.fft.rfftfreq(Np, d=1.0 / fs_resample)
    band = (F > band_low) & (F < band_high)
    if not band.any():
        return np.nan
    Fb, Pb = F[band], P[band]
    pf = Fb[np.argmax(Pb)]
    peak_band = Pb[(Fb > pf - peak_half) & (Fb < pf + peak_half)].sum()
    return float(peak_band / Pb.sum())

# ----------------------------------------------------------------------------
# Synthetic data + tests
# ----------------------------------------------------------------------------

def make_synthetic(fs=30, dur=20, hr_hz=1.2, mod_hz=0.1, seed=0):
    rng = np.random.default_rng(seed)
    n = int(fs * dur)
    t = np.arange(n) / fs
    inst_f = hr_hz + 0.06 * np.sin(2 * np.pi * mod_hz * t)  # HRV + coherence peak
    phase = 2 * np.pi * np.cumsum(inst_f) / fs
    pulse = np.sin(phase) + 0.3 * np.sin(2 * phase)         # add a harmonic
    drift = 3 * np.sin(2 * np.pi * 0.05 * t)
    def chan(dc, gain):
        return dc + gain * pulse + drift + rng.normal(0, 0.4, n)
    R = chan(180, 1.5)
    G = chan(160, 3.0)   # green carries the strongest plethysmographic signal
    B = chan(140, 0.6)
    return t, R, G, B, pulse, hr_hz

def corr(a, b):
    a = np.asarray(a, float); b = np.asarray(b, float)
    a = a - a.mean(); b = b - b.mean()
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))

def main():
    fs, dur, hr = 30, 20, 1.2
    t, R, G, B, clean, hr_hz = make_synthetic(fs, dur, hr)
    expected_bpm = hr * 60
    results = []

    def check(name, ok, detail):
        results.append(ok)
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}")

    print("1) FFT band-pass selectivity")
    fs2 = 100
    tt = np.arange(fs2 * 10) / fs2
    mix = np.sin(2 * np.pi * 0.2 * tt) + np.sin(2 * np.pi * 1.2 * tt) + np.sin(2 * np.pi * 6 * tt)
    bp = bandpass(mix, 0.7, 4.0, fs2)
    check("passes 1.2 Hz, rejects 0.2/6 Hz", abs(dominant_frequency(bp, fs2, 0.1, 10) - 1.2) < 0.1,
          f"dominant={dominant_frequency(bp, fs2, 0.1, 10):.3f} Hz")

    print("2) CHROM recovers heart rate")
    s_chrom = chrom(R, G, B, fs)
    bpm_chrom = 60 * dominant_frequency(s_chrom, fs, 0.7, 4.0)
    check("CHROM BPM ~ 72", abs(bpm_chrom - expected_bpm) < 5, f"{bpm_chrom:.1f} bpm")
    check("CHROM correlates with clean pulse", abs(corr(s_chrom, clean)) > 0.5, f"r={corr(s_chrom, clean):.2f}")

    print("3) POS recovers heart rate")
    s_pos = pos(R, G, B, fs)
    bpm_pos = 60 * dominant_frequency(s_pos, fs, 0.7, 4.0)
    check("POS BPM ~ 72", abs(bpm_pos - expected_bpm) < 5, f"{bpm_pos:.1f} bpm")
    check("POS correlates with clean pulse", abs(corr(s_pos, clean)) > 0.5, f"r={corr(s_pos, clean):.2f}")

    print("4) CWT denoise")
    den = cwt_denoise(s_pos, fs, 0.75, 4.0, single_scale=False)
    bpm_cwt = 60 * dominant_frequency(den, fs, 0.7, 4.0)
    check("CWT-denoised BPM ~ 72", abs(bpm_cwt - expected_bpm) < 5, f"{bpm_cwt:.1f} bpm")
    check("CWT reconstruction correlates with POS", abs(corr(den, s_pos)) > 0.6, f"r={corr(den, s_pos):.2f}")
    den1 = cwt_denoise(s_pos, fs, 0.75, 4.0, single_scale=True)
    bpm_cwt1 = 60 * dominant_frequency(den1, fs, 0.7, 4.0)
    check("CWT single-scale BPM ~ 72", abs(bpm_cwt1 - expected_bpm) < 5, f"{bpm_cwt1:.1f} bpm")

    print("5) Peak detection + HRV metrics")
    pk = find_peaks(den, fs)
    pts = np.array(pk) / fs
    m = hrv_metrics(pts)
    check("beat count plausible (~24 in 20s @72bpm)", 18 <= m["n"] + 1 <= 30, f"{m['n']+1} beats")
    check("HRV BPM ~ 72", abs(m["bpm"] - expected_bpm) < 6, f"{m['bpm']:.1f} bpm")
    check("SDNN/RMSSD finite & positive", np.isfinite(m["sdnn"]) and m["sdnn"] > 0, f"SDNN={m['sdnn']:.1f} ms, RMSSD={m['rmssd']:.1f} ms")

    print("6) Coherence: coherent vs random RR")
    # coherent: RR modulated by a single 0.1 Hz oscillation
    n_beats = 80
    rr_coherent = 1000 * (0.83 + 0.05 * np.sin(2 * np.pi * 0.1 * np.arange(n_beats) * 0.83))
    rng = np.random.default_rng(1)
    rr_random = 1000 * (0.83 + 0.05 * rng.standard_normal(n_beats))
    c_coh = coherence(rr_coherent)
    c_rnd = coherence(rr_random)
    check("coherent RR -> high coherence", c_coh > 0.4, f"coherent={c_coh:.2f}")
    check("coherent > random", c_coh > c_rnd, f"coherent={c_coh:.2f} vs random={c_rnd:.2f}")

    print("\n" + ("ALL PASSED" if all(results) else f"{results.count(False)} CHECK(S) FAILED"))
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
