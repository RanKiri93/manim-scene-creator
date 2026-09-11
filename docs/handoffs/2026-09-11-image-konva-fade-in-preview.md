---
slug: image-konva-fade-in-preview
created: 2026-09-11
status: docs
owner_role: editor-dev
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
Images in the Konva canvas preview should fade in over their image clip `duration` starting at `effectiveStart`, matching the Manim export's `FadeIn(image_N, run_time=item.duration)` behavior. After the intro window, images remain visible at their configured `opacity` until any exit animation removes/fades them, just as they do in the actual rendered video.

### Non-goals
- Do not change exported Python or image codegen; this is preview-only.
- Do not change persisted project shape (`ImageItem`, `PROJECT_VERSION`, migrations) or defaults.
- Do not add animated GIF playback; GIFs remain still images/first-frame preview.
- Do not alter text, axes, graph, shape, surrounding-rect, exit, blink, or target-animation timing semantics except for composing image intro opacity with the already-existing wrappers.
- Do not touch `measure_server.py` or any other current WIP unrelated to image preview.

### Touched files

lib/
- `manim-timeline/src/lib/visualPlaybackPreview.ts` — add a small pure helper (e.g. `imageIntroOpacity`) that returns the Manim-smooth intro opacity multiplier for `ImageItem`: `1` for `visibleAtSceneStart`, `0` before start, `manimSmoothProgress((time - effectiveStart) / previewRunTime(...))` during intro, `1` afterwards. Keep final item opacity out of this helper so composition stays explicit in the UI layer.
- `manim-timeline/src/lib/visualPlaybackPreview.test.ts` — extend tests with an image-specific describe block covering before start, halfway eased fade, after-duration full opacity, `visibleAtSceneStart`, and that `previewRunTime` handles image duration.

UI
- `manim-timeline/src/canvas/SceneCanvas.tsx` — compute the image intro opacity for each visible image at `currentTime` and pass it through the existing playback wrapper chain, composing it multiplicatively with exit fade, blink scale, target scale/rotation, and agent preview opacity. Prefer adding an optional `introOpacity`/`baseOpacityMultiplier` prop to `PlaybackWrap` rather than duplicating wrapper groups around `ImageNode`.
- `manim-timeline/src/canvas/layers/ImageNode.tsx` — if needed, add a prop for an opacity multiplier or preview opacity so the rendered image/placeholder opacity becomes `clampImageOpacity(item.opacity) * introOpacity`. Avoid storing transient preview opacity in Zustand.

docs
- `manim-timeline/README.md` — update the Canvas/Konva or Image row to say image previews now fade in with Manim-smooth `FadeIn` timing, and extend the `*Last updated:*` trailer.

### Invariants at risk
- **Canvas visibility window remains source-of-truth:** `isActiveAtTime` / `effectiveStart` / `effectiveEnd` in `manim-timeline/src/lib/time.ts` decide whether the image is drawn at all. The new opacity helper must not change active filtering or make images visible before start.
- **Preview timing matches export duration:** image export uses `FadeIn(image_N, run_time=item.duration)` covered in `manim-timeline/src/codegen/manimExporter.overlap.test.ts`; preview should use `previewRunTime(item, items, audioItems)` / `runDuration` and `manimSmoothProgress` from `manim-timeline/src/lib/visualPlaybackPreview.ts`, not a hardcoded 1s or linear easing.
- **Static start objects stay fully visible:** `visibleAtSceneStart` is enforced by `isVisibleAtSceneStartItem` in `manim-timeline/src/types/scene.ts` and by codegen tests in `manim-timeline/src/codegen/manimExporter.overlap.test.ts`; image intro opacity must return `1` for these items.
- **Image item opacity remains user-controlled final opacity:** `clampImageOpacity` in `manim-timeline/src/lib/imageAssetPath.ts` and `ImageNode.tsx` enforce final opacity bounds; intro fade should multiply that value rather than overwrite it.
- **Existing exit/blink/target animation composition stays intact:** `exitPreviewForTarget`, `blinkPreviewForTarget`, and `targetAnimPreviewAccum` in `manim-timeline/src/lib/visualPlaybackPreview.ts` plus `PlaybackWrap` in `SceneCanvas.tsx` already compose exit opacity and transforms; image intro fade must not break fade-out, blink-scale, or rotate/path/scale target previews.

### Test plan
- Add/extend `manim-timeline/src/lib/visualPlaybackPreview.test.ts`:
  - `describe('imageIntroOpacity', ...)`
    - returns `0` before `startTime`.
    - returns eased `manimSmoothProgress(0.25)` / `0.15625` at one-quarter of a 2s image intro, proving Manim-smooth rather than linear preview.
    - returns `1` at/after `startTime + duration`.
    - returns `1` immediately when `visibleAtSceneStart = true`.
    - keeps `previewRunTime(image, ...)` equal to `image.duration`.
- Run from `manim-timeline/`:
  - `npx vitest run src/lib/visualPlaybackPreview.test.ts`
  - `npm run test`
  - `npm run build`
  - `npx eslint src/lib/visualPlaybackPreview.ts src/lib/visualPlaybackPreview.test.ts src/canvas/SceneCanvas.tsx src/canvas/layers/ImageNode.tsx`
