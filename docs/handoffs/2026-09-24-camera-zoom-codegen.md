---
slug: camera-zoom-codegen
created: 2026-09-24
status: planned
owner_role: codegen-dev
next_tool: any
source: user request
---

<!--
Copy this file to docs/handoffs/<created>-<slug>.md.
Each role appends ONLY its own section. Never edit a section written by an earlier role;
add a dated note under your own section instead. Update the frontmatter `status`,
`owner_role`, and `next_tool` when you hand off.
-->

## Plan (architect)

### Goal
Export the editor's camera zoom, persistent zoomed view, later-start override, and full-frame return at their exact timeline times, including when object animations and narration are running. Preview and Manim must use the same resolved camera destinations, interruption poses, authored durations, aspect ratio and easing. Explicit scheduled returns remain in place after intervening zooms. This is stage 2, after `2026-09-24-camera-zoom-editor.md` and before `2026-09-24-camera-zoom-copilot.md`; all product decisions are approved, but implementation must wait for the editor model/shared schedule to be implemented and verified.

### Non-goals
- No implementation/render in this planning session; no changes to unrelated WIP.
- No separate persisted camera track, drawable camera object, live bounds tracking, new server endpoint, audio-processing change, or general rewrite of the playback scheduler.
- No changes to editor/Copilot ownership or the project's frame dimensions. Consume numeric snapshots from the shared library; do not independently call Python object bounds to produce a different shot.
- Do not ship a gap-only implementation advertised as arbitrary-playhead zoom. Do not broaden unrelated visual-vs-visual overlap semantics or repair unrelated export defects without evidence that the camera feature requires it.
- If safe camera/path concurrency cannot be verified during implementation, return to the architect for an explicit scope decision; never silently retime the request or substitute gap-only behavior.

### Evidence and dependencies
- Read `AGENTS.md`, Git status, README Export/Export timing and audio synchronization/Per-leaf duration accuracy, the codegen and audio skills, and existing test bodies.
- `manimExporter.ts` already selects `MovingCameraScene` for `camera_move` or a non-origin start frame. `cameraMovePlayLine` only calls `.animate.move_to(...)`; it neither changes width nor names a rate function.
- Camera clips are currently absent from `VisualPlaybackCluster`. Equal event timestamps do not make independent `self.play` calls concurrent. An object at 0..4 and a camera at 1..3 currently emit the camera late, and cursor bookkeeping can then undercount the actual elapsed clock.
- `leafConcurrentCodegen.ts` already merges overlapping leaf/rect/exit/blink/non-path-target intervals. Endpoints only touching do not merge. Target path animations are explicitly excluded because setup depends on the target's pose at playback time; blindly removing that guard is unsafe.
- Standalone/early-unbound audio lives outside the cluster and can be emitted late if its timestamp falls inside a blocking `self.play`. Camera-containing clusters must schedule these audio starts before that play with the appropriate offset, preserving deduplication and tail ceilings.
- Existing tests read: `manimExporter.overlap.test.ts` (`exportManimCode concurrent overlap (composable leaves)`, image stagger/audio-tail regressions, early narration, frame-pan test); `targetAnimationCodegen.test.ts` (`formatTargetAnimationClipPlay`); `projectExporter.test.ts` (`projectExporter`); `time.test.ts` (`runDuration`, `timelineSpanEnd`); `visualPlaybackPreview.test.ts` (`cameraOffsetAtTime`). Current camera tests do not prove concurrency or easing parity.
- Preserve the WIP inventory in the stage-1 handoff. Recheck Git status. The README is already modified; coordinate additive documentation only.
- **User follow-up, 2026-09-24:** all product decisions are approved. The user replaced overlap rejection with later-zoom override and confirmed **keep the scheduled return**. Do not reject camera overlap, queue a newer zoom, resume the older zoom afterward, or cancel/retime/retarget an explicit future return. Stage 1 defines the shared continuous interruption/equal-start policy and preserved authored scene spans; consume that contract, not a second Python scheduling policy. A at 5/B at 7/return at 9 still executes the return at 9, interrupting B from its sampled pose if necessary.
- Delegation order is editor-dev -> verifier -> codegen-dev -> verifier/manim-reviewer -> copilot-dev -> integrated verification/review. Do not implement in parallel with stage 1 against a guessed shared API. Record the actual schedule API and runtime evidence in this handoff's Implementation notes for stage 3.

