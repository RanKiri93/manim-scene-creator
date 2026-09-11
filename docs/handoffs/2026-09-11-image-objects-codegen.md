---
slug: image-objects-codegen
created: 2026-09-11
status: docs
owner_role: codegen-dev
next_tool: any
source: user request
---

## Plan (architect)

### Goal
Add Manim export/playback for the `image` item introduced by `2026-09-11-image-objects-editor.md`: generated Python should define an `ImageMobject`, size/position it like the canvas, play its entry animation, and let existing exit, blink-scale, target move/path/scale/rotate, surrounding-rect, concurrency, visible-at-start, and audio-timing machinery treat it as a normal drawable leaf. This is handoff **2 of 2** and must start only after the editor/data handoff is implemented.

### Non-goals
Do not implement animated GIF frame playback; GIF exports as a still image. Do not add server endpoints or touch `measure_server.py` (currently uncommitted WIP). Do not add Copilot image creation. Do not change existing text/axes/graph/shape emitted Python except where a shared switch must include the new image leaf.

### Touched files
- codegen/
  - `manim-timeline/src/codegen/imageCodegen.ts` (new) — emit `ImageMobject(...)`, optional embedded-data fallback helper if `assetRelPath` is unavailable, `set_opacity`, width/height scaling, rotation, positioning steps, and `FadeIn`/`GrowFromCenter`/static-add play blocks.
  - `manim-timeline/src/codegen/manimExporter.ts` — assign stable vars (`image_1`), include image defs/pos/play in the right order, add frame variable membership, import any helper modules needed for embedded image data only when used.
  - `manim-timeline/src/codegen/flattenExport.ts` — include `ImageItem` in `ExportLeaf`, flattening, and `next_to` dependency ordering.
  - `manim-timeline/src/codegen/groupPlaybackSpan.ts` — return bound-audio scene clock for image leaves or `Math.max(0.05, image.duration)` without audio.
  - `manim-timeline/src/codegen/leafConcurrentCodegen.ts` — add concurrent `Succession(Wait(rel), FadeIn/GrowFromCenter(image), optional audio tail)` branch whose emitted seconds match `groupPlaybackSpan.ts`.
  - `manim-timeline/src/codegen/staticAddCodegen.ts` — include images in `visibleAtSceneStart` `self.add(...)`.
  - `manim-timeline/src/codegen/graphCodegen.ts` — add image var resolution to `resolveExitTargetsForExport` so exits, surrounding rects, blink, and target animations can target images.
  - `manim-timeline/src/codegen/blinkCodegen.ts` — support image scale blink; explicitly no-op or reject color blink for images in sync with the editor handoff.
  - `manim-timeline/src/codegen/targetAnimationCodegen.ts` — allow image move/path/scale/rotate through the existing generic mobject animation paths; keep color unsupported.
  - `manim-timeline/src/codegen/lineCodegen.ts` — if `resolveRecordedPlayback` / audio-bound leaf helpers use kind-specific unions, include image without changing audio semantics.
- lib/
  - `manim-timeline/src/lib/time.ts` — only if the editor handoff did not finish target eligibility/duration updates; otherwise do not touch.
- docs/
  - `manim-timeline/README.md` — update export/per-leaf duration table to include `image`, document exported Manim uses `ImageMobject`, and extend the `*Last updated:*` trailer.

### Invariants at risk
- `sequentialAnimSecondsForLeaf` must equal the Manim seconds emitted for an image leaf, including audio tails and concurrent branches; enforced by `manim-timeline/src/codegen/groupPlaybackSpan.ts`, `manimExporter.ts`, `leafConcurrentCodegen.ts`, and `manimExporter.overlap.test.ts`.
- Generated Manim text rules must remain untouched: text still uses only `HebrewMathLine`; enforced by `manim-timeline/src/codegen/lineCodegen.ts` and `.cursor/rules/manim-text-and-point-accuracy.mdc`.
- Axes must still emit explicit `x_range`/`y_range`; enforced by `manim-timeline/src/codegen/graphCodegen.ts` and `.cursor/rules/manim-axes-domain.mdc`.
- Export order must define any `next_to` reference before dependents; enforced by `manim-timeline/src/codegen/flattenExport.ts` and `manimExporter.ts`.
- Exit/blink/target-animation target resolution must map every eligible UI target to exactly the on-scene Manim mobject(s); enforced by `manim-timeline/src/codegen/graphCodegen.ts`, `blinkCodegen.ts`, `targetAnimationCodegen.ts`, and their tests.
- `.mtproj` image asset paths used in Python must match editor-side `assetRelPath` / embedded-data fallback; enforced by `manim-timeline/src/lib/imageAssetPath.ts`, `mtprojBundle.ts`, and new image codegen tests.

### Test plan
- Add `manim-timeline/src/codegen/imageCodegen.test.ts` with `describe('imageCodegen')`: emits `ImageMobject` with a sanitized/stable path; applies width/height/opacity/rotation; emits positioning steps including `absolute`, `to_edge`, and `next_to`; emits `FadeIn(..., run_time=duration)` for entry.
- Extend `manim-timeline/src/codegen/manimExporter.overlap.test.ts`: image leaf followed by later line preserves `self.wait(...)`; overlapping image + shape merges into one `AnimationGroup`; visible-at-scene-start image emits `self.add(image_1)` and consumes zero intro seconds.
- Extend `manim-timeline/src/codegen/blinkCodegen.test.ts`: image scale blink emits image var `.animate.scale(...)`; image color blink is rejected/no-op according to editor-side eligibility decision.
- Extend `manim-timeline/src/codegen/targetAnimationCodegen.test.ts`: image move/path/rotate use the image var in `.animate.shift`, `MoveAlongPath`, and `.animate.rotate`.
- Extend `manim-timeline/src/codegen/shapeCodegen.test.ts` only if shared positioning helpers are moved/reused; otherwise leave shape tests untouched.
- Exact commands from `manim-timeline/`:
  - `npx vitest run src/codegen/imageCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/codegen/blinkCodegen.test.ts src/codegen/targetAnimationCodegen.test.ts`
  - `npm run test`
  - `npm run build`
  - `npm run lint`
