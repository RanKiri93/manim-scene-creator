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

## Verification (verifier)

## Review notes (manim-reviewer / ui-reviewer — optional)

## Docs delta (docs-keeper)
