---
slug: image-objects-editor
created: 2026-09-11
status: docs
owner_role: editor-dev
next_tool: any
source: user request
---

## Plan (architect)

### Goal
Implement the editor/data side of a new still-picture object so users can import a PNG/JPG/GIF from disk, see it as a drawable timeline object on the canvas, edit its size/opacity/position/rotation, save/reopen it in `.mtproj`, and select it as a target for existing effect clips. This is handoff **1 of 2**; implement it before `2026-09-11-image-objects-codegen.md`.

### Non-goals
Do not add Manim export code in this handoff; that belongs to the codegen handoff. Do not implement animated GIF playback yet: accept GIF files as still pictures only, using the browser/Manim first-frame behavior where applicable. Do not touch `measure_server.py` because current `git status` shows it as uncommitted WIP. Do not add Copilot support for creating image items in this pass.

### Touched files
- types/
  - `manim-timeline/src/types/scene.ts` — add `ImageItem` to `SceneItem` with persisted fields: `srcUrl`, `assetRelPath?`, `fileName`, `mimeType`, `width`, `height`, `opacity`, `rotationDeg`, plus normal `SceneItemBase` timing/position/audio fields.
- lib/
  - `manim-timeline/src/lib/constants.ts` — bump `PROJECT_VERSION` from 40 to 41 for the new persisted item shape.
  - `manim-timeline/src/lib/migrateProjectToV41.ts` (new) — add an idempotent no-op/pass-through item migration so the schema chain records v41.
  - `manim-timeline/src/lib/migrateLoadedItems.ts` — wire `migrateItemsToV41` after v40.
  - `manim-timeline/src/lib/imageAssetPath.ts` (new) — derive stable `assets/textures/...` paths from `ImageItem` metadata and validate supported image extensions (`.png`, `.jpg`, `.jpeg`, `.gif`).
  - `manim-timeline/src/lib/audioAssetPath.ts` — if needed, split the existing “bundled virtual asset” helper so audio code keeps audio-only semantics while `.mtproj` can also recognize `assets/textures/` for images.
  - `manim-timeline/src/lib/mtprojBundle.ts` — embed image items from all single-scene, multi-scene, and fragment payloads under `assets/textures/*`; on open, rehydrate them to blob URLs and preserve `assetRelPath`.
  - `manim-timeline/src/lib/time.ts` — include `image` in drawable duration, active/end-time, surround/exit/blink eligibility, and target-animation eligibility for `scale`, `move`, `path`, and `rotate` only.
  - `manim-timeline/src/lib/resolvePosition.ts` — return image bbox from `width * scale` / `height * scale` so surround rects, `next_to`, and edge placement work.
  - `manim-timeline/src/lib/itemDisplayName.ts` — fallback labels such as `Image: filename.png`.
  - `manim-timeline/src/lib/itemRelationships.ts` — no special role change expected, but update comments/tests if needed so images appear as object headers.
- store/
  - `manim-timeline/src/store/factories.ts` — add `createImageItem(file, objectUrl, dimensions, startTime)` or a pure factory plus caller-supplied metadata; default duration 2s, scale 1, opacity 1, absolute position.
  - `manim-timeline/src/hooks/useAddSceneItems.ts` — add async image import action using a hidden file input; read intrinsic dimensions and map them to a conservative Manim size (fit max dimension around 3 units while preserving aspect ratio).
  - `manim-timeline/src/store/useSceneStore.ts` — include image in duplicate timing, revoke blob URLs on removal/replacement where safe, and keep existing dependency cleanup for exits/blinks/target animations.
- UI
  - `manim-timeline/src/panels/AddObjectToolbar.tsx` — add an “Image” object button accepting `image/png,image/jpeg,image/gif`.
  - `manim-timeline/src/panels/ImageEditor.tsx` (new) — edit label, replace file, width, height, lock-aspect toggle or “preserve aspect” resize controls, opacity, rotation, and positioning steps shared with other drawables if existing components permit.
  - `manim-timeline/src/panels/PropertyPanel.tsx` — route `image` to `ImageEditor`.
  - `manim-timeline/src/canvas/layers/ImageNode.tsx` (new) — render the image with `react-konva` `Image`, drag like shapes when `posSteps` are freely draggable, show transformer handles, and apply opacity/rotation.
  - `manim-timeline/src/canvas/SceneCanvas.tsx` — compute `visibleImages`, resolved positions, z-layer entries, blink/exit/target-animation preview wrappers, and image color/opacity preview behavior (scale blink only; do not invent tinting).
  - `manim-timeline/src/timeline/TimelineClip.tsx` — add a distinct style for `image` clips if the default fallback is unclear.
  - `manim-timeline/src/panels/FrameAssignmentPanel.tsx`, `ItemList.tsx`, target pickers — update only where kind-specific filtering/labels require it.
