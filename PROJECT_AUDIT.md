# Project Audit

Audit scope: current `main` workspace state on March 12, 2026.

This audit is based on a direct code review of the Astro app, track runtime, data loaders, UI shell, and supporting docs. It is not a design critique; it focuses on maintainability, correctness, developer workflow, and operational risk.

## Current Status

- `npm run build`: passes
- `npx tsc --noEmit`: fails
- Automated tests: none
- Linting / formatting scripts: none

## What Is Working Well

- The project has a clear core concept: public environmental and infrastructural data translated into a multi-track audio score.
- The newer track system has a coherent architecture:
  - `track-state.ts` defines shared schema.
  - `track-datasource.ts` translates external records into `SynthesisFrame`.
  - `track-engine.ts` handles audio routing.
  - `track-visualizer.ts` renders the same runtime state the audio engine uses.
- The `live -> snapshot fallback` strategy is a strong operational choice for installations and unstable networks.
- The UI is bilingual and now includes in-app system and API documentation, which materially improves explainability for non-developers.

## Findings

### 1. TypeScript is not actually green

Severity: high

`npx tsc --noEmit` fails because [`track-presets.ts`](src/scripts/track-presets.ts) imports `ApiPreset` from [`track-state.ts`](src/scripts/track-state.ts), but that type no longer exists.

Why this matters:

- The repo currently looks healthy if you only run `astro build`.
- Any future attempt to add CI type-checking will fail immediately.
- This is a sign that legacy code is still present after the track-system rewrite.

Suggested action:

- Remove `track-presets.ts` if it is obsolete.
- If it is meant to stay, restore the missing type and reconnect it to the current architecture.
- Add a dedicated `typecheck` script and run it in CI.

### 2. Legacy code is still in the repo and increases maintenance risk

Severity: high

There is a split between the current track system and an older earthquake/audio stack that is no longer part of the live UI:

- [`audio.ts`](src/scripts/audio.ts)
- [`visualizer.ts`](src/scripts/visualizer.ts)
- [`QuakeList.astro`](src/components/QuakeList.astro)
- [`Visualizer.astro`](src/components/Visualizer.astro)
- [`track-presets.ts`](src/scripts/track-presets.ts)
- unused state fields in [`state.ts`](src/scripts/state.ts)
- unused markdown docs in `src/content/docs/`

Why this matters:

- New contributors will spend time reading paths that do not affect the current app.
- Dead code already caused the typecheck failure above.
- The older code and the current track engine use different mental models, which makes the project harder to explain.

Suggested action:

- Archive or delete the legacy path.
- If you want to preserve it historically, move it under `src/legacy/` with a note that it is not shipped.
- Remove unused docs files now that the overlays are Astro components.

### 3. Track transport button loses its icon after state changes

Severity: medium

In [`track-ui.ts`](src/scripts/track-ui.ts), the play button is initially rendered with inline SVG icon markup. But the same file later updates the same button with `button.textContent = ...`, which strips the icon.

Why this matters:

- The control regresses after the first play/stop interaction.
- It creates an inconsistent UI state and makes the transport controls harder to scan.

Suggested action:

- Update the button with `innerHTML` using the existing icon constants, or keep separate child nodes for icon and label.

### 4. Overlay panels are visually improved but still weak on accessibility

Severity: medium

The overlay logic in [`overlay-panels.ts`](src/scripts/overlay-panels.ts) only toggles classes and `aria-hidden`.

What is missing:

- no focus trap
- no initial focus placement on open
- no focus restore to the triggering button on close
- no `inert` handling for background content

Why this matters:

- Keyboard users can tab behind the overlay.
- Screen-reader navigation is not fully controlled.
- This is especially noticeable now that the notes panels are full-screen reading surfaces.

Suggested action:

- Add a small dialog controller that:
  - stores the opener element
  - focuses the close button or heading on open
  - traps tab order inside the active panel
  - restores focus on close
  - marks the main app as inert while a panel is open

### 5. Source logic and visualizer logic are becoming monoliths

Severity: medium

File sizes:

- [`track-datasource.ts`](src/scripts/track-datasource.ts): 2146 lines
- [`track-visualizer.ts`](src/scripts/track-visualizer.ts): 1221 lines

Why this matters:

- Every new source adds loader logic, normalization, mapping, snapshot behavior, and visual rendering in very large files.
- Review cost will keep rising as more sources are added.
- It becomes harder to test or swap one source without touching unrelated behavior.

Suggested action:

