---
slug: copilot-expression-helper-parity
created: 2026-09-11
status: docs
owner_role: copilot-dev
next_tool: any
source: user request
---

## Plan (architect)

### Goal
Order **2 of 3**, after `2026-09-11-math-expression-helper-rollout.md` is implemented or its final expression profiles are known. Make the AI Assistant reliably create and update the same paired-expression fields the UI helper exposes: graph plots `f(x)`, graph curves `x(t)/y(t)`, function series `f(n,x)`, point sequences `x(n)/y(n)`, and target-animation parametric paths `x(t)/y(t)`, always with correct JS/Python dialects and `**` power.

### Non-goals
- Do not add `graphArea` or `graphField` to `AGENT_ALLOWED_KINDS`; they remain UI-only creations unless the user explicitly requests a separate Copilot kind expansion.
- Do not change persisted scene schema, migrations, store factories, preview, or codegen.
- Do not call live LLM APIs or write API keys to files.
- Do not make the agent aware of the helper modal as a UI interaction; the model emits scene actions only.

### Touched files
#### agent/
- `manim-timeline/src/agent/systemPrompt.ts` — update expression guidance so every agent-supported expression context names its exact fields, variables, JS/Python examples, and `**` power rule; include target-animation parametric path guidance if incomplete.
- `manim-timeline/src/agent/validate.ts` — ensure validator/repair coverage for expression-pair CREATE and UPDATE payloads is consistent across supported kinds, including `^` → `**`, single-dialect derivation where already intended, and no silent defaults where strictness is required.
- `manim-timeline/src/agent/validate.test.ts` — add focused tests for target-animation parametric-path expression repair/update behavior and any missing graphCurve/pointSequence/functionSeries expression UPDATE parity.
- `manim-timeline/src/agent/providers/gemini.ts` — keep Gemini’s flat schema descriptions in sync with the prompt for all supported expression fields, especially `curve.*Expr`, point-sequence coordinate fields, and `target_animation.targets[].parametricPath.*Expr`.
- `manim-timeline/src/agent/types.ts` — update only if canonical schema descriptions/enums need synchronized wording; do not change `AGENT_ALLOWED_KINDS` for this handoff.
- `manim-timeline/src/agent/ARCHITECTURE.md` — document the expression contexts and repair rules after implementation so docs match validator behavior.

#### docs
- `manim-timeline/README.md` — if user-visible Copilot behavior changes are described there, extend the `*Last updated:*` trailer; otherwise leave README docs to docs-keeper.
- `docs/handoffs/2026-09-11-copilot-expression-helper-parity.md` — implementation notes and verification will be appended by later roles only.

### Invariants at risk
- **Allowed-kind boundary** — `manim-timeline/src/agent/types.ts` and `manim-timeline/src/agent/validate.ts` enforce `AGENT_ALLOWED_KINDS`; `graphArea` / `graphField` must remain non-created.
- **Canonical vs Gemini schema parity** — `manim-timeline/src/agent/types.ts` and `manim-timeline/src/agent/providers/gemini.ts` must evolve together if any schema-level fields/descriptions change.
- **Validator must enforce/repair, not prompt-only** — `manim-timeline/src/agent/validate.ts` is the source of truth for accepted actions; tests in `manim-timeline/src/agent/validate.test.ts` must cover new repair promises.
- **Commit deep-merge for nested expression patches** — `manim-timeline/src/agent/commit.ts` currently preserves nested graph/function-series/point-sequence updates; do not break per-action fresh `useSceneStore.getState()` behavior.
- **Effect clips follow targets, not frames** — `manim-timeline/src/agent/validate.ts` / `manim-timeline/src/lib/frameGrid.ts` behavior must remain: no `frameId` on `target_animation`.
- **No API keys** — provider keys stay in browser `localStorage`; no key literals in agent files.

### Test plan
- Add/extend `manim-timeline/src/agent/validate.test.ts`:
  - `describe('expression pair normalization')` — graphCurve, graphFunctionSeries, graphPointSequence, and target_animation parametric path use `**`, derive the missing dialect where supported, and reject missing required coordinate pairs.
  - `describe('expression pair UPDATE normalization')` — updates to supported expression fields normalize without dropping unrelated nested fields.
  - `describe('allowed kind boundary')` — `graphArea` and `graphField` CREATEs are still rejected.
