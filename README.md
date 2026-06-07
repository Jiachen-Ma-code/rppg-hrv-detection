# rppg-hrv

Real-time, **browser-only** remote photoplethysmography (rPPG) → heart-rate variability (HRV).
Point your webcam at your face and get a live pulse waveform, heart rate, and HRV metrics —
**no install, no server, no data leaving your machine.**

> For research and education. **Not a medical device.**

---

## Quick start

No build step. No Node. Just a static server (needed because webcams require a
*secure context* — `https://` or `http://localhost`).

```bash
# from the repo root
python -m http.server 8000
```

Then open **http://localhost:8000** and click **Start**.

- First run downloads the MediaPipe face model from a CDN (~a few MB). If that
  fails, the app automatically falls back to a fixed center-of-frame ROI.
- Best results: even, diffuse lighting; hold reasonably still; give it ~10–20 s
  to fill the analysis window.

---

## How it works

```
webcam frame
  └─ FaceRoi      forehead + cheek patches (MediaPipe 478-pt landmarks)
       └─ skin filter (YCbCr) → mean R,G,B per frame
            └─ RingBuffer    sliding window of timestamped RGB (~30 s)
                 └─ rPPG      POS  or  CHROM            → raw pulse
                      └─ HR    bandpass+FFT  or  CWT     → clean pulse
                           └─ peaks → R-R intervals → HRV + coherence
```

Everything runs client-side in plain ES modules.

### rPPG methods (switchable)

- **POS** — *Plane-Orthogonal-to-Skin* (Wang et al., 2017). Projects normalized
  RGB onto a plane orthogonal to the skin-tone direction, overlap-added over a
  ~1.6 s window. Robust default.
- **CHROM** — *Chrominance* method (de Haan & Jeanne, 2013). Builds two
  chrominance signals and combines them as `S = Xf − α·Yf`.

### HR engines (switchable)

- **Bandpass + FFT** — detrend, FFT-domain rectangular band-pass (0.7–4 Hz),
  dominant-frequency pick. Fast and stable.
- **CWT** — analytic Morlet continuous wavelet transform (Torrence & Compo,
  1998), band-select the cardiac scales, inverse-transform to denoise.
  - **Single-scale reconstruction** (checkbox, **off by default**): reproduces
    the original project's behavior of reconstructing from only the single
    peak scale. This collapses the pulse toward one frequency and **artificially
    suppresses HRV** — useful for comparison, misleading for real variability.

### HRV metrics

Computed from R-R intervals (consecutive peak-to-peak times, in ms):

| Metric    | Meaning                                                    |
|-----------|------------------------------------------------------------|
| **HR**    | 60000 / mean(RR), beats per minute                         |
| **SDNN**  | std-dev of RR intervals (ddof=1) — overall variability     |
| **RMSSD** | root-mean-square of successive RR differences — vagal tone |
| **pNN50** | % of successive RR diffs > 50 ms                            |
| **Coherence** | HeartMath-style peak-band / total-band power (0.04–0.4 Hz) of the RR tachogram |

---

## Project structure

```
index.html              app shell
src/
  main.js               wiring: camera → ROI → buffer → pipeline → UI
  camera.js             getUserMedia
  faceRoi.js            MediaPipe landmarks + skin filter (CDN, graceful fallback)
  ringBuffer.js         sliding RGB window + fps estimate
  pipeline.js           analyze(window, {method, engine, singleScale})
  dsp/
    fft.js              radix-2 FFT, power spectrum, dominant frequency
    filters.js          mean/std/detrend, FFT band-pass, interp
    cwt.js              Morlet CWT / inverse CWT / denoise
  rppg/
    pos.js              POS
    chrom.js            CHROM
  hrv/
    peaks.js            peak detection
    metrics.js          RR intervals + SDNN/RMSSD/pNN50/HR
    coherence.js        cardiac coherence
  ui/
    plot.js             dependency-free canvas line plotter
    styles.css
tools/
  validate.py           NumPy reference mirror + numerical self-checks
```

## Validation

The algorithms are mirrored in NumPy and checked against synthetic signals with
a known heart rate, so the JS port can be trusted:

```bash
python tools/validate.py
```

Exit code 0 = all checks pass (band-pass selectivity, POS/CHROM recovery,
CWT denoise, peak count, HRV positivity, coherent-vs-random separation).

## Roadmap

- **Phase 1 (this repo):** browser-only real-time app. ✅
- **Phase 2:** a pip-installable `pyrppg` package (NumPy/SciPy/PyWavelets)
  mirroring the same algorithms, a CLI for offline video, and a small
  FastAPI/WebSocket server with a thin web demo client.

## References

- Wang, den Brinker, Stuijk, de Haan. *Algorithmic principles of remote PPG.* IEEE TBME, 2017.
- de Haan & Jeanne. *Robust pulse rate from chrominance-based rPPG.* IEEE TBME, 2013.
- Torrence & Compo. *A practical guide to wavelet analysis.* BAMS, 1998.

## License

MIT — see [LICENSE](LICENSE).