### Implementation outline
1. **Consume stage-1 resolved camera segments.** Retain `camera_move` as a non-leaf event. Read absolute target width, frame-relative offsets resolved to world center, source/destination pose, original normalized duration and effective influence end from `lib/camera.ts`. The newer command starts from the earlier trajectory sampled at its start; do not shorten the older easing denominator to its truncated influence span. No older command resumes afterward. Honor the shared exact equal-start winner, independently of layers/Map order, without merging distinct start times through event-group tolerance. Full-frame return sets width to `FRAME_W`, not a guessed inverse `.scale(...)`. Reject malformed camera data with an actionable export diagnostic, never overlap itself; do not silently use the first frame.
2. **Dedicated emitter.** Add `cameraCodegen.ts` for standalone and concurrent camera expressions, using `self.camera.frame` inside `MovingCameraScene`. Initialize a non-origin start frame correctly at full width. Use explicit easing identical to the shared formula; distinguish interpolation progress from elapsed seconds. Keep partial export usable by emitting its camera helper/precondition notes in the snippet as well as the full file. Preserve no-camera export behavior.
3. **One camera writer in each concurrent play.** Include authored camera intervals in overlap clustering, starts, wall ends, duration accounting and event removal, but derive their motion only from the shared effective schedule. A long object animation may connect zoom-in and return into one cluster even though those camera intervals do not overlap. Emit one ordered camera branch for that cluster, not several `.animate` builders mutating `camera.frame` concurrently or capturing stale source poses. A camera-only time-evaluator animation over the cluster's camera span is a suitable implementation: sample resolved segments with a linear outer clock and apply the agreed easing exactly once inside each segment, including interruption and hold spans. An ordered succession is also acceptable only with runtime proof of delayed source initialization and exact interrupted progress. Do not emit an overridden clip again as a standalone play or add the camera frame as visible content.
4. **Preserve actual start/duration.** Relative delay belongs outside the camera's own runtime. Do not put `run_time=duration` on a `Succession(Wait(rel), animation)` and compress the delay. Cluster scene-clock seconds are the maximum emitted relative end, not the sum. Remove a clustered camera from standalone emission so it cannot run twice; account for a standalone camera and camera-only scene tails using the same duration policy (minimum 0.05 for authored clips).
5. **Camera overlap with existing paths.** Provide a composable path branch for camera-containing clusters that initializes the path from the target's actual pose when its delayed branch begins, retaining polyline/parametric behavior and label/stream grouping. Do not evaluate a path anchor at cluster entry if an earlier target move can change it. Keep existing standalone path output semantics; no new user-visible visual-overlap policy. Add focused delayed-path and prior-move tests and render evidence before removing exclusions. If this cannot be delivered safely within scope, return to the architect for an explicit user decision rather than silently delaying the camera or claiming all overlap is supported.
6. **Audio starts inside a blocking camera play.** Before emitting such a cluster/standalone camera span, emit any otherwise-outer audio start inside that span using `time_offset = audioStart - actualPlayStart`; mark it scheduled so later event walking/bound leaves do not emit it again. Preserve early-bound audio, exclusive binding, master-audio behavior, and scene tails. Use the same set and tail ceiling for emitted playback and clock accounting. Audio is not a camera animation and does not advance the clock.
7. **Duration and compatibility.** Audit `computeSceneDurationSec`, `timelineSpanEnd`, final waits and multi-scene offsets with camera-only, interrupted-camera and final-return scenes. Interruption must not mutate authored durations or shorten scene length: A **0..10**, B **2..3** transitions A only until 2, finishes B at 3, and holds B through the authored scene end at 10; account for all 10 seconds exactly once, not 11 seconds of summed plays or 3 seconds of shortened scene. Existing item-based duration should already include cameras; change `time.ts` only if tests demonstrate a mismatch, not to special-case width. Align the old export camera minimum of 0.01 with the shared authored minimum of 0.05. Preserve the README per-leaf table. If leaf emission changes to support a camera cluster, adjust `groupPlaybackSpan.ts` in the same patch and prove exact waits.

