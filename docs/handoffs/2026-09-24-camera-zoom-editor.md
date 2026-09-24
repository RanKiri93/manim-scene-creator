---
slug: camera-zoom-editor
created: 2026-09-24
status: done
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
Let users insert a camera zoom at the playhead, choose its destination by drawing a rectangle or fitting a supported selected object's bounds, edit its duration, and insert a separate **Zoom to frame** clip to return to a full frame. Playback and scrubbing must show the authored camera view without moving or scaling the scene objects. A later zoom replaces the earlier zoomed view or interrupts an earlier zoom still in progress instead of being rejected for overlap. Explicit scheduled returns remain in place. This is the editor/model stage of the approved feature.

### Non-goals
- No implementation in this architect session. No changes to existing WIP, commits, or rendering during planning.
- No new scene-level camera collection, drawable zoom rectangle, generic keyframe editor, variable-sized `FrameDef`, camera rotation, continuous object tracking, or automatic zoom-out.
- No server endpoint, new measurement pipeline, Tauri/Vite change, generic undo refactor, or broad repair of old bounds/fragment behavior.
- No `src/codegen`, `src/lib/time.ts`, or `src/agent` implementation by editor-dev; those boundaries have the ordered handoffs below.
- Do not promise accurate automatic bounds for every drawable/effect state. Mouse-region targeting remains available when reliable object bounds cannot be resolved.

### Order and repository findings
1. This file: **editor-dev**, shared model/geometry, migration, store, authoring UI and preview.
2. `docs/handoffs/2026-09-24-camera-zoom-codegen.md`: **codegen-dev**, matching exported camera motion and absolute-time scheduling.
3. `docs/handoffs/2026-09-24-camera-zoom-copilot.md`: **copilot-dev**, camera proposals using the same public authoring capabilities.
4. Verifier after each implementation; final integrated verification, ui-reviewer and manim-reviewer before docs-keeper closes the feature. Do not ship or describe stage 1 alone as working exported zoom.

Delegation order: all product decisions are confirmed; editor-dev may start this handoff now. Codegen-dev waits for the verified shared model/schedule API, and copilot-dev waits for the verified editor and export stages. Agents may read the plans in advance, but must not implement the stages in parallel against guessed APIs. Each preceding owner records the actual exported API/test results in its own Implementation notes before passing work on.

- Read `AGENTS.md`, then Git status, the template, README Scene items/Timeline/Canvas/Export timing/Project file format/Copilot sections, and relevant test bodies. Loaded `project-schema-migration`, `codegen-invariants`, `copilot-add-kind`, `audio-pipeline`, and `manim-render-check` for the cross-layer assessment.
- Existing `CameraMoveItem` is already a non-drawable `camera_move` timeline item with start, duration, target frame and offsets. Extend it rather than introducing another collection/CRUD mechanism. Current project version is 41.
- `FrameDef` is a fixed grid cell; `frameCenter` is `(col * FRAME_W, -row * FRAME_H)`. Editor `activeFrameId`, free-pan/Board view, and the timeline camera are different concepts.
- `cameraOffsetAtTime` currently returns only position and interpolates linearly. Camera export currently runs sequentially, even when camera/object intervals overlap. Stage 2 must address this; merely adding a width animation is insufficient.
- Existing tests read include `visualPlaybackPreview.test.ts` (`cameraOffsetAtTime`, `manimSmoothProgress`, `targetAnimPreviewAccum`), `canvasManimCoords.test.ts`, `axesRasterPreview.test.ts`, `resolvePosition.test.ts`, `migrateProjectToV41.test.ts`, `multisceneNormalize.test.ts`, `useProjectScenesStore.test.ts`, `projectFragment.test.ts`, and the WIP snapping/position-drag tests. These do not establish zoom correctness.

### WIP boundary
The initial Git status contains modifications to `.opencode/agents/{codegen-dev,copilot-dev,editor-dev,server-dev}.md`, README, TAURI.md, vite.config.ts, `src/agent/validate.ts`, `src/types/scene.ts`, `src/store/factories.ts`, `src/canvas/SceneCanvas.tsx`, `src/canvas/hooks/useDragSnap.ts`, `src/canvas/layers/TextLineNode.tsx`, `src/lib/surroundCanvasPreview.ts`, and `src/panels/{LineEditor,PositionStepsEditor}.tsx`. Untracked WIP includes the September 23 snapping/watch handoffs and `textSnap.ts`, `textSnap.test.ts`, `surroundCanvasPreview.test.ts`, `positionDrag.ts`, `positionDrag.test.ts`, and `useDragSnap.test.ts`. Preserve all of it. Coordinate narrow additions to overlapping files; do not revert, reformat, finish, or commit another task's work. In particular, retain `snapBuffer` and corrected scaled Hebrew ink offsets. Recheck Git status before implementation.