- From `manim-timeline/`: `npx vitest run src/agent`.
- From `manim-timeline/`: `npm run build`.
- From `manim-timeline/`: `npx eslint src/agent/systemPrompt.ts src/agent/validate.ts src/agent/validate.test.ts src/agent/providers/gemini.ts src/agent/types.ts src/agent/ARCHITECTURE.md`.
- Optional manual smoke from `manim-timeline/`: `npm run dev`; with a live key kept only in the browser, ask for a graph curve, function series, point sequence, and path target animation using caret-style powers (for example “x squared” / `x^2`) and confirm preview actions validate with paired JS/Python fields.

### Open questions
Empty.

## Implementation notes (copilot-dev)

Audit found three real gaps: the prompt never documented `graphPointSequence` or `target_animation` creation, the Gemini flat schema had no point-sequence or TA-path fields (Gemini ignores undeclared properties, so it could never emit them), and UPDATEs to plot `fn` / curve `curve` / TA `parametricPath` passed through with no `^` repair. All closed below. No schema, store-shape, preview, or codegen changes; `AGENT_ALLOWED_KINDS` untouched (`graphArea`/`graphField` stay UI-only).

- `manim-timeline/src/agent/systemPrompt.ts` — rule 4 now lists `graphPointSequence` in the `axesId` requirement; rule 5a2 gained the `**`-never-`^` rule plus dialect examples and the repair promise; new rule 5a3 documents expression UPDATE shapes and the preserve-siblings guarantee; new rule 8c documents the full `graphPointSequence` workflow with a minimal CREATE example; new rule 10b documents the `target_animation` workflow (modes, per-row fields, parametric `parametricPath` shape, `startTime` rule, no `frameId`) with a path example. textLine rules untouched.
- `manim-timeline/src/agent/validate.ts` — new `repairParametricAxis` helper (`^` → `**` + single-dialect derivation, null when both sides absent); `normalizeTargetAnimation` uses it per axis (both-missing axes keep the `'0'` default); new `resolveCurveAxisFromPatch` (curve-first, then top-level/alias fold, one-dialect-per-axis strictness like point sequences); `normalizeUpdates` gained three branches: `graphPlot.fn` (alias rescue + derivation; color-only patches untouched so no sine default is invented), `graphCurve.curve` (repair + top-level alias folding with dead-key cleanup, unrelated curve fields pass through), `target_animation.targets` (per-row `parametricPath` axis repair, everything else untouched).
- `manim-timeline/src/agent/commit.ts` — new `mergeTargetAnimationUpdates`: rows matched by `targetId`, patch row spreads over the stored row, patch `parametricPath` spreads over the stored one. Without this, a repaired single-axis path UPDATE would wipe the sibling axis at commit (validator normalizes, commit preserves — same split as curve/series/sequence). Per-action fresh `getState()` kept.
- `manim-timeline/src/agent/providers/gemini.ts` — `axesId` + item bullets cover `graphPointSequence`; new TA-path bullet; `curve.*Expr` gained `t`/example/`**` descriptions; new top-level `jsXExpr`/`pyXExpr`/`jsYExpr`/`pyYExpr` (point sequences); `nMin`/`nMax`/`mode` descriptions cover sequences and `mode` enum adds the five TA modes; `targets[]` rows gained `color`/`dx`/`dy`/`angleDeg`/`pathKind`/`pathPoints`/`parametricPath` (7 sub-fields) with `scaleFactor` extended to TA scale; `updates` description documents the expression-repair promise.
- `manim-timeline/src/agent/types.ts` — untouched: the canonical schema is permissive (`additionalProperties: true` on `item`/`updates`) with no per-field expression wording to sync, so no skew.
- `manim-timeline/src/agent/validate.test.ts` — new `describe('expression pair normalization')` (5: curve `^`+derivation, curve missing-axis rejection, sequence `^`+derivation, TA path `^`+derivation, TA all-missing `0` defaults), `describe('expression pair UPDATE normalization')` (5: plot `fn` repair + color preserved, curve nested repair + color preserved, curve top-level fold + dead-key removal, TA path repair + row fields preserved with untouched axes absent, sequence axis repair), `describe('allowed kind boundary')` (2: `graphArea`/`graphField` CREATEs rejected — duplicates the older inline assertions deliberately per plan).
- `manim-timeline/src/agent/commit.test.ts` — new `describe('commitActions — target_animation row merge')`: partial `parametricPath` UPDATE preserves the sibling `y(t)` axis, `tMin`/`tMax`, and `pathKind` end to end.
- `manim-timeline/src/agent/ARCHITECTURE.md` — §7.4 extended with the other three contexts + a full UPDATE-parity paragraph (normalizer + commit merges); §8 checklist updated (rule 4 all five axes kinds; new 5a2/5a3/8c/10b entries).
- `manim-timeline/README.md` — Copilot section gained the expression-parity bullet; `*Last updated:*` trailer extended.
- Deviations: (1) added the `commit.ts` TA merge — not explicitly listed in Touched files but required by the plan's own "without dropping unrelated nested fields" test once validator repair produces single-axis path patches; (2) `commit.test.ts` touched for the same reason; (3) kept `graphPlot` UPDATE sine-default out (guard requires non-empty expression content, stricter than the series path — no existing behavior changed since plot UPDATEs were previously unrepaired).
- Commands run (from `manim-timeline/`):
  - `npx vitest run src/agent` — pass (4 files, 73 tests).
  - `npm run build` — pass (`tsc -b && vite build`; chunk-size warning only).
  - `npm run test` — pass (44 files, 363 tests; was 44/350, +13).
  - `npx eslint` on the 7 touched source files — clean (ARCHITECTURE.md passed as arg is ignored by config, same as before).
