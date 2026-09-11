---
slug: rasterized-axes-preview
created: 2026-09-11
status: docs
owner_role: editor-dev
next_tool: any
source: user request
---

## Plan (architect)

### Goal
Improve the mathematical canvas preview with the smallest high-impact change: when the measure server has already produced a Manim-rendered transparent PNG for an `axes` item (`/api/preview_axes`), draw that rasterized axes image on the Konva canvas after the axes Create animation has completed. This makes ticks, decimal numbers, axis labels, arrow tips, and Manim stroke details look closer to the final rendered video while preserving the current fast vector preview during Create animation, while the server is unavailable, or when the cached raster is stale. Graph overlays continue to use the existing interactive Konva coordinate mapping on top of the more accurate axes background.

### Non-goals
- Do not add a new endpoint, render a full scene frame, or introduce a heavy per-frame Manim preview loop.
- Do not change generated Python, graph expression semantics, timing, `axesId` relationships, or persisted project shape.
- Do not replace text-line preview: `TextLineNode.tsx` already uses `/measure` PNGs from `HebrewMathLine`; keep that path intact.
- Do not try to make graph curves/fields fully rasterized in this pass; keep plot/curve/dot/area/field/function-series/point-sequence overlays interactive and editable.
- Do not edit unrelated current WIP files from `git status` (notably Copilot/expression-helper files). If `README.md` is touched later, preserve the existing uncommitted trailer/docs work instead of rewriting it.

### Touched files
#### lib/
- `manim-timeline/src/lib/axesRasterPreview.ts` (new) — pure helper that decides whether an axes raster is safe to use (`axisPreviewDataUrl`, `axisPreviewBounds`, matching `axisPreviewHash`, `createProgress(...) === 1`) and converts Manim-unit ink bounds into local Konva image geometry.
- `manim-timeline/src/lib/axesRasterPreview.test.ts` (new) — cover stale hashes, missing data/bounds, in-progress Create fallback, visible-at-scene-start axes, and left/top/width/height geometry from `AxisPreviewBounds`.
- `manim-timeline/src/lib/axesPreviewRequest.ts` — read-only dependency for `axesPreviewVisualKey`; change only if the helper needs a tiny exported predicate, otherwise leave unchanged.
- `manim-timeline/src/lib/graphCreatePreview.ts` — read-only dependency for the existing vector fallback; change only if tests reveal the raster switch needs an already-exported Create-progress helper instead of duplicating logic.

#### UI
- `manim-timeline/src/canvas/layers/GraphNode.tsx` — load `axes.axisPreviewDataUrl` into an `HTMLImageElement` (same pattern as `TextLineNode.tsx`), render it as a `KonvaImage` when the new helper returns geometry, and suppress only the manual axes/ticks/numbers/axis-label vector layer in that state; keep the invisible bbox, drag handle, reveal head during Create fallback, graph overlays, selection chrome, and placement clicks unchanged.

#### services
- `manim-timeline/src/services/axisPreviewHooks.ts` — read-only dependency; touch only if the implementation finds the existing cache/update flow cannot guarantee `axisPreviewHash` freshness.
- `manim-timeline/src/services/measureClient.ts` — read-only dependency for `previewAxes` response shape; no change expected.

#### docs
- `manim-timeline/README.md` — after implementation, document that completed axes can use the measure-server raster for higher-fidelity canvas preview and extend the `*Last updated:*` trailer without overwriting existing WIP edits.
- `docs/handoffs/2026-09-11-rasterized-axes-preview.md` — later roles append implementation and verification notes only.

### Invariants at risk
- **Raster cache must never show stale axes visuals** — enforced by `manim-timeline/src/lib/axesPreviewRequest.ts` and `axesPreviewRequest.test.ts`; `GraphNode` must only use the PNG when `axisPreviewHash === axesPreviewVisualKey(axes)`.
- **Axes Create animation remains responsive and Manim-like** — enforced by `manim-timeline/src/lib/graphCreatePreview.ts`, `createPlaybackPreview.ts`, and `graphCreatePreview.test.ts`; render the raster only once Create progress is complete (or immediately for `visibleAtSceneStart` axes), otherwise keep the existing vector reveal.
- **Graph overlay coordinates stay aligned to the axes item** — enforced by `manim-timeline/src/canvas/layers/GraphNode.tsx`, `src/lib/graphCreatePreview.test.ts`, `src/lib/functionSeriesPreview.ts`, and `src/lib/resolvePosition.test.ts`; the raster is a visual replacement for axes chrome only and must not change `axW`, `axH`, `toLocal`, `clampedAxesZeroOffsets`, `drawOrder`, or `axesId` anchoring.
- **Measure server remains optional** — enforced by `manim-timeline/src/services/axisPreviewHooks.ts`, `measureClient.ts`, and `GraphNode.tsx`; missing data, disabled measure config, preview errors, or image-load failures must fall back to the current Konva preview rather than hiding axes.
- **Client-only preview fields stay out of durable/agent payloads** — enforced by `manim-timeline/src/types/scene.ts` comments, `src/agent/types.ts`, and `src/agent/serialize.test.ts`; do not add persisted fields or require a `PROJECT_VERSION` migration.
- **Text preview stays HebrewMathLine-based** — enforced by `manim-timeline/src/services/measureClient.ts` (`/measure`) and `src/canvas/layers/TextLineNode.tsx`; no `Text`/`Tex`/`MathTex` fallback should be introduced.

