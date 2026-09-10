---
slug: timeline-time-surgery-controls
created: 2026-09-10
status: docs
owner_role: editor-dev
next_tool: any
source: user request / bug report
---

## Plan (architect)

### Goal
Replace the fragile `Close gap…` control with a clear, reversible “timeline time edit” workflow: the user opens one button from the playback bar, chooses either **Close empty range** or **Insert empty time**, sees exactly which visual clips and narration audio clips will move, and applies the edit in one undoable store mutation. Closing removes a user-specified empty interval `[start, end)` by shifting everything after `end` left by `end - start`; inserting creates an empty interval at a point by shifting everything starting at or after that point right by the requested duration. The nearby ambiguous `|>` button should be relabeled or redrawn as an explicit “jump to start / 0s” control.

### Non-goals
- Do not split, trim, stretch, or delete visual clips, narration clips, word boundaries, or background-bed audio. If a requested close/insert operation would require splitting because content overlaps the range/point, show blockers and disable Apply.
- Do not change persisted project shape (`types/scene.ts`), project migrations, codegen, server endpoints, audio processing, or `.mtproj` bundling.
- Do not change the background bed model: it remains full-scene/render-only and has no `startTime`; it naturally resizes because scene duration changes when clips move.
- Do not introduce drag range-selection on the ruler in this pass; numeric inputs plus “use playhead” affordances are enough for v1.
- Preserve existing uncommitted Insert-sidebar/README work in this checkout; append README wording/trailer changes without rewriting that work.

