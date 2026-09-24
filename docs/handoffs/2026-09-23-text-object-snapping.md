---
slug: text-object-snapping
created: 2026-09-23
status: implementing
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
Make dragging text into a tidy layout comfortable: attract its visible boundary to nearby objects or an inset of its owning frame, show the prospective alignment and gap, and allow easy escape with an above-frame checkbox or a temporary modifier. The final position must agree with the positioning model, survive save/load and export, and be undoable as one gesture. The design below recommends placement assistance rather than permanent attachment; **answer the Open questions before implementation**.

### Non-goals
- No implementation in this architect task; only this handoff is created.
- No automatic reflow, collision avoidance, equal-spacing distribution, baseline typography engine, grid snapping, or segment-level snapping.
- Only text is a snapping mover initially; do not change how dragging shapes, images, or axes behaves. No new multi-selection/group drag semantics.
- No new project fields, project migration, exporter behavior, server endpoint, Copilot operation, or timeline timing change in the recommended placement-only design.
- Do not silently replace existing `posSteps` or unlock relatively positioned text. Persistent attachment needs a revised plan if requested.
- Do not turn this into a general repair of legacy bounds or animation editing. Unsupported geometry must be excluded honestly rather than approximated as precise ink.

### Repository findings and WIP boundary
- Read `AGENTS.md`, then Git status, the handoff template, README "Scene items", "Canvas (Konva)", "Export to Python", "Export timing and audio synchronization", "Project file format", and "Architecture notes". Loaded `codegen-invariants` to assess position/export compatibility; no codegen edits are proposed.
- Pre-existing WIP: `manim-timeline/README.md`, `manim-timeline/TAURI.md`, `manim-timeline/vite.config.ts`, and untracked `docs/handoffs/2026-09-23-vite-tauri-watch.md`. Preserve all of it. Coordinate a small additive README update with its current author; do not revert, reformat, or commit their work.
- `PositionStepsEditor.tsx` already defaults `next_to`/`to_edge` buffers to 0.3. `LineEditor.tsx` quick layout uses 0.3 for horizontal frame margins and 0.5 for vertical frame margins.
- `useDragSnap.ts` currently supports optional grid rounding, not object snapping; its text and axes callers do not enable grid rounding. It permits dragging only empty/all-absolute positioning chains.
- Existing text preview scales ink dimensions but not ink-center offsets (`TextLineNode.tsx`); `nextToGeometry.ts` correctly scales both in explicit ink mode. `surroundCanvasPreview.ts` has the same unscaled-offset issue. Correct this narrow preview inconsistency as a prerequisite, without changing legacy resolver semantics.
- Current drag start pauses zundo, every position write including drag end happens while paused, then tracking resumes. There is no explicit gesture checkpoint. Add regression coverage and a scoped transaction; do not assume `resume()` records a drag.
- Existing tests read: `resolvePosition.test.ts`, `nextToGeometry.test.ts`, `quickLayout.test.ts`, `canvasManimCoords.test.ts`, `useSceneStore.timelineSurgery.test.ts`, and `lineCodegen.test.ts`. No existing spatial snapping/hook or spatial undo tests were found; `surroundCanvasPreview.test.ts` does not yet exist.

### Recommended interaction contract (pending user confirmation)

#### Controls and defaults
- Add a keyboard-accessible **Snap text** checkbox next to Grid/Axes in `SceneCanvas`'s above-frame toolbar, **checked by default**. Keep it editor-session state, outside project serialization and undo, like the existing canvas switches. Allow toolbar wrapping at narrow widths.
- Tooltip/help: "Snap visible text edges to nearby objects and frame margins. Hold Alt while dragging to bypass. Does not attach objects."
- Checkbox off and Alt bypass remove attraction and guides immediately. Releasing Alt may reacquire from the raw drag proposal. Keep Ctrl/Meta selection behavior intact. Numeric positioning edits do not snap.
- Proposed defaults: **0.3 Manim units between objects**, including text-to-text; **0.3 inside left/right frame edges, 0.5 inside top/bottom edges**. These are visible edge-to-edge gaps, not center distances, font-dependent line heights, or fractions of the zoom. Use named constants, not a new settings panel in v1.
- 0.3 is a sensible starting gap for ordinary 36-point lines, not a universally optimal typographic rule. Avoid adaptive font-size-dependent gaps in v1: mixed text/math heights already enter the visible bounds, and a fixed gap is predictable. User can bypass snapping or use the existing positioning-step buffer for custom spacing.

