---
slug: axes-attachment-visibility
created: 2026-09-11
status: docs
owner_role: editor-dev
next_tool: any
source: user request
---

## Plan (architect)

### Goal
Make axes relationships as visible as animation target relationships: when an item is a graph overlay (`graphPlot`, `graphCurve`, `graphDot`, `graphField`, `graphFunctionSeries`, `graphPointSequence`, `graphArea`), the user should be able to see at a glance which `axes` item it is anchored to, especially in the Items panel's **By object** workflow. The smallest implementation should reuse existing `axesId` links and labels; no project shape or graph rendering semantics should change.

### Non-goals
- Do not add a new persisted “attachedTo” field; `axesId` is already the source of truth.
- Do not change graph preview, export/codegen, axes domains, timing, layers, or z-order.
- Do not make `graphArea` / `graphField` Copilot-creatable in this handoff.
- Do not redesign animation target assignment; `2026-09-11-animation-target-assignment-affordance.md` remains separate.
- Do not touch the current uncommitted expression-helper / Copilot-parity WIP except where this handoff explicitly lists shared files after the user chooses an option.

### Touched files
#### lib/
- `manim-timeline/src/lib/itemRelationships.ts` — add pure helpers for graph-overlay → axes relationships only if the chosen UX needs grouped/nested data (for example, “children under axes”); otherwise leave unchanged and derive labels locally in UI.
- `manim-timeline/src/lib/itemRelationships.test.ts` — add/extend tests if `itemRelationships.ts` gains axes-child grouping or axes attachment metadata.
- `manim-timeline/src/lib/itemDisplayName.ts` — read-only dependency for labels; change only if graph/axes display names need a reusable short-label helper.

#### UI
- `manim-timeline/src/panels/ItemList.tsx` — primary surface for the chosen minimal visibility affordance in Timeline and/or By object views.
- `manim-timeline/src/panels/AxesIdSelect.tsx` — optional small copy/label improvement in graph editors; do not change the stored `axesId` behavior.
- `manim-timeline/src/panels/GraphPlotEditor.tsx`, `GraphCurveEditor.tsx`, `GraphFieldEditor.tsx`, `FunctionSeriesEditor.tsx`, `PointSequenceEditor.tsx`, `GraphAreaEditor.tsx` — only touch if the chosen UX includes editor-side “Attached to axes …” chips near the existing `AxesIdSelect`.

#### docs
- `manim-timeline/README.md` — document the visible axes-attachment affordance and extend the `*Last updated:*` trailer if implemented.
- `docs/handoffs/2026-09-11-axes-attachment-visibility.md` — implementation notes and verification will be appended by later roles only.

### Invariants at risk
- **`axesId` remains the only graph attachment source of truth** — enforced by `manim-timeline/src/types/scene.ts` graph item interfaces and `manim-timeline/src/agent/validate.ts` axes-reference validation; do not add duplicate persisted attachment state.
- **By-object grouping keeps effect semantics** — enforced by `manim-timeline/src/lib/itemRelationships.ts` and `itemRelationships.test.ts`; animation clips should still nest under their target object(s), while graph overlays may optionally be shown as axes-related without becoming effect clips.
- **Frame filtering still applies before grouping** — enforced by `manim-timeline/src/panels/ItemList.tsx` via `associatedFrameId` from `manim-timeline/src/lib/frameGrid.ts`; axes relation UI must not surface hidden-frame children unless the user selected “All frames”.
- **Missing/stale `axesId` must be safe** — graph editors and `ItemList.tsx` must handle deleted/missing axes gracefully; no crash if `itemsMap.get(axesId)` is absent.
- **No preview/export semantic change** — `manim-timeline/src/canvas/SceneCanvas.tsx`, `manim-timeline/src/canvas/layers/GraphNode.tsx`, `manim-timeline/src/codegen/graphCodegen.ts`, and `manim-timeline/src/codegen/functionSeriesCodegen.ts` should not need changes.

### Test plan
- If option 1 (axis chip only) is chosen:
  - From `manim-timeline/`: `npm run build`.
  - From `manim-timeline/`: `npm run test`.
  - From `manim-timeline/`: `npx eslint src/panels/ItemList.tsx src/panels/AxesIdSelect.tsx src/panels/GraphPlotEditor.tsx src/panels/GraphCurveEditor.tsx src/panels/GraphFieldEditor.tsx src/panels/FunctionSeriesEditor.tsx src/panels/PointSequenceEditor.tsx src/panels/GraphAreaEditor.tsx` (omit untouched files).
  - Manual smoke: `npm run dev`; verify graph overlay rows show the correct axes chip/name in Timeline and By object views, missing axes display a warning fallback, and non-graph items are unchanged.
- If option 2 or 3 (axes grouping/nesting) is chosen:
  - Extend `manim-timeline/src/lib/itemRelationships.test.ts` with `describe('axes attachment grouping')`: overlays with `axesId` are related to their axes, overlays also remain selectable as objects if specified by the chosen UX, missing axes route to a safe fallback, and frame-filtered lists do not cross frames.
  - From `manim-timeline/`: `npx vitest run src/lib/itemRelationships.test.ts`.
  - From `manim-timeline/`: `npm run test`.
  - From `manim-timeline/`: `npm run build`.
  - From `manim-timeline/`: `npx eslint src/lib/itemRelationships.ts src/lib/itemRelationships.test.ts src/panels/ItemList.tsx` plus any graph editor files touched.
  - Manual smoke: `npm run dev`; verify axes with zero/one/many overlays, multiple axes, missing axes, duplicated overlays, all-frame vs one-frame filter, and animation children under graph overlays still display correctly.