- Manual smoke (optional but recommended): `npm run dev`, add/import an image, scrub from just before its `startTime` through `startTime + duration`, confirm the Konva preview fades from transparent to configured opacity; then add a FadeOut exit and confirm fade-in + fade-out both compose correctly.

### Open questions
Empty.

## Implementation notes (editor-dev)

- What changed, per file (paths under `manim-timeline/` unless noted):
  - `src/lib/visualPlaybackPreview.ts` — new pure `imageIntroOpacity(item, time, items, audioItems?)` returning the intro opacity multiplier: `0` before `effectiveStart`, `1` for `visibleAtSceneStart` (at/after start), otherwise `manimSmoothProgress((time - t0) / previewRunTime(...))` during the intro window and `1` after. Non-positive/non-finite durations resolve to instant `1` (matches `createProgress` "instant create" degeneracy). Item `opacity` deliberately excluded so the caller composes it explicitly. Added `ImageItem` to the type imports; no other logic touched.
  - `src/lib/visualPlaybackPreview.test.ts` — new `describe('imageIntroOpacity')` with 5 tests: `0` before start, eased quarter-progress (`0.15625`, `< 0.25`) + halfway fixed point (`0.5`), `1` at/after `startTime + duration`, `1` for `visibleAtSceneStart`, and `previewRunTime(image) === image.duration`.
  - `src/canvas/SceneCanvas.tsx` — image branch computes `imageIntroOpacity(item, currentTime, itemsMap, audioItems)` and passes it as a new optional `baseOpacity` prop on `PlaybackWrap`; `PlaybackWrap` now renders `clamp01((exit?.opacity ?? 1) * base)`. Konva Group opacity nests multiplicatively, so intro composes with exit fades (inside) and agent-preview dimming (`PreviewWrap`, outside) with no extra wrapper groups. All other `PlaybackWrap` call sites default to `baseOpacity = 1` (unchanged behavior).
  - `manim-timeline/README.md` — Image row notes the Manim-smooth Konva fade-in (`imageIntroOpacity`) composing with exit fades; `*Last updated:*` trailer prepended with "Image Konva fade-in preview".
- Deviations from the plan and why:
  - `src/canvas/layers/ImageNode.tsx` listed as "if needed" — left untouched. No prop was needed because `PlaybackWrap`'s outer Konva `Group` opacity multiplies the image (and its loading/missing placeholder) automatically. Keeps the diff minimal; file still linted clean.
  - No `types/scene.ts` change (no `PROJECT_VERSION` bump — preview-only, no persisted shape change), no codegen change, no `measure_server.py` change.
  - Manual browser smoke (`npm run dev`) not run; the preview math is unit-tested as a pure function and the wiring is type-checked. Verifier may spot-check in browser if desired.
- Commands run (from `manim-timeline/`) and result:
  - `npx vitest run src/lib/visualPlaybackPreview.test.ts` → pass, `Test Files 1 passed (1); Tests 24 passed (24)`.
  - `npm run test` → pass, `Tests 433 passed (433)` (428 before + 5 new).
  - `npm run build` → pass, `✓ built in 1.21s` (chunk-size warning only).
  - `npx eslint src/lib/visualPlaybackPreview.ts src/lib/visualPlaybackPreview.test.ts src/canvas/SceneCanvas.tsx src/canvas/layers/ImageNode.tsx` → clean, `TOUCHED-LINT-CLEAN`.
- Anything left undone and why: nothing in scope.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Targeted visual-preview tests | `npx vitest run src/lib/visualPlaybackPreview.test.ts` | pass — `Test Files 1 passed (1); Tests 24 passed (24)` |
| Full frontend test suite | `npm run test` | pass — `Test Files 49 passed (49); Tests 433 passed (433)` |
| Frontend build | `npm run build` | pass — `tsc -b && vite build`, `✓ built in 1.06s` (chunk-size warning only) |
| Touched-file lint | `npx eslint src/lib/visualPlaybackPreview.ts src/lib/visualPlaybackPreview.test.ts src/canvas/SceneCanvas.tsx src/canvas/layers/ImageNode.tsx` | pass — clean (no output) |
| Working-tree audit | `git status --short` | pass with out-of-scope WIP noted below — in-scope modified/tracked files are `manim-timeline/README.md`, `SceneCanvas.tsx`, `visualPlaybackPreview.ts`, `visualPlaybackPreview.test.ts`; `ImageNode.tsx` is untracked from earlier image work |
| Diff-stat audit | `git diff --stat` | pass with out-of-scope WIP noted below — `40 files changed, 1484 insertions(+), 57 deletions(-)` across broader working tree |