- Because generated Python shape changes, request `manim-reviewer` after implementation for a static generated-code review. Render only a tiny PNG fixture scene with `-ql` if the reviewer asks for it.

### Open questions
Empty. Animated GIF playback is intentionally deferred as above.

## Implementation notes (codegen-dev)

What changed, per file:

- `manim-timeline/src/codegen/imageCodegen.ts` (new) — emits `ImageMobject(...)` from deterministic `assets/textures/*` paths, with a `data:image/...;base64` temp-file fallback helper when no `assetRelPath` is available; applies exact `stretch_to_fit_width`, `stretch_to_fit_height`, clamped `set_opacity`, scale-before-placement, all normal `posSteps` (`absolute`, `to_edge`, `next_to`, `shift`, `set_x`, `set_y`), and final canvas-compatible rotation. Playback emits `FadeIn(image_N)` with exact `run_time`, respects `visibleAtSceneStart`, and shares the existing bound-audio tail helpers.
- `manim-timeline/src/codegen/manimExporter.ts` — assigns stable `image_1`, `image_2`, … variables; emits image defs/positioning/playback in the existing definitions/positioning/playback phases; includes images in frame-shift membership and `next_to` export validation; adds `base64`, `os`, and `tempfile` imports only when an exported image uses the embedded-data fallback.
- `manim-timeline/src/codegen/flattenExport.ts` — includes `ImageItem` in `ExportLeaf`, flattens `image` top-level leaves, and lets image leaves participate in `next_to` dependency ordering.
- `manim-timeline/src/codegen/groupPlaybackSpan.ts` — image leaves now consume `sceneClockSecForLeafBoundPlayback(...)` when audio-bound, otherwise `Math.max(0.05, leaf.duration)`, matching emitted `run_time`/tail waits.
- `manim-timeline/src/codegen/leafConcurrentCodegen.ts` — image leaves have a concurrent `Succession(Wait(rel), FadeIn(image_N), ...)` branch with exact `run_time` and shared audio-tail handling; removed a pre-existing unused `_audioItems` parameter from `clusterConcurrentVisualPlayback` and its caller so touched codegen files lint clean.
- `manim-timeline/src/codegen/staticAddCodegen.ts` — includes images in `visibleAtSceneStart` `self.add(image_N)`.
- `manim-timeline/src/codegen/graphCodegen.ts` — `resolveExitTargetsForExport` returns image vars so exits, surrounding rectangles, blink-scale, and generic target animations can target images.
- `manim-timeline/src/codegen/blinkCodegen.ts` — image scale blink uses the generic mobject `.animate.scale(...)` path; image color blink is explicitly no-op, matching editor eligibility (`color` target animation is unsupported for images).
- `manim-timeline/src/codegen/targetAnimationCodegen.ts` — no production change required; once image vars resolve and `canBeTargetAnimationTarget` rejects image color, existing move/path/scale/rotate paths work for images.
- `manim-timeline/src/codegen/lineCodegen.ts` — `ExportLeafWithAudio` includes `ImageItem`, so bound-audio lookup/run-time/tail semantics apply unchanged.
- Tests added/extended: `imageCodegen.test.ts` (new), `manimExporter.overlap.test.ts`, `blinkCodegen.test.ts`, `targetAnimationCodegen.test.ts`. The overlap tests assert exact image `run_time=` and `self.wait(...)` values derived by hand: image `0..1.5` followed by line at `3.0` produces `self.wait(1.5000)`; scene-start image consumes zero intro seconds and final hold padding is `self.wait(2.0000)`.
- `manim-timeline/README.md` — image row now documents `ImageMobject`, per-leaf duration table includes `image`, `.mtproj` helper typo fixed, and the `*Last updated:*` trailer now records the codegen/export behavior.

Deviations from plan:

- Did not modify `src/codegen/targetAnimationCodegen.ts` production code because the existing generic mobject code paths already support images after target resolution and lib eligibility from the editor handoff.
- Did not touch `src/lib/time.ts`; the prerequisite editor handoff already added image duration/eligibility.
- Did not touch `measure_server.py` or any Python server file. It remains pre-existing uncommitted WIP in the working tree.
- The working tree still contains prerequisite editor/data changes from `2026-09-11-image-objects-editor.md`; those are required for this handoff to compile but are outside this codegen handoff's new production changes.

Commands run (from `manim-timeline/`) and result:

- `npx vitest run src/codegen/imageCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/codegen/blinkCodegen.test.ts src/codegen/targetAnimationCodegen.test.ts` → pass, `Test Files 4 passed (4); Tests 38 passed (38)`.
- `npm run test` → pass, `Test Files 48 passed (48); Tests 411 passed (411)`.
- `npm run build` → pass, `✓ built in 709ms` (Vite chunk-size warning only).
- `npm run lint` → repo-wide baseline still fails with unrelated/pre-existing issues (`47 problems (38 errors, 9 warnings)`). Targeted lint over all touched/new codegen files is clean: `npx eslint src/codegen/imageCodegen.ts src/codegen/imageCodegen.test.ts src/codegen/manimExporter.ts src/codegen/flattenExport.ts src/codegen/groupPlaybackSpan.ts src/codegen/leafConcurrentCodegen.ts src/codegen/staticAddCodegen.ts src/codegen/graphCodegen.ts src/codegen/blinkCodegen.ts src/codegen/blinkCodegen.test.ts src/codegen/targetAnimationCodegen.ts src/codegen/targetAnimationCodegen.test.ts src/codegen/lineCodegen.ts src/codegen/manimExporter.overlap.test.ts` → pass, no output.

Codegen-invariants checklist:

- `groupPlaybackSpan.ts` updated for image emitted seconds: yes.
- Tests assert exact `self.wait(...)` / `run_time=` values derived by hand: yes (`imageCodegen.test.ts`, `manimExporter.overlap.test.ts`).
- `npm run test` and `npm run build` green: yes.
- README per-leaf duration table and trailer updated: yes.
- Generated Python shape changed: yes — please run `manim-reviewer` static generated-code review. Low-quality render only if reviewer asks.

Anything left undone:

- Animated GIF frame playback remains intentionally deferred; exported GIF is passed to `ImageMobject` as a still image/first frame.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Targeted codegen vitest | `npx vitest run src/codegen/imageCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/codegen/blinkCodegen.test.ts src/codegen/targetAnimationCodegen.test.ts` | pass — `Test Files 4 passed (4); Tests 38 passed (38)` |
| Full frontend tests | `npm run test` | pass — `Test Files 48 passed (48); Tests 411 passed (411)` |
| Frontend build | `npm run build` | pass — `tsc -b && vite build`; `✓ built in 750ms` (chunk-size warning only) |
| Repo lint | `npm run lint` | baseline fail outside touched codegen — `47 problems (38 errors, 9 warnings)`, first error in `src/canvas/layers/ShapeNode.tsx:203:5` |
| Targeted touched-codegen lint | `npx eslint src/codegen/imageCodegen.ts src/codegen/imageCodegen.test.ts src/codegen/manimExporter.ts src/codegen/flattenExport.ts src/codegen/groupPlaybackSpan.ts src/codegen/leafConcurrentCodegen.ts src/codegen/staticAddCodegen.ts src/codegen/graphCodegen.ts src/codegen/blinkCodegen.ts src/codegen/blinkCodegen.test.ts src/codegen/targetAnimationCodegen.ts src/codegen/targetAnimationCodegen.test.ts src/codegen/lineCodegen.ts src/codegen/manimExporter.overlap.test.ts` | pass — no output |
| Working-tree audit | `git status --short`; `git diff --stat` | pass with expected WIP caveat — codegen/README touched files are present; prerequisite editor/data and server WIP are listed below |

- Diff/invariant checks confirmed:
  - `imageCodegen.ts` emits `ImageMobject`, stable/fallback path setup, width/height/opacity, positioning, rotation, `FadeIn(..., run_time=...)`, and audio-tail handling.
  - `manimExporter.ts` assigns stable `image_N` vars, defines/positions/plays images, includes frame membership and surrounding-rect positioning for images, validates `next_to` image refs, and imports `base64`, `os`, `tempfile` only when `imageNeedsEmbeddedDataHelper(...)` is true.
  - `flattenExport.ts`, `staticAddCodegen.ts`, `graphCodegen.ts`, `blinkCodegen.ts`, and `lineCodegen.ts` include images in export leaves, static add, target resolution, image color-blink no-op, and audio-bound leaf union respectively.
  - `groupPlaybackSpan.ts` image branch uses `sceneClockSecForLeafBoundPlayback(...)` or `Math.max(0.05, duration)`, matching `generateImagePlay(...)` and the concurrent image branch in `leafConcurrentCodegen.ts`.
  - Tests assert emitted `run_time`/`self.wait` numbers for image leaves: `imageCodegen.test.ts` (`run_time=1.750000`) and `manimExporter.overlap.test.ts` (`run_time=1.500000`, `self.wait(1.5000)`, concurrent `run_time=2.000000`, scene-start `self.wait(2.0000)`).
  - README image row, per-leaf duration table, `.mtproj` image-assets note, version-41 note, and `*Last updated:*` trailer are updated.