#### Acquisition, alignment, and feedback
- Start with **8 CSS pixels to acquire / 12 CSS pixels to release**, measured before any snap correction, plus a 0.2-Manim-unit cap on acquisition correction (0.3 release cap) at tiny Board scales. These are tuning constants, independent of the 0.3 layout gap. Never use device pixels or an unscaled Konva distance as the threshold.
- Offer outside adjacency on all four object sides and inside placement at the four owning-frame margins. A gap candidate is eligible only if the perpendicular intervals overlap or are within the capture tolerance; an object far away along the other axis must not attract the drag.
- Near an adjacent object, also offer matching left/right edges for a stack and top/bottom edges for a row. Align each axis independently only within tolerance; do not force centering or force Hebrew right alignment from far away. Omit centerline and baseline magnets in v1 to reduce competing targets.
- Keep an acquired target/edge until its release threshold is crossed. Then choose the smallest screen-space correction; break equal-distance ties deterministically (stable target ID/edge order). Score from the unsnapped pointer proposal, not the last snapped node position, so the user can pull free. Check any combined X/Y result against the eligibility conditions again.
- Show only active guides: a target-edge highlight plus a short dashed guide/gap marker, labelled e.g. `0.3`. Use a non-listening overlay with stable screen-size strokes/labels inside the same world transform as the objects. Never show guides in exported content.
- This is attraction, not a hard frame clamp. A user can pull through/outside a frame, overlap objects intentionally with Alt, or drag freely when unchecked. Clear guides and latch state on drop, cancel, lost gesture, checkbox off, scene/time/view change, or unmount.

#### Bounds and candidate scope
- Put the pure solver and geometry policy in `src/lib/`, not in React handlers. Inputs: raw proposed anchor, local moving bounds, target boxes, owning-frame bounds, screen scale, configuration, and prior latch. Output: corrected anchor, chosen target/edge IDs, and guide geometry.
- For measured text, use explicit **ink** semantics, consistent with `alignBoxForItemAt(..., 'ink', ...)`. At base anchor `(x, y)` and scale `s`, local measured ink edges give `left = x + s * inkLeftX`, `right = x + s * inkRightX`, `bottom = y + s * inkBottomY`, `top = y + s * inkTopY`. Never treat a Hebrew mobject center as the ink center.
- Derive canvas image placement, selection box, and snap geometry from the same scaled ink bounds. Update both source and target text-image geometry paths and the surrounding-rectangle preview offset, without altering segment identities or styling.
- Require valid finite measured bounds for precise text snapping. While measurements are missing/stale/invalid, retain existing free-drag/fallback display and show a small "Snapping needs text measurement" explanation rather than claim an exact gap. Do not initiate new per-move server calls. Snapshot valid geometry for a gesture; cancel/rebase explicitly if the text/measurement changes, never silently re-snap an already dropped item.
- Targets: committed, currently visible objects in the **same owning frame**. Include measured text, shapes, images, and an axes domain box once per graph. Use resolved positions, not raw `item.x/y`. Shape/image bounds must account for scale and rotation; asymmetric polylines need actual transformed min/max points, not a centered width/height approximation. Bounds of circles/lines/arrows are geometric bounds, not pixel-perfect raster/stroke outlines; image bounds are its rectangle, not its alpha silhouette.
- For axes, label the guide as **Axes bounds** and use the existing explicit-domain layout rectangle. Do not imply it includes tick labels or raster ink. Individual plot paths/dots/fields and generated surrounding rectangles are not separate magnets in v1.
- Exclude self, other-frame objects, hidden/future/exited items, selected-only ghosts, unapproved Copilot preview changes, and targets whose positioning depends transitively on the mover. Dependency traversal must be cycle-safe even though the existing position resolver is not. No `src/agent` changes are needed.
- Freeze candidate geometry and stable ordering at drag start; do not let references following the mover become chasing targets. Abort safely if a relevant item is deleted or its source geometry changes.

