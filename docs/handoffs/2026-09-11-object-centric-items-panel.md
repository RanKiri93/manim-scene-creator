---
slug: object-centric-items-panel
created: 2026-09-11
status: docs
owner_role: editor-dev
next_tool: any
source: user request / UX improvement
---

## Plan (architect)

### Goal
Make the Items panel easier to use when looking for animations related to a specific object. Add an object-centric organization mode alongside the current chronological list: each drawable/object row becomes a small group with its related animation/effect clips nested underneath, so users can quickly answer “what happens to this object?” without hunting through the full timeline. Also improve generated animation row labels with compact target/mode/time hints. Keep the current chronological view available for users who prefer the existing time-ordered workflow.

Recommended v1 UX:
- Add a view toggle in `Items`: `Timeline` / `By object` (or `Chronological` / `By object`). Default to the existing chronological view for low risk; optionally remember the toggle in component state only.
- `By object` view groups by visible frame filter (`All frames` or one frame), then lists drawable/object items in their existing chronological order.
- Each object group row shows: object kind badge, object label, object start time, and a compact count such as `3 animations`.
- Under each object, nest related clips in chronological order with smaller rows: `Exit · FadeOut · @8.2s`, `Blink · @5.0s`, `Color · @6.4s`, `Rect · @3.0s`, etc. Use a connector/indent and muted background so child animations visually belong to the parent object.
- Multi-target animations appear under each target object, with a chip like `+2 targets` or tooltip listing the other targets; selecting/deleting/duplicating the row should still operate on the one real animation item, not a copy.
- Add an `Unassigned / global animations` group for clips that have no valid object target in the current filter (missing target, camera move, or anything not object-scoped).
- Existing row click, multi-select modifier behavior, Duplicate, and Delete controls must keep working for both object rows and nested animation rows.

### Non-goals
- Do not change persisted schema (`types/scene.ts`), add user-defined tags, or auto-mutate item labels. This v1 derives relationships from existing fields (`targets`, `targetIds`, graph attachment fields, frame association) only.
- Do not change timeline ordering, playback, export/codegen, clip timing, target animation semantics, frame assignment semantics, or selection store semantics.
- Do not remove the existing chronological list; the new organization is an additional view.
- Do not redesign editor forms (`ExitAnimationEditor`, `TargetAnimationEditor`, etc.) except for reusing existing label helpers if needed.
- Do not add drag/drop reordering or object folders that persist in project files.

### Touched files
lib/:
- `manim-timeline/src/lib/itemRelationships.ts` (new) — pure helpers to classify item roles and derive relationships: drawable/object items, object-scoped animation/effect items, related target ids, missing-target status, related-count labels, and stable grouping order.
- `manim-timeline/src/lib/itemRelationships.test.ts` (new) — unit tests for exit/blink/target/surroundingRect grouping, multi-target duplication under each target, missing-target/global bucket behavior, frame filtering via `associatedFrameId`, and chronological sorting inside groups.
- `manim-timeline/src/lib/itemDisplayName.ts` — optional small helper(s) for compact animation labels/chips if keeping that logic out of the component is cleaner; preserve existing `itemClipDisplayName`/`exitTargetSelectLabel` outputs unless explicitly extending with new exported helpers.

UI:
- `manim-timeline/src/panels/ItemList.tsx` — add view toggle state, reuse existing frame filter, render the current chronological list unchanged in `Timeline` mode, and render new object-grouped rows in `By object` mode. Keep selection, duplicate, delete, kind badges, time display, and empty states. Extract small local row subcomponents only if it reduces duplication.

docs:
- `manim-timeline/README.md` — update the Timeline / Clip naming docs and extend the `*Last updated:*` trailer if the new `By object` Items view ships.