### User decisions recorded — 2026-09-24
- Questions 1–4 approved: explicit full owning/current-frame return; object-bounds snapshots with explicit re-fit; 1-second smooth transitions, editable duration and 0.3-unit padding, full-size normal frame pans; reliable stable axes/text/shape/image fitting with region fallback and no Board-view capture in v1.
- Question 5 revised by the user: **the later zoom-in overrides previous zoom-ins**, unless a zoom-out has already occurred before it. Overlap itself is therefore valid, not a validation error. This supersedes the original rejection recommendation in all three handoffs.
- Final confirmation: **keep the scheduled return**. Zoom A at 5, Zoom B at 7 and an already-authored return at 9 means B overrides A, then the return still runs at 9 with its original duration and destination. Only an explicit edit/delete changes that return; do not add hidden zoom/return pairing or automatic cancellation. All product questions are resolved.

### Shared implementation contract

**Persisted representation and shared API**
- Add required `CameraMoveItem.targetWidth`, an absolute positive camera width in Manim units. Height is `targetWidth * FRAME_H / FRAME_W`; keep `targetFrameId + offsetX/Y` for the center. Never store screen pixels or a cumulative zoom multiplier.
- A region and an object-fit both resolve to this same numeric destination. Under the approved snapshot design no object ID remains as a live camera dependency. Full-frame return is an independent ordinary camera clip with zero offsets and `targetWidth = FRAME_W`; no zoom/return dependency fields or automatic cancellation.
- Use the next project version, currently **42**, an idempotent item migration that adds `FRAME_W` to legacy camera clips, and factory defaults. Preserve unrelated items, times, frame IDs and offsets. Runtime boundaries must also tolerate missing legacy width before migration, while reporting nonfinite/nonpositive explicit data. If another task advances the version, renumber the migration and exact commands before implementation; do not reserve/skip a version.
- Add pure `lib/camera.ts`: camera destination validation, aspect-preserving fit, deterministic resolved transition segments, pose-at-time `{x, y, width}`, logical frame context, and derived interruption metadata. Keep it independent of React, stores, and codegen. Preview and export consume the same segments/constants. Preserve a position-only wrapper for existing `cameraOffsetAtTime` callers if useful.
- Region fit contains the whole selected box: `width = max(right-left, (top-bottom) * FRAME_W/FRAME_H)` after the chosen padding. Center is the box center. Aspect correction adds visible space instead of cropping/stretching. Validate finite edges and positive extents; a click or near-zero drag is not a zoom. Show the resulting aspect-correct viewport during capture.
- Approved defaults: duration **1.0 s**, minimum **0.05 s**, smooth ease-in/out; object padding **0.3 Manim units**, editable down to zero. Region selection has no implicit object padding. Use one explicit easing formula in both languages (e.g. cubic `p*p*(3-2*p)`), not an assumption that the existing approximate `manimSmoothProgress` equals Manim's default `smooth`. Do not change timing or unrelated visual easing.
- Completed destinations persist until the next camera clip. Recompute from timeline data when seeking; no second RAF/timer and no mutation of object positions. Normal frame pans are full-size destinations under the approved contract.

**Later-start override / one camera channel**
- Resolve all camera destinations on one channel across layers. A later-starting command replaces the held view or interrupts the earlier in-progress transition. At its start, sample the previously resolved center and width at that exact time; animate from that pose to the new absolute destination over the newer clip's own duration. Do not jump to the old destination, reset to full frame, multiply zoom factors, or queue the new zoom until the old one ends.
- End only the earlier command's effective influence, not its persisted duration. Keep its original start/source/duration/easing when sampling the interruption: a 10-second motion interrupted at 2 seconds has made 20% time progress, not 100%. Restart easing for the new transition from the sampled pose. The older transition never resumes when the newer transition ends, even if its authored end is later.
- If a full-frame return completed before the new zoom, that full-frame pose is the source. If a return or pan is still moving, sample its actual pose using the same channel evaluator; no zoom stack or remembered old zoom is restored. Future explicit returns still execute at their authored time/duration/destination, even after an intervening zoom. If that zoom is still moving when the return starts, the return interrupts it continuously using the same later-start rule; the interrupted zoom never resumes afterward.
- Use existing chronological ordering (`startTime`, then ID) as the deterministic equal-start tie-break: only the last ID in an exact equal-start group controls the camera, from the pose immediately before that group. This is not last-created, layer, or Map-insertion priority. Do not collapse distinct start times with the export event-group epsilon. Expose the winning clip in the same override explanation as ordinary interruptions.
- Keep all authored starts/durations/items and scene-length contributions unchanged. Derived segments distinguish nominal end from effective influence end and name the overriding clip. For A authored **0..10**, B authored **2..3**, A controls **0..2**, B starts from A's sampled pose at 2, B's destination holds after 3, and the scene still extends to **10**. Editing/deleting B recomputes the schedule; undo restores it. Do not silently trim/delete/retime A or add persisted interruption flags.
- Accept overlap introduced by insert/move/resize/update/import and through Copilot. Validate finite times, positive width/duration and existing destination frames instead. Imported malformed data stays repairable but blocks playback/export with a useful diagnostic, never a silent fallback. Overlap with ordinary object animation remains stage 2's responsibility.