### Touched files
Paths are relative to `manim-timeline/` unless noted.

**`codegen/`**
- `src/codegen/cameraCodegen.ts`, `src/codegen/cameraCodegen.test.ts` **(new)** — camera expressions/helper source, explicit source/target and interruption poses, original easing progress, standalone and single-writer concurrent behavior.
- `src/codegen/manimExporter.ts`, `src/codegen/manimExporter.overlap.test.ts` — camera validation/event participation, subclass/helper emission, audio scheduling inside blocking camera spans, cursor/waits and regressions.
- `src/codegen/leafConcurrentCodegen.ts` — camera cluster participants, single camera branch, complete interval/runtime accounting, deduplication of clustered events.
- `src/codegen/targetAnimationCodegen.ts`, `src/codegen/targetAnimationCodegen.test.ts` — narrowly composable delayed path setup for camera overlap, preserving current anchor semantics.
- `src/codegen/groupPlaybackSpan.ts` — only matching duration-helper adjustments required by changed emission; otherwise retain unchanged with regression coverage.
- `src/codegen/lineCodegen.ts` — narrow audio-line scheduling/offset interface only if needed to reuse existing path/dedup logic; do not change narration duration policy.
- `src/codegen/projectExporter.test.ts` — multi-scene camera class/helper isolation and scene-length regression; production `projectExporter.ts` should continue forwarding existing item data unchanged.

**`lib/`**
- `src/lib/time.test.ts` — explicit camera `runDuration`/`timelineSpanEnd` cases. `src/lib/time.ts` is conditional: only a demonstrated timing mismatch permits a production edit, owned here.
- `src/lib/camera.test.ts` — extend stage-1 contract tests only if required for sampled export parity; preserve the earlier tests. No independent pose implementation.

**Docs**
- `manim-timeline/README.md` (repo-relative, WIP) — after verification document camera concurrency/easing/later-start override, preserved authored scene duration, conditional `MovingCameraScene`, partial-export requirement, and audio scheduling; keep the duration table correct and extend the Last-updated trailer.
- `docs/handoffs/2026-09-24-camera-zoom-codegen.md` (repo-relative, **new**) — this plan; later roles append their sections.

### Invariants at risk
- **Emitted time equals accounted time:** `src/codegen/groupPlaybackSpan.ts` (`sequentialAnimSecondsForLeaf`) and `src/codegen/manimExporter.ts` (`timelineCursor`, `padAfter`). Camera overlap must not postpone objects/camera or hide a late play behind `max(cursor, scheduledEnd)`.
- **Concurrent staggering and maximum duration:** `src/codegen/leafConcurrentCodegen.ts` (`visualClusterWallSeconds`, `visualClusterManimSeconds`, `buildConcurrentVisualClusterPlay`); tests in `manimExporter.overlap.test.ts` enforce uncompressed delayed image/audio behavior. Camera delays and gaps need the same exact contract.
- **One deterministic camera channel:** new `src/lib/camera.ts` and `src/codegen/cameraCodegen.ts`; accept later-start override, retain original progress at interruption, never resume an older command, and initialize delayed transitions from the resolved pose, not the camera's construction-time target copy. Equal-start ordering and source poses come from the shared schedule.
- **Path anchors resolved at the right moment:** `src/codegen/targetAnimationCodegen.ts` currently enforces safety by excluding path mode from concurrent branches. Replace that guard only with tested delayed initialization, not optimistic pre-play setup.
- **Audio adds zero scene seconds and plays once at its scheduled time:** `src/codegen/lineCodegen.ts`, `src/codegen/leafConcurrentCodegen.ts`, and `src/codegen/manimExporter.ts` enforce binding/dedup/tail ceilings. Interior audio starts must not shift when a camera cluster grows.
- **Project duration includes all authored camera ends:** `src/lib/time.ts`, `src/codegen/manimExporter.ts` (`computeSceneDurationSec`), `src/codegen/projectExporter.ts`, and `src/lib/audioMixdown.ts` consume item durations. Interruption changes effective camera influence, not authored span or master mixdown length; do not introduce a second timeline.
- **Manim content rules:** `src/codegen/lineCodegen.ts`/`texUtils.ts` keep `HebrewMathLine`; `src/codegen/graphCodegen.ts` emits explicit axes domains. Camera helpers must not recreate text/axes with alternate classes or change object geometry.