- Split by concern and by source.
- Example structure:
  - `src/scripts/sources/registry.ts`
  - `src/scripts/sources/earthquakes.ts`
  - `src/scripts/sources/aqi.ts`
  - `src/scripts/sources/weather.ts`
  - `src/scripts/sources/cosmic.ts`
  - `src/scripts/visualizers/earthquakes.ts`
  - `src/scripts/visualizers/aqi.ts`
  - `src/scripts/visualizers/shared.ts`

### 6. External data access is operationally fragile

Severity: medium

The project currently depends on several brittle access paths:

- hardcoded MOENV API key in [`track-datasource.ts`](src/scripts/track-datasource.ts)
- `WAQI demo token` in [`track-datasource.ts`](src/scripts/track-datasource.ts)
- `NASA DEMO_KEY` in [`track-datasource.ts`](src/scripts/track-datasource.ts)
- `AllOrigins` proxy for Taipei data in [`track-datasource.ts`](src/scripts/track-datasource.ts)
- `r.jina.ai` proxy for Exoplanets in [`track-datasource.ts`](src/scripts/track-datasource.ts)

Why this matters:

- Demo credentials are rate-limited and not intended for production.
- Proxy services may change behavior or disappear.
- A gallery or installation deployment will have unpredictable failure modes if these dependencies are not controlled.

Suggested action:

- Move API credentials and source toggles into environment variables.
- Consider adding a server-side proxy layer or Astro endpoints for the sources that currently rely on third-party browser proxies.
- Create a source health matrix in docs so failures are expected rather than surprising.

### 7. One source label is semantically misleading

Severity: low

The UI and docs refer to a Taiwan earthquake stream as `CWA`, but the loader currently uses a USGS FDSN query filtered to Taiwan bounds in [`track-datasource.ts`](src/scripts/track-datasource.ts).

Why this matters:

- The source is still valid, but the label implies an origin that is not true.
- This weakens trust in the documentation and the curatorial framing.

Suggested action:

- Rename it to something like `Taiwan Regional Quakes / USGS window`.
- If a true CWA source is desired, integrate one explicitly.

### 8. The developer workflow is too thin for the complexity of the project

Severity: low

[`package.json`](package.json) only exposes `dev`, `build`, and `preview`.

Why this matters:

- A project with this many external sources and this much stateful UI should have at least basic validation tooling.
- Right now there is no single command for type safety, linting, or smoke tests.

Suggested action:

- Add:
  - `typecheck`
  - `lint`
  - `test`
- Even one Playwright smoke test that loads the page, adds a track, and opens/closes overlays would reduce regression risk a lot.

## Architectural Suggestions

### 1. Make each source a first-class module

Create a standard `SourceDefinition` contract:

- `id`
- `label`
- `loader`
- `snapshot`
- `mapToFrame`
- `describe`
- `renderFigure`

That would reduce duplication between docs, UI labels, loaders, and mappings.

### 2. Separate "data translation" from "sound synthesis"

Right now `track-datasource.ts` still owns both external loading and much of the synthesis-frame construction. A cleaner split would be:

- source adapters return normalized domain data
- a sonification layer maps that to `SynthesisFrame`
- the engine only renders sound

That makes it easier to compare different sonification strategies for the same dataset.

### 3. Unify state boundaries

The project currently has:

- `state.ts` for global quake data and legacy flags
- `track-state.ts` for current track runtime/state

This is manageable now, but conceptually messy. A single app-state boundary would be easier to reason about.

### 4. Treat docs as generated from source metadata

The new API atlas is much stronger than the old markdown, but the copy is still handwritten. Long term, the best version is:

- source metadata in code
- docs panels reading from the same registry
- README linking to that registry

That reduces drift between what the UI says and what the code actually fetches.

## Suggested Priority Order

### Immediate

1. Remove or repair stale legacy files so `npx tsc --noEmit` passes.
2. Fix the track play/stop button icon regression.
3. Rename the misleading Taiwan quake source label.
4. Add `README.md` and keep this audit in the repo.

### Short Term

1. Split `track-datasource.ts` and `track-visualizer.ts` into smaller modules.
2. Add `typecheck`, linting, and one browser smoke test.
3. Move external credentials and source toggles into environment variables.
4. Add a real accessible dialog controller for overlays.

### Medium Term

1. Move proxy-sensitive sources behind server endpoints.
2. Create a shared source registry for UI labels, docs, loading, and mappings.
3. Add track preset import/export or URL-state serialization for reproducible setups.

## Bottom Line

The project is conceptually strong and the current interactive layer is already compelling. The main risk is not the art direction or the UI anymore; it is repo coherence. The next quality jump comes from removing legacy code, making type safety real, and modularizing the source/visualizer system before it grows further.
