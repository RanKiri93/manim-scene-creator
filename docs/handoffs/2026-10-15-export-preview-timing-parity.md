---
slug: export-preview-timing-parity
created: 2026-10-15
status: implementing
owner_role: codegen-dev
next_tool: any
source: user request; step 2 of docs/handoffs/2026-10-15-preview-export-fidelity.md
---

<!--
Copy this file to docs/handoffs/<created>-<slug>.md.
Each role appends ONLY its own section. Never edit a section written by an earlier role;
add a dated note under your own section instead. Update the frontmatter `status`,
`owner_role`, and `next_tool` when you hand off.
-->

## Plan (architect)

### Goal
Each clip animates during the same window in the canvas preview and in the rendered video,
and a mismatch is caught mechanically instead of by eye. Step 1 (absolute waits, 2569e0f)
made the video follow the timeline clock. This step makes each clip's own animation span match.

Sub-steps, in order; report findings to the user after 2b before fixing anything that needs a
product decision:

- **2a. Graph-dot intro inside its clip (user decision 2026-10-15).** Today export plays
  `FadeIn(dot)` for the clip duration, then `Write(label)` for an extra 1 s past the clip end.
  When the dot plays on its own, the coordinate label and guides are added instantly
  afterwards; when it overlaps other clips, they fade in. The preview pops the dot, label,
  coordinates and guides in at full opacity at the clip start. New rule, matching
  `surroundingRect`: one `AnimationGroup(FadeIn(dot), FadeIn(coord?), FadeIn(guides?),
  Write(label?), lag_ratio=0)` over the clip's run time, in both the sequential and the
  concurrent path. The preview fades all parts in over the same run time with Manim `smooth`
  easing.
- **2b. Parity sweep.** Fixture scenes covering every leaf kind and clip kind (with and
  without bound audio, sequential and overlapping) → real exporter → Manim run with
  instrumented `Scene.play` (dry run where possible) → compare each clip's actual animation
  window with the window the preview uses (`effectiveStart`, `previewRunTime`, segment waits,
  exit/blink/target/camera durations). Output: a table of mismatches.
- **2c. Fix mismatches** found in 2b (each its own small change; product calls go to the
  user first). Decide then whether the sweep becomes a permanent verifier tool and whether
  the preview should read clip windows from one `src/lib` function instead of per-kind code.

### Non-goals
- No change to the cursor/`_wait_to` model from step 1.
- Animation *look* (Write vs. crop wipe, Create by arc length) and audio playback are steps
  3 and later, not here.
- `graphField` streams' extra 1 s `Create` has the same pattern as the old dot label; it is
  out of scope for 2a unless the user extends the decision (raise it with the 2b findings).

### Touched files (2a)
- `codegen/graphCodegen.ts`: `generateGraphDotPlay` intro group inside run time.
- `codegen/leafConcurrentCodegen.ts`: graphDot branch, label inside the intro group.
- `codegen/groupPlaybackSpan.ts`, `codegen/lineCodegen.ts` (`sceneAnimEndForBoundAudioTail`):
  drop the label's extra second.
- `lib/visualPlaybackPreview.ts`: shared fade-in intro opacity for images and graph dots.
- `canvas/layers/GraphNode.tsx`: apply the dot intro opacity to dot, label, coordinates, guides.
- Tests: `manimExporter.overlap.test.ts`, graph codegen tests, `visualPlaybackPreview.test.ts`.
- Docs: README per-leaf duration table + trailer; skill `codegen-invariants` table.

### Invariants at risk
- `sequentialAnimSecondsForLeaf` must equal emitted seconds: the graphDot row loses its
  `+1` in both the no-audio and bound-audio (`sceneAnimEndForBoundAudioTail`) paths.
- Bound-audio tail math for dots (tail now starts at `t0 + runTime`).
- Static add (`visibleAtSceneStart`) dots unchanged.

### Test plan
- `npx vitest run src/codegen src/lib`, then `npm run test`, `npm run build`, lint on touched
  files.