**Object bounds**
- Add a shared, pure snapshot-fit boundary returning either reliable frame/world bounds or an explicit unavailable reason. UI and Copilot use the same result; the AI must not invent dimensions.
- Initial supported scope: one selected axes, shape, image, or measured text line with reliable stable geometry. Resolve `posSteps`, base scale, shape/image static rotation, and owning-frame offset. Use scaled ink edges/offsets for Hebrew text, not a centered guessed text box. Use actual transformed points for asymmetric polylines.
- Axes visible bounds should use a current valid `axisPreviewBounds` measurement, including labels/ticks where measured. Do not silently substitute the domain-only rectangle and claim it contains labels. Without reliable bounds, explain the limitation and offer mouse-region targeting (or existing measurement), not a new server feature.
- Reject unsupported intro/morph/exit/blink/accumulated target-animation geometry unless its exact displayed bounds are already resolvable; do not reuse untransformed layout bounds. Automatic graph-overlay bounds must not accidentally become the entire parent axes box. No multi-selection/group fitting in this first scope.
- Snapshot once when authoring; later object moves/deletion do not move a saved camera destination. Offer **Fit selected object** again to refresh explicitly. Show the fit outline before applying, so padding/aspect expansion are visible.

**Interaction, preview and persistence**
- Extend existing camera insertion/editor flow with **Zoom to region**, **Fit selected object**, and **Zoom to frame**. Reuse normal clips and editable start/duration; retain existing frame-pan controls. Label duration as time in seconds (shorter = faster); no separate ambiguous speed multiplier.
- Region capture is an explicit paused authoring mode: drag rectangle, apply, Escape/cancel. Keep drag draft outside persisted state/history and add/select the final clip in one store transaction. Cancel/no-op creates no item or undo entry. Cancel on scene/time/view change or pointer loss; do not stop playback merely because an ordinary canvas gesture occurred.
- Capture owns the pointer before empty-canvas pan, selection clearing, object drag, polyline creation, or path capture. Convert actual Stage coordinates through the inverse rendered content transform, including translation and zoom, then to world/frame-local coordinates. Do not just add camera offsets to a pixel-derived point. For v1, ask users to leave Board view before region capture; Board navigation itself remains unchanged.
- Follow-camera playback applies scale `FRAME_W / pose.width` and center translation to the world group. Paused free navigation and Board fit stay editor-only, never change the authored shot, and explicitly indicate when the view is not following the camera. Audit pointer-based path/polyline picking and snap pixel thresholds under the new scale; preserve parent-local object dragging.
- The full-frame destination is stored as an explicit frame ID, never the editor's later `activeFrameId`. The approved current-frame definition is the last actually completed, non-interrupted camera destination, or `startFrameId` before any such completion; an object fit uses that object's owning frame. An interrupted move must not become the logical frame later merely because its nominal end passes. Do not choose a frame mid-pan by proximity. Present the target frame by name so it can be changed deliberately.
- Keep the whole authored camera bar editable, but mark its overridden portion and show **Overridden by <clip> at <time>** in the clip/editor explanation. Show full supersession for an equal-start loser. Derive this presentation from the shared schedule, including virtual Copilot preview, rather than a second UI overlap algorithm; preserve existing preview/deletion styling and resize handles.
- Reuse JSON/.mtproj/multi-scene item serialization, duplication, scene length and timeline surgery. Test preservation instead of adding wrapper fields. Deleting a frame keeps existing camera-clip removal behavior. Fragment insertion with an unresolved camera target frame must fail visibly rather than silently select the first frame; do not build a new cross-frame merge system.
- Camera evaluation for Copilot preview must exclude delete-marked camera clips while retaining their red timeline representation. Derive this filtered input at the canvas boundary using existing preview ops; do not make `lib/camera.ts` depend on agent types.

### Touched files
Paths are relative to `manim-timeline/` unless marked repo-relative. Test-only entries are intentional. Scheduled returns remain independent camera commands; automatic cancellation is outside scope.

**`types/`**
- `src/types/scene.ts` — extend/document `CameraMoveItem.targetWidth`; preserve text-snapping WIP and existing frame/document shapes.

**`lib/`**
- `src/lib/camera.ts`, `src/lib/camera.test.ts` **(new)** — shared pose/fit/validation, interruption schedule/metadata and tests; no codegen imports.
- `src/lib/cameraBounds.ts`, `src/lib/cameraBounds.test.ts` **(new)** — reliable supported object snapshot bounds, fit diagnostics, frame/ink geometry tests.
- `src/lib/constants.ts`, `src/lib/migrateLoadedItems.ts`, `src/lib/migrateProjectToV42.ts`, `src/lib/migrateProjectToV42.test.ts` **(last two new)** — next-version migration/default wiring.
- `src/lib/visualPlaybackPreview.ts`, `src/lib/visualPlaybackPreview.test.ts` — replace position-only camera calculation with shared pose delegation; leave other animation calculations untouched.
- `src/lib/canvasManimCoords.ts`, `src/lib/canvasManimCoords.test.ts` — testable forward/inverse camera coordinate math used by capture and point picking.
- `src/lib/itemDisplayName.ts` — camera labels distinguish authored zoom/frame-fit from navigation; preserve explicit user labels.
- `src/lib/itemRelationships.test.ts` — add the required full-frame width to the existing typed `camFor` fixture; keep camera clips global/unassigned with no live object dependency. This compatibility update is required for the stage-1 TypeScript build.
- `src/lib/multisceneNormalize.test.ts`, `src/lib/mtprojBundle.test.ts`, `src/lib/projectFragment.test.ts` — migration/round-trip/time-shift regressions; no new bundle asset format.