- docs/
  - `manim-timeline/README.md` — document the new Image scene item, `.mtproj assets/textures/*`, still-GIF limitation, and v41 project format note; extend the `*Last updated:*` trailer.

### Invariants at risk
- `PROJECT_VERSION` migration chain must be monotonic and every persisted shape change must be wired; enforced by `manim-timeline/src/lib/constants.ts`, `manim-timeline/src/lib/migrateLoadedItems.ts`, and `src/lib/migrateProjectToV*.test.ts`.
- `.mtproj` manifest checksums must cover every embedded asset and fail on corrupt/missing assets; enforced by `manim-timeline/src/lib/mtprojBundle.ts` and `manim-timeline/src/lib/mtprojBundle.test.ts`.
- Object visibility must match Manim semantics: drawables appear from `effectiveStart` through exit end or indefinitely without exit; enforced by `manim-timeline/src/lib/time.ts` and `manim-timeline/src/lib/time.test.ts`.
- Positioning must stay pure and shared by canvas/export; enforced by `manim-timeline/src/lib/resolvePosition.ts`, `nextToGeometry.ts`, and their tests.
- Effect target eligibility must stay consistent across Add toolbar, editors, canvas preview, and export; enforced by `manim-timeline/src/lib/time.ts`, `useAddSceneItems.ts`, `BlinkAnimationEditor.tsx`, `TargetAnimationEditor.tsx`, and codegen tests in the second handoff.
- Existing uncommitted `measure_server.py` WIP must not be modified or reverted; enforced by the session `git status` review.

### Test plan
- Add `manim-timeline/src/lib/migrateProjectToV41.test.ts` with `describe('migrateItemsToV41')`: pass-through for existing v40 items; idempotence with an `ImageItem` fixture.
- Extend `manim-timeline/src/lib/mtprojBundle.test.ts` under a new `describe('image texture assets')`: packs a single-scene image to `assets/textures/...`, rehydrates it to a blob URL with `assetRelPath`; repeats for multi-scene payload; fails when manifest lists a texture with wrong MD5.
- Add `manim-timeline/src/lib/imageAssetPath.test.ts`: derives sanitized `.png/.jpg/.jpeg/.gif` texture paths, honors `assetRelPath`, rejects/normalizes unknown extensions.
- Extend `manim-timeline/src/lib/time.test.ts`: `image` is active like other drawables; can be exit/surround/blink target; can be target-animation target for `scale/move/path/rotate` and not `color`.
- Extend `manim-timeline/src/lib/resolvePosition.test.ts`: image bbox drives `next_to` spacing and `to_edge` placement.
- Add a small component/unit test only if existing UI test patterns exist for `ImageEditor`/toolbar; otherwise rely on TypeScript/build plus manual verification.
- Exact commands from `manim-timeline/`:
  - `npx vitest run src/lib/migrateProjectToV41.test.ts src/lib/mtprojBundle.test.ts src/lib/imageAssetPath.test.ts src/lib/time.test.ts src/lib/resolvePosition.test.ts`
  - `npm run test`
  - `npm run build`
  - `npm run lint`

### Open questions
Empty. The plan uses the user's stated fallback: still-picture support first; animated GIF playback is deferred.

## Implementation notes (editor-dev)

What changed, per file (all paths under `manim-timeline/` unless noted):

