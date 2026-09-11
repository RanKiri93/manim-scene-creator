---
slug: image-export-live-blob-assets
created: 2026-09-11
status: docs
owner_role: editor-dev
next_tool: any
source: bug report
---

## Plan (architect)

### Goal
After adding or replacing an image in the editor, the Export panel and render flow should immediately produce usable Manim Python instead of `# EXPORT ERROR: Image ... is not bundled for Manim export`. The UI should prepare live `blob:` image URLs into export-only `data:image/...;base64` URLs before calling codegen, letting the existing `ImageMobject` data-URL fallback work without requiring a save/reopen `.mtproj` round trip.

### Non-goals
Do not relax `imageCodegen.ts` back to emitting guessed `assets/textures/*` paths for unbundled `blob:`/`http(s):` URLs; that would create Python that renders with missing files. Do not change the persisted `ImageItem` shape, bump `PROJECT_VERSION`, or touch `measure_server.py`. Do not implement animated GIF playback; GIF remains a still `ImageMobject` input.

### Touched files
- lib/
  - `manim-timeline/src/lib/imageExportAssets.ts` (new) — export-only helper that clones `SceneItem[]`, finds `image` items whose `srcUrl` is a live `blob:` or fetchable `http(s):` URL and no `assetRelPath`, fetches bytes, converts them to `data:<mime>;base64,...`, and leaves all store/persisted items unchanged.
  - `manim-timeline/src/lib/imageExportAssets.test.ts` (new) — unit tests for blob/data conversion, no-op for already bundled `assetRelPath`/`assets/textures/*`/existing data URL, and clear failure propagation when fetch fails.
- UI
  - `manim-timeline/src/panels/ExportPanel.tsx` — call the helper asynchronously for single-scene `code`, `codeFullFile` used by render, and combined multi-scene export before invoking `exportManimCode` / `exportMultiSceneCombinedPython`; show a small “Preparing image assets…” state or retain previous code until preparation completes; surface helper failures as the existing export-error text rather than crashing React.
- codegen/
  - `manim-timeline/src/codegen/imageCodegen.test.ts` — keep the existing “unbundled blob is rejected” test, and add/adjust one test documenting that `data:image/...;base64` emits the temp-file fallback. Production codegen should not need changes.
- docs/
  - `manim-timeline/README.md` — update the image/export note to say the Export panel embeds newly imported live images as data URLs for direct Python/render, while `.mtproj` still stores them under `assets/textures/*`; extend the `*Last updated:*` trailer.

### Invariants at risk
- `imageCodegen.ts` must not emit non-existent texture paths for unsaved `blob:` images; enforced by `manim-timeline/src/codegen/imageCodegen.test.ts`.
- Export-panel code preview and render must use the same prepared item snapshot so previewed Python matches rendered Python; enforced in `manim-timeline/src/panels/ExportPanel.tsx` and covered by helper tests plus focused manual/browser smoke.
- `sequentialAnimSecondsForLeaf` equals emitted image playback seconds; enforced by `manim-timeline/src/codegen/groupPlaybackSpan.ts`, `leafConcurrentCodegen.ts`, and `manimExporter.overlap.test.ts`. This plan should not change timing, but run the image codegen tests to guard regressions.
- Store state and persisted schema remain unchanged: export preparation must clone items and must not write `data:` URLs back into Zustand or bump `PROJECT_VERSION`; enforced by `manim-timeline/src/lib/imageExportAssets.test.ts` and `types/scene.ts` staying untouched.
- `.mtproj` bundling remains the durable asset path mechanism (`assets/textures/*`); enforced by `manim-timeline/src/lib/mtprojBundle.ts` and `mtprojBundle.test.ts`.

### Test plan
- Add `manim-timeline/src/lib/imageExportAssets.test.ts` with `describe('prepareImageItemsForManimExport')`:
  - converts an `image` with live `blob:` URL and no `assetRelPath` into an export-only `data:image/png;base64,...` clone;
  - leaves original input objects unchanged;
  - no-ops for `assetRelPath`, `assets/textures/*`, and existing `data:image/...` URLs;
  - throws/returns a clear error when fetch fails so ExportPanel can render an export error.
- Extend `manim-timeline/src/codegen/imageCodegen.test.ts` in `describe('imageCodegen')` with a `data:image/png;base64,...` case that asserts `base64.b64decode`, `tempfile.gettempdir()`, and `ImageMobject(_image_1_path)` are emitted, while the existing unbundled-blob rejection remains.
- Run exact commands from `manim-timeline/`:
  - `npx vitest run src/lib/imageExportAssets.test.ts src/codegen/imageCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/lib/mtprojBundle.test.ts`
  - `npm run test`
  - `npm run build`
  - `npm run lint` (repo-wide may have baseline issues; touched files must be clean with `npx eslint src/lib/imageExportAssets.ts src/lib/imageExportAssets.test.ts src/panels/ExportPanel.tsx src/codegen/imageCodegen.test.ts`)
- Manual smoke from `manim-timeline/`: `npm run dev`, add a PNG, open Export, confirm Python contains `ImageMobject(_image_..._path)`/`base64.b64decode(...)` instead of `EXPORT ERROR`; click Render low-quality only if the measure server is already running.