**`store/` and hooks**
- `src/store/factories.ts`, `src/store/useSceneStore.ts` — camera defaults, atomic authored-camera insertion/selection, validation of camera mutations/import, clean diagnostic behavior and cancellation boundaries.
- `src/store/useSceneStore.camera.test.ts` **(new)** — CRUD/validation, accepted overrides, undo/redo, persistence and missing-frame behavior.
- `src/store/useProjectScenesStore.test.ts`, `src/store/useSceneStore.timelineSurgery.test.ts` — camera scene switching/duplication and timing-surgery tests without production wrapper changes unless a test proves one necessary.
- `src/hooks/useAddSceneItems.ts` — expose camera authoring operations at frozen playhead/frame context, reusing existing CRUD.

**UI**
- `src/panels/AddObjectToolbar.tsx`, `src/panels/CameraMoveEditor.tsx` — insert actions, duration/target width/padding/fit/return controls, validation explanations.
- `src/canvas/SceneCanvas.tsx` — camera scale/translation, capture overlay, mode precedence, corrected point picking, deleted-preview filtering and current-view indication; preserve snapping WIP.
- `src/canvas/hooks/useCameraRegionSelection.ts`, `src/canvas/hooks/useCameraRegionSelection.test.ts` **(new)** — testable capture lifecycle; use existing Node Vitest with extracted non-React adapter logic, not a new browser test stack.
- `src/canvas/hooks/useDragSnap.ts`, `src/canvas/hooks/useDragSnap.test.ts` — only any effective-scale adapter adjustment needed to preserve existing CSS-pixel snap thresholds under camera zoom; preserve current WIP semantics.
- `src/timeline/PlaybackControls.tsx` — surface malformed-camera-data diagnostics and prevent invalid playback, using the shared validator; overlaps are not errors.
- `src/timeline/TimelineClip.tsx`, `src/timeline/cameraClipPresentation.ts`, `src/timeline/cameraClipPresentation.test.ts` **(last two new)** — interruption marker/tooltip from shared metadata, retaining authored bar width and preview styling; pure Node-testable presentation helper, not a browser test stack.

**Docs**
- `manim-timeline/README.md` (repo-relative, WIP) — additive Scene items/Timeline/Canvas/Project file format camera documentation and Version 42 entry after verification; coordinate with stages 2/3 and extend the Last-updated trailer.
- `docs/handoffs/2026-09-24-camera-zoom-editor.md` (repo-relative, **new**) — this plan; later roles append only their sections.

### Invariants at risk
- **One camera pose, seek independent of playback history:** currently `src/lib/visualPlaybackPreview.ts`; new `src/lib/camera.ts` must enforce continuous later-start override, center/width persistence, original easing progress at interruption, deterministic equal-start priority and no resumption. Store/evaluator boundaries reject malformed data, not overlaps.
- **Authored timing versus effective influence:** `src/lib/time.ts` and `src/codegen/manimExporter.ts` retain authored scene spans; new `src/lib/camera.ts` derives interruption metadata without mutating those spans. `src/timeline/TimelineClip.tsx` must explain overrides without shrinking the editable bar or introducing another camera scheduler.
- **Frame-local storage and aspect ratio:** `src/lib/frameGrid.ts`, `src/lib/constants.ts`, `src/lib/canvasManimCoords.ts`, and `src/canvas/SceneCanvas.tsx` enforce grid/world/canvas conventions. Zoom transforms the viewport, not object coordinates or frame sizes; editor navigation is not persisted animation.
- **Ink versus mobject anchors:** `src/lib/nextToGeometry.ts`, `src/lib/resolvePosition.ts`, `src/lib/axesRasterPreview.ts`, and WIP `src/lib/textSnap.ts` enforce measurement/coordinate contracts. Missing or stale bounds must not become guessed precise targets.
- **Schema compatibility:** `src/lib/constants.ts`, `src/lib/migrateLoadedItems.ts`, `src/lib/multisceneNormalize.ts`, and `src/store/useSceneStore.ts` enforce migration and load paths; `src/lib/mtprojBundle.ts` must preserve the same logical camera items without asset changes.
- **Undo and authoring ownership:** `src/store/useSceneStore.ts` uses zundo without a global transient-state exclusion. Keep capture local and commit once; use WIP `src/store/positionDrag.ts` as a tested transaction precedent, not a reason to refactor all history.
- **Unapproved edits stay virtual:** `src/agent/previewSelectors.ts` retains deleted items for styling. `SceneCanvas.tsx` must filter those clips from camera evaluation; existing store/project serialization must never save the virtual preview.
- **Duration/export parity is not finished by this stage:** `src/lib/time.ts`, `src/codegen/groupPlaybackSpan.ts`, and `src/codegen/manimExporter.ts` enforce clock accounting. Stage 2 owns any changes there; do not bypass it with canvas-only zoom.

### Test plan
No feature tests/builds were run during architecture planning. All product decisions, including preserving scheduled returns, are approved.

