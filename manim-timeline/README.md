# Manim Timeline

A desktop-oriented web app for building **Manim** scenes with a **timeline** (playhead, clips) and a **2D frame preview** (Konva). It is a migration of the older `manim_helper.html` prototype toward a structured React app.

## What the app does (so far)

### Core workflow

1. **Scene items** — You add **text lines** (`HebrewMathLine`-style LaTeX), **graphs** (axes, plots, dots), or **compound clips** (see below). Each item has:
   - **Time**: `startTime`, `duration`, `waitAfter`, and a **layer** (stacking / timeline row). Child lines inside a compound use **local** start/duration relative to the compound start.
   - **Space**: Manim frame coordinates `(x, y)`, `scale`, and an optional **positioning chain** (`posSteps`). Compounds do not have their own `(x, y)`; they group lines only.
   - **Content**: For lines — raw LaTeX, font, per-segment colors, bold/italic (sent to the measure server for preview); for graphs — ranges, functions, dots.
   - **Text line entry animation** (`animStyle`): **`write`** (default), **`fade_in`**, or **`transform`**. Transform maps segments from an **earlier** text line via **Segment mapper** (pair LaTeX segments, choose unmapped source/target behavior).
   - **Text line exit** (optional): `fade_out`, `uncreate`, `shrink_to_center`, or `none`, with optional `exitRunTime` — reflected in export playback.
   - **Graph exit** (optional): same exit styles for axes/plots in export.

2. **Timeline** — **Top-level** items appear as clips (text, graph, or compound). Nested text lines inside a compound **do not** get their own timeline bars. You can:
   - Scrub the **playhead** and use **Play/Pause**.
   - Move and resize clips in time.
   - **Add new items at the current playhead time** (so clips start when the timeline says).
   - **Compound** clips use a distinct **violet** style; the label falls back to `Compound (n)` when empty.
   - **Audio row** — A dedicated **Audio** track under the layer tracks shows **audio clips** (TTS or mic upload). Clips can be moved/resized in time; **scene duration** includes the end of the last audio clip. New tracks are inserted at the **current playhead**.

3. **Canvas** — A Konva stage shows the default Manim camera frame (16:9). Only items whose time range contains the **current playhead** are drawn. **Compound** items are not drawn; only their **child text lines** appear when active.
   - **Absolute-only** positioning: items are **draggable**; drag updates stored `(x, y)`.
   - **Constrained** positioning (`to_edge`, `next_to`, `set_x`/`set_y`, `shift`): the canvas **resolves** the chain to a position; the object is **locked** (not draggable) and shown with an amber dashed border. Edits happen in the **Positioning steps** UI.
   - **Compound horizontal centering**: if enabled on the compound, all child lines share one horizontal shift so the union of their bounding boxes is centered on **x = 0** (preview matches export). Widths use measure data when available.

4. **Measure server** — For text lines, optional HTTP calls to a local **`measure_server.py`** return sizes, ink bounds, ink offsets (RTL alignment), optional cropped PNG previews, and per-segment bold/italic styling. The same server can also:
   - **`POST /api/generate_audio`** — gTTS MP3 + **OpenAI Whisper** word-level timestamps (used by the **Audio** panel for TTS tracks).
   - **`POST /api/upload_audio`** — Upload a recording (e.g. WebM from the browser); Whisper transcribes with word boundaries; file is stored under `assets/audio/` for playback URLs.
   - **`GET /health`** — Liveness check (`{"status":"ok"}`).

5. **Export** — Generates Python snippets or a **full file** skeleton: `HebrewMathLine` definitions, positioning calls, entry/exit animations (`Write`, `FadeIn`, `TransformMatchingTex`, etc.), `wait` playback, and segment `set_color` where applicable. **`next_to`** references are emitted as real variable names (`line_1`, `axes_2`), not internal IDs. **Compound** clips are **flattened** to an ordered list of child text lines (and any interleaved top-level graphs in timeline order); there is no `Compound` type in Python. Child lines use **`localDuration`** (and timing derived from local start) for `run_time` where applicable. If **center chain horizontally** is on, each exported line gets a matching `.shift(dx * RIGHT)` after its positioning block so the rendered scene matches the editor. **Voiceover** export can use **`audioItems`** word boundaries when `voice.audioTrackId` points at a timeline track (types/codegen support this; wire via project data if needed). **Download Script (.md)** exports a readable markdown outline of narration scripts (lines, graphs, compounds) from the **Export** tab.