#### Positioning, animation, and undo correctness
- Recommended persistence: commit only the existing frame-local `x/y`, with the existing empty/all-absolute `posSteps` preserved. A dropped line remains freely draggable and does **not** follow a reference after that reference moves/resizes. Existing explicit `next_to`/`to_edge` chains stay authoritative and locked. Do not insert an invisible constraint as a side effect of snapping.
- The frame boundary is the mover's owning frame (`frameGrid.ts`), not the stage border, camera viewport, or current insertion frame. Solve in a defined coordinate space; convert once between frame-local/world/canvas coordinates. Ancestor camera/Board transforms must not be applied twice to parent-local Konva node positions.
- Use both canvas dimensions and effective ancestor scale for CSS-pixel thresholds. Test positive/negative frame rows/columns, panned camera, responsive resize, and Board fit. The stored anchor must be identical for equivalent layouts viewed through different camera transforms.
- V1 snaps only while paused and with stable layout geometry. Suppress snapping for active intro/morph/exit/blink effects, nonidentity accumulated target-animation geometry (including a completed move/scale/rotation), and auto-centered compound children; explain the unavailable state rather than snapping an untransformed proxy. Base item scale and static shape/image rotation are supported. Do not bake a playback translation or compound centering shift into base coordinates. If support for these derived states is essential, expand the plan before implementation to include a tested inverse mapping; pausing alone is not sufficient.
- Apply a snapped result to the actual Konva node as well as the store/preview; repeated identical store writes may not cause React to correct Konva's position. Do not change the axes caller's optional-grid path.
- Add a text-scoped drag transaction that retains live store updates (so existing positioning dependents keep previewing), but records **exactly one** position undo checkpoint. Capture initial coordinates and tracking state; on success use a tested start-position-to-final-position commit strategy. On cancel restore only this gesture's position, not an entire stale scene snapshot. Preserve unrelated measurement/selection changes, respect already-paused tracking, and always release owned tracking pause on errors/unmount. No-op gestures must not add a history entry. No project-wide undo refactor.

### Touched files
Paths below are relative to `manim-timeline/` unless stated otherwise. This is the scope for the recommended placement-only variant; revise after answers rather than implementing an alternative implicitly.

**`lib/` — geometry and policy**
- `src/lib/textSnap.ts` **(new)** — pure ink-aware bounds/candidate eligibility, frame-local conversions needed by snapping, capture/release solver, and named gap/tolerance defaults. Reuse existing explicit ink alignment semantics; do not change `resolvePosition` or `nextToGeometry` legacy behavior.
- `src/lib/textSnap.test.ts` **(new)** — geometry, candidate filtering, solver stability, view/frame invariance, and compatibility with existing positioning helpers.
- `src/lib/surroundCanvasPreview.ts` — correct scaled text ink-center offset using the same geometry convention, so the existing highlight does not disagree with the newly corrected text rendering.
- `src/lib/surroundCanvasPreview.test.ts` **(new)** — regression for scaled, displaced Hebrew ink and unchanged unit-scale behavior.

**`store/` — gesture lifecycle**
- `src/store/positionDrag.ts` **(new)** — narrow begin/update/commit/cancel helper around existing scene-store actions and temporal API; no persisted state additions and no unrelated store/history changes.
- `src/store/positionDrag.test.ts` **(new)** — actual scene-store/zundo tests for one-step undo/redo, cancel/no-op, tracking cleanup, and preserving unrelated edits.

**UI — canvas**
- `src/canvas/SceneCanvas.tsx` — checkbox/help, snap eligibility/context from visible committed items and frame/view state, transient guide state, world-aligned overlay, and toolbar wrapping.
- `src/canvas/layers/TextLineNode.tsx` — corrected scaled ink rendering, optional snapping context, live node correction, and status for unavailable snapping; keep existing locked positioning behavior.
- `src/canvas/hooks/useDragSnap.ts` — opt-in text snapping adapter, raw drag proposal/latch, Alt bypass, and scoped transaction cleanup; retain axes behavior. Keep event orchestration separate from pure geometry.
- `src/canvas/hooks/useDragSnap.test.ts` **(new)** — testable event-adapter/session callbacks with fake Konva nodes and real/mocked store boundaries in the existing Node Vitest setup. Extract non-React callback logic in this file if needed; do not add a browser test dependency merely to mount Konva.