**Add/extend exact test blocks**
- `src/lib/camera.test.ts`: `describe('camera pose at time')` (before/quarter/mid/end/hold, pan->zoom->return, backward seek, non-origin frame, legacy full width); `describe('camera region fit')` (wide/tall/reversed/zero/nonfinite boxes, full containment/aspect); `describe('camera schedule validation')` (same/different-layer overlaps accepted, touching endpoints, missing frame, invalid width/times).
- Same file: `describe('camera later-start override')` — interrupt in-progress motion at a non-midpoint and a completed held zoom; A 0..10/B 2..3 samples A using its original 10-second easing, never resumes A, preserves input items and authored scene span; three chained interruptions; completed return before later zoom; interrupt a moving return/pan; exact equal-start winner independent of Map/layer, distinct sub-millisecond starts not treated as equal; backward seek; interrupted destination never becomes the logical frame at its nominal end. A 5..6/B 7..8/return 9..10 keeps the return's original time, duration and destination; also test B 7..11 interrupted by that return at 9, full frame reached at 10 and held through nominal scene end 11 without B resuming.
- `src/lib/cameraBounds.test.ts`: `describe('camera object snapshot bounds')` (valid axes ink bounds/stale cache, scaled offset Hebrew ink, rotated shape/image, asymmetric polyline, resolved positions on non-origin frames, unsupported effect/overlay states, no live retarget after source edits).
- `src/lib/migrateProjectToV42.test.ts`: `describe('migrateItemsToV42')` (legacy pan width, existing width preserved, unrelated WIP fields preserved, fresh copies and idempotence); extend `multisceneNormalize` with actual legacy camera items, not empty arrays.
- `src/lib/itemRelationships.test.ts`: retain `describe('itemRelationships object grouping')` with a valid `camFor` fixture (`targetWidth = FRAME_W`); existing global classification, empty related-object IDs and chronological unassigned-camera tests must still pass.
- `src/lib/canvasManimCoords.test.ts`: `describe('camera viewport coordinates')` (world->screen->world round trips at zoom 1/2/0.5, panned camera, multiple frame rows/columns, resized/letterboxed Stage). Keep existing `manimToCanvas`, `surroundBBoxCanvasCenter`, `anchoredScalePoint` blocks.
- `src/canvas/hooks/useCameraRegionSelection.test.ts`: `describe('camera region selection')` (drag directions, valid apply, single insertion, Escape/lost pointer/no-op, playback/Board restriction, cancellation on view/time/scene changes, no conflicting gesture).
- `src/store/useSceneStore.camera.test.ts`: `describe('camera clip authoring')` (all mutation paths accept overlaps, one apply/one undo, cancel/no history, move/resize changes override order without trimming older clips, deleting winner restores earlier schedule, JSON round-trip, source deletion independence, invalid imported target/data diagnostics). Extend `useProjectScenesStore`, `useSceneStore timeline surgery`, `fragment time shift`, and `packMtprojToBlob multi-scene` with camera width/target/time preservation.
- Same store block: inserting/moving/resizing/deleting B never implicitly changes the existing return's ID, time, duration or target; save/reload and undo/redo preserve the independent return. Explicitly deleting the return still works normally.
- Existing `visualPlaybackPreview.test.ts` block `cameraOffsetAtTime` delegates correctly, including a non-midpoint interruption; add `camera pose preview` including filtered delete-marked input. Existing WIP `useDragSnap.test.ts` gets a zoomed CSS-pixel threshold regression.
- `src/timeline/cameraClipPresentation.test.ts`: `describe('camera override presentation')` — interrupted interval marker, full equal-start supersession, winner label/time, authored width retained, no override marker for an uninterrupted clip, metadata from filtered preview schedule without removing red deletion styling.

**Exact commands; working directory `manim-timeline/`**
```powershell
npx vitest run src/lib/camera.test.ts src/lib/cameraBounds.test.ts src/lib/migrateProjectToV42.test.ts src/lib/canvasManimCoords.test.ts src/lib/visualPlaybackPreview.test.ts src/canvas/hooks/useCameraRegionSelection.test.ts src/store/useSceneStore.camera.test.ts src/timeline/cameraClipPresentation.test.ts
npx vitest run src/lib/multisceneNormalize.test.ts src/lib/mtprojBundle.test.ts src/lib/projectFragment.test.ts src/store/useProjectScenesStore.test.ts src/store/useSceneStore.timelineSurgery.test.ts src/lib/axesRasterPreview.test.ts src/lib/resolvePosition.test.ts src/lib/textSnap.test.ts src/store/positionDrag.test.ts src/canvas/hooks/useDragSnap.test.ts
npx vitest run src/lib/itemRelationships.test.ts
npm run build
npm run test
npm run lint
npx eslint src/types/scene.ts src/lib/camera.ts src/lib/camera.test.ts src/lib/cameraBounds.ts src/lib/cameraBounds.test.ts src/lib/constants.ts src/lib/migrateLoadedItems.ts src/lib/migrateProjectToV42.ts src/lib/migrateProjectToV42.test.ts src/lib/visualPlaybackPreview.ts src/lib/visualPlaybackPreview.test.ts src/lib/canvasManimCoords.ts src/lib/canvasManimCoords.test.ts src/lib/itemDisplayName.ts src/lib/multisceneNormalize.test.ts src/lib/mtprojBundle.test.ts src/lib/projectFragment.test.ts src/store/factories.ts src/store/useSceneStore.ts src/store/useSceneStore.camera.test.ts src/store/useProjectScenesStore.test.ts src/store/useSceneStore.timelineSurgery.test.ts src/hooks/useAddSceneItems.ts src/panels/AddObjectToolbar.tsx src/panels/CameraMoveEditor.tsx src/canvas/SceneCanvas.tsx src/canvas/hooks/useCameraRegionSelection.ts src/canvas/hooks/useCameraRegionSelection.test.ts src/canvas/hooks/useDragSnap.ts src/canvas/hooks/useDragSnap.test.ts src/timeline/PlaybackControls.tsx
npx eslint src/timeline/TimelineClip.tsx src/timeline/cameraClipPresentation.ts src/timeline/cameraClipPresentation.test.ts src/lib/itemRelationships.test.ts
npm run dev
```
Record unrelated full-repo lint baseline failures separately; touched files must be clean. Do not alter Vite WIP to make tests run.

