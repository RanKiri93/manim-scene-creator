---
slug: collapsible-insert-sidebar
created: 2026-09-10
status: docs
owner_role: editor-dev
next_tool: cursor
source: user request
---

## Plan (architect)

### Goal
Replace the current narrow icon-only add toolbar with a Photoshop-style left insert sidebar that defaults to expanded labeled buttons, can collapse to icon-only mode, separates Objects from Animations, keeps graph tools discoverable, and moves audio entry points out of the object/animation insert surface.

### Non-goals
Do not change item creation semantics, default object properties, timeline timing rules, generated Manim code, persisted project schema, audio upload/record/TTS behavior, or the measure server. Contextual shortcuts/palette commands are future work; this task may add visual contextual emphasis only, not new keyboard shortcuts.

### Touched files
- UI
  - `manim-timeline/src/App.tsx` — manage expanded/collapsed insert-sidebar state, default to expanded, persist the user's collapsed preference in `localStorage`, pass state into the toolbar, adjust sidebar width/resizer behavior, and add/move the separate audio entry point outside the object/animation insert groups if needed.
  - `manim-timeline/src/panels/AddObjectToolbar.tsx` — convert the toolbar into a labeled insert sidebar with a collapse/expand control, collapsed icon-only rendering, separate Objects/Graph/Animations sections, contextual animation-section emphasis when compatible items are selected, and graph helper text explaining which axes will be used/created.
  - `manim-timeline/src/hooks/useAddSceneItems.ts` — keep as the action boundary; touch only if the toolbar needs exported metadata helpers while preserving the existing `add*` behavior exactly.
- store
  - No store changes planned.
- types/
  - No persisted schema changes planned.
- lib/
  - No shared timing/layout changes planned. Existing eligibility helpers may be imported by UI but should not be modified.
- codegen/
  - No codegen changes planned.
- server
  - No server changes planned.
- docs
  - `docs/handoffs/2026-09-10-collapsible-insert-sidebar.md` (new) — implementation handoff for the agreed UI direction.
  - `manim-timeline/README.md` — update the creation-workflow text/trailer only if the implemented UI changes documented wording such as `+ Object → Exit animation`.

### Invariants at risk
- New items must still be created at the current playhead; enforced by `manim-timeline/src/hooks/useAddSceneItems.ts` (`currentTime` passed into `create*` factories) and `manim-timeline/src/store/factories.ts`.
- Graph inserts must keep current axes behavior: selected axes first, otherwise existing/default axes, and auto-create axes when none exists; enforced by `pickDefaultAxesId` / `ensureAxesId` in `manim-timeline/src/hooks/useAddSceneItems.ts`.
- Exit/blink/target animation inserts must keep selected eligible targets first, same-frame fallback candidates second, and current start-time snapping; enforced by `addExitAnimationClip`, `addBlinkAnimationClip`, and `addTargetAnimationClip` in `manim-timeline/src/hooks/useAddSceneItems.ts`, with eligibility/time helpers in `manim-timeline/src/lib/time.ts` and `manim-timeline/src/lib/targetScope.ts`.
- Collapsing the sidebar must be UI-only and must not enter project files; enforced by keeping the preference in `localStorage` in `manim-timeline/src/App.tsx`, not in `manim-timeline/src/types/scene.ts` / project migrations.
- Accessibility for icon-only mode must preserve explicit labels/tooltips; enforced by `aria-label` / `title` on buttons in `manim-timeline/src/panels/AddObjectToolbar.tsx`.
- Audio behavior must remain unchanged when moved out visually; enforced by `setAudioMode` calls exposed through `manim-timeline/src/hooks/useAddSceneItems.ts` and the existing `AudioPanel` rendering in `manim-timeline/src/App.tsx`.