- `src/types/scene.ts` — added `ImageItem` (`kind: 'image'`; persisted `srcUrl`, `assetRelPath?`, `fileName`, `mimeType`, `width`/`height` in Manim units, `opacity`, `rotationDeg`, plus standard `SceneItemBase` timing/position/audio); added it to the `SceneItem` union; widened `PosStepNextTo.refKind` with `'image'` so images can be `next_to` references.
- `src/lib/constants.ts` — `PROJECT_VERSION` 40 → 41.
- `src/lib/migrateProjectToV41.ts` (new) + `src/lib/migrateProjectToV41.test.ts` (new) — idempotent pass-through migration; test covers v40 pass-through and image idempotence.
- `src/lib/migrateLoadedItems.ts` — wired `migrateItemsToV41` after v40.
- `src/lib/imageAssetPath.ts` (new) + `src/lib/imageAssetPath.test.ts` (new) — supported extensions (png/jpg/jpeg/gif), `deriveImageAssetRelPath` (`assets/textures/…`, pinned `assetRelPath` wins, unknown ext → `.png`), `isBundledVirtualImageUrl`, `guessImageMime`, `fitImageToManimSize` (longest side → 3 units), `clampImageOpacity`.
- `src/lib/audioAssetPath.ts` — intentionally untouched: existing `isBundledVirtualAudioUrl` already recognizes `assets/textures/`, so no split was needed.
- `src/lib/mtprojBundle.ts` — pack embeds image items from single-scene, multi-scene, and fragment payloads under `assets/textures/*` (deduped paths, manifest MD5); unpack rehydrates virtual texture paths to blob URLs preserving `assetRelPath`; pack-failure message generalized to "asset(s) (audio or image)".
- `src/lib/time.ts` — `image` added to surround/exit/blink eligibility (via `canBeSurroundTarget`) and `runDuration`; `canBeTargetAnimationTargetKind` allows `scale/move/path/rotate` for `image`, excludes `color`.
- `src/lib/resolvePosition.ts` — `getItemBBox` returns `width*scale × height*scale` for images (safe fallbacks 3×2).
- `src/lib/itemDisplayName.ts` — fallback `Image: <filename>`.
- `src/lib/itemRelationships.ts` — comment only (images are `object` headers automatically).
- `src/store/factories.ts` — `createImageItem({srcUrl, fileName, mimeType, width, height, startTime?})`: 2 s duration, absolute position, opacity 1.
- `src/hooks/useAddSceneItems.ts` — `addImageFiles` (validates, object URL, intrinsic dims → fitted Manim size) + `addImageViaPicker` (hidden file input, `image/png,image/jpeg,image/gif`, multi).
- `src/store/useSceneStore.ts` — `duplicateItem` handles `image` (shares blob URL with the clone); orphan-safe `blob:` revoke on remove/replace/scene-load (`revokeImageBlobUrlIfOrphaned`, `revokeImageBlobUrls`).
- `src/panels/AddObjectToolbar.tsx` — "Image" button + icon.
- `src/panels/ImageEditor.tsx` (new) — Base (label, file info `dir="auto"`, replace-file, delete), Style (W/H with aspect lock, opacity), Animation/Audio (visible-at-start, timing, audio binding), Positioning (X/Y/scale/rotation + `PositionStepsEditor`); reuses `NumberInput`, `PropertyTabs`, `PositionStepsEditor`, `AudioBindingSelect`, `VisibleAtSceneStartRow`, `TargetAnimationEffectsNote`.
- `src/panels/PropertyPanel.tsx` — routes `image` → `ImageEditor`.
- `src/canvas/layers/ImageNode.tsx` (new) — Konva `Image` centered on resolved position, drag when freely draggable, transformer bakes scale into W/H, loading/missing placeholder, `previewRotationDeltaDeg` support.
- `src/canvas/SceneCanvas.tsx` — `visibleImages` memo, `image` canvas entries, resolved positions, `PlaybackWrap` (exit/blink-scale/TA scale+rotate; color blink ignored for images).
- `src/timeline/TimelineClip.tsx` — `image` clip style (`bg-stone-600/85`).
- `src/panels/ItemList.tsx` — `image` kind badge (`Img`).
- `src/panels/PositionStepsEditor.tsx` — images eligible as `next_to` refs, `refKind: 'image'` mapping, `[Img]` option labels.
- `src/lib/time.test.ts`, `src/lib/resolvePosition.test.ts`, `src/lib/mtprojBundle.test.ts` — extended per plan (image timing/eligibility, bbox + `next_to`/`to_edge`, texture pack/rehydrate/multi-scene/MD5-fail).
- `manim-timeline/README.md` — Image row in Scene-items table, `Version 41` format note, `assets/textures/*` populated, trailer extended.

Deviations from the plan (with reasons):