### Test plan
No tests/builds/renders run during planning. Load `codegen-invariants` and `audio-pipeline` before implementation; use `manim-render-check` for review.

**Add/extend exact tests**
- `src/codegen/cameraCodegen.test.ts`: `describe('camera viewport emission')` — zoom-only `MovingCameraScene`, absolute center/width, full-frame reset on a non-origin frame, explicit matched easing (quarter and three-quarter progress, not just midpoint), deterministic helper emission, no width compounding, partial snippet requirements and invalid-camera diagnostics.
- Same file: `describe('camera concurrent branch')` — one camera writer with zoom/hold/return in one long cluster, delayed begin, non-midpoint interruption sampled using the older original duration, no resumed old destination, exact runtime/gaps, no visible frame rectangle.
- `src/codegen/manimExporter.overlap.test.ts`: extend `exportManimCode concurrent overlap (composable leaves)` with object 0..4 + camera 1..3 + next object at 6: cluster consumes **4 s**, camera delay **1 s**, camera animation **2 s**, then exactly **`self.wait(2.0000)`**. Derive and assert all times, not just presence of camera strings.
- Same block: camera 1..7 bridging two visual intervals; touching camera endpoints; zoom 5..6, return 9..10 inside an object 0..12 (one 12-second play, three-second settled gap); a scene containing only cameras ending at 10; overlapping camera A 0..10/B 2..3 on different layers (one writer, continuous source at 2, B holds 3..10, no stale standalone emission, exact 10-second total); chained interruptions and a completed return before a newer zoom; shared equal-start winner and distinct sub-millisecond starts; malformed camera data rejected, valid overlap accepted. A 5..6/B 7..8/return 9..10 must emit the unchanged return at 9 exactly once; B 7..11 instead must be interrupted continuously at 9 by that return, with full frame at 10 and held through authored scene end 11, never resuming B.
- Same block: unbound narration starting at 2 inside camera 0..4 emits once before the play with **`time_offset=2`** (formatter precision may differ); early-bound narration and segment waits/tails retain current exact waits; late sound cannot be compensated by a fictitious cursor. Retain image delayed-FadeIn and bound-audio tail regressions.
- `src/codegen/targetAnimationCodegen.test.ts`: extend `formatTargetAnimationClipPlay` and add `describe('camera overlap with target paths')` — polyline and parametric paths, delayed start inside camera motion, completed earlier target move before path begins, graph-dot label/field streams, standalone equivalence.
- `src/lib/time.test.ts`: extend `runDuration` and `timelineSpanEnd` with camera duration/last-return values and the unchanged authored span of interrupted clips; verify exported `computeSceneDurationSec` agrees (A 0..10/B 2..3 still ends at 10). `src/codegen/projectExporter.test.ts`: extend `projectExporter` with distinct camera histories in two scenes and correct durations/helper placement, including an interrupted long clip in the first scene.