### Test plan
- Existing area-specific tests: none found for `AddObjectToolbar`, `useAddSceneItems`, or toolbar components (`manim-timeline/src/**/*{AddObjectToolbar,useAddSceneItems,Toolbar}.test.{ts,tsx}` returned no files). No new test file is required unless behavior moves out of presentation into pure helpers.
- From `manim-timeline/`: `npm run build`
- From `manim-timeline/`: `npm run test` (existing suite, including `src/store/useSceneStore.audioBinding.test.ts`, `src/store/useProjectScenesStore.test.ts`, `src/lib/time.test.ts`, and related store/lib/codegen tests)
- From `manim-timeline/`: `npm run lint`
- Manual UI smoke at `http://localhost:5173/`:
  - Fresh load: insert sidebar is expanded by default and shows text labels.
  - Collapse button switches to icon-only mode; all insert buttons remain visible/reachable with tooltips/accessible labels.
  - Reload after collapse/expand preserves the user's sidebar preference.
  - Expanded mode can still be resized if the implementation keeps resizing; collapsed mode should use a fixed compact width or hide/disable resizing.
  - Add Text line, Axes, Shape at the current playhead.
  - Graph section remains visible with helper text; adding Plot with no axes still creates/uses axes as before, and adding Plot with an axes selected uses that axes.
  - Select a drawable item; Animations section becomes visually emphasized/selection-aware, and Exit/Blink/Target animation actions still target the selection and snap timing as before.
  - Audio controls are visually separate from Objects/Animations and still open Record, Upload, and TTS flows.

### Open questions
None. User chose: left sidebar placement, default expanded with labels, collapsible icon-only mode, Objects and Animations separated, selected-object animation emphasis, graph tools visible with explanatory state, and audio separated from object/animation controls.

## Implementation notes (editor-dev)

- `manim-timeline/src/panels/AddObjectToolbar.tsx`
  - Toolbar is now an `Insert` sidebar: header with title + collapse/expand toggle (`«`/`»`, `aria-expanded`, tooltips), default expanded with icon + text-label buttons, collapsed icon-only mode with full `title`/`aria-label` tooltips.
  - Sections reorganized to Objects (Text line, Axes, Shape, Surrounding rect), Graph (uses axes), Animations (Exit, Blink, Scale, Color, Move, Path, Rotate, Camera pan). Audio removed from this surface.
  - Selection-aware animation emphasis: header shows `Animations · <name>` / `for selection`, highlighted container in expanded mode, per-button active (blue) / dimmed states derived read-only from `canBeExitTarget` / `canBeBlinkTarget` / `canBeTargetAnimationTarget`; hint line explains selection vs first-eligible fallback. Creation behavior untouched.
  - Graph helper text (`Uses selected axes…` / `Uses existing axes.` / `Uses earliest axes — select axes to choose.` / `Will create axes automatically.`) shown under the section when expanded and appended to every graph button tooltip; display-only, mirrors `pickDefaultAxesId` fallback logic.
  - New exported `InsertAudioActions` component (Record / Upload / TTS) for the separate audio surface; calls the same `useAddSceneItems` audio actions.
  - Labels are left-aligned truncated English text; no Hebrew strings added, so no RTL alignment concerns.
- `manim-timeline/src/App.tsx`
  - New `insertCollapsed` state, default expanded (`false`), persisted in `localStorage` under `manim-timeline-insert-sidebar-collapsed` (UI-only, never enters project files).
  - Expanded default width bumped 104 → 216 with an effective minimum of 180 so labels are visible; collapsed width fixed at 60px; width resizer hidden while collapsed.
  - Audio rendered as a separate bordered section below the insert sidebar via `InsertAudioActions`.
