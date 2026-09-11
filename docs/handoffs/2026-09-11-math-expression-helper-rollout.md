---
slug: math-expression-helper-rollout
created: 2026-09-11
status: docs
owner_role: editor-dev
next_tool: any
source: user request
---

## Plan (architect)

### Goal
Order **1 of 3**. Extend the verified paired JS/Python expression helper from Graph Plot + inline Graph Area to every existing editor surface that edits mathematical expression pairs, so users get the same inline status, modal helper, presets/snippets, variable chips, and `^` → `**` warning/fix wherever they type formulae.

### Non-goals
- Do not change persisted project shape, `PROJECT_VERSION`, migrations, factories, or codegen output.
- Do not execute Python/NumPy in the browser or server; Python checking remains conservative lint-only.
- Do not add new graph/animation capabilities or alter preview/export semantics; this is UI consistency over existing fields only.
- Do not change Copilot behavior in this handoff; that is order 2 in `2026-09-11-copilot-expression-helper-parity.md`.
- Do not redesign animation target assignment in this handoff; that is blocked pending product choice in `2026-09-11-animation-target-assignment-affordance.md`.

### Touched files
#### lib/
- `manim-timeline/src/lib/mathExpressionValidation.ts` — keep validation pure, extend/confirm custom variable-context support for `x`, `t`, `x,y`, `n`, and `n,x` expression pairs without changing execution policy.
- `manim-timeline/src/lib/mathExpressionValidation.test.ts` — extend tests for each variable context used by the migrated editors.

#### UI
- `manim-timeline/src/panels/mathExpressionPresets.ts` — generalize the preset/snippet catalog into small context profiles: scalar `f(x)`, parametric `x(t)/y(t)`, field scalar `f(x,y)`, function-series `f(n,x)`, point-sequence coordinate `x(n)/y(n)`, and path-offset `x(t)/y(t)`.
- `manim-timeline/src/panels/MathExpressionEditor.tsx` — expose props for variable chips/help text/profile-specific presets while preserving the Plot + Area call sites.
- `manim-timeline/src/panels/MathExpressionDialog.tsx` — render all variable chips supplied by the profile and use the selected profile’s snippets/presets.
- `manim-timeline/src/panels/GraphPlotEditor.tsx` — update only if prop names/profile wiring changed; behavior should remain identical to the verified pilot.
- `manim-timeline/src/panels/GraphAreaEditor.tsx` — update only if prop names/profile wiring changed; inline-expression sources keep the verified behavior and existing-plot sources remain dropdown-only.
- `manim-timeline/src/panels/GraphCurveEditor.tsx` — replace raw `x(t)` and `y(t)` paired inputs with `MathExpressionEditor` using variable `t`.
- `manim-timeline/src/panels/GraphFieldEditor.tsx` — replace vector `P(x,y)` / `Q(x,y)` and slope `f(x,y)` raw pairs with `MathExpressionEditor`; preserve vector preset behavior by applying paired P/Q presets at the field-editor level or via a small local row.
- `manim-timeline/src/panels/FunctionSeriesEditor.tsx` — replace top-level `f(n,x)` paired inputs with `MathExpressionEditor` using variables `n` and `x`.
- `manim-timeline/src/panels/PointSequenceEditor.tsx` — replace `x(n)` and `y(n)` paired inputs with `MathExpressionEditor` using variable `n`.
- `manim-timeline/src/panels/TargetAnimationEditor.tsx` — replace parametric path `x(t)` / `y(t)` raw pairs with `MathExpressionEditor`; keep `tMin`, `tMax`, `samples`, and polyline path editing unchanged.
- `manim-timeline/src/panels/GraphFieldExpressionHelp.tsx` — either reduce to the reusable `GraphFieldHelpIcon` if still imported or remove migrated preset-row exports after all imports are gone.

#### docs
- `manim-timeline/README.md` — update the Graph expressions section from “Plot + Area pilot” to “all expression editors” and extend the `*Last updated:*` trailer.
- `docs/handoffs/2026-09-11-math-expression-helper-rollout.md` — implementation notes and verification will be appended by later roles only.

### Invariants at risk
- **No persisted shape change** — `manim-timeline/src/types/scene.ts` and `PROJECT_VERSION` must remain untouched; migrated editors must keep writing the same existing `js*Expr` / `py*Expr` fields.
- **Preview/export semantic parity** — `manim-timeline/src/canvas/layers/GraphNode.tsx`, `manim-timeline/src/lib/functionSeriesPreview.ts`, `manim-timeline/src/lib/visualPlaybackPreview.ts`, `manim-timeline/src/codegen/graphCodegen.ts`, and `manim-timeline/src/codegen/targetAnimationCodegen.ts` define current expression consumers and should not require changes.
- **Python is never executed by the helper** — enforced by `manim-timeline/src/lib/mathExpressionValidation.ts`; keep checks lexical/conservative only.
- **UI-only presentation layer** — panel components should read store state and dispatch `updateItem` patches only, per layering rule in `AGENTS.md`; no shared preview/codegen math in React.
- **Existing Plot + Area pilot must not regress** — enforced by `manim-timeline/src/panels/GraphPlotEditor.tsx`, `manim-timeline/src/panels/GraphAreaEditor.tsx`, and `manim-timeline/src/lib/mathExpressionValidation.test.ts`.

