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
| **Graph** | Axes (`Axes`), plotted curves, dots, optional numeric labels; positioning and timing like other clips. |
| **Compound** | A single timeline clip that **groups several text lines** with **local** timing inside the compound (see [Compound clips](#compound-clips-chain-calculations)). |

**Time** — Each timed item has `startTime`, `duration`, `waitAfter`, and `layer`. Items inside a compound use `localStart` / `localDuration` (and `parentId`); the store keeps the compound’s `duration` in sync with its children.

**Space** — `x`, `y`, `scale`, plus an ordered list **`posSteps`**: absolute `move_to`, `next_to` (another line or graph), `to_edge`, `shift`, `set_x`, `set_y`. Compounds do not occupy the canvas; only their child lines do.

**Text line animations**

- **Entry** — `animStyle`: `write` (default), `fade_in`, or `transform`. **Transform** uses a **segment mapping** from an **earlier** line (`TransformMapping` + **Segment mapper** UI): paired indices, unmapped source/target behavior (`fade_out` / `leave`, `fade_in` / `write`).
- **Exit** — Optional `exitAnimStyle`: `fade_out`, `uncreate`, `shrink_to_center`, or `none`, with `exitRunTime`.

**Graph animations**

- Playback is expressed with `Create` / `FadeIn` / `Write` as appropriate; graphs support the same **exit** styles as lines for the axes and plotted mobjects.

### Timeline

- **Top-level** items appear as **clips** on layer tracks. Child lines of a compound **do not** get their own top-level bars; they are edited via the compound row (expand/collapse in the item list).
- **Playhead** — Scrub, **Play / Pause**; optional view range zoom.
- **CRUD** — New lines, graphs, and compounds can be created **at the current playhead** so default `startTime` matches what you see.
- **Audio row** — Separate track(s) for **`audioItems`**: clips from **TTS** or **microphone upload** (via the measure server). Scene **duration** extends to the end of the last audio clip if it finishes after visual items.

### Canvas (Konva)

- Frame size matches Manim defaults (**`FRAME_W` × `FRAME_H`** in `src/lib/constants.ts`).
- Only items that should appear on the frame at the current time are drawn, using **Manim-style lifespan** logic in `src/canvas/useAnimationProgress.ts` (visible after `startTime`, through `waitAfter`, until an optional exit finishes; no exit means the object stays). Timeline helpers `effectiveStart` / `effectiveEnd` live in `src/lib/time.ts`.
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

**Export alignment** — When generating Manim playback for a **text line** or **graph**, the codegen may resolve a **matching** `audioItems` entry by **timeline position** (start time proximity / overlap). If a match is found, export emits **`self.add_sound("assets/audio/…")`** and sets **`run_time`** from **word-boundary span** when boundaries are available; otherwise it falls back to the clip’s timeline duration. There is **no** `manim-voiceover` dependency: the exported scene subclasses Manim’s **`Scene`** and uses ordinary **`self.play`** / **`self.wait`**.

---

## Export to Python (Manim)

- **Partial export** — Definitions, positioning, and playback blocks as pasteable snippets.
- **Full file** — Imports (`manim`, `ManimColor`, `HebrewMathLine`), one **`Scene`** subclass, and the sections commented in the exporter (`src/codegen/manimExporter.ts`). The server prepends `config.assets_dir` when rendering via **`measure_server.py`**.
- **Export target (Export panel)** — **Standard (MP4)** vs **Web Optimized (transparent WebM)**. Web mode sets **`isWebExport`** in codegen so the generated script configures Manim for transparent WebM (`config.transparent`, `config.format`, `config.background_color`) and shows a read-only **Hugo / HTML** `<video>` embed (filename `{SceneClassName}.webm`) plus **Copy to Clipboard**. The visible Python and the **Render** action both use the same target so the downloaded file matches the script.
- **Server render** — **Render MP4** or **Render WebM** uploads the **full-file** export; the client sends **`is_web_export: true`** for WebM. The measure server runs Manim with **`--format=mp4`** or **`--format=webm`**, finds the output under `media/videos/`, and returns the appropriate **`Content-Type`**.
- **Flattening** — **`CompoundItem`** does not exist in Python: child lines are exported in **timeline order** interleaved with other top-level leaves (`flattenExport.ts`).
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
- Import / export helpers live in **`src/lib/projectIO.ts`**.

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
├── panels/                   # ItemList, editors, AudioPanel, ExportPanel, …
├── components/               # FloatingPanel, ColorPicker, NumberInput, …
└── lib/                      # constants, time, layout, pythonIdent, projectIO, …
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

*Last updated: Web export pipeline (transparent WebM + Hugo embed snippet + `is_web_export` on `/api/render`); canvas visibility aligned with Manim-style lifespan in `useAnimationProgress.ts`; global audio timeline as the single narration path; Manim export uses `Scene` + `self.play` / `self.wait` / optional `add_sound`.*
