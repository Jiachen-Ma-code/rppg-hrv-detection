# rppg-hrv-detection

**Non-invasive heart rate and heart-rate variability (HRV) from an ordinary webcam
-- real-time, in the browser, with no install and no server.**

![license](https://img.shields.io/badge/license-MIT-green)
![runs in](https://img.shields.io/badge/runs%20in-browser-blue)
![build](https://img.shields.io/badge/build-none-lightgrey)

> For research and education only. **Not a medical device.**

Point a webcam at your face and get a live pulse waveform, heart rate, and HRV
metrics. Everything runs client-side in plain ES modules -- **no data leaves your
machine.**

---

## Contents

- [The problem](#the-problem)
- [The method](#the-method)
- [Quick start](#quick-start)
- [Options](#options)
- [HRV metrics](#hrv-metrics)
- [Project structure](#project-structure)
- [Validation](#validation)
- [References](#references)
- [License](#license)

## The problem

The aim is **non-invasive, low-cost early health-risk sensing**: using an ordinary
camera -- not medical hardware -- to read physiological signals from a person's
face.

Each heartbeat pushes blood through the skin and changes its color by a tiny,
invisible amount. **Remote photoplethysmography (rPPG)** recovers that pulse from
ordinary facial video; from the pulse we estimate **heart rate (HR)** and
**heart-rate variability (HRV)** -- the beat-to-beat timing changes that reflect
cardiovascular and autonomic state and are among the earliest, lowest-cost windows
into health risk.

The hard part is doing this from **imperfect, low-cost data**. On a consumer webcam
the pulse-induced color change is far smaller than the noise from lighting, head
motion, and camera artifacts, and HRV in particular depends on accurate
beat-to-beat **timing** that the wrong processing easily washes out.

This repository is a self-contained, **browser-only demonstration** of that signal
chain end to end -- extract the pulse, then estimate HR and HRV, live from a webcam,
with no install, no server, and no data leaving the device.

## The method

The pipeline recovers a pulse from the facial color signal, then post-processes it
so that the beat-to-beat timing HRV depends on is preserved rather than smoothed
away.

```mermaid
flowchart LR
    subgraph Capture
        direction TB
        A["Face video (webcam)"] --> B["Face ROI + skin segmentation"]
        B --> C["Per-frame mean R, G, B"]
        C --> D["Amplitude-selective filtering"]
        D --> E["rPPG extraction: POS / CHROM"]
    end
    subgraph Postprocessing
        direction TB
        F["CWT + band selection: BP / MAX / SNR"] --> G["Inverse CWT: clean pulse"]
        G --> H["Peak detection: R-R intervals"]
        H --> I["HR and HRV: SDRR, RMSSD"]
    end
    E --> F
```

Stage by stage:

1. **Face ROI + skin segmentation.** Detect the face and track a region of interest
   across frames (classically Viola-Jones detection with KLT tracking; this browser
   demo uses MediaPipe face landmarks over forehead and cheek patches, falling back
   to a fixed center-of-frame ROI if the model cannot load). A YCbCr skin filter
   then keeps only skin pixels.
2. **Per-frame mean RGB.** Average R, G, and B over the ROI in each frame, giving
   three slowly varying color traces that carry the pulse.
3. **Amplitude-selective filtering (ASF).** Suppress noise whose amplitude falls in
   the pulse band (0.75-4 Hz), such as motion, before pulse extraction.
4. **rPPG extraction.** Turn the RGB traces into a raw pulse with a classic,
   training-free projection:
   - **POS** (Plane-Orthogonal-to-Skin, Wang et al. 2017): projects normalized RGB
     onto a plane orthogonal to the skin-tone direction. Robust default.
   - **CHROM** (de Haan & Jeanne 2013): combines two chrominance signals as
     `S = Xf - alpha * Yf`.
5. **CWT post-processing.** Take an analytic Morlet continuous wavelet transform
   (Torrence & Compo 1998) for a time-frequency scalogram, keep only the cardiac
   frequencies, and invert to denoise. The band is selected one of three ways, in
   increasing sophistication:
   - **CWT-BP:** keep a fixed band (0.75-4 Hz).
   - **CWT-MAX:** keep only the single frequency with the largest summed magnitude.
   - **CWT-SNR:** keep a *range* around the CWT-MAX frequency, widened or narrowed to
     maximize the signal-to-noise ratio -- this keeps the small frequency spread
     that HRV lives in, instead of collapsing the pulse to one tone.
6. **Peaks to R-R intervals.** Detect pulse peaks with a minimum-distance constraint
   and take consecutive peak-to-peak times as the inter-beat (R-R) intervals.
7. **HR and HRV.** HR = 60000 / mean(RR); HRV as **SDRR** (a.k.a. SDNN, the standard
   deviation of RR intervals) and **RMSSD** (root mean square of successive RR
   differences). The demo also shows pNN50 and a cardiac-coherence score (see
   [HRV metrics](#hrv-metrics)).

> **Why the band selection matters.** HRV *is* the small irregularity between
> beats. Collapsing the pulse to a single frequency gives a clean-looking waveform
> but flattens that irregularity and reports falsely low HRV; the SNR-adaptive band
> keeps just enough spread to preserve beat-to-beat timing.

> **About this demo.** The browser app runs this pipeline in real time with POS or
> CHROM and a bandpass-FFT or CWT engine. It exposes the core chain live; the
> amplitude-selective filtering and SNR-adaptive band selection (CWT-SNR) describe
> the full method the project is based on.

## Quick start

No build step and no Node -- just a static server (webcams require a *secure
context*: `https://` or `http://localhost`).

```bash
# from the repo root
python3 -m http.server 8000
```

Open **http://localhost:8000** and click **Start**.

- The first run downloads the MediaPipe face model from a CDN (a few MB). If that
  fails, the app falls back to a fixed center-of-frame ROI.
- Best results: even, diffuse lighting; hold reasonably still; give it 10-20 s to
  fill the analysis window.

## Options

Switchable at runtime in the UI:

- **rPPG method:** POS (default) or CHROM.
- **HR engine:** bandpass+FFT (default) or CWT.
- **CWT single-scale reconstruction (CWT-MAX):** off by default; reconstructs from
  one frequency only -- clean but HRV-suppressing (see the method above).

## HRV metrics

Computed from R-R intervals (consecutive peak-to-peak times, in ms):

| Metric | Meaning |
|---|---|
| **HR** | 60000 / mean(RR), beats per minute |
| **SDNN** | standard deviation of RR intervals -- overall variability |
| **RMSSD** | root mean square of successive RR differences -- short-term variability |
| **pNN50** | percentage of successive RR differences greater than 50 ms |
| **Coherence** | peak-band / total-band power (0.04-0.4 Hz) of the RR tachogram |

## Project structure

```
index.html              app shell
src/
  main.js               wiring: camera -> ROI -> buffer -> pipeline -> UI
  camera.js             getUserMedia
  faceRoi.js            MediaPipe landmarks + skin filter (CDN, graceful fallback)
  ringBuffer.js         sliding RGB window + fps estimate
  pipeline.js           analyze(window, {method, engine, singleScale})
  dsp/
    fft.js              radix-2 FFT, power spectrum, dominant frequency
    filters.js          mean/std/detrend, FFT band-pass, interpolation
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

The DSP core is mirrored in NumPy and checked against synthetic signals with a
known heart rate, so the JavaScript port can be trusted:

```bash
python3 tools/validate.py
```

Exit code 0 means all checks pass: band-pass selectivity, POS/CHROM recovery, CWT
denoise, peak count, HRV positivity, and coherent-vs-random separation.

## References

- Viola & Jones. *Rapid object detection using a boosted cascade of simple features.* IEEE CVPR, 2001. (face detection)
- Vezhnevets, Sazonov, Andreeva. *A survey on pixel-based skin color detection techniques.* Graphicon, 2003. (skin segmentation)
- Wang, den Brinker, Stuijk, de Haan. *Amplitude-selective filtering for remote PPG.* Biomed. Opt. Express, 2017. (ASF)
- Wang, den Brinker, Stuijk, de Haan. *Algorithmic principles of remote PPG.* IEEE TBME, 2017. (POS)
- de Haan & Jeanne. *Robust pulse rate from chrominance-based rPPG.* IEEE TBME, 2013. (CHROM)
- Torrence & Compo. *A practical guide to wavelet analysis.* BAMS, 1998. (CWT)

## License

MIT -- see [LICENSE](LICENSE). Copyright (c) 2026 Jiachen Ma.