- Out-of-scope changes found in the working tree (files not attributed to this codegen handoff):
  - Existing prerequisite editor/data image-object WIP: `manim-timeline/src/canvas/SceneCanvas.tsx`, `manim-timeline/src/canvas/layers/ImageNode.tsx`, `manim-timeline/src/hooks/useAddSceneItems.ts`, `manim-timeline/src/lib/constants.ts`, `manim-timeline/src/lib/imageAssetPath.ts`, `manim-timeline/src/lib/imageAssetPath.test.ts`, `manim-timeline/src/lib/itemDisplayName.ts`, `manim-timeline/src/lib/itemRelationships.ts`, `manim-timeline/src/lib/migrateLoadedItems.ts`, `manim-timeline/src/lib/migrateProjectToV41.ts`, `manim-timeline/src/lib/migrateProjectToV41.test.ts`, `manim-timeline/src/lib/migrateSceneItems.ts`, `manim-timeline/src/lib/mtprojBundle.ts`, `manim-timeline/src/lib/mtprojBundle.test.ts`, `manim-timeline/src/lib/nextToGeometry.ts`, `manim-timeline/src/lib/resolvePosition.ts`, `manim-timeline/src/lib/resolvePosition.test.ts`, `manim-timeline/src/lib/time.ts`, `manim-timeline/src/lib/time.test.ts`, `manim-timeline/src/panels/AddObjectToolbar.tsx`, `manim-timeline/src/panels/ImageEditor.tsx`, `manim-timeline/src/panels/ItemList.tsx`, `manim-timeline/src/panels/PositionStepsEditor.tsx`, `manim-timeline/src/panels/PropertyPanel.tsx`, `manim-timeline/src/store/factories.ts`, `manim-timeline/src/store/useSceneStore.ts`, `manim-timeline/src/timeline/TimelineClip.tsx`, `manim-timeline/src/types/scene.ts`.
  - Existing server WIP noted by the prompt/implementation notes: `measure_server.py`.
  - Other untracked handoff docs already in the working tree: `docs/handoffs/2026-09-11-fedora-dev-setup.md`, `docs/handoffs/2026-09-11-fedora-run-local-app.md`, `docs/handoffs/2026-09-11-image-objects-editor.md`.

- Claims in "Implementation notes" that could not be confirmed:
  - Attribution of `measure_server.py` as pre-existing WIP cannot be proven from the diff alone; it is present and out of scope.
  - No Manim render/static reviewer was run here; the plan requests `manim-reviewer` next.

Verdict: **pass** (status set to `reviewing` because the plan requests a reviewer).

## Review notes (manim-reviewer — 2026-09-11)

Static review only; no render was needed. Targeted image/codegen tests were run with `npx vitest run src/codegen/imageCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/codegen/blinkCodegen.test.ts src/codegen/targetAnimationCodegen.test.ts` and passed.

Findings, severity order:

1. **Fail — generated Python can still emit Manim `Text(`, which violates the project text rule.** Generated Python affected: labeled surrounding-rect/image highlights emit `sr_1_lbl = Text(...)`; graph-dot labels still emit `*_lbl = Text(...)`. Source: `manim-timeline/src/codegen/surroundCodegen.ts:155` (reachable for image targets from `manim-timeline/src/codegen/manimExporter.ts:687-701`) and `manim-timeline/src/codegen/graphCodegen.ts:693`. Fix: emit `HebrewMathLine(..., font_size=..., hebrew_font="Alef")` for these labels, with string content passed through the constructor, and add tests that assert no generated `Text(`/`Tex(`/`MathTex(` for image-surround and graph-label paths.
2. **Fail — unsaved/blob-backed images export to an `assets/textures/...` path that may not exist at render time.** Generated Python affected: `image_1 = ImageMobject("assets/textures/logo.png")` even when the source item has `srcUrl: 'blob:...'` and no `assetRelPath` (codified by `manim-timeline/src/codegen/imageCodegen.test.ts:8,28`). Source: `manim-timeline/src/codegen/imageCodegen.ts:31-33` and `:62`. Fix: only emit an `assets/textures/...` path when `assetRelPath` is actually present/packaged; otherwise embed bytes from a data URL or fail export with a clear “save/bundle image asset first” error instead of generating a non-renderable path.
3. **Fail — `visibleAtSceneStart` images with bound audio can drop the audio.** Generated Python affected: static-start image export emits `self.add(image_1)` and skips `FadeIn`, but a track selected by `audioTrackId` is marked bound by `listUnboundAudioTracksForExport` and there is no later leaf play block to emit `self.add_sound(...)`. Source: `manim-timeline/src/codegen/staticAddCodegen.ts:70-71`, `manim-timeline/src/codegen/manimExporter.ts:767,949`, and `manim-timeline/src/codegen/lineCodegen.ts:159-167`. Fix: treat audio bound to scene-start leaves as timeline audio emitted at the track start (or emit it from the static-add path) and add an image-specific regression test.
4. **Fail — concurrent image playback with bound-audio tails can be time-compressed by the outer `AnimationGroup`.** Generated Python affected: overlapping image branches can emit `Succession(Wait(...), FadeIn(image_1, run_time=...), Wait(audio_tail))` inside an outer `self.play(AnimationGroup(...), run_time=<visual wall>)`, so an audio tail longer than the visual cluster wall is folded into a shorter group run time. Source: `manim-timeline/src/codegen/leafConcurrentCodegen.ts:448-457` and the cluster clock accounting in `manim-timeline/src/codegen/manimExporter.ts:1198-1251`. Fix: either remove audio-tail waits from concurrent leaf branches and pad after the cluster, or include those tails in `visualClusterWallSeconds`/`animSec`; add a regression test for an image overlapping another visual while bound to a longer audio file.

## Implementation notes (codegen-dev follow-up — 2026-09-11)

Addressed all four `manim-reviewer` findings:

- `src/codegen/surroundCodegen.ts` — changed surrounding-rectangle labels from Manim `Text(...)` to `HebrewMathLine(..., font_size=..., hebrew_font="Alef")`. This is an intentional out-of-plan touch required by the global generated-text rule and by the image surrounding-rect path.
- `src/codegen/graphCodegen.ts` — changed graph-dot labels from `Text(...)` to `HebrewMathLine(..., font_size=18, hebrew_font="Alef")`.
- `src/codegen/imageCodegen.ts` — no longer emits a guessed `assets/textures/*` path for unbundled `blob:`/`http(s):` image URLs. Export now uses a real `assetRelPath`, a virtual `assets/textures/*` URL, an embedded `data:image/...;base64` temp-file fallback, or fails with a clear “not bundled for Manim export” error.
- `src/codegen/lineCodegen.ts` — `listUnboundAudioTracksForExport` skips `visibleAtSceneStart` leaves when deciding which audio is already bound, so audio attached to a static-start image is emitted as timeline audio at the track start instead of being dropped.
- `src/codegen/leafConcurrentCodegen.ts` / `src/codegen/manimExporter.ts` — added `visualClusterManimSeconds(...)` and use it both for the outer concurrent `AnimationGroup(run_time=...)` and the exporter cursor accounting. This includes bound-audio tail waits in concurrent image (and other leaf) clusters, while preserving the existing visual wall as a lower bound.
- Tests extended in `manimExporter.overlap.test.ts` and `imageCodegen.test.ts` for: unbundled blob image export error; visible-at-scene-start image bound audio; concurrent image audio tail outer `run_time=3.0000`; and generated-label paths using `HebrewMathLine` with no `Text(`/`Tex(`/`MathTex(`.

Commands re-run after fixes (from `manim-timeline/`):

- `npx vitest run src/codegen/imageCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/codegen/blinkCodegen.test.ts src/codegen/targetAnimationCodegen.test.ts` → pass, `Test Files 4 passed (4); Tests 43 passed (43)`.
- Targeted eslint over touched/new codegen files including `surroundCodegen.ts` → pass, no output.
- `npm run test` → pass, `Test Files 48 passed (48); Tests 416 passed (416)`.
- `npm run build` → pass, `✓ built in 1.08s` (chunk-size warning only).
- `npm run lint` → repo-wide baseline still fails with unrelated/pre-existing issues, now `47 problems (38 errors, 9 warnings)`; touched codegen files are clean.

Updated codegen-invariants checklist after follow-up:

- `groupPlaybackSpan.ts` plus concurrent cluster cursor accounting now match emitted image seconds, including bound-audio tails.
- Exact wait/runtime tests added/updated and derived by hand (`run_time=1.500000`, `self.wait(1.5000)`, static hold `self.wait(2.0000)`, concurrent audio-tail outer `run_time=3.0000`).
- Full test/build green; README duration table/trailer already updated.
- Generated Python shape changed and reviewer findings were fixed; please re-run `verifier` and `manim-reviewer`.

## Verification follow-up (codegen-dev self-check — 2026-09-11)

@verifier and @manim-reviewer could not be invoked (subagent usage limit reached), so gates were re-run directly instead of by the reviewer roles:

| Gate | Command (from `manim-timeline/`) | Result |
|---|---|---|
| Targeted codegen vitest | `npx vitest run src/codegen/imageCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/codegen/blinkCodegen.test.ts src/codegen/targetAnimationCodegen.test.ts` | pass — `Test Files 4 passed (4); Tests 43 passed (43)` |
| Full frontend tests | `npm run test` | pass — `Test Files 48 passed (48); Tests 416 passed (416)` |
| Frontend build | `npm run build` | pass — `✓ built in 1.12s` (chunk-size warning only) |
| Targeted touched-codegen lint | `npx eslint` over all 15 touched/new codegen files incl. `surroundCodegen.ts` | pass — no output |

Reviewer-fix confirmation (by grep + passing regression tests):
- (a) No `Text(`/`Tex(`/`MathTex(` is emitted anywhere in `src/codegen` (only the overlap-test assertions and the `wrapSegmentForTex` LaTeX-string helper name in `texUtils.ts`); SR + graph-dot labels emit `HebrewMathLine`.
- (b) `imageCodegen.ts:44` throws the "not bundled for Manim export" error for unbundled `blob:`/`http(s):` URLs; covered by `imageCodegen.test.ts:87` and `manimExporter.overlap.test.ts:297`.
- (c) `lineCodegen.ts:161` skips `visibleAtSceneStart` leaves in `listUnboundAudioTracksForExport`; covered by the static-start image bound-audio test.
- (d) `visualClusterManimSeconds` (`leafConcurrentCodegen.ts:261`) is used for both the outer `AnimationGroup(run_time=…)` (`:760`) and exporter cursor accounting (`manimExporter.ts:1246`); covered by the `run_time=3.0000` concurrent audio-tail test.

Status stays `verifying`: a proper @verifier pass and @manim-reviewer re-review are still owed when subagent capacity returns.

## Review notes (manim-reviewer follow-up — 2026-09-11)

Subagent reached max steps before it could append to this handoff, but it returned one remaining static finding:

1. **Fail — delayed concurrent images without bound audio can still have their `FadeIn` time-compressed.** Current emitted pattern for non-audio image branches is `Succession(Wait(rel), FadeIn(image_1), run_time=imageDuration)`, so when `rel > 0`, Manim distributes the branch run time across both the wait and the fade, leaving less than `imageDuration` for the actual `FadeIn`. Source: `manim-timeline/src/codegen/leafConcurrentCodegen.ts` image branch; test expectation at `manim-timeline/src/codegen/manimExporter.overlap.test.ts`. Concrete fix: emit `FadeIn(image_1, run_time=imageDuration)` inside the `Succession` and remove the `Succession`-level `run_time`, matching the bound-audio branch shape.

## Implementation notes (codegen-dev second follow-up — 2026-09-11)