6. **Project file** — Save/load JSON of the scene (items, defaults, measure URL settings, optional **`audioItems`**). The format version is stored as **`PROJECT_VERSION`** in `src/lib/constants.ts` (incremented when the schema changes).

7. **Scene name** — The header **Scene** field sets the exported Manim **class name** (sanitized to a valid Python identifier in `src/lib/pythonIdent.ts`). Default is `Scene1`. Run Manim with the sanitized name shown as `→ …` next to the field (e.g. `manim -pql your_file.py YourClassName`).

### Compound clips (“chain calculations”)

Use a **compound** when you want **several text lines** to behave as **one block** on the timeline (one row, one violet clip), e.g. a multi-step derivation.

| Concept | Behavior |
|--------|----------|
| **Data model** | `CompoundItem`: `childIds` (ordered), global `startTime` / `duration` / `layer` / `waitAfter`. Child lines are `TextLineItem` with `parentId`, `localStart`, `localDuration`. |
| **Sidebar** | **+ Compound** creates a compound. Rows can **expand/collapse** to show child lines. **+ Add line to sequence** appends a child. Child rows can be removed without deleting the compound. |
| **Inspector** | Selecting the compound opens **CompoundEditor** (label, timing, layer, child summary, **Center chain horizontally (x = 0)**). Selecting a child opens **LineEditor** with **local** start/duration instead of global times. |
| **Playback / duration** | Scene duration and visibility use **effective** start/end for children (`compound.startTime + localStart`, etc.). The store **syncs** compound duration from children when needed. |
| **Position / scale** | **Drag** and **setItemPosition** / **setItemScale** do not apply to the compound itself (only to drawable items). |
| **Duplication** | Duplicating a compound copies it with an **empty** `childIds`; child lines are not duplicated automatically. |
| **Deletion** | Deleting a compound removes its children from the project. Deleting a child removes it from `childIds` and resyncs the compound. |
| **Horizontal centering** | Optional `centerHorizontally` on the compound. **New** compounds default to **on**. Older projects without the field default to **off**. Uses measured widths when present; otherwise a fallback width is used (centering is most accurate after measure). If a line uses **`next_to`** relative to a mobject **outside** the compound, moving the chain can desync that relationship; chains that only reference **siblings** work as intended. |
| **Voiceover** | There is **no** shared recording on the compound. Each **text line** (and graph) has its own `VoiceoverConfig` (runtime vs voiceover mode, TTS vs recorder, preamble/script, optional **merge with next** / per-segment flags — see codegen for what is emitted). Optional **`audioTrackId`** links a clip to an **`audioItems`** track for Whisper-aligned timing in export. |

**Relevant modules**: `src/lib/time.ts` (`isTopLevelItem`, `effectiveStart` / `effectiveEnd`, `isActiveAtTime`), `src/lib/resolvePosition.ts` (base `resolvePosition` / `getItemBBox`), `src/lib/compoundLayout.ts` (`compoundHorizontalShiftX`, `resolvePositionWithCompound`), `src/codegen/flattenExport.ts`, `src/codegen/lineCodegen.ts` (transform + exit anims), `src/store/useSceneStore.ts` (CRUD, `addChildLineToCompound`, `syncCompoundDuration`, `addAudioItem` / `addRecordedAudioTrack`).

### Planning ahead (roadmap)

Use this as a working backlog; reorder or cut scope as you like.

| Area | Status / next steps |
|------|---------------------|
| **Core editor** | Timeline, canvas, compounds, floating panels, scene name, project JSON — in place. |
| **Measure server** | `POST /measure`, **`/api/generate_audio`**, **`/api/upload_audio`**, **`/api/render`**, `GET /health`. Run **`uvicorn`** in dev; optional PyInstaller **sidecar** + `externalBin` for bundled desktop (see **`TAURI.md`**, **`scripts/README-sidecar.md`** — bundling may need extra Whisper/gTTS hooks). |
| **Tauri desktop** | Scaffold + `npm run tauri:dev` / `tauri:build`; needs Rust + MSVC on Windows; sidecar binary optional. |
| **Voiceover** | Per-line export; **no** compound-level single recording; **audio timeline** + optional `audioTrackId` for Whisper alignment; **`mergeWithNext`** still limited in codegen (check `voiceoverCodegen` / `lineCodegen` for current behavior). |
| **Parity vs `manim_helper.html`** | Shortcuts, merged narration chains, edge cases in codegen — still open. |
| **Canvas fidelity** | Preview is approximate vs Manim `next_to` / `to_edge` ink math. |
| **Settings UX** | Measure URL / enable flags exist in store; surface more in UI if needed. |
| **Distribution** | One-click installer story = Tauri bundle + (optional) embedded measure exe. |