**Docs**
- `manim-timeline/README.md` (repo-relative, existing WIP) — after verification, coordinate additive updates to Canvas/Space explaining checkbox, bypass, margins, measurement/animation limits, and placement versus attachment; extend the `*Last updated:*` trailer without rewriting existing WIP.
- `docs/handoffs/2026-09-23-text-object-snapping.md` (repo-relative, **new**) — this plan; later roles append only their own sections.

**Intentionally unchanged layers:** persisted `types/`, `codegen/`, `src/lib/time.ts`, server, Copilot, Tauri, and Vite configuration. If the solution requires edits there, return to the architect for a separately owned, ordered handoff rather than expanding this one silently.

### Invariants at risk
- **Visible ink and stored mobject anchors differ.** Enforced by `src/lib/nextToGeometry.ts` (`alignBoxForItemAt` ink mode), `src/lib/resolvePosition.ts` (`resolveTextLineToEdgeCoordinate`), and `src/codegen/lineCodegen.ts` (`generateLinePos`, scale before resolved placement). `TextLineNode.tsx` currently violates offset scaling; the preview fix must agree with those existing semantics, not redefine them.
- **Existing positioning chains remain authoritative.** Enforced by `src/lib/resolvePosition.ts` and `src/canvas/hooks/useDragSnap.ts` (`isFreelyDraggable`); regression coverage in `resolvePosition.test.ts` and `quickLayout.test.ts`. Do not convert a locked line to absolute placement or alter legacy `bounds: null`.
- **Frame-local storage is independent of the camera.** Enforced by `src/lib/frameGrid.ts`, `src/lib/canvasManimCoords.ts`, and `SceneCanvas.tsx`'s world/Board transforms. `TextLineNode.tsx` currently subtracts frame offsets in its drag conversion; preserve the single application of each offset.
- **Timeline visibility/animation transforms must not leak into layout storage.** Enforced by `src/lib/time.ts`, `src/lib/visualPlaybackPreview.ts`, `src/canvas/hooks/useResolvedPosition.ts`, and `SceneCanvas.tsx`'s `PlaybackWrap`. A completed target animation can remain nonidentity while paused; exclude unsupported states explicitly.
- **Undo and single source of truth.** Enforced by `src/store/useSceneStore.ts` (zundo + `setItemPosition`) and `src/hooks/useSceneUndoRedo.ts`. The current drag lifecycle lacks a tested checkpoint; new `positionDrag.ts` and its tests must enforce one gesture/one position undo and guaranteed tracking cleanup.
- **No implicit dependency cycles or unapproved edits.** Existing references are resolved recursively in `resolvePosition.ts`; the new candidate walk in `textSnap.ts` must terminate on cycles. The canvas's committed-versus-preview boundary in `SceneCanvas.tsx` must keep Copilot proposal objects out of committed snapping decisions.
- **No schema/export/timing drift.** Existing save/load is enforced by `src/lib/projectIO.ts` and `src/store/useSceneStore.ts`; only existing coordinates change. `src/codegen/lineCodegen.ts` still emits `HebrewMathLine` positioning, and `src/codegen/groupPlaybackSpan.ts`/`manimExporter.ts` retain the README per-leaf duration contract. No snap state or guides enter Python or project files.

### Test plan
No feature tests/builds have been run for this architect-only handoff. Implementer/verifier must run the following after the Open questions are resolved.

