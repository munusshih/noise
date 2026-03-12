# NOISE

`NOISE` is a browser-based, multi-track data sonification instrument.

It turns public data streams into sound and spatial routing, so earthquakes, weather, air quality, urban infrastructure, and cosmic archives can be played as parallel tracks inside one interface.

The UI is bilingual: Chinese + English.

## What It Does

- Creates multiple independent sound tracks from public datasets
- Maps each dataset into a full synthesis event, not just pitch
- Supports `live` and `snapshot` playback modes
- Routes each track to a selected output channel
- Visualizes:
  - incoming data behavior
  - synthesis parameter history
  - actual waveform output
- Includes in-app reference panels for:
  - output / channel routing
  - system architecture
  - API ecology atlas

## Stack

- [Astro](https://astro.build/)
- TypeScript
- Web Audio API
- Canvas 2D rendering

## Requirements

- Node.js 18+ recommended
- npm
- A modern browser with Web Audio support

For multi-speaker routing, use a system audio device that exposes more than 2 output channels. On macOS this often means an `Aggregate Device` created in `Audio MIDI Setup`.

## Quick Start

Install dependencies:

```bash
npm install
```

Run the dev server:

```bash
npm run dev
```

Build the site:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## How To Use

### 1. Create a track

- Click `新增軌道 / Add Track`
- Each track is an independent source + synth + output route

### 2. Choose a data source

Each track can use one of the built-in sources, including:

- Global earthquakes
- Taiwan regional earthquakes
- NTU campus buildings
- Taipei noise stations
- Taipei rain
- Taiwan AQI
- WAQI Asia
- Open-Meteo
- GDELT timeline
- NASA DONKI
- NASA APOD
- NASA Exoplanets

### 3. Choose playback mode

- `即時 / Live`
  - fetches remote data
  - falls back to snapshot data if the source fails or returns nothing
- `快照 / Snapshot`
  - plays stored / local fallback data directly

### 4. Choose sound behavior

- `連續 / Continuous`
  - keeps one persistent voice and morphs it over time
- `步進 / Step`
  - treats each record as a discrete event

### 5. Set the output channel

- Use `輸出 / Output` in each track
- The browser only knows available output channels, not speaker names
- If the app shows `2 ch`, your system output is still stereo

### 6. Open the notes panels

Top-right controls open full-screen overlays for:

- `輸出 FAQ / Output`
- `系統圖譜 / System`
- `API 地圖 / API`

These panels explain routing, architecture, and the ecological logic behind the datasets.

## Multi-Channel Audio Notes

This project uses `discrete channel routing`, not speaker-name detection.

The key path is:

```txt
source
  -> GainNode
  -> AnalyserNode
  -> ChannelMergerNode[input = outputChannel]
  -> destination
```

The app reads `destination.maxChannelCount` after the `AudioContext` is created, then routes each track to a selected channel.

## Project Structure

```txt
src/
  components/
    AppHeader.astro
    TrackBoard.astro
    ChannelHelpPanel.astro
    ArchitecturePanel.astro
    ApiNoisePanel.astro
    SourceFigure.astro
  layouts/
    BaseLayout.astro
  pages/
    index.astro
  scripts/
    main.ts
    track-state.ts
    track-ui.ts
    track-engine.ts
    track-datasource.ts
    track-visualizer.ts
    overlay-panels.ts
    quakes.ts
    state.ts
  styles/
    global.css
```

## Key Runtime Files

- [`src/scripts/track-state.ts`](src/scripts/track-state.ts)
  - shared types and track creation
- [`src/scripts/track-ui.ts`](src/scripts/track-ui.ts)
  - DOM rendering and interaction wiring
- [`src/scripts/track-engine.ts`](src/scripts/track-engine.ts)
  - audio context and multi-channel routing
- [`src/scripts/track-datasource.ts`](src/scripts/track-datasource.ts)
  - API loading, fallback, caching, and synthesis-frame translation
- [`src/scripts/track-visualizer.ts`](src/scripts/track-visualizer.ts)
  - per-track visualization

## Data Behavior

Every external record is translated into a `SynthesisFrame` containing:

- `amplitude`
- `frequency`
- `phase`
- `offset`
- `duration`
- `envelopeAttack`
- `envelopeRelease`
- `modulationRate`
- `modulationDepth`

This means a dataset is not mapped to one note only. It becomes a full time-based sound gesture.

## Snapshot Strategy

The project keeps a local snapshot store so the piece can continue to sound even if a live source fails.

- live data is cached
- valid live data can be saved into `localStorage`
- sources can fall back to snapshot mode automatically

This is useful for installations, demos, and unstable network environments.

## Known Operational Constraints

- Browser audio usually requires a user gesture before playback
- Multi-channel output depends on the OS audio device configuration
- Some sources currently rely on public demo credentials or browser-side proxies
- The repository audit and suggestions are documented in [`PROJECT_AUDIT.md`](PROJECT_AUDIT.md)

## Development Notes

- The current validation command is:

```bash
npm run build
```

- There is currently no dedicated test suite or lint script.
- If you are extending the project, start with:
  - adding a new source in `track-state.ts`
  - implementing the loader/mapping in `track-datasource.ts`
  - adding visual logic in `track-visualizer.ts`
  - documenting the source in the in-app API atlas

## Recommended Next Steps

- add `typecheck`, linting, and browser smoke tests
- modularize source adapters and visualizers by domain
- move proxy-sensitive data access behind server-side endpoints
- clean out legacy files that are no longer part of the current track system