### What is not done yet (shorthand)

- Full **HTML-tool parity** (voiceover merge, shortcuts, codegen edge cases).
- **Exact** Konva ↔ Manim spatial parity for constrained positioning.

---

## Tech stack

| Layer | Choice |
|--------|--------|
| UI | React 19, TypeScript |
| Build | Vite |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) |
| Canvas | Konva + `react-konva` |
| State | Zustand + Immer (`enableMapSet` for `Map`/`Set`) + **zundo** (undo history) |
| IDs | `nanoid` |

---

## Project structure (`src/`)

```
src/
├── main.tsx                 # React entry
├── App.tsx                  # Layout: header, sidebar, canvas, floating panels, timeline
├── index.css                # Tailwind + global tweaks
│
├── types/
│   └── scene.ts             # TextLineItem, GraphItem, CompoundItem, PosStep, VoiceoverConfig, …
│
├── store/
│   ├── useSceneStore.ts     # Zustand: items, audioItems, playhead, selection, CRUD, measure cache
│   └── factories.ts         # createTextLine, createTextLineInCompound, createCompound, createGraph, …
│
├── services/
│   ├── measureClient.ts     # POST /measure; /api/generate_audio; /api/upload_audio
│   ├── measureHooks.ts      # useMeasureLine (debounced)
│   ├── useSidecarStatus.ts  # Poll GET /health (optional; Tauri / local server)
│   └── tauriSidecar.ts      # Health stub; sidecar spawned from Rust when bundled
│
├── codegen/
│   ├── texUtils.ts          # parseSegments, reconstruct, bold/italic wraps
│   ├── lineCodegen.ts       # HebrewMathLine def, pos, entry/exit/transform playback
│   ├── graphCodegen.ts      # Axes, plots, dots, playback
│   ├── voiceoverCodegen.ts  # VoiceoverScene imports (when used)
│   ├── flattenExport.ts     # Flatten compounds → ordered export leaves
│   ├── scriptExport.ts      # exportScriptToMarkdown() — narration script .md
│   └── manimExporter.ts     # exportManimCode(), wires id → Python var names
│
├── canvas/
│   ├── SceneCanvas.tsx      # Stage, layers, visible items by playhead
│   ├── hooks/
│   │   ├── useManimCoords.ts
│   │   ├── useDragSnap.ts   # Draggable only if posSteps are all `absolute`
│   │   └── useResolvedPosition.ts  # useResolvedPositions() → resolvePositionWithCompound
│   └── layers/
│       ├── GridLayer.tsx
│       ├── TextLineNode.tsx
│       └── GraphNode.tsx
│
├── timeline/
│   ├── Timeline.tsx         # Top-level clips; ruler; playhead; Audio row
│   ├── TimelineTrack.tsx
│   ├── TimelineClip.tsx     # Per-kind colors (incl. compound)
│   ├── AudioClip.tsx        # Draggable audio tracks (blob/server URLs)
│   ├── PlaybackControls.tsx
│   └── hooks/
│       └── usePlaybackLoop.ts
│
├── panels/
│   ├── ItemList.tsx         # + Text / + Graph / + Compound; compound expand/collapse
│   ├── PropertyPanel.tsx    # LineEditor | GraphEditor | CompoundEditor
│   ├── LineEditor.tsx
│   ├── GraphEditor.tsx
│   ├── CompoundEditor.tsx   # Compound clip + center-chain toggle
│   ├── PositionStepsEditor.tsx
│   ├── SegmentEditor.tsx
│   ├── SegmentMapperModal.tsx  # Transform: map source/target LaTeX segments
│   ├── VoiceoverEditor.tsx
│   ├── AudioPanel.tsx       # TTS script + language; mic record → upload
│   └── ExportPanel.tsx      # Manim code + Download Script (.md)
│
├── components/
│   ├── FloatingPanel.tsx    # Draggable/resizable popup container
│   ├── ColorPicker.tsx
│   ├── NumberInput.tsx      # Local draft until blur (smooth typing)
│   └── DirectionPicker.tsx
│
└── lib/
    ├── constants.ts         # FRAME_W, FRAME_H, PROJECT_VERSION, debounce, …
    ├── time.ts              # Top-level filter, effective times, compound helpers
    ├── resolvePosition.ts   # resolvePosition, getItemBBox (shared canvas + export math)
    ├── compoundLayout.ts    # compoundHorizontalShiftX, resolvePositionWithCompound
    ├── pythonIdent.ts       # safeSceneClassName() for export
    ├── ids.ts
    └── projectIO.ts         # download / pick JSON project file
```

