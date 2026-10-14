---
slug: move-along-graph-editor
created: 2026-09-24
status: done
owner_role: editor-dev
next_tool: any
source: user request / Move along graph feature
---

<!--
Copy this file to docs/handoffs/<created>-<slug>.md.
Each role appends ONLY its own section. Never edit a section written by an earlier role;
add a dated note under your own section instead. Update the frontmatter `status`,
`owner_role`, and `next_tool` when you hand off.
-->

## Plan (architect)

### Goal
Let users animate an existing `graphDot` continuously along a fixed existing `graphPlot` (`y = f(x)`) by adding timeline clips with a target x-coordinate, duration, and easing. The dot's start position is resolved from the point's displayed coordinates at the animation start, the destination is held after the clip, and users can chain multiple clips with pauses. Existing fixed dot labels follow the moving point unchanged; optional live coordinate text and projection guides are configured on the point and follow during preview/scrubbing.

### Non-goals
- No implementation in this architect session; no codegen, Copilot, server, audio, or agent-configuration changes in this editor handoff.
- Do not support parameter-changing graphs, automatic optimization/search algorithms, constant arc-length speed, moving axes, graphFunctionSeries/parametric graph sources, or automatic creation of the plotted function.
- Do not make Copilot create or edit this feature here. If TypeScript or validation forces changes under `src/agent`, stop and request a separate `copilot-dev` handoff after loading `copilot-add-kind`.
- Do not alter existing generic `move` / `path` target-animation semantics or finish/clean up the current camera/codegen/Copilot WIP.
- Do not drift from the clarified rejection/blocking decisions recorded below; no snapping, no initial jump, and no invalid preview/export for detected bad intervals.

### Order and repository findings
1. This file: **editor-dev** owns the persisted editor API, store factories, target-animation UI, graph-dot annotation UI, shared preview resolver, and canvas/timeline preview. It must not touch `src/codegen` or `src/lib/time.ts`.
2. `docs/handoffs/2026-09-24-move-along-graph-codegen.md`: **codegen-dev** consumes the verified editor API and emits matching Manim. It must wait for this handoff's implementation/verification and for the current codegen WIP boundary to be resolved.
3. Verifier runs after each stage. New/changed UI needs `ui-reviewer`; generated Python stage needs `manim-reviewer`; docs-keeper updates README only after verified behavior.

Repository inspection found no existing Move-along-graph handoff. Current graph dots are static `GraphDot.dx/dy` plus optional fixed `dot.label` / `labelDir`; `GraphNode.tsx` and `buildGraphDotPreviewSpec` render from those static coordinates. Existing `target_animation` clips already provide start/duration, persistent after-state, chaining by timeline order, and pauses via timeline gaps, so the smallest model is a new target-animation mode rather than a new top-level clip collection.

### Shared editor/API contract
- Extend `TargetAnimationMode` with `graphFollow`. A `graphFollow` clip targets only `graphDot` rows; each row stores `graphPlotId: ItemId`, `targetX: number`, and `easing?: 'linear' | 'smooth'`. Defaults: `easing = 'smooth'`, `targetX = current resolved dot x` at insertion time, and `graphPlotId` is the compatible selected/same-axes plot when unambiguous; otherwise insertion is disabled and the editor explains the missing plot choice. The clip's existing `duration` remains the motion duration.
- Add optional `GraphDot.showCoordinates?: boolean` and `GraphDot.showProjectionGuides?: boolean`. Runtime default for legacy items is `false`, and the V43 migration should explicitly backfill `false` on graph dots and preserve existing values for idempotence.
- This is a persisted shape change despite optional fields: honor `AGENTS.md` over the skill exception. Bump `PROJECT_VERSION` from 42 to the next live version (expected **43** unless another task advances it first), add `migrateProjectToV43.ts`, wire it in `migrateLoadedItems.ts`, and add migration tests.
- Add `src/lib/graphMotion.ts` as the shared pure resolver. It validates same-axes dot/plot references, evaluates the plot's `fn.jsExpr`, resolves the dot's displayed graph-space `{x, y}` at any time by applying prior completed/in-progress `graphFollow` clips sorted by `startTime` then `id`, and reports warnings/errors without mutating items. Preview and codegen must consume the same public contract.
- Motion parameterization is by x-coordinate, not arc length: at progress `u`, interpolate x from startX to targetX using the selected easing and compute y from the fixed plot expression at that x. After the clip ends, the resolved point stays at `(targetX, f(targetX))` until another graph-follow clip for the same dot starts.
- Multiple chained clips and pauses are supported. For the same dot, `graphFollow` is the only allowed position writer in v1: overlapping `graphFollow` clips, and any overlapping imported/legacy positional target-animation row (`move` or `path`) targeting that dot, are deterministic validation errors. The later clip is not allowed to override, blend, or queue; preview/export for the invalid interval is blocked with a warning. Non-position effects (scale/color where eligible) may overlap; if implementation discovers an exit/removal overlap ambiguity, block it rather than guessing.
- Start validation: a graph-follow clip is valid only when the dot's resolved start point lies on the selected graph at the clip start within a small documented numeric tolerance (for example `1e-4` graph units, implemented once in `graphMotion.ts`). Off-curve starts are rejected with a warning; do not snap and do not allow an initial jump.
- Interval validation: sample the x interval between startX and targetX plus endpoints, evaluate the plot expression, and reject detected nonfinite values, domain holes, or large discontinuity jumps with a warning. The user accepted that numerical validation cannot guarantee detecting every discontinuity; do not promise a proof. Detected invalid intervals must produce no invalid preview/export.
- The fixed `dot.label` text and direction are not converted to coordinates and are not changed by graph-follow clips. Coordinate text and projection guides are separate optional graph-dot annotations and display the currently resolved graph-space coordinates.
- Projection guides terminate at `x=0` / `y=0` when those axes are inside the displayed range; otherwise they terminate at the nearest visible range boundary.
- Keep this feature editor-only until the codegen handoff is complete. Add a named temporary export capability guard in a small shared helper (for example `src/lib/exportReadiness.ts`, `GRAPH_FOLLOW_EXPORT_SUPPORTED = false`) that `ExportPanel`/store export checks consume. Stage 2 must flip/remove that exact guard and its tests; do not leave a permanent or dangling export block.
- Copilot feature support remains out of scope. If extending `TargetAnimationMode` causes TypeScript, canonical schema, Gemini schema, or agent normalizer failures, editor-dev must stop and report that a narrow `copilot-dev` compatibility handoff is required; do not make ad-hoc `src/agent` changes in this handoff.

### WIP boundary
Initial status before planning has modified/untracked WIP in architect/orchestrator configs, `AGENTS.md`, `manim-timeline/README.md`, camera handoffs, Copilot files under `src/agent`, and codegen files including `cameraCodegen.ts`, `groupPlaybackSpan.ts`, `leafConcurrentCodegen.ts`, `manimExporter.ts`, `projectExporter.test.ts`, `targetAnimationCodegen.ts`, and related tests. Preserve all of it. Do not revert, reformat, stage, commit, or "clean up" those files unless they are explicitly listed below and the implementer has rechecked status and coordinated the overlap.

### Touched files
Paths are relative to `manim-timeline/` unless marked repo-relative.

