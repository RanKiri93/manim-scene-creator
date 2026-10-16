# Manim Timeline

A **desktop-oriented web application** for authoring **Manim** scenes with a **non-linear timeline** (playhead, draggable clips, layers), a **2D frame preview** (Konva, 16:9 Manim camera), and optional integration with a local **measure / audio** Python server. The app targets **Hebrew + math** workflows via `HebrewMathLine`-style LaTeX and shared Python tooling in the parent repository.

This document is the **canonical** reference for the `manim-timeline/` package. The repository root may contain a shorter `README.md` that points here.

---

## Table of contents

1. [What the application does](#what-the-application-does)
2. [Global audio timeline (narration)](#global-audio-timeline-narration)
3. [Export to Python (Manim)](#export-to-python-manim)
4. [Export timing and audio synchronization](#export-timing-and-audio-synchronization)
5. [Compound clips](#compound-clips-chain-calculations)
6. [Target animations (permanent effects)](#target-animations-permanent-effects)
7. [Function series](#function-series)
8. [Project file format](#project-file-format)
   - [Portable bundle (`.mtproj`)](#portable-bundle-mtproj)
9. [Tech stack](#tech-stack)
10. [Source layout (`src/`)](#source-layout-src)
11. [Architecture notes](#architecture-notes)
12. [Running locally](#running-locally)
13. [Tauri desktop (optional)](#tauri-desktop-optional)
14. [Relationship to the rest of the repository](#relationship-to-the-rest-of-the-repository)
15. [Roadmap and known gaps](#roadmap-and-known-gaps)
16. [Troubleshooting](#troubleshooting)

---

## What the application does

### Scene items

You build a scene from **items** stored in a Zustand map. Each top-level item can be:

| Kind | Purpose |
|------|---------|
| **Text line** | LaTeX source with `||` segment splits; rendered in Manim as `HebrewMathLine` (or equivalent export). Supports per-segment color, bold, italic, optional **`waitAfterSec`**; measurement fills bbox and optional PNG preview. Segment `i` (in the order typed in the source) is `line[i]` in export, measure boxes and preview. English goes in `\en{…}` (math and `||` may sit inside); a line can be switched to an English base (LTR), where Hebrew goes in `\he{…}`. English uses the Hebrew font unless the line sets an English font. The editor flags unwrapped text in the other script and can wrap it. Editing the source keeps each segment's colour, style, anim time and wait with its text (also across `||` splits and merges), and blink, target-animation, surround, `next_to` and transform references follow their segment. |
| **Axes** | Coordinate system only; plots, dots, fields, and function series are **separate clips** referencing `axesId`. |
| **Graph overlays** | `graphPlot`, `graphCurve`, `graphDot`, `graphField`, `graphFunctionSeries`, and other graph overlays — timed like other clips and attached to an axes item. Dots can be free or attached to a function/parametric source; see [Graph animations](#graph-animations). `graphFunctionSeries` renders a family of curves parameterized by integer `n ∈ [nMin, nMax]`; see [Function series](#function-series). |
| **Image** | Still picture imported from disk (**PNG/JPG/GIF** — GIF shows its first frame). Sized in Manim units (`width`/`height`), with `opacity`, `rotationDeg`, and normal `posSteps` positioning; export uses Manim `ImageMobject` and participates in exit, blink-scale, surrounding rectangles, and move/path/scale/rotate target animations. The Konva preview fades images in over their clip `duration` with Manim-smooth `FadeIn` pacing (`imageIntroOpacity` in `src/lib/visualPlaybackPreview.ts`), composing with exit fades. Newly imported live images are embedded as `data:` URLs by the Export panel for direct Python/render; `.mtproj` still stores them durably under `assets/textures/*`. |
| **Compound** | A single timeline clip that **groups several text lines** with **local** timing inside the compound (see [Compound clips](#compound-clips-chain-calculations)). |
| **Exit animation** | A **separate timeline clip** (`exit_animation`) that targets another animatable item by `targetId`. It runs `FadeOut` / `Uncreate` / `ShrinkToCenter` (or `none`) at its own `startTime` for `duration` seconds. The exit must start at or after the target’s **hold end** (`effectiveStart + run duration`, including compound-local duration for child lines). Adding an object does not create an exit; add exits from **Insert → Animations → Exit** when needed. |
| **Target animation** | A **timeline clip** (`target_animation`) that applies a **permanent** visual change (after playback) to one or more items via `targets[].targetId`. Modes include `scale`, `color`, `move`, `path`, `rotate`, and `graphFollow`. State is carried on this clip — **not** by mutating `posSteps` on the target. See [Target animations](#target-animations-permanent-effects). |

**Time** — Each timed item has `startTime`, `duration`, and `layer`. Items inside a compound use `localStart` / `localDuration` (and `parentId`); the store keeps the compound’s `duration` in sync with its children. Pauses can be **spacing clips on the timeline**, or optional **`waitAfterSec` on each text-line segment** (extends that line’s `runDuration` and shows as amber stripes on the timeline bar; export uses `Succession` / `Wait`).

**Space** — `x`, `y`, `scale`, plus an ordered list **`posSteps`**: absolute `move_to`, `next_to` (another line or axes), `to_edge`, `shift`, `set_x`, `set_y`. Compounds and exit clips do not occupy the canvas; only drawable leaves do.

**Clip naming** — Each item can have a **`label`** (“Clip name” in editors). It appears in the item list, timeline bar (with sensible fallbacks when empty), the **exit-animation target** menu, and **Positioning steps** reference pickers. Graph dots also have an on-canvas label on the dot object, separate from the clip name. The Items panel offers **Timeline** (chronological) and **By object** views: the latter nests each object's related animations/effects underneath it with compact `Exit · FadeOut · @8.2s`-style rows (multi-target clips appear under each target with a `+N` chip; clips with no visible target sit under **Unassigned**). Every graph overlay row (plot, curve, dot, field, function series, point sequence, area) also carries a compact `Axes: <name>` chip naming the axes it is attached to via `axesId` (click to select that axes; stale links show `Axes missing`) — visible in both views.

**Text line animations**

- **Entry** — `animStyle`: `write` (default), `fade_in`, or `transform`. **Transform** uses a **segment mapping** from an **earlier** line (`TransformMapping` + **Segment mapper** UI): paired indices, unmapped source/target behavior (`fade_out` / `leave`, `fade_in` / `write`).
- **Preview** — Canvas text preview is a lightweight client-side approximation of the Manim render: the measured `HebrewMathLine` PNG is revealed per segment (right-to-left for Hebrew, left-to-right for math), but `Write`/`FadeIn`/`ReplacementTransform` pacing follows Manim's default eased `smooth` rate function (`manimSmoothProgress` in `src/lib/visualPlaybackPreview.ts`) rather than linear time. Segment start/end times, waits, and audio-bound durations are unchanged, so preview stays aligned with export; exact glyph-stroke `Write` tracing remains out of scope.

**Exit animations**

- Configured only on **`exit_animation`** items: `animStyle`, `duration` (run time), `targetId`, and timeline `startTime`. Deleting a target removes dependent exit clips. Export interleaves exit `self.play(...)` at the scheduled global time (see `manimExporter.ts`).

**Graph animations**

- Playback is expressed with `Create` / `FadeIn` / `Write` as appropriate; **exits** for axes and overlays use the same Manim ops, emitted from **exit_animation** clips that target the corresponding item.
- **Move along graph** — A `target_animation` with mode `graphFollow` moves an existing `graphDot` over time on a fixed function or attached parametric curve. Function-attached dots store source plot + current `x` and move toward `targetX`; parametric-attached dots store source curve + current `t` and move toward `targetT`. The source is inferred for attached dots. A free dot can follow an explicitly selected compatible function plot by x, but must already lie on that plot; free-point parametric inversion is not supported. Smooth (default) or linear easing controls progress. Clips can be chained with timeline gaps: each destination is held through the pause and after the last clip.
- **Connector lines** — A line or arrow shape can have its ends bound to anchors instead of a position (**Base → Connector ends** in Properties, `ShapeItem.endpoints`): a graph dot, the dot's foot on the x- or y-axis (the vertical / horizontal drop, nearest range edge when 0 is outside the range), a fixed point on axes, the centre or an edge of a text line / shape / image / axes, or a fixed scene point. Both ends are recomputed every frame, so a drop line follows a dot moving along a graph. The preview uses `src/lib/shapeAnchors.ts`; export redraws the line in an updater after everything is placed (`generateConnectorBind`), with an always-present driver so the line is current when its intro starts. Only colour animations apply to a connector. Deleting what a connector follows keeps the line where it was, unbound. The *Line* choice in the same panel makes it a **line through both ends** (lengthened past each end by a set amount, for a secant through two dots) or a **tangent at a graph dot** (and any connector can carry 1–3 *equal-length ticks*; a polyline can be an *angle mark* — arc or right-angle square at a vertex — that follows its three points): a segment of a set length centred on the dot that turns with the plot's slope every frame as the dot moves (slope from the plot the dot is on or follows, or a chosen plot; numerically from the JS expression in preview and the Python expression in export, same step).
- **Dot labels and coordinates** — The fixed label and live `(x, y)` coordinate annotation have independent size, color, direction, and spacing settings; coordinate precision is configurable from 0 to 6 decimals. Projection guides end at x=0/y=0 when those axes are visible, otherwise at the nearest visible range boundary. Export uses cached `HebrewMathLine` glyphs for live numbers rather than compiling TeX in a per-frame updater. *Live label text* replaces "(x, y)" with your own text and values: `{x}`, `{y}`, `{slope}` (for example `f(x) = {y}`); fixed text is typeset once as math unless it has `$` or Hebrew. *Trail* (Style tab) leaves the path behind the dot, whole or fading after a set number of seconds.
- **Validation and support boundary** — Off-curve free-function starts, missing/incompatible sources, overlapping position writers (`graphFollow`/`move`/`path`), and detected invalid/domain-hole/discontinuity intervals are reported as actionable errors; no snap or initial jump is applied. Interval discontinuity detection is best-effort numerical sampling, not a proof that every discontinuity is detected. Graph shape animation, arc-length-constant speed, free-dot parametric inversion and optimization/search are not supported. The export capability guard is enabled only after function-x and attached-parametric-t exports, annotations, and rendered review passed.

### Timeline

- **Top-level** items appear as **clips** on layer tracks. Child lines of a compound **do not** get their own top-level bars; they are edited via the compound row (expand/collapse in the item list).
- **Playhead** — Scrub, **Play / Pause**; optional view range zoom.
- **CRUD** — New lines, axes, graph overlays, compounds, and **exit animations** can be created **at the current playhead** (exit clips snap so `startTime` is not before the target’s hold end).
- **Audio row** — Separate track(s) for **`audioItems`**: clips from **TTS** or **microphone upload** (via the measure server). Scene **duration** extends to the end of the last audio clip if it finishes after visual items.
- **Insert or remove time…** — **Close empty range** removes `[start, end)` and shifts later visual/audio clips left; **Insert empty time** opens N seconds at a point and shifts later clips right. Edits that would overlap a clip are blocked (nothing is split or trimmed); linked audio follows its visual clip. One Apply = one undo step.

### Canvas (Konva)

- Frame size matches Manim defaults (**`FRAME_W` × `FRAME_H`** in `src/lib/constants.ts`).
- Only items that should appear on the frame at the current time are drawn using **`effectiveStart` / `effectiveEnd`** in `src/lib/time.ts`: visible from the item’s global start until the end of an **`exit_animation`** that targets it, or **indefinitely** if no such exit exists. Graph grouping uses the same helpers in `src/lib/graphPreview.ts`.
- **Draggable** when all `posSteps` are **absolute**; otherwise the resolved position is shown with a **locked** (amber) treatment and you edit steps in **Positioning steps**.
- **Text snapping** — The toolbar's **Snap text** checkbox attracts measured visible text ink to nearby same-frame text, shape, image, axes-domain, and frame edges. The default gap is **0.3 Manim units everywhere**; hold **Alt** while dragging to bypass. It changes the dropped coordinates only (nearby items do not become attachments). Set the per-line **Snap gap (Manim units)** in **Positioning steps** to customize subsequent drags; changing it does not move already-positioned text. Snapping is unavailable without valid text measurement and for animated text states; it does not clamp items to the frame.
- **Compound horizontal centering** — When enabled on the compound, child lines receive a shared horizontal shift so the **union** of their measured boxes is centered at **x = 0** (preview aligns with export when measure data exists).
- **Rasterized axes when available** — Once an axes item's Create animation has completed, the canvas draws the measure server's Manim-rendered axes PNG (`POST /api/preview_axes`: ticks, decimal numbers, axis labels, arrow tips) instead of the hand-drawn Konva axes. The Create animation itself, graph overlays, dragging, and the offline fallback all keep the existing vector preview; a stale cache (visual settings changed since the PNG was made) also falls back to vectors.

### Graph expressions (all expression editors)

- Every editor that types math shares one expression control: explicit **Preview (JavaScript)** + **Export (Python/NumPy)** boxes, a compact inline status row, and an **Open helper** modal. **Graph Plot** and inline-expression **Graph Area** sources use variable `x`; **Graph Curve** `x(t)`/`y(t)` and **Target Animation** parametric path offsets use `t`; **Graph Field** `P`/`Q` and slope use `x, y`; **Function Series** uses `n, x`; **Point Sequence** `x(n)`/`y(n)` uses `n`.
- The helper edits a draft with larger boxes, whole-formula **presets**, caret-aware **snippets**, variable chips for the active context, and a live status panel; **Apply** commits both boxes together, **Cancel** discards. Vector fields keep an extra whole-field preset row that sets `P` and `Q` together.
- Syntax checking is local and conservative (`src/lib/mathExpressionValidation.ts`): real JS compilation for preview, lint-only (never executed) checks for Python, unknown-name errors per dialect and variable context, and `^` as a warning with a one-click `**` fix. Persisted fields and exported Python are unchanged.

### Measure server

Optional HTTP backend (**`measure_server.py`** at repo root): **POST `/measure`** for geometry, ink metrics, RTL offsets, optional preview PNG, and styled segments. Same server exposes:

- **`POST /api/generate_audio`** — TTS + Whisper **word boundaries** (used when adding an audio clip from the Audio panel).
- **`POST /api/upload_audio`** — Mic / file upload, transcription, stored paths under `assets/audio/` for playback in the app.
- **`POST /api/chatgpt/login/start`**, **`GET /api/chatgpt/login/status`**, **`POST /api/chatgpt/refresh`**, **`POST /api/chatgpt/responses`** — the Copilot's *OpenAI via ChatGPT subscription* provider (`chatgpt_auth.py`): Codex OAuth sign-in with PKCE and a one-shot callback listener on `localhost:1455`, token refresh, and a forwarder to the ChatGPT Codex Responses backend (adds the Codex instructions, `store: false`, streams and returns the final response). Tokens go back to the browser; the server keeps them only in memory during a sign-in.
- **`POST /api/render_frame`** — One frame of a scene: `{ python_code, scene_name, time }` → low-quality Manim render, frame grabbed with ffmpeg, returns `{ png_base64, time, duration }` (times past the end give the last frame). Used by the Copilot's `render_manim_frame` tool.
- **`POST /api/render`** — Renders submitted full-scene Python with Manim. JSON body includes `python_code`, `quality` (`l`/`m`/`h`/`k`), `scene_name`, and optional **`is_web_export`** (default `false`), **`job_id`** (letters, digits, `_`, `-`) and **`expected_duration`** (scene seconds) for progress. Returns **`video/mp4`** or **`video/webm`**; the Export panel’s **Render MP4 / Render WebM** button calls this via `src/services/measureClient.ts` (`renderScene`).
- **`GET /api/render/progress?job_id=…`** — Progress of a render started with that `job_id`: `{ phase, percent, scene_time, duration, text_built, text_total }`. Manim runs through `manim_progress.py`, which reports each `HebrewMathLine` built and the scene time written; `render_progress.py` turns that into a percentage (text building fills the first 20 % when the scene has text, frames fill up to 94 %, then joining the parts, the audio mux and done). The Export panel's render buttons poll it and show the percentage with what Manim is doing.
- **`GET /health`** — `{"status":"ok"}` for liveness.

Configure the base URL in the app (default **`http://127.0.0.1:8765`**).

### AI Copilot

- Opens in the right-hand dock, sharing it with Properties: use the dock's **Properties / Copilot** switch or the header's **Copilot** button.
- Chat proposals (**CREATE** / **UPDATE** / **DELETE**) preview on canvas/timeline and apply only after **Approve**; details in `src/agent/ARCHITECTURE.md`.
- The Copilot is **frame-aware**: it sees the frame catalog plus the **active frame**, stamps new drawables with the active frame unless you name another valid frame, and rejects unknown `frameId`s (effect clips follow their targets and take no `frameId`).
- The Copilot speaks the same expression pairs as the editors: plot `fn`, curve `x(t)/y(t)`, series `f(n,x)`, point-sequence `x(n)/y(n)`, and path-mode target-animation offsets — always paired JS/Python with `**` power (stray `^` is repaired, a missing dialect derived), and partial updates never wipe sibling fields.
- **Tool loop (Anthropic, OpenAI, OpenAI-compatible)** — the Copilot works on a draft through tools instead of one reply: `propose_changes` (the whole draft is validated; errors go back to the model to fix), `inspect_scene` (scene length, camera view, each item's window and resolved position at chosen times, dot graph coordinates, connector ends), `check_export` (generates the Manim code and reports export errors), `reset_draft` and `finish`. At most 10 model calls per message. The draft shows live on the canvas while it works and the panel lists its steps; when it finishes, the changes apply as one undo step (Settings: *Apply finished changes right away*, on by default; off = Approve / Reject). *Check its own work* turns the loop off; Gemini keeps the single-reply mode. **OpenAI via ChatGPT subscription** (provider `chatgpt`) uses a ChatGPT plan instead of an API key, like OpenCode: **Sign in with ChatGPT** in Copilot settings (needs the measure server), tokens kept in localStorage and refreshed automatically; it always runs the tool loop. It relies on the Codex CLI's sign-in and backend, which are not a documented public API. It can also look: `snapshot_preview` crops the camera's view of the canvas at a chosen time (proposals drawn at full strength, editor grid hidden; the playhead returns afterwards and the seek is not an undo step), and `render_manim_frame` (when the measure server is on) renders a real Manim frame of the draft. Code: `src/agent/loop/`.
- The Copilot can attach dots to plots or curves, turn on live coordinates / guides, create **Move along graph** clips, and create **connector lines** (e.g. a vertical segment from a moving dot to the x-axis). Proposals are checked with the same graph-motion and connector resolvers the canvas and the exporter use; unknown effect modes, edits to kinds it may not create, and unknown fields are rejected or reported. Approving a proposal is one undo step.
- Camera proposals use ordinary `camera_move` clips. The Copilot resolves frame, region, or supported object-fit targets against the request-time snapshot, anchors “now” to the captured playhead, and previews destination, duration, full-frame return, and override timing before approval. Pending descriptors are normalized away; if the reviewed scene geometry or camera schedule changes before approval, the proposal is rejected atomically and must be regenerated. Ambiguous or unsupported bounds require clarification rather than a guessed zoom.

---

## Global audio timeline (narration)

Narration is **not** stored per line or per graph in the data model. Instead:

1. Use the **Audio** floating panel: **TTS** (script + language) or **record** → upload.
2. Clips live in **`audioItems`** with `startTime`, `duration`, `text`, `audioUrl`, and optional **word boundaries** (Whisper).

**Export alignment** — When generating Manim playback for a **text line** or **graph**, the codegen may resolve a **matching** `audioItems` entry by **timeline position** (start time proximity / overlap). If a match is found, export emits **`self.add_sound("assets/audio/…")`** and sets **`run_time`** from **word-boundary span** when boundaries are available; otherwise it falls back to the clip’s timeline duration. Gaps between scheduled events (including before an exit clip) are expressed with **`_wait_to(self, t)`**, a small helper that waits until the event's absolute timeline time. There is **no** `manim-voiceover` dependency: the exported scene subclasses Manim’s **`Scene`** and uses ordinary **`self.play`** / **`self.wait`**. For **early narration**, **post-play tails**, and **one file under many lines**, see [Export timing and audio synchronization](#export-timing-and-audio-synchronization).

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

**Camera zoom export** — `camera_move` items export through `MovingCameraScene` as absolute camera center/width poses; scene objects are not moved or scaled to imitate a zoom. `src/lib/camera.ts` supplies the same cubic ease-in/out and later-start interruption schedule used by preview. A newer clip starts at the previously scheduled camera pose sampled at its exact start using the interrupted clip's original duration; the older clip never resumes. A full-frame return is an independent authored clip targeting `FRAME_W` and remains scheduled after intervening zooms. Authored clip ends still determine scene length, even when a later camera command supersedes their visual influence. Concurrent object/camera clips use one camera writer in their `AnimationGroup`; a camera delay is retained inside that play, and interior unbound narration is emitted once with its relative `time_offset`. Partial export includes the camera helper and a `MovingCameraScene` precondition note. Delayed polyline/parametric target paths that overlap a camera cluster build their path at branch start from the target's then-current anchor.

**Graph-axis preview alignment** — Raster axes are drawn only when the preview response includes valid v1 origin/basis metadata; otherwise the canvas uses vector axes. The graph-coordinate origin and basis are mapped independently of the cropped all-ink PNG bounds. Camera viewport placement uses the same centered canvas coordinate basis as graph objects, so the identity camera adds no extra half-frame offset; direct graph dragging moves the graph content while the background grid stays fixed.

---

## Export timing and audio synchronization

This section documents how **editor timeline time** maps to **`self.play` / `self.wait` / `self.add_sound`** in exported Manim code, and summarizes the timing-related behavior implemented in codegen.

### Timeline primitives (`src/lib/time.ts`)

- **`effectiveStart(item, itemsMap)`** — Global start: for compound children, `compound.startTime + localStart`; otherwise `item.startTime`.
- **`runDuration` / `effectiveDuration` (text lines)** — Base clip duration plus **`segmentWaitTotal`** (sum of positive **`waitAfterSec`** on segments). Segment waits extend the line’s run segment and appear in export as **`Wait(...)`** inside a **`Succession`** (write/fade per segment).
- **`holdEnd(item, itemsMap)`** — `effectiveStart + runDuration`: end of the line’s **intro / hold** window on the timeline (before any separate **exit_animation** clip).
- **`textLineAnimOnlyDuration`** — Intro animation span **without** per-segment waits (used where waits are emitted separately in Python).

Export ordering uses these values so the **next clip’s** scheduled time can be compared to the **scene clock** the exporter maintains while emitting Python.

### Playback event stream (`src/codegen/manimExporter.ts`)

1. **Flatten** drawable leaves in timeline order (`flattenExportLeaves`).
2. Build **`playEvents`**: leaf starts, **visual clusters** (concurrent `AnimationGroup`), **audio** tracks that need an early or unbound `add_sound`, surrounding rects, exits — then **sort by `t`** (with a stable kind order so audio and visuals at the same timestamp behave predictably).
3. Walk events in groups of equal **`t`** (within **`TIMELINE_GAP_EPS` ≈ 1 ms).
4. For each group, emit **`_wait_to(self, t0)`** when the timeline jumps forward from **`timelineCursor`** to **`t0`**. `_wait_to` (module helper from `src/codegen/timelineWaitCodegen.ts`, emitted only when used) waits until an **absolute** scene time, snapped to whole frames. Manim rounds every `play`/`wait` to whole frames; relative waits let that rounding accumulate (measured +0.1 s by 18 s at 15 fps, audible because the mixdown places narration at exact timeline seconds), while absolute targets keep each group within one frame of its timeline time (exact at 60 fps when the time falls on a frame).
5. Emit **`add_sound`** lines, concurrent **`AnimationGroup`** blocks, sequential leaf plays, etc.
6. **`padAfter`** — After the group, compare **how much timeline span** this group is allowed to consume (capped by the **next** event’s `t`) with **how many seconds of Manim animation** were emitted; add **`_wait_to(self, t0 + animSec + padAfter)`** so the cursor stays consistent when **`add_sound`** (which does not advance Manim’s scene clock) or short animations would otherwise desync the next wait.

If **`sequentialAnimSecondsForLeaf`** (see below) does not match the **actual** waits and `run_time`s emitted for a leaf, **`timelineCursor`** drifts and later clips can appear **late** or **never align** with the editor playhead.

### Bound narration on visuals (`src/codegen/lineCodegen.ts`)

- **`pickAudioTrackForClip` / `findAudioTrackForLeaf`** — Chooses an **`audioItems`** track from explicit **`audioTrackId`** or from **timeline overlap** with the leaf’s `[effectiveStart, effectiveStart + duration]` window.
- **`resolveRecordedPlayback`** — **`run_time`** for `self.play` from **Whisper word boundaries** when they match the clip window; **`soundPath`** for `add_sound`; **`audioFileDuration`** from the track’s **`duration`** (full file length Manim plays from `add_sound`).

**Post-play audio tail** — After the visual animation, export may append **`self.wait`** so the **scene clock** catches up when the **spoken file** is longer than the boundary-derived **`run_time`**. Two notions:

- **`audioTailWaitSec`** — `max(0, audioFileDuration - runTime)` when sound is tied to the **same moment** as `add_sound` at the leaf.
- **`audioTailWaitAfterLeafPlayback`** — When the track is positioned on the timeline, tail is based on **absolute** **animation end** vs **absolute** **end of file on the timeline** (`track.startTime + audioFileDuration`), so early-started narration stays consistent with the clock.

**`sceneClockSecForLeafBoundPlayback`** — Seconds the exported leaf block should consume (**animation + tail**), used by **`sequentialAnimSecondsForLeaf`** (`groupPlaybackSpan.ts`) so **`manimExporter`**’s **`animSec`** matches codegen.

### Early-bound audio (narration starts before the visual clip)

If the chosen track’s **`startTime`** is **before** the leaf’s **`effectiveStart`**, the file must not wait until the line plays to call **`add_sound`**:

- **`listUnboundAudioTracksForExport`** — Emits **`add_sound`** at the track’s timeline time for tracks that are **unbound** or **bound but early** (deduped).
- **`boundSoundEmittedAtTrackStart`** — For those leaves, the sequential / concurrent leaf codegen **skips** a second **`add_sound`** and still appends the appropriate **tail** wait so the clock matches **`audioTailWaitAfterLeafPlayback`**.

Concurrent clusters (**`buildConcurrentVisualClusterPlay`**) skip per-leaf **`add_sound`** when the sound was already emitted at track start, and use the same tail logic in **`Succession`** branches.

### Tail ceiling (multiple lines, one long file)

A single uploaded track often spans **several** text lines. Waiting until **`track.startTime + file duration`** after **every** line would push the Manim scene clock **past** the next line’s **`effectiveStart`**. The exporter would then **omit** the `self.wait` needed to reach that start, so the **next** `Write` ran far too late (or seemed “missing” at editor time).

**Mitigation** — **`BoundAudioTailOpts.tailCeilingAbs`**: an **absolute** timeline time. **`audioTailWaitAfterLeafPlayback`** returns **`min(uncappedTail, max(0, tailCeilingAbs - animEnd))`**.

**`manimExporter`** sets **`tailCeilingAbs`** to **`nextTimelineEventAfter(holdEnd(leaf))`**: the earliest **`playEvents[].t`** strictly after this clip’s **hold end**. The same option is passed into **`sequentialAnimSecondsForLeaf`** for that leaf so **`timelineCursor` / `padAfter`** stay aligned with the shortened tail.

**Concurrent clusters** use a ceiling derived from **`nextTimelineEventAfter(clusterWallTimelineEnd)`**, where the wall is the max of participant **hold ends** / rect intro ends / exit spans.

### Concurrent visuals (`src/codegen/leafConcurrentCodegen.ts`)

Overlapping intro intervals (by **`holdEnd`**, not only **`effectiveStart`**) merge into one **`AnimationGroup`** with per-participant **`Succession(Wait(rel), …)`** stagger. **Adjacent** clips that only **touch** at an endpoint do **not** merge (**`MIN_INTERVAL_OVERLAP_SEC`**).

**Camera clips** use the resolved schedule from `src/lib/camera.ts`: export interpolates absolute center/width poses with the shared cubic easing and samples an interrupted clip at its original authored progress. Camera/object overlap uses one camera writer whose branch starts at the cluster time and evaluates camera segments at their authored relative times; its `run_time` is included in the same cluster wall-time calculation. Thus camera delays do not compress or postpone overlapping object animations. Later camera clips replace the earlier view without resumption, while separately authored full-frame returns remain at their original times. A **follow** clip (`follow.targetId`) adds the target's live centre to its segment: the pose eases from the source onto the target over `min(0.6 s, duration / 3)`, then tracks it; its destination (where later clips start) is the target's pose at the clip's end. The camera branch is emitted last in its group so it reads the target after it moved in the same frame. Authored camera ends still extend scene length even when visually overridden. Interior unbound audio starts are emitted before the blocking cluster with `time_offset` and are deduplicated from later event dispatch.

### Per-leaf duration accuracy

For the padding math to produce correct `self.wait` gaps, `sequentialAnimSecondsForLeaf` (`groupPlaybackSpan.ts`) must return exactly the number of Manim scene-clock seconds the emitted code block consumes. Key invariants:

| Leaf kind | No audio | With audio |
|-----------|----------|------------|
| `textLine` | `effectiveDuration` (anim + segment waits) | `sceneClockSecForLeafBoundPlayback` (includes boundary `run_time`, segment waits, and capped tail wait) |
| `axes`, `graphPlot`, `graphFunctionSeries` | `leaf.duration` | `sceneClockSecForLeafBoundPlayback` |
| `shape`, `image` | `Math.max(0.05, leaf.duration)` | `sceneClockSecForLeafBoundPlayback` |
| `graphDot` | `leaf.duration` (label written inside the clip) | `sceneClockSecForLeafBoundPlayback` |
| `graphField` | `leaf.duration + (seeds ? 1 : 0)` | `sceneClockSecForLeafBoundPlayback` (already includes the streams `Create` second — do **not** add it again) |

`graphDot` plays one intro group over its clip run time (`graphDotIntroParts` in `graphCodegen.ts`): `FadeIn` of the dot, live coordinate and projection guides plus `Write` of the fixed label, `lag_ratio=0`, in both the sequential and the concurrent path. The label used to be written for an extra 1 s after the clip; the canvas preview fades the same group in over the same run time (`graphDotIntroOpacity`).

### Tests

- **`src/codegen/manimExporter.overlap.test.ts`** — Overlap clustering, early **`add_sound`**, **tail ceiling** for two lines sharing one long track, segment **`waitAfterSec`**, audio tail when file longer than slice, etc.
- **`src/codegen/cameraCodegen.test.ts`** — Exact emitted camera helper/runtime, absolute widths, easing, malformed clips and partial-export prerequisites; **`manimExporter.overlap.test.ts`** covers cursor waits and camera/object/audio concurrency.

### Files to read first

| Area | Files |
|------|--------|
| Event ordering & cursor | `src/codegen/manimExporter.ts` |
| Text line + audio resolution + tails | `src/codegen/lineCodegen.ts` |
| Per-leaf duration for cursor | `src/codegen/groupPlaybackSpan.ts` |
| Concurrent `AnimationGroup` | `src/codegen/leafConcurrentCodegen.ts` |
| Camera schedule / pose export | `src/lib/camera.ts`, `src/codegen/cameraCodegen.ts` |
| Graph / shape bound audio | `src/codegen/graphCodegen.ts`, `src/codegen/shapeCodegen.ts` |
| Timeline math | `src/lib/time.ts` |

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

## Target animations (permanent effects)

A **`target_animation`** clip schedules a timed Manim `self.play` that leaves the **target** item(s) in a new steady state (scale, color, offset, path pose, rotation — depending on `mode`). The data model stores this on the **animation clip**; targets keep their own definitions and initial layout.

| Topic | Behavior |
|--------|----------|
| **Modes** | `scale`, `color`, `move`, `path`, `rotate`, and `graphFollow`. Each entry in `targets[]` has a `targetId` plus fields for that mode (`scaleFactor`, `color`, `dx`/`dy`, path data, `angleDeg`, or graph parameter destination/source). Text lines support segment-level targeting (`segmentIndices`, `mathSubtargets`) for color-like effects. |
| **`path` and path kinds** | **`polyline`** — `pathPoints` are **offsets from the anchor at clip start** (first point is often `(0,0)`). In the editor, you can **click the canvas** to append vertices while the clip is being edited. Export builds a corner polyline and uses **`MoveAlongPath`**. **`parametric`** — `parametricPath` holds **`jsXExpr` / `jsYExpr`** (preview, parameter `t`) and **`pyXExpr` / `pyYExpr`** (Manim export), **`tMin`**, **`tMax`**, optional **`samples`**. Preview evaluates the JS pair; export emits **`ParametricFunction`** (Python lambdas) plus **`MoveAlongPath`**, with the path anchored so motion matches the polyline normalization (offset from the first sample). |
| **Preview** | `src/lib/visualPlaybackPreview.ts` accumulates preview transforms; path segments interpolate polyline corners or sample the parametric curve. |
| **Codegen** | `src/codegen/targetAnimationCodegen.ts`; shares helpers with graph export where needed (`src/codegen/graphCodegen.ts`). |
| **Graph-follow timing/export** | `graphFollow` interpolates function x or attached parametric t using the clip easing, recomputes the point on the source, and moves the existing dot plus its enabled label/coordinate/guides. Chaining holds the previous destination across gaps. Each clip consumes `Math.max(0.01, duration)` scene-clock seconds; annotation updaters add no waits, so the existing per-leaf duration table is unchanged. Invalid references, off-curve free starts, invalid sampled intervals, and same-dot position-writer conflicts fail export with actionable diagnostics. |
| **Canvas** | `src/canvas/SceneCanvas.tsx` — polyline point-pick appends points relative to the target anchor; parametric mode does not use click-picking. |
| **Agent / validation** | `target_animation` is in **`AGENT_ALLOWED_KINDS`** (`src/agent/types.ts`). `validate.ts` enforces **eligible target kinds per mode** via `canBeTargetAnimationTargetKind` and normalizes with `normalizeTargetAnimation`. |

---

## Function series

A **`graphFunctionSeries`** item renders a family of curves parameterized by an integer `n` on an existing axes. It is the unified successor to the old sequence / partial-sum / series visualizers (legacy `graphSeriesViz` items are silently dropped on load — see `migrateSceneItems.ts`).

| Topic | Behavior |
|--------|----------|
| **Expression** | `jsExpr` (JavaScript, used for canvas preview and validation) and `pyExpr` (Python, embedded verbatim in the Manim export). Both evaluate a function of `n` and `x`. |
| **Range** | `nMin`, `nMax` integers; the set of curves is `n = nMin, nMin+1, …, nMax`. Empty or inverted ranges emit no playback. |
| **`displayMode`** | `'individual'` draws each `f_n(x)` as its own curve; `'partialSum'` draws the partial sums `S_k(x) = Σ_{n=nMin}^{k} f_n(x)` for `k = nMin…nMax` (computed incrementally, `O(N · samples)`). |
| **`mode`** (playback) | `'accumulation'` — each curve stays on screen as the next is drawn. `'replacement'` — only the **first** curve is ever on-screen; every subsequent shape is morphed into it in place via a `Transform` subclass (`_FSRevealTransform`). This guarantees exactly one on-scene mobject throughout the series and sidesteps the `AnimationGroup(Succession(...))` cleanup-timing pitfall that a chain of `ReplacementTransform(n_{k-1}, n_k)` would otherwise hit inside a concurrent cluster. |
| **Per-`n` styling (`perN`)** | Per-index overrides for `color`, `strokeWidth`, `lineStyle`, `animDuration`, `waitAfter`. A shared **defaults** block (“Apply to all” / עיצוב גורף) provides baseline values; individual overrides survive changes to `nMin` / `nMax` because `perN` is keyed by `n`. |
| **Timeline behavior** | Clip duration is the sum of per-`n` `animDuration + waitAfter` (last wait skipped); drag-to-scale on the clip scales all participating `animDuration`s proportionally. Bookmarks / ripple on `waitAfter` work as for ordinary clips. |
| **Validation** | `src/lib/functionSeriesValidation.ts` evaluates the JS expression on a sample grid for every `n` in range. In `partialSum` mode, sample points are tracked as **poisoned** once any `f_n(x)` at that `x` is non-finite, so later `S_k` values at that `x` are flagged too. Any validation error **locks global playback** until the expression is fixed. |
| **Preview** | `src/lib/functionSeriesPreview.ts` produces the Konva polyline segments for each `n` (honoring `displayMode`); the canvas layer (`canvas/layers/GraphNode.tsx`) renders only the curves visible at the current playhead. |
| **Export** | `src/codegen/functionSeriesCodegen.ts` emits a per-item builder function (one `VMobject` per `n`), an `axes_k_fs_<id> = VGroup()` registration for shared z-index / surround-rect use, and a playback block. Accumulation emits a sequence of `Create` + `Wait`. Replacement emits an initial `Create(n_1)` followed by `_FSRevealTransform(n_1, n_k)` hops that morph the first curve in place toward every subsequent shape (`n_2..n_last` exist only as transform *targets* and are pre-hidden with `set_stroke(opacity=0)` in the def — stroke-only, because `ParametricFunction.fill_opacity` defaults to `0` and `set_opacity` would render a filled area). The same pattern plugs into the concurrent-cluster codegen as a `Succession` branch. |
| **`_FSRevealTransform` helper class** | When any replacement-mode function series with ≥ 2 curves is exported, `manimExporter.ts` emits a small `class _FSRevealTransform(Transform)` at module scope (see `functionSeriesRevealTransformSource` and `anyReplacementFunctionSeries` in `functionSeriesCodegen.ts`). Its `begin()` temporarily reveals the target's stroke so `Transform.begin()`'s `target_copy` snapshot drives the morph toward a visible curve, then re-hides the real target mobject. No `clean_up_from_scene` override is needed — using plain `Transform` (not `ReplacementTransform`) keeps the source `n_1` on the scene naturally, so no `scene.replace(...)` cleanup has to fire between `Succession` children. |
| **Exit animation** | `exit_animation` clips targeting a replacement-mode function series resolve to the **first** curve (`n_1`) — the only mobject that is ever visually on-screen throughout the series — not the parent `VGroup`. Feeding the `VGroup` to `FadeOut` / `Uncreate` / `ShrinkToCenter` would flash every other `n_k` onto the screen for the duration of the exit play. Accumulation-mode exits still target the parent `VGroup`. `SurroundingRectangle` targets keep the `VGroup` in both modes so the rect spans every curve's bbox. See the `'exit'` branch of `resolveExitTargetsForExport` in `src/codegen/graphCodegen.ts`. |

**Files to read first**

| Area | Files |
|------|--------|
| Model + totals | `src/types/scene.ts` (`GraphFunctionSeriesItem`, `functionSeriesIndices`, `functionSeriesTotalDuration`) |
| Editor UI | `src/panels/FunctionSeriesEditor.tsx`, `src/panels/FunctionSeriesIndividualPanel.tsx` |
| Validation | `src/lib/functionSeriesValidation.ts`, `src/lib/functionSeriesValidation.test.ts` |
| Canvas preview | `src/lib/functionSeriesPreview.ts`, `src/canvas/layers/GraphNode.tsx` |
| Manim codegen | `src/codegen/functionSeriesCodegen.ts`, `src/codegen/functionSeriesCodegen.test.ts` |

---

## Project file format

- JSON containing **`version`** (see **`PROJECT_VERSION`** in `src/lib/constants.ts`), **`savedAt`**, **`defaults`**, **`items`**, **`measureConfig`**, and optionally **`audioItems`**.
- Text lines may include optional **`snapBuffer`** (Manim units, default `0.3`); older files without it keep the default on read. This is an editor drag preference, not a positioning constraint and it does not affect Manim export.
- Text lines may include optional **`baseDir`** (`'ltr'`; absent = right-to-left) and **`englishFont`** (absent = same as `font`; `Latin Modern Roman` = LaTeX default). Older files read as before, so there is no version bump.
- Bump **`PROJECT_VERSION`** when you make breaking schema changes and consider adding migration logic in **`loadProjectFile`** if needed.
- **Version 10** — Removes per-item `waitAfter`, `exitAnimStyle`, and `exitRunTime`. Legacy projects with `version` below 10 are migrated on load: non-`none` exits become **`exit_animation`** items (start time = old hold + wait + exit offset as before), then legacy fields are stripped (`migrateProjectToV10.ts`). Very old monolithic **`graph`** items are still split in **`migrateSceneItems.ts`** before that step.
- **Version 41** — Adds the **`image`** scene item kind (still pictures: `srcUrl`, `assetRelPath?`, `fileName`, `mimeType`, `width`, `height`, `opacity`, `rotationDeg`); `PosStepNextTo.refKind` gains **`image`**. Migration is a pass-through (`migrateProjectToV41.ts`); older files load unchanged.
- **Version 44** — Graph dots may persist `attachment: {kind:'free'}` (legacy `dx/dy`), `{kind:'function', graphPlotId, x}`, or `{kind:'parametric', graphCurveId, t}`. V44 also adds optional independent label/coordinate presentation fields (`labelFontSize`, `labelColor`, `labelSpacing`, `coordinateFontSize`, `coordinateColor`, `coordinateDir`, `coordinateSpacing`, `coordinatePrecision`) and annotation toggles (`showCoordinates`, `showProjectionGuides`). Migration preserves V43 graph-follow rows and backfills free attachments/style defaults. Graph-follow targets use `targetX` for function/free-function motion or `targetT` for parametric-attached motion, with optional `graphPlotId`/legacy `graphCurveId` references and `easing` (`linear` or `smooth`; missing legacy easing defaults to smooth).
- Import / export helpers live in **`src/lib/projectIO.ts`**.

### Portable bundle (`.mtproj`)

For **cross-machine portability** (especially **timeline audio**), use **Save bundle (.mtproj)** in the header. You can still **open** plain `.json` projects from disk, but **`audioItems`** in JSON usually contain **`blob:`** URLs that **only work in the same browser session**, so only the bundle format is reliable for moving narration to another machine.

A **`.mtproj`** file is a **ZIP** archive with:

| Entry | Purpose |
|--------|---------|
| **`state.json`** | Same logical document as the JSON project: `version`, `savedAt`, `defaults`, `items`, `measureConfig`, optional `audioItems`. While saving a bundle, each track’s `audioUrl` is rewritten to a **relative path** under `assets/` (e.g. `assets/audio/foo.webm`) and **`assetRelPath`** is set to that path so **Manim export** keeps stable `self.add_sound("assets/audio/…")` lines after you reopen the bundle. |
| **`assets/audio/*`** | Raw bytes for each embedded clip (fetched from the current `blob:` or `http(s):` URL at save time). |
| **`assets/textures/*`** | Raw bytes for each **image** item (PNG/JPG/GIF; fetched from the current `blob:` or `http(s):` URL at save time, rewritten to `assetRelPath`). |
| **`manifest.json`** | **`bundleFormatVersion`** (currently `1`) and an **`assets`** map: *zip-relative path* → **MD5** (lowercase hex) of the file bytes. On open, every listed file is checked; a mismatch fails load with an explicit **corrupt or altered** error. |

**Save failures** — If the app cannot `fetch` an audio URL (offline, **CORS** on a third-party host, etc.), **Save bundle** aborts and lists the affected tracks. Same-origin clips served by the **measure server** typically embed successfully.

**Implementation** — Packing and unpacking: **`src/lib/mtprojBundle.ts`** (ZIP via **`fflate`**, MD5 via **`spark-md5`**). Shared Manim/bundle path rules: **`src/lib/audioAssetPath.ts`**, **`src/lib/imageAssetPath.ts`**.

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
│   ├── targetAnimationCodegen.ts  # Permanent target effects (path / parametric / …)
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

Vite excludes `src-tauri/` from its frontend watcher to avoid Windows `EBUSY` errors on Rust build artifacts; Tauri watches Rust sources independently.

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

*Last updated: **Geometry marks** — angle marks and equal-length ticks that stay attached to their points. A polyline can become an *angle mark* (Base → *Make an angle mark…*, `shape.angle`): the angle at a vertex between two other points (graph dots, objects, points on axes or fixed points), drawn as an arc of a set radius or, at 90°, a right-angle square (or forced either way); the panel shows the angle in degrees. Connector lines get *Equal-length ticks* (1–3 across the middle, `endpoints.ticks`). Both are redrawn every frame like connectors, in preview and export (`resolveAngleMark` / `tickSegments` in `src/lib/shapeAnchors.ts` and matching Python helpers); a ticked connector exports as a fixed line-and-ticks group redrawn part by part. Deleting what a mark follows leaves it where it was. Both fields are optional. The Copilot can build constructions (recipe: points as small circles with names, sides as connectors, marks), and `inspect_scene` reports angles in degrees and a spot for the angle's name. Earlier: **Riemann sums** — a graph area can be a Riemann sum (Area type → *Riemann sum*, `areaKind: "riemann"`): equal rectangles under a curve (a plot or an expression) on an interval, height from the left end, midpoint or right end, for a list of n such as 4, 8, 16, 32. The clip is split evenly: the first n fades in, then each next n morphs out of the last (every rectangle splits into its smaller ones); the Properties panel lists each n's sum. Export draws the rectangles with a small `_riemann_rects` helper (the same rectangles as `src/lib/riemann.ts`; Manim's `get_riemann_rectangles` can add an extra one from float steps) and morphs one mobject with `Transform`s, so only the current n is ever on screen. Older projects are unchanged. The Copilot can create them (recipe) and `inspect_scene` reports each n's sum, the integral and which n shows at a time. Earlier: **Camera follows a point** — a camera clip can follow a moving graph dot or object (camera clip Properties → *Follow*, `follow.targetId`): it eases onto it over at most 0.6 s, keeps it centred at the clip's width (offsets shift the view) until the clip ends, and stays there; later camera clips start from that spot. Preview and export read the same position (`resolveShapeAnchor`); the export passes the target's live centre to `_CameraPoseAnimation`, and puts the camera last in an overlapping group so it uses the target's position from the same frame. A follow that starts before its target appears is flagged. The field is optional; other camera clips are unchanged. The Copilot can ask for `targetMode: "follow"` (recipe for a point travelling across a wide graph). Earlier: **Traced paths** — a graph dot can leave a trail as it moves (dot Properties → Style → *Trail*, `dot.trace`): the whole path, or only the last few seconds fading towards the tail (*Fade after*), in its own colour and width. Export uses Manim's `TracedPath` for a whole path and a small `_FadingTrail` (a fixed set of short segments, each faded by age) for a fading one, because `TracedPath`'s opacity gradient runs across the screen instead of along a curved path; the preview samples the dot's motion the same way (`src/lib/graphDotTrail.ts`). Exit fixes: when a dot exits, its live coordinates, projection guides and trail now leave with it (they stayed on screen in export), and *Uncreate* / *Shrink to center* animate every part (only the first part did, so a dot's label stayed). The field is optional. The Copilot can add trails (recipe for Lissajous figures and orbits) and `inspect_scene` reports where a trail starts and how long it is. Earlier: **Live values** — a dot's live label can show any text with values in it instead of "(x, y)": *Live label text* in the dot's Labels & coordinates panel (`dot.valueTemplate`), e.g. `f(x) = {y}` or `\text{slope} = {slope}`. `{x}`, `{y}` and `{slope}` (dy/dx of the plot the dot is on or follows, the same numerical slope as tangents) are filled in every frame; the fixed text is typeset once as math (as written when it has `$` or Hebrew), and the numbers still come from the cached glyphs, so there is no TeX while playing (`src/lib/graphLiveValue.ts`). Fixes for every live label: a moving dot's label no longer leaves a copy of its first value behind during the motion in export (Manim kept drawing the swapped-out glyphs), and values that round to zero show "0.00" instead of "-0.00" in preview and export. The field is optional; labels without it are unchanged. The Copilot can set it and `inspect_scene` reports the label text. Earlier: **Tangents that ride along, and secants** — a connector line can now be the tangent at a graph dot (a segment of a set length centred on the dot, turning with the plot's slope every frame as the dot moves) or the line through its two ends lengthened past both (a secant through two dots): *Line* in Properties → Connector ends, `endpoints.tangent` / `endpoints.extend`. Preview and export compute the slope the same way (`src/lib/shapeAnchors.ts`, the connector updater in `src/codegen/shapeCodegen.ts`). Both fields are optional; existing connectors are unchanged. The Copilot can create both (recipes for a riding tangent and for a secant turning into the tangent); `inspect_scene` reports a tangent's slope. Earlier: **Shaded areas sweep or rise in** — a graph area has an *Entrance* (Properties → Style / Animation): fade in (default, as before), sweep left → right, sweep right → left, or rise from the axis (from the lower curve for an area between curves). Sweeps and rise are continuous: the export emits a small `_AreaReveal` animation that redraws the area's outline every frame from its boundary functions and ends on the exact `get_area` shape; the preview draws the same part of the area (`src/lib/graphAreaReveal.ts`) and now also fades areas in like the export. Same run time as the fade, so timing is unchanged. Parallelograms and disks keep the fade. The field is optional (`introStyle`); older projects fade as before. The Copilot can set it. Earlier: **Copilot: retime and make room** — the Copilot can insert empty time, remove an empty range, or make a stretch of the timeline slower or faster (new `TIMELINE` action); later clips and the narration move along, exactly as with *Insert or remove time…*, and edits the editor would refuse (a clip across the point or an edge, narration inside a stretched range) are refused with the clips in the way named. Stretching a range is new (`scaleTimelineRange` in the store, `planScaleRange` in `src/lib/timelineSurgery.ts`): clips inside scale their durations, segment times and per-curve timings; it is not in the dialog yet. Earlier: **Copilot: timing to the narration** — the Copilot now sees the narration (each track's text and its words with scene times) and can start clips on spoken words; in the tool loop a new `find_words` tool finds a word or phrase (Hebrew prefixes such as ב/ה/ש are matched) and `inspect_scene` shows what is spoken during each clip. Script to Timeline may now create areas and fields when the script gives exact functions. Earlier: **Copilot: equation steps** — the Copilot can make a text line enter by morphing an earlier one (`animStyle: "transform"` with pairs of segments from the old line to the new one), checked against both lines' segments and the timing; `inspect_scene` lists what moves where and treats the old line as gone once it has morphed. A recipe solves an equation step by step, with `{}` padding so split formulas keep their spacing. Earlier: **Copilot: shaded areas and fields** — the Copilot can create and edit shaded areas (under a curve, between curves, parallelograms, disks) and vector / slope fields with stream lines. It checks the interval against the plot's domain and axes, that expressions use only x (and y), the arrow count and the stream seeds; `inspect_scene` reports an area's value (the integral) and a spot for its label, and where each stream line ends. Recipes for an area labelled as an integral and for a slope field with a solution through a point. Earlier: **Copilot lessons: convergence, slides, terms, camera beats** — four new recipes teach the Copilot convergence stories with function series (Taylor / Fourier partial sums, replacement vs all at once, factorials, pace), lesson slides (title at the top, lines stacked under it, right-aligned for Hebrew, each starting when the previous one ends), pointing at one term of a formula (own segment, colour / pulse / box; a split formula inside a Hebrew line goes in `\en{…}` so its pieces keep their order) and camera beats (zoom to where the action is at that moment, return to the full frame, no overlapping camera clips). In the tool loop the Copilot may now create a text line and style it in the same draft, `inspect_scene` measures new text with the measure server and reports text that overlaps or leaves the camera, segment indices, when each curve of a series draws and where each camera clip ends, and a segment index the line does not have is rejected. Earlier: **Render progress in percent** — Render and Render all show real progress: the measure server counts the text objects Manim builds and the scene time it has written (`GET /api/render/progress`), so the bar moves with the render instead of pulsing. The render debug copy is now `render_debug/last_render.py.txt` so `uvicorn --reload` no longer restarts mid-render. Earlier: **ChatGPT sign-in fixes** — in the desktop app the sign-in page opens in the default browser (the link is also shown to copy); the panel lists the models your plan offers (`GET /api/chatgpt/models`) and switches away from one it does not; Codex instructions come from the current model list. Earlier: **OpenAI via ChatGPT subscription** — a new Copilot provider signs in with a ChatGPT plan (Codex OAuth, like OpenCode) through new measure-server endpoints and runs the tool loop on the ChatGPT Codex backend; no API key needed. Earlier: **Copilot recipes** — the Copilot's instructions now include worked patterns for multi-part requests (graph sized to the frame; point moving along a graph with a drop line; live values; arrows from text to moving things; emphasise then remove; sequencing; and, in the tool loop, checking before finishing) in `src/agent/recipes.ts`. Earlier: **Copilot can look at its work** — new tools `snapshot_preview` (camera view of the canvas at a time) and `render_manim_frame` (one real Manim frame via the new measure-server endpoint `POST /api/render_frame`); images go to the model with the tool results. Earlier: **Copilot tool loop** — on Anthropic and OpenAI(-compatible) providers the Copilot drafts its changes through tools (propose, inspect exact positions and timings, check the export, fix, finish) instead of answering once; validation and export errors go back to it, the draft is shown live on the canvas with a step list, and the finished result applies as one undo step (or waits for Approve when *Apply finished changes right away* is off). Earlier: **Copilot: graph motion and connector lines** — new connector lines: a line or arrow whose ends follow a graph dot, the dot's foot on an axis, a point on axes or another object, redrawn every frame in preview and export (no project version change; `endpoints` is optional). The Copilot can now attach dots, add live coordinates, create Move-along-graph clips and connectors, and its proposals are checked against the graph-motion resolver; it rejects unknown effect modes instead of turning them into a scale, refuses edits to kinds it may not create, reports unknown fields, keeps Anthropic thinking working (no forced tool with thinking), uses current default models, and an approved proposal is one undo step. Earlier: **Insert rail with category flyouts** — the Insert rail shrinks from 27 buttons to 7: Text line, Shape and Image insert directly, and Graph, Animate, Camera and Audio open a labelled flyout (pin it to keep it open; Escape or an outside click closes it). Groups follow what you are doing: Axes lead the Graph group, Animate splits into Change / Emphasize / Leave (Surrounding rect sits with Blink), camera tools have their own group (Pan, Zoom to region, Fit object, Full frame) and Audio joins the rail. New icon set with one stroke weight and a shared grammar (dashed start, solid end for animations; graph parts on an axis line; viewfinder corners for camera). The labelled sidebar lists the same groups. **Animate bar on the stage**: selecting an object shows a small bar above it with only the animations it accepts plus Fit camera (graph parts anchor to their axes); it hides while playing, dragging or capturing a camera region. **Insert search**: press `/` (or the magnifier on the rail) to find any insert action by name or everyday word ("fade" finds Exit, "voice" finds Text-to-speech); the physical slash key works on a Hebrew layout too. Rail, flyouts, bar and search all read one action list (`src/panels/insertActions.ts`) and one selection check (`src/panels/useInsertActionState.ts`). Project format and export are unchanged. Earlier: **Segment settings follow their text** — editing a text line's source (typing, the direction switch, the wrap fix, or a Copilot UPDATE) now matches old segments to new ones: unchanged text first, then `||` splits and merges by character position, then retyped segments in place or by similarity. Colour, bold, italic, anim time and waits move with their segment (split pieces all take the style; the wait goes after the last piece), and every segment reference in the scene is remapped in the same undo step; references to a removed segment fall back to the whole line. One store action, `setTextLineSource` (`src/lib/segmentReconcile.ts`, `src/lib/remapSegmentRefs.ts`); no project format or export change. Earlier: **English text and left-to-right lines** — `\en{…}` marks English inside a Hebrew line; its segments (math and `||` splits included) write left to right and stay in reading order because Python typesets each run as one `\textenglish` group. A line can switch to an English base (`baseDir: 'ltr'`, Hebrew in `\he{…}`) and set an English font (default: the Hebrew font). The Properties panel has the direction switch, the English font field and a warning with a one-click wrap for unwrapped text in the other script; the canvas reveals English left to right. The segment parser moved to `src/lib/textSegments.ts` (fixture `src/lib/__fixtures__/segmentParse.json`); Copilot schemas carry `baseDir` / `englishFont`. Lines without English export and measure exactly as before. Earlier: **Text segments in typed order** — `HebrewMathLine` no longer re-sorts its segments by screen position, so `line[i]` is always the i-th segment as typed; ordinary Hebrew + math lines export unchanged, while lines with blank `||` pieces (e.g. `… || $f(x)$ || …`) now colour and animate the intended segment in export (the preview already did). The measure server builds the line from the exact parts the exporter emits, and `\$` stays a literal dollar. The editor parser and the Python label parser share `src/codegen/__fixtures__/segmentParse.json`. Project format unchanged. Earlier: **Graph-dot intro inside its clip** — a labelled dot no longer writes its label for an extra second after the clip: dot, coordinates, guides and label come in together over the clip's run time in export, and the preview fades them in over the same window instead of popping them in. Earlier: **Absolute timeline waits in export** — the playback section reaches each timeline event with `_wait_to(self, t)` (wait until an absolute scene time, frame-snapped) instead of relative `self.wait(Δ)`, so Manim’s per-animation frame rounding no longer accumulates and picture stays on the timeline-placed mixdown audio. Leaf-internal waits (segment pauses, audio tails) stay relative; project format and preview are unchanged. Earlier: **Chalkboard editor theme** — the editor UI moves to one design system (tokens in `src/index.css` `@theme`, mirrored for Konva in `src/lib/theme.ts`, primitives in `src/components/ui`, rules in `.agents/skills/ui-design-system`). Layout changes: one header row with scene tabs; the Insert toolbar defaults to an icon rail (labelled sidebar behind its chevron); Properties is docked right of the stage and shares the dock with the Copilot; the Manim class field moved into Export; timeline clips use Manim kind colors and “Timeline edit…” is now “Insert or remove time…”. Project format and export are unchanged. Earlier: **Graph-follow export and aligned graph preview** — graph dots can attach to functions or parametric curves, move with chained x/t clips, and export styled fixed/live annotations and projection guides with cached `HebrewMathLine` glyphs; invalid starts/intervals/conflicts remain actionable errors. Axes raster overlays use server origin/basis metadata, and identity camera placement no longer adds a half-frame offset. **Project format v44** records dot attachments and independent label/coordinate settings. Copilot graph-follow authoring remains deferred. Earlier: **Copilot camera proposals** — the assistant can propose snapshot-based frame, region, and supported object-fit camera clips, preview timing/overrides, and reject stale proposals before approval; ambiguous targets require clarification. Earlier: **Camera zoom export** — camera playback now consumes the shared absolute center/width interruption schedule with cubic easing, concurrent single-writer clusters, preserved authored returns and scene tails, and matching partial-export helpers.
Earlier: **Windows desktop startup watcher** — Vite now ignores `src-tauri/` to avoid `EBUSY` when watching locked Rust build artifacts; Tauri retains its own Rust watcher.
Earlier: **Measured text snapping** — canvas text dragging can snap measured ink to same-frame object/frame edges with a uniform 0.3-unit default, an Alt bypass, and a per-line snap-gap control; snapped positions remain ordinary coordinates, not attachments.
Earlier: **Image Konva fade-in preview** — canvas images now fade in over their clip duration with Manim-smooth `FadeIn` pacing (`imageIntroOpacity`), composing with exit fades; export and project shape unchanged.
Earlier: **Image export for live images** — the Export panel now inlines newly imported `blob:`/`http(s):` images as export-only `data:` URLs (`src/lib/imageExportAssets.ts`), so fresh images export/render immediately without a save/reopen `.mtproj` round trip; unbundled raw URLs are still rejected by codegen.
Earlier: **Image objects (codegen)** — `image` leaves now export as Manim `ImageMobject` with deterministic `assets/textures/*` paths (or data-URL fallback), exact width/height/opacity/rotation/positioning, FadeIn/static-add playback, audio timing, concurrent clustering, exits, blink-scale, surrounding rectangles, and move/path/scale/rotate target animations.
Earlier: **Image objects (editor)** — new `image` scene item (PNG/JPG/GIF-as-still import, canvas drag/resize/rotate/opacity, `.mtproj assets/textures/*` bundling, project v41).*
