---
slug: redesign-insert-controls
created: 2026-09-10
status: planned
owner_role: editor-dev
next_tool: cursor
source: user request
---

## Plan (architect)

### Goal
Redesign the current add-objects/add-animations controls so inserting common items is more discoverable, faster during editing, and located closer to the user's working context than the current narrow left-side icon toolbar.

### Non-goals
Do not change the persisted project schema, generated Manim Python, object/animation creation semantics, default object properties, audio pipeline behavior, or store action behavior. Do not implement until the user chooses a direction from the open questions below.

### Touched files
- UI
  - `manim-timeline/src/panels/AddObjectToolbar.tsx` — likely replace the current compact icon-only grouped toolbar with the selected insert-control design.
  - `manim-timeline/src/App.tsx` — likely move/remove the current resizable add-toolbar column and place the selected insert surface in the top bar, canvas area, timeline area, or left sidebar.
  - `manim-timeline/src/hooks/useAddSceneItems.ts` — keep as the creation-action boundary; only touch if the selected design needs explicit disabled/availability metadata or labels/tooltips separated from presentation.
- store
  - No store behavior changes planned.
- types/
  - No persisted schema changes planned.
- lib/
  - No shared timing/layout logic changes planned.
- codegen/
  - No codegen changes planned.
- docs
  - `docs/handoffs/2026-09-10-redesign-insert-controls.md` (new) — records this design decision plan.
  - `manim-timeline/README.md` — update only if the final selected design materially changes documented creation workflow.

### Invariants at risk
- Creating items at the current playhead must remain unchanged; enforced by `manim-timeline/src/hooks/useAddSceneItems.ts` and factory calls in `manim-timeline/src/store/factories.ts`.
- Dependent objects/animations must still pick selected eligible targets first, then same-frame fallback candidates; enforced by `manim-timeline/src/hooks/useAddSceneItems.ts` and eligibility helpers in `manim-timeline/src/lib/time.ts` / `manim-timeline/src/lib/targetScope.ts`.
- App layout must keep item list, frames panel, canvas, property panel, export panel, and agent panel usable; enforced structurally in `manim-timeline/src/App.tsx`.
- Existing add actions should not become hidden from keyboard/screen-reader users; enforced by button `title`/`aria-label` usage in `manim-timeline/src/panels/AddObjectToolbar.tsx`.
- No schema migration should be needed because no `SceneItem` shape changes are planned; enforced by `PROJECT_VERSION` and migration tests under `manim-timeline/src/lib/migrateProjectToV*.test.ts`.

### Test plan
- Existing tests covering this exact toolbar do not currently exist (`AddObjectToolbar` / `useAddSceneItems` have no matching `*.test.ts` found).
- From `manim-timeline/`: `npm run build`
- From `manim-timeline/`: `npm run test` — existing test files include store/lib/codegen/agent tests; no new test file is required for a presentation-only rearrangement.
- From `manim-timeline/`: `npm run lint`
- Manual UI smoke in the running app at `http://localhost:5173/`:
  - Add Text line, Axes, Shape at current playhead.
  - Add an axes-dependent graph object with and without an axes item selected; confirm fallback axes behavior is unchanged.
  - Select an eligible object and add Exit, Blink, and one Target animation; confirm target selection and start-time behavior are unchanged.
  - Resize/narrow the window and confirm insert controls remain reachable without blocking canvas/property/timeline workflows.

### Open questions
1. Preferred placement: top command bar, floating canvas “+” button/palette, left sidebar section near item list, timeline-context insert button, or a hybrid?
2. Preferred interaction model: always-visible buttons, one “+ Add” menu/palette with search, categorized tabs, or context-sensitive suggestions based on selection/current time?
3. Should animations be visually separated from objects, or should target-based animations appear next to the selected object/timeline clip they act on?
4. Should graph-related inserts remain visible all the time, or appear only after axes exist/are selected to reduce clutter?
5. Is keyboard-driven insertion important now (e.g. `A` or `Ctrl+K` opens an add palette), or should this remain mouse-first?
6. Should audio buttons be part of this redesign, or should the scope stay only objects and animations?
