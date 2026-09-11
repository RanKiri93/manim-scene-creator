---
slug: animation-target-assignment-affordance
created: 2026-09-11
status: blocked
owner_role: editor-dev
next_tool: any
source: user request
---

## Plan (architect)

### Goal
Order **3 of 3**, after the user chooses the desired UX. Explore a graph-axes-style assignment affordance for animations, so users can confidently see and control which object(s) an Exit/Blink/Target Animation will target before or immediately after insertion, analogous to graph objects using the selected/default axes.

### Non-goals
- Do not implement until the open UX questions below are answered.
- Do not change animation semantics, persisted schema, target eligibility rules, frame scoping, or codegen.
- Do not replace existing target dropdowns in `ExitAnimationEditor`, `BlinkAnimationEditor`, or `TargetAnimationEditor`; any first pass should reuse them.
- Do not include Copilot behavior in this handoff.

### Touched files
#### lib/
- `manim-timeline/src/lib/time.ts` — should remain unchanged; target eligibility helpers (`canBeExitTarget`, `canBeBlinkTarget`, `canBeTargetAnimationTarget`) are invariants to reuse, not rewrite.
- `manim-timeline/src/lib/targetScope.ts` — reuse existing same-frame filtering/labels for any target summary or selector; change only if a chosen UX exposes a missing pure helper.

#### hooks/store boundary
- `manim-timeline/src/hooks/useAddSceneItems.ts` — likely target for insertion-time selection/default-target behavior if the chosen UX changes how animation buttons pick targets; preserve current fallback behavior and same-frame filtering.

#### UI
- `manim-timeline/src/panels/AddObjectToolbar.tsx` — likely place for a graph-axes-like “will target …” summary, active/dimmed animation button state, or optional target-lock chip.
- `manim-timeline/src/panels/ExitAnimationEditor.tsx` — may receive shared target-summary affordance after insertion; existing scope dropdown and object rows must remain.
- `manim-timeline/src/panels/BlinkAnimationEditor.tsx` — may receive shared target-summary affordance after insertion; existing segment/math-subtarget controls must remain.
- `manim-timeline/src/panels/TargetAnimationEditor.tsx` — may receive shared target-summary affordance after insertion; mode-specific controls and parametric path editor must remain.
- `manim-timeline/src/panels/AnimationTargetSummary.tsx` (new, optional) — small reusable presentation component if the chosen UX needs the same target chip/list in multiple editors.

#### docs
- `manim-timeline/README.md` — document any user-visible insertion/target-selection behavior and extend the `*Last updated:*` trailer after implementation.
- `docs/handoffs/2026-09-11-animation-target-assignment-affordance.md` — implementation notes and verification will be appended by later roles only.

### Invariants at risk
- **Eligible target rules** — `manim-timeline/src/lib/time.ts` defines `canBeExitTarget`, `canBeBlinkTarget`, and `canBeTargetAnimationTarget`; UI must not allow invalid targets.
- **Frame-scoped target picking** — `manim-timeline/src/lib/targetScope.ts` and `manim-timeline/src/hooks/useAddSceneItems.ts` enforce same-frame candidate selection; any new affordance must not accidentally target an object on another frame unless user opts into all-frame scope.
- **Minimum animation start times** — `minExitStartTimeForClip`, `minBlinkStartTimeForClip`, and `minTargetAnimationStartTimeForClip` in `manim-timeline/src/lib/time.ts` plus editor `onTargetChange` handlers clamp starts; target reassignment must keep this.
- **Persisted target shape** — `manim-timeline/src/types/scene.ts` stores target rows on the animation clips; avoid schema/migration changes unless a later explicit plan chooses a persisted target-lock feature.
- **By-object grouping** — `manim-timeline/src/lib/itemRelations.ts` / Items panel grouping depend on target ids; target updates must remain reflected there.

### Test plan
- After UX selection, add/extend tests around the actual pure behavior touched. Likely files:
  - `manim-timeline/src/lib/targetScope.test.ts` (new if pure same-frame helper changes are needed).
  - `manim-timeline/src/lib/time.test.ts` only if target eligibility/min-start helpers change (not expected for recommended v1).
- From `manim-timeline/`: `npm run test`.
- From `manim-timeline/`: `npm run build`.
- From `manim-timeline/`: `npx eslint src/lib/targetScope.ts src/hooks/useAddSceneItems.ts src/panels/AddObjectToolbar.tsx src/panels/ExitAnimationEditor.tsx src/panels/BlinkAnimationEditor.tsx src/panels/TargetAnimationEditor.tsx src/panels/AnimationTargetSummary.tsx` (omit files untouched/not created).
- Manual smoke from `manim-timeline/`: `npm run dev`; verify no selection, single selection, multi-selection, invalid selection, and cross-frame cases for Exit, Blink, Target scale/color/move/path/rotate, plus post-insertion target dropdown reassignment and min-start clamping.

### Open questions
- Which UX should v1 implement?
  1. **Selection-driven clarity** (smallest): keep current behavior but make it as explicit as graph axes — toolbar says “Will target: …”, buttons show compatible target count, invalid selections explain fallback, and created clips open with target chips.
  2. **Target lock**: add an explicit “Animation target: selected object(s)” chip/dropdown in the Insert sidebar that animation buttons use until changed. This may need transient UI state but should stay non-persisted.
  3. **Choose-on-click**: animation button opens a small target picker before creating the clip.
- Should the affordance apply to **Exit + Blink + all Target Animation modes + Surrounding Rect**, or only `target_animation` modes?
- Should multi-target creation remain automatic from multi-select, or should v1 force a single primary target unless the user explicitly opts into multiple targets?
