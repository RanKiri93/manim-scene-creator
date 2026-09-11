---
slug: text-intro-animation-preview
created: 2026-09-11
status: planned
owner_role: editor-dev
next_tool: any
source: user request
---

## Plan (architect)

### Goal
Make text entry/transform preview feel closer to the Manim video without making preview heavy: reuse the existing `HebrewMathLine` raster PNG and segment boxes, but drive Write/FadeIn/ReplacementTransform preview with Manim-like eased progress instead of linear progress, preserve per-segment timing and waits, and keep the current raster-crop approximation for Write. This is feasible and lightweight because it is still pure client-side masking/opacity/position math over already-measured PNGs; exact stroke-path `Write` tracing would require vector/path extraction or frame rendering and is explicitly out of scope for this pass.

### Non-goals
- Do not add a server endpoint, render per-frame Manim snapshots, or request new PNGs during playback.
- Do not change generated Python, text timing, audio binding, `animSec`, `waitAfterSec`, or codegen output; preview should move closer to current export, not redefine export.
- Do not attempt exact Manim `Write` stroke tracing of glyph outlines. A raster wipe with eased progress is the intended MVP approximation.
- Do not change persisted project shape (`types/scene.ts`) or add new user-facing animation fields.
- Do not touch unrelated current WIP from `git status` (Copilot/expression-helper/editor files, rasterized-axes handoff files, etc.). If `README.md` is updated later, preserve its existing uncommitted trailer text instead of rewriting it.

### Touched files
#### lib/
- `manim-timeline/src/lib/visualPlaybackPreview.ts` — add a small Manim-default-easing helper (for visual progress only) and either expose eased visual fields on text intro/transform preview states or add separate helpers for visual progress. Keep raw timing and `previewRunTime` unchanged.
- `manim-timeline/src/lib/visualPlaybackPreview.test.ts` — extend `describe('textIntroSegmentStates')` and `describe('activeTextTransformForLine')` (or new describe blocks) to prove waits/audio timing remain unchanged while visual/eased progress differs at quarter/three-quarter points and is still exact at 0/0.5/1.
- `manim-timeline/src/lib/segmentAnimDurations.ts` — read-only dependency; do not change unless tests expose an existing mismatch.
- `manim-timeline/src/lib/segmentAnimDurations.test.ts` — read-only safety test in the targeted run; no changes expected.

#### UI
- `manim-timeline/src/canvas/layers/TextLineNode.tsx` — consume the eased visual progress for segment Write crop width, FadeIn opacity, whole-line transform interpolation, and segment transform interpolation. Keep existing measured PNG/segment crop machinery, RTL-vs-math reveal direction, blink overlays, drag/bbox behavior, and fallback text unchanged.

#### codegen (read-only / verification only)
- `manim-timeline/src/codegen/lineCodegen.ts` — read to confirm export still uses default Manim rate functions for `Write`, `FadeIn`, and `ReplacementTransform`; do not edit.
- `manim-timeline/src/codegen/lineCodegen.test.ts` — run as a guard that emitted text animation snippets are unchanged; no changes expected.
- `manim-timeline/src/codegen/groupPlaybackSpan.ts` — do not edit; preview-only easing must not affect `sequentialAnimSecondsForLeaf`.

#### docs
- `manim-timeline/README.md` — after implementation, document that text preview uses eased client-side raster masking as a lightweight approximation of Manim `Write`/`FadeIn`/`ReplacementTransform`, and extend the `*Last updated:*` trailer without overwriting existing WIP edits.
- `docs/handoffs/2026-09-11-text-intro-animation-preview.md` — later roles append implementation and verification notes only.

### Invariants at risk
- **Preview-only change must not alter export timing or Python** — enforced by `manim-timeline/src/codegen/lineCodegen.ts`, `lineCodegen.test.ts`, `src/codegen/groupPlaybackSpan.ts`, and README “Per-leaf duration accuracy”; do not touch codegen or timing math.
- **Text segment timing and waits remain aligned with export** — enforced by `manim-timeline/src/lib/visualPlaybackPreview.ts`, `visualPlaybackPreview.test.ts`, `src/lib/segmentAnimDurations.ts`, and `segmentAnimDurations.test.ts`; easing may affect only visual interpolation within each segment, not segment start/end times or waits.
- **Bound-audio preview duration remains respected** — enforced by `previewRunTime` / `resolveRecordedPlayback` in `visualPlaybackPreview.ts` and the existing audio-bound test in `visualPlaybackPreview.test.ts`; the eased alpha must be applied after audio-derived local progress is computed.
- **Hebrew/math reveal direction stays correct** — enforced in `manim-timeline/src/canvas/layers/TextLineNode.tsx` by `segmentRevealDirection` using measured `isMath`; do not reverse RTL text or LTR math behavior.
- **Transform source/target visibility stays safe** — enforced by `activeTextTransformForLine`, `isTransformSourceHiddenInPreview` in `visualPlaybackPreview.ts`, and `SceneCanvas.tsx`; easing must not make source or target linger beyond the transform clip window.
- **Measure server remains optional** — `TextLineNode.tsx` must keep the existing fallback label when there is no preview PNG/segment measurement; no playback-time server dependency.

### Test plan
- Extend `manim-timeline/src/lib/visualPlaybackPreview.test.ts`:
  - `describe('manim-like text visual easing')`: assert the easing helper (or visual state field) maps `0 -> 0`, `0.5 -> 0.5`, `1 -> 1`, and quarter progress to a value different from linear while still monotonic.
  - Extend `describe('textIntroSegmentStates')`: a line with two segments and a wait still starts segment 2 only after segment 1 anim + wait; if visual/eased fields are added, assert raw timing progress stays linear while visual progress is eased.
  - Extend `describe('activeTextTransformForLine')`: transform preview remains active only inside `[effectiveStart, effectiveStart + previewRunTime)` and exposes/uses eased visual progress without changing the active window.
- From `manim-timeline/`: `npx vitest run src/lib/visualPlaybackPreview.test.ts src/lib/segmentAnimDurations.test.ts src/codegen/lineCodegen.test.ts`.
- From `manim-timeline/`: `npm run test`.
- From `manim-timeline/`: `npm run build`.
- From `manim-timeline/`: `npx eslint src/lib/visualPlaybackPreview.ts src/lib/visualPlaybackPreview.test.ts src/canvas/layers/TextLineNode.tsx` plus README lint is not applicable.
- Manual smoke: `npm run dev`; with measure data available, scrub/play a text line with `write`, `fade_in`, segment waits, math segments, Hebrew text segments, and a segment/whole transform. Confirm the preview is smoother/more Manim-like, segment waits still pause visibly, Hebrew reveals right-to-left while math reveals left-to-right, and stopping the measure server after data is absent still shows the fallback label rather than crashing.

### Open questions
- None. Recommended MVP is easing + existing raster masking; exact stroke tracing can be revisited only if the user explicitly accepts a heavier server/vector approach.

## Implementation notes (editor-dev)

## Verification (verifier)

## Review notes (manim-reviewer / ui-reviewer — optional)

## Docs delta (docs-keeper)