- Codegen: assert the exact dot intro group and the waits after a labelled dot (no `+1`), in
  both paths, with and without bound audio.
- Preview: dot intro opacity is 0 before start, eased mid-way, 1 after the run time.
- Real render of a labelled dot (scratch probe) to confirm the window.

### Open questions
None for 2a. Product questions from 2b go to the user with the findings.

## Implementation notes (codegen-dev)

### 2a — graph-dot intro inside its clip
- `codegen/graphCodegen.ts`: new `graphDotIntroParts(dVar, dot, kwargs)` (FadeIn dot,
  FadeIn coord?, FadeIn guides?, Write label?). `generateGraphDotPlay` plays them as one
  `AnimationGroup(..., lag_ratio=0)` with the clip run time. Previously it was a separate
  `self.play(Write(lbl))` (Manim's 1 s default) followed by an instant `self.add(coord/guides)`.
- `codegen/leafConcurrentCodegen.ts`: graphDot branch uses the same parts, each with the
  clip `run_time`; the trailing `Write(lbl, run_time=1)` is gone. `leafInterval` is
  unchanged: for a dot it now equals the clip, plus the audio tail when audio is bound,
  which the branch still waits for.
- `codegen/groupPlaybackSpan.ts` (graphDot → `clock ?? leaf.duration`) and
  `codegen/lineCodegen.ts` (`sceneAnimEndForBoundAudioTail` drops the dot's extra second).
- `lib/visualPlaybackPreview.ts`: `graphDotIntroOpacity` and the existing
  `imageIntroOpacity` share one Manim-smooth fade over `previewRunTime`.
  `canvas/layers/GraphNode.tsx` applies it to the dot group (dot, label, coordinates,
  guides).
- Tests:
  - "labelled dot + early graphFollow share a cluster" now uses a follow at 0.2 s, because
    the 0.8 s case only overlapped through the old label second; it asserts the exact
    group and `run_time=1.2000`.
  - New: dot on its own (label inside, no instant `self.add`, `_wait_to(self, 0.8000)`).
  - New: dot with bound audio (tail 2 s, previously 1 s).
  - New: `graphDotIntroOpacity` tests.
- Real render (`-qh`, scratch probe): dot `FadeIn` and label `Write` both span
  6.8–7.4 s, the clip window. Before, the label ran 7.45–8.47 s.
- Gates: `npx vitest run src/codegen src/lib` 449/449; `npm run test` 74 files / 609
  tests; `npm run build` pass; eslint clean on the 8 touched TS/TSX files.
- Preview side effect, consistent with images and text: at exactly the clip start the dot
  is at opacity 0, so a dot created at the playhead is invisible until the playhead moves.

### 2b — parity sweep findings (2026-10-15)
Method (scratchpad `sweep/`, not committed):
- Three fixture scenes go through the real exporter: SweepSeq (every kind in its own slot),
  SweepConc (overlapping clips) and SweepAudio (bound, early and shared narration).
- `manim render --dry_run` runs with instrumented `Scene.play`/`add_sound`. Dry run
  advances the clock by exact run times, so there is no frame rounding.
- The measured windows are compared with the preview's timing model, catalogued per kind
  with file:line references.

**Export bugs (export disagrees with its own timeline; no product decision needed):**
- E1 (high): inside overlapping clusters, four branches put `run_time=` on the whole
  `Succession(Wait(rel), …)`, and Manim's `AnimationGroup.interpolate` rescales the
  lead-in wait too:
  - shape without audio: `concurrentBranchForLeaf` shape path
  - surrounding rect: `concurrentBranchForSurroundingRect`
  - exit clip
  - blink clip

  So any of these that starts after its cluster starts plays early. Measured in
  SweepConc:

  | Clip | Timeline | Video |
  |---|---|---|
  | shape | 1.60 s | 0.55 s |
  | blink | 4.20 s | 3.66 s |
  | exit | 5.40 s | 3.96 s |
  | surrounding rect | 5.60 s | 3.81 s |

  Fix: put the run time on the inner animation group, not on the Succession.
- E2 (medium): when one narration file is bound to a leaf at its start and is also the
  early-bound track of a later leaf, `add_sound` is emitted twice at the same time
  (SweepAudio: `s4.wav` twice at 8.0 s). Inaudible when the mixdown replaces Manim's audio
  (default 40 ms cut fades). Doubled audio otherwise.
- E3 (decision): `graphField` with stream seeds plays `Create(streams)` for Manim's default
  1 s after the clip, the same pattern the dot label had before 2a.

**Preview does not follow export timing (from the per-kind catalogue):**
- P1: axes, graphPlot and graphCurve Create use `runDuration`, so they ignore bound-audio
  run time, which export uses. Their progress is linear; Manim's Create uses `smooth`.
- P2: image is missing from `isExportLeafWithAudio`, so its fade ignores bound-audio run
  time (`imageCodegen` uses it).
- P3: shape has no intro (pops in), and `introStyle` is ignored. Export runs Create/FadeIn
  over the run time.
- P4: graphArea has no intro. Export creates the boundary plots, then FadeIn of the fill.
- P5: graphField has no timing at all (arrows and streamlines are static). Export Creates
  the field, then the streams.
- P6: surroundingRect has no intro, and its label is never drawn in the preview.
- P7: the text-transform source hides at `target.start + duration`, which ignores audio,
  while the transform window itself is audio-aware.
- P8: smaller approximations:
  - uncreate is shown as fade+shrink
  - blink color is not shown on image, axes or graph children
  - target scale is not shown on graph children
  - target color is shown only on shapes and surrounding rects
  - function-series Create and point-sequence fades are linear
- Matching already: text segment windows (audio-aware), graph dot (after 2a), function
  series / point sequence per-n windows, exit/blink/target/camera clip windows, graphFollow.

**User decisions (2026-10-15), all as recommended:**
- Commit 2a now.
- E3: field streams fit inside the field's clip, like the dot label.
- A selected graph dot shows a faint outline ring while paused, so a dot at opacity 0 (at
  its clip start) can still be found.
- The sweep becomes a permanent verifier tool.
- 2c order: E1, E2, then preview gaps from most to least visible (shape, axes/plot/curve
  audio + easing, surrounding rect, area, field).

### 2c, part 1: export fixes and the permanent timing sweep
- **E1:** `leafConcurrentCodegen.ts` gains `delayedTimedBranch(wStr, inner, rt)` →
  `Succession(Wait(w), Succession(inner, run_time=rt))`. It is used by shape (no audio),
  surrounding rect, exit, blink and target-animation branches; the last includes
  graphFollow, which the sweep also measured early (3.8–4.7 s vs. 3.9–5.1 s). Four
  overlap-test assertions encoded the old form and were updated. New test: delayed exit,
  blink and target branches.
- **E2:** `lineCodegen.ts`: a track bound to more than one leaf is added by the event stream
  at its own start (`listUnboundAudioTracksForExport`), and
  `boundSoundEmittedAtTrackStart` then returns true for every leaf on it. All codegen
  callers go through that function. New test: one file under a shape and a later line is
  added once, at 8.0 s.
- **E3:** field streams are created inside the clip. Sequential path:
  `AnimationGroup(Create(vf), Create(streams), lag_ratio=0)` with the clip run time;
  concurrent branch the same with per-part run times. Removed the `+1` in
  `groupPlaybackSpan.ts` and `sceneAnimEndForBoundAudioTail`, and the now-unused constants.
  New tests for both paths.
- **Timing window contract:** `src/lib/clipWindows.ts` `clipAnimationWindow(item, items,
  audio)` gives each clip's animation window as export plays it. It takes bound-narration
  run time for every leaf that export narrates, image included. Tests in
  `clipWindows.test.ts`, including parity with the emitted image `run_time`.
- **Timing sweep (permanent, user decision):**
  - `src/codegen/timingSweep.ts`: fixture scenes, variable map and expectations; verifier-only,
    not imported by the app. `timingSweep.test.ts` keeps the fixtures exportable and mapped.
  - `manim-timeline/scripts/timing-sweep/`: `export.ts` (vite-node),
    `timing_sweep_instrument.py` and `run_sweep.py` (repo root; no ffmpeg needed; temp work
    dir; exits 1 on mismatch).
  - Result: 50 ok / 0 failed; the 2 camera clips are skipped, because their writer spans the
    cluster and their segment times are unit-tested.
  - Negative control: with the E1/E2 fixes reverted, the sweep reports 7 failures (6 early
    cluster branches + `s4.wav` added twice) and exits 1. The fixes were then restored.
- **Docs:**
  - AGENTS.md codegen gate and both `verifier.md` prompts name the sweep.
  - `codegen-invariants` skill: field row, sweep step, `delayedTimedBranch` rule.
  - README: per-leaf table (field row), Tests (sweep) and trailer.
- **Gates:** `npm run build` pass; `npm run test` 76 files / 620 tests; eslint clean on the
  10 touched TS files; Python files compile; sweep exit 0.
- **Next (2c part 2, preview):** shape intro, axes/plot/curve audio-aware run time + smooth
  easing (via `clipAnimationWindow`), surrounding-rect intro + label, area intro, field
  intro, selected-dot ring while paused, P2 image audio, P7 transform source hide.

### 2c part 2, first item: axes look (user report 2026-10-15)

User: "the ticks are animated differently in the exported video than in the preview" and
"the labels from the preview do not appear at the exported video at all".

- **Labels missing in export (bug):** `generateAxesDef` built `axes_k_xlabel` with
  `get_x_axis_label(str)` (a `MathTex`, against the HebrewMathLine rule) but never added or
  played it; only scene-start axes added it, at the pre-move position. New axes default to
  "x"/"y", so every axes was affected. Fix: labels are `HebrewMathLine(..., font_size=36,
  hebrew_font="Alef")` placed like the server raster (`next_to(x_axis.get_end(), DOWN, 0.25)`,
  `next_to(y_axis.get_end(), LEFT, 0.25)`) and `axes.add(...)`-ed before positioning, so
  `Create`, moves and exits carry them and the group centers like `/api/preview_axes`.
  `staticAddCodegen` adds only the axes var.
- **Create order (preview):** Manim `Create` has `lag_ratio=1`: every family member with
  points gets an equal back-to-back slice, each `smooth`-eased. Measured order (0.20.1): x
  line, x tip, x ticks, x number glyphs, y line, y tip, y ticks, y number glyphs, label
  glyphs. New `src/lib/axesCreatePlan.ts` mirrors it (tick rule: no origin tick, no max tick
  under a tip; number text from the step's decimals; label glyph estimate), with the exact
  Manim `smooth`. `buildAxesCreatePreviewSpec` draws from it over `clipAnimationWindow`
  (audio-aware; `axesRasterGeometry` uses the same alpha). The reveal-head dot is gone.
- **Static look (vector fallback):** Manim defaults: white axes/numbers/labels, stroke
  `width * 0.01` units, tick half-length `tick_size` (was half as long), full-opacity ticks,
  numbers 0.25 from the axis.
- **Check:** exported default-like axes (numbers on, moved to (1, 0.5)) rendered `-ql`: Manim
  family size 32 = `axesCreatePlan(...).members`; frames at 0.3/0.9/1.5/2.4/3.3/3.85 s show
  the plan's pieces (e.g. 0.9 s: ticks -4..1 done, tick 2 starting); both labels in the final
  frame. Browser check not done (extension not connected).
- **Gates:** build pass; 78 files / 631 tests; eslint clean on touched files; sweep 50 ok / 0
  failed. New tests: `lib/axesCreatePlan.test.ts`, `codegen/axesCodegen.test.ts`; updated
  `lib/graphCreatePreview.test.ts`.

## Verification (verifier)

## Review notes (manim-reviewer / ui-reviewer — optional)

## Docs delta (docs-keeper)