### Invariants at risk
- Item panel must only show top-level items and must not surface compound children as independent rows; enforced by `isTopLevelItem` in `manim-timeline/src/lib/time.ts` and current filtering in `manim-timeline/src/panels/ItemList.tsx`.
- Frame filtering must remain consistent with target/editor frame scope; enforced by `associatedFrameId`, `readingOrderFrames`, and `frameDisplayName` in `manim-timeline/src/lib/frameGrid.ts`, plus `targetScopeFrameId` / `filterTargetsByScope` in `manim-timeline/src/lib/targetScope.ts`.
- Animation-to-object relationships must match existing target semantics: `exit_animation.targets[].targetId`, `blink_animation.targets[].targetId`, `target_animation.targets[].targetId`, and `surroundingRect.targetIds`; enforced by item type definitions in `manim-timeline/src/types/scene.ts` and editor UIs `manim-timeline/src/panels/ExitAnimationEditor.tsx` / `manim-timeline/src/panels/TargetAnimationEditor.tsx` / surrounding-rect editor code.
- Selecting, multi-selecting, duplicating, and deleting from Items must still call the same store actions (`select`, `duplicateItem`, `removeItem`) and respect multi-select modifiers; enforced in `manim-timeline/src/store/useSceneStore.ts`, `manim-timeline/src/lib/uiModifiers.ts`, and current `ItemList.tsx` handlers.
- Multi-target animation rows in `By object` view are visual references to one item, not cloned data; enforced by using the same item id for selection/delete/duplicate and by tests in `manim-timeline/src/lib/itemRelationships.test.ts`.
- No persisted project schema change: `PROJECT_VERSION` migration chain in `manim-timeline/src/types/scene.ts` must remain untouched.
- Existing uncommitted WIP from prior handoffs must be preserved: do not revert/reformat current changes in `manim-timeline/src/App.tsx`, `manim-timeline/src/panels/AddObjectToolbar.tsx`, timeline-surgery files, scrubber CSS/PlaybackControls, or README sections unrelated to this Items-panel change.

### Test plan
Exact commands from `manim-timeline/`:
- `npx vitest run src/lib/itemRelationships.test.ts` — new pure helper tests. Required cases: `describe('itemRelationships object grouping')` with target animation under its object, exit/blink under targets, surrounding rect under all target objects, multi-target clip represented under each target but preserving one source id, missing/deleted target routed to global/unassigned group, frame filter excludes other-frame objects/animations consistently, group/child chronological sorting.
- `npx vitest run src/store/useSceneStore.timelineSurgery.test.ts src/timeline/timelineAudioController.test.ts` — nearby guardrails for Items/timeline UI work already touched in this worktree.
- `npm run build` — TypeScript/Vite gate.
- `npm run test` — full Vitest suite.
- `npx eslint src/lib/itemRelationships.ts src/lib/itemRelationships.test.ts src/lib/itemDisplayName.ts src/panels/ItemList.tsx` — touched/new files clean. If `itemDisplayName.ts` is not touched, omit it from the command.
- Manual UI smoke via `npm run dev`: verify the Items header still filters by frame; `Timeline` mode matches the previous chronological list; `By object` mode nests animations under objects; selecting a nested animation opens/selects the real clip; Duplicate/Delete buttons still affect the real item once; multi-target animations appear under each target with an “also targets” hint; missing-target/global clips remain discoverable.

Existing tests/code inspected before planning:
- `manim-timeline/src/panels/ItemList.tsx`
- `manim-timeline/src/lib/itemDisplayName.ts`
- `manim-timeline/src/lib/frameGrid.ts`
- `manim-timeline/src/lib/targetScope.ts`
- `manim-timeline/src/panels/ExitAnimationEditor.tsx`
- `manim-timeline/src/panels/TargetAnimationEditor.tsx`
- `manim-timeline/src/timeline/timelineAudioController.test.ts`
- `manim-timeline/src/store/useSceneStore.timelineSurgery.test.ts`

### Open questions
None for v1. Keep the existing chronological Items view and add `By object` as an alternate organization mode; do not introduce persistent custom labels/tags unless a later UX pass asks for them.

## Implementation notes (editor-dev)