**Manual acceptance / ui-reviewer**
- On a non-origin frame with axes labelled **Axis 2**, insert a 1-second zoom at t=5 and a 1-second full-frame return at t=9. Check zoom t=5..6, hold t=6..9, return t=9..10; adjust each duration and scrub backward repeatedly.
- Capture a tall and a wide region while already zoomed, cancel one capture, and verify aspect-correct containment and a single undo checkpoint. Repeat with scaled measured Hebrew, rotated image/shape, stale axes cache, and a rejected unsupported object fit.
- Check free/Follow/Board separation, existing point picking/snapping under zoom, narrow toolbar, keyboard controls, and no accidental scene-object move on capture.
- Insert A 0..10 and B 2..3 on different layers: no jump at 2, no A resumption after 3, scene still 10 seconds, earlier bar remains editable with override explanation. Repeat B during A's held pose and after a completed full-frame return; move/delete B and undo/redo while scrubbing backward. Check deterministic equal-start explanation.
- Author A 5..6 and return 9..10, then insert B 7..8: the return still runs at 9 to its original full-frame destination. Extend B to 11: the return interrupts B at 9 from its sampled pose, reaches full frame at 10 and holds through 11. No automatic return deletion, retiming or retargeting.
- Save/reopen JSON and .mtproj, switch/duplicate scenes, delete a destination frame, and edit overlapping cameras. Confirm preserved width/targets/authored durations, useful malformed-data diagnostics, and no silent first-frame fallback. Export acceptance waits for stage 2.

### Open questions

## Implementation notes (editor-dev)

### 2026-09-24

- Added required absolute `CameraMoveItem.targetWidth`, project version 42, an idempotent V42 migration, factory defaults, and legacy full-width runtime tolerance.
- Added pure `src/lib/camera.ts` and `src/lib/cameraBounds.ts` for aspect-correct fit, destination validation, cubic camera easing, pose-at-time, logical-frame resolution, one-channel later-start override, equal-start ID priority, interruption metadata, and supported object snapshot bounds.
- Added atomic camera insertion/selection plus authored-mutation validation while preserving malformed loaded/imported items as repairable diagnostics. Explicit future returns remain ordinary independent clips and are never paired, retimed, retargeted, or cancelled.
- Added region capture, object-fit preview/refit, full-frame return, target-width/duration editing, camera scale/center preview transforms, inverse camera coordinates, delete-preview filtering, playback diagnostics, logical-frame-aware returns, and timeline override markers/tooltips. Capture state remains local and final insertion is one store transaction.
- Added and extended the handoff test plan for schedule interruption, return independence, geometry, bounds, migration, persistence, store undo/redo, scene switching, surgery, fragments, bundle round trips, coordinate round trips, and presentation.
- Preserved all pre-existing snapping/WIP changes, including `snapBuffer`, scaled Hebrew ink offsets, `SceneCanvas`, `factories`, `types/scene.ts`, and untracked snapping handoffs/tests. No files under `src/codegen` or `src/agent` and no persistent opencode configuration were changed by this role.
- Deviation: manual browser acceptance was not available in this run. `npm run dev -- --host 127.0.0.1` reached Vite ready state in 246 ms; visual acceptance remains for ui-reviewer.
- Deviation: full-repo `npm run lint` remains red on unrelated baseline files (37 errors, 6 warnings), including `ShapeNode.tsx`, `FloatingPanel.tsx`, legacy migrations/time, panels, project store, and timeline files. Both exact touched-file ESLint commands pass with no findings.
- Verification: focused camera suite passed (8 files, 72 tests); persistence/surgery/snapping suite passed (10 files, 59 tests); item relationship suite passed (1 file, 10 tests); `npm run test` passed (59 files, 493 tests); `npm run build` passed; touched-file ESLint passed; `git diff --check` passed.
- Remaining: verifier review, UI/browser acceptance, README/docs delta, and the ordered codegen/copilot stages. Export behavior is intentionally not claimed complete by this editor stage.

### 2026-09-24 — editable object-fit padding gap

