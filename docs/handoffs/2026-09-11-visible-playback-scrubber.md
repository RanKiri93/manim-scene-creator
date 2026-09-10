---
slug: visible-playback-scrubber
created: 2026-09-11
status: docs
owner_role: editor-dev
next_tool: any
source: user request / screenshot feedback
---

## Plan (architect)

### Goal
Redesign the playback-controls timeline scrubber so a common user can immediately see the timeline rail, elapsed progress, and current-time handle. Use a modern dark-theme pill rail with a clear remaining track, blue filled progress from 0 to the playhead, and a slimmer vertical pill/thumb handle (not a large white circle) with hover/focus affordances. Scrubbing behavior, duration calculation, play/pause behavior, audio sync, and timeline clip layout must remain unchanged.

Recommended visual design:
- Rail: full-width rounded pill, 8–10px tall, visible on the `bg-slate-800` controls bar (`bg-slate-700`/`slate-600` remaining track), with a subtle inset/highlight border so it does not disappear into the header.
- Progress: blue filled segment from the left edge to `currentTime / max(duration, 1)`, using a CSS custom property such as `--scrubber-progress` set in `PlaybackControls.tsx`.
- Handle: slim blue/near-white vertical rounded pill around 7–8px wide and 18px tall, centered on the rail; add a small dark outline/shadow/halo so it remains readable over both the filled and unfilled rail. On hover/focus, slightly brighten the rail/handle and show an accessible focus ring.
- Browser support: style both WebKit and Firefox range pseudo-elements; keep a sane `accent-color` fallback.

### Non-goals
- Do not change timeline timing semantics, `currentTime`, `viewRange`, audio playback/sync, clip dragging/resizing, close/insert timeline surgery, or store state shape.
- Do not redesign the lower scroll bar, ruler ticks, clip bars, audio lanes, or background bed lane unless required to avoid a visual clash.
- Do not apply the new scrubber style globally to every `input[type="range"]`; other sliders (for example audio/background-bed controls or canvas/panel controls) should keep their existing size unless explicitly opted in later.
- Do not add dependencies or a new component library.

### Touched files
UI:
- `manim-timeline/src/timeline/PlaybackControls.tsx` — scope the main playback scrubber with an explicit class/ARIA label and set a progress CSS variable from `currentTime` and `duration`; preserve the existing `min`, `max`, `step`, `value`, and `onChange` behavior.
- `manim-timeline/src/index.css` — add component-scoped `.timeline-scrubber` range styling for WebKit and Firefox: visible rail, blue progress fill, slim handle, hover/focus states. Avoid broadening the existing global range selector in a way that changes panel sliders.

docs:
- `manim-timeline/README.md` — update the Timeline bullet/trailer only if the implementer changes user-visible terminology or behavior beyond pure styling; otherwise leave README unchanged and note that no docs delta was needed.

### Invariants at risk
- Playback scrubber must continue to seek via `setCurrentTime(parseFloat(e.target.value))`; enforced in `manim-timeline/src/timeline/PlaybackControls.tsx` and indirectly exercised by playback/timeline tests.
- Scene duration display and scrubber maximum must remain derived from `getSceneDuration()` / `Math.max(duration, 1)`; enforced in `manim-timeline/src/timeline/PlaybackControls.tsx`.
- Play button must still invoke `kickTimelineAudioSyncNow()` inside the user click path; enforced in `manim-timeline/src/timeline/PlaybackControls.tsx` and covered by `manim-timeline/src/timeline/timelineAudioController.test.ts` for audio-sync expectations.
- Styling must not leak to unrelated range inputs such as `BackgroundBedPopup`; enforced by selector scoping in `manim-timeline/src/index.css` and by checking `manim-timeline/src/panels/BackgroundBedPopup.tsx` remains opted out.
- No persisted project schema change: `PROJECT_VERSION` migration chain in `manim-timeline/src/types/scene.ts` must remain untouched.
- Existing uncommitted WIP from prior handoffs must be preserved: do not revert or reformat `manim-timeline/src/App.tsx`, `manim-timeline/src/panels/AddObjectToolbar.tsx`, timeline-surgery files, or README sections unrelated to this visual change.

### Test plan
Exact commands from `manim-timeline/`:
- `npm run build` — required for TypeScript and Vite CSS processing.
- `npx vitest run src/timeline/timelineAudioController.test.ts src/store/useSceneStore.timelineSurgery.test.ts` — existing guardrail tests for nearby playback/audio/timeline-edit behavior; no new unit test is required for a CSS-only scrubber restyle.
- `npm run test` — full Vitest suite.
- `npx eslint src/timeline/PlaybackControls.tsx` — touched TypeScript file must be clean except for any pre-existing warning already documented in the current worktree.
- Manual UI smoke: run `npm run dev`, open the app, verify the top playback scrubber has (1) a visible full rail at 0%, mid-scene, and near-end, (2) a slimmer non-white handle, (3) hover/focus states, (4) click/drag seeking still changes the time display, and (5) panel/background-bed range sliders did not unintentionally adopt the playback scrubber size.