### Test plan
- Add/extend `manim-timeline/src/lib/mathExpressionValidation.test.ts`:
  - `describe('validateMathExpressionPair variable contexts')` — accepts `t`, `x,y`, `n`, and `n,x` where configured and rejects out-of-context identifiers.
  - `describe('insertAtCaret')` — keep existing caret/selection coverage after profile generalization.
- From `manim-timeline/`: `npx vitest run src/lib/mathExpressionValidation.test.ts`.
- From `manim-timeline/`: `npm run test`.
- From `manim-timeline/`: `npm run build`.
- From `manim-timeline/`: `npx eslint src/lib/mathExpressionValidation.ts src/lib/mathExpressionValidation.test.ts src/panels/mathExpressionPresets.ts src/panels/MathExpressionEditor.tsx src/panels/MathExpressionDialog.tsx src/panels/GraphPlotEditor.tsx src/panels/GraphAreaEditor.tsx src/panels/GraphCurveEditor.tsx src/panels/GraphFieldEditor.tsx src/panels/FunctionSeriesEditor.tsx src/panels/PointSequenceEditor.tsx src/panels/TargetAnimationEditor.tsx src/panels/GraphFieldExpressionHelp.tsx` (omit `GraphFieldExpressionHelp.tsx` if deleted).
- Manual smoke from `manim-timeline/`: `npm run dev`; verify helper/status/modal for Graph Plot, Graph Area inline expr, Graph Curve `x(t)/y(t)`, Graph Field vector + slope, Function Series `f(n,x)`, Point Sequence `x(n)/y(n)`, and Target Animation parametric path; confirm Area existing-plot mode and Target Animation polyline path remain unchanged.

### Open questions
Empty.

## Implementation notes (editor-dev)

All five remaining expression surfaces migrated to the shared helper. No schema, store, codegen, server, or Copilot changes; every migrated editor writes the same existing `js*Expr` / `py*Expr` fields through the same `updateItem` patches as before.

- `manim-timeline/src/panels/mathExpressionPresets.ts` — added `MathExpressionProfile` (variables, help copy, placeholders, presets, snippets) plus context profiles: `PARAM_T_PROFILE` (curves), `FIELD_XY_PROFILE` + `VECTOR_XY_PRESETS` (paired whole-field P/Q replace), `SERIES_NX_PROFILE` (function series), `SEQ_N_PROFILE` (point sequences), `PATH_T_PROFILE` (path offsets, reuses parametric vocabulary with offset-specific help). Scalar `f(x)` tables kept verbatim; `SCALAR_X_PROFILE` declared last (references both tables above — an earlier placement hit TS2448 used-before-declaration, fixed by moving it to end of file).
- `manim-timeline/src/panels/MathExpressionEditor.tsx` — new optional `profile` prop overrides variables/help/placeholders/presets/snippets; explicit per-field props still win when provided. Plot + Area call sites untouched (scalar defaults preserved). Fixed a new `react-hooks/exhaustive-deps` warning about the `['x']` fallback with a module-level `DEFAULT_VARIABLES` (no inline disable, per skill guidance).
- `manim-timeline/src/panels/MathExpressionDialog.tsx` — unchanged (already fully generic over variables/presets/snippets).
- `manim-timeline/src/panels/GraphCurveEditor.tsx` — `x(t)`/`y(t)` raw inputs replaced with two `MathExpressionEditor`s (`PARAM_T_PROFILE`); local `CURVE_*_HELP` constants removed.
- `manim-timeline/src/panels/GraphFieldEditor.tsx` — vector `P`/`Q` and slope `f` raw inputs replaced with `MathExpressionEditor`s (`FIELD_XY_PROFILE`); whole-field paired presets kept as a small local button row over `VECTOR_XY_PRESETS` (one helper instance edits one pair, so P+Q-together stays at editor level).
- `manim-timeline/src/panels/GraphFieldExpressionHelp.tsx` — trimmed to the shared `GraphFieldHelpIcon` only; slope/vector preset tables and `GraphFieldPresetRow` removed (verified zero remaining importers before trimming). Still imported by Field editor header, `MathExpressionEditor`, and `MathExpressionDialog`.
- `manim-timeline/src/panels/FunctionSeriesEditor.tsx` — top-level `f(n,x)` inputs replaced with one `MathExpressionEditor` (`SERIES_NX_PROFILE`).
- `manim-timeline/src/panels/PointSequenceEditor.tsx` — `x(n)`/`y(n)` raw inputs replaced with two `MathExpressionEditor`s (`SEQ_N_PROFILE`); local help constants and icon import removed.
- `manim-timeline/src/panels/TargetAnimationEditor.tsx` — parametric path 4-input grid replaced with two side-by-side `MathExpressionEditor`s (`PATH_T_PROFILE`); `tMin`/`tMax` inputs and polyline/canvas-picking path untouched.
- `manim-timeline/src/lib/mathExpressionValidation.ts` — logic unchanged (custom `variables` contexts already supported); header docs updated from "Plot + Area pilot" to all editors.
- `manim-timeline/src/lib/mathExpressionValidation.test.ts` — new `describe('validateMathExpressionPair variable contexts')` (6 cases: accept `t`; accept `x,y`; accept `n,x`; accept lone `n`; reject out-of-context identifiers per context; `^` stays a warning outside `x`).
- `manim-timeline/src/panels/GraphPlotEditor.tsx`, `GraphAreaEditor.tsx` — untouched (no prop-wiring change needed).
- `manim-timeline/README.md` — Graph expressions section rewritten from pilot to all-editors coverage; `*Last updated:*` trailer extended.
- Deviations: none material. Slope inline preset row dropped in favor of the dialog's preset row (same formulas, now in `FIELD_XY_PRESETS` plus `−y`); vector paired presets kept inline as planned.
- Commands run (from `manim-timeline/`):
  - `npx vitest run src/lib/mathExpressionValidation.test.ts` — pass (18 tests: 12 existing + 6 new).
  - `npm run build` — pass (`tsc -b && vite build`; chunk-size warning only).
  - `npm run test` — pass (44 files, 350 tests; was 44/344).
  - `npx eslint` on all 13 touched/new source files — clean, no output.