**Add tests (exact file and proposed describe blocks)**
- `src/lib/textSnap.test.ts` — `describe('text snap bounds')`: offset Hebrew and mixed math, scale 0.5/1/2, all four edges, rotated image/shape, asymmetric polyline, axes-domain distinction, invalid/stale/missing text measurement.
- Same file — `describe('text snap candidates')`: same-frame visibility, self/dependents/cycles, selected ghosts, preview-only items, unsupported animation/compound states, and stable target ordering.
- Same file — `describe('text snap solver')`: 0.3 adjacency, proposed 0.3/0.5 frame insets, perpendicular proximity, independent edge alignment, capture/release boundaries, Alt/off clearing, no distant attraction, no frame clamp, deterministic competing candidates, and escape from a latched result using raw coordinates.
- Same file — `describe('text snap coordinates')`: multiple frame offsets, panned view, resized canvas, Board scales, pixel-versus-world tolerance, and existing `resolvePosition`/explicit-ink `next_to`/`to_edge` equivalence for supported simple cases. Example: the existing Hebrew fixture has `inkRightX = 1.5`; at scale 2, the right-frame 0.3-inset anchor must be `FRAME_W / 2 - 0.3 - 3`, not an ink-centered approximation.
- `src/lib/surroundCanvasPreview.test.ts` — `describe('scaled text ink surround bounds')`: scale both dimensions and displaced center; preserve scale-1 output and surround buffer.
- `src/store/positionDrag.test.ts` — `describe('position drag transaction')`: many updates -> one undo -> original position -> one redo -> final snapped position; second drag history; no-op/cancel; already-paused state; unmount/error cleanup; item deletion; unrelated measurement update not rolled back; unchanged `posSteps` and serialized shape.
- `src/canvas/hooks/useDragSnap.test.ts` — `describe('text drag snap adapter')`: actual node correction even for repeated equal snaps, raw-coordinate escape, checkbox/Alt behavior, modifier selection preserved, constrained item refusal, snap context invalidation, and legacy axes/grid path unchanged.

**Existing regression files/blocks to keep green**
- `src/lib/resolvePosition.test.ts`: `resolvePosition next_to`, `resolvePosition to_edge text bounds`, `resolvePosition image`, `getItemBBox polyline`.
- `src/lib/nextToGeometry.test.ts`: `computeNextToMobCenter`.
- `src/lib/quickLayout.test.ts`: `inkEdgeSteps`, `appendCenterXStep`, `updateAxisStep`.
- `src/lib/canvasManimCoords.test.ts`: `manimToCanvas`, `surroundBBoxCanvasCenter`, `anchoredScalePoint`.
- `src/lib/visualPlaybackPreview.test.ts`: `cameraOffsetAtTime`, `targetAnimPreviewAccum`.
- `src/codegen/lineCodegen.test.ts`: `generateLinePos to_edge bounds` (already tests scaled ink-aware positioning and scale-before-position ordering).
- `src/codegen/manimExporter.overlap.test.ts`: retain existing frame and timing regression coverage without edits.

**Exact commands — working directory `manim-timeline/`**
```powershell
npx vitest run src/lib/textSnap.test.ts src/lib/surroundCanvasPreview.test.ts src/store/positionDrag.test.ts src/canvas/hooks/useDragSnap.test.ts
npx vitest run src/lib/resolvePosition.test.ts src/lib/nextToGeometry.test.ts src/lib/quickLayout.test.ts src/lib/canvasManimCoords.test.ts src/lib/visualPlaybackPreview.test.ts src/codegen/lineCodegen.test.ts src/codegen/manimExporter.overlap.test.ts
npm run build
npm run test
npm run lint
npx eslint src/lib/textSnap.ts src/lib/textSnap.test.ts src/lib/surroundCanvasPreview.ts src/lib/surroundCanvasPreview.test.ts src/store/positionDrag.ts src/store/positionDrag.test.ts src/canvas/SceneCanvas.tsx src/canvas/layers/TextLineNode.tsx src/canvas/hooks/useDragSnap.ts src/canvas/hooks/useDragSnap.test.ts
npm run dev
```
Record full-repo lint baseline failures separately; touched-file lint must be clean. Never change the existing Vite WIP to make these tests work without coordinating with its owner.

**Manual acceptance / review**
- `ui-reviewer`: arrange three measured Hebrew/math lines in a right-aligned stack; check 0.3 visible gaps, scale 0.5/2, all frame edges/corners, competing targets, slow approach and fast pull-away, Alt mid-drag, checkbox keyboard use, and narrow toolbar. Compare actual pixels to guides, not merely model coordinates.
- Test text beside a rotated rectangle/image, asymmetric polyline, and axes box; confirm guide wording and target scope. Missing measurement and unsupported animation states must not show misleading exact-gap guides.
- Repeat on a non-origin frame, in panned view and Board mode. Verify no changes to frame ownership or jump on mouse-up; new placement is identical after save/reload. Constrained text remains locked; changing the reference after a placement-only snap does not move the dropped line.
- Undo/redo several gestures, then cancel a gesture and perform a normal unrelated edit to confirm temporal tracking was restored. Delete/change a target during a gesture and verify cleanup.
- Export the measured scaled-Hebrew fixture and a non-origin-frame fixture through the existing UI. Verify saved frame-local anchors are resolved/emitted once and guides/settings never appear in Python. The known scale-2 right-edge fixture should correspond to anchor x approximately `3.811111` before its frame-world shift.
- Because the preview offset fix is visual, request `manim-reviewer` to compare one representative exported fixture with a `-ql` render using the existing render workflow if pixel agreement cannot be established from the preview/export geometry tests. Do not introduce server changes or render automatically during architecture planning.

