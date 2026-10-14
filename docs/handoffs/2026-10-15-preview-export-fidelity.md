---
slug: preview-export-fidelity
created: 2026-10-15
status: done
owner_role: codegen-dev
next_tool: any
source: user request (make the canvas preview track the exported video)
---

<!--
Copy this file to docs/handoffs/<created>-<slug>.md.
Each role appends ONLY its own section. Never edit a section written by an earlier role;
add a dated note under your own section instead. Update the frontmatter `status`,
`owner_role`, and `next_tool` when you hand off.
-->

## Plan (architect)

### Goal
Make what the editor previews match what the export renders, in four ordered steps. This
handoff covers **step 1 only**; steps 2–4 get their own handoffs when started.

1. **Absolute timeline waits in export (this handoff).** Exported scenes reach each timeline
   event by waiting *until* an absolute scene time instead of waiting a relative `Δ` from the
   exporter's modelled cursor. Manim rounds every `play`/`wait` to whole frames; with relative
   waits that rounding accumulates (measured: +0.10 s by 17.8 s at `-ql` on a 12-clip project).
   With absolute targets every event starts within about one frame of its timeline time.
2. Shared timing map: the exporter also emits the schedule (each play/wait with start/end);
   a test asserts it against the timeline; the preview reads it. Includes the graph-dot label
   mismatch (export writes the label for 1 s after the clip; preview draws it at once). The
   user decides whether the label moves inside the clip duration.
3. Preview audio through Web Audio mirroring `AudioMixdownSpec` (all overlapping clips, cut
   fades, background bed). Today `timelineAudioController.ts` plays one clip at a time.
4. Rendered-proxy playback on the canvas with a persistent per-scene Manim cache dir; later
   render-around-playhead / single real frame.

Why step 1 matters today: with the default 40 ms cut fades every render that has audio goes
through `/api/mixdown_audio` + `_mux_master_audio_over_mp4`, which places narration at exact
timeline seconds and replaces Manim's own audio. Picture drift is therefore audible drift.

Evidence (session scratchpad, not committed): a synthetic project run through the real
exporter and rendered with instrumented `Scene.play`/`add_sound` — every event landed at its
timeline time plus a monotonically growing rounding error (0 → +0.033 → +0.067 → +0.10 s).
Scheduling logic itself (early narration, one file under two lines, segment waits, clusters,
camera, exits, unbound sound) was correct.

### Non-goals
- No change to what any leaf emits, to `sequentialAnimSecondsForLeaf`, or to the exporter's
  cursor/`padAfter` model. Only the three cursor waits in `manimExporter.ts` change form.
- Leaf-internal waits (segment `waitAfterSec`, audio tails, function-series/point-sequence
  steps) stay relative; the next absolute wait absorbs their rounding.
- No preview (canvas/timeline) change in this step.
- No frame-exact snapping that depends on Manim's frozen-frame vs. animated-wait internals.

### Touched files
- `codegen/manimExporter.ts`: gap wait, `padAfter` wait and final scene-end wait emit
  `_wait_to(self, <absolute t>)`; helper emitted in the full-file header and in partial
  export when used.
- `codegen/timelineWaitCodegen.ts` (new): helper source + call formatter.
- `codegen/*.test.ts`: update assertions on cursor waits; add a test for absolute targets
  and the helper.
- Docs: README "Playback event stream" + trailer; skills `codegen-invariants` and
  `manim-render-check` (static timing walk must read `_wait_to`).

### Invariants at risk
- `timelineCursor` must still equal the modelled scene clock: each `_wait_to` target is
  exactly the cursor value the old relative wait produced, so the cursor math is unchanged.
- `sequentialAnimSecondsForLeaf` table: untouched.
- Partial export must stay pasteable: include the helper whenever a call is emitted.
- Multi-scene project export: each scene class starts its own clock at 0.

### Test plan
- `npx vitest run src/codegen` then `npm run test`, `npm run build`, `npm run lint`
  (touched files clean).
- Extend `manimExporter.overlap.test.ts`: absolute targets for gap, pad and end waits;
  helper emitted once in full file and in partial export.
