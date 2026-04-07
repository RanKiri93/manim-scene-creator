# Manim Timeline

A **desktop-oriented web application** for authoring **Manim** scenes with a **non-linear timeline** (playhead, draggable clips, layers), a **2D frame preview** (Konva, 16:9 Manim camera), and optional integration with a local **measure / audio** Python server. The app targets **Hebrew + math** workflows via `HebrewMathLine`-style LaTeX and shared Python tooling in the parent repository.

This document is the **canonical** reference for the `manim-timeline/` package. The repository root may contain a shorter `README.md` that points here.

---

## Table of contents

1. [What the application does](#what-the-application-does)
2. [Global audio timeline (narration)](#global-audio-timeline-narration)
3. [Export to Python (Manim)](#export-to-python-manim)
4. [Compound clips](#compound-clips-chain-calculations)
5. [Project file format](#project-file-format)
   - [Portable bundle (`.mtproj`)](#portable-bundle-mtproj)
6. [Tech stack](#tech-stack)
7. [Source layout (`src/`)](#source-layout-src)
8. [Architecture notes](#architecture-notes)
9. [Running locally](#running-locally)
10. [Tauri desktop (optional)](#tauri-desktop-optional)
11. [Relationship to the rest of the repository](#relationship-to-the-rest-of-the-repository)
12. [Roadmap and known gaps](#roadmap-and-known-gaps)
13. [Troubleshooting](#troubleshooting)

---

## What the application does

### Scene items

You build a scene from **items** stored in a Zustand map. Each top-level item can be:

| Kind | Purpose |
|------|---------|
| **Text line** | LaTeX source with `||` segment splits; rendered in Manim as `HebrewMathLine` (or equivalent export). Supports per-segment color, bold, italic; measurement fills bbox and optional PNG preview. |
| **Axes** | Coordinate system only; plots, dots, fields, and series viz are **separate clips** referencing `axesId`. |
| **Graph overlays** | `graphPlot`, `graphDot`, `graphField`, `graphSeriesViz` — timed like other clips, anchored to an axes item. |
| **Compound** | A single timeline clip that **groups several text lines** with **local** timing inside the compound (see [Compound clips](#compound-clips-chain-calculations)). |
| **Exit animation** | A **separate timeline clip** (`exit_animation`) that targets another animatable item by `targetId`. It runs `FadeOut` / `Uncreate` / `ShrinkToCenter` (or `none`) at its own `startTime` for `duration` seconds. The exit must start at or after the target’s **hold end** (`effectiveStart + run duration`, including compound-local duration for child lines). Adding an object does not create an exit; add exits from **+ Object → Exit animation** when needed. |

**Time** — Each timed item has `startTime`, `duration`, and `layer`. Items inside a compound use `localStart` / `localDuration` (and `parentId`); the store keeps the compound’s `duration` in sync with its children. Pauses after a clip’s main run are expressed by **spacing clips on the timeline** (there is no per-item `waitAfter`).

**Space** — `x`, `y`, `scale`, plus an ordered list **`posSteps`**: absolute `move_to`, `next_to` (another line or axes), `to_edge`, `shift`, `set_x`, `set_y`. Compounds and exit clips do not occupy the canvas; only drawable leaves do.

**Clip naming** — Each item can have a **`label`** (“Clip name” in editors). It appears in the item list, timeline bar (with sensible fallbacks when empty), the **exit-animation target** menu, and **Positioning steps** reference pickers. Graph dots also have an on-canvas label on the dot object, separate from the clip name.

**Text line animations**

- **Entry** — `animStyle`: `write` (default), `fade_in`, or `transform`. **Transform** uses a **segment mapping** from an **earlier** line (`TransformMapping` + **Segment mapper** UI): paired indices, unmapped source/target behavior (`fade_out` / `leave`, `fade_in` / `write`).

**Exit animations**

- Configured only on **`exit_animation`** items: `animStyle`, `duration` (run time), `targetId`, and timeline `startTime`. Deleting a target removes dependent exit clips. Export interleaves exit `self.play(...)` at the scheduled global time (see `manimExporter.ts`).

**Graph animations**

- Playback is expressed with `Create` / `FadeIn` / `Write` as appropriate; **exits** for axes and overlays use the same Manim ops, emitted from **exit_animation** clips that target the corresponding item.

### Timeline

- **Top-level** items appear as **clips** on layer tracks. Child lines of a compound **do not** get their own top-level bars; they are edited via the compound row (expand/collapse in the item list).
- **Playhead** — Scrub, **Play / Pause**; optional view range zoom.
- **CRUD** — New lines, axes, graph overlays, compounds, and **exit animations** can be created **at the current playhead** (exit clips snap so `startTime` is not before the target’s hold end).
- **Audio row** — Separate track(s) for **`audioItems`**: clips from **TTS** or **microphone upload** (via the measure server). Scene **duration** extends to the end of the last audio clip if it finishes after visual items.

### Canvas (Konva)

- Frame size matches Manim defaults (**`FRAME_W` × `FRAME_H`** in `src/lib/constants.ts`).
- Only items that should appear on the frame at the current time are drawn using **`effectiveStart` / `effectiveEnd`** in `src/lib/time.ts`: visible from the item’s global start until the end of an **`exit_animation`** that targets it, or **indefinitely** if no such exit exists. Graph grouping uses the same helpers in `src/lib/graphPreview.ts`.
- **Draggable** when all `posSteps` are **absolute**; otherwise the resolved position is shown with a **locked** (amber) treatment and you edit steps in **Positioning steps**.
- **Compound horizontal centering** — When enabled on the compound, child lines receive a shared horizontal shift so the **union** of their measured boxes is centered at **x = 0** (preview aligns with export when measure data exists).

### Measure server

Optional HTTP backend (**`measure_server.py`** at repo root): **POST `/measure`** for geometry, ink metrics, RTL offsets, optional preview PNG, and styled segments. Same server exposes:

- **`POST /api/generate_audio`** — TTS + Whisper **word boundaries** (used when adding an audio clip from the Audio panel).
- **`POST /api/upload_audio`** — Mic / file upload, transcription, stored paths under `assets/audio/` for playback in the app.
- **`POST /api/render`** — Renders submitted full-scene Python with Manim. JSON body includes `python_code`, `quality` (`l`/`m`/`h`/`k`), `scene_name`, and optional **`is_web_export`** (default `false`). Returns **`video/mp4`** or **`video/webm`**; the Export panel’s **Render MP4 / Render WebM** button calls this via `src/services/measureClient.ts` (`renderScene`).
- **`GET /health`** — `{"status":"ok"}` for liveness.

Configure the base URL in the app (default **`http://127.0.0.1:8765`**).

---

## Global audio timeline (narration)

Narration is **not** stored per line or per graph in the data model. Instead:

1. Use the **Audio** floating panel: **TTS** (script + language) or **record** → upload.
2. Clips live in **`audioItems`** with `startTime`, `duration`, `text`, `audioUrl`, and optional **word boundaries** (Whisper).

**Export alignment** — When generating Manim playback for a **text line** or **graph**, the codegen may resolve a **matching** `audioItems` entry by **timeline position** (start time proximity / overlap). If a match is found, export emits **`self.add_sound("assets/audio/…")`** and sets **`run_time`** from **word-boundary span** when boundaries are available; otherwise it falls back to the clip’s timeline duration. Gaps between scheduled events (including before an exit clip) are expressed with **`self.wait`** from the exporter’s timeline cursor. There is **no** `manim-voiceover` dependency: the exported scene subclasses Manim’s **`Scene`** and uses ordinary **`self.play`** / **`self.wait`**.

---

## Export to Python (Manim)

- **Partial export** — Definitions, positioning, and playback blocks as pasteable snippets.
- **Full file** — Imports (`manim`, `ManimColor`, `HebrewMathLine`), one **`Scene`** subclass, and the sections commented in the exporter (`src/codegen/manimExporter.ts`). The server prepends `config.assets_dir` when rendering via **`measure_server.py`**.
- **Export target (Export panel)** — **Standard (MP4)** vs **Web Optimized (transparent WebM)**. Web mode sets **`isWebExport`** in codegen so the generated script configures Manim for transparent WebM (`config.transparent`, `config.format`, `config.background_color`) and shows a read-only **Hugo / HTML** `<video>` embed (filename `{SceneClassName}.webm`) plus **Copy to Clipboard**. The visible Python and the **Render** action both use the same target so the downloaded file matches the script.
- **Server render** — **Render MP4** or **Render WebM** uploads the **full-file** export; the client sends **`is_web_export: true`** for WebM. The measure server runs Manim with **`--format=mp4`** or **`--format=webm`**, finds the output under `media/videos/`, and returns the appropriate **`Content-Type`**.
- **Flattening** — **`CompoundItem`** does not exist in Python: child lines are exported in **timeline order** interleaved with other top-level leaves (`flattenExport.ts`). **`exit_animation`** items are not leaves; their Python is emitted at the correct global time in the playback section (`manimExporter.ts`).
- **Naming** — Internal IDs map to stable variable names such as `line_1`, `axes_2`; **`next_to`** uses those names.
- **Download Script (.md)** — **`exportScriptToMarkdown`** produces a **human-readable outline** (line headings + raw LaTeX, graph summaries, compound children). It is **not** a TTS script format; use **`audioItems`** for spoken content.

**Scene class name** — Editable in the header; sanitized with **`safeSceneClassName`** (`src/lib/pythonIdent.ts`) for valid Python identifiers.

---

## Compound clips (“chain calculations”)

Use a **compound** when several equations or lines should appear as **one block** on the timeline (one violet clip).

| Topic | Behavior |
|--------|----------|
| **Model** | `CompoundItem`: `childIds`, global timing and layer. Children: `TextLineItem` with `parentId`, `localStart`, `localDuration`. |
| **UI** | **+ Compound**; expand row; **+ Add line to sequence**. Compound editor: label, timing, layer, **Center chain horizontally**. Child selection opens **LineEditor** with **local** times. |
| **Duration** | Store recomputes compound `duration` from children when needed. |
| **Duplication** | Duplicating a compound yields an **empty** `childIds` (by design). |
| **Deletion** | Deleting a compound removes its children. Deleting a child updates `childIds` and resyncs duration. |
| **Centering** | New compounds default **`centerHorizontally: true`**; older projects may omit it (treated as off). Best results after **measure** has widths. |

**Modules** — `src/lib/time.ts`, `src/lib/compoundLayout.ts`, `src/lib/resolvePosition.ts`, `src/codegen/flattenExport.ts`, `src/codegen/lineCodegen.ts`, `src/store/useSceneStore.ts`.

---

## Project file format

- JSON containing **`version`** (see **`PROJECT_VERSION`** in `src/lib/constants.ts`), **`savedAt`**, **`defaults`**, **`items`**, **`measureConfig`**, and optionally **`audioItems`**.
- Bump **`PROJECT_VERSION`** when you make breaking schema changes and consider adding migration logic in **`loadProjectFile`** if needed.
- **Version 10** — Removes per-item `waitAfter`, `exitAnimStyle`, and `exitRunTime`. Legacy projects with `version` below 10 are migrated on load: non-`none` exits become **`exit_animation`** items (start time = old hold + wait + exit offset as before), then legacy fields are stripped (`migrateProjectToV10.ts`). Very old monolithic **`graph`** items are still split in **`migrateSceneItems.ts`** before that step.
- Import / export helpers live in **`src/lib/projectIO.ts`**.

### Portable bundle (`.mtproj`)

For **cross-machine portability** (especially **timeline audio**), use **Save bundle (.mtproj)** in the header. Plain **Save project** JSON is still supported for quick saves, but **`audioItems`** in JSON usually contain **`blob:`** URLs that **only work in the same browser session**, so JSON alone is not sufficient to move narration to another machine.

A **`.mtproj`** file is a **ZIP** archive with:

| Entry | Purpose |
|--------|---------|
| **`state.json`** | Same logical document as the JSON project: `version`, `savedAt`, `defaults`, `items`, `measureConfig`, optional `audioItems`. While saving a bundle, each track’s `audioUrl` is rewritten to a **relative path** under `assets/` (e.g. `assets/audio/foo.webm`) and **`assetRelPath`** is set to that path so **Manim export** keeps stable `self.add_sound("assets/audio/…")` lines after you reopen the bundle. |
| **`assets/audio/*`** | Raw bytes for each embedded clip (fetched from the current `blob:` or `http(s):` URL at save time). |
| **`assets/textures/*`** | Reserved for future texture files; not populated yet. |
| **`manifest.json`** | **`bundleFormatVersion`** (currently `1`) and an **`assets`** map: *zip-relative path* → **MD5** (lowercase hex) of the file bytes. On open, every listed file is checked; a mismatch fails load with an explicit **corrupt or altered** error. |

**Save failures** — If the app cannot `fetch` an audio URL (offline, **CORS** on a third-party host, etc.), **Save bundle** aborts and lists the affected tracks. Same-origin clips served by the **measure server** typically embed successfully.

**Implementation** — Packing and unpacking: **`src/lib/mtprojBundle.ts`** (ZIP via **`fflate`**, MD5 via **`spark-md5`**). Shared Manim/bundle path rules: **`src/lib/audioAssetPath.ts`**.

---

## Tech stack

| Layer | Technology |
|--------|------------|
| UI | React 19, TypeScript |
| Build | Vite 8 |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) |
| Canvas | Konva, `react-konva` |
| State | Zustand, Immer (`enableMapSet`), **zundo** (undo) |
| IDs | `nanoid` |
| Portable projects | **`fflate`** (ZIP `.mtproj`), **`spark-md5`** (manifest checksums) |

---

## Source layout (`src/`)

```
src/
├── main.tsx
├── App.tsx
├── index.css
├── types/
│   └── scene.ts              # SceneItem, AudioTrackItem, PosStep, SegmentStyle, …
├── store/
│   ├── useSceneStore.ts      # Items, audioItems, playback, CRUD, project I/O hooks
│   └── factories.ts          # Default constructors for items / segments
├── services/
│   ├── measureClient.ts
│   ├── measureHooks.ts
│   ├── useSidecarStatus.ts
│   └── tauriSidecar.ts
├── codegen/
│   ├── texUtils.ts
│   ├── lineCodegen.ts        # Line def/pos/play; audio-aligned run_time helper
│   ├── graphCodegen.ts
│   ├── flattenExport.ts
│   ├── scriptExport.ts       # Markdown scene outline download
│   └── manimExporter.ts      # Full / partial Python assembly
├── canvas/                   # SceneCanvas, layers, drag / resolve hooks
├── timeline/                 # Clips, ruler, audio row, playback loop
├── panels/                   # ItemList, Line/Axes/graph editors, ExitAnimationEditor, …
├── components/               # FloatingPanel, ColorPicker, NumberInput, …
└── lib/                      # constants, time, projectIO, mtprojBundle, audioAssetPath, migrateProjectToV10, …
```

There is **no** `voiceoverCodegen` or per-item voice UI: narration is entirely via **`audioItems`** and export-time alignment.

---

## Architecture notes

- **`types/`** — Pure models; no React.
- **`store/`** — Single source of truth; temporal undo via zundo.
- **`codegen/`** — Deterministic string generation from `types` + `lib` (shared math with preview where possible).
- **`canvas/`** and **`timeline/`** — Presentation only; they read the store and dispatch actions.

This separation keeps **preview**, **timeline editing**, and **Manim export** testable and evolvable independently (including future **Tauri** packaging).

---

## Running locally

All **`npm`** commands run from **`manim-timeline/`** (not the monorepo root).

### Frontend

```bash
cd manim-timeline
npm install
npm run dev
```

Open **http://localhost:5173/**.

Unit tests (including `.mtproj` checksum and round-trip logic): **`npm run test`**.

### Measure server (recommended)

From the **repository root** (parent of `manim-timeline/`), in a Python environment that has Manim and your Hebrew math modules:

```bash
pip install fastapi uvicorn
# Optional, for Audio panel:
# pip install gtts openai-whisper

uvicorn measure_server:app --reload --port 8765
```

Check **http://127.0.0.1:8765/health**.

Match that URL in the app settings if you use another host or port.

### Build

```bash
cd manim-timeline
npm run build
```

Runs **`tsc -b`** then **`vite build`**.

---

## Tauri desktop (optional)

Native shell and optional **PyInstaller** sidecar: see **`TAURI.md`** and **`src-tauri/binaries/README.md`**. **`tauri dev`** requires **Rust** and, on Windows, **MSVC**. If `externalBin` is set, the sidecar executable must exist at the expected path or the Rust build fails.

---

## Relationship to the rest of the repository

| Path | Role |
|------|------|
| **`measure_server.py`** | FastAPI: measure, audio APIs, optional render; CORS for Vite. |
| **`hebrew_math_line.py`**, **`hebrew_math_parser.py`**, … | Shared with Manim renders; used server-side for measurement. |

---

## Roadmap and known gaps

| Area | Notes |
|------|--------|
| **Core editor** | Timeline, canvas, compounds, audio row, export — in active use. |
| **Audio ↔ animation** | Alignment is **heuristic** (time overlap / nearest clip). Finer control (explicit clip-to-item links) could be added later. |
| **Canvas vs Manim** | Preview is **approximate** for complex `next_to` / `to_edge` chains. |
| **Settings** | Measure URL and flags exist; more UI polish possible. |
| **Distribution** | Tauri + optional bundled measure server remains the path to a single installer. |

---

## Troubleshooting

| Symptom | Things to check |
|---------|------------------|
| **Measure never completes** | Server running? URL in app matches? Browser console / network tab for failed `POST /measure`. |
| **No audio on timeline** | `gtts` / `whisper` installed on server? `POST /api/generate_audio` errors in UI. |
| **`npm` fails at repo root** | **`cd manim-timeline`** first. |
| **Export class name rejected** | Use letters/digits/underscore; see live sanitized hint next to Scene name field. |
| **WebM render fails** | Manim build must support WebM; check server stderr from **`POST /api/render`** with **`is_web_export: true`**. |
| **Tauri build errors** | Rust on PATH, MSVC on Windows; see **`TAURI.md`**. |

---

*Last updated: Exit animations as separate `exit_animation` timeline clips targeting other items; removal of `waitAfter` and per-item exit fields (project v10 migration); clip naming helpers (`itemDisplayName.ts`) for lists and target menus; canvas lifespan via `effectiveStart` / `effectiveEnd` in `time.ts`; Manim export interleaves exit `self.play` with leaf playback and `self.wait` gaps.*