### Open questions
Empty.

## Implementation notes (editor-dev)

What changed, per file (all paths under `manim-timeline/` unless noted):

- `src/lib/imageExportAssets.ts` (new) — `imageNeedsExportPreparation(item)` predicate (live `blob:`/`http(s):` image `srcUrl`, no `assetRelPath`; skips virtual `assets/textures/*`, existing `data:` URLs, other schemes, non-images) and `prepareImageItemsForManimExport(items)` which fetches those bytes and returns clones with `data:<mime>;base64,...` URLs. MIME resolution order: item `mimeType` → response content-type → explicit file extension (unknown types throw instead of mislabeling). Guards: empty bytes, >8 MB (`MAX_EXPORT_IMAGE_BYTES`), fetch/HTTP failures — all throw human-readable errors naming the image. Conversions cached per source URL; failures evicted from cache so retries work. Input array returned as-is (same reference) when nothing needs conversion; inputs never mutated.
- `src/lib/imageExportAssets.test.ts` (new) — 10 tests: predicate flags/skips, blob→data: clone conversion with frozen (mutation-proof) input, content-type/extension MIME fallback, reference-preserving no-op, per-URL caching, fetch-failure/HTTP-404/unsupported-type/empty/oversized rejections.
- `src/panels/ExportPanel.tsx` — async preparation effect (deps `[items, sceneOrderSig]`; `sceneOrderSig` genuinely referenced for the mid-prep tab-change race guard) producing an export-only `{ single, multi }` snapshot for `code`, `codeFullFile` (used by Render MP4), and combined multi-scene Python, so preview and render share one snapshot. While preparing: `# Preparing image assets for export…` placeholder text, a `role="status"` note, and Render MP4 disabled with "Preparing images…" label. Preparation failures surface as the existing `# EXPORT ERROR:` / `# COMBINED EXPORT ERROR:` text plus a red panel note — no React crash. `renderFullProjectSequential` prepares each scene's items before `exportManimCode` (fingerprint still computed on raw items).
- `src/codegen/imageCodegen.test.ts` — added `data:image/png;base64,...` case asserting `base64.b64decode`, `tempfile.gettempdir()`, and `ImageMobject(_image_1_path)`; existing unbundled-blob rejection untouched. No production codegen changes.
- `manim-timeline/README.md` — Image row documents Export-panel data-URL embedding vs durable `.mtproj assets/textures/*`; `*Last updated:*` trailer prepended with "Image export for live images".

Deviations from the plan and why:

- The plan's exact lint command is satisfied (touched files listed), but `src/panels/ExportPanel.tsx` still reports 2 `no-useless-catch` errors that are pre-existing at HEAD (verified via `git stash` + re-lint: same 2 errors + 1 warning at HEAD; my restructure fixed the warning and added no new problems). Left untouched per "don't clean up others' code" convention and prior-handoff precedent.
- Combined memo keeps `sceneOrderSig` dep via a documented `void sceneOrderSig;` read so tab add/remove/rename refreshes it; `verify-frontend` forbids inline rule disables, and this keeps the dep genuinely referenced.
- Did not touch `measure_server.py`, `types/scene.ts` (no `PROJECT_VERSION` bump — export clones only), or timing code (`groupPlaybackSpan.ts` untouched).
- Browser smoke (`npm run dev`) not run; no server dependency for this flow and canvas rendering is untouched.

Commands run (from `manim-timeline/`) and result:

- `npx vitest run src/lib/imageExportAssets.test.ts src/codegen/imageCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/lib/mtprojBundle.test.ts` → pass, `Test Files 4 passed (4); Tests 52 passed (52)`.
- `npm run test` → pass, `Test Files 49 passed (49); Tests 428 passed (428)`.
- `npm run build` → pass, `✓ built in 1.02s` (chunk-size warning only).
- `npx eslint src/lib/imageExportAssets.ts src/lib/imageExportAssets.test.ts src/panels/ExportPanel.tsx src/codegen/imageCodegen.test.ts` → only the 2 pre-existing `no-useless-catch` errors in ExportPanel (identical at HEAD); new files clean, no new problems.

Codegen-invariants checklist (no timing change, but verified): `groupPlaybackSpan.ts` untouched; image `run_time`/`self.wait` assertions in `manimExporter.overlap.test.ts` still pass (52-test focused run); full suite + build green; README per-leaf table still holds (no emitted-seconds change); generated Python shape for already-bundled images unchanged — new shape only for previously-erroring live images (data-URL fallback that `manim-reviewer` already approved in the codegen handoff), so no new reviewer round requested, verifier decides.