### Open questions
- Which minimal visibility affordance should v1 implement?
  1. **Axis chip on every graph row (smallest / recommended)** — keep the By-object grouping exactly as today, but graph overlay rows show a compact `Axes: <axes label>` chip in both Timeline and By object views. Clicking/hover title can expose the full axes id/name. Missing axes shows `Axes missing`. This is the least disruptive and directly answers “which axes is this object attached to?”
  2. **Axes header shows attached graph children** — in By object view, each `axes` group visually lists its graph overlays underneath, similar to animation children. Graph overlays can either remain as their own top-level object groups too (duplicated reference, like surrounding rects) or move only under axes (more compact but less object-centric). This is closer to the animation nesting model but needs a clear duplication rule.
  3. **Hybrid: axis chip + collapsible axes summary** — add the row chip from option 1 and also show an optional compact summary under each axes header such as `Attached: Plot, Curve, Area +2`. This keeps graph overlays as their own objects while making axes ownership visible from the axes side.
- Should graph overlays remain independent top-level object groups in By object view even if they also appear under axes? Recommendation: yes, because animations can target the overlay itself and users may still want per-object child effects under the overlay.
- Should this appear only in **By object**, or also in the **Timeline** tab? Recommendation: both, because the ambiguity exists in both row lists.

## Implementation notes (editor-dev)

Implemented option 1 (axis chip on every graph row), in both Timeline and By object views.

- `manim-timeline/src/panels/ItemList.tsx` — `renderRow` now computes an `axesChip` for all seven graph overlay kinds (`graphPlot`, `graphCurve`, `graphDot`, `graphField`, `graphFunctionSeries`, `graphPointSequence`, `graphArea`) from the existing `axesId` via `itemsMap`. Resolved axes render an emerald `Axes: <name>` chip (label from the existing `itemClipDisplayName`, so user labels and `Axes (x, y)` fallbacks both work); hover title shows the full name plus id; clicking the chip selects the axes (`stopPropagation`, reuses the row `select`). Missing/stale `axesId` (deleted axes or non-axes target) renders an amber `Axes missing` chip with guidance tooltip instead of crashing. Non-graph rows return `null` — unchanged. Because both views share `renderRow`, the chip appears in Timeline and By object (including compact nested rows, though graph overlays only ever render as group headers). Chip text uses `dir="auto"` so Hebrew axes labels render correctly in the RTL shell.
- `manim-timeline/src/lib/itemRelationships.ts`, `itemDisplayName.ts`, `AxesIdSelect.tsx`, all graph editors — untouched (no grouping or label-helper change needed for option 1).
- `manim-timeline/README.md` — Clip-naming paragraph documents the chip; `*Last updated:*` trailer extended.
- Deviations: chip click-to-select goes slightly beyond "hover title" in the plan (one `stopPropagation` + existing `select` call) — it makes the chip actionable rather than informational; easy to remove if unwanted.
- Commands run (from `manim-timeline/`):
  - `npm run build` — pass (`tsc -b && vite build`; chunk-size warning only).
  - `npm run test` — pass (44 files, 363 tests; unchanged count, no new tests — option 1 adds no pure logic; component rendering has no test harness in this repo).
  - `npx eslint src/panels/ItemList.tsx` — clean, no output.
- Left undone: in-browser smoke (`npm run dev`) — verify chips on all seven overlay kinds in both views, missing-axes fallback (delete an axes), multi-axes disambiguation, Hebrew axes labels, frame filter interaction, and that animation children under overlays still render; no browser in this session.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Frontend build | `npm run build` from `manim-timeline/` | pass — `✓ 280 modules transformed` / `✓ built in 1.02s`; Vite chunk-size warning only. |
| Frontend tests | `npm run test` from `manim-timeline/` | pass — `Test Files 44 passed (44)` and `Tests 363 passed (363)`. |
| Touched-file lint | `npx eslint src/panels/ItemList.tsx` from `manim-timeline/` | pass — command produced no output. |
| Working-tree scope | `git status --short` and `git diff --stat` from repo root | pass for this handoff scope — task changes are in `manim-timeline/src/panels/ItemList.tsx`, `manim-timeline/README.md`, and this handoff; other listed paths match the user-noted unrelated WIP. |
| Static invariants | read diffs for `ItemList.tsx`, `README.md`, and this handoff | pass — `ItemList.tsx` switch limits chips to `graphPlot`, `graphCurve`, `graphDot`, `graphField`, `graphFunctionSeries`, `graphPointSequence`, `graphArea`; default returns `null`; missing/non-axes refs render `Axes missing`; resolved chip uses `dir="auto"`, `stopPropagation()`, and `select(ax.id)`. README documents the chip and extends the trailer. |

- Out-of-scope changes found in the diff (files not in this task's requested scope): none attributable to this handoff. The working tree still contains user-noted unrelated WIP under `src/agent`, graph expression-helper/editor files, other handoff docs, and new expression-helper files.
- Claims in "Implementation notes" that could not be confirmed: in-browser smoke remains unrun; frame-filter interaction and visual behavior in the browser were only statically checked through shared `visibleItems`/`renderRow` paths.

Verdict: **pass**.