- Fixed the delayed concurrent-image finding in `src/codegen/leafConcurrentCodegen.ts`: all image concurrent branches now emit `FadeIn(image_N, run_time=...)` inside `Succession(Wait(rel), ...)`; non-audio image branches no longer put `run_time` on the whole `Succession`.
- Extended `src/codegen/manimExporter.overlap.test.ts` with a delayed image regression: shape starts at `0`, image starts at `0.5`, image duration `1.5`; expected branch is `Succession(Wait(0.5000), FadeIn(image_1, run_time=1.500000))`, and the compressed old branch is rejected.

Commands re-run after second follow-up (from `manim-timeline/`):

- `npx vitest run src/codegen/imageCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/codegen/blinkCodegen.test.ts src/codegen/targetAnimationCodegen.test.ts` → pass, `Test Files 4 passed (4); Tests 44 passed (44)`.
- Targeted eslint over all touched/new codegen files including `surroundCodegen.ts` → pass, no output.

## Verification follow-up (verifier — 2026-09-11)

| Gate | Command (from `manim-timeline/`) | Result |
|---|---|---|
| Targeted codegen vitest | `npx vitest run src/codegen/imageCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/codegen/blinkCodegen.test.ts src/codegen/targetAnimationCodegen.test.ts` | pass — `Test Files 4 passed (4); Tests 43 passed (43)` |
| Full frontend tests | `npm run test` | pass — `Test Files 48 passed (48); Tests 416 passed (416)` |
| Frontend build | `npm run build` | pass — `tsc -b && vite build`; `✓ built in 1.03s` (chunk-size warning only) |
| Targeted touched-codegen lint | `npx eslint src/codegen/imageCodegen.ts src/codegen/imageCodegen.test.ts src/codegen/manimExporter.ts src/codegen/flattenExport.ts src/codegen/groupPlaybackSpan.ts src/codegen/leafConcurrentCodegen.ts src/codegen/staticAddCodegen.ts src/codegen/graphCodegen.ts src/codegen/surroundCodegen.ts src/codegen/blinkCodegen.ts src/codegen/blinkCodegen.test.ts src/codegen/targetAnimationCodegen.ts src/codegen/targetAnimationCodegen.test.ts src/codegen/lineCodegen.ts src/codegen/manimExporter.overlap.test.ts` | pass — no output |
| Working-tree audit | `git status --short`; `git diff --stat` | pass with WIP caveat — `37 files changed` in stat plus untracked files; files outside the original plan are listed below |

Per-reviewer-fix confirmation:

- (a) Confirmed. `surroundCodegen.ts:155` and `graphCodegen.ts:693` emit `HebrewMathLine(..., hebrew_font="Alef")`; `manimExporter.overlap.test.ts:349-369` asserts both labels use `HebrewMathLine` and generated code contains no `Text(`/`Tex(`/`MathTex(`.
- (b) Confirmed. `imageCodegen.ts:31-47` uses `assetRelPath`, `assets/textures/*`, or data URLs, and throws `not bundled for Manim export` for unbundled `blob:`/`http(s):` URLs instead of guessing a texture path; `imageCodegen.test.ts:83-89` and `manimExporter.overlap.test.ts:284-299` cover the blob/export-error rejection.
- (c) Confirmed. `lineCodegen.ts:160-162` skips `visibleAtSceneStart` leaves in `listUnboundAudioTracksForExport`, so the bound track remains timeline audio; `manimExporter.overlap.test.ts:715-740` asserts exactly one `self.add_sound(...)` and no `FadeIn(image_1)` for a static-start image.
- (d) Confirmed. `visualClusterManimSeconds` exists in `leafConcurrentCodegen.ts:261-318`, includes `sequentialAnimSecondsForLeaf(...)` with audio-tail options, is used for outer `AnimationGroup(run_time=...)` in `leafConcurrentCodegen.ts:758-775`, and exporter cursor accounting in `manimExporter.ts:1242-1257`; `manimExporter.overlap.test.ts:320-346` asserts `Wait(2.000000)` and outer `run_time=3.0000`.

Codegen invariant checks:

- Exact emitted timing is asserted by tests: `imageCodegen.test.ts:76-80` (`run_time=1.750000`), `manimExporter.overlap.test.ts:278-281` (`run_time=1.500000`, `self.wait(1.5000)`), `:343-346` (`run_time=3.0000`), and `:710-712` (`self.wait(2.0000)`).
- README duration/export docs and `*Last updated:*` trailer were updated in `manim-timeline/README.md`.