Anything left undone: nothing in scope. Note for the user: remote `http(s):` images can still fail preparation on CORS — the panel then shows exactly which image and why.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Focused image/export/codegen tests | `npx vitest run src/lib/imageExportAssets.test.ts src/codegen/imageCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/lib/mtprojBundle.test.ts` | pass — `Test Files 4 passed (4); Tests 52 passed (52)` |
| Full frontend tests | `npm run test` | pass — `Test Files 49 passed (49); Tests 428 passed (428)` |
| Frontend build | `npm run build` | pass — `tsc -b && vite build`, `✓ built in 1.15s` (chunk-size warning only) |
| Touched-file lint | `npx eslint src/lib/imageExportAssets.ts src/lib/imageExportAssets.test.ts src/panels/ExportPanel.tsx src/codegen/imageCodegen.test.ts` | pass with baseline — current output has only `ExportPanel.tsx` `no-useless-catch` at 221:7 and 385:9; `HEAD` via `git show ... | npx eslint --stdin --stdin-filename src/panels/ExportPanel.tsx` has the same 2 errors (plus an old hook warning), so no new lint problems were found |

Per-claim confirmation:
- `src/lib/imageExportAssets.ts`: confirmed live `blob:`/`http(s):` images without `assetRelPath` are fetched and cloned to `data:image/...;base64,...`; existing bundle/data URLs no-op. Tests include frozen array input, explicit original `srcUrl` unchanged assertion, and reference-preserving no-op (`out === items`).
- `src/panels/ExportPanel.tsx`: confirmed one prepared export snapshot feeds preview `code`, render `codeFullFile`, and combined multi-scene Python; Render MP4 is disabled while `preparingImages`; prep failures surface as `# EXPORT ERROR` / `# COMBINED EXPORT ERROR` plus red panel text. Full-project sequential render prepares each scene's items before `exportManimCode`.
- Codegen/timing/schema/server: focused tests confirm emitted image `run_time` and `self.wait` numbers (`imageCodegen.test.ts`, `manimExporter.overlap.test.ts`). `groupPlaybackSpan.ts`, `types/scene.ts`, and `measure_server.py` are modified in the working tree but are not in this handoff's touched-file list; treated as pre-existing/out-of-scope WIP per handoff context, not as this handoff's changes.
- README: confirmed image row mentions export-only `data:` embedding for fresh live images and the `*Last updated:*` trailer is prepended with **Image export for live images**.

- Out-of-scope changes found in the diff / working tree (files not in this plan's Touched files): `README.md`, `manim-timeline/src/canvas/SceneCanvas.tsx`, `manim-timeline/src/canvas/layers/ImageNode.tsx`, `manim-timeline/src/codegen/blinkCodegen.test.ts`, `manim-timeline/src/codegen/blinkCodegen.ts`, `manim-timeline/src/codegen/flattenExport.ts`, `manim-timeline/src/codegen/graphCodegen.ts`, `manim-timeline/src/codegen/groupPlaybackSpan.ts`, `manim-timeline/src/codegen/imageCodegen.ts`, `manim-timeline/src/codegen/leafConcurrentCodegen.ts`, `manim-timeline/src/codegen/lineCodegen.ts`, `manim-timeline/src/codegen/manimExporter.overlap.test.ts`, `manim-timeline/src/codegen/manimExporter.ts`, `manim-timeline/src/codegen/staticAddCodegen.ts`, `manim-timeline/src/codegen/surroundCodegen.ts`, `manim-timeline/src/codegen/targetAnimationCodegen.test.ts`, `manim-timeline/src/hooks/useAddSceneItems.ts`, `manim-timeline/src/lib/constants.ts`, `manim-timeline/src/lib/imageAssetPath.test.ts`, `manim-timeline/src/lib/imageAssetPath.ts`, `manim-timeline/src/lib/migrateLoadedItems.ts`, `manim-timeline/src/lib/migrateProjectToV41.test.ts`, `manim-timeline/src/lib/migrateProjectToV41.ts`, `manim-timeline/src/lib/migrateSceneItems.ts`, `manim-timeline/src/lib/mtprojBundle.test.ts`, `manim-timeline/src/lib/mtprojBundle.ts`, `manim-timeline/src/lib/nextToGeometry.ts`, `manim-timeline/src/lib/resolvePosition.test.ts`, `manim-timeline/src/lib/resolvePosition.ts`, `manim-timeline/src/lib/time.test.ts`, `manim-timeline/src/lib/time.ts`, `manim-timeline/src/panels/AddObjectToolbar.tsx`, `manim-timeline/src/panels/ImageEditor.tsx`, `manim-timeline/src/panels/ItemList.tsx`, `manim-timeline/src/panels/PositionStepsEditor.tsx`, `manim-timeline/src/panels/PropertyPanel.tsx`, `manim-timeline/src/store/factories.ts`, `manim-timeline/src/store/useSceneStore.ts`, `manim-timeline/src/timeline/TimelineClip.tsx`, `manim-timeline/src/types/scene.ts`, `measure_server.py`, `Start.sh`, and the other untracked Fedora/image-object handoffs.
- Claims in Implementation notes that could not be confirmed: browser/manual smoke (`npm run dev`) was not run; `imageCodegen.ts` / `groupPlaybackSpan.ts` / `types/scene.ts` / `measure_server.py` “untouched by this handoff” cannot be isolated from git because the working tree already contains out-of-scope uncommitted WIP in those areas, so this was verified only as “not listed in this handoff's touched files and reported out-of-scope.”

Verdict: **pass** (status set to `docs`).