- `manim-timeline/src/hooks/useAddSceneItems.ts` — untouched; no metadata helpers were needed (toolbar reads the store directly and reuses `lib/time` eligibility helpers + `itemClipDisplayName`).
- `manim-timeline/README.md` — updated the stale `+ Object → Exit animation` wording to `Insert → Animations → Exit` and extended the `*Last updated:*` trailer.
- Deviations: none material. The animation highlight uses a bordered container only in expanded mode (collapsed mode uses header color + button rings to save space); the resizer is hidden rather than disabled in collapsed mode.
- Commands run (from `manim-timeline/`):
  - `npm run build` — pass (`tsc -b && vite build`, built in ~2s; chunk-size warning only).
  - `npm run test` — pass (40 files, 295 tests).
  - `npx eslint src/App.tsx src/panels/AddObjectToolbar.tsx` — clean. Full `npm run lint` reports 69 pre-existing errors elsewhere (e.g. `validate.ts`, `ShapeNode.tsx`, `FloatingPanel.tsx`, tauri-codegen assets); none in touched files.
- Left undone: manual browser smoke at `http://localhost:5173/` (dev server not started in this session); contextual keyboard shortcuts remain future work per plan non-goals.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Build | `npm run build` (from `manim-timeline/`) | pass — `✓ 274 modules transformed` and `✓ built in 913ms`; only Vite chunk-size warning. |
| Tests | `npm run test` (from `manim-timeline/`) | pass — `Test Files  40 passed (40)`, `Tests  295 passed (295)`. |
| Lint | `npm run lint`; then `npx eslint src/App.tsx src/panels/AddObjectToolbar.tsx` (from `manim-timeline/`) | touched files pass — scoped eslint produced no output. Full lint still fails outside touched files with `✖ 78 problems (69 errors, 9 warnings)`, including pre-existing `src/agent/validate.ts`, `src/canvas/layers/ShapeNode.tsx`, and `src-tauri/target/...` findings. |
| Scope | `git status --short --untracked-files=all`; `git diff --stat` (repo root) | tracked diff in scope — stat lists only `manim-timeline/README.md`, `manim-timeline/src/App.tsx`, and `manim-timeline/src/panels/AddObjectToolbar.tsx` (`3 files changed, 408 insertions(+), 96 deletions(-)`). Untracked out-of-scope files are listed below. |
| Static claims / invariants | `git diff -- manim-timeline/src/App.tsx manim-timeline/src/panels/AddObjectToolbar.tsx manim-timeline/README.md`; grep checks for `localStorage`, schema keys, and audio actions | pass — `insertCollapsed` is read/written only via `localStorage` key `manim-timeline-insert-sidebar-collapsed`; no tracked `store/`, `types/`, `lib/`, `codegen/`, or server diffs; `InsertAudioActions` calls the same `openAudioRecording` / `openAudioUpload` / `openAudioTts` actions and `AudioPanel` rendering remains unchanged. |

- Out-of-scope changes found in the diff (files not in "Touched files"):
  - None in the tracked `git diff --stat`.
  - `git status --short --untracked-files=all` also reports untracked files outside the plan scope: `.agents/skills/{audio-pipeline,codegen-invariants,copilot-add-kind,docs-sync,manim-render-check,project-schema-migration,verify-frontend,verify-server}/SKILL.md`; `.cursor/agents/{architect,codegen-dev,copilot-dev,docs-keeper,editor-dev,manim-reviewer,server-dev,ui-reviewer,verifier}.md`; `.cursor/commands/{handoff-opencode,implement,plan,verify}.md`; `.cursor/rules/agent-workflow.mdc`; `.opencode/agents/{architect,codegen-dev,copilot-dev,docs-keeper,editor-dev,manim-reviewer,server-dev,ui-reviewer,verifier}.md`; `.opencode/commands/{handoff-cursor,implement,plan,verify}.md`; `AGENTS.md`; `docs/handoffs/{2026-09-10-dev-server-not-running,2026-09-10-redesign-insert-controls,2026-09-10-run-current-app,TEMPLATE}.md`; `opencode.json`.
- Claims in "Implementation notes" that could not be confirmed:
  - Manual browser smoke at `http://localhost:5173/` was not run by verifier, so fresh-load expanded state, reload persistence, resizer behavior, visual emphasis, and click flows were checked only statically.

Verdict: **pass**.