### Test plan
- Add `manim-timeline/src/lib/axesRasterPreview.test.ts` with `describe('axes raster preview')` covering: returns `null` without `axisPreviewDataUrl`; returns `null` without `axisPreviewBounds`; returns `null` when `axisPreviewHash` differs from `axesPreviewVisualKey(axes)`; returns `null` while Create progress is `< 1`; returns geometry immediately for `visibleAtSceneStart`; maps bounds `{ left, right, top, bottom }` to local Konva `{ x: left * pxPerUnitX, y: -top * pxPerUnitY, width: (right-left)*pxPerUnitX, height: (top-bottom)*pxPerUnitY }`.
- From `manim-timeline/`: `npx vitest run src/lib/axesRasterPreview.test.ts src/lib/axesPreviewRequest.test.ts src/lib/graphCreatePreview.test.ts`.
- From `manim-timeline/`: `npm run test`.
- From `manim-timeline/`: `npm run build`.
- From `manim-timeline/`: `npx eslint src/lib/axesRasterPreview.ts src/lib/axesRasterPreview.test.ts src/canvas/layers/GraphNode.tsx` plus `src/services/axisPreviewHooks.ts` / `src/services/measureClient.ts` if touched.
- Manual smoke: from repo root run `python -m uvicorn measure_server:app --host 127.0.0.1 --port 8765`; from `manim-timeline/` run `npm run dev`; create axes with numbers, labels, non-default tip/stroke settings and a graph plot/dot; verify vector Create preview plays, then completed axes switch to the Manim-raster look with graph overlays still aligned; disable/stop the measure server and verify the old Konva axes fallback remains visible.

### Open questions
- None.

## Implementation notes (editor-dev)

- `manim-timeline/src/lib/axesRasterPreview.ts` (new) — pure `axesRasterGeometry()` helper: returns `null` (keep vector preview) when the data URL is missing/blank, `axisPreviewBounds` is missing/non-finite/inverted, `pxPerUnit` is non-finite/non-positive, `axisPreviewHash !== axesPreviewVisualKey(axes)` (stale cache), or `createProgress(...) < 1` (Create still playing; `visibleAtSceneStart` axes report 1 immediately). Otherwise maps Manim-unit ink bounds to axes-local Konva geometry (`x: left*pxPerUnitX, y: -top*pxPerUnitY, w: (right-left)*pxPerUnitX, h: (top-bottom)*pxPerUnitY`), matching the server contract (`grp.move_to(ORIGIN)` before raster in `measure_server.py:preview_axes_raster`, ink extents via `mobject_to_cropped_png_base64`).
- `manim-timeline/src/lib/axesRasterPreview.test.ts` (new) — 6 tests: null without data URL, null without bounds, null on stale hash, null mid-Create, immediate geometry for `visibleAtSceneStart`, exact Manim→Konva mapping.
- `manim-timeline/src/canvas/layers/GraphNode.tsx` — loads `axes.axisPreviewDataUrl` into an `HTMLImageElement` keyed by URL (stale/removed URLs read as "no image"), draws a `KonvaImage` at the helper geometry when ready, and suppresses only the hand-drawn axes/ticks/numbers/axis-label vector layer in that state. Invisible bbox, drag handle, selection chrome, reveal head, stream-seed placement, and all graph overlays (unchanged `axW`/`axH`/`toLocal`/`drawOrder`) are untouched.
- `manim-timeline/README.md` — Canvas section documents the rasterized-axes behavior; `*Last updated:*` trailer prepended without touching earlier entries.
- Deviations from the plan: the image loader does not copy `TextLineNode.tsx`'s synchronous `setImg(null)`-in-effect pattern verbatim — that pattern now trips `react-hooks/set-state-in-effect` (pre-existing errors in `TextLineNode.tsx:248,267`, left alone as out of scope). Instead the loaded image is stored as `{url, img}` and derived against the current URL, which also closes a stale-image race. No changes to `axesPreviewRequest.ts`, `graphCreatePreview.ts`, `axisPreviewHooks.ts`, or `measureClient.ts` were needed (all stayed read-only), so no server-contract re-confirmation was required and no `types/scene.ts` change means no schema migration.
- Commands run (from `manim-timeline/`):
  - `npx vitest run src/lib/axesRasterPreview.test.ts src/lib/axesPreviewRequest.test.ts src/lib/graphCreatePreview.test.ts` — pass (3 files, 27 tests).
  - `npm run build` — pass (`tsc -b && vite build`, `✓ built in ~1.1–1.6s`; chunk-size warning only).
  - `npm run test` — pass (45 files, 369 tests: 363 pre-existing + 6 new).
  - `npx eslint src/lib/axesRasterPreview.ts src/lib/axesRasterPreview.test.ts src/canvas/layers/GraphNode.tsx` — clean, no output.
  - `npm run lint` (full) — fails on pre-existing issues only (src-tauri build artifacts, `TextLineNode.tsx`, `FloatingPanel.tsx`, `time.ts`, etc.); none in touched files.