- Left undone: in-browser smoke (`npm run dev`) across Plot, Area inline-expr + plot-source, Curve, Field vector + slope, Function Series, Point Sequence, and Target Animation parametric + polyline — no browser in this session; verifier/user should confirm. Hebrew RTL: all expression inputs/dialogs are `dir="ltr"` left-aligned (LTR math in RTL shell), same as the verified pilot; no new RTL panel surfaces added.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Focused validation tests | `cd manim-timeline; npx vitest run src/lib/mathExpressionValidation.test.ts` | pass — `Test Files  1 passed (1)` / `Tests  18 passed (18)` |
| Full frontend tests | `cd manim-timeline; npm run test` | pass — `Test Files  44 passed (44)` / `Tests  350 passed (350)` |
| Frontend build | `cd manim-timeline; npm run build` | pass — `tsc -b && vite build`; Vite completed with chunk-size warning only, `✓ built in 1.72s` |
| Touched-file lint | `cd manim-timeline; npx eslint src/lib/mathExpressionValidation.ts src/lib/mathExpressionValidation.test.ts src/panels/mathExpressionPresets.ts src/panels/MathExpressionEditor.tsx src/panels/MathExpressionDialog.tsx src/panels/GraphPlotEditor.tsx src/panels/GraphAreaEditor.tsx src/panels/GraphCurveEditor.tsx src/panels/GraphFieldEditor.tsx src/panels/FunctionSeriesEditor.tsx src/panels/PointSequenceEditor.tsx src/panels/TargetAnimationEditor.tsx src/panels/GraphFieldExpressionHelp.tsx` | pass — clean, no output |
| Working-tree scope | `git status --short`; `git diff --stat`; `git status --short -- manim-timeline/src/types/scene.ts manim-timeline/src/store manim-timeline/src/codegen measure_server.py manim-timeline/src/agent` | pass for this task — no status entries under `types/scene.ts`, `store/`, `codegen/`, `measure_server.py`, or `src/agent`; current unrelated not-in-plan files listed below |
| Static invariant review | Read diffs/contents of touched files; grep exports/importers/secrets | pass — migrated editors write existing `js*Expr`/`py*Expr` fields; `GraphFieldExpressionHelp.tsx` has one export (`GraphFieldHelpIcon`) and no removed preset-row importers; README graph section/trailer updated; no API-key patterns found |

- Out-of-scope changes found in the current working tree (files not in this handoff's "Touched files"; per user note these appear to be unrelated earlier-handoff work, not attributed to this rollout):
  - `manim-timeline/src/panels/GraphPlotExpressionHelp.tsx` (deleted in tracked diff)
  - `docs/handoffs/2026-09-11-animation-target-assignment-affordance.md` (untracked)
  - `docs/handoffs/2026-09-11-copilot-expression-helper-parity.md` (untracked)
  - `docs/handoffs/2026-09-11-uniform-math-expression-helper.md` (untracked)
- Claims in "Implementation notes" that could not be confirmed:
  - Browser smoke via `npm run dev` remains unconfirmed, as already reported by implementer.
  - `GraphPlotEditor.tsx` / `GraphAreaEditor.tsx` being untouched by this specific rollout cannot be proven from the dirty checkout because both have pre-existing pilot diffs from `HEAD`; no rollout-only schema/store/codegen/server/Copilot impact was observed.

Verdict: **pass** (status set to `docs`).