### Dependency direction (intended)

- **`types/`** — No app imports; pure TypeScript models.
- **`store/`** — Depends on `types`, `lib`; holds runtime state only.
- **`codegen/`** — Depends on `types` and **`lib`** (compound layout shared with preview); no React, no Konva.
- **`services/`** — Depends on `types`, `store` (for hooks).
- **`canvas/`**, **`timeline/`**, **`panels/`** — React + Konva; depend on `store`, `types`, `lib`, and shared `components`.

This keeps **Manim code generation**, **Konva preview**, and **timeline UI** separable for maintenance and future Tauri integration.

---

## Running locally

The Node project (including `package.json` and Tauri) lives in **`manim-timeline/`**. Running `npm` from the parent folder **`ManimStuff/`** will fail with missing `package.json` — always **`cd manim-timeline`** first.

### Two processes (recommended for full checks)

**1 — Frontend (Vite)**

```bash
cd manim-timeline
npm install
npm run dev
```

Open **http://localhost:5173/**.

**2 — Measure server (Python, same env as Manim)**

From the repo root **`ManimStuff/`** (one level *above* `manim-timeline`), with dependencies installed (`fastapi`, `uvicorn`, plus everything `measure_server.py` needs — Manim, your Hebrew math modules, etc.):

```bash
cd ..                    # if you are inside manim-timeline/
# or: cd path/to/ManimStuff

pip install fastapi uvicorn   # once per venv
# Optional — for Audio tab (TTS + Whisper) and richer measure features:
# pip install gtts openai-whisper

uvicorn measure_server:app --reload --port 8765
```

**Sanity check:** open **http://127.0.0.1:8765/health** — expect JSON like `{"status":"ok"}`. The app’s measure URL should match (**`http://127.0.0.1:8765`** by default in settings).

**Smoke test:** add a text line, enable measurement / preview if available — sizes and preview chips should update when the server is up. With **`gtts`** and **`openai-whisper`** installed, use the **Audio** tab to generate a track or record from the mic; a clip should appear on the **Audio** timeline row.

### Frontend only

`npm run dev` alone is enough to click through the UI; measure-dependent layout and previews need the Python server as above.

### Desktop (Tauri + PyInstaller sidecar)

Optional native shell: see **`TAURI.md`** and **`src-tauri/binaries/README.md`**. Listing `externalBin` in `tauri.conf.json` **requires** the PyInstaller exe to already exist at `src-tauri/binaries/measure-server-<triple>.exe`; otherwise the Rust build fails. The default config omits that so **`tauri dev`** runs without the sidecar (use Uvicorn for measure, or build the exe and add `externalBin` when ready).

**Rust and Cargo must be installed** (via [rustup](https://rustup.rs/)); on Windows you also need the **MSVC** C++ build tools. If `tauri dev` fails with `cargo metadata ... program not found`, fix your Rust/PATH setup first (details in **`TAURI.md`**). For a browser-only workflow, keep using **`npm run dev`** without Tauri.

---

## Relationship to the rest of the repo

- **`measure_server.py`** (repo root) — FastAPI app: LaTeX measure, optional **gTTS + Whisper** audio APIs, CORS for the Vite dev server.
- **`hebrew_math_line.py`**, **`hebrew_math_parser.py`**, etc. — Python toolchain shared with Manim renders; measurement calls into them server-side.
- **`manim_helper.html`** — Original monolithic prototype; behavior and export style are the reference for this app.

---

*Last updated: audio timeline (TTS/mic, Whisper boundaries), measure server `/api/generate_audio` + `/api/upload_audio`, text line entry/exit/transform animations, segment mapper, script markdown export, project `audioItems`, README structure refresh.*