**types/**
- `src/types/scene.ts` — add `graphFollow` mode, optional row fields (`graphPlotId`, `targetX`, `easing`) and optional graph-dot annotation flags; document units/defaults.

**lib/**
- `src/lib/constants.ts` — bump `PROJECT_VERSION` to the next live version (expected V43) because `types/scene.ts` persisted shape changes.
- `src/lib/migrateLoadedItems.ts`, `src/lib/migrateProjectToV43.ts`, `src/lib/migrateProjectToV43.test.ts` **(last two new)** — migration wiring/backfill for graph-follow defaults and graph-dot annotation flags; renumber if the current version has advanced before implementation.
- `src/lib/graphMotion.ts` **(new)** — shared validation/easing/position resolver for graph-follow preview/export contract.
- `src/lib/graphMotion.test.ts` **(new)** — resolver, chaining, holds, warnings, and annotation-coordinate tests.
- `src/lib/exportReadiness.ts`, `src/lib/exportReadiness.test.ts` **(new)** — named temporary graph-follow export guard consumed by export UI/store and removed/flipped in the codegen stage.
- `src/lib/graphCreatePreview.ts`, `src/lib/graphCreatePreview.test.ts` — extend graph-dot preview spec for live position, coordinate text, and projection guide geometry without changing static-dot behavior.
- `src/lib/visualPlaybackPreview.ts`, `src/lib/visualPlaybackPreview.test.ts` — include graph-follow target-animation accumulation for preview/scrubbing; leave existing scale/color/move/path/rotate behavior unchanged.
- `src/lib/itemDisplayName.ts` — label the new target-animation mode as “Move along graph” while preserving existing labels.
- `src/lib/projectFragment.ts`, `src/lib/projectFragment.test.ts` — preserve graph-follow clip references when copying/time-shifting fragments; fail visibly on missing referenced dot/plot rather than silently relinking.
- `src/lib/mtprojBundle.test.ts`, `src/lib/multisceneNormalize.test.ts` — round-trip optional fields and same-scene references; no new asset bundle fields.

**store/**
- `src/store/factories.ts` — defaults for `graphFollow` rows and graph-dot annotation flags (optional flags default false).
- `src/store/useSceneStore.ts` — validation diagnostics for graph-follow references, overlap warnings, target deletion behavior, undo-safe updates, and export-block marker until codegen stage lands.
- `src/store/useSceneStore.graphMotion.test.ts` **(new)** — create/update/delete/undo, chained clips, paused holds, missing target diagnostics, V43 migration/default handling, and temporary export guard behavior.

**UI / canvas / timeline**
- `src/hooks/useAddSceneItems.ts` — add selected-graph-dot / selected-plot aware insertion for a `graphFollow` target animation without touching `src/lib/time.ts`.
- `src/panels/AddObjectToolbar.tsx` — expose “Move along graph” in the Animations area with disabled/help text when no compatible dot+plot exists.
- `src/panels/TargetAnimationEditor.tsx` — row editor for graph dot, source graph plot, target x, duration/easing, validation messages, and same-frame filtering.
- `src/panels/GraphDotEditor.tsx` — toggles for live coordinates and projection guides; fixed label controls remain unchanged.
- `src/canvas/layers/GraphNode.tsx` — render graph dots from `graphMotion` at `currentTime`, including live coordinate/projection annotations; keep axes overlay ordering/z-index behavior.
- `src/timeline/TimelineClip.tsx` — presentation label/color/tooltip for graph-follow target-animation clips and warnings; do not shrink or mutate clip bars.
- `src/panels/ExportPanel.tsx` — block export while `GRAPH_FOLLOW_EXPORT_SUPPORTED` is false and at least one graph-follow clip exists; this must be a narrow guard that stage 2 can remove/flip.

**docs**
- `manim-timeline/README.md` (repo-relative, existing WIP) — docs-keeper later documents editor/export behavior and project-format optional fields after verification; preserve existing WIP trailer entries.
- `docs/handoffs/2026-09-24-move-along-graph-editor.md` (repo-relative, **new**) — this handoff.

### Invariants at risk
- **Persisted schema compatibility** — enforced by `src/types/scene.ts`, `src/lib/constants.ts`, `src/lib/migrateLoadedItems.ts`, `src/lib/multisceneNormalize.ts`, and `src/store/useSceneStore.ts`. This handoff must bump to V43 (or next live version), wire an idempotent migration, and test legacy/fresh data despite optional runtime defaults.
- **Graph overlay attachment source of truth** — `axesId` on graph overlays in `src/types/scene.ts` and graph rendering in `src/canvas/layers/GraphNode.tsx` remain authoritative. A graph-follow row must reference a same-axes `graphPlot`, not duplicate axes data.
- **Preview/export parity contract** — new `src/lib/graphMotion.ts` must be the only editor-side graph-follow resolver; the codegen handoff must mirror it rather than re-deriving product rules in components.
- **Effect clips are non-drawable** — `target_animation` timing/effect behavior is enforced by `src/lib/time.ts`, `src/store/useSceneStore.ts`, and `src/timeline/TimelineClip.tsx`. This handoff must not edit `src/lib/time.ts`; use existing target-animation duration semantics.
- **Existing target animations stay unchanged** — `src/lib/visualPlaybackPreview.ts`, `src/panels/TargetAnimationEditor.tsx`, and current codegen tests protect scale/color/move/path/rotate behavior. New graph-follow code must be mode-gated.
- **One position writer per graph dot** — new `src/lib/graphMotion.ts`, `src/store/useSceneStore.ts`, and `src/lib/visualPlaybackPreview.ts` must reject same-dot overlapping graph-follow/move/path positional effects deterministically; no implicit override, snap, or queue.
- **Graph-dot labels use the point, not coordinate annotations** — `src/lib/graphCreatePreview.ts`, `src/canvas/layers/GraphNode.tsx`, and `src/codegen/graphCodegen.ts` currently bind fixed labels to graph dots; annotation toggles must not rewrite `dot.label`.
- **Temporary export guard is removable** — `src/lib/exportReadiness.ts`, `src/panels/ExportPanel.tsx`, and store/export tests must name the guard so codegen stage can flip/remove it exactly once. A dangling permanent guard after stage 2 is a verifier failure.
- **Undo and WIP preservation** — `src/store/useSceneStore.ts` and zundo history must treat graph-follow insertion/update as ordinary item edits and not mutate unrelated camera/snapping/Copilot WIP.

### Test plan
No tests were run during planning. Exact commands below run from `manim-timeline/`.

Add/extend tests:
- `src/lib/migrateProjectToV43.test.ts`: `describe('migrateItemsToV43')` — legacy graph dots get `showCoordinates: false` / `showProjectionGuides: false`, graph-follow rows get `easing: 'smooth'` when missing if legacy fixtures are possible, existing values are preserved, unrelated items are copied/idempotent, and renumbering is updated if the version advanced.
- `src/lib/graphMotion.test.ts`: `describe('graphFollow resolver')` — single clip, chained clips with a pause, start position from dot/current prior clip, destination hold, easing progress, off-curve start rejection, same-dot position-writer overlap rejection, missing plot/dot, plot on different axes, nonfinite `targetX`, detected domain hole/discontinuity, function evaluation failure, guide boundary fallback when zero is outside range, and legacy dots with undefined annotation flags.
- `src/lib/graphMotion.test.ts`: `describe('graphFollow annotations')` — resolved coordinate text/guides follow during motion and hold afterward; fixed `dot.label` remains unchanged.
- `src/lib/graphCreatePreview.test.ts`: extend graph-dot preview spec for live coordinates/projection guides and assert static dots are unchanged.
- `src/lib/visualPlaybackPreview.test.ts`: extend target-animation preview accumulation with graph-follow scrubbing, backward seek, chained pauses, and unchanged generic move/path cases.
- `src/store/useSceneStore.graphMotion.test.ts`: `describe('graph-follow authoring')` — insertion from selected dot+plot, row edits, duration/easing updates, undo/redo, deletion diagnostics, same-dot overlap diagnostics, export-block marker before codegen, and V43 defaults/migration behavior.
- `src/lib/exportReadiness.test.ts`: `describe('graph-follow export guard')` — guard blocks only graph-follow projects before stage 2 and is narrow enough for codegen-dev to flip/remove.
- `src/lib/projectFragment.test.ts`, `src/lib/mtprojBundle.test.ts`, `src/lib/multisceneNormalize.test.ts`: graph-follow references and optional annotation flags round-trip/time-shift without new asset manifest entries.

Commands:
```powershell
npx vitest run src/lib/migrateProjectToV43.test.ts src/lib/graphMotion.test.ts src/lib/exportReadiness.test.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.test.ts src/store/useSceneStore.graphMotion.test.ts
npx vitest run src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts
npm run build
npm run test
npm run lint
npx eslint src/types/scene.ts src/lib/constants.ts src/lib/migrateLoadedItems.ts src/lib/migrateProjectToV43.ts src/lib/migrateProjectToV43.test.ts src/lib/graphMotion.ts src/lib/graphMotion.test.ts src/lib/exportReadiness.ts src/lib/exportReadiness.test.ts src/lib/graphCreatePreview.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.ts src/lib/visualPlaybackPreview.test.ts src/lib/itemDisplayName.ts src/lib/projectFragment.ts src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts src/store/factories.ts src/store/useSceneStore.ts src/store/useSceneStore.graphMotion.test.ts src/hooks/useAddSceneItems.ts src/panels/AddObjectToolbar.tsx src/panels/TargetAnimationEditor.tsx src/panels/GraphDotEditor.tsx src/panels/ExportPanel.tsx src/canvas/layers/GraphNode.tsx src/timeline/TimelineClip.tsx
npm run dev
```
Manual/UI review: create axes, a plot `y=x^2`, and a dot; add two graph-follow clips with a pause; scrub forward/backward and verify point, fixed label, coordinate text and projection guides move/hold identically. Try off-curve start, invalid/missing plot, different axes, function-domain failure, detected discontinuity, overlapping graph-follow/move/path clips for the same dot, zero-outside-range guides, export guard before stage 2, and save/reopen JSON/.mtproj. Request `ui-reviewer` because this changes editor UI/canvas behavior.

### Open questions
None. Resolved by user on 2026-09-24: reject off-curve starts; block detected undefined/domain-hole/discontinuity intervals with warning and no invalid preview/export; guides terminate at nearest visible range boundary when zero is outside the range.

Resolved alternatives preserved for context: the rejected options were snapping/jumping from off-curve starts, allowing/exporting invalid discontinuity intervals, and always projecting guides to mathematical zero even when zero is outside the visible range.

### 2026-09-24 architect clarification
- Product decisions above supersede the prior Open questions. Preserve the earlier notes as context but implement only the resolved behavior.
- The schema/migration requirement is explicit: because `types/scene.ts` gains a new target-animation mode and persisted row/annotation fields, add V43 (or next live version) constants/migration/wiring/tests even though the fields can be runtime-optional.
- The temporary export guard belongs to the editor stage only as a named capability switch and must be removed/flipped by the codegen handoff. If that cannot be implemented with additive edits because of existing WIP, stop and report instead of overwriting.
- No Copilot feature expansion is approved. If compile/schema compatibility proves that `src/agent` must change, stop and request a separate `copilot-dev` compatibility handoff.

### 2026-09-25 architect plan addendum — attached graph points and axes alignment

#### Goal
Complete the editor-side graph-point workflow before codegen: users can author persistent free/function/parametric graph dots, have attached dots recompute from edited sources, animate attached dots along their inferred source (`x` for function plots, `t` for parametric curves), and independently configure fixed labels plus live coordinate labels/guides from a Labels & coordinates popover. The reported raster/vector axes misalignment must be diagnosed and fixed so graph coordinates, plotted curves, dots, labels, and axes intersections agree in the browser.

#### Non-goals
- Still no graph-follow Manim export in this editor handoff; keep the named export guard until the codegen handoff implements motion and annotations.
- Do not add graph-shape animation, constant arc-length speed, optimization/search, Copilot authoring, server endpoint changes, font family/bold/italic controls, or canvas label dragging.
- Do not edit `measure_server.py` unless a separate `server-dev` handoff is created because the client lacks enough raster-origin metadata.
- Do not edit `src/codegen` or `src/lib/time.ts` for this editor stage; existing codegen/camera/Copilot WIP is out of scope.

#### Touched files addendum
Paths are relative to `manim-timeline/` unless marked repo-relative.

**types/**
- `src/types/scene.ts` — add persisted `GraphDotAttachment` (`free`, function source + `x`, parametric source + `t`), graph-follow source/target fields for function and parametric motion, and fixed-label/coordinate style fields.

**lib/**
- `src/lib/constants.ts` — bump `PROJECT_VERSION` from current V43 to next live version, expected V44.
- `src/lib/migrateLoadedItems.ts`, `src/lib/migrateProjectToV44.ts` **(new)**, `src/lib/migrateProjectToV44.test.ts` **(new)** — backfill free attachments and label/coordinate style defaults; preserve V43 graphFollow projects with legacy plot rows or repairable warnings.
- `src/lib/graphMotion.ts`, `src/lib/graphMotion.test.ts` — generalize from function-only graph-follow to free/function/parametric attachments, source-inferred rows, source-edit recomputation, source deletion diagnostics, parametric interval validation, and legacy V43 compatibility.
- `src/lib/graphAnnotationLayout.ts` **(new)**, `src/lib/graphAnnotationLayout.test.ts` **(new)** — shared placement/defaults for fixed labels, coordinate text, coordinate precision, direction/spacing/color/font-size, and projection endpoints.
- `src/lib/axesRasterPreview.ts`, `src/lib/axesRasterPreview.test.ts` — fix/test the raster PNG placement vs overlay coordinate transform, including the reported `xRange=[-5,5,1]`, `yRange=[-3,3,1]`, labels `x/y`, scale 1, point `(1, sin(1))` case.
- `src/lib/graphCreatePreview.ts`, `src/lib/graphCreatePreview.test.ts` — consume attachment and annotation helpers while preserving static/free-dot behavior.
- `src/lib/visualPlaybackPreview.ts`, `src/lib/visualPlaybackPreview.test.ts` — preview function-x and parametric-t graph-follow clips, chained holds, and backward seeks.
- `src/lib/projectFragment.ts`, `src/lib/projectFragment.test.ts`, `src/lib/mtprojBundle.test.ts`, `src/lib/multisceneNormalize.test.ts` — preserve/remap attachment sources, graph-follow sources, and style fields across copy/load/save.
- `src/lib/exportReadiness.ts`, `src/lib/exportReadiness.test.ts` — keep `GRAPH_FOLLOW_EXPORT_SUPPORTED = false` and block annotation-only projects until codegen supports them.

**store/**
- `src/store/factories.ts` — defaults for free attachments and label/coordinate style fields.
- `src/store/useSceneStore.ts`, `src/store/useSceneStore.graphMotion.test.ts` — diagnostics for invalid/missing attachments/sources, source edits/deletions, source-inferred graph-follow rows, undo/redo, and export guard consumption.

**UI / canvas / timeline**
- `src/hooks/useAddSceneItems.ts`, `src/panels/AddObjectToolbar.tsx` — infer graph-follow source from attached dots; require explicit compatible source only for free dots.
- `src/panels/TargetAnimationEditor.tsx` — expose function target `x` vs parametric target `t`, source inference/status, legacy/free repair warnings, and existing duration/easing controls.
- `src/panels/GraphDotEditor.tsx` — attachment controls plus a Labels & coordinates popover; no font family/bold/italic/dragging controls.
- `src/canvas/layers/GraphNode.tsx` — render attached/free dot positions, fixed labels, coordinate labels, guides, and corrected axes raster alignment from shared helpers.
- `src/timeline/TimelineClip.tsx` — summarize x/t targets and source-inference diagnostics.
- `src/panels/ExportPanel.tsx` — keep clear blocked-export messaging for graph-follow and annotation-only data.

**docs**
- `docs/handoffs/2026-09-24-move-along-graph-editor.md` (repo-relative) — this addendum; docs-keeper updates README after verification.

#### Invariants at risk addendum
- **Schema chain and persisted defaults** — enforced by `src/types/scene.ts`, `src/lib/constants.ts`, `src/lib/migrateLoadedItems.ts`, `src/lib/migrateProjectToV43.ts`, `src/lib/migrateProjectToV44.ts`, `src/lib/multisceneNormalize.ts`, and `src/store/factories.ts`. V43 files must load into V44 without losing existing graph-follow behavior.
- **Attachment source of truth** — enforced by `src/lib/graphMotion.ts` and `src/types/scene.ts`. Function/parametric attached dots recompute from source expressions/domains; cached `dx/dy` are authoritative only for free/legacy fallback.
- **Axes raster/overlay alignment** — enforced by `src/lib/axesRasterPreview.ts`, `src/lib/graphCreatePreview.ts`, and `src/canvas/layers/GraphNode.tsx`. Graph-space `(0,0)` and `(1, sin(1))` must map consistently for raster and vector axes.
- **Preview/export parity contract** — enforced by `src/lib/graphMotion.ts`, `src/lib/graphAnnotationLayout.ts`, and the blocked codegen handoff. Editor helpers must expose final semantics so codegen does not invent a second model later.
- **Temporary export guard** — enforced by `src/lib/exportReadiness.ts`, `src/store/useSceneStore.ts`, and `src/panels/ExportPanel.tsx`. Valid editor previews must remain blocked from export until stage 2 flips/removes the guard.
- **Existing target-animation semantics** — enforced by `src/lib/visualPlaybackPreview.ts`, `src/panels/TargetAnimationEditor.tsx`, `src/timeline/TimelineClip.tsx`, and existing tests. Function/parametric graph-follow must not alter generic move/path/rotate/scale/color behavior.
- **WIP preservation** — enforced by `git status` review before edits. Do not revert or clean unrelated camera/codegen/Copilot/agent-config changes.

#### Test plan addendum
Run from `manim-timeline/` after implementation:

```powershell
npx vitest run src/lib/migrateProjectToV43.test.ts src/lib/migrateProjectToV44.test.ts src/lib/graphMotion.test.ts src/lib/graphAnnotationLayout.test.ts src/lib/axesRasterPreview.test.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.test.ts src/store/useSceneStore.graphMotion.test.ts
npx vitest run src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts src/lib/exportReadiness.test.ts
npm run build
npm run test
npm run lint
npx eslint src/types/scene.ts src/lib/constants.ts src/lib/migrateLoadedItems.ts src/lib/migrateProjectToV43.ts src/lib/migrateProjectToV43.test.ts src/lib/migrateProjectToV44.ts src/lib/migrateProjectToV44.test.ts src/lib/graphMotion.ts src/lib/graphMotion.test.ts src/lib/graphAnnotationLayout.ts src/lib/graphAnnotationLayout.test.ts src/lib/axesRasterPreview.ts src/lib/axesRasterPreview.test.ts src/lib/graphCreatePreview.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.ts src/lib/visualPlaybackPreview.test.ts src/lib/exportReadiness.ts src/lib/exportReadiness.test.ts src/lib/projectFragment.ts src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts src/store/factories.ts src/store/useSceneStore.ts src/store/useSceneStore.graphMotion.test.ts src/hooks/useAddSceneItems.ts src/panels/AddObjectToolbar.tsx src/panels/TargetAnimationEditor.tsx src/panels/GraphDotEditor.tsx src/panels/ExportPanel.tsx src/canvas/layers/GraphNode.tsx src/timeline/TimelineClip.tsx
npm run dev
```

Required added/extended test blocks:
- `src/lib/migrateProjectToV44.test.ts`: `describe('migrateItemsToV44')` — free attachment/style defaults, idempotence, V43 graphFollow compatibility, and ambiguous legacy-source warnings/repairability.
- `src/lib/graphMotion.test.ts`: `describe('attached graph dots')` and `describe('parametric graph-follow')` — function/parametric recomputation, source deletion/edit diagnostics, inferred-source rows, free-dot explicit function-source off-curve rejection, attached-only parametric motion, chained holds, invalid interval blocking, and V43 legacy rows.
- `src/lib/graphAnnotationLayout.test.ts`: independent fixed-label/coordinate style defaults, direction/spacing, coordinate precision, no bold/italic/font-family fields, and nearest-boundary guide endpoints.
- `src/lib/axesRasterPreview.test.ts`: `describe('axes raster overlay alignment regression')` — exact reported domain/labels/scale with raster ink bounds that include labels/numbers, proving vector and raster overlay coordinate maps agree.
- `src/store/useSceneStore.graphMotion.test.ts`: attachment authoring, undo/redo, source edits/deletions, export guard for graph-follow and annotation-only projects.

Manual/browser acceptance before unblocking codegen:
- Reproduce the user's axes/sin setup and verify axes crossing, sin plot, dot `(1.00, 0.84)`, fixed label, coordinate label, and guides align while scrubbing around `3.2s`.
- Toggle completed raster preview vs vector fallback and confirm both agree.
- Author free/function/parametric dots; edit source expressions/domains and confirm attached points recompute.
- Create graphFollow clips for function `x` and parametric `t` with pauses/holds; attached dots infer source and free dots reject off-source starts.
- Use Labels & coordinates to independently change label/coordinate text, size, color, direction, spacing, and precision; confirm no dragging/font family/bold/italic controls.
- Save/reopen JSON and `.mtproj`; copy fragments with and without sources; verify export remains blocked with actionable text.

#### Open questions addendum
None. If client-side raster math cannot align axes because server metadata is insufficient, stop and ask the Orchestrator to create a separate `server-dev` handoff for `/api/preview_axes` origin metadata. If reproduction remains unclear after the targeted regression, request a minimal `.json` project or exact canvas dimensions from the user before guessing.

### 2026-09-25 architect dependency update — server origin anchors required first

This editor handoff is blocked behind `docs/handoffs/2026-09-25-preview-axes-origin-anchors.md` (`owner_role: server-dev`). The implementer found the current `/api/preview_axes` response is insufficient: `offset_ink_x/y` and the crop bounds describe the aggregate axes+labels ink group after recentering, not the mathematical axes origin or coordinate basis. The existing client cannot derive the exact coordinate origin from that data without guessing. Do **not** continue raster-alignment client work until the server handoff is implemented, independently verified, and visually reviewed.

#### Ordered dependency chain
1. **Server stage first** — `docs/handoffs/2026-09-25-preview-axes-origin-anchors.md`: server-dev adds post-recenter coordinate anchors/rect (or equivalent origin+basis) aligned with the cropped PNG, plus endpoint tests and real `/api/preview_axes` smoke. Verifier runs server gates and `manim-reviewer` checks the low-quality render/visual-defect fixture.
2. **Editor stage second** — this handoff resumes after the server stage passes. Editor-dev wires the new response contract into types/services/cache/raster transforms, finishes the V44 graph-dot attachment and Labels & coordinates UI, and keeps export guarded. Verifier runs frontend gates, then UI review and a manim-reviewer visual-defect review of raster/vector alignment. The user will manually test only after this editor revision is verified/reviewed.
3. **Codegen stage last** — `docs/handoffs/2026-09-24-move-along-graph-codegen.md` remains blocked until server + editor + manual browser acceptance pass. No `src/codegen` edits are approved in this editor stage.

#### Settled `/api/preview_axes` client contract for editor-dev
- Treat the server's new coordinate metadata as authoritative only when the response includes the new contract/metadata version and finite post-recenter anchors/rect. Do not reinterpret old `offsetInkX/offsetInkY` as origin metadata.
- The client should continue storing the cropped PNG bounds (`left/right/top/bottom`) as crop extents in Manim units and add the new coordinate rect/origin+basis fields to `AxisPreviewBounds` (names chosen by server-dev, normalized to camelCase in TS).
- `axesRasterGeometry` (or an adjacent helper) must return both image geometry and the graph-coordinate-to-canvas transform used by plots/dots/guides when raster axes are active. Vector fallback must keep the current ideal graph-box transform.
- Old cached preview images and older server responses that lack the new metadata must **not** render as raster. They must invalidate or safely return `null` so the vector axes preview is used until a v2 preview can be fetched. Include a contract-version constant in the cache key or an equivalent invalidation mechanism.
- Do not fabricate anchors from crop center, labels, or request ranges. If the server response has missing/nonfinite metadata, show vector fallback and keep the warning/status actionable.

#### Editor touched-files amendment for the new dependency
Add these explicit client/cache files to the existing editor touched list:

**types/**
- `src/types/scene.ts` — extend `AxisPreviewBounds` with optional/new preview-axes contract fields (coordinate rect or origin+basis) and any V44 graph-dot attachment/style fields. Axis-preview cache metadata is UI/cache data; do not add a separate schema migration solely for missing old raster metadata, but do bump/migrate for the V44 graph-dot persisted model already planned.

**services/**
- `src/services/measureClient.ts` — parse the new `/api/preview_axes` response fields; return `bounds: null` when metadata version/anchors are missing or nonfinite so old servers fall back to vector preview.
- `src/services/axisPreviewHooks.ts` — store new bounds only for the settled contract and clear stale/unsupported previews consistently.

**lib/**
- `src/lib/axesPreviewRequest.ts`, `src/lib/axesPreviewRequest.test.ts` — include a preview-axes contract version in the visual/cache key (or equivalent invalidation) so old cached PNGs are not silently reused with v1 metadata.
- `src/lib/axesRasterPreview.ts`, `src/lib/axesRasterPreview.test.ts` — use the server-provided coordinate rect/origin+basis for overlay transforms; add missing-metadata vector-fallback tests and the exact `[-5,5,1] × [-3,3,1]`, `x/y`, scale-1 regression.
- `src/lib/graphCreatePreview.ts`, `src/lib/graphCreatePreview.test.ts` — consume the corrected graph-coordinate transform for dot/label/coordinate/guides when raster axes are active.

#### Parametric free-point decision update
This supersedes earlier wording that allowed free dots to carry explicit parametric sources. Parametric movement now **requires** a parametric attachment authored in the graph-dot editor: the point stores source curve + `t`, and a graph-follow animation row stores only the target `t` plus easing. There is no free-dot inverse mapping, no free-dot explicit parametric source, and no start-`t` field in the animation UI. Free dots may still animate along an explicit compatible function plot by x, with off-curve-start rejection as planned. Function-attached dots infer their function source and target x; parametric-attached dots infer their curve source and target t.

#### Additional editor test requirements
- Additional exact commands once the server handoff is verified:
  ```powershell
  npx vitest run src/services/measureClient.test.ts src/lib/axesPreviewRequest.test.ts src/lib/axesRasterPreview.test.ts src/lib/graphMotion.test.ts
  npx eslint src/types/scene.ts src/services/measureClient.ts src/services/axisPreviewHooks.ts src/lib/axesPreviewRequest.ts src/lib/axesPreviewRequest.test.ts src/lib/axesRasterPreview.ts src/lib/axesRasterPreview.test.ts src/lib/graphCreatePreview.ts src/lib/graphCreatePreview.test.ts src/lib/graphMotion.ts src/lib/graphMotion.test.ts src/canvas/layers/GraphNode.tsx
  ```
- `src/services/measureClient.test.ts` **(new or existing)**: normalize v2 `/api/preview_axes` fields to `AxisPreviewBounds`; reject v1/missing-anchor responses as `bounds: null` without throwing.
- `src/lib/axesPreviewRequest.test.ts`: cache/visual key changes when the preview-axes contract version changes, while still ignoring timeline-only fields.
- `src/lib/axesRasterPreview.test.ts`: old cached bounds/missing v2 anchors return `null`; reported symmetric and non-symmetric anchor fixtures map `(0,0)` and `(1, Math.sin(1))` consistently with the raster image geometry.
- `src/lib/graphMotion.test.ts`: parametric motion requires graph-dot attachment and rejects free-dot parametric rows/attempts; graph-follow rows for parametric attached dots store only target t.

#### Remaining blockers
- Server contract handoff not yet implemented/verified/reviewed.
- Manual browser acceptance has not passed and should wait for the verified editor revision.
- Codegen/export remains blocked; `GRAPH_FOLLOW_EXPORT_SUPPORTED` stays false until stage 2 implements both motion and annotation export.

## Implementation notes (editor-dev)

- What changed, per file.
- Deviations from the plan and why.
- Commands run and their result (paste short excerpts, not full logs).
- Anything left undone and why.

### 2026-09-25 architect amendment — manual acceptance fail, attached points, labels, axes alignment

#### Why this stage is back to implementation
Automated/static editor gates are recorded below as passing for the touched editor scope (`npm run build`, full `npm run test` with 544 tests, and touched-file ESLint), and the static UI re-review cleared its prior findings. Manual acceptance is **not** passed: the user tested the browser and reported that the graph-follow animation looks good, but the axes visual is misaligned from the plot/dot overlays and graph point/label authoring is still insufficient. Export remains intentionally unsupported (`GRAPH_FOLLOW_EXPORT_SUPPORTED = false`), so stage-2 codegen must continue to wait.

Do not create a duplicate handoff. Continue this editor handoff, preserve all implementation/verifier/reviewer notes above, and append new implementation notes below this amendment.

#### Expanded product scope approved by user
- Persistent graph-point attachment modes:
  - `free`: stores explicit graph coordinates `(x, y)` like today's dot.
  - `function`: stores a `graphPlot` source plus `x`; displayed `y` recomputes from the source function whenever the source expression/domain changes.
  - `parametric`: stores a `graphCurve` source plus `t`; displayed `(x, y)` recomputes from the source parametric curve whenever the source expressions/domain change.
- Movement now works on both source kinds: function-attached points animate their x parameter; parametric-attached points animate their t parameter. Chained clips, easing, pauses, and destination holds remain as before.
- An attached-point animation must infer its source from the point attachment; it must not ask the user to pick the same source again. Free points may still be animated along an explicitly selected compatible source, but the resolver must reject off-curve/off-curve-at-start cases with the existing warning policy.
- Keep the resolved policies: reject off-curve starts with no snap/jump; block detected invalid/domain-hole/discontinuity intervals best-effort with no invalid preview/export; projection guides terminate at the nearest visible range boundary when zero is outside the displayed range.
- Graph shape / generic object-on-graph animation remains out of scope.
- Add a separate **Labels & coordinates** popover for graph dots. It configures fixed-label and coordinate-text presentation independently: text, font size, color, direction, spacing/buffer; coordinate precision applies only to the coordinate text. Do **not** add font family, bold, italic, or canvas label dragging.

#### Revised persisted API contract
This is another persisted shape change after current V43. Bump to the next live version, expected **V44** unless another task advances `PROJECT_VERSION` first. Add a V44 migration and tests.

Recommended data model (implementation may rename narrowly if tests/docs are updated consistently):

```ts
export type GraphDotAttachment =
  | { kind: 'free' }
  | { kind: 'function'; graphPlotId: ItemId; x: number }
  | { kind: 'parametric'; graphCurveId: ItemId; t: number };

export interface GraphDot {
  // existing fields retained for compatibility/free-mode coordinates
  dx: number;
  dy: number;
  label: string;
  labelDir: ManimDirection;
  attachment?: GraphDotAttachment; // V44 migration backfills { kind: 'free' }
  labelFontSize?: number;           // HebrewMathLine font_size units; default 18
  labelColor?: string;              // default '#ffffff'
  labelSpacing?: number;            // Manim units; default 0.15
  coordinateFontSize?: number;      // HebrewMathLine font_size units; default 18
  coordinateColor?: string;         // default '#e2e8f0'
  coordinateDir?: ManimDirection;   // default opposite/offset from label when unset
  coordinateSpacing?: number;       // Manim units; default 0.15
  coordinatePrecision?: number;     // integer [0, 6], default 2
}
```

For target-animation rows, keep existing V43 legacy fields readable, but migrate/prefer a source-inferred model:
- Attached dot rows store only the target parameter (`targetX` for function or `targetT` for parametric, or a generic `targetParam` if chosen) plus easing. Source comes from the dot attachment.
- Free-dot rows may carry an explicit source (`graphPlotId` for function or `graphCurveId` for parametric) and target parameter. The resolver must validate the free point starts on that source within tolerance.
- V44 migration must preserve V43 graphFollow projects. For a graph dot with legacy graphFollow rows all referencing the same valid `graphPlotId`, either attach the dot to that function source using its current `dx` or keep the legacy source on the rows; in both cases legacy projects must still load and preview. If rows are ambiguous/missing source, leave the dot free and surface a repairable validation warning rather than silently choosing a source.

#### Axes alignment defect investigation plan
User reproduction data is sufficient for a first targeted regression, but not for exact pixel-offset diagnosis: axes `xRange=[-5,5,1]`, `yRange=[-3,3,1]`, labels `x`/`y`, `scaleX=scaleY=1`, frame `(0,0)`, plot `sin(x)`, playhead around `3.2s`, live dot `(1.00, 0.84)`. User reports dot and function are aligned with each other, but both are displaced upper-right relative to the axes intersection/axis raster; earlier `(0,0)` dot was visibly upper-right of the axes crossing. Latest screenshot's selection box includes labels/ink, so do **not** assume the selection rectangle is the plot box.

Evidence from current implementation to inspect first:
- `GraphNode.tsx` maps plots/dots with ideal graph-box math (`toLocal`, `axW`, `axH`).
- Completed axes may render as a cropped Manim raster via `axesRasterGeometry`, while overlays still use ideal graph-box coordinates.
- `measure_server.py` builds the preview from `VGroup(ax, labels...)` and `grp.move_to(ORIGIN)`, then returns cropped ink bounds plus `offset_ink_x/y`; `axesRasterGeometry.ts` currently uses `left/top/width/height` and ignores `offsetInkX/offsetInkY`.

This strongly suggests the bug is in the shared axes raster/image-bounds-to-overlay transform path, but it is **not diagnosed yet**. Editor-dev must add a focused regression using the exact domain above and investigate both cases: raster axes enabled/stale and vector fallback. The fix must be a shared accurate transform, not a hardcoded screenshot offset. If honoring existing `offsetInkX/offsetInkY` or changing client placement suffices, keep this in editor-dev. If the server response lacks enough information to align `ax.c2p(0,0)` / graph-box origin inside the cropped PNG, stop and report; the Orchestrator should then create a separate `server-dev` handoff for `/api/preview_axes` origin metadata and its endpoint/render gates. Do not edit `measure_server.py` from this editor handoff.

#### Touched files amendment
Add these to the existing touched list (paths relative to `manim-timeline/` unless noted):

**types/**
- `src/types/scene.ts` — add graph-dot attachment and label/coordinate style fields; retain V43 `graphFollow` compatibility fields.

**lib/**
- `src/lib/constants.ts`, `src/lib/migrateLoadedItems.ts`, `src/lib/migrateProjectToV44.ts`, `src/lib/migrateProjectToV44.test.ts` **(last two new)** — V44 migration for dot attachment/style defaults and legacy V43 graphFollow compatibility; renumber if needed.
- `src/lib/graphMotion.ts`, `src/lib/graphMotion.test.ts` — source-agnostic point resolver for free/function/parametric attachments, inferred-source graphFollow clips, free-point off-source validation, source deletion diagnostics, source-edit recomputation, and conflict handling.
- `src/lib/graphAnnotationLayout.ts`, `src/lib/graphAnnotationLayout.test.ts` **(new)** — shared fixed-label/coordinate-text placement, size/color/direction/spacing/precision defaults, and guide endpoint geometry in graph/Manim units.
- `src/lib/axesRasterPreview.ts`, `src/lib/axesRasterPreview.test.ts` — fix/test raster-to-overlay alignment; add the exact `[-5,5] × [-3,3]`, labels `x/y`, scale 1 regression.
- `src/lib/axesPreviewRequest.ts`, `src/lib/axesPreviewRequest.test.ts` — only if client-side cache keys need to include newly consumed origin/bounds fields; do not add server contract fields here without a server handoff.
- `src/lib/graphCreatePreview.ts`, `src/lib/graphCreatePreview.test.ts` — consume attachment/layout helpers for dot, fixed label, coordinate label and projection guides.
- `src/lib/visualPlaybackPreview.ts`, `src/lib/visualPlaybackPreview.test.ts` — update graphFollow accumulation for function x and parametric t; preserve existing generic target animations.
- `src/lib/projectFragment.ts`, `src/lib/projectFragment.test.ts`, `src/lib/mtprojBundle.test.ts`, `src/lib/multisceneNormalize.test.ts` — copy/load/save attachment source references and style fields; reject partial fragments with missing attached sources.

**store/**
- `src/store/factories.ts` — defaults for V44 attachment/style fields; new graph dots default to `free` with current `dx/dy`.
- `src/store/useSceneStore.ts`, `src/store/useSceneStore.graphMotion.test.ts` — diagnostics for invalid/missing attachments, source deletion, legacy rows, source edits, and export guard still false.

**UI / canvas / timeline**
- `src/panels/GraphDotEditor.tsx` — replace inline coordinate/guides toggles with attachment controls and a Labels & coordinates popover. No label dragging, font family, bold, or italic.
- `src/panels/TargetAnimationEditor.tsx`, `src/hooks/useAddSceneItems.ts`, `src/panels/AddObjectToolbar.tsx` — infer source for attached dots; allow free-dot animation only with an explicit selected/compatible source; add parametric source/t target controls.
- `src/canvas/layers/GraphNode.tsx` — render attached/free dot positions and annotation layout from shared helpers; fix axes raster/overlay alignment; keep plot/dot overlay math shared.
- `src/timeline/TimelineClip.tsx` — update graphFollow summary/tooltip to show x or t target and inferred source diagnostics.
- `src/panels/ExportPanel.tsx` — keep guard false and update block text for attachment/annotation fields; codegen stage removes/flips.

**docs**
- `docs/handoffs/2026-09-24-move-along-graph-editor.md` (repo-relative) — this amendment only; later roles append below.

#### Invariants at risk amendment
- **Axes raster/overlay alignment** — enforced by `src/lib/axesRasterPreview.ts`, `src/lib/graphCreatePreview.ts`, and `src/canvas/layers/GraphNode.tsx`. A graph coordinate `(0,0)` must map to the visual axes intersection for the exact reported domain, with and without raster preview.
- **Attachment source of truth** — enforced by `src/types/scene.ts` and `src/lib/graphMotion.ts`. Function/parametric attached points recompute from their source expressions; do not cache stale y/x-y as authoritative except for free fallback/legacy repair.
- **Schema chain** — enforced by `src/lib/constants.ts`, `src/lib/migrateLoadedItems.ts`, V43 and V44 migration tests. V43 projects from the initial implementation must load into the V44 model without data loss.
- **Annotation style parity** — `src/lib/graphAnnotationLayout.ts`, `GraphNode.tsx`, and the codegen handoff must agree on label direction/spacing/precision/style. Preview can approximate text dimensions, but source fields and defaults must be identical.
- **Manual acceptance remains required** — automated tests/static reviews do not waive the user's browser gate. Status cannot advance to codegen until the user/manual tester confirms axes alignment and point/label authoring are acceptable.

#### Test plan amendment
Run from `manim-timeline/` after implementation:
```powershell
npx vitest run src/lib/migrateProjectToV43.test.ts src/lib/migrateProjectToV44.test.ts src/lib/graphMotion.test.ts src/lib/graphAnnotationLayout.test.ts src/lib/axesRasterPreview.test.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.test.ts src/store/useSceneStore.graphMotion.test.ts
npx vitest run src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts src/lib/axesPreviewRequest.test.ts
npm run build
npm run test
npm run lint
npx eslint src/types/scene.ts src/lib/constants.ts src/lib/migrateLoadedItems.ts src/lib/migrateProjectToV43.ts src/lib/migrateProjectToV43.test.ts src/lib/migrateProjectToV44.ts src/lib/migrateProjectToV44.test.ts src/lib/graphMotion.ts src/lib/graphMotion.test.ts src/lib/graphAnnotationLayout.ts src/lib/graphAnnotationLayout.test.ts src/lib/axesRasterPreview.ts src/lib/axesRasterPreview.test.ts src/lib/graphCreatePreview.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.ts src/lib/visualPlaybackPreview.test.ts src/lib/exportReadiness.ts src/lib/exportReadiness.test.ts src/lib/projectFragment.ts src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts src/lib/axesPreviewRequest.ts src/lib/axesPreviewRequest.test.ts src/store/factories.ts src/store/useSceneStore.ts src/store/useSceneStore.graphMotion.test.ts src/hooks/useAddSceneItems.ts src/panels/AddObjectToolbar.tsx src/panels/TargetAnimationEditor.tsx src/panels/GraphDotEditor.tsx src/panels/ExportPanel.tsx src/canvas/layers/GraphNode.tsx src/timeline/TimelineClip.tsx
npm run dev
```

Required added/extended test blocks:
- `src/lib/axesRasterPreview.test.ts`: `describe('axes raster overlay alignment regression')` using `xRange=[-5,5,1]`, `yRange=[-3,3,1]`, labels `x/y`, `scaleX=scaleY=1`; assert graph coordinate `(0,0)` / `(1, Math.sin(1))` map to the same local origin/overlay positions for raster and vector geometry. Include a case whose raster ink bounds include labels/numbers so the selection bbox differs from the graph box.
- `src/lib/graphMotion.test.ts`: `describe('attached graph dots')` for free/function/parametric resolution, source expression edit recomputation, source deletion warnings, function x and parametric t animation, attached-source inference, free-point explicit-source off-curve rejection, detected invalid intervals, and legacy V43 row compatibility.
- `src/lib/graphAnnotationLayout.test.ts`: fixed label and coordinate label independently honor font size/color/direction/spacing/precision; no bold/italic/font-family fields exist; nearest-boundary guide endpoints preserved.
- `src/lib/migrateProjectToV44.test.ts`: V43 graph dots/rows migrate to attachment/style defaults; existing V43 graphFollow rows remain usable or produce repairable diagnostics; already-migrated data is idempotent.
- `src/store/useSceneStore.graphMotion.test.ts`: attachment updates, undo/redo, source deletion/edit diagnostics, export guard still blocks attachment/annotation projects before codegen.

Manual/browser acceptance before returning to codegen:
- Reproduce the user's axes setup and verify the visual axes intersection, sin curve, live point `(1.00, 0.84)`, fixed label and coordinate label align while scrubbing around `3.2s`.
- Toggle raster preview availability if possible: completed raster axes and vector fallback must agree.
- Author free/function/parametric attached points, edit the source expression/domain, and verify points recompute.
- Create graphFollow clips for function x and parametric t with chained pauses and holds; attached points infer source; free points reject off-source starts.
- Use the Labels & coordinates popover to independently change label and coordinate size/color/direction/spacing/precision; no dragging/font-family/bold/italic controls appear.
- Save/reopen JSON and `.mtproj`; copy fragments with/without sources; verify export guard remains clear and actionable.

After verifier passes, request **ui-reviewer** for the new UI and **manim-reviewer** for the visual-defect/raster-origin review. The manim-reviewer should not review graph-follow export yet; export is still guarded off.

#### Blocking user questions
None at this time. If the axes misalignment cannot be reproduced/fixed from the supplied domain and screenshot evidence, request a minimal `.json` project or exact canvas dimensions from the user before guessing. If server coordinate-origin metadata is required, stop and ask Orchestrator for a separate server-dev handoff.

### 2026-09-25 implementation attempt

- Changed `src/types/scene.ts`: added `graphFollow` target-animation mode/row fields and optional graph-dot annotation flags.
- Changed `src/lib/constants.ts`, `src/lib/migrateLoadedItems.ts`; added `src/lib/migrateProjectToV43.ts` and its test: incremented persisted version and backfilled optional defaults idempotently.
- Added `src/lib/graphMotion.ts` and a focused resolver test. It currently resolves a JS plot expression, same-axes reference and eased x interpolation, rejects missing plot/axes and off-curve starts. It does **not** yet implement the full requested interval sampling/discontinuity/overlap detection, annotation geometry, or rendering integration.
- Deviation/blocker: the requested stage is substantially incomplete. No store authoring actions, UI, canvas/timeline preview integration, export readiness guard, save/copy semantics, or broader round-trip tests were implemented. No files outside this handoff and the above code files were edited; no codegen/agent/time edits were made. This must not be treated as feature completion.
- Verification: `npm run build` passed (Vite chunk-size warning only). `npx vitest run src/lib/graphMotion.test.ts src/lib/migrateProjectToV43.test.ts` passed (2 tests). `npm run test` initially failed the graphMotion test before adding its axes fixture; the focused rerun passed; full suite not rerun afterward. `npm run lint` failed with 37 errors/6 warnings in existing files (including components, time.ts, ExportPanel, etc.); no touched-file-specific lint gate was run.
- Manual browser acceptance was not attempted. Export remains unsupported as before; stage 2 remains wholly separate.

### 2026-09-25 continuation

- `src/lib/graphMotion.ts`: expanded the public shared API with same-axes/function evaluation, deterministic timeline sorting, smooth/linear graph-x interpolation, chained destination holds, numeric start-on-curve tolerance, x-domain + 128-sample nonfinite/discontinuity checks, same-dot overlap errors for graphFollow/move/path, and projection-guide endpoint fallback. Sampling is best-effort, not a proof of continuity.
- `src/lib/graphCreatePreview.ts`, `src/canvas/layers/GraphNode.tsx`, `src/lib/visualPlaybackPreview.ts`: exposed reusable graph-dot coordinate/projection geometry and wired the canvas/scrub preview to resolved graph coordinates. Invalid motion shows a warning and does not move through the invalid interval. Existing fixed labels still render from the unchanged dot label fields.
- `src/store/factories.ts`, `src/hooks/useAddSceneItems.ts`, `src/panels/AddObjectToolbar.tsx`, `src/panels/TargetAnimationEditor.tsx`, `src/panels/GraphDotEditor.tsx`: defaults, compatible graph-dot/plot insertion, row editing, duration/easing through existing controls, and live-coordinate/projection toggles. New Hebrew labels use RTL direction.
- `src/lib/exportReadiness.ts`, `src/lib/exportReadiness.test.ts`, `src/panels/ExportPanel.tsx`: added `GRAPH_FOLLOW_EXPORT_SUPPORTED = false`; preview/copy/render paths are blocked with an actionable message while graph-follow clips exist, including idle scenes.
- `src/lib/itemDisplayName.ts`, `src/timeline/TimelineClip.tsx`: new timeline name/color and tooltip diagnostics.
- `src/lib/projectFragment.ts`, `src/lib/projectFragment.test.ts`: remap graph-dot/plot references on fragment copy and throw if the referenced dot/plot is omitted.
- `src/lib/migrateProjectToV43.ts`, `src/lib/migrateProjectToV43.test.ts`, `src/lib/migrateLoadedItems.ts`, `src/lib/constants.ts`, `src/types/scene.ts`: V43 persistence fields and migration preserved from the initial implementation.
- `src/lib/mtprojBundle.test.ts`, `src/lib/multisceneNormalize.test.ts`: round-trip/reference persistence coverage. `src/store/useSceneStore.graphMotion.test.ts`, `src/lib/graphMotion.test.ts`, `src/lib/graphCreatePreview.test.ts`, `src/lib/visualPlaybackPreview.test.ts`: validation, motion, guide geometry, scrubbing and ordinary store undo coverage.
- Deviations: `src/store/useSceneStore.ts` remains unchanged; graph-follow edits use the existing ordinary item add/update/delete actions and undo history, with diagnostics generated by the shared resolver and shown in the row/timeline/canvas. No separate persisted store diagnostic cache was added. `src/lib/time.ts` was not edited; graphFollow is treated as a non-drawable target-animation clip by its existing timing model. Codegen remains intentionally unsupported and untouched.
- Automated gates from `manim-timeline/`: the handoff-focused test groups passed (`53` and `20` tests); `npm run test` passed (`69` files, `540` tests); `npm run build` passed (Vite emitted only the existing large-chunk advisory). Touched-file ESLint passed except `src/panels/ExportPanel.tsx`, which retains two baseline `no-useless-catch` errors at the pre-existing render try/catch blocks (current lines 237 and 403; the same errors were present at lines 221 and 385 in the initial lint run). `npm run lint` remains red with 37 repository-wide errors/6 warnings in existing unrelated files; touched-file lint output identified no new errors outside those two ExportPanel baseline findings.
- Manual acceptance: not performed; no browser-driving tool was available in this session. Do not infer visual acceptance from build/tests. Stage 2 codegen and the separate verifier/UI review remain outstanding.
- Follow-up correction: `src/store/useSceneStore.ts` now exposes read-only `graphMotionDiagnostics(dotId, time?)`, which reports missing-dot references, positional overlaps, and resolver errors; the target-animation row consumes it. The prior deviation statement (“remains unchanged”) describes the earlier continuation point and is superseded by this correction.
- Final post-correction gates: `npm run build` passed; `npm run test` passed (`69` files, `541` tests); targeted ESLint passed all touched files except the two unchanged `ExportPanel.tsx` `no-useless-catch` baseline findings. `npx eslint src/panels/ExportPanel.tsx --rule 'no-useless-catch: off'` passed, confirming no other lint findings in that file. Full `npm run lint` remains blocked by the already-listed repository-wide baseline findings.

### 2026-09-25 verifier-finding fixes

- `src/panels/ExportPanel.tsx`: removed both nested catch-and-rethrow wrappers around audio preparation and per-scene preparation. The surrounding existing try/catch handlers remain responsible for reporting the same errors; no lint suppression was added.
- `src/lib/graphMotion.ts`: added `resolveGraphFollowSelection(items, selectedIds)` as a pure shared pair resolver. It rejects a selected dot with a plot on different axes, multiple selected dots/plots, missing pairs, and ambiguous plots; it permits only a same-axes pair.
- `src/hooks/useAddSceneItems.ts` and `src/panels/AddObjectToolbar.tsx`: both now consume that one resolver. The toolbar disables insertion and exposes the resolver's explanatory error as title text; the insertion callback also independently rejects the invalid pair, closing bypasses.
- `src/lib/graphMotion.test.ts`: regression covers explicit wrong-axes selected plot despite a compatible plot existing, and verifies an explicit valid pair succeeds.
- Export readiness API for stage 2: `src/lib/exportReadiness.ts` owns `GRAPH_FOLLOW_EXPORT_SUPPORTED` and `graphFollowExportBlock(items)`. The store exposes `graphFollowExportBlock()` for the active scene; `ExportPanel` consumes it plus the same helper across idle scenes. While false, both graphFollow clips and graph-dot live annotation flags block export (including annotation-only scenes, since current exporter would otherwise silently omit those visible settings). Stage 2 must flip the named capability constant only after motion and annotation emission are supported.
- `src/lib/exportReadiness.test.ts` and `src/store/useSceneStore.graphMotion.test.ts`: assert clip guard, annotation-only guard, default-disabled annotations, and active-store consumption.
- Commands/results from `manim-timeline/`: focused suites passed (`58` + `20` tests); `npm run build` passed (large-chunk advisory only); `npm run test` passed (`69` files, `543` tests); the exact touched-file ESLint command passed clean, including `ExportPanel.tsx` with no disabled rule.
- Remaining: `npm run lint` has repository-wide baseline errors in files outside this handoff scope, as recorded above. Manual browser acceptance remains unavailable/unperformed; verifier/UI review is still required. No codegen, `src/lib/time.ts`, or agent files were edited.

### 2026-09-25 ui-review finding fixes

- `src/lib/graphMotion.ts`: centralized `isGraphFollowTarget`, `graphFollowMinimumStartTime`, and `graphFollowStartTimeError`. Minimum start delegates each graph dot's time to the existing `effectiveStart` contract from `src/lib/time.ts`; no parallel timing semantics were added and `time.ts` was not edited. Resolver now rejects clips starting before the dot appears.
- `src/panels/TargetAnimationEditor.tsx`: uses the shared graph-follow target predicate both when building the row target set and for the final validity label, eliminating the false generic invalid-target warning for valid graph dots. Uses the shared graph-follow minimum-start helper and shows a graph-dot-specific warning.
- `src/panels/ExportPanel.tsx`: disables Copy while export readiness is blocked and gives the button the same explanatory title, while retaining the handler guard.
- `src/lib/graphMotion.test.ts`: added regressions for graph-dot eligibility, minimum required start, before-start error text, and resolver rejection when the dot has not appeared.
- Verification from `manim-timeline/`: focused suite passed (`59` tests); focused copy/bundle/normalize suite passed (`20` tests); `npm run build` passed (Vite large-chunk advisory only); `npm run test` passed (`69` files, `544` tests); exact touched-file ESLint command passed with no output.
- Still pending: manual browser acceptance is unavailable in this session; no claim of full stage acceptance. No `src/lib/time.ts`, codegen, or agent files changed. Status remains `implementing` pending subsequent verification/review.

### 2026-09-25 axes raster origin diagnosis — blocked for server contract

- Per the architect amendment, I stopped before making any client edits in this continuation. Existing evidence is insufficient to accurately position overlays against the raster axes without guessing.
- Server contract evidence: `measure_server.py:217-228` defines `AxesPreviewResponse` with the cropped PNG dimensions, aggregate ink `left/right/top/bottom`, and `offset_ink_x/y`; it returns no axes plot-box anchor or `Axes.c2p(0,0)` coordinate. `measure_server.py:653-687` assembles a `VGroup(ax, x_label, y_label)`, recenters the *group* with `grp.move_to(ORIGIN)`, crops/rasterizes the entire group, and returns only those aggregate extents/offsets. `mobject_to_cropped_png_base64` (`measure_server.py:231-310`) defines `offset_ink` as cropped-ink center minus the enclosing mobject center, not axes origin. Thus the metadata cannot identify where the coordinate axes intersection lies within a crop that also contains labels, tips, and optional numbers.
- Client evidence: `services/measureClient.ts:254-271` maps only those six response values to `AxisPreviewBounds`. `axesRasterPreview.ts:43-80` positions/scales the raster with aggregate ink bounds and does not consume `offsetInkX/Y`; `GraphNode.tsx` overlays graph geometry using ideal `axW/axH` and range-derived coordinates around the axes node center. These values do not provide the axes-origin-to-image transform needed to reconcile the raster's graph intersection with vector overlays. The user's sample domain and `(1, sin(1))` are sufficient to make a regression once the server exposes that missing anchor, but not to infer its value from the screenshot.
- Required server-dev contract: extend `/api/preview_axes` response with graph-coordinate transform anchors measured **after** the axes+labels VGroup has been moved to ORIGIN, e.g. `graph_origin_x/y = ax.c2p(0,0)` after group recentering plus x/y basis vectors (or equivalent plot-box boundary anchors sufficient to map any `(x,y)` to Manim scene coordinates). These anchors must be independent of the cropped all-ink bbox and returned alongside existing bounds; add endpoint-level test proving the returned origin maps to the visual axes crossing for ranges/labels/numbers/tips, including the specified `[-5,5] × [-3,3]` setup. Then client can map image pixels/Manim crop bounds and graph overlays from the same coordinate space without a guessed pixel offset.
- Stop reason: an exact client transform regression cannot be implemented truthfully until this API data exists. No axes/client files were changed in this attempt; no codegen, `src/lib/time.ts`, agent, or Python files were modified. Requesting a separate `server-dev` handoff through the orchestrator before resuming overlapping client transform work. Manual browser acceptance remains pending.
- No V44 schema/attachment/UI work or gates were started in this continuation because the architect specifically ordered the raster-origin diagnosis first and to stop before overlapping client edits if server metadata is missing. Existing editor implementation and WIP are preserved.
- Separate product/API question to resolve after the server handoff: a free dot stores `(x,y)`, while a parametric curve may have multiple `t` values mapping to that point. The current model has no authored start-`t` for a free dot. I will not numerically invert or silently select a branch; confirm whether the free-point parametric UI must require an explicit start `t` (or whether parametric motion should be attached-point-only).

### 2026-09-25 continuation after verified server anchors

- Dependency consumed without editing the server handoff: `src/services/measureClient.ts` parses the exact server v1 fields (`metadata_version`, `origin_x/y`, `x_unit_x/y`, `y_unit_x/y`, `coord_left/right/top/bottom`) and accepts raster bounds only when metadata version 1, all anchors, crop bounds, and PNG dimensions are finite/valid. Missing/invalid metadata or PNG data yields vector fallback with an actionable preview error. `src/lib/axesPreviewRequest.ts` includes metadata contract version 1 in the cache key; `src/services/axisPreviewHooks.ts` retries when URL/key changes without creating an error-fetch loop.
- Axes transform: `src/lib/axesRasterPreview.ts` returns crop geometry and graph transform separately using server origin+basis. `axesVectorOverlayOffset`/`axesOverlayPoint` align vector axes and graph overlays in the same post-recenter coordinate space while raster images are loading/animating; stale/legacy metadata falls back to ideal vector geometry. `GraphNode.tsx` routes plots, curves, graph dots/annotations/guides, graph areas, fields, streamlines and point overlays through the shared transform. The exact regression uses the server reviewer anchor values for the `[-5,5] × [-3,3]` / `sin(1)` case and checks the offset origin is not inferred from crop center. This is mathematical regression evidence only, not browser visual acceptance.
- V44 persisted model: `src/types/scene.ts`, `src/lib/constants.ts`, `src/lib/migrateLoadedItems.ts`, new `src/lib/migrateProjectToV44.ts` and test. Migration backfills free attachments and independent label/coordinate defaults, preserves explicit values and V43 `graphFollow` rows, and clamps precision. V43 plot-backed rows remain usable after load as free-dot/function rows.
- `src/lib/graphMotion.ts`: resolves free dots, function attachments (`x → f(x)`), and parametric attachments (`t → (x(t),y(t))`), recomputes from current source expressions, validates same-axes/source/domain and sampled intervals, chains/holds x/t parameters, and reports source deletion/errors. Free-dot function motion remains explicit-source/on-curve validated; free-dot parametric motion is rejected. Resolver returns the current parameter for insertion/chaining defaults; no inverse parametric lookup exists.
- `src/lib/graphAnnotationLayout.ts` and tests: shared fixed-label/coordinate placement, defaulting, direction/spacing/size/color, RTL fixed labels, coordinate formatting precision and graph-guide geometry. The UI exposes no font-family/bold/italic or label-drag controls.
- `src/store/factories.ts`, `src/store/useSceneStore.ts`, and store regression tests: new free attachment/style defaults; diagnostics include missing attachment sources with or without graph-follow clips; source edits recompute by resolving live source data, and source deletion is visible. Standard item updates retain undo behavior. Fragment copy remaps attachment/source references and rejects partial attached-source copies; multiscene and `.mtproj` persistence tests cover the new fields.
- `src/panels/GraphDotEditor.tsx`: free/function/parametric attachment controls; a reusable Escape-dismissible `FloatingPanel` “Labels & coordinates” popover with independent label/coordinate text presentation, size, color, direction and spacing plus coordinate-only precision. Uses existing `NumberInput`, `ColorPicker`, `DirectionPicker`; Hebrew controls are RTL. Switching an attached dot back to free snapshots its resolved current graph coordinates.
- `src/panels/TargetAnimationEditor.tsx`, `src/hooks/useAddSceneItems.ts`, `src/panels/AddObjectToolbar.tsx`, `src/timeline/TimelineClip.tsx`: attached dots infer function/curve sources; attached function rows expose target x, parametric rows target t; only free dots choose an explicit function source; free parametric mode is unavailable. Insertion defaults to the currently resolved parameter and timeline summaries/diagnostics identify x/t and source.
- `src/lib/exportReadiness.ts` and `ExportPanel` continue to block export for graph-follow motion, non-free static attachments, live annotations, or custom fixed-label styles until stage 2 supports all persisted behavior.
- Automated gates from `manim-timeline/`: amended focused suites passed (`76` + `27` tests); `npm run build` passed (Vite large-chunk advisory only); `npm run test` passed (`72` files, `559` tests); exact amended touched-file ESLint passed with no output. No codegen, `src/lib/time.ts`, `src/agent`, Python, server, README or unrelated WIP files were edited in this continuation.
- Manual/browser acceptance remains **pending**. The server reviewer’s PNG/Manim render pass validates the backend anchors only; it does not validate this client integration. User should switch the app’s measure URL to the verified updated backend on port `8766`, then retest axes/raster vs vector alignment, attached points/source edits, chained x/t motion, popover/Escape/undo, save/reopen and export blocking. No browser test or visual-match claim is made here.

### 2026-09-25 parametric chaining regression follow-up

- `src/lib/visualPlaybackPreview.test.ts`: added the required end-to-end preview-helper regression for a parametric-attached dot with two inferred-source `targetT` clips separated by a pause. Assertions cover before the first clip, exact start, in-progress t, exact first boundary, pause hold, second start, in-progress second clip, exact final boundary, final hold, reverse seeking, unchanged source/timeline items (no mutation), and source expression edits recomputing both x and y. The rows intentionally contain `targetT` but no `graphCurveId`, proving source inference comes from the dot attachment.
- Test outcome: this regression passed against `graphFollowPreviewPosition` → `resolveGraphDotPosition`; it exposed no resolver bug. No implementation workaround or duplicate motion logic was added.
- Final verification from `manim-timeline/`: focused expanded editor suites passed (`77` tests); focused copy/load/cache/server-contract suites passed (`27` tests); `npm run build` passed (Vite large-chunk advisory only); `npm run test` passed (`72` files, `560` tests); amended touched-file ESLint passed with no output.
- Manual/browser acceptance remains pending and was not attempted. The active user dev server on port `5173` was not stopped or restarted. Server, codegen, `src/lib/time.ts`, agent, and unrelated WIP files remain untouched by this follow-up; status stays `implementing` for orchestrator verifier/review dispatch.

### 2026-09-25 Labels & coordinates popover interaction follow-up

- `src/panels/GraphDotEditor.tsx`: the Labels & coordinates trigger exposes dialog state and refs for trigger/popover scope. Opening moves focus to the first form control; Escape and the panel close button dismiss, stop Escape propagation, and restore focus. Tab/Shift+Tab cycle within the popup. Document pointerdown dismisses only outside the wrapper/trigger; normal descendants are contained, React portal descendants are marked through synthetic capture, and composed-path/data-marker checks cover explicitly portaled controls. ColorPicker/DirectionPicker/NumberInput clicks do not dismiss. Outside-pointer dismissal leaves focus on the clicked outside target rather than stealing it back.
- No React component test harness exists in the frontend test tree (no React Testing Library/render-hook usage), so no test dependency/harness was added. The interaction change is statically reviewed; manual/browser verification remains pending.
- Gates from `manim-timeline/`: `npm run build` passed (Vite large-chunk advisory only); `npm run test` passed (`72` files, `560` tests); the amended touched-file ESLint command passed cleanly, including `GraphDotEditor.tsx`.
- Port `5173` was left running and untouched. No server/Python, codegen, `src/lib/time.ts`, agent, or unrelated WIP changes. Status stays `implementing` for verifier and UI re-review; manual user acceptance remains pending.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Focused resolver/migration/export/preview/store tests | `npx vitest run src/lib/migrateProjectToV43.test.ts src/lib/graphMotion.test.ts src/lib/exportReadiness.test.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.test.ts src/store/useSceneStore.graphMotion.test.ts` | pass — `Test Files 6 passed (6); Tests 56 passed (56)` |
| Focused copy/bundle/normalize tests | `npx vitest run src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts` | pass — `Test Files 3 passed (3); Tests 20 passed (20)` |
| Frontend build | `npm run build` | pass — `✓ 300 modules transformed`; Vite large-chunk advisory only |
| Full frontend tests | `npm run test` | pass — `Test Files 69 passed (69); Tests 541 passed (541)` |
| Repository lint | `npm run lint` | fail — `✖ 43 problems (37 errors, 6 warnings)`, including touched `src/panels/ExportPanel.tsx:237:7` and `:403:9` `no-useless-catch` |
| Touched-file lint | `npx eslint src/types/scene.ts src/lib/constants.ts src/lib/migrateLoadedItems.ts src/lib/migrateProjectToV43.ts src/lib/migrateProjectToV43.test.ts src/lib/graphMotion.ts src/lib/graphMotion.test.ts src/lib/exportReadiness.ts src/lib/exportReadiness.test.ts src/lib/graphCreatePreview.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.ts src/lib/visualPlaybackPreview.test.ts src/lib/itemDisplayName.ts src/lib/projectFragment.ts src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts src/store/factories.ts src/store/useSceneStore.ts src/store/useSceneStore.graphMotion.test.ts src/hooks/useAddSceneItems.ts src/panels/AddObjectToolbar.tsx src/panels/TargetAnimationEditor.tsx src/panels/GraphDotEditor.tsx src/panels/ExportPanel.tsx src/canvas/layers/GraphNode.tsx src/timeline/TimelineClip.tsx` | fail — exactly two touched-file errors remain: `ExportPanel.tsx` `no-useless-catch` at 237 and 403. Rule-disabled lint is not counted as clean. |
| Dev server/manual UI gate | `npm run dev` | started but manual pending — Vite reported `ready in 1857 ms` at `http://localhost:5173/`; command was stopped by timeout, and no browser acceptance was performed. |
| Working tree inventory | `git status --short`; `git diff --stat` | inspected — many baseline WIP files remain outside this handoff; tracked diff stat before verifier edit showed `46 files changed, 1267 insertions(+), 131 deletions(-)` plus untracked files. |

- Out-of-scope changes found in the diff (files not in "Touched files"):
  - Baseline/non-task WIP present and not attributed to this editor stage: `.cursor/agents/architect.md`, `.cursor/agents/orchestrator.md`, `.cursor/rules/agent-workflow.mdc`, `.opencode/agents/architect.md`, `.opencode/agents/orchestrator.md`, `AGENTS.md`, `opencode.json`, `docs/handoffs/2026-09-24-camera-zoom-codegen-resume.md`, `docs/handoffs/2026-09-24-camera-zoom-copilot-resume.md`, `docs/handoffs/2026-09-24-orchestrator-agent.md`, Copilot files under `manim-timeline/src/agent/`, and codegen/camera files under `manim-timeline/src/codegen/`.
  - `docs/handoffs/2026-09-24-move-along-graph-codegen.md` is untracked and outside this editor stage's touched-file list, although the plan references the separate stage-2 handoff.
- Claims in "Implementation notes" that could not be confirmed or are not sufficient for acceptance:
  - Lint is not clean for touched files: `ExportPanel.tsx` still fails `no-useless-catch`; the rule-disabled check does not satisfy the required gate.
  - Manual browser acceptance remains unconfirmed; `npm run dev` only proved Vite starts.
  - Store/export consumption of the temporary guard is only partially confirmed: `GRAPH_FOLLOW_EXPORT_SUPPORTED = false` exists and `ExportPanel` blocks code/copy/render paths, but `grep` found no store consumer of `graphFollowExportBlock`.
  - Selected-dot normal flow exists, but code inspection found a same-axes loophole: `useAddSceneItems.ts` uses a selected plot even when it is not on the selected dot's axes, while `AddObjectToolbar.tsx` can still enable when any same-axes plot exists. This can create an invalid graph-follow clip instead of disabling/explaining the incompatible selected plot.
  - Tests cover schema V43, resolver poles (`1 / x`, `Math.tan(x)`), copy remapping, bundle/normalize round-trips, preview helper, and store undo basics. They do not exercise the toolbar/hook insertion path, ExportPanel UI buttons, save/reopen in a browser, or the full manual scrub scenarios.
- Invariants checked against the diff:
  - Persisted schema: confirmed `PROJECT_VERSION` 43, `migrateItemsToV43` wiring, and tests for graph-dot flags/easing defaults.
  - Resolver source of truth: preview uses `graphMotion` via `graphFollowPreviewPosition`/`resolveGraphDotPosition`; invalid intervals return an error and current/held point, and export is blocked while stage 2 is unsupported.
  - Copy/load: `projectFragment.ts` remaps `graphPlotId`/`targetId` and rejects partial fragments; `.mtproj` and multiscene tests retain fields.
  - Codegen stage: no graph-follow Python assertions are expected in stage 1; `GRAPH_FOLLOW_EXPORT_SUPPORTED = false` is present.

Verdict: **fail**. Required gates fail at `npm run lint` and touched-file ESLint (`src/panels/ExportPanel.tsx:237`, `src/panels/ExportPanel.tsx:403`), manual UI acceptance is still pending, and the selected incompatible-plot insertion path does not satisfy the same-axes/disabled authoring contract. Status returned to `implementing`.

### 2026-09-25 re-verification after fixes

| Gate | Command | Result |
|---|---|---|
| Focused resolver/migration/export/preview/store tests | `npx vitest run src/lib/migrateProjectToV43.test.ts src/lib/graphMotion.test.ts src/lib/exportReadiness.test.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.test.ts src/store/useSceneStore.graphMotion.test.ts` | pass — `Test Files 6 passed (6); Tests 58 passed (58)` |
| Focused copy/bundle/normalize tests | `npx vitest run src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts` | pass — `Test Files 3 passed (3); Tests 20 passed (20)` |
| Frontend build | `npm run build` | pass — `✓ 300 modules transformed`; Vite large-chunk advisory only |
| Full frontend tests | `npm run test` | pass — `Test Files 69 passed (69); Tests 543 passed (543)` |
| Repository lint | `npm run lint` | fail, baseline/out-of-scope — `✖ 41 problems (35 errors, 6 warnings)` in pre-existing files outside this handoff's touched list; no `ExportPanel.tsx` errors remain |
| Touched-file lint | `npx eslint src/types/scene.ts src/lib/constants.ts src/lib/migrateLoadedItems.ts src/lib/migrateProjectToV43.ts src/lib/migrateProjectToV43.test.ts src/lib/graphMotion.ts src/lib/graphMotion.test.ts src/lib/exportReadiness.ts src/lib/exportReadiness.test.ts src/lib/graphCreatePreview.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.ts src/lib/visualPlaybackPreview.test.ts src/lib/itemDisplayName.ts src/lib/projectFragment.ts src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts src/store/factories.ts src/store/useSceneStore.ts src/store/useSceneStore.graphMotion.test.ts src/hooks/useAddSceneItems.ts src/panels/AddObjectToolbar.tsx src/panels/TargetAnimationEditor.tsx src/panels/GraphDotEditor.tsx src/panels/ExportPanel.tsx src/canvas/layers/GraphNode.tsx src/timeline/TimelineClip.tsx` | pass — command exited clean with no output; no rule-disable waiver used |
| Dev server/manual UI gate | `npm run dev` | server starts, manual pending — Vite reported `ready in 244 ms` at `http://localhost:5173/`; command was stopped by timeout and no browser acceptance was performed |
| Working tree inventory | `git status --short`; `git diff --stat` | inspected — baseline WIP remains; tracked diff stat before this verifier note showed `46 files changed, 1276 insertions(+), 166 deletions(-)` plus untracked files |

- Out-of-scope changes found in the diff (files not in "Touched files"):
  - Baseline/non-task WIP still present and not attributed to this editor stage: `.cursor/agents/architect.md`, `.cursor/agents/orchestrator.md`, `.cursor/rules/agent-workflow.mdc`, `.opencode/agents/architect.md`, `.opencode/agents/orchestrator.md`, `AGENTS.md`, `opencode.json`, `docs/handoffs/2026-09-24-camera-zoom-codegen-resume.md`, `docs/handoffs/2026-09-24-camera-zoom-copilot-resume.md`, `docs/handoffs/2026-09-24-orchestrator-agent.md`, Copilot files under `manim-timeline/src/agent/`, and codegen/camera files under `manim-timeline/src/codegen/`.
  - `docs/handoffs/2026-09-24-move-along-graph-codegen.md` remains untracked and outside this editor stage's touched-file list, although the plan references it as the separate stage-2 handoff.
- Claims in "Implementation notes" that could not be confirmed or remain pending:
  - Manual browser acceptance was not performed. The required manual scenarios at lines 121-123 remain pending for `ui-reviewer`/browser review.
  - `npm run lint` is still red globally because of baseline out-of-scope files; scoped touched-file lint is clean.
- Fix inspection / invariants checked:
  - The two `no-useless-catch` wrappers in `src/panels/ExportPanel.tsx` are gone; full and touched lint confirm no remaining `ExportPanel` lint errors.
  - `resolveGraphFollowSelection` in `src/lib/graphMotion.ts` rejects wrong-axes selected plots and ambiguous/missing pairs. Both `src/hooks/useAddSceneItems.ts` and `src/panels/AddObjectToolbar.tsx` consume that shared resolver; `src/lib/graphMotion.test.ts` has the wrong-axes regression.
  - `GRAPH_FOLLOW_EXPORT_SUPPORTED = false` remains in `src/lib/exportReadiness.ts`; `graphFollowExportBlock` now blocks graph-follow clips and live annotation-only graph dots. `src/store/useSceneStore.ts` exposes the active-scene guard and `src/panels/ExportPanel.tsx` checks it plus idle scenes.
  - Persisted schema invariant remains satisfied: `PROJECT_VERSION` is 43, V43 migration is wired, and migration tests cover graph-dot flags/easing defaults.
  - Copy/load and preview invariants remain covered by the focused tests; no codegen or `src/lib/time.ts` changes were found in the editor-scope diff.

Automated/static verdict: **pass for touched editor scope**. Manual/browser verdict: **pending**. Ready for UI review: **yes**. Ready for stage-2 codegen: **not yet**; pending manual UI acceptance / `ui-reviewer` scenarios (and the global `npm run lint` baseline remains red outside this handoff if the orchestrator requires a repository-wide green lint). Status set to `reviewing`, not `done`.

### 2026-09-25 re-verification after ui-review fixes

| Gate | Command | Result |
|---|---|---|
| Focused resolver/migration/export/preview/store tests | `npx vitest run src/lib/migrateProjectToV43.test.ts src/lib/graphMotion.test.ts src/lib/exportReadiness.test.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.test.ts src/store/useSceneStore.graphMotion.test.ts` | pass — `Test Files 6 passed (6); Tests 59 passed (59)` |
| Focused copy/bundle/normalize tests | `npx vitest run src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts` | pass — `Test Files 3 passed (3); Tests 20 passed (20)` |
| Frontend build | `npm run build` | pass — `✓ 300 modules transformed`; Vite large-chunk advisory only |
| Full frontend tests | `npm run test` | pass — `Test Files 69 passed (69); Tests 544 passed (544)` |
| Repository lint | `npm run lint` | fail, baseline/out-of-scope — `✖ 41 problems (35 errors, 6 warnings)` in the same pre-existing files outside this handoff's touched list; no touched-file errors were reported |
| Touched-file lint | `npx eslint src/types/scene.ts src/lib/constants.ts src/lib/migrateLoadedItems.ts src/lib/migrateProjectToV43.ts src/lib/migrateProjectToV43.test.ts src/lib/graphMotion.ts src/lib/graphMotion.test.ts src/lib/exportReadiness.ts src/lib/exportReadiness.test.ts src/lib/graphCreatePreview.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.ts src/lib/visualPlaybackPreview.test.ts src/lib/itemDisplayName.ts src/lib/projectFragment.ts src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts src/store/factories.ts src/store/useSceneStore.ts src/store/useSceneStore.graphMotion.test.ts src/hooks/useAddSceneItems.ts src/panels/AddObjectToolbar.tsx src/panels/TargetAnimationEditor.tsx src/panels/GraphDotEditor.tsx src/panels/ExportPanel.tsx src/canvas/layers/GraphNode.tsx src/timeline/TimelineClip.tsx` | pass — command exited clean with no output; no rule-disabled lint waiver used |
| Dev server/manual UI gate | `npm run dev` | server starts only — Vite reported `ready in 247 ms` at `http://localhost:5173/`; command was stopped by timeout and this is **not** manual/browser acceptance |
| Working tree inventory | `git status --short`; `git diff --stat` | inspected — baseline WIP remains; tracked diff stat before this verifier note showed `46 files changed, 1288 insertions(+), 170 deletions(-)` plus untracked files |

- Out-of-scope changes found in the diff (files not in "Touched files"):
  - Baseline/non-task WIP still present and not attributed to this editor stage: `.cursor/agents/architect.md`, `.cursor/agents/orchestrator.md`, `.cursor/rules/agent-workflow.mdc`, `.opencode/agents/architect.md`, `.opencode/agents/orchestrator.md`, `AGENTS.md`, `opencode.json`, `docs/handoffs/2026-09-24-camera-zoom-codegen-resume.md`, `docs/handoffs/2026-09-24-camera-zoom-copilot-resume.md`, `docs/handoffs/2026-09-24-orchestrator-agent.md`, Copilot files under `manim-timeline/src/agent/`, and codegen/camera files under `manim-timeline/src/codegen/`.
  - `docs/handoffs/2026-09-24-move-along-graph-codegen.md` remains untracked and outside this editor-stage touched-file list.
- Claims in "Implementation notes" that could not be confirmed or remain pending:
  - Manual browser acceptance remains unperformed. `npm run dev` startup was not counted as acceptance; plan manual scenarios (scrubbing, warnings, save/reopen, export guard clicks) remain for UI re-review/browser review.
  - `npm run lint` remains red globally because of baseline out-of-scope files; scoped touched-file lint is clean.
- Fix inspection / invariants checked:
  - Generic invalid-target warning: `TargetAnimationEditor.tsx` now uses `isGraphFollowTarget` for graph-follow target lists and the final row validity label, so valid graph-dot rows no longer fall through to “Invalid or missing target.”
  - Timing diagnostics/preview guard: `graphMotion.ts` adds `graphFollowMinimumStartTime`/`graphFollowStartTimeError` using canonical `effectiveStart` from `src/lib/time.ts`; `TargetAnimationEditor.tsx` uses that minimum for graph-follow start warnings, and `resolveGraphDotPosition` rejects graph-follow clips that start before the dot appears. Regression test covers eligibility, minimum start, error text, and resolver rejection.
  - Copy feedback: `ExportPanel.tsx` disables Copy while `graphFollowBlock` is active and sets the explanatory `title`, while retaining the handler guard.
  - WIP boundary: `git status --short` shows no `manim-timeline/src/lib/time.ts` change. Codegen and agent files are still present as baseline WIP, but no editor-scope diff requires or newly attributes codegen/agent changes.
  - Persisted schema/export guard/copy-load invariants from prior verification remain satisfied: `PROJECT_VERSION` 43 + V43 migration/tests, `GRAPH_FOLLOW_EXPORT_SUPPORTED = false`, store/ExportPanel guard consumption, and fragment/.mtproj/multiscene tests.

Automated/static verdict: **pass for touched editor scope**. Manual/browser verdict: **pending**. Ready for UI re-review: **yes**. Ready for stage-2 codegen: **not yet** until UI/manual acceptance is complete (and repository-wide lint remains baseline-red outside this handoff if the orchestrator requires it). Status set to `reviewing`, not `done`.

### 2026-09-25 verification of expanded V44 editor stage

| Gate | Command | Result |
|---|---|---|
| Expanded focused editor tests | `npx vitest run src/lib/migrateProjectToV43.test.ts src/lib/migrateProjectToV44.test.ts src/lib/graphMotion.test.ts src/lib/graphAnnotationLayout.test.ts src/lib/axesRasterPreview.test.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.test.ts src/store/useSceneStore.graphMotion.test.ts` | pass — `Test Files 8 passed (8); Tests 76 passed (76)` |
| Copy/load/cache focused tests | `npx vitest run src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts src/lib/axesPreviewRequest.test.ts` | pass — `Test Files 4 passed (4); Tests 24 passed (24)` |
| Server-contract client subset | `npx vitest run src/services/measureClient.test.ts src/lib/axesPreviewRequest.test.ts src/lib/axesRasterPreview.test.ts src/lib/graphMotion.test.ts` | pass — `Test Files 4 passed (4); Tests 22 passed (22)` |
| Frontend build | `npm run build` | pass — `✓ 303 modules transformed`; Vite large-chunk advisory only |
| Full frontend tests | `npm run test` | pass — `Test Files 72 passed (72); Tests 559 passed (559)` |
| Repository lint | `npm run lint` | fail, baseline/out-of-scope — `✖ 41 problems (35 errors, 6 warnings)` in pre-existing files outside this handoff's editor touched list |
| Amended touched-file lint | `npx eslint src/types/scene.ts src/lib/constants.ts src/lib/migrateLoadedItems.ts src/lib/migrateProjectToV43.ts src/lib/migrateProjectToV43.test.ts src/lib/migrateProjectToV44.ts src/lib/migrateProjectToV44.test.ts src/lib/graphMotion.ts src/lib/graphMotion.test.ts src/lib/graphAnnotationLayout.ts src/lib/graphAnnotationLayout.test.ts src/lib/axesRasterPreview.ts src/lib/axesRasterPreview.test.ts src/lib/graphCreatePreview.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.ts src/lib/visualPlaybackPreview.test.ts src/lib/exportReadiness.ts src/lib/exportReadiness.test.ts src/lib/projectFragment.ts src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts src/lib/axesPreviewRequest.ts src/lib/axesPreviewRequest.test.ts src/store/factories.ts src/store/useSceneStore.ts src/store/useSceneStore.graphMotion.test.ts src/hooks/useAddSceneItems.ts src/panels/AddObjectToolbar.tsx src/panels/TargetAnimationEditor.tsx src/panels/GraphDotEditor.tsx src/panels/ExportPanel.tsx src/canvas/layers/GraphNode.tsx src/timeline/TimelineClip.tsx` | pass — command exited clean with no output |
| Server-contract touched lint | `npx eslint src/types/scene.ts src/services/measureClient.ts src/services/axisPreviewHooks.ts src/lib/axesPreviewRequest.ts src/lib/axesPreviewRequest.test.ts src/lib/axesRasterPreview.ts src/lib/axesRasterPreview.test.ts src/lib/graphCreatePreview.ts src/lib/graphCreatePreview.test.ts src/lib/graphMotion.ts src/lib/graphMotion.test.ts src/canvas/layers/GraphNode.tsx` | pass — command exited clean with no output |
| Dev server/manual gate | `npm run dev` | not an app failure, manual pending — Vite could not bind because `Port 5173 is already in use`; existing dev server was not killed, and startup is not browser acceptance |
| Working tree inventory | `git status --short`; `git diff --stat` | inspected — baseline WIP plus server dependency files remain; tracked diff stat before this verifier note showed `53 files changed, 1723 insertions(+), 330 deletions(-)` plus untracked files |

- Out-of-scope changes found in the diff (files not in this editor plan's touched files):
  - Baseline/non-task WIP still present and not attributed to this editor verification: agent config/orchestrator files, Copilot files under `manim-timeline/src/agent/`, codegen/camera files under `manim-timeline/src/codegen/`, `manim-timeline/README.md`, and prior camera handoffs.
  - Server dependency files `measure_server.py`, `test_preview_axes.py`, and `docs/handoffs/2026-09-25-preview-axes-origin-anchors.md` are outside this editor stage but are expected from the separately verified/reviewed server handoff; I did not rerun server gates.
  - `docs/handoffs/2026-09-24-move-along-graph-codegen.md` remains untracked and belongs to the later codegen stage.
- Claims in "Implementation notes" confirmed:
  - V44 persisted shape is present: `PROJECT_VERSION = 44`, V44 migration is wired after V43, and tests cover free attachment/style defaults, idempotence, precision clamp, and V43 row usability.
  - Preview-axes v1 metadata is parsed only when version/anchors/crop/png values are finite; old/missing metadata returns `bounds: null` and a vector-fallback error. The axes preview cache key includes `AXES_PREVIEW_METADATA_VERSION`.
  - Raster/vector transform is shared through `axesRasterCoordinateGeometry`, `axesOverlayPoint`, and `GraphNode.toLocal`. Static check found no double shift: when raster is active, the outer vector group offset is zero and overlays use server origin/basis; when only coordinate metadata exists, vector axes are shifted by `vectorAxesOffset` while overlay points subtract that offset before inheriting the group transform, producing the same server-coordinate positions. Graph areas, plots, curves, fields, streamlines, point sequences, dots, labels and guides route through `toLocal`/`axesOverlayPoint`.
  - Graph-dot attachments resolve from live source expressions. Function-attached dots recompute from `graphPlot.fn.jsExpr`; parametric-attached dots recompute from `graphCurve.curve.jsXExpr/jsYExpr`; source deletion diagnostics are exposed even without a graph-follow clip.
  - Free-dot parametric motion is rejected; attached parametric rows infer the curve and expose/store `targetT` only. Free-dot function rows require an explicit same-axes function source and off-curve starts are rejected.
  - Fragment copy remaps attached function/parametric source references and rejects partial attached-source fragments; `.mtproj`/multiscene tests preserve attachment/style fields.
  - Labels & coordinates fields are independent in the model and helper; defaults use graph/Manim spacing units and coordinate precision is clamped to `[0,6]`; no font-family/bold/italic fields are present.
  - `GRAPH_FOLLOW_EXPORT_SUPPORTED` remains `false`, and the guard blocks graph-follow, non-free attachments, live annotations, and customized fixed-label styles.
- Missing required coverage / static blocker found:
  - The amended plan requires chained holds/backward-seek coverage for **parametric `t` graph-follow**. Current tests cover function chained holds/backward seek in `visualPlaybackPreview.test.ts` and single-clip parametric midpoint/free-parametric rejection in `graphMotion.test.ts`, but I found no explicit regression for chained parametric `targetT` clips with a pause/hold and backward seek. Static code appears generic enough to handle it, but the required regression is absent, so this verification cannot mark the expanded stage ready.
- Manual/user acceptance and reviewer gates:
  - Manual browser retest is still pending and was not attempted. The `npm run dev` port-in-use result is not counted as acceptance or app failure.
  - UI review and manim-reviewer visual-defect/raster-origin review remain pending for this expanded editor integration.

Automated gate verdict: **pass for build/tests/scoped lint; global lint remains baseline-red outside scope**. Static contract verdict: **fail** due the missing required parametric chained-hold/backward-seek regression. Status remains `implementing`. Ready for UI/manim re-review: **not yet** until that regression is added and reverified. Ready for stage-2 codegen: **no**; manual acceptance/reviews and export implementation remain blocked.

### 2026-09-25 focused verification of parametric chained-seek regression fix

| Gate | Command | Result |
|---|---|---|
| Precise regression test | `npx vitest run src/lib/visualPlaybackPreview.test.ts` | pass — `Test Files 1 passed (1); Tests 28 passed (28)` |
| Expanded focused editor tests | `npx vitest run src/lib/migrateProjectToV43.test.ts src/lib/migrateProjectToV44.test.ts src/lib/graphMotion.test.ts src/lib/graphAnnotationLayout.test.ts src/lib/axesRasterPreview.test.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.test.ts src/store/useSceneStore.graphMotion.test.ts` | pass — `Test Files 8 passed (8); Tests 77 passed (77)` |
| Copy/load/export focused tests | `npx vitest run src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts src/lib/exportReadiness.test.ts` | pass — `Test Files 4 passed (4); Tests 22 passed (22)` |
| Frontend build | `npm run build` | pass — `✓ 303 modules transformed`; Vite large-chunk advisory only |
| Full frontend tests | `npm run test` | pass — `Test Files 72 passed (72); Tests 560 passed (560)` |
| Scoped touched-file lint | `npx eslint src/types/scene.ts src/lib/constants.ts src/lib/migrateLoadedItems.ts src/lib/migrateProjectToV43.ts src/lib/migrateProjectToV43.test.ts src/lib/migrateProjectToV44.ts src/lib/migrateProjectToV44.test.ts src/lib/graphMotion.ts src/lib/graphMotion.test.ts src/lib/graphAnnotationLayout.ts src/lib/graphAnnotationLayout.test.ts src/lib/axesRasterPreview.ts src/lib/axesRasterPreview.test.ts src/lib/graphCreatePreview.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.ts src/lib/visualPlaybackPreview.test.ts src/lib/exportReadiness.ts src/lib/exportReadiness.test.ts src/lib/projectFragment.ts src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts src/store/factories.ts src/store/useSceneStore.ts src/store/useSceneStore.graphMotion.test.ts src/hooks/useAddSceneItems.ts src/panels/AddObjectToolbar.tsx src/panels/TargetAnimationEditor.tsx src/panels/GraphDotEditor.tsx src/panels/ExportPanel.tsx src/canvas/layers/GraphNode.tsx src/timeline/TimelineClip.tsx` | pass — command exited clean with no output |
| Working tree inventory | `git status --short`; `git diff --stat` | inspected — baseline WIP plus this handoff remains; tracked diff stat showed `53 files changed, 1759 insertions(+), 330 deletions(-)` plus untracked files |

- Out-of-scope changes found in the diff (files not in this editor plan's touched files):
  - Same pre-existing/baseline WIP remains: agent/orchestrator config, Copilot files, codegen/camera files, README/camera handoffs, `measure_server.py` / `test_preview_axes.py`, server dependency handoff, and the later codegen handoff. I did not edit or verify those here beyond listing status/stat.
- Claims in "Implementation notes" / latest fix confirmed:
  - The precise missing regression now exists in `src/lib/visualPlaybackPreview.test.ts`: it creates one parametric attached dot, one attached curve, two `graphFollow` clips with `targetT` only, a pause between clips, and asserts start boundary, in-flight points, first-end hold, pause hold, second-start boundary, second-end/final hold, and a backward seek after later samples.
  - The test also confirms inferred source boundaries by asserting the rows omit `graphCurveId`, confirms the resolver is pure via cloned `items` equality after sampling, and confirms source edits recompute both coordinates (`jsXExpr: '2*t'`, `jsYExpr: 't*t*t'`) at both an in-flight and a held time.
  - Static coverage is sufficient for the previously recorded blocker; no new concrete missing behavior was found in this bounded recheck.
- Manual/user acceptance and reviewer gates:
  - Manual browser acceptance remains pending and was not attempted. Existing port `5173` in use is not treated as an app failure and was not killed/restarted.
  - Live backend/server dependency was already separately verified/reviewed and was not rerun in this bounded pass.

Verdict: **pass** for automated/static editor verification of the gap fix. Status set to `reviewing` because UI/manim reviews and manual browser acceptance are still pending before docs/codegen unblocking.

### 2026-09-25 focused verification of Labels & coordinates popover fix

| Gate | Command | Result |
|---|---|---|
| Frontend build | `npm run build` | pass — `✓ 303 modules transformed`; Vite large-chunk advisory only |
| Full frontend tests | `npm run test` | pass — `Test Files 72 passed (72); Tests 560 passed (560)` |
| Scoped popover lint | `npx eslint src/panels/GraphDotEditor.tsx` | pass — command exited clean with no output |
| Working tree / scope check | `git status --short`; `git diff --stat`; `git diff -- manim-timeline/src/panels/GraphDotEditor.tsx manim-timeline/src/timeline/TimelineClip.tsx manim-timeline/src/store/useSceneStore.ts` | inspected — latest popover behavior is confined to `GraphDotEditor.tsx`; current tracked stat still includes broader pre-existing editor/server/codegen/Copilot WIP (`53 files changed, 1804 insertions(+), 330 deletions(-)`) |

- Out-of-scope changes found in the diff (files not in this focused popover fix):
  - Existing WIP remains outside this bounded verification: agent/orchestrator config, Copilot files, codegen/camera files, README/camera handoffs, server dependency files (`measure_server.py`, `test_preview_axes.py`, `docs/handoffs/2026-09-25-preview-axes-origin-anchors.md`), and the later graph codegen handoff. I did not edit or reverify those.
  - `src/store/useSceneStore.ts` and `src/timeline/TimelineClip.tsx` still have earlier graph-motion/editor diffs, but the inspected diff shows no popover/focus/outside-click/Tab behavior there; the latest popover fix is in `src/panels/GraphDotEditor.tsx`.
- Popover behavior confirmed statically in `GraphDotEditor.tsx`:
  - Opening `Labels & coordinates…` sets `labelsOpen` and a `requestAnimationFrame` focuses the first input/select/button in the popover scope.
  - Escape is handled on `window` capture, prevents propagation, closes the popover, and restores focus to the trigger through `closeLabels()`; the `FloatingPanel` close button also restores focus.
  - Outside pointer dismiss is implemented by a document `pointerdown` listener; inside panel/trigger events are ignored by DOM containment, native events recorded through `onPointerDownCapture`, and the portal marker escape hatch `data-graph-dot-label-popover-portal`.
  - Tab trapping wraps focus from the last focusable back to the first and Shift+Tab from the first back to the last; listeners/initial focus frame are cleaned up when the popover closes.
- Claims in reviewer notes / manim clarification confirmed from the handoff record:
  - The prior MP4 residual is explicitly superseded by the manim-reviewer clarification and is not treated as evidence of client misalignment.
  - Current client geometry evidence is the fresh endpoint PNG/metadata check: visible axes crossing aligns to metadata within about `0.3–0.6px`; I did not rerun backend/render gates in this bounded frontend pass.
- Claims not confirmed / still pending:
  - There is no supported UI/browser harness in this session, so I did **not** click the popover, test actual browser focus rings, or perform the manual graph workflow. Manual browser acceptance remains pending and is not waived; existing port `5173` in use was not killed or restarted.

Verdict: **pass** for this focused static/frontend verification. Status remains `reviewing`. Ready for a focused UI re-review of the popover, then user manual/browser acceptance; not `done` and not a substitute for the pending manual gate.

## Review notes (manim-reviewer / ui-reviewer — optional)

Findings in severity order, each with file:line and a concrete fix suggestion.

### 2026-09-27 approved alternative plan addendum — canvas/camera coordinate placement regression

User approved extending this editor plan for canvas/camera coordinate handling and asks for a failing regression before a narrow fix. This addendum supersedes the prior diagnosis's tentative hypothesis that GraphNode drag conversion omitted an inverse viewport transform. No production application edits are authorized until the orchestrator checkpoints this plan.

#### Root-cause evidence (read-only source diagnosis)
- **Confirmed common displacement source:** `src/lib/canvasManimCoords.ts:57-67` computes `cameraViewportTransform` as `{ x: canvasWidth/2 - pose.x*canvasWidth/pose.width, y: canvasHeight/2 + pose.y*canvasHeight/(pose.width*FRAME_H/FRAME_W), scale: FRAME_W/pose.width }`. But `SceneCanvas.tsx:952-959` applies that transform to a Group whose children already use canvas coordinates centered at `(canvasWidth/2, canvasHeight/2)` (`manimToCanvas` at `canvasManimCoords.ts:5-15`; `GraphNode.tsx:201-202`). For identity pose `(x=0,y=0,width=FRAME_W)`, the transform is translation `(canvasWidth/2,canvasHeight/2)` with scale `1`, so graph coordinates receive an additional half-canvas-width and half-canvas-height shift. That exactly accounts for a lower-right displacement of about half the visible frame in each direction; it is not an arbitrary screenshot offset. The expected identity transform must be identity `(0,0,1)`. More generally, this helper's input/output coordinate basis is canvas pixels already centered at the canvas midpoint, while current translation is expressed as if the input basis started at pixel `(0,0)`.
- **Draw nesting confirmed; do not inverse-transform parent-local Konva node coordinates:** GraphNode is rendered under SceneCanvas's transformed `<Group>` (SceneCanvas lines 953-959, 1047-1075). Its own `<Group x={posX} y={posY}>` uses coordinates local to that parent. The parent camera transform affects the visual stage position but does not change the child node's local `x()/y()` values. `useDragSnap` uses `e.target.x()/y()` / node `x()/y()` and maps those through GraphNode's centered-base-canvas `canvasToManim` (GraphNode lines 185-188; useDragSnap lines 96-131, 136-165). Therefore adding a camera inverse to `canvasToManim` would double-correct and is explicitly not the planned fix.
- **Drag target/bubbling:** axes Group owns drag handlers (GraphNode lines 533-541); `useDragSnap` consistently reads `e.target`'s position, which for that draggable Group is its local position. The graph's axes/plot/dot are children of this group. The grid is in a separate earlier Layer before the transformed content Layer (SceneCanvas lines 943-958), matching user's confirmation that dragging moves graph only while grid remains fixed. This evidence points away from a pan gesture or accidental grid movement.
- **Insertion defaults do not explain the displacement:** `factories.ts:createAxes` sets `x=0,y=0` (lines 303-320); plot/dot/curve factories likewise initialize item x/y to zero and overlays are axes-linked. `useAddSceneItems.ts` adds/selects those factory items and assigns frameId (lines 108-205), with no half-frame offset. This explains why the entire graph and unrelated canvas content can be shifted together by the outer camera transform while persisted positions remain zero.
- **Regression arithmetic:** with `FRAME_W=14.222...` and any nonzero canvas `(W,H)`, identity pose maps the origin via current transform to `(W/2,H/2)` as the base point, then adds transform translation `(W/2,H/2)`, resulting `(W,H)`—exactly a lower-right half-canvas shift. A graph drag can then compensate in stored axes coordinates, making paused view look centered, while a subsequently corrected/identity playback view returns to the incorrect original visual location. The regression must fail first on the current behavior without changing expected results to screenshot pixel guesses.
- No browser reproduction is claimed. Diagnosis is established by the transform algebra and existing source nesting; the user's reported paused/play difference remains a manual acceptance check after correction.

#### Narrow implementation scope (proposed; await orchestrator checkpoint)
Paths are relative to `manim-timeline/` unless marked repo-relative.

**lib / pure coordinate math**
- `src/lib/canvasManimCoords.ts` — correct `cameraViewportTransform` translation in the existing centered-canvas pixel basis, preserving scale and pose semantics; do not add per-component offsets or special-case graph geometry.
- `src/lib/canvasManimCoords.test.ts` — add failing-first tests for identity pose → identity transform; arbitrary canvas aspect/size and nonzero pose center/zoom round-trip between world and canvas; graph origin and known points through transform; ensure nonzero item frame offsets remain separately applied (not folded into camera transform).

**canvas integration / insertion and drag contract**
- `src/canvas/SceneCanvas.tsx` — only if a focused integration harness demonstrates that the shared helper fix does not propagate consistently to graph content; expected no code change if it simply consumes corrected transform as it currently does. This file is specifically listed as conditional, not license for camera WIP cleanup.
- `src/canvas/layers/GraphNode.tsx` — likely no code change: preserve local `posX/posY` and drag conversion; only edit if regression proves a separate position bug beyond the parent camera transform. Do not inverse-transform parent-local `x/y`.
- `src/hooks/useAddSceneItems.ts` and `src/store/factories.ts` — likely no change; add tests only if actual insertion-path probe contradicts current zero-position evidence. Keep this conditional to avoid unrelated graph WIP edits.
- If pure transform unit tests do not adequately prove parent-local drag persistence, add a narrowly scoped existing-test-supported integration test at `src/canvas/SceneCanvas.cameraTransform.test.ts` (new) or extend the existing canvas coordinate test location discovered by implementer. It must exercise graph node local coordinates→stored axes position→re-render under play, not mock away the parent Group transform.

#### Required red/green tests and acceptance
- First run the new focused transform regression against unchanged production code and record the expected failure: identity pose is currently translated by `(W/2,H/2)` instead of `(0,0)` (and resulting origin position is `(W,H)` instead of `(W/2,H/2)`). Only after recording that red result may production code be changed.
- Tests must cover: (1) insertion factory/authoring callback creates axes at scene `(0,0)`; (2) GraphNode's local draw position equals base canvas position plus its local x/y and parent camera transform is applied exactly once; (3) dragging the local graph group and passing its local coordinates through `canvasToManim` stores the intended scene coordinate (including nonzero `frameOffset`); (4) paused and playback/follow render the same world position at identity camera pose; (5) nonidentity camera pan+zoom round-trips exactly once; (6) grid remains outside transformed content; and (7) scene frame origin offsets remain accounted for independently. No half-width/height manual offsets or double inverse.
- After fix, rerun focused tests plus frontend build/full tests/touched ESLint per verify-frontend. Manual user acceptance: create axes/plot/dot, verify initial graph crossing centered as expected, drag axis/curve with background grid stationary, press Play, verify no jump. Also verify Follow and Free views at nonidentity zoom/pan and a nonzero frame origin.

#### Explicit exclusions and workflow checkpoint
- Do not edit `src/codegen`, `src/lib/time.ts`, persisted `src/types/scene.ts`, migration chain, `measure_server.py`, `src/agent`, README, or camera/codegen WIP as part of this fix. No schema migration applies because the confirmed plan changes only coordinate transform math.
- Preserve all pre-existing WIP. No server, codegen, Copilot, README, configuration, or unrelated graph-feature cleanup.
- Current phase is **plan checkpoint**: no app source/test changes have been made for this new diagnosis. Orchestrator should confirm this addendum/scope, then resume implementation. Existing handoff remains `status: implementing`, `owner_role: editor-dev`, `next_tool: any`.

### 2026-09-27 implementation notes — camera viewport placement

- `manim-timeline/src/lib/canvasManimCoords.test.ts`: added regressions for zero-position axes/plot/dot factory insertion; identity camera transform and centered origin; camera center projection and expected point displacement at zoom/pan using an independently specified center-screen expectation; and parent-local graph-position → store coordinates → playback world-position round-trip including nonzero frame offset. Tests deliberately do not rely only on `worldToCanvasPoint`/`canvasToWorldPoint` cancelling each other.
- `manim-timeline/src/lib/canvasManimCoords.ts`: corrected camera viewport translation for the existing centered canvas-pixel basis. Identity pose is now `{x:0,y:0,scale:1}`; arbitrary camera center maps to the physical canvas center and zoom displacement is scaled around that point. No graph drag conversion/inverse was added; the Konva child position remains parent-local and graph drag logic is unchanged.
- Red-first evidence, before the production patch: `npx vitest run src/lib/canvasManimCoords.test.ts` failed 3 new cases. Identity camera returned transform `{x:480,y:270,scale:1}` instead of `{x:0,y:0,scale:1}` at a 960×540 canvas; the panned/zoomed camera center projected to `(1800,1012.5)` instead of `(600,337.5)` at 1200×675; and playback under identity camera was displaced by another half canvas. This confirms the lower-right half-canvas placement algebraically. After the source fix, the targeted suite passed: **1 file, 12 tests passed**.
- Verification from `manim-timeline/`: `npm run build` **passed** (`303 modules transformed`; existing Vite large-chunk advisory only); `npm run test` **passed** (`72 files, 564 tests`); `npx eslint src/lib/canvasManimCoords.ts src/lib/canvasManimCoords.test.ts` **passed** (no output). `npm run lint` was run and remains **failed due to existing repository-wide errors** (`41 problems: 35 errors, 6 warnings`) in unrelated files including `ShapeNode.tsx`, `FloatingPanel.tsx`, `NumberInput.tsx`, migration/time files and others; the changed files were independently clean under ESLint.
- Actual touched files for this fix: `manim-timeline/src/lib/canvasManimCoords.ts`, `manim-timeline/src/lib/canvasManimCoords.test.ts`, and this handoff. Conditional SceneCanvas/GraphNode/factory integration changes were not needed. No codegen, time, schema, server, Copilot, README or other WIP files were edited.
- Scope caveat: the background grid/reference layers are outside the transformed content Group, so at nonidentity Free/Follow zoom they may not visually track the camera-framed content. This patch corrects the content camera transform only; no broad grid/camera redesign was attempted. The identity-pose half-canvas displacement causing the reported lower-right placement is covered by tests, as is same-world-position preservation through parent-local drag/store/playback math. Browser/manual acceptance was not available and is still pending; no visual/browser reproduction is claimed.
- Ready for independent verifier. Handoff status: `verifying`, owner `editor-dev`, next tool `any`.
- Verifier dispatch attempted via `@verifier` for this handoff, but the task runner refused it with `Subagent depth limit reached (1). Increase "subagent_depth" to allow nested subagents.` No independent verifier verdict is claimed; handoff remains `verifying` for a later verifier invocation when the runner permits it.

### 2026-09-27 user-failed-acceptance diagnosis (editor-dev)

- User acceptance now confirms the raster/vector graph geometry aligns internally, but fails for object placement/drag persistence: axes/plot/dot are initially lower-right; dragging the axes/curve centers the graph while the background grid remains fixed; Play returns the graph to its earlier lower-right placement. This is not evidence of deliberate background panning. Screenshot evidence is the Free view banner, frame at `(0,0)`, canvas background crossing near `(1264,443)`, paused graph crossing near `(1260,445)`, and playback graph crossing near `(1837,767)`. The reported playback displacement is approximately half a visible-frame width and height. The scene has axes at 0, plot at 2.3, dot at 3.6, graphFollow at 4.8, with no camera clips shown.
- Source evidence narrows the most likely fault to graph drag coordinate conversion under the viewport transform, rather than graph coordinate resolution: `GraphNode.tsx` makes the complete axes/plot/point Group draggable (lines 535-541), and its `canvasToManim` (lines 185-188) converts canvas pixels using canvas dimensions and `frameOffset` only. `SceneCanvas.tsx` separately computes `followTransform = cameraViewportTransform(effectiveCameraPose, ...)` (lines 238-250), and Free view uses the transient `freeOffset/freeWidth` (lines 202-205, 242-246). `useDragSnap.ts` feeds the Konva node's `x/y` directly through this canvasToManim callback to persist `setItemPosition` (lines 96-131 and 136-165). That conversion does not visibly invert the active camera/free-view viewport transform. Thus a drag performed in a transformed Free view can store the pointer's viewport-space location as authored scene coordinates; playback then renders that incorrect persisted position under the authored camera transform, explaining why it snaps back. This is a code-path diagnosis, not a browser reproduction; exact numeric displacement cannot be proven from the screenshot alone.
- Important alternative/limitation: the reported near half-frame displacement also resembles the scale/center difference between a fit Free view and the authored camera pose. Because the browser session, actual `freeWidth/freeOffset`, effective camera pose, and persisted axes `x/y` before/after drag were not available here, the diagnosis is strong but not yet conclusive. There is no evidence supporting “grid pan” as intended behavior; user explicitly confirms grid stays fixed while graph alone moves.
- Initial insertion factories are not the apparent cause of the post-drag reset: `factories.ts:createAxes` initializes axes `x=0,y=0`; graph overlays are attached by `axesId`; their own layout is derived from the axes and graph-space coordinates. This alone does not establish that insert-time UI has no additional positioning policy, but it cannot explain a drag-only playback reversion.
- Scope blocker: this is a camera/viewport-to-pointer conversion bug in graph dragging, adjacent to the existing camera/Free-view WIP and not explicitly included in the existing graph-feature touched-file plan. Do not edit `GraphNode.tsx`, `useDragSnap.ts`, `SceneCanvas.tsx`, camera helpers, or codegen under this diagnosis. Architect ownership/planning is required before changing the existing touched-file scope; no architect agent is exposed in current tools. Per user instruction, status is `blocked`; no alternative plan was authored.
- Minimal candidate scope for a subsequent approved fix: `src/lib/camera.ts` (or existing shared viewport math helper) for pure inverse viewport-to-world conversion, `src/lib/camera.test.ts` (new/extended) for round-trip mapping at Free view zoom/offset and identity authored camera, `src/canvas/layers/GraphNode.tsx` and possibly `src/canvas/SceneCanvas.tsx` to pass/use the inverse transform for axis drag, plus a focused drag-coordinate regression test. Verify drag in Free view persists the graph's scene-space location, leaves background fixed, and Play does not jump; also cover Follow/authored camera and nonzero frame center. This is a proposal only, not an architect plan.
- No application code, server files, or tests were changed; no browser tools were available and no browser reproduction is claimed. No commands beyond read-only `git status` were run. Extensive pre-existing WIP was preserved. To resume: request architect/scope approval (and, if desired, a minimal project plus exact viewport/camera values) before implementation.

### 2026-09-25 ui-reviewer static review

Findings:

1. **High** — `manim-timeline/src/panels/TargetAnimationEditor.tsx:708`: valid `graphFollow` graph-dot rows still show the generic “Invalid or missing target.” footer because the final row validity check calls `canBeTargetAnimationTarget(target, item.mode)`, while the shared time helper does not treat `graphFollow` as eligible for `graphDot`. This makes a valid row look invalid even when the graph-dot target is present. **Suggestion:** special-case `item.mode === 'graphFollow' && target.kind === 'graphDot'` in this footer check, or centralize graph-follow target eligibility in a shared helper consumed by both the picker and row footer.
2. **Medium** — `manim-timeline/src/panels/TargetAnimationEditor.tsx:89` / `manim-timeline/src/lib/time.ts:341`: the existing minimum-start warning path ignores `graphFollow` rows because `minTargetAnimationStartTimeForClip` delegates to `canBeTargetAnimationTarget`, which returns false for `graphFollow`. Users can edit a graph-follow clip before the dot's effective start without the normal start-time warning. **Suggestion:** add graph-follow-aware min-start validation in the editor/store diagnostics, or safely extend a shared eligibility helper so graph dots participate in this warning without changing generic move/path semantics.
3. **Low** — `manim-timeline/src/panels/ExportPanel.tsx:515`: the Copy button remains enabled while `graphFollowBlock` is active, but `handleCopy` silently returns, giving no per-control feedback beyond the general amber alert. **Suggestion:** disable the Copy button with a title/status matching the render guard, or set a short blocked-export message when Copy is clicked.

Checked and found fine in the static diff:
- Reuse/layering: graph-follow motion, interval/off-curve validation, guide boundary logic, and selection pairing live in `src/lib/graphMotion.ts`; UI/canvas/timeline consume those helpers rather than reimplementing the math. Numeric graph-follow controls use `NumberInput`; existing color/direction primitives remain in use where applicable.
- Authoring consistency: `AddObjectToolbar` and `useAddSceneItems` both consume `resolveGraphFollowSelection`, including the same-axes selected-plot guard; item display naming includes “Move along graph”.
- Canvas/timeline preview: graph dots render from the resolved graph-follow point, fixed labels stay fixed-label data (not converted to coordinate text), coordinate annotations/guides follow the resolved point, and guides fall back to nearest visible boundary when zero is outside the axes range.
- Undo/export: graph-dot annotation toggles and graph-follow row edits use ordinary store updates, so they should be covered by existing undo history; the named temporary export guard `GRAPH_FOLLOW_EXPORT_SUPPORTED = false` is consumed by `ExportPanel` and the store helper.

Manual/browser limitation: no browser-driving tool was available in this review session, so I did **not** click through the UI, scrub the timeline, save/reopen, or capture screenshots. The manual cases from the plan remain pending: chained graph-follow clips with a pause, forward/backward scrubbing, fixed label/coordinate/guides following, off-curve and discontinuity blocking, overlap warnings, zero-outside-range guide endpoints, export guard behavior, and JSON/.mtproj save/reopen.

### 2026-09-25 ui-reviewer focused re-review

Focused scope only: rechecked the three prior UI findings after verifier reported build / 544 tests / touched-file lint passing. I did not perform a broad re-review.

Findings: none remaining in this focused static pass.

Resolved checks:
- `manim-timeline/src/panels/TargetAnimationEditor.tsx:72` and `:714`: graph-follow target lists and the final row footer now use shared `isGraphFollowTarget`, so a valid graph-dot row no longer falls through to the generic “Invalid or missing target.” text.
- `manim-timeline/src/lib/graphMotion.ts:16` and `:67`: `graphFollowMinimumStartTime` / `graphFollowStartTimeError` use canonical `effectiveStart`, and `resolveGraphDotPosition` returns that start-time error before previewing an invalid early graph-follow clip. `TargetAnimationEditor.tsx:93` and `:736` consume the graph-follow minimum for the editor warning.
- `manim-timeline/src/panels/ExportPanel.tsx:515`: Copy is disabled while `graphFollowBlock` is active and exposes the block reason via `title`; the handler guard remains as a safety net.

Manual/browser limitation: browser tooling is still unavailable in this session. This is a static-focused pass only, not full UI acceptance. The manual scenarios from the plan remain pending for an actual browser session.

### 2026-09-25 ui-reviewer expanded editor static review

Focused scope only: reviewed the new free/function/parametric graph-dot attachment controls, source-inferred graph-follow row UI, labels/coordinates popover, shared resolver/layout usage, and export/copy guard after verifier reported build / 560 tests / touched-file lint passing. I did not duplicate the axes-transform review owned by manim-reviewer and did not perform broad exploration.

Findings:

1. **Medium** — `manim-timeline/src/panels/GraphDotEditor.tsx:37` and `:151`: the Labels & coordinates popover only adds an Escape key listener, and opening `<FloatingPanel>` does not move focus into the panel or close on outside click. This misses the requested popover interaction/focus behavior, even though the close button works. **Suggestion:** add focus management for this popover (focus the panel title/first control on open and restore focus to the trigger on close) and an outside-pointer handler that closes when the click target is outside the panel, while preserving Escape and not closing for clicks inside color/direction/number controls.

Checked and found fine in this static pass:
- Attachment/source UI: `GraphDotEditor.tsx` exposes free/function/parametric attachment controls with `NumberInput`, `ColorPicker`, `DirectionPicker`, and `FloatingPanel`; it handles missing or blank source ids through resolver diagnostics rather than obvious render-time crashes.
- Resolver/source edits: `graphMotion.ts` resolves free, function, and parametric attachments from live source expressions, reports missing/different-axes sources, rejects free-dot parametric graph-follow, and uses attached source inference for function `targetX` and parametric `targetT` rows.
- Target-animation UI: `TargetAnimationEditor.tsx` shows a source dropdown only for free dots; attached function dots show inferred-source text plus target x, and attached parametric dots show inferred-source text plus target t, with no stale function dropdown for parametric dots.
- Labels/coordinates model: fixed label and coordinate annotation fields are independent for size/color/direction/spacing, coordinate precision is coordinate-only, RTL/LTR directions are separated in `graphAnnotationLayout.ts`, and no font-family/bold/italic/drag controls were added.
- Undo/layering/export: controls dispatch ordinary store updates; graph motion/layout math stays in `src/lib/`; export remains guarded for preview-only graph-follow/attachment/annotation semantics.

Static verdict: **one medium UI interaction finding remains**. Manual/browser verdict: **pending** — browser/app tooling was unavailable, so I did not click the popover, test outside-click/focus behavior, scrub, save/reopen, or capture screenshots. Full acceptance still requires the manual cases from the plan.

### 2026-09-25 manim-reviewer client raster geometry review

Findings: no blocking client-geometry findings in this bounded visual-defect review. Client raster/overlay math is ready for browser/manual acceptance, but manual browser acceptance remains pending and this does **not** review graph-follow Manim export or codegen.

- Static client contract: pass. `manim-timeline/src/services/measureClient.ts:268` checks `/api/preview_axes` `metadata_version === 1` and finite origin/unit/rect anchors before returning bounds; `manim-timeline/src/services/measureClient.ts:306` reports vector fallback when v1 anchor metadata is missing/invalid. `manim-timeline/src/lib/axesPreviewRequest.ts:3` / `:87` include `AXES_PREVIEW_METADATA_VERSION = 1` in the visual/cache key, so old preview caches are not silently reused as v1. `manim-timeline/src/services/axisPreviewHooks.ts:42` clears raster URL/bounds on preview errors instead of drawing old metadata.
- Static transform inspection: pass. `manim-timeline/src/lib/axesRasterPreview.ts:74` converts server crop bounds to PNG image geometry and server origin/basis to graph transforms; `:85`-`:91` apply Manim-to-canvas signs once (`x = sceneX * px`, `y = -sceneY * px`). `axesOverlayPoint` at `:49`-`:63` avoids double translation: raster-active overlays use server coordinates directly, while metadata-only vector fallback subtracts the vector offset before the parent `<Group>` adds it. `manim-timeline/src/canvas/layers/GraphNode.tsx:304`-`:338` wires that offset/overlay helper into `toLocal`, and plots, curves, areas, fields, streamlines, point sequences, graph dots, labels and guides route through `toLocal`/`axesOverlayPoint` (`GraphNode.tsx:411`, `:469`, `:771`, `:817`, `:936`, `:1013`, `:1045`).
- Fresh endpoint + client-pixel evidence from server `127.0.0.1:8766` PID 10000, using `[-5,5,1] × [-3,3,1]`, scale 1, labels `x/y`, numbers/tips: response was `ok=True`, `metadata_version=1`, PNG `1428x850`. Applying the client formulas for an 854x480 canvas gives image local rect `[-317.581,-188.889,635.162,377.778]`; graph origin local `(11.088,0.098)` equals the scaled endpoint PNG origin exactly (`delta [0.0,-0.0]`), and `(1,sin(1))` local `(71.135,-50.390)` also equals the scaled endpoint PNG coordinate exactly (`delta [0.0,-0.0]`). The crop center is local `(0,0)`, so the true origin is intentionally **not** inferred from crop center (`+11.088px,+0.098px` at this canvas size).
- Raster/vector agreement evidence: with the same metadata, vector fallback offset is `(11.088,0.098)` and the vector `sin(1)` point after inherited group translation is `(71.135,-50.390)`, exactly matching raster overlay coordinates. With missing/old metadata, `axesRasterCoordinateGeometry` returns null (`axesRasterPreview.ts:76`-`:80`), so the client falls back to ideal vector origin `(0,0)` and does not draw stale raster anchors.
- Prior approved server frame artifact comparison: the client-predicted full-frame pixels are origin `(438.09,240.10)` and `(1,sin(1))` `(498.14,189.61)`, matching the prior low-quality Manim frame within the same thresholded-dot centroid evidence recorded in the server handoff (yellow centroid `(433.28,239.61)`, 4.83px; red centroid `(493.65,189.02)`, 4.53px). This ties the client transform to the actual endpoint PNG anchors and rendered frame, not only mocked unit tests.
- Pending manual/browser acceptance (not a code finding): browser tooling is unavailable here, so the handoff manual scenarios remain open (`docs/handoffs/2026-09-24-move-along-graph-editor.md:394`-`:400`, and expanded server-backed retest at `:473`-`:474`). Concrete next step: in a real browser, point Measure server URL at `http://127.0.0.1:8766`, reproduce the sin setup around the reported playhead, toggle completed raster vs vector fallback, and confirm axes crossing/curve/dot/labels/guides align visually. Do not unblock docs/codegen solely from this static+pixel review.

### 2026-09-25 manim-reviewer clarification on prior 4-5px render residual

Bounded follow-up: I rechecked the residual called out above instead of treating it as an arbitrary tolerance. The prior MP4-frame comparison should **not** be used as client-alignment evidence, because the old direct-render fixture is measurably not identical to the fresh `/api/preview_axes` endpoint geometry. The client geometry verdict still passes against the actual endpoint PNG/metadata, and the manual browser check remains pending.

- Direct endpoint PNG, non-circular axes-intersection evidence: for fresh `POST http://127.0.0.1:8766/api/preview_axes` with `[-5,5,1] × [-3,3,1]`, scale 1, labels `x/y`, numbers/tips, metadata predicts the cropped-PNG origin at `(738.929,425.221)` px. Inspecting actual white axes pixels in that PNG gives the vertical-axis strip centroid `x=738.631` and horizontal-axis strip centroid `y=424.654` (deltas `-0.299px`, `-0.568px`); local line maxima are within the expected one-pixel stroke/antialias band (`vertical_col=738`, `horizontal_row=424`). This verifies the endpoint metadata lands on the visible axes crossing directly, not merely by comparing formulas to the same metadata.
- Prior MP4 residual explained as a fixture/endpoint mismatch: the old low-quality frame's grey/white y-axis is at columns `433/434`, and its colored dot centroids sit on that rendered fixture geometry. Reconstructing the same direct CLI fixture from disk gives `ax.c2p(0,0) = (0.11744076, -0.00164070)`, which maps to about `x=434px` at 854×480. The fresh running endpoint metadata reports `origin_x = 0.18466242`, which maps to `x=438.09px`. The common ~4-5px x residual is therefore the measured difference between the prior direct-render fixture geometry and the fresh endpoint geometry, not an overlay transform tolerance.
- Client implication: the browser client consumes the endpoint's raster PNG and the endpoint's origin/basis together (`measureClient.ts:268`, `axesRasterPreview.ts:74`), so this fixture mismatch does not indicate a client double-translation/scaling bug. It does mean my earlier note should not rely on the prior MP4 dot-centroid comparison as proof. The stronger evidence is the endpoint PNG axes-pixel inspection plus the client transform mapping that same endpoint metadata into canvas coordinates.
- Remaining uncertainty/action: I did not restart/kill the 8766 server or user 8765, and I did not investigate why the independently rendered disk fixture and the already-running endpoint process differ. If a future reviewer needs an MP4 comparison, generate it from a fixture whose printed `ax.c2p(0,0)` matches the live endpoint metadata (or restart/use a known-matching server process under a separate approved step). Manual browser acceptance is still required before completion/codegen/docs.

### 2026-09-25 ui-reviewer focused popover re-review

Focused scope only: rechecked the single medium finding from the expanded UI review after verifier reported build / 560 tests / `GraphDotEditor` lint/static pass. I did not broaden the review.

Findings: none remaining in this focused static pass.

Resolved checks:
- `manim-timeline/src/panels/GraphDotEditor.tsx:40`-`:43` centralizes close behavior and restores focus to the trigger for Escape/close-button paths; `:46`-`:49` moves focus into the popover on open.
- `manim-timeline/src/panels/GraphDotEditor.tsx:50`-`:69` handles Escape on capture and traps Tab/Shift+Tab within the popover focusable controls.
- `manim-timeline/src/panels/GraphDotEditor.tsx:70`-`:79` dismisses on outside pointerdown while preserving inside clicks via DOM containment, recorded internal native events, and the `data-graph-dot-label-popover-portal` marker escape hatch. Current `ColorPicker` is inline (no React portal), so its label/text/color inputs are covered by DOM containment; if a future picker portals swatches, it must use the existing marker/internal-event path.

Static verdict: the popover interaction finding is **resolved**. Manual/browser verdict remains **pending**: no browser-driving tool was available, so I did not physically tab through controls, click outside, open native color UI, or verify focus rings in an actual browser.

### 2026-09-27 ui-reviewer focused camera-coordinate static review

Focused scope: reviewed the narrow `cameraViewportTransform` fix and its canvas consumers after verifier reported the focused regression, build, full tests, and scoped lint passing. I did not re-review unrelated graph-follow/codegen/Copilot WIP.

Findings: none in this focused static pass.

Checked and found fine:
- `manim-timeline/src/lib/canvasManimCoords.ts:57`-`:70` now computes the camera transform in the same centered canvas-pixel basis used by `manimToCanvas`; identity pose is identity, and nonidentity pan/zoom maps the camera center to the canvas center without the prior extra half-canvas translation.
- `manim-timeline/src/canvas/SceneCanvas.tsx:242`-`:250` and `:953`-`:959` still apply that transform exactly once to the content `<Group>`. The reference grid remains in its separate earlier layer (`:943`-`:950`), so this fix does not silently move the grid or change Free/Follow UI semantics.
- `manim-timeline/src/canvas/layers/GraphNode.tsx:185`-`:202` and `manim-timeline/src/canvas/hooks/useDragSnap.ts:55`, `:98`, `:143` still use Konva child `x()/y()` as parent-local coordinates. Under the transformed parent, Konva already converts pointer movement back to parent-local node coordinates, so adding a second `canvasToWorldPoint`/camera inverse in `GraphNode` or `useDragSnap` would double-correct the drag.
- Undo/interaction semantics were not changed by this narrow fix: `useDragSnap.ts:82`-`:165` still pauses temporal history during drag and commits one final spatial transaction; the transform helper change does not add transient UI state to undo.
- Preview/agent layering was not changed by the fix: `SceneCanvas.tsx:223`-`:240` still derives preview-merged items/camera pose before the one content transform, and `PreviewWrap` remains the existing listener gate for agent-preview delete/dim states.

Static verdict: **pass** for the narrow UI/canvas coordinate review. Browser/manual verdict remains **pending**. Acceptance should be a focused browser check only: with frame `(0,0)` and no camera clip, add axes/plot/dot and confirm initial placement is centered rather than lower-right; drag the graph while the background grid stays fixed; press Play and confirm the graph does not jump back; repeat once after Free-view pan/zoom and after returning to Follow camera.

## Docs delta (docs-keeper)

- README sections touched, `*Last updated:*` trailer extended: yes/no
- ARCHITECTURE.md touched: yes/no
- idea.md item closed or updated: which

### 2026-09-27 editor-dev reconciliation — user acceptance and codegen API handoff

- User reported after the requested refresh/fresh-insertion/direct-graph-drag/Play retest: **“Works great, I think we can continue.”** This records user acceptance of the editor revision and the camera placement correction for that reported workflow. It does not claim automated browser tests, pixel measurements, or any additional manual scenarios.
- The latest independent narrow-fix verifier record above passed focused tests (12), frontend build, full frontend tests (72 files / 564 tests), and changed-file lint. The repository-wide lint failure is recorded as unrelated baseline errors. The latest focused `ui-reviewer` static review found no findings; the `manim-reviewer` geometry review passed. Earlier editor-stage verification, focused UI re-review, server contract verification, `/api/preview_axes` endpoint/render review, and client raster/vector geometry evidence are recorded in this handoff and `2026-09-25-preview-axes-origin-anchors.md`. The user acceptance now closes the remaining reported editor-placement manual gate. No automated browser test is claimed.
- Settled V44 codegen-facing model from `src/types/scene.ts`:
  - `TargetAnimationMode` includes `'graphFollow'`. A `TargetAnimationTargetSpec` may carry `targetId`, `targetX` (function/free-dot x destination), `targetT` (parametric-attached t destination), optional `graphPlotId` for free-dot function source / legacy V43 compatibility, optional legacy `graphCurveId`, and `easing?: 'linear' | 'smooth'` (missing legacy value means smooth). Attached function dots infer their `graphPlotId` from the attachment; attached parametric dots infer `graphCurveId` and their start `t` from the attachment. Duration/start remain the existing `TargetAnimationItem` fields.
  - `GraphDotAttachment = {kind:'free'} | {kind:'function'; graphPlotId: ItemId; x:number} | {kind:'parametric'; graphCurveId: ItemId; t:number}`. V44 migration backfills `{kind:'free'}` and style defaults. Free dots retain `dx/dy`; function attachments resolve `(x,f(x))`; parametric attachments resolve `(x(t),y(t))`.
  - Persisted `GraphDot` fields: `showCoordinates?`, `showProjectionGuides?`, `attachment?`, `labelFontSize?` (default 18), `labelColor?` (`#ffffff`), `labelSpacing?` (0.15 Manim units), `coordinateFontSize?` (18), `coordinateColor?` (`#e2e8f0`), `coordinateDir?` (unset = opposite fixed-label direction), `coordinateSpacing?` (0.15 Manim units), and `coordinatePrecision?` (default 2, clamped 0–6). Existing `dx`, `dy`, `label`, and `labelDir` remain. Labels are independently styled; there is no font-family/bold/italic/canvas-label-drag API.
- Public `src/lib/graphMotion.ts` helpers for codegen to consume/mirror: constants `GRAPH_MOTION_START_TOLERANCE = 1e-4`, `GRAPH_MOTION_INTERVAL_SAMPLES = 128`, `GRAPH_MOTION_DISCONTINUITY_JUMP = 10`; types `GraphMotionResult`, `ProjectionGuides`, `GraphFollowSelection`; `isGraphFollowTarget`, `graphFollowMinimumStartTime`, `graphFollowStartTimeError`, `resolveGraphFollowSelection`, `evaluateGraphY`, `resolveAttachedGraphDot`, `graphFollowClipsForDot`, `resolveGraphDotPosition`, `graphMotionConflicts`, `graphProjectionGuides`. `resolveGraphDotPosition({dot,items,time})` yields point/error/warnings and current parameter/kind. Motion resolves timeline-sorted x/t interpolation with smoothstep unless `easing:'linear'`, destination holds/chaining, same-dot position-writer collision checks, plot/curve/axes reference validation, off-curve free-function start tolerance, and best-effort 128-sample nonfinite/domain/discontinuity rejection. Detected invalid motion returns an error/current point and must not be emitted. Numerical sampling is not a proof that every discontinuity is detected. `graphMotionConflicts` rejects overlapping same-dot `graphFollow`/`move`/`path` position writers; no snap, jump, blend, queue, or implicit override.
- Public `src/lib/graphAnnotationLayout.ts` helper: `buildGraphAnnotationLayout({dot, point, coordinate, radiusPx, pxPerUnit})`, returning `GraphAnnotationLayout {fixedLabel, coordinates, coordinateText}` with each annotation as `GraphTextAnnotationSpec {text,x,y,width,fontSize,fill,align,direction}`. It applies V44 defaults, RTL fixed labels, LTR coordinate values, direction/spacing/style, precision, and returns no coordinate annotation unless `showCoordinates === true`. `graphProjectionGuides(point, axes)` supplies graph-space guide endpoints; zero is used when visible, otherwise the nearest displayed range boundary.
- Guard still intentionally active pending codegen: `GRAPH_FOLLOW_EXPORT_SUPPORTED = false`; `graphFollowExportBlock(items)` blocks graph-follow clips, non-free attachments, live coordinate/projection annotations, and customized fixed-label size/color/spacing with the preview-only message. Codegen must remove/flip this only once movement **and** all relevant annotation/style semantics are implemented and tested. Axes preview server origin/basis metadata is only for editor raster alignment, not Manim export geometry. Generated text must remain `HebrewMathLine`; no `Text`, `Tex`, `MathTex`, or per-frame TeX construction.
- Dependency assessment: no known server/editor verification or review gap remains for beginning the separate codegen stage. The server handoff's former `reviewing` status was stale after the recorded 50-test/API/health/render/reviewer checks plus dependent client integration and user acceptance; it is reconciled to `docs`. The editor stage is reconciled to `docs` as accepted, with final README feature documentation deferred until codegen completion. This section does not edit the separate codegen handoff; codegen owner is next.

### 2026-09-27 editor-dev ordered codegen integration — readiness guard enabled

- After codegen's independent 578-test/build/scoped-lint evidence and latest function/attached-parametric chained `-ql` render review (reported successful; video timing within one 15-fps frame), enabled the existing named capability in `src/lib/exportReadiness.ts`: `GRAPH_FOLLOW_EXPORT_SUPPORTED = true`. No emitter implementation or codegen source was changed in this editor-owned support step.
- `src/lib/exportReadiness.test.ts`: changed stage-1 blocking expectations to assert graph-follow clips, function/parametric attachments, static/live annotations, guide-only data, and customized label/coordinate styles no longer produce a preview-only block.
- `src/store/useSceneStore.graphMotion.test.ts`: active store now asserts valid motion/annotation-only readiness is unblocked; invalid graph-follow (target outside source domain) remains actionable via `graphMotionDiagnostics` while export readiness itself does not mistake the capability switch for validation. Existing codegen `targetAnimationCodegen.test.ts` / `projectExporter.test.ts` invalid-export cases continue to cover actionable exporter errors; they passed in this step's focused run.
- Verification from `manim-timeline/`: focused `npx vitest run src/lib/exportReadiness.test.ts src/store/useSceneStore.graphMotion.test.ts src/codegen/targetAnimationCodegen.test.ts src/codegen/projectExporter.test.ts` passed (**4 files / 26 tests**); `npm run build` passed (303 modules; existing large-chunk advisory); `npm run test` passed (**72 files / 579 tests**); scoped `npx eslint src/lib/exportReadiness.ts src/lib/exportReadiness.test.ts src/store/useSceneStore.graphMotion.test.ts` passed clean. No full `npm run lint` was rerun; the previous unrelated repository-wide baseline is already recorded.
- Invalid inputs remain validation failures, not silently valid exports: store diagnostics still report the tested domain error, and the codegen exporter tests still assert actionable throws for off-curve/domain/discontinuity/conflicting positions. The guard is solely a capability/readiness gate, not a replacement for resolver/export validation.
- Files changed for this editor-owned transition: `src/lib/exportReadiness.ts`, `src/lib/exportReadiness.test.ts`, `src/store/useSceneStore.graphMotion.test.ts`, and the editor/codegen handoffs. No `src/codegen`, schema, `src/lib/time.ts`, server, Copilot, README, or unrelated WIP changes.
- Final combined-feature independent verifier is the next step. User acceptance of the editor placement correction is recorded above; codegen render acceptance comes from the codegen handoff. Final feature README/docs remain pending the verifier and docs-keeper stage. Handoff set to `status: verifying`.

### 2026-09-27 editor-dev documentation fallback closure

- User approved using the editor specialist as a documentation-only fallback after docs-keeper could not run because its configured `gpt5.4mini` model is unsupported for the account. This is an editor-dev note, not a docs-keeper section or review claim.
- Updated `manim-timeline/README.md`: Scene items / Graph animations; Target animations; Export timing and synchronization; Project file format (V44); graph-axis preview alignment; and the `Last updated` trailer. The feature description records free/function-x/attached-parametric-t behavior, holds/easing, annotation controls, boundary guides, best-effort validation, cached HebrewMathLine export, supported guard status, timing, schema migration, and the half-frame camera placement correction. Copilot authoring, graph-shape animation, search/optimization and arc-length motion remain explicitly unsupported/deferred.
- No graph-follow-specific backlog item exists in `manim-timeline/idea.md`; no idea item was changed. `src/agent/ARCHITECTURE.md` was not changed because Copilot feature support is deferred and the README states this explicitly. Existing camera proposal README/WIP text was preserved.
- User acceptance of the editor placement workflow, the editor/codegen/server handoff evidence, successful rendered function/parametric codegen review, and the 579-test/build/scoped-lint readiness transition are recorded above. This documentation closure does not claim a browser automation test or expand the reported manual acceptance.
- All three graph-follow handoffs are now `status: done`. Final README feature docs are complete; no application code was changed in this documentation-only stage. No commit/stage/push was performed.

## Verification (verifier) — 2026-09-27 approved-alternative placement fix

| Gate | Command | Result |
|---|---|---|
| Focused camera/canvas regression | `npx vitest run src/lib/canvasManimCoords.test.ts` | pass — `Test Files 1 passed (1); Tests 12 passed (12)` |
| Frontend build | `npm run build` | pass — `✓ 303 modules transformed`; Vite large-chunk advisory only |
| Full frontend tests | `npm run test` | pass — `Test Files 72 passed (72); Tests 564 passed (564)` |
| Scoped touched-file lint | `npx eslint src/lib/canvasManimCoords.ts src/lib/canvasManimCoords.test.ts` | pass — command exited clean with no output |
| Repository lint baseline check | `npm run lint` | fail, baseline/out-of-scope — `✖ 41 problems (35 errors, 6 warnings)` in files outside this narrow fix, matching the reported baseline count |
| Working tree inventory | `git status --short`; `git diff --stat` | inspected — current tracked stat is `55 files changed, 1892 insertions(+), 332 deletions(-)` plus untracked files; narrow fix diff is confined to `canvasManimCoords.ts`, `canvasManimCoords.test.ts`, and this handoff |

- Out-of-scope changes found in the diff (files not in this approved-alternative placement fix's touched files): `.cursor/agents/architect.md`, `.cursor/agents/orchestrator.md`, `.cursor/rules/agent-workflow.mdc`, `.opencode/agents/architect.md`, `.opencode/agents/orchestrator.md`, `AGENTS.md`, `opencode.json`, `docs/handoffs/2026-09-24-camera-zoom-codegen-resume.md`, `docs/handoffs/2026-09-24-camera-zoom-copilot-resume.md`, `docs/handoffs/2026-09-24-move-along-graph-codegen.md`, `docs/handoffs/2026-09-24-orchestrator-agent.md`, `docs/handoffs/2026-09-25-preview-axes-origin-anchors.md`, `manim-timeline/README.md`, `manim-timeline/src/agent/ARCHITECTURE.md`, `manim-timeline/src/agent/AgentPanel.tsx`, `manim-timeline/src/agent/cameraProposalSummary.test.ts`, `manim-timeline/src/agent/cameraProposalSummary.ts`, `manim-timeline/src/agent/cameraRequests.test.ts`, `manim-timeline/src/agent/cameraRequests.ts`, `manim-timeline/src/agent/commit.test.ts`, `manim-timeline/src/agent/previewSelectors.test.ts`, `manim-timeline/src/agent/providers/gemini.ts`, `manim-timeline/src/agent/providers/schema.test.ts`, `manim-timeline/src/agent/systemPrompt.ts`, `manim-timeline/src/agent/types.ts`, `manim-timeline/src/agent/useAgentStore.test.ts`, `manim-timeline/src/agent/useAgentStore.ts`, `manim-timeline/src/agent/validate.test.ts`, `manim-timeline/src/agent/validate.ts`, `manim-timeline/src/canvas/layers/GraphNode.tsx`, `manim-timeline/src/codegen/cameraCodegen.test.ts`, `manim-timeline/src/codegen/cameraCodegen.ts`, `manim-timeline/src/codegen/groupPlaybackSpan.ts`, `manim-timeline/src/codegen/leafConcurrentCodegen.ts`, `manim-timeline/src/codegen/manimExporter.overlap.test.ts`, `manim-timeline/src/codegen/manimExporter.ts`, `manim-timeline/src/codegen/projectExporter.test.ts`, `manim-timeline/src/codegen/targetAnimationCodegen.test.ts`, `manim-timeline/src/codegen/targetAnimationCodegen.ts`, `manim-timeline/src/hooks/useAddSceneItems.ts`, `manim-timeline/src/lib/axesPreviewRequest.test.ts`, `manim-timeline/src/lib/axesPreviewRequest.ts`, `manim-timeline/src/lib/axesRasterPreview.test.ts`, `manim-timeline/src/lib/axesRasterPreview.ts`, `manim-timeline/src/lib/constants.ts`, `manim-timeline/src/lib/exportReadiness.test.ts`, `manim-timeline/src/lib/exportReadiness.ts`, `manim-timeline/src/lib/graphAnnotationLayout.test.ts`, `manim-timeline/src/lib/graphAnnotationLayout.ts`, `manim-timeline/src/lib/graphCreatePreview.test.ts`, `manim-timeline/src/lib/graphCreatePreview.ts`, `manim-timeline/src/lib/graphMotion.test.ts`, `manim-timeline/src/lib/graphMotion.ts`, `manim-timeline/src/lib/itemDisplayName.ts`, `manim-timeline/src/lib/migrateLoadedItems.ts`, `manim-timeline/src/lib/migrateProjectToV43.test.ts`, `manim-timeline/src/lib/migrateProjectToV43.ts`, `manim-timeline/src/lib/migrateProjectToV44.test.ts`, `manim-timeline/src/lib/migrateProjectToV44.ts`, `manim-timeline/src/lib/mtprojBundle.test.ts`, `manim-timeline/src/lib/multisceneNormalize.test.ts`, `manim-timeline/src/lib/projectFragment.test.ts`, `manim-timeline/src/lib/projectFragment.ts`, `manim-timeline/src/lib/visualPlaybackPreview.test.ts`, `manim-timeline/src/lib/visualPlaybackPreview.ts`, `manim-timeline/src/panels/AddObjectToolbar.tsx`, `manim-timeline/src/panels/ExportPanel.tsx`, `manim-timeline/src/panels/GraphDotEditor.tsx`, `manim-timeline/src/panels/TargetAnimationEditor.tsx`, `manim-timeline/src/services/axisPreviewHooks.ts`, `manim-timeline/src/services/measureClient.test.ts`, `manim-timeline/src/services/measureClient.ts`, `manim-timeline/src/store/factories.ts`, `manim-timeline/src/store/useSceneStore.graphMotion.test.ts`, `manim-timeline/src/store/useSceneStore.ts`, `manim-timeline/src/timeline/TimelineClip.tsx`, `manim-timeline/src/types/scene.ts`, `measure_server.py`, and `test_preview_axes.py`.
- Diff/invariant inspection:
  - `src/lib/canvasManimCoords.ts` now translates in the centered canvas-pixel basis: identity camera returns `{ x: 0, y: 0, scale: 1 }`, so `SceneCanvas` no longer adds a second half-canvas translation on top of children that already use `manimToCanvas` centered coordinates.
  - `SceneCanvas.tsx` still applies `cameraViewportTransform` exactly once to the content `<Group>`; the background grid remains in a separate earlier layer outside that transform. `GraphNode.tsx` still positions the draggable graph group at `posX/posY = manimToCanvas(resolvedX,resolvedY)` local to that parent, and `useDragSnap` still reads `e.target.x()/y()`, i.e. Konva parent-local child coordinates. Therefore no GraphNode/camera inverse drag change was introduced or needed for this identity-placement fix.
  - `src/lib/canvasManimCoords.test.ts` asserts the reported numeric regressions: identity `960×540` transform is no longer `(480,270)` and maps world origin to `(480,270)` once; nonidentity pan/zoom maps camera center to `(600,337.5)` rather than the prior double-translated `(1800,1012.5)`; factory insertion keeps axes/plot/dot scene positions at zero; and a frame-offset playback/world-position round trip remains stable under identity.
  - Insertion and pause/play same-world position are now accounted for statically: factory-created graph items start at `(0,0)`, GraphNode converts that to the canvas center, and an identity authored camera no longer moves the already-centered content group. Thus Play under identity should render the same stored world position instead of returning the graph to the old lower-right half-canvas offset.
- Claims in implementation notes that could not be independently confirmed or remain uncovered:
  - Red-first failures were not reproduced independently because the verifier saw only the already-patched worktree; the diff and final tests confirm the asserted emitted numbers, but not the pre-patch run.
  - No browser/manual acceptance was performed. The actual reported browser sequence (initial lower-right, drag only graph while grid is fixed, pause centered, Play jump) remains a manual/UI-review scenario, especially for real Konva dragging under nonidentity Free/Follow view transforms.
  - The new tests are sufficient for the half-canvas identity transform regression but are still mostly helper-level; they do not mount `SceneCanvas` or simulate a real Konva drag event through the transformed parent.

Verdict: **pass** for the approved-alternative narrow placement fix. Status set to `reviewing` for the requested reviewers/manual follow-up. This does **not** claim browser/manual acceptance and does **not** unblock export/codegen/docs.

## Review notes (manim-reviewer) — 2026-09-27 geometry-only placement re-review

Findings: none blocking in this bounded, read-only geometry review. Verdict: **pass for the narrow cameraViewportTransform correction**; manual browser acceptance remains pending.

- Static transform check: pass. `manim-timeline/src/lib/canvasManimCoords.ts:57`-`:70` now computes the content transform in the same already-centered canvas-pixel basis produced by `manimToCanvas` (`:5`-`:14`). Algebraically, for any world point `P`, `base(P) = (W/2 + P.x*W/FRAME_W, H/2 - P.y*H/FRAME_H)` and the corrected translation is `screenCenter - scale*base(cameraCenter)`, so identity pose `(0,0,FRAME_W)` gives `{x:0,y:0,scale:1}` and a nonidentity camera center maps exactly to canvas center. This removes the former repeated half-canvas translation without introducing a per-graph offset.
- Scene nesting check: pass. `manim-timeline/src/canvas/SceneCanvas.tsx:248`-`:250` still derives one `followTransform` from `cameraViewportTransform`, and `:953`-`:958` applies it once to the content `<Group>`. The background grid remains in the earlier untransformed layer (`:943`-`:950`), matching the intended fixed-grid/manual-drag observation. `manim-timeline/src/canvas/layers/GraphNode.tsx:201`-`:202` still places graph groups with centered `manimToCanvas`-equivalent local coordinates, and `:534`-`:541` keeps the graph group as the draggable child; no inverse/double-correction path was added.
- Axes raster anchor regression check: pass. The previous raster/client anchor math is local to `GraphNode` and unaffected except by the corrected single parent camera transform. `manim-timeline/src/lib/axesRasterPreview.ts:74`-`:92` still converts server origin/basis into axes-local graph geometry, and `:49`-`:63` still avoids double offset between raster-active and vector-fallback paths. `manim-timeline/src/canvas/layers/GraphNode.tsx:300`-`:338` still feeds plots/dots/guides through `axesOverlayPoint`; the camera fix changes only the outer content viewport transform, not these axes-local anchors.
- Test evidence reviewed: `manim-timeline/src/lib/canvasManimCoords.test.ts:44`-`:56` covers identity camera → identity transform and world origin at canvas center; `:58`-`:74` covers pan/zoom camera center projection using independent screen-center expectations; `:76`-`:115` covers frame-offset parent-local drag/store/playback stability; `:117`-`:145` covers world/canvas round trips at multiple camera widths and canvas sizes. This is sufficient mathematical coverage for the reported half-canvas lower-right placement regression.
- Render/export scope: no generated Python/codegen files were reviewed for this placement fix, and no Manim render was run. The graph-follow export guard remains intentionally out of scope/disabled, so the mandatory generated-Python `HebrewMathLine`/`Axes` static checks are not applicable to this narrow client-geometry re-review.
- Verification limits: browser tooling was unavailable, so I did not reproduce the live sequence (spawn lower-right, drag center, Play reset) or simulate a real Konva drag. Manual/user acceptance is still required for Free/Follow views and any nonidentity zoom/pan cases. Do not advance to docs/done or unblock graph-follow codegen solely from this geometry-only pass.

## Verification (verifier) — 2026-09-27 FINAL combined feature record

| Gate | Command | Result |
|---|---|---|
| Focused codegen/lib tests | `npx vitest run src/codegen/targetAnimationCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/codegen/projectExporter.test.ts src/lib/graphMotion.test.ts src/lib/exportReadiness.test.ts` | pass — `Test Files  5 passed (5)`, `Tests  71 passed (71)`. |
| Editor V44 focused tests | `npx vitest run src/lib/migrateProjectToV43.test.ts src/lib/migrateProjectToV44.test.ts src/lib/graphMotion.test.ts src/lib/graphAnnotationLayout.test.ts src/lib/axesRasterPreview.test.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.test.ts src/store/useSceneStore.graphMotion.test.ts` | pass — `Test Files  8 passed (8)`, `Tests  78 passed (78)`. |
| Fragment/bundle/normalize/readiness tests | `npx vitest run src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts src/lib/exportReadiness.test.ts` | pass — `Test Files  4 passed (4)`, `Tests  22 passed (22)`. |
| Axes client contract focused tests | `npx vitest run src/services/measureClient.test.ts src/lib/axesPreviewRequest.test.ts src/lib/axesRasterPreview.test.ts src/lib/graphMotion.test.ts` | pass — `Test Files  4 passed (4)`, `Tests  22 passed (22)`. |
| Frontend build | `npm run build` | pass — `tsc -b && vite build`, `✓ 303 modules transformed`, `✓ built in 1.17s` (chunk-size advisory only). |
| Full frontend tests | `npm run test` | pass — `Test Files  72 passed (72)`, `Tests  579 passed (579)`. |
| Global lint baseline visibility | `npm run lint` | baseline fail, non-blocking for this final per AGENTS touched-file rule — `✖ 41 problems (35 errors, 6 warnings)`, first error `src/canvas/layers/ShapeNode.tsx:203:5 react-hooks/preserve-manual-memoization`, matching earlier unrelated baseline pattern. |
| Scoped codegen touched-file ESLint | `npx eslint src/codegen/targetAnimationCodegen.ts src/codegen/targetAnimationCodegen.test.ts src/codegen/graphCodegen.ts src/codegen/manimExporter.ts src/codegen/leafConcurrentCodegen.ts src/codegen/groupPlaybackSpan.ts src/codegen/manimExporter.overlap.test.ts src/codegen/projectExporter.test.ts src/lib/graphMotion.ts src/lib/graphMotion.test.ts src/lib/exportReadiness.ts src/lib/exportReadiness.test.ts` | pass — command produced no output. |
| Scoped editor touched-file ESLint | `npx eslint src/types/scene.ts src/lib/constants.ts src/lib/migrateLoadedItems.ts src/lib/migrateProjectToV43.ts src/lib/migrateProjectToV43.test.ts src/lib/migrateProjectToV44.ts src/lib/migrateProjectToV44.test.ts src/lib/graphMotion.ts src/lib/graphMotion.test.ts src/lib/graphAnnotationLayout.ts src/lib/graphAnnotationLayout.test.ts src/lib/axesRasterPreview.ts src/lib/axesRasterPreview.test.ts src/lib/graphCreatePreview.ts src/lib/graphCreatePreview.test.ts src/lib/visualPlaybackPreview.ts src/lib/visualPlaybackPreview.test.ts src/lib/exportReadiness.ts src/lib/exportReadiness.test.ts src/lib/projectFragment.ts src/lib/projectFragment.test.ts src/lib/mtprojBundle.test.ts src/lib/multisceneNormalize.test.ts src/store/factories.ts src/store/useSceneStore.ts src/store/useSceneStore.graphMotion.test.ts src/hooks/useAddSceneItems.ts src/panels/AddObjectToolbar.tsx src/panels/TargetAnimationEditor.tsx src/panels/GraphDotEditor.tsx src/panels/ExportPanel.tsx src/canvas/layers/GraphNode.tsx src/timeline/TimelineClip.tsx` | pass — command produced no output. |
| Scoped axes-client ESLint | `npx eslint src/types/scene.ts src/services/measureClient.ts src/services/axisPreviewHooks.ts src/lib/axesPreviewRequest.ts src/lib/axesPreviewRequest.test.ts src/lib/axesRasterPreview.ts src/lib/axesRasterPreview.test.ts src/lib/graphCreatePreview.ts src/lib/graphCreatePreview.test.ts src/lib/graphMotion.ts src/lib/graphMotion.test.ts src/canvas/layers/GraphNode.tsx` | pass — command produced no output. |
| Working tree inventory | `git status --short`; `git diff --stat` | inspected — tracked diff `57 files changed, 2347 insertions(+), 348 deletions(-)` plus untracked handoffs/tests/source files; unrelated WIP remains preserved. |

- Final editor/schema/readiness checks:
  - User manual acceptance for the editor placement correction is recorded in this handoff as: “Works great, I think we can continue.” No new browser/dev-server run is claimed here.
  - `GRAPH_FOLLOW_EXPORT_SUPPORTED = true` is now set in `src/lib/exportReadiness.ts`; focused readiness/store/codegen tests and full suite passed. Export readiness no longer leaves a dangling preview-only guard for valid graph-follow/annotation projects.
  - Schema invariant is met: `PROJECT_VERSION = 44`; V43 and V44 migrations are wired; V44 migration tests cover free attachment/style defaults, idempotence, preserving existing values, precision clamp, and V43 graphFollow compatibility.
  - The final codegen handoff/reviewer records passed bounded `-ql` function and attached-parametric render fixtures after the emitter fixes. The final guard flip did not edit emitted-source files.
  - Server axes-origin dependency remains accepted from `docs/handoffs/2026-09-25-preview-axes-origin-anchors.md` (`status: docs`) and was not changed in this final guard transition.
- Out-of-scope changes found in the final diff:
  - No concrete unauthorized final editor/guard file was found in the bounded classification. Editor V44 work is in the planned/addendum files; export/codegen work is recorded in the codegen handoff, including the later-authorized `src/codegen/staticAddCodegen.ts`.
  - Existing unrelated WIP remains outside this verdict and was not inspected or cleaned: agent/Copilot files, camera handoffs/codegen, agent/orchestrator config, README/docs WIP, server `measure_server.py`/`test_preview_axes.py` dependency changes, and other preserved files shown by `git status --short`.
- Claims in Implementation notes that could not be independently re-run in this bounded final record:
  - I did not repeat Manim renders, server gates, `npm run dev`, or browser/manual acceptance. This final record relies on the already-recorded reviewer render pass, server verification, and the user's quoted editor acceptance.
  - I did not read every unrelated modified diff; review was bounded to final graph-follow export/editor contract files and the already-run gates above.

Verdict: **pass**. The global `npm run lint` baseline remains visibly failing outside this task, but AGENTS requires lint cleanliness for touched files and the scoped touched-file lint gates passed. Editor V44, guard transition, and combined feature verification are complete; status set to `docs` for docs-keeper.

## Verification (verifier) — 2026-09-27 docs-only closure check

- No full gates were rerun for this docs-only check; it relies on the recorded final 579-test/build/scoped-lint evidence, bounded render pass, server prerequisite evidence, and the quoted user editor acceptance.
- Frontmatter is `status: done`. README now documents graph-follow V44 editor/export behavior, enabled export support, cached `HebrewMathLine` coordinate glyph export, unchanged graphFollow timing (`Math.max(0.01, duration)` with no annotation-added waits), server origin/basis raster metadata, and V44 migration fields. It explicitly keeps Copilot graph-follow authoring deferred and does not promise graph-shape animation, arc-length speed, or search/optimization.
- Checked for documentation contradiction: README contains no leftover “graph-follow unsupported/export blocked” claim; remaining “not supported” statements are scoped non-goals (free-point parametric inversion, graph-shape animation, arc-length speed, optimization/search, Copilot authoring).
- Bounded diff/status check: docs closure changes are README + handoff notes/status. Existing app/server/Copilot/camera WIP is still present in `git status` and remains outside this docs-only closure; no app diff is attributed to the docs fallback.

Verdict: **pass** for docs-only closure; handoff remains `status: done`.