### Touched files
**types/**
- None. No persisted schema change.

**lib/**
- `manim-timeline/src/lib/timelineSurgery.ts` (new) — pure, tested helpers that validate requested edits, find blockers, count affected top-level scene/audio clips, and compute start-time updates for close/insert operations.
- `manim-timeline/src/lib/timelineSurgery.test.ts` (new) — unit tests for validation, affected-counts, blocker detection, and computed start-time updates.

**store/**
- `manim-timeline/src/store/useSceneStore.ts` — replace the current narrow `closeGap(gapStart, gapEnd)` implementation with store actions backed by `timelineSurgery` helpers, e.g. `closeTimelineRange(start, end)` and `insertEmptyTimelineTime(at, duration)`; keep `closeGap` only as an internal compatibility alias if that minimizes churn.
- `manim-timeline/src/store/useSceneStore.timelineSurgery.test.ts` (new) — integration tests for one-undo-step timeline edits across visual items, narration audio, linked audio, current time, and effect-clip clamping.

**UI**
- `manim-timeline/src/timeline/PlaybackControls.tsx` — replace `Close gap…` with a clearer `Time edit…`/`Timeline edit…` button and dialog entry point; fix the ambiguous jump-to-start button with a left-facing skip icon and/or visible `0s` label.
- `manim-timeline/src/timeline/TimelineSurgeryDialog.tsx` (new) — modal/popup with mode tabs/radio (`Close empty range`, `Insert empty time`), inputs, “set start/point to playhead”, optional “set end to next clip start”, blocker list, affected-count preview, and explicit Apply labels (`Close range`, `Insert time`).

**codegen/**
- None. The edit only changes timeline positions in the store; existing exporter timing tests must continue to pass.

**server**
- None.

**docs**
- `manim-timeline/README.md` — update the Timeline section to document `Timeline edit…` close/insert semantics and extend the `*Last updated:*` trailer.
- `docs/handoffs/2026-09-10-timeline-time-surgery-controls.md` (new) — this handoff.

### Invariants at risk
- Only top-level scene clips move; compound children keep `localStart` / `localDuration` and are not shifted independently. Enforced by `isTopLevelItem` / compound timing helpers in `manim-timeline/src/lib/time.ts` and store mutations in `manim-timeline/src/store/useSceneStore.ts`.
- Close/insert operations must create/remove **empty** time only; they must not silently overlap, trim, or split clips. Enforced by blocker detection in new `manim-timeline/src/lib/timelineSurgery.ts` and UI disabling in new `manim-timeline/src/timeline/TimelineSurgeryDialog.tsx`.
- Effect clip starts (`exit_animation`, `blink_animation`, `target_animation`, `camera_move`) must remain valid after bulk shifts. Enforced by `clampEffectClipStarts` and min-start helpers in `manim-timeline/src/store/useSceneStore.ts` / `manim-timeline/src/lib/time.ts`.
- Explicit audio bindings remain exclusive and linked audio remains synchronized to its visual owner. Enforced by `syncAllExplicitAudioBindingsInDraft`, `explicitVisualOwnerForAudioTrack`, and `dedupeExclusiveAudioOwner` in `manim-timeline/src/store/useSceneStore.ts` / `manim-timeline/src/lib/audioBinding.ts`.
- Unlinked narration audio clips move exactly once with the timeline edit; linked audio should follow shifted visual owners through binding sync rather than receive a conflicting independent move. Enforced by new store tests in `manim-timeline/src/store/useSceneStore.timelineSurgery.test.ts` plus existing `manim-timeline/src/store/useSceneStore.audioBinding.test.ts`.
- Word boundaries and audio asset URLs must remain unchanged when clips move. Enforced by the audio model in `manim-timeline/src/types/scene.ts` and covered by new store tests that assert `boundaries`, `audioUrl`, `assetRelPath`, and `duration` are preserved.
- Background bed stays scene-level/full-scene/render-only and is not shifted as an item. Enforced by `AudioBed` lacking `startTime` in `manim-timeline/src/types/scene.ts`, bed rendering in `manim-timeline/src/timeline/BedClip.tsx`, and mixdown helpers in `manim-timeline/src/lib/audioMixdown.ts`.
- Scene duration, scrubber max, and bed width must recompute after edits rather than store stale duration. Enforced by `getSceneDuration` in `manim-timeline/src/store/useSceneStore.ts` and `sceneDurationSec` / `contentEndTime` in `manim-timeline/src/timeline/Timeline.tsx`.
- Current time should stay coherent: closing maps playhead inside the removed interval to `start` and after `end` to `time - delta`; inserting shifts playhead after the insertion point by `+duration` while leaving a playhead exactly at the insertion point there. Enforced by store action tests in `manim-timeline/src/store/useSceneStore.timelineSurgery.test.ts`.
- Each Apply should be one undoable operation. Enforced by using a single zustand/zundo `set(...)` action in `manim-timeline/src/store/useSceneStore.ts`.

### Test plan
- Add `manim-timeline/src/lib/timelineSurgery.test.ts`:
  - `describe('timelineSurgery close range')`: rejects non-finite/non-positive ranges; reports blockers for any top-level scene/audio clip intersecting `[start, end)`; allows clips ending at `start` and clips starting at `end`; computes left-shift updates for unblocked top-level scene/audio clips starting at or after `end`.
  - `describe('timelineSurgery insert empty time')`: rejects non-finite/non-positive duration; reports blockers for clips spanning across the insertion point; computes right-shift updates for top-level scene/audio clips starting at or after the insertion point; ignores `AudioBed`.
- Add `manim-timeline/src/store/useSceneStore.timelineSurgery.test.ts`:
  - `describe('useSceneStore timeline surgery')`: close range shifts text/axes/effect clips and unlinked audio left; insert empty time shifts those clips right; compound children do not move independently; linked audio follows its shifted visual owner and is not double-shifted; linked audio whose visual owner is before the edit stays put; word boundaries/audio metadata survive; invalid/blocking edits are no-ops; currentTime mapping behaves as specified; effect starts are still clamped.
- Keep existing audio tests green: `manim-timeline/src/store/useSceneStore.audioBinding.test.ts`, `manim-timeline/src/store/useSceneStore.audioGap.test.ts`, and `manim-timeline/src/lib/audioGapPresets.test.ts`.
- From `manim-timeline/`: `npm run build`
- From `manim-timeline/`: `npm run test -- src/lib/timelineSurgery.test.ts src/store/useSceneStore.timelineSurgery.test.ts src/store/useSceneStore.audioBinding.test.ts src/store/useSceneStore.audioGap.test.ts src/lib/audioGapPresets.test.ts`
- From `manim-timeline/`: `npm run test`
- From `manim-timeline/`: `npx eslint src/lib/timelineSurgery.ts src/lib/timelineSurgery.test.ts src/store/useSceneStore.ts src/store/useSceneStore.timelineSurgery.test.ts src/timeline/PlaybackControls.tsx src/timeline/TimelineSurgeryDialog.tsx`
- Manual UI smoke at `http://localhost:5173/`:
  - The old `Close gap…` button is replaced by a clear `Time edit…`/`Timeline edit…` entry.
  - The `|>` button reads or looks like “jump to start / 0s”.
  - Close mode, with no clips inside `[start, end)`, previews affected visual/audio counts and shifts later clips left by exactly `end - start`.
  - Close mode with a clip/audio intersecting the range shows blockers and disables Apply.
  - Insert mode at an empty boundary previews affected counts and shifts later visual/audio clips right by exactly the requested duration.
  - Insert mode with a clip/audio spanning the insertion point shows blockers and disables Apply.
  - Background bed lane remains full-scene and visually resizes with scene duration.

### Open questions
None for v1. This plan deliberately chooses the safest semantics: close/insert only empty time and block operations that would require splitting or trimming.

## Implementation notes (editor-dev)

- `manim-timeline/src/lib/timelineSurgery.ts` (new) — pure helpers: `validateCloseRange` / `validateInsertTime`, `planCloseRange` / `planInsertTime` (validation + blocker detection + start-time updates), `mapCloseRangePlayhead` / `mapInsertPlayhead`, `nextClipStartAfter`, and `collectSurgerySpans` (builds labeled visual/audio spans from store state). Visual spans use the rendered clip window (`startTime + runDuration`, matching `TimelineClip` bars), not the on-screen presence span, so a line with a far-future exit does not block edits to structurally empty time. Boundary-touching clips (ending at `start`/`at`, starting at `end`/`at`) are allowed; spanning clips block. `TIMELINE_SURGERY_EPS = 1e-6`.
- `manim-timeline/src/lib/timelineSurgery.test.ts` (new) — 13 tests: `describe('timelineSurgery close range')` (validation, blockers, boundary allowance, left-shift updates, playhead mapping) and `describe('timelineSurgery insert empty time')` (validation, spanning blockers, boundary insertion, right-shift updates, bed-ignorance, playhead mapping, next-clip-start).
- `manim-timeline/src/store/useSceneStore.ts` — removed `closeGap`; added `closeTimelineRange(start, end)` and `insertEmptyTimelineTime(at, durationSec)`, each returning `boolean` and applying one `set(...)` (one undo step). Both build spans via `collectSurgerySpans`, refuse invalid/blocked edits with no state change, skip directly shifting linked audio (binding sync moves it with its owner exactly once), remap `currentTime` (close: inside range → `start`, after `end` → `−delta`; insert: after point → `+duration`, at point stays), then `clampEffectClipStarts` + `syncAllExplicitAudioBindingsInDraft`.
- `manim-timeline/src/store/useSceneStore.timelineSurgery.test.ts` (new) — 7 tests in `describe('useSceneStore timeline surgery')`: close shifts text/axes/exit clips + unlinked audio; insert shifts right; linked audio follows shifted owner once; linked audio with unmoved owner stays; boundaries/URL/assetPath/duration survive; invalid/blocked edits are no-ops (times + playhead unchanged); playhead mapping through close/insert.
- `manim-timeline/src/timeline/TimelineSurgeryDialog.tsx` (new) — mode tabs (Close empty range / Insert empty time), `NumberInput` primitives for start/end/point/duration, "Start/Point = playhead" and "End = next clip" affordances, live affected-count preview ("Will move N visual clips and M audio clips left/right…"), blocker list with clip kind/label/window, explicit Apply labels (`Close range` / `Insert time`), Apply disabled unless the plan is clean. English left-aligned text; no Hebrew strings.
- `manim-timeline/src/timeline/PlaybackControls.tsx` — `Close gap…` button + inline gap dialog replaced by a `Timeline edit…` toggle rendering `TimelineSurgeryDialog`; ambiguous `|>` rewind redrawn as left-facing `|◀` with `title`/`aria-label` "Jump to start (0s)". Batch-audio, time display, scrubber, and playback-lock behavior unchanged.
- `manim-timeline/README.md` — Timeline section gained a `Timeline edit…` bullet; `*Last updated:*` trailer extended (appended in front of the uncommitted Insert-sidebar entry without touching it).
- Deviations: `closeGap` was removed rather than kept as an alias — it had exactly one caller (the rewritten `PlaybackControls`) and no test coverage, so an alias would only preserve the old unsafe semantics. Linked audio participates in blocker detection (a range covered by playing linked narration is not "empty") but never moves directly. No drag range-selection, per plan non-goals.
- Commands run (from `manim-timeline/`):
  - `npx vitest run src/lib/timelineSurgery.test.ts src/store/useSceneStore.timelineSurgery.test.ts src/store/useSceneStore.audioBinding.test.ts src/store/useSceneStore.audioGap.test.ts src/lib/audioGapPresets.test.ts` — pass (5 files, 33 tests).
  - `npm run build` — pass (`tsc -b && vite build`, ~1.7s; chunk-size warning only).
  - `npm run test` — pass (42 files, 314 tests; was 40/295 before this change).
  - `npx eslint` on all six touched/new source files — only 2 pre-existing findings, both also present before this change: `useSceneStore.ts` window-debug `(window as any)` (was line 1925, now 1984) and `PlaybackControls.tsx` `itemsMap` exhaustive-deps warning (was line 44, now line 32). No new lint issues.
- Left undone: manual browser smoke at `http://localhost:5173/` (dev server not started in this session); ruler drag range-selection remains future work per plan non-goals. No `types/scene.ts` change (no migration needed); no `measureClient.ts` change (no server-contract check needed).

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Build | `npm run build` (from `manim-timeline/`) | pass — `tsc -b && vite build`; `✓ 276 modules transformed`, `✓ built in 1.25s` (chunk-size warning only). |
| Targeted vitest | `npm run test -- src/lib/timelineSurgery.test.ts src/store/useSceneStore.timelineSurgery.test.ts src/store/useSceneStore.audioBinding.test.ts src/store/useSceneStore.audioGap.test.ts src/lib/audioGapPresets.test.ts` (from `manim-timeline/`) | pass — `Test Files  5 passed (5)`, `Tests  33 passed (33)`. |
| Full vitest | `npm run test` (from `manim-timeline/`) | pass — `Test Files  42 passed (42)`, `Tests  314 passed (314)`. |
| Scoped lint / no-new-lint check | `npx eslint src/lib/timelineSurgery.ts src/lib/timelineSurgery.test.ts src/store/useSceneStore.ts src/store/useSceneStore.timelineSurgery.test.ts src/timeline/PlaybackControls.tsx src/timeline/TimelineSurgeryDialog.tsx` (from `manim-timeline/`) | pass for this task — output is exactly the claimed baseline findings: `useSceneStore.ts:1984:14 no-explicit-any` (`window as any`, present in `HEAD`) and `PlaybackControls.tsx:32:54 react-hooks/exhaustive-deps` (`itemsMap`, present in `HEAD`). No findings in the new files. |
| Scope status/stat | `git status --short -uall`; `git diff --stat`; `git diff --name-only` (repo root) | pass with known WIP noted below — tracked stat: `README.md`, `src/App.tsx`, `src/panels/AddObjectToolbar.tsx`, `src/store/useSceneStore.ts`, `src/timeline/PlaybackControls.tsx` (`5 files changed, 511 insertions(+), 216 deletions(-)`); new timeline-surgery files are untracked as expected. |
| Static invariants | `git diff`/file reads/grep for touched files; `git diff --name-only -- manim-timeline/src/types/scene.ts manim-timeline/src/services/measureClient.ts measure_server.py`; grep `closeGap`; grep `NumberInput` | pass — `closeGap` has no remaining `src` callers; `closeTimelineRange` and `insertEmptyTimelineTime` each use one `set(...)` at `useSceneStore.ts:1064` and `1094`; no `types/scene.ts`, `measureClient.ts`, or `measure_server.py` diff; `TimelineSurgeryDialog.tsx` imports and uses `NumberInput`; tests cover blockers, linked/unlinked audio, metadata preservation, currentTime mapping, and effect clamp. |

- Out-of-scope changes found in the diff (files not in "Touched files"):
  - `manim-timeline/src/App.tsx` and `manim-timeline/src/panels/AddObjectToolbar.tsx` are modified but are not in this plan; their current diff matches the prior Insert-sidebar handoff scope (`docs/handoffs/2026-09-10-collapsible-insert-sidebar.md`) and contains no timeline-surgery identifiers.
  - `manim-timeline/README.md` is in scope for this task, but the diff also includes the prior Insert-sidebar wording change (`+ Object → Exit animation` to `Insert → Animations → Exit`) and trailer text; the timeline-surgery README delta is the new `Timeline edit…` bullet plus the new trailer prefix.
  - `git status --short -uall` also shows unrelated untracked repo workflow/handoff files outside this plan: `.agents/skills/*`, `.cursor/agents/*`, `.cursor/commands/*`, `.cursor/rules/agent-workflow.mdc`, `.opencode/agents/*`, `.opencode/commands/*`, `AGENTS.md`, `opencode.json`, and other `docs/handoffs/*.md` files.
- Claims in "Implementation notes" that could not be confirmed:
  - Manual browser smoke at `http://localhost:5173/` was not run by verifier; UI behavior was checked statically plus by passing build/tests.
  - Git can show the current App/AddObjectToolbar/README diffs and the prior Insert-sidebar handoff covering them, but cannot prove author/time of those pre-existing uncommitted edits inside this verifier session.

Verdict: **pass**.