Out-of-scope changes found in the working tree (files not in the original plan's **Touched files**):

- Reviewer-fix touch outside the original architect plan but required by findings: `manim-timeline/src/codegen/surroundCodegen.ts`.
- Prerequisite editor/data image-object WIP from `2026-09-11-image-objects-editor.md`: `manim-timeline/src/canvas/SceneCanvas.tsx`, `manim-timeline/src/canvas/layers/ImageNode.tsx`, `manim-timeline/src/hooks/useAddSceneItems.ts`, `manim-timeline/src/lib/constants.ts`, `manim-timeline/src/lib/imageAssetPath.ts`, `manim-timeline/src/lib/imageAssetPath.test.ts`, `manim-timeline/src/lib/itemDisplayName.ts`, `manim-timeline/src/lib/itemRelationships.ts`, `manim-timeline/src/lib/migrateLoadedItems.ts`, `manim-timeline/src/lib/migrateProjectToV41.ts`, `manim-timeline/src/lib/migrateProjectToV41.test.ts`, `manim-timeline/src/lib/migrateSceneItems.ts`, `manim-timeline/src/lib/mtprojBundle.ts`, `manim-timeline/src/lib/mtprojBundle.test.ts`, `manim-timeline/src/lib/nextToGeometry.ts`, `manim-timeline/src/lib/resolvePosition.ts`, `manim-timeline/src/lib/resolvePosition.test.ts`, `manim-timeline/src/lib/time.ts`, `manim-timeline/src/lib/time.test.ts`, `manim-timeline/src/panels/AddObjectToolbar.tsx`, `manim-timeline/src/panels/ImageEditor.tsx`, `manim-timeline/src/panels/ItemList.tsx`, `manim-timeline/src/panels/PositionStepsEditor.tsx`, `manim-timeline/src/panels/PropertyPanel.tsx`, `manim-timeline/src/store/factories.ts`, `manim-timeline/src/store/useSceneStore.ts`, `manim-timeline/src/timeline/TimelineClip.tsx`, `manim-timeline/src/types/scene.ts`.
- Existing server WIP: `measure_server.py`.
- Other unrelated/unplanned working-tree files: root `README.md`, `Start.sh`, `docs/handoffs/2026-09-11-fedora-dev-setup.md`, `docs/handoffs/2026-09-11-fedora-run-local-app.md`, `docs/handoffs/2026-09-11-image-objects-editor.md`. This handoff file itself is also updated by this verifier section.

Claims in "Implementation notes" that could not be confirmed:

- No low-quality Manim render was run; the plan only requires a static/generated-code review next, so status is set to `reviewing` for manim-reviewer re-review.

Verdict: **pass** (status set to `reviewing` because the plan/follow-up requests reviewer re-review).

## Verification final (verifier — 2026-09-11)

| Gate | Command (from `manim-timeline/`) | Result |
|---|---|---|
| Targeted codegen vitest | `npx vitest run src/codegen/imageCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/codegen/blinkCodegen.test.ts src/codegen/targetAnimationCodegen.test.ts` | pass — `Test Files 4 passed (4); Tests 44 passed (44)` |
| Full frontend tests | `npm run test` | pass — `Test Files 48 passed (48); Tests 417 passed (417)` |
| Frontend build | `npm run build` | pass — `tsc -b && vite build`; `✓ built in 1.13s` (chunk-size warning only) |
| Targeted touched-codegen lint | `npx eslint src/codegen/imageCodegen.ts src/codegen/imageCodegen.test.ts src/codegen/manimExporter.ts src/codegen/flattenExport.ts src/codegen/groupPlaybackSpan.ts src/codegen/leafConcurrentCodegen.ts src/codegen/staticAddCodegen.ts src/codegen/graphCodegen.ts src/codegen/surroundCodegen.ts src/codegen/blinkCodegen.ts src/codegen/blinkCodegen.test.ts src/codegen/targetAnimationCodegen.ts src/codegen/targetAnimationCodegen.test.ts src/codegen/lineCodegen.ts src/codegen/manimExporter.overlap.test.ts` | pass — no output |
| Working-tree audit | `git status --short`; `git diff --stat` | pass with WIP caveat — stat shows `37 files changed, 1269 insertions(+), 39 deletions(-)` plus untracked files listed by status |

Confirmations:

- Final delayed-concurrent-image fix is confirmed. `leafConcurrentCodegen.ts:512-519` builds the image branch as `Succession(Wait(rel), FadeIn(image_N, run_time=...))` with any audio tail appended, and does not put `run_time` on the image-branch `Succession`. `manimExporter.overlap.test.ts:323-340` asserts `Succession(Wait(0.5000), FadeIn(image_1, run_time=1.500000))` and rejects the old compressed `Succession(... FadeIn(image_1), run_time=1.500000)` branch.
- Prior reviewer fixes remain in place: generated label paths use `HebrewMathLine` (`surroundCodegen.ts:155`, `graphCodegen.ts:693`) and the overlap test asserts no generated `Text(`/`Tex(`/`MathTex(`; unbundled `blob:`/`http(s):` images throw the “not bundled for Manim export” error (`imageCodegen.ts:42-45`) with blob/export regressions in tests; visible-at-scene-start image audio is kept as timeline audio (`lineCodegen.ts:158-162`, overlap test asserts one `self.add_sound(...)`); concurrent image audio tails are included through `visualClusterManimSeconds` (`leafConcurrentCodegen.ts:260-318`, used by exporter at `manimExporter.ts:1246`, with `run_time=3.0000` regression coverage).
- Codegen timing invariant is covered by explicit emitted-number tests: image entry `run_time=1.750000`, sequential wait `self.wait(1.5000)`, delayed concurrent image `run_time=1.500000`, concurrent audio-tail outer `run_time=3.0000`, and scene-start hold `self.wait(2.0000)`.

Out-of-scope changes found in the working tree (files not in the original plan's **Touched files**):

- Reviewer-fix / test-plan files outside the original touched-file list: `manim-timeline/src/codegen/surroundCodegen.ts`, `manim-timeline/src/codegen/imageCodegen.test.ts`, `manim-timeline/src/codegen/manimExporter.overlap.test.ts`, `manim-timeline/src/codegen/blinkCodegen.test.ts`, `manim-timeline/src/codegen/targetAnimationCodegen.test.ts`.
- Prerequisite editor/data image-object WIP: `manim-timeline/src/canvas/SceneCanvas.tsx`, `manim-timeline/src/canvas/layers/ImageNode.tsx`, `manim-timeline/src/hooks/useAddSceneItems.ts`, `manim-timeline/src/lib/constants.ts`, `manim-timeline/src/lib/imageAssetPath.ts`, `manim-timeline/src/lib/imageAssetPath.test.ts`, `manim-timeline/src/lib/itemDisplayName.ts`, `manim-timeline/src/lib/itemRelationships.ts`, `manim-timeline/src/lib/migrateLoadedItems.ts`, `manim-timeline/src/lib/migrateProjectToV41.ts`, `manim-timeline/src/lib/migrateProjectToV41.test.ts`, `manim-timeline/src/lib/migrateSceneItems.ts`, `manim-timeline/src/lib/mtprojBundle.ts`, `manim-timeline/src/lib/mtprojBundle.test.ts`, `manim-timeline/src/lib/nextToGeometry.ts`, `manim-timeline/src/lib/resolvePosition.ts`, `manim-timeline/src/lib/resolvePosition.test.ts`, `manim-timeline/src/lib/time.test.ts`, `manim-timeline/src/panels/AddObjectToolbar.tsx`, `manim-timeline/src/panels/ImageEditor.tsx`, `manim-timeline/src/panels/ItemList.tsx`, `manim-timeline/src/panels/PositionStepsEditor.tsx`, `manim-timeline/src/panels/PropertyPanel.tsx`, `manim-timeline/src/store/factories.ts`, `manim-timeline/src/store/useSceneStore.ts`, `manim-timeline/src/timeline/TimelineClip.tsx`, `manim-timeline/src/types/scene.ts`.
- Existing server / local setup WIP: `measure_server.py`, root `README.md`, `Start.sh`, `docs/handoffs/2026-09-11-fedora-dev-setup.md`, `docs/handoffs/2026-09-11-fedora-run-local-app.md`, `docs/handoffs/2026-09-11-image-objects-editor.md`. This handoff file is also updated by this verifier section.

Claims in "Implementation notes" that could not be confirmed:

- No Manim render was run in this verifier pass; the plan only required frontend gates and reviewer/static checks.
- I confirmed the `http(s):` image rejection in code (`imageCodegen.ts` regex), but the explicit regression test covers `blob:` rather than a separate `http(s):` sample.

Verdict: **pass** (frontmatter remains `status: reviewing` because the handoff still requests reviewer re-review before docs).

## Review notes (manim-reviewer second follow-up — 2026-09-11)

Static re-review only; no Manim render was needed. Re-ran targeted image/codegen tests from `manim-timeline/`:

- `npx vitest run src/codegen/imageCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/codegen/blinkCodegen.test.ts src/codegen/targetAnimationCodegen.test.ts` → pass, `Test Files 4 passed (4); Tests 44 passed (44)`.

Follow-up confirmations:

- Latest delayed concurrent image finding is resolved: `leafConcurrentCodegen.ts:512-519` now emits `Succession(Wait(rel), FadeIn(image_N, run_time=imageDuration))` for image leaves, with no `Succession(..., run_time=imageDuration)` wrapper. The regression at `manimExporter.overlap.test.ts:323-340` asserts the fixed delayed branch and rejects the compressed old pattern.
- Image bound-audio tails remain covered: `leafConcurrentCodegen.ts:324-342, 512-519` appends tail `Wait(...)` inside the image branch, and `visualClusterManimSeconds` is used for the outer `AnimationGroup(run_time=...)` at `leafConcurrentCodegen.ts:755-772`; regression `manimExporter.overlap.test.ts:343-369` verifies the 3s audio-tail cluster.
- Static-start image audio is preserved: `lineCodegen.ts:160-162` leaves visible-at-scene-start leaves out of bound-track suppression, so `manimExporter.ts:847-849,1128-1130` emits the track as timeline audio; regression `manimExporter.overlap.test.ts:738-763` verifies one `self.add_sound("assets/audio/img.webm")` and no image `FadeIn`.
- Unbundled blob images are rejected: `imageCodegen.ts:36-47` throws a clear “not bundled for Manim export” error for `blob:`/`http(s):` sources without `assetRelPath` or data URL fallback; regressions `imageCodegen.test.ts:83-89` and `manimExporter.overlap.test.ts:284-299` cover it.
- Generated text remains HebrewMathLine-only in reviewed codegen: grep found no emitted `Text(`/`Tex(`/`MathTex(` in `src/codegen` production files; label emitters use `HebrewMathLine(..., font_size=..., hebrew_font="Alef")` at `surroundCodegen.ts:153-156` and `graphCodegen.ts:691-693`.
- Axes explicit-range invariant is unchanged: `graphCodegen.ts:102-105` still emits `Axes(` with both `x_range=[xMin, xMax, xStep]` and `y_range=[yMin, yMax, yStep]`.
- Image sizing/opacity/rotation/positioning are plausible for the UI model: `imageCodegen.ts:72-79` emits explicit width/height stretching and clamped opacity; `imageCodegen.ts:107-170` applies scale, placement steps/fallback absolute placement, and final rotation about the resolved UI position.

Findings: **none remaining**.

## Verification status update (verifier — 2026-09-11)

Reviewer second follow-up is now present with **no remaining findings**. The verification gates above passed after the second codegen-dev follow-up, so frontmatter status is set to `docs` for docs-keeper handoff.