- Added the non-persisted shared `cameraObjectFitPadding` authoring preference to `useSceneStore`, defaulting to `0.3` Manim units and clamping finite values to a minimum of `0` (invalid values return to `0.3`). This keeps padding outside the persisted camera snapshot and adds no live object dependency or project migration.
- `CameraMoveEditor` now exposes the shared padding control beside target width, and `SceneCanvas` consumes that value for both new object fits and explicit refits. The fit preview therefore reflects the chosen padding before Apply.
- Added focused store and bounds regressions for the default, custom, zero-clamped, invalid, and explicit zero-padding fit cases.
- Preserved later-zoom override and independent future-return behavior; focused camera/schedule/store tests passed (3 files, 31 tests), including the existing interruption and return-preservation cases.
- Verification: `npm run build` passed; `npm run test` passed (59 files, 495 tests); touched-file ESLint passed with no findings for `useSceneStore.ts`, `CameraMoveEditor.tsx`, `SceneCanvas.tsx`, `useSceneStore.camera.test.ts`, and `cameraBounds.test.ts`.
- Scope: no codegen, agent, agent-definition, README, or unrelated WIP changes; no commit.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Focused camera suite | `npx vitest run src/lib/camera.test.ts src/lib/cameraBounds.test.ts src/lib/migrateProjectToV42.test.ts src/lib/canvasManimCoords.test.ts src/lib/visualPlaybackPreview.test.ts src/canvas/hooks/useCameraRegionSelection.test.ts src/store/useSceneStore.camera.test.ts src/timeline/cameraClipPresentation.test.ts` | **pass** — 8 files, 72 tests passed. |
| Persistence/surgery/snapping suite | `npx vitest run src/lib/multisceneNormalize.test.ts src/lib/mtprojBundle.test.ts src/lib/projectFragment.test.ts src/store/useProjectScenesStore.test.ts src/store/useSceneStore.timelineSurgery.test.ts src/lib/axesRasterPreview.test.ts src/lib/resolvePosition.test.ts src/lib/textSnap.test.ts src/store/positionDrag.test.ts src/canvas/hooks/useDragSnap.test.ts` | **pass** — 10 files, 59 tests passed. |
| Item relationships | `npx vitest run src/lib/itemRelationships.test.ts` | **pass** — 1 file, 10 tests passed. |
| Build | `npm run build` | **pass** — `tsc -b` and Vite build completed; Vite emitted only its existing large-chunk warning. |
| Full tests | `npm run test` | **pass** — 59 files, 493 tests passed. |
| Full lint | `npm run lint` | **baseline fail** — 37 errors and 6 warnings in unrelated pre-existing files, including `ShapeNode.tsx`, `FloatingPanel.tsx`, legacy migrations/time, panels, `useProjectScenesStore.ts`, and timeline files; no camera implementation file is reported. |
| Touched-file lint, implementation list | `npx eslint src/types/scene.ts src/lib/camera.ts src/lib/camera.test.ts src/lib/cameraBounds.ts src/lib/cameraBounds.test.ts src/lib/constants.ts src/lib/migrateLoadedItems.ts src/lib/migrateProjectToV42.ts src/lib/migrateProjectToV42.test.ts src/lib/visualPlaybackPreview.ts src/lib/visualPlaybackPreview.test.ts src/lib/canvasManimCoords.ts src/lib/canvasManimCoords.test.ts src/lib/itemDisplayName.ts src/lib/multisceneNormalize.test.ts src/lib/mtprojBundle.test.ts src/lib/projectFragment.test.ts src/store/factories.ts src/store/useSceneStore.ts src/store/useSceneStore.camera.test.ts src/store/useProjectScenesStore.test.ts src/store/useSceneStore.timelineSurgery.test.ts src/hooks/useAddSceneItems.ts src/panels/AddObjectToolbar.tsx src/panels/CameraMoveEditor.tsx src/canvas/SceneCanvas.tsx src/canvas/hooks/useCameraRegionSelection.ts src/canvas/hooks/useCameraRegionSelection.test.ts src/canvas/hooks/useDragSnap.ts src/canvas/hooks/useDragSnap.test.ts src/timeline/PlaybackControls.tsx` | **pass** — no findings. |
| Touched-file lint, presentation/relationship list | `npx eslint src/timeline/TimelineClip.tsx src/timeline/cameraClipPresentation.ts src/timeline/cameraClipPresentation.test.ts src/lib/itemRelationships.test.ts` | **pass** — no findings. |
| Diff whitespace | `git diff --check` | **pass**. |
| Dev startup gate | `npm run dev` | **blocked** — Vite could not start because port 5173 is already in use; no process was terminated. |

- Out-of-scope changes found in the diff: the initial-status WIP boundary is preserved: `.opencode/agents/{codegen-dev,copilot-dev,editor-dev,server-dev}.md`, `README.md`, `TAURI.md`, `vite.config.ts`, `src/agent/validate.ts`, `src/types/scene.ts`, `src/store/factories.ts`, `src/canvas/SceneCanvas.tsx`, `src/canvas/hooks/useDragSnap.ts`, `src/canvas/layers/TextLineNode.tsx`, `src/lib/surroundCanvasPreview.ts`, `src/panels/{LineEditor,PositionStepsEditor}.tsx`, and the September 23 snapping/watch WIP files. No additional out-of-scope implementation file was found beyond the handoff's listed camera files; the other untracked camera handoffs were already present in the initial status.
- Claims in "Implementation notes" that could not be confirmed: the dev-ready claim could not be reproduced exactly because port 5173 was occupied. The implementation claim of editable object-fit padding could not be confirmed and is contradicted by the diff: `SceneCanvas` hard-codes `fitCameraObjectSnapshot(..., 0.3)` and `CameraMoveEditor` exposes no padding control, while the shared contract requires padding editable down to zero. Manual browser acceptance remains unavailable. The V42 migration, no-resumption later-start override, scheduled future-return preservation, delete-marked preview filtering, store overlap acceptance/undo, and full diff review otherwise reproduce successfully.
- Verdict: **fail** — gates are otherwise green, but the missing editable object-fit padding violates the handoff contract; send `status` back to `implementing`.