### Open questions
1. **Placement assistance or persistent attachment?** Recommendation: snapping sets a normal position; moving/resizing the nearby object afterwards does not move the dropped text. Alternative: snapping creates a visible `next_to`/`to_edge` relationship in Positioning steps so the text follows its reference. That alternative needs explicit detach/re-drag semantics, cycle protection, and re-planning of export/compound compatibility; do not choose it implicitly. Which behavior should v1 have?
2. **Approve the gap/margin defaults?** Recommendation: 0.3 between objects and at left/right frame edges, 0.5 at top/bottom frame edges, consistent with existing quick layout. Would you prefer a uniform 0.3 frame inset instead? These are starting defaults, not a minimum-spacing restriction.
3. **Accept the first-version scope?** Recommendation: text is the mover; static nearby text/shapes/images/axes-domain bounds and its owning frame are targets. Existing relative-positioned text remains locked; precise snapping requires measured text and is unavailable in derived animation/auto-centered-compound states. If snapping already-transformed or auto-centered text is essential, say so before implementation so the inverse-positioning work is planned rather than hidden behind a limitation.

### Architect follow-up (2026-09-23)

- User confirmed placement-only behavior: **B remains where dropped if its reference later moves**; do not add relative attachment constraints.
- User confirmed **0.3 Manim units for every direction, including each frame edge**.
- User accepted the static-layout first-version scope.
- User also requires manually editing the buffer in the existing **Positioning steps** panel to control the chosen snapping buffer. To preserve placement-only semantics without adding a `PosStep` constraint, add an optional persisted per-text-line `snapBuffer` setting, default/migration fallback 0.3. Editing it changes future drag snapping but never repositions an already dropped line. Keep snap enabled default as planned. This is a new optional text field: per `project-schema-migration`, tolerate missing values and default in factory/agent normalizer; no project version bump/migration is required unless implementation finds the field cannot safely remain optional.
- User approved proceeding. Implement the additional files listed below as the only scope amendment; do not edit schema/project version unless required by test/type evidence.

**Scope amendment for user-requested panel buffer**
- `src/types/scene.ts` — optional text-line `snapBuffer?: number`, documented in Manim units and default 0.3.
- `src/store/factories.ts` — initialize new lines with 0.3.
- `src/agent/validate.ts` — ensure Copilot-created lines default to 0.3; the model must not be taught to control the field.
- `src/panels/LineEditor.tsx` and `src/panels/PositionStepsEditor.tsx` — expose an RTL-safe NumberInput in Positioning steps that sets the per-item snap gap, independent of `posSteps`.
- `src/lib/projectIO` related tests only if they demonstrate optional `snapBuffer` is not preserved by the existing project round trip; inspect/avoid expanding otherwise.
- Add migration/normalizer test coverage only if the existing model normalizer path warrants it; optional field is backward-compatible, so do not bump `PROJECT_VERSION` or create a migration by default.

## Implementation notes (<owner_role>)

### 2026-09-23 — editor-dev