- `manim-timeline/src/lib/itemRelationships.ts` (new) — pure helpers per plan: `itemPanelRole` (object = drawables incl. surroundingRect; effect = exit/blink/target animations; global = camera_move), `relatedObjectIds` (targets/targetIds), `nestedChildTitle` (compact `Exit · FadeOut` / `Blink · scale` / `Color` / `Rect` titles that drop the redundant parent name), `relatedCountLabel`, and `buildObjectPanelModel` (groups in caller order, children chronological, multi-target clips referenced under each visible object target with `otherTargetNames` + `hasMissingTarget`, camera moves and target-less/out-of-filter effects in `unassigned`). Self-references and effect-as-target (stale data) fall back to unassigned, never crash.
- `manim-timeline/src/lib/itemRelationships.test.ts` (new) — 10 tests in `describe('itemRelationships object grouping')` covering roles, target-id extraction, exit/blink/target nesting + titles, rect-under-all-targets plus own header, multi-target single-source-id references with other-target names, missing/out-of-filter targets → unassigned, missing-sibling flag, non-object targets → unassigned, camera-move bucket ordering, count labels.
- `manim-timeline/src/panels/ItemList.tsx` — added a `Timeline` / `By object` tab toggle (component state, defaults to Timeline) below the existing frame-filter header; Timeline mode renders byte-identical rows to before. By-object mode renders object group cards (existing `renderRow` for the header plus an `N related` trailing count) with indented connector-railed compact child rows (same select/multi-select/duplicate/delete handlers and ids — references, not copies), `+N` chips with other-target tooltips (amber when a sibling target is missing), and an `Unassigned` section. `renderRow` gained optional `compact`/`title`/`trailing` opts; kind badges, time labels, and empty states unchanged.
- `manim-timeline/README.md` — Clip-naming bullet documents the two views; `*Last updated:*` trailer extended (appended in front of prior entries without touching them).
- Deviations: (1) group count reads `N related` rather than the plan's example `N animations`, because nested children can also be surrounding rects; (2) `itemDisplayName.ts` intentionally untouched — the new compact-title logic lives in `itemRelationships.ts`, so existing `itemClipDisplayName`/`exitTargetSelectLabel` outputs are provably unchanged; (3) graph overlays (`axesId` attachments) stay top-level object rows rather than nesting under their axes, keeping one nesting level — their own effects still nest under them. No `types/scene.ts` change (no migration), no `measureClient.ts`/server change.
- Commands run (from `manim-timeline/`):
  - `npx vitest run src/lib/itemRelationships.test.ts` — pass (10 tests; one self-inflicted fixture fix: string passed where string[] expected, plus one `tsc` fix adding `labelFontSize`/`introStyle` to the rect fixture).
  - `npx vitest run src/lib/itemRelationships.test.ts src/store/useSceneStore.timelineSurgery.test.ts src/timeline/timelineAudioController.test.ts` — pass (3 files, 25 tests).
  - `npm run build` — pass (`tsc -b && vite build`; chunk-size warning only).
  - `npm run test` — pass (43 files, 324 tests; was 42/314).
  - `npx eslint src/lib/itemRelationships.ts src/lib/itemRelationships.test.ts src/panels/ItemList.tsx` — clean, no output.
- Left undone: manual browser smoke at `http://localhost:5173/` (dev server not started in this session) — verifier/reviewer should confirm Timeline mode matches the old list, By-object nests correctly, nested select/duplicate/delete act on the real clip once, and the frame filter composes with both views.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Pure item relationship tests | `npx vitest run src/lib/itemRelationships.test.ts` | pass — `Test Files 1 passed (1); Tests 10 passed (10)`. |
| Timeline/audio guardrail tests | `npx vitest run src/store/useSceneStore.timelineSurgery.test.ts src/timeline/timelineAudioController.test.ts` | pass — `Test Files 2 passed (2); Tests 15 passed (15)`. |
| Full frontend test suite | `npm run test` | pass — `Test Files 43 passed (43); Tests 324 passed (324)`. |
| TypeScript/Vite build | `npm run build` | pass — `tsc -b && vite build`; Vite completed with chunk-size warning only, `✓ built in 1.13s`. |
| ESLint touched files | `npx eslint src/lib/itemRelationships.ts src/lib/itemRelationships.test.ts src/panels/ItemList.tsx` | pass — clean command, no output. `itemDisplayName.ts` intentionally omitted and `git diff --name-only -- manim-timeline/src/lib/itemDisplayName.ts` was empty. |
| Scope/static invariant check | `git status --short`; `git diff --stat`; diff/read of `itemRelationships.ts`, `itemRelationships.test.ts`, `ItemList.tsx`, `README.md`; `git diff --name-only -- manim-timeline/src/types/scene.ts manim-timeline/src/services/measureClient.ts measure_server.py` | pass — `ItemList` Timeline mode still maps `visibleItems` through `renderRow(item)`; nested rows call the same `renderRow(child.item, ...)`, whose select/duplicate/delete handlers use `item.id`; README trailer starts with `By-object Items view`; no schema/server/measure-client diff. |

- Out-of-scope changes found in the diff (files not in "Touched files"):
  - `git status --short` still shows unrelated WIP outside this task scope: `manim-timeline/src/App.tsx`, `manim-timeline/src/index.css`, `manim-timeline/src/panels/AddObjectToolbar.tsx`, `manim-timeline/src/store/useSceneStore.ts`, `manim-timeline/src/timeline/PlaybackControls.tsx`, timeline-surgery files, agent/config docs, and `opencode.json`. Per the verifier request these were pre-existing WIP from earlier handoffs, not attributed to this task. No task-attributable out-of-scope file changes were found; `itemDisplayName.ts`, `types/scene.ts`, `measureClient.ts`, and `measure_server.py` have no diff.
- Claims in "Implementation notes" that could not be confirmed:
  - Manual browser smoke via `npm run dev` was not run; visual equivalence/interaction was checked statically from `ItemList.tsx` only.

Verdict: **pass**.