- Real render: re-run the scratch probe project at `-ql`; every event within one frame
  (≤ 0.067 s) of its timeline time, no growth along the scene.

### Open questions
None. (Naming: Manim already has `Scene.wait_until(stop_condition)`, so the helper is a
module-level `_wait_to(scene, t)` to avoid confusion.)

## Implementation notes (codegen-dev)

- `codegen/timelineWaitCodegen.ts` (new): `timelineWaitHelperSource()` emits module-level
  `_wait_to(scene, t)`: `frames = round((t - scene.time) * config.frame_rate)`; if
  `frames > 0`, `scene.wait((frames + 0.5) / config.frame_rate)`. `timelineWaitLine(pad, t)`
  formats a call.
- `codegen/manimExporter.ts`: the gap wait, `padAfter` wait and scene-end wait emit
  `_wait_to(self, <cursor target>)`; targets are exactly the cursor values the old relative
  waits produced, so `timelineCursor`/`padAfter` math is untouched. `usesTimelineWait` gates
  the helper: full file right after the `HebrewMathLine` import (before any helper `class`),
  partial export alongside the other helpers.
- Deviations from plan:
  - The first helper waited `t - scene.time` directly. A real render showed the
    float subtraction (`2.4 - 2.2 = 0.19999…`) floored to one frame short, because exported
    waits are Manim *static* waits (`freeze_current_frame`: `int(duration / dt)`). The
    helper now snaps to whole frames plus half a frame of headroom. Exported scenes use no
    updaters, so waits are always static. A hand-added updater would take the animated
    path (ceil) and could overshoot one frame, which the next `_wait_to` corrects.
  - The helper uses comments, not a docstring: `combineMultiScenePythonExports` merges headers
    line by line and would drop a bare `"""` line already present.
- Tests: updated cursor-wait assertions in `manimExporter.overlap.test.ts` (12) and
  `projectExporter.test.ts` (2, plus one-helper/before-class assertions). New describe
  `exportManimCode absolute timeline waits` (3 tests: absolute targets for gap/pad/end,
  helper once before the class and in partial export, helper omitted when unused).
  Leaf-level `not.toContain('self.wait(')` assertions in `targetAnimationCodegen.test.ts`
  are unchanged (leaf code is unchanged).
- Real render (scratch probe: 12 clips, 3 audio tracks, instrumented `Scene.play` /
  `add_sound`). Values are the event start minus its timeline time:

  | | before `-ql` | after `-ql` | after `-qh` |
  |---|---|---|---|
  | worst event | +0.067 s (growing) | +0.048 s (no growth) | 0.000 s (all 16 events) |
  | scene end (17.7 s) | +0.100 s | +0.033 s | 0.000 s |

  The remaining `-ql` offsets are timeline times that fall between 15 fps frames
  (e.g. 4.9 s = frame 73.5), which can't be removed.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Codegen tests | `npx vitest run src/codegen` | pass, 133/133 |
| Full tests | `npm run test` | pass, 74 files / 605 tests |
| Build | `npm run build` | pass (existing chunk-size warning only) |
| Lint (touched) | `npx eslint` on the 4 touched TS files | clean |
| Real render | scratch probe at `-ql` and `-qh` | pass, table above |

- Out-of-scope changes found in the diff: none (skills `codegen-invariants` and
  `manim-render-check` were listed under Docs).
- Claims that could not be confirmed: none. The per-leaf duration table is unchanged
  because no leaf emission changed.

Verdict: **pass**. Note: implementation and verification were done in the same session
(Claude Code); the user asked for step 1 directly.

## Review notes (manim-reviewer / ui-reviewer — optional)

Not run separately. The generated Python changed shape only in cursor waits, and this was
covered by the real-render measurement above.

## Docs delta (docs-keeper)

- README "Global audio timeline" export-alignment paragraph and "Playback event stream" steps
  4 and 6 describe `_wait_to`. The `*Last updated:*` trailer was extended (“Absolute timeline
  waits in export”).
- `.agents/skills/codegen-invariants` (event stream step 3) and `manim-render-check`
  (static timing walk) updated.
- ARCHITECTURE.md: not touched (Copilot unaffected). idea.md: not touched.
- Steps 2–4 remain open; start each with its own handoff.
