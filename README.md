# EarChords

**Get the chords from any song — right in your browser.** Upload a track (or play one into your mic), and EarChords runs a neural pitch‑detection model locally, recognises the chords, and builds a playable chord sheet with transpose, capo, tempo‑without‑pitch‑change, and guitar / piano / ukulele diagrams.

**Privacy‑first:** audio is decoded and analysed entirely on your device. Nothing is uploaded — there is no backend and no database. The build is a fully static site.

🔗 Live: [earchords.com](https://earchords.com)

## How it works

1. **Decode** any audio to 22050 Hz mono in an `OfflineAudioContext`.
2. **Detect notes** with [`@spotify/basic-pitch`](https://github.com/spotify/basic-pitch) (TensorFlow.js) — the model (~0.9 MB) lives in `public/model/` and is lazy‑loaded on first analysis.
3. **Recognise chords** with a custom pipeline: chroma vectors → cosine‑similarity template matching → key‑aware priors + bass‑root and extension evidence → **HMM/Viterbi** global decoding for the most likely chord sequence.
4. **Play along:** `<audio preservesPitch>` gives tempo change without pitch shift; `requestAnimationFrame` keeps the chord sheet, waveform, and spectrum in sync.

## Features

- Audio → chord sheet, 100% in the browser (audio never leaves the device)
- **Key detection** (Krumhansl‑Schmuckler) with sharp/flat spelling per key
- **Tempo estimation** (autocorrelation) and a numbered, bar‑based chord sheet
- Transpose · capo · slow down (50–100%) · follow‑scroll
- Guitar / piano / ukulele fingering diagrams, with click‑to‑cycle alternate voicings (barre chords included)
- **A–B section loop** (shift‑click two bars)
- Keyboard: `space` to play, `←/→` to step chords
- Export: copy as text, print‑friendly layout
- Light/dark themes, responsive

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static output in dist/
npm run preview    # preview the production build
npm test           # music-theory / recognition regression tests
```

## Deploy

`npm run build` produces a static `dist/` you can host anywhere (Cloudflare Pages / Vercel / Netlify / your own Nginx). No backend, no database. Make sure `dist/model/` (~0.9 MB) and `dist/demo.wav` ship with it, or first analysis and the demo button will fail.

The build also generates static, SEO‑friendly chord pages (`songgen/`) into clean URLs (e.g. `/wonderwall-chords`) plus `sitemap.xml` and `robots.txt`.

## Project layout

- `src/chords.js` — chord recognition core (chroma cosine matching + key priors + segmentation + Viterbi + transpose)
- `src/music.js` — key detection (K‑S), tempo estimation, sharp/flat spelling
- `src/audio.js` — decode to 22050 Hz mono + Basic Pitch inference (lazy‑loaded)
- `src/diagrams.js` — guitar/piano/ukulele diagrams (SVG; hand‑calibrated open chords + movable/barre fallback + alternate positions)
- `src/main.js` — UI orchestration: bar sheet, playback, transpose/capo/tempo/loop/export/theme
- `songgen/` — build‑time static SEO chord pages + sitemap assembly
- `validation/` — accuracy validation (synthetic fixtures, regression tests, MIREX‑style scoring)

## Accuracy & limitations

Accuracy is highest on synthetic audio and clean single‑instrument or singer‑songwriter recordings. Dense full‑mix pop is harder (a category‑wide problem) and may surface as `N.C.` or approximate chords. Automatic segmentation uses fine‑window recognition + HMM/Viterbi decoding + merging — it is not strict beat alignment. See `validation/BENCHMARKS.md` for benchmark results and the accuracy roadmap.