- `src/lib/textSnap.ts`, `src/lib/textSnap.test.ts`: added pure measured-ink geometry and deterministic edge/frame solver. It uses 0.3 by default for all edges, the custom text buffer when present, 8 px acquisition / 12 px release, a correction cap, and guide metadata. Added tests for scaled Hebrew ink, invalid measurement, custom gap, frame edge, adjacency, and distance rejection.
- `src/canvas/SceneCanvas.tsx`, `src/canvas/layers/TextLineNode.tsx`, `src/canvas/hooks/useDragSnap.ts`, `src/canvas/hooks/useDragSnap.test.ts`: added the checked-by-default Snap text toolbar toggle, Alt bypass, same-frame committed text/shape/image/axes-domain targets, world/frame conversion, a non-listening guide overlay, transformed basic shape bounds, and snapping suppression for playing/effected text. Text ink offsets now scale with the item. Target boxes are frozen at drag start; removed targets are excluded. The prior gesture's x/y are restored under paused temporal tracking and final x/y committed once. Axes remain on the existing non-snapping path.
- `src/store/positionDrag.ts`, `src/store/positionDrag.test.ts`: extracted end/cancel store gesture operations and covered one-step undo/redo, no-op, and persisted snap gap.
- `src/lib/surroundCanvasPreview.ts`, `src/lib/surroundCanvasPreview.test.ts`: scaled measured Hebrew ink offsets consistently for surrounding rectangles.
- `src/types/scene.ts`, `src/store/factories.ts`, `src/agent/validate.ts`, `src/panels/LineEditor.tsx`, `src/panels/PositionStepsEditor.tsx`: added optional per-line persisted `snapBuffer`, defaults it to 0.3 for app/Copilot-created lines, and exposes the user's manual buffer in the Positioning steps panel. Existing project serialization carries the property; old projects with no value fall back to 0.3. Per `project-schema-migration`, no project version bump/migration is needed for this optional field. The AI schema was not changed and the Copilot normalizer always uses 0.3.
- `manim-timeline/README.md`: documented snap controls, exact buffer behavior, placement-not-attachment semantics, and optional persisted preference; appended a Last-updated trailer note. This README was already modified by other WIP, so changes were additive only.
- Deviations/limits: no browser-based visual acceptance was available; no manual rendering was run. The guide is a lightweight dashed alignment line with a gap label rather than a separate target highlight/gap ruler. Candidate shapes use geometric AABBs; text requires valid measurements. Relative-positioned text remains locked. Snap geometry only suppresses non-identity target-animation transforms; current code does not identify every possible preview-only intro/compound-derived state. Added a minimal drag-hook prerequisite test rather than mounting Konva in a browser test environment.
- Verification from `manim-timeline/`: `npm run build` passed (Vite emitted only its existing >500 kB chunk warning); `npm run test` passed (53 files, 445 tests); targeted `npx eslint` over all changed frontend source/tests passed with no output. `npm run lint` was run and failed on 38 existing errors in untouched files (e.g. `src/canvas/layers/ShapeNode.tsx`, `src/components/FloatingPanel.tsx`, `src/lib/time.ts`, `src/store/useSceneStore.ts`); touched-file lint is clean. `git diff --check` passed (only Git LF/CRLF informational warnings).
- Left undone: manual browser/UI check and visual reviewer comparison, because no browser automation/manual render session was available here. No server or codegen files were changed.

## Verification (verifier)

### 2026-09-23 — verifier result recorded by orchestrator

Verdict: **fail**. Build passed; focused tests passed (4 files, 12 tests); existing regression subset passed (7 files, 91 tests); full tests passed (53 files, 445 tests); agent subset passed (4 files, 73 tests); touched-file lint and `git diff --check` passed. Full lint has 38 errors and 8 warnings in untouched files. Dev server started successfully, but browser/render acceptance was not performed.

Required corrections before re-verification:
- `useDragSnap.ts` converts frame-local snapped anchors to canvas without adding the owning frame offset. Correct the node's world-coordinate conversion and cover non-origin-frame drop, camera pan, and Board scale.
- Drag lifecycle unconditionally resumes temporal tracking even when already paused before the gesture. Capture ownership and cover already-paused, cancel, unmount/error, and no-op paths.
- Adapter tests currently check only draggable prerequisites. Add meaningful event/coordinate/escape and cleanup regression coverage; old-project load/roundtrip of `snapBuffer` is also not directly tested.
- Review unsupported preview-state suppression and guide/target policy against the plan; manual browser and render agreement remain unconfirmed.
- Verifier could not establish README changes as additive from HEAD because that file already contained watcher WIP; preserve the recorded starting state.

User subsequently requested all OpenCode code-writing agents use `openai/gpt-6-luna` with `reasoningEffort: medium`. Updated the four `.opencode/agents/*-dev.md` definitions and confirmed model availability/config parsing. Those config edits are a separate user-requested scope. OpenCode must restart before those agent settings apply; resume these snapping corrections after restart.

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