- Left undone: in-browser smoke (`npm run dev` + measure server) — verify vector Create plays, completed axes switch to the Manim-raster look with overlays aligned, and stopping the server falls back to vectors; no browser in this session.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Targeted raster/axes tests | `npx vitest run src/lib/axesRasterPreview.test.ts src/lib/axesPreviewRequest.test.ts src/lib/graphCreatePreview.test.ts` | pass — `Test Files 3 passed (3); Tests 27 passed (27)` |
| Full frontend test suite | `npm run test` | pass — `Test Files 45 passed (45); Tests 369 passed (369)` |
| Frontend build | `npm run build` | pass — `tsc -b && vite build`; `✓ built in 1.88s` (chunk-size warning only) |
| Touched-file lint | `npx eslint src/lib/axesRasterPreview.ts src/lib/axesRasterPreview.test.ts src/canvas/layers/GraphNode.tsx` | pass — clean, no output |
| Scope/status check | `git status --short`; `git diff --stat` | pass for allowed rasterized-axes scope; status also contains unrelated WIP listed below |

- Out-of-scope changes found in the diff/status (files not in this handoff's allowed touched-file set, not evaluated): `manim-timeline/src/agent/ARCHITECTURE.md`, `src/agent/commit.test.ts`, `src/agent/commit.ts`, `src/agent/providers/gemini.ts`, `src/agent/systemPrompt.ts`, `src/agent/validate.test.ts`, `src/agent/validate.ts`, `src/panels/FunctionSeriesEditor.tsx`, `src/panels/GraphAreaEditor.tsx`, `src/panels/GraphCurveEditor.tsx`, `src/panels/GraphFieldEditor.tsx`, `src/panels/GraphFieldExpressionHelp.tsx`, `src/panels/GraphPlotEditor.tsx`, deleted `src/panels/GraphPlotExpressionHelp.tsx`, `src/panels/ItemList.tsx`, `src/panels/PointSequenceEditor.tsx`, `src/panels/TargetAnimationEditor.tsx`, plus untracked handoffs `2026-09-11-animation-target-assignment-affordance.md`, `2026-09-11-axes-attachment-visibility.md`, `2026-09-11-copilot-expression-helper-parity.md`, `2026-09-11-math-expression-helper-rollout.md`, `2026-09-11-uniform-math-expression-helper.md`, and untracked files `src/lib/mathExpressionValidation.test.ts`, `src/lib/mathExpressionValidation.ts`, `src/panels/MathExpressionDialog.tsx`, `src/panels/MathExpressionEditor.tsx`, `src/panels/mathExpressionPresets.ts`. `README.md` is an allowed file but also contains other WIP docs deltas in the same diff; those were not evaluated for this handoff.
- Claims in "Implementation notes" that could not be confirmed: the in-browser manual smoke (Create vector playback, completed raster switch with aligned overlays, and server-offline vector fallback) was not run; the full `npm run lint` pre-existing-only failure claim was not re-run because the requested gate was touched-file ESLint.

Verdict: **pass**.

## Review notes (manim-reviewer / ui-reviewer — optional)

## Docs delta (docs-keeper)