Test files already covering the area that were inspected/planned around:
- `manim-timeline/src/timeline/timelineAudioController.test.ts`
- `manim-timeline/src/store/useSceneStore.timelineSurgery.test.ts`

### Open questions
None. Proceed with the recommended visible-rail + blue-progress + slim-pill-handle design unless the user asks for a different color/style before implementation starts.

## Implementation notes (editor-dev)

- `manim-timeline/src/timeline/PlaybackControls.tsx` — the main playback scrubber `<input type="range">` now carries `className="timeline-scrubber"` plus `aria-label="Seek timeline"`, and sets a `--scrubber-progress` CSS custom property (clamped 0–100% from `currentTime / max(duration, 1)`). `min`, `max`, `step`, `value`, and the `setCurrentTime(parseFloat(...))` seek path are unchanged, as are play/pause, jump-to-start, surgery dialog, and batch-audio controls.
- `manim-timeline/src/index.css` — added scoped `input.timeline-scrubber` styling (the `input` type prefix keeps specificity at parity with the legacy global `input[type="range"]` selectors so the new rules win by source order): 8px rounded pill rail (`#475569` on the slate-800 bar with a subtle inset border/shadow), blue `#3b82f6` progress fill from the left edge to `--scrubber-progress` (WebKit gradient; Firefox native `::-moz-range-progress`), slim 8×18px near-white vertical-pill handle with dark outline + blue halo, brighter hover states, grabbing cursor while dragging, and a `focus-visible` ring. The legacy global range selectors were left untouched, so panel sliders (e.g. `BackgroundBedPopup`) keep their existing size; `accent-color` remains as a fallback.
- Deviations: none from the plan. Pure visual change — no README update (no user-visible terminology/behavior change beyond styling), no `types/scene.ts` change (no migration), no `measureClient.ts`/server change.
- Commands run (from `manim-timeline/`):
  - `npm run build` — pass (`tsc -b && vite build`, ~1.1s; chunk-size warning only).
  - `npx vitest run src/timeline/timelineAudioController.test.ts src/store/useSceneStore.timelineSurgery.test.ts` — pass (2 files, 15 tests).
  - `npm run test` — pass (42 files, 314 tests).
  - `npx eslint src/timeline/PlaybackControls.tsx` — 0 errors; 1 pre-existing warning (`itemsMap` exhaustive-deps at line 32, documented in the current worktree before this change).
- Left undone: manual browser smoke at `http://localhost:5173/` (dev server not started in this session) — verifier/reviewer should confirm the rail is visible at 0%/mid/near-end, the handle reads as a slim pill, hover/focus states show, seeking still updates the time display, and panel sliders did not adopt the new size.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Build | `npm run build` (from `manim-timeline/`) | pass — `✓ built in 980ms`; Vite chunk-size warning only. |
| Targeted tests | `npx vitest run src/timeline/timelineAudioController.test.ts src/store/useSceneStore.timelineSurgery.test.ts` (from `manim-timeline/`) | pass — `Test Files  2 passed (2)`, `Tests  15 passed (15)`. |
| Full tests | `npm run test` (from `manim-timeline/`) | pass — `Test Files  42 passed (42)`, `Tests  314 passed (314)`. |
| Touched-file lint | `npx eslint src/timeline/PlaybackControls.tsx` (from `manim-timeline/`) | pass with known warning — `0 errors, 1 warning` at `32:54` for `itemsMap` exhaustive-deps; no new lint errors. |
| Scope/status | `git status --short`; `git diff --stat` (repo root) | pass for this task scope — planned files `manim-timeline/src/timeline/PlaybackControls.tsx` and `manim-timeline/src/index.css` are modified; other modified/untracked files are the unrelated WIP called out in the verification request. |
| Static scrubber invariants | `git diff -- manim-timeline/src/timeline/PlaybackControls.tsx manim-timeline/src/index.css`; grep checks for `BackgroundBedPopup.tsx` / schema files | pass — scrubber keeps `min={0}`, `max={Math.max(duration, 1)}`, `step={0.01}`, `value={currentTime}`, and `onChange={(e) => setCurrentTime(parseFloat(e.target.value))}`; `--scrubber-progress` is set in `PlaybackControls.tsx` and consumed only by scoped `input.timeline-scrubber` rules; no `timeline-scrubber` match in `BackgroundBedPopup.tsx`; no diff for `src/types/scene.ts` or `src/services/measureClient.ts`. |

- Out-of-scope changes found in the diff (files not in "Touched files"): working tree also shows `manim-timeline/README.md`, `manim-timeline/src/App.tsx`, `manim-timeline/src/panels/AddObjectToolbar.tsx`, `manim-timeline/src/store/useSceneStore.ts`, and untracked agent/docs/timeline-surgery files. Per the verifier request, these are unrelated pre-existing WIP and were not attributed to this task; no additional out-of-scope files from this scrubber task were confirmed.
- Claims in "Implementation notes" that could not be confirmed: manual browser smoke/visual confirmation was not run in this API session; attribution of unrelated WIP relies on the user's baseline note because there is no clean-tree baseline in git.

Verdict: **pass**.