- Claim checks:
  - `imageIntroOpacity` confirmed in `src/lib/visualPlaybackPreview.ts`: returns `0` before `effectiveStart`, returns `manimSmoothProgress((time - t0) / previewRunTime(...))` during the intro, returns `1` after the intro, returns `1` for `visibleAtSceneStart` once active, and does not read/mutate `item.opacity`.
  - `src/lib/visualPlaybackPreview.test.ts` confirmed 5 `describe('imageIntroOpacity')` tests, including `0.15625` at quarter progress and `previewRunTime(image) === image.duration`.
  - `SceneCanvas.tsx` confirmed image branch passes `baseOpacity={introImg}` to `PlaybackWrap`; `PlaybackWrap` clamps/defaults `baseOpacity = 1` and multiplies `(exit?.opacity ?? 1) * base`. Grep found no other `baseOpacity` call sites.
  - `ImageNode.tsx` confirmed no intro/base opacity prop and no composition change; current node still uses `opacity={clampImageOpacity(item.opacity)}`. Its untracked status is from earlier image-object work, not this preview handoff per supplied context.
  - No production codegen/schema/server changes are part of this handoff's touched-file diff. Broader working-tree changes under `src/codegen/`, `src/types/scene.ts`, and `measure_server.py` are recorded below as out-of-scope WIP.
  - `manim-timeline/README.md` confirmed image row mentions Manim-smooth Konva fade-in / `imageIntroOpacity`, and `*Last updated:*` starts with **Image Konva fade-in preview**.
- Out-of-scope changes found in the diff/status (files not in this plan's "Touched files"):
  - Tracked: `README.md`, `manim-timeline/src/codegen/blinkCodegen.test.ts`, `manim-timeline/src/codegen/blinkCodegen.ts`, `manim-timeline/src/codegen/flattenExport.ts`, `manim-timeline/src/codegen/graphCodegen.ts`, `manim-timeline/src/codegen/groupPlaybackSpan.ts`, `manim-timeline/src/codegen/leafConcurrentCodegen.ts`, `manim-timeline/src/codegen/lineCodegen.ts`, `manim-timeline/src/codegen/manimExporter.overlap.test.ts`, `manim-timeline/src/codegen/manimExporter.ts`, `manim-timeline/src/codegen/staticAddCodegen.ts`, `manim-timeline/src/codegen/surroundCodegen.ts`, `manim-timeline/src/codegen/targetAnimationCodegen.test.ts`, `manim-timeline/src/hooks/useAddSceneItems.ts`, `manim-timeline/src/lib/constants.ts`, `manim-timeline/src/lib/itemDisplayName.ts`, `manim-timeline/src/lib/itemRelationships.ts`, `manim-timeline/src/lib/migrateLoadedItems.ts`, `manim-timeline/src/lib/migrateSceneItems.ts`, `manim-timeline/src/lib/mtprojBundle.test.ts`, `manim-timeline/src/lib/mtprojBundle.ts`, `manim-timeline/src/lib/nextToGeometry.ts`, `manim-timeline/src/lib/resolvePosition.test.ts`, `manim-timeline/src/lib/resolvePosition.ts`, `manim-timeline/src/lib/time.test.ts`, `manim-timeline/src/lib/time.ts`, `manim-timeline/src/panels/AddObjectToolbar.tsx`, `manim-timeline/src/panels/ExportPanel.tsx`, `manim-timeline/src/panels/ItemList.tsx`, `manim-timeline/src/panels/PositionStepsEditor.tsx`, `manim-timeline/src/panels/PropertyPanel.tsx`, `manim-timeline/src/store/factories.ts`, `manim-timeline/src/store/useSceneStore.ts`, `manim-timeline/src/timeline/TimelineClip.tsx`, `manim-timeline/src/types/scene.ts`, `measure_server.py`.
  - Untracked: `Start.sh`, `docs/handoffs/2026-09-11-fedora-dev-setup.md`, `docs/handoffs/2026-09-11-fedora-run-local-app.md`, `docs/handoffs/2026-09-11-image-export-live-blob-assets.md`, `docs/handoffs/2026-09-11-image-objects-codegen.md`, `docs/handoffs/2026-09-11-image-objects-editor.md`, `manim-timeline/src/codegen/imageCodegen.test.ts`, `manim-timeline/src/codegen/imageCodegen.ts`, `manim-timeline/src/lib/imageAssetPath.test.ts`, `manim-timeline/src/lib/imageAssetPath.ts`, `manim-timeline/src/lib/imageExportAssets.test.ts`, `manim-timeline/src/lib/imageExportAssets.ts`, `manim-timeline/src/lib/migrateProjectToV41.test.ts`, `manim-timeline/src/lib/migrateProjectToV41.ts`, `manim-timeline/src/panels/ImageEditor.tsx`. The handoff file itself is also untracked/updated for this verification record.
- Claims in "Implementation notes" that could not be confirmed:
  - Attribution of the broader out-of-scope working-tree WIP to earlier handoffs cannot be mechanically proven from git alone; accepted per verifier prompt context.
  - Manual browser smoke was not run by implementer and not rerun here; it was optional in the plan.

Verdict: **pass**.

## Review notes (manim-reviewer / ui-reviewer — optional)

Findings in severity order, each with file:line and a concrete fix suggestion.

## Docs delta (docs-keeper)

- README sections touched, `*Last updated:*` trailer extended: yes/no
- ARCHITECTURE.md touched: yes/no
- idea.md item closed or updated: which