- Left undone: live-model smoke (`npm run dev` + browser key asking for curve/series/sequence/path-TA with `^` powers) — no browser or keys in this session; verifier/user should confirm. No API keys written anywhere.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Agent vitest | `cd manim-timeline; npx vitest run src/agent` | pass — `Test Files  4 passed (4)` / `Tests  73 passed (73)` |
| Full frontend vitest | `cd manim-timeline; npm run test` | pass — `Test Files  44 passed (44)` / `Tests  363 passed (363)` |
| Frontend build | `cd manim-timeline; npm run build` | pass — `tsc -b && vite build`; Vite ended `✓ built in 1.90s` with chunk-size warning only |
| Scoped eslint | `cd manim-timeline; npx eslint src/agent/systemPrompt.ts src/agent/validate.ts src/agent/validate.test.ts src/agent/providers/gemini.ts src/agent/types.ts src/agent/commit.ts src/agent/commit.test.ts` | pass — clean (no output) |
| Working-tree scope | `git status --short; git diff --stat` | pass with noted unrelated WIP — task files in agent/docs changed; `commit.ts`/`commit.test.ts` deviation is tested; unrelated panel/lib/handoff files are present outside this task |
| Static invariants | Read diffs/contents once; grep checks for allowed kinds/schema/getState/secrets/docs | pass — `AGENT_ALLOWED_KINDS` still excludes `graphArea`/`graphField`; `types.ts` canonical schema remains `additionalProperties: true`; textLine rules intact; `commit.ts` re-reads `getState()` per action; no secret-key literals found; README/ARCHITECTURE updates present |

- Out-of-scope changes found in the diff (files not in "Touched files"):
  - Intentional, sound deviation for this task: `manim-timeline/src/agent/commit.ts`, `manim-timeline/src/agent/commit.test.ts`; verified the merge preserves `target_animation.targets[].parametricPath` sibling fields and is covered by `commitActions — target_animation row merge`.
  - Pre-existing unrelated working-tree changes visible in `git status` / `git diff --stat`, not attributed to this task per verifier instructions: `manim-timeline/src/panels/FunctionSeriesEditor.tsx`, `GraphAreaEditor.tsx`, `GraphCurveEditor.tsx`, `GraphFieldEditor.tsx`, `GraphFieldExpressionHelp.tsx`, `GraphPlotEditor.tsx`, deleted `GraphPlotExpressionHelp.tsx`, `PointSequenceEditor.tsx`, `TargetAnimationEditor.tsx`; untracked helper/lib and other handoff files also remain present.
- Claims in "Implementation notes" that could not be confirmed:
  - Live-model/browser smoke was not run (no browser/API key); implementation already marked it left undone.
  - I cannot independently attribute the unrelated panel/lib working-tree changes to earlier handoffs, but no task-scope diff was found in `types/scene.ts`, `store/`, `codegen/`, or `measure_server.py`.

Verdict: **pass**.