**Exact commands; working directory `manim-timeline/`**
```powershell
npx vitest run src/codegen/cameraCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/codegen/targetAnimationCodegen.test.ts src/codegen/projectExporter.test.ts src/lib/camera.test.ts src/lib/time.test.ts
npm run build
npm run test
npm run lint
npx eslint src/codegen/cameraCodegen.ts src/codegen/cameraCodegen.test.ts src/codegen/manimExporter.ts src/codegen/manimExporter.overlap.test.ts src/codegen/leafConcurrentCodegen.ts src/codegen/targetAnimationCodegen.ts src/codegen/targetAnimationCodegen.test.ts src/codegen/groupPlaybackSpan.ts src/codegen/lineCodegen.ts src/codegen/projectExporter.test.ts src/lib/time.ts src/lib/time.test.ts src/lib/camera.test.ts
npm run dev
```
Record baseline lint separately; touched-file lint must pass. Do not reformat untouched files included in the focused lint command.

**Runtime review (required before completion)**
- Export the actual app fixture as class `CameraZoomReview`: on a non-origin frame, a visible labelled axes/shape, an independent object animation lasting 0..12, zoom 5..6 and return 9..10. Use a second fixture/variant with a delayed path inside camera motion and a short existing narration clip. Do not hand-author a substitute Python animation and treat it as exporter proof.
- Add an override variant A 0..10/B 2..3: compare just before/at/after 2, the sampled source/absolute width, B's completed pose at 3 and held pose at 10; no old-motion resumption or duration compression. Also verify a completed return before B produces a full-frame starting pose. Use the same exported-fixture workflow/command below for each variant.
- Add A 5..6, B 7..11 and an already-scheduled return 9..10: verify the return starts at 9 from B's sampled pose, reaches its original full-frame target at 10 and holds through 11. The exporter must not cancel, postpone, duplicate or retarget the return because B was inserted later.
- Preferred exact UI workflow: `npm run dev` from frontend; existing Export panel full-file Render MP4 with quality **Low** (`POST /api/render`, `quality: "l"`). Render outside production data, and keep downloaded evidence under `C:\Users\ranki\AppData\Local\Temp\opencode` rather than reading/listing repo binary directories.
- If using CLI, save the full exported fixture as `C:\Users\ranki\AppData\Local\Temp\opencode\camera-zoom-review.py`; from repo root run the following after verifying the temp directory. These are verification commands for the implementer/reviewer, not actions performed by this plan:
```powershell
Test-Path -LiteralPath "C:\Users\ranki\AppData\Local\Temp\opencode"
$env:PYTHONUTF8=1; python -m manim render "C:\Users\ranki\AppData\Local\Temp\opencode\camera-zoom-review.py" CameraZoomReview -ql --format=mp4 --media_dir "C:\Users\ranki\AppData\Local\Temp\opencode\camera-zoom-render"
```
- `manim-reviewer`: walk the exported clock and compare start/end poses, quarter-progress poses, settled zoom during the three-second gap, final full frame, delayed path continuity, and narration onset. Confirm objects were not scaled/moved to fake zoom. Inspect representative rendered frames using the skill, with outputs in temp; never traverse repo `media/`, `render_debug/`, or `assets/audio/`.
- `verifier`: final feature gates include stage-1 UI/persistence and stage-3 proposal tests, not just string assertions. Missing real Manim evidence means runtime camera/path scheduling remains unverified.

### Open questions

## Implementation notes (<owner_role>)

- What changed, per file.
- Deviations from the plan and why.
- Commands run and their result (paste short excerpts, not full logs).
- Anything left undone and why.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| … | … | pass / fail + one-line evidence |

- Out-of-scope changes found in the diff (files not in "Touched files"):
- Claims in "Implementation notes" that could not be confirmed:

Verdict: **pass** / **fail** (fail sends `status` back to `implementing`).

## Review notes (manim-reviewer / ui-reviewer — optional)

Findings in severity order, each with file:line and a concrete fix suggestion.

## Docs delta (docs-keeper)

- README sections touched, `*Last updated:*` trailer extended: yes/no
- ARCHITECTURE.md touched: yes/no
- idea.md item closed or updated: which