- Touched two out-of-scope-adjacent files, both one-spot and required for the planned behavior/tests: `src/lib/nextToGeometry.ts` (`alignBoxForItemAt` image branch — otherwise `next_to` spacing ignores image size and the planned `resolvePosition` test fails) and `src/lib/migrateSceneItems.ts` (allow `'image'` in `refKind` normalization — otherwise every project load rewrites image `next_to` refs to `'line'`). No codegen/server files touched.
- Did not add Copilot image creation (per Non-goals); `src/agent/validate.ts` untouched.
- Did not add Manim export for images (belongs to `2026-09-11-image-objects-codegen.md`): new `image` leaves are currently skipped by export filters (all have default-tolerant branches, build is green).
- Known limitation (follow-up candidate): `src/lib/projectFragment.ts` `remapSceneItem` has no `image` branch, so fragment import remaps the image id but not its `posSteps.refId`/`audioTrackId` refs. Absolute-positioned images import fine; `next_to`-linked ones need that follow-up.
- `measure_server.py` untouched (still shows as pre-existing uncommitted WIP).

Commands run (from `manim-timeline/`) and results:

- `npx vitest run src/lib/migrateProjectToV41.test.ts src/lib/mtprojBundle.test.ts src/lib/imageAssetPath.test.ts src/lib/time.test.ts src/lib/resolvePosition.test.ts` → 5 files, 49 tests, all pass.
- `npm run test` → 47 files, 400 tests, all pass.
- `npm run build` (`tsc -b && vite build`) → pass, built in ~1 s (chunk-size warning only, pre-existing).
- `npm run lint` → 53 problems repo-wide, but all are pre-existing: verified by stashing my changes and re-linting the 4 touched files that appear (`time.ts`, `PropertyPanel.tsx`, `useSceneStore.ts`, `TimelineClip.tsx`) → same 9 errors + 1 warning at HEAD. Every file I created or substantively edited lints clean (0 errors, 0 warnings).
- Browser smoke check (`npm run dev`) not run; no `.env`/server dependency for these editor paths, and canvas rendering follows the existing `ShapeNode` pattern.

Anything left undone: the codegen handoff (`2026-09-11-image-objects-codegen.md`) is still `planned` and must run next; the fragment-remap follow-up above is the only editor-side gap.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Focused lib tests | `npx vitest run src/lib/migrateProjectToV41.test.ts src/lib/mtprojBundle.test.ts src/lib/imageAssetPath.test.ts src/lib/time.test.ts src/lib/resolvePosition.test.ts` | pass — `Test Files 5 passed (5); Tests 49 passed (49)` |
| Full frontend tests | `npm run test` | pass — `Test Files 47 passed (47); Tests 400 passed (400)` |
| Frontend build | `npm run build` | pass — `tsc -b && vite build`; Vite completed with only chunk-size warning (`✓ built in 1.05s`) |
| Lint | `npm run lint` | pass with baseline caveat — command reports `48 problems (39 errors, 9 warnings)`, but the same `48 problems` appear at HEAD in a detached worktree; touched-file reports (`time.ts`, `PropertyPanel.tsx`, `useSceneStore.ts`, `TimelineClip.tsx`) are pre-existing line-shifted issues, and new files are not reported |

- Out-of-scope changes found in the diff (files not in "Touched files"):
  - `manim-timeline/src/lib/nextToGeometry.ts` and `manim-timeline/src/lib/migrateSceneItems.ts` are outside the original list but declared in Implementation notes; the diffs are one-spot/minimal and justified by image `next_to` sizing and preserving `refKind: 'image'` during load normalization.
  - `measure_server.py` is modified in the working tree and outside this plan. It is unstaged (`git diff --cached --stat` empty), matching the "do not stage/touch server WIP" constraint, but verifier cannot prove authorship/pre-existence.
  - Untracked handoff docs are present outside this plan: `docs/handoffs/2026-09-11-fedora-dev-setup.md`, `docs/handoffs/2026-09-11-fedora-run-local-app.md`, and `docs/handoffs/2026-09-11-image-objects-codegen.md`. The current handoff file is also untracked as the workflow artifact being verified.
- Claims in "Implementation notes" that could not be confirmed:
  - Could not independently confirm that `measure_server.py` was pre-existing WIP before the implementer; only confirmed it is unstaged and outside the frontend diff.
  - Browser smoke check was not run by verifier.
- Confirmed invariant checks: `PROJECT_VERSION = 41`; `migrateItemsToV41` is wired after v40 with `migrateProjectToV41.test.ts`; `ImageItem` is in the `SceneItem` union and `PosStepNextTo.refKind`; `.mtproj` embeds/rehydrates `assets/textures/*` with checksum tests; README documents v41/textures and extends the trailer.

Verdict: **pass**.
