---
slug: uniform-math-expression-helper
created: 2026-09-11
status: docs
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
Pilot a uniform math-expression authoring flow for **Graph Plot** and **Graph Area** only: both should use the same paired JS/Python expression control, compact inline validation/status, and a modal helper for larger edits with presets/snippets, variable chips, conservative syntax checks, and a one-click `^` → `**` fix. If this UX works, later handoffs can migrate Graph Curve, Graph Field, Function Series, and Point Sequence without changing the underlying project format.

### Non-goals
- Do not migrate Graph Curve, Graph Field, Function Series, or Point Sequence in this pass; leave their existing helpers/plain inputs intact.
- Do not change persisted project shape (`types/scene.ts`): existing `jsExpr`/`pyExpr` fields stay exactly where they are.
- Do not change codegen output or emitted Python expression semantics.
- Do not add a server/Python parser endpoint in this pass; Python checking is conservative client-side lint only and must never execute Python/NumPy.
- Do not add a single "math-ish" expression language in this pass; keep the explicit two-box model (`JS preview` + `Python export`).
- Do not add Copilot expression generation or provider/schema changes.
- Do not replace the canvas/export evaluators; only centralize Plot/Area authoring helpers and validation messages.

### Touched files

**types/**
- No planned changes. Keep `GraphPlotItem`, `GraphAreaItem`, and `GraphAreaCurveSource` persisted shapes unchanged in `manim-timeline/src/types/scene.ts`.

**lib/**
- `manim-timeline/src/lib/mathExpressionValidation.ts` (new) — pure, UI-independent helpers for Plot/Area scalar `f(x)` expression specs: JS compilation check, variable allowlist (`x` plus known JS/Python namespace names), conservative Python lint (no execution), paired status objects (`ok` / warning / error), and a pure `replaceCaretRange` / `replacePowerOperator` helper if needed by UI tests.
- `manim-timeline/src/lib/mathExpressionValidation.test.ts` (new) — unit coverage for scalar `x` validation only: valid JS/Python pair, JS syntax errors, empty JS/Python errors, disallowed variables, conservative Python warnings/errors, and `^` warning + fix behavior.

**UI**
- `manim-timeline/src/panels/MathExpressionEditor.tsx` (new) — reusable paired expression control for scalar `f(x)`: JS preview input, Python export input, compact inline status, help copy, `Fix ^` action when relevant, and "Open helper" button.
- `manim-timeline/src/panels/MathExpressionDialog.tsx` (new) — modal helper opened from the editor with larger text boxes, scalar presets/snippets, variable chip for `x`, syntax/status panel, Apply/Cancel, and focus-preserving paired snippet insertion.
- `manim-timeline/src/panels/mathExpressionPresets.ts` (new) — move/copy the existing Graph Plot scalar presets/snippets into a shared catalog usable by Plot and Area.
- `manim-timeline/src/panels/GraphPlotEditor.tsx` — replace bespoke `GraphPlotExprAssist` wiring with `MathExpressionEditor` for `fn.jsExpr` / `fn.pyExpr`, preserving existing labels/help meaning and update path.
- `manim-timeline/src/panels/GraphAreaEditor.tsx` — use `MathExpressionEditor` for `GraphAreaCurveSource` values when `sourceKind: 'expr'` (under-curve `curve`, between-curves `lower`/`upper`); preserve existing `sourceKind: 'plot'` dropdown behavior and do not show expression controls for plot sources.
- `manim-timeline/src/panels/GraphPlotExpressionHelp.tsx` — delete after Plot migration if no imports remain, or reduce to temporary re-exports only if necessary during the patch.
- `manim-timeline/src/panels/GraphFieldExpressionHelp.tsx` — do not migrate/delete; it is still used by Graph Field and should remain unchanged except for import cleanup if `GraphPlotExpressionHelp.tsx` no longer imports it.
- `manim-timeline/src/index.css` — modal/popup sizing and any shared helper status styles, if Tailwind utility classes are not enough.

**store/**
- No planned changes. All updates continue through existing `updateItem` calls from panel editors.

**codegen/**
- No planned changes. Existing codegen consumes persisted `pyExpr` values as before.

**server**
- No planned changes.

**docs**
- `manim-timeline/README.md` — document the Plot/Area expression-helper pilot and extend the `*Last updated:*` trailer after verification.
- `docs/handoffs/2026-09-11-uniform-math-expression-helper.md` — implementation/verifier notes appended by later roles.

### Invariants at risk
- Plot/Area preview/export dialect split must remain intact: `fn.jsExpr` and inline `GraphAreaCurveSource.jsExpr` drive canvas preview, while `fn.pyExpr` and inline `GraphAreaCurveSource.pyExpr` drive Manim export. Current consumers are `manim-timeline/src/canvas/layers/GraphNode.tsx` and `manim-timeline/src/codegen/graphCodegen.ts`; this task must not change their semantics.
- Persisted project schema must not change: `PROJECT_VERSION` and migrations in `manim-timeline/src/types/scene.ts` / `manim-timeline/src/lib/migrateProjectToV*.ts` must remain untouched.
- Expression updates must remain ordinary editor updates, not hidden transformations: `manim-timeline/src/panels/GraphPlotEditor.tsx` and `manim-timeline/src/panels/GraphAreaEditor.tsx` dispatch through `manim-timeline/src/store/useSceneStore.ts` `updateItem`; dialog Apply/Cancel must mutate only the targeted expression pair and never unrelated fields.
- Existing Graph Plot caret insertion behavior should not regress: currently in `manim-timeline/src/panels/GraphPlotExpressionHelp.tsx`; the shared modal/control must preserve insertion-at-caret for paired JS/Python snippets.
- Graph Area plot-source mode must remain supported: `manim-timeline/src/panels/GraphAreaEditor.tsx` and `manim-timeline/src/canvas/layers/GraphNode.tsx` allow `GraphAreaCurveSource` to be either an existing plot or inline expr; the helper applies only to inline expr sources.
- Other math-expression editors must remain untouched in behavior: `manim-timeline/src/panels/GraphCurveEditor.tsx`, `manim-timeline/src/panels/GraphFieldEditor.tsx`, and `manim-timeline/src/panels/FunctionSeriesEditor.tsx` should not be refactored in this pilot.
- No generated Manim text/axes invariants are touched: codegen still must avoid `Text`/`Tex`/`MathTex` and axes ranges stay explicit where generated, enforced by `.cursor/rules/manim-text-and-point-accuracy.mdc`, `.cursor/rules/manim-axes-domain.mdc`, and existing codegen tests.

### Test plan
- Add `manim-timeline/src/lib/mathExpressionValidation.test.ts` with `describe('validateMathExpressionPair')` covering scalar Plot/Area expressions:
  - valid pair: `Math.sin(x)` / `np.sin(x)` passes;
  - JS syntax errors (`Math.sin(` or `(((('`) are errors;
  - empty JS or Python expression is an error;
  - disallowed variables are flagged for scalar `x` context (for example `y + x` or `t`);
  - common namespace/function identifiers are allowed (`Math.sin`, `Math.PI`, `np.sin`, `np.pi`) without being mistaken for variables;
  - Python lint is conservative and never executes Python/NumPy;
  - `^` is a non-blocking warning with copy that explains `**`, and `replacePowerOperator` (or equivalent pure helper) converts `x^2` to `x**2`.
- Add pure tests for caret/snippet insertion if implemented outside React, for example `describe('insertPairedSnippet')` in `manim-timeline/src/lib/mathExpressionValidation.test.ts` or `manim-timeline/src/panels/mathExpressionPresets.test.ts`.
- Do not add/modify codegen tests unless emitted Python unexpectedly changes; if it does, stop and re-plan because this pilot should be UI-only.
- Exact commands from `manim-timeline/`:
  - `npx vitest run src/lib/mathExpressionValidation.test.ts`
  - `npm run test`
  - `npm run build`
  - `npx eslint src/lib/mathExpressionValidation.ts src/lib/mathExpressionValidation.test.ts src/panels/MathExpressionEditor.tsx src/panels/MathExpressionDialog.tsx src/panels/mathExpressionPresets.ts src/panels/GraphPlotEditor.tsx src/panels/GraphAreaEditor.tsx src/panels/GraphPlotExpressionHelp.tsx src/index.css`
- Manual UI smoke from `manim-timeline/` with `npm run dev`:
  - Graph Plot: compact inline status appears; helper modal opens; presets replace both boxes; snippets insert at caret; valid expression shows OK; invalid JS shows error; `x^2` shows warning and quick-fix changes both boxes to `x**2` where applicable.
  - Graph Area: under-curve and between-curves inline expr sources expose the same helper for `curve`/`lower`/`upper`; existing plot-source dropdown still works and does not show irrelevant expression controls.
  - Regression spot-check: Graph Curve, Graph Field, and Function Series panels still open and their existing expression inputs/helpers are unchanged.

### Open questions
Empty. User accepted the v1 direction: compact inline status + modal helper, two explicit dialect boxes, conservative client-side Python lint, `^` warning with quick fix, and **Plot + Area only** before expanding to the rest.

## Implementation notes (editor-dev)

Plot + Area pilot implemented per plan; no schema, codegen, server, or Copilot changes.

- `manim-timeline/src/lib/mathExpressionValidation.ts` (new) — pure shared validation: `validateMathExpressionPair({ jsExpr, pyExpr, variables })` returns `{ level: ok|warning|error, issues[], hasPowerCaret }`. Real `new Function` compile for JS (syntax errors are errors); conservative Python lint only (balanced brackets, JS-ism detection for `===`/`&&`/`||`/`Math.`, bare-identifier allowlist of variables + `np`/`numpy`/`math`/`abs`/`min`/`max`/`pow`/`round`) that never executes anything; dot-properties skipped so `Math.sin`/`np.pi` don't count as variables; `^` always a non-blocking warning with `fix: 'power'`. Also pure `replacePowerOperator` and caret-aware `insertAtCaret` helpers.
- `manim-timeline/src/lib/mathExpressionValidation.test.ts` (new) — `describe('validateMathExpressionPair')` (9 cases: valid pair, namespace members, JS syntax errors, empty errors, disallowed vars, JS-tokens-in-Python, unbalanced Python brackets, `^` warning + fix, `^`-as-warning-only) plus `describe('insertAtCaret')` (3 cases). 12 tests.
- `manim-timeline/src/panels/mathExpressionPresets.ts` (new) — scalar `f(x)` catalog moved verbatim from the old plot helper (`SCALAR_X_FORMULA_PRESETS`, `SCALAR_X_INSERT_SNIPPETS`, section/JS/Py help strings).
- `manim-timeline/src/panels/MathExpressionEditor.tsx` (new) — compact paired control: two explicit LTR inputs (JS preview + Python export), inline status badge (first issue + overflow count), one-click `Fix: ^ → **` when relevant, and an `Open helper` modal button. Presentation only; state flows through parent `onChange`. Help icons reuse existing `GraphFieldHelpIcon`.
- `manim-timeline/src/panels/MathExpressionDialog.tsx` (new) — modal built on the existing `FloatingPanel` primitive (draggable, `defaultSize 560×560`): draft textareas, live status panel, `^` fix, `x` variable chip inserting into the focused box, preset row (replace both), snippet row (paired caret insertion via element selection + `insertAtCaret`, caret/focus restored with `requestAnimationFrame`), Apply (commits both boxes together) / Cancel (discards). Never touches the store; parent applies via `onApply`. All text `dir="ltr"` left-aligned.
- `manim-timeline/src/panels/GraphPlotEditor.tsx` — expression section replaced with `MathExpressionEditor` for `fn.jsExpr`/`fn.pyExpr` via the existing `patchFnExpr` update path. Removed refs/focus bookkeeping and old helper imports.
- `manim-timeline/src/panels/GraphAreaEditor.tsx` — inline-expr branch of `curveSourceEditor` (under-curve `curve`, between-curves `lower`/`upper`) now renders `MathExpressionEditor` with per-source dialog title; `sourceKind: 'plot'` dropdown path untouched, no expression controls for plot sources.
- `manim-timeline/src/panels/GraphPlotExpressionHelp.tsx` — deleted (no remaining imports; catalog moved to `mathExpressionPresets.ts`).
- `manim-timeline/src/panels/GraphFieldExpressionHelp.tsx` — untouched (still used by Field/Curve editors).
- `manim-timeline/README.md` — new `### Graph expressions (Plot + Area pilot)` subsection plus `*Last updated:*` trailer extension.
- Deviations: (1) removed a needless `eslint-disable` for `no-new-func` in the new lib file (rule not enabled → unused-directive warning). (2) Did not touch `src/index.css` — Tailwind utilities covered the modal; no global styles needed. (3) No `MathExpressionEditor.test.tsx` — insertion/status logic is pure and covered in lib tests; no component-test setup exists in the repo.
- Commands run (from `manim-timeline/`):
  - `npx vitest run src/lib/mathExpressionValidation.test.ts` — pass (12 tests; one self-authored caret-offset expectation fixed: `x` + `**2` → caret 4).
  - `npm run build` — pass (`tsc -b && vite build`; chunk-size warning only).
  - `npm run test` — pass (44 files, 344 tests; was 43/332).
  - `npx eslint` on all 7 touched/new source files — clean, no output.
- Left undone: in-browser smoke (`npm run dev` at Plot/Area panels) — no browser in this session; verifier/user should confirm presets replace both boxes, snippets insert at caret, `x^2` warns + quick-fixes, and Area plot-source mode still hides expression controls. No API keys written anywhere.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Targeted validation tests | `npx vitest run src/lib/mathExpressionValidation.test.ts` (from `manim-timeline/`) | pass — `Test Files  1 passed (1)` / `Tests  12 passed (12)` |
| Full frontend tests | `npm run test` (from `manim-timeline/`) | pass — `Test Files  44 passed (44)` / `Tests  344 passed (344)` |
| Frontend build | `npm run build` (from `manim-timeline/`) | pass — `tsc -b && vite build`; Vite completed `✓ built in 2.12s` (chunk-size warning only) |
| ESLint touched source files | `npx eslint src/lib/mathExpressionValidation.ts src/lib/mathExpressionValidation.test.ts src/panels/MathExpressionEditor.tsx src/panels/MathExpressionDialog.tsx src/panels/mathExpressionPresets.ts src/panels/GraphPlotEditor.tsx src/panels/GraphAreaEditor.tsx` (from `manim-timeline/`) | pass — command produced no output |
| Working-tree scope | `git status --short`; `git diff --stat`; `git ls-files --others --exclude-standard` | pass — changed/untracked files are README, this handoff, Plot/Area editors, deleted Plot helper, and the new lib/UI helper files listed in Touched files |
| Static invariant checks | diff/read touched files once; `grep` for `GraphPlotExpressionHelp`; scoped `git diff --name-only` over excluded layers | pass — no diff in `types/scene.ts`, `store/`, `codegen/`, `measureClient.ts`, `measure_server.py`, or `src/agent`; no remaining Plot-helper imports; GraphField/Curve/FunctionSeries files unchanged; README trailer extended; no API-key literals found in touched files |

- Out-of-scope changes found in the diff (files not in "Touched files"): none for this task. `src/index.css` was planned as optional but is untouched.
- Claims in "Implementation notes" that could not be confirmed: in-browser manual smoke was explicitly not run in the implementation notes and was not repeated here; static review confirms the dialog keeps draft state and only `Apply` calls parent `onApply({ jsExpr, pyExpr })`, while `Cancel` calls `onClose`.

Verdict: **pass** — required gates are green and the diff stays within the Plot + Area expression-helper pilot scope.