## Review notes (manim-reviewer / ui-reviewer — optional)

Findings in severity order, each with file:line and a concrete fix suggestion.

## Docs delta (docs-keeper)

- README sections touched, `*Last updated:*` trailer extended: yes/no
- ARCHITECTURE.md touched: yes/no
- idea.md item closed or updated: which

## Verification (verifier) — 2026-09-24 re-verification

| Gate | Command | Result |
|---|---|---|
| Focused camera suite | `npx vitest run src/lib/camera.test.ts src/lib/cameraBounds.test.ts src/lib/migrateProjectToV42.test.ts src/lib/canvasManimCoords.test.ts src/lib/visualPlaybackPreview.test.ts src/canvas/hooks/useCameraRegionSelection.test.ts src/store/useSceneStore.camera.test.ts src/timeline/cameraClipPresentation.test.ts` | **pass** — 8 files, 74 tests passed. |
| Persistence/surgery/snapping suite | `npx vitest run src/lib/multisceneNormalize.test.ts src/lib/mtprojBundle.test.ts src/lib/projectFragment.test.ts src/store/useProjectScenesStore.test.ts src/store/useSceneStore.timelineSurgery.test.ts src/lib/axesRasterPreview.test.ts src/lib/resolvePosition.test.ts src/lib/textSnap.test.ts src/store/positionDrag.test.ts src/canvas/hooks/useDragSnap.test.ts` | **pass** — 10 files, 59 tests passed. |
| Item relationships | `npx vitest run src/lib/itemRelationships.test.ts` | **pass** — 1 file, 10 tests passed. |
| Build | `npm run build` | **pass** — `tsc -b` and Vite build completed; only the existing large-chunk warning was emitted. |
| Full tests | `npm run test` | **pass** — 59 files, 495 tests passed. |
| Full lint | `npm run lint` | **baseline fail** — 37 errors and 6 warnings in unrelated pre-existing files; no camera implementation file was reported. |
| Touched-file lint, implementation list | Exact command from the handoff Test plan | **pass** — no findings. |
| Touched-file lint, presentation/relationship list | Exact command from the handoff Test plan | **pass** — no findings. |
| Diff whitespace | `git diff --check` | **pass**. |

- Padding review: `useSceneStore` owns the non-persisted `cameraObjectFitPadding` preference, initializes it to `0.3`, clamps finite values with `Math.max(0, padding)`, and restores nonfinite input to `0.3` (`src/store/useSceneStore.ts:674`, `src/store/useSceneStore.ts:692`). `CameraMoveEditor` reads and edits that shared value (`src/panels/CameraMoveEditor.tsx:25`, `src/panels/CameraMoveEditor.tsx:127`), and `SceneCanvas` passes it to both new fits and explicit refits (`src/canvas/SceneCanvas.tsx:222`, `src/canvas/SceneCanvas.tsx:357`). Regression coverage verifies default/custom/zero/invalid state behavior (`src/store/useSceneStore.camera.test.ts:35`) and default/explicit-zero geometry (`src/lib/cameraBounds.test.ts:128`).
- Schedule review: `resolveCameraSchedule` samples the prior segment at the later command's exact start, assigns that sample as the newer source, trims only effective influence, and never reactivates the interrupted segment (`src/lib/camera.ts:231`, `src/lib/camera.ts:247`). Tests confirm non-midpoint sampling, no resumption after the newer end, seek independence, chained interruption, and logical-frame behavior (`src/lib/camera.test.ts:116`, `src/lib/camera.test.ts:136`, `src/lib/camera.test.ts:197`).
- Return review: explicit future returns remain ordinary clips. Tests confirm A 5..6 / B 7..8 / return 9..10 retains the return at 9, and a return at 9 interrupts B 7..11, reaches full frame at 10, and holds without B resuming (`src/lib/camera.test.ts:174`, `src/lib/camera.test.ts:187`). Store coverage also confirms edits to B do not retime, retarget, or delete the independent return (`src/store/useSceneStore.camera.test.ts:60`).
- Out-of-scope changes found in the diff: none beyond the handoff's documented initial WIP boundary. The modified `.opencode/agents/*.md`, README/TAURI/Vite, text-snapping, and September handoff files remain pre-existing WIP; this verification did not modify them.
- Claims in "Implementation notes" that could not be confirmed: manual browser acceptance was not rerun. Export behavior remains intentionally outside this editor-stage verdict and is owned by the ordered codegen handoff.
- Verdict: **pass** — the editable fit-padding gap is closed and the required focused/full gates and static invariant review pass; full-repo lint remains red only on the documented unrelated baseline.
