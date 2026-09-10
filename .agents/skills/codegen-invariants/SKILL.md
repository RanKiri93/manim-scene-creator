---
name: codegen-invariants
description: The timing and structure invariants of the Manim exporter (src/codegen) and how to change emitted Python without desynchronising the timeline cursor. Load before editing anything under manim-timeline/src/codegen or src/lib/time.ts.
---

# Codegen invariants

Read the README section "Export timing and audio synchronization" first
(`manim-timeline/README.md`). This skill is the checklist version of it.

## The one rule

`sequentialAnimSecondsForLeaf(leaf, …)` in `src/codegen/groupPlaybackSpan.ts` must return
exactly the number of Manim scene-clock seconds that the Python block emitted for that leaf
consumes (`run_time`s + `Wait`s inside `Succession` + tail waits). `manimExporter.ts` uses it
to advance `timelineCursor` and to compute `padAfter`. If they disagree, every later clip
drifts and `self.wait` gaps go wrong or vanish.

So: any change to what a leaf emits requires the matching change in `groupPlaybackSpan.ts`,
and a test asserting the emitted `self.wait(...)` values.

## Per-leaf duration table (must stay true)

| Leaf | No audio | With bound audio |
|---|---|---|
| `textLine` | `effectiveDuration` (anim + segment `waitAfterSec`) | `sceneClockSecForLeafBoundPlayback` |
| `axes`, `graphPlot`, `graphFunctionSeries`, `shape` | `leaf.duration` | `sceneClockSecForLeafBoundPlayback` |
| `graphDot` | `duration + (label ? 1 : 0)` | bound value already includes the label second — do not add again |
| `graphField` | `duration + (seeds ? 1 : 0)` | bound value already includes the streams second — do not add again |

`add_sound` does not advance Manim's clock. `padAfter` exists to compensate.

## Event stream (manimExporter.ts)

1. `flattenExportLeaves` — compounds are flattened; children interleave with other leaves in
   timeline order. `exit_animation`, `blink_animation`, `target_animation`, `camera_move`
   are not leaves; they are events emitted at their own `startTime`.
2. `playEvents` sorted by `t`, stable kind order at equal `t`. Group by equal `t` within
   `TIMELINE_GAP_EPS`.
3. Per group: `self.wait(t0 - timelineCursor)` if positive; `add_sound` lines; concurrent
   `AnimationGroup` clusters; sequential leaf plays; then `self.wait(padAfter)`.

## Audio binding and tails (lineCodegen.ts)

- Track selection: explicit `audioTrackId` wins; `AUDIO_BINDING_NONE` (`__none__`) disables;
  otherwise overlap with `[effectiveStart, effectiveStart + duration]`.
- `run_time` from Whisper word boundaries when they fit the window; else clip duration.
- Tail: `audioTailWaitAfterLeafPlayback` = time from animation end to
  `track.startTime + audioFileDuration`, capped by `tailCeilingAbs` =
  `nextTimelineEventAfter(holdEnd(leaf))`. The cap prevents one long file under several lines
  from pushing the clock past the next line's start.
- Early narration: `listUnboundAudioTracksForExport` emits `add_sound` at track start;
  `boundSoundEmittedAtTrackStart` makes the leaf skip its own `add_sound` but keep the tail.

## Concurrency (leafConcurrentCodegen.ts)

Intro intervals that overlap by more than `MIN_INTERVAL_OVERLAP_SEC` (compared by `holdEnd`,
not only start) merge into one `AnimationGroup` with `Succession(Wait(rel), …)` stagger.
Touching endpoints do not merge. Any new leaf kind must provide a `Succession` branch here
or be excluded explicitly.

## Function series (functionSeriesCodegen.ts)

- `mode: 'replacement'` keeps a single on-scene mobject: `Create(n_1)` then
  `_FSRevealTransform(n_1, n_k)` hops. `n_2..n_last` are pre-hidden with
  `set_stroke(opacity=0)` — stroke only, never `set_opacity` (fills the area under the curve).
- The module-scope `class _FSRevealTransform(Transform)` is emitted once when any replacement
  series with ≥ 2 curves exists (`anyReplacementFunctionSeries`).
- Exit animations on a replacement series target `n_1`, not the `VGroup` (see
  `resolveExitTargetsForExport` in `graphCodegen.ts`). `SurroundingRectangle` still targets
  the `VGroup`.

## Text (lineCodegen.ts, texUtils.ts)

- Always `HebrewMathLine(...)`, `hebrew_font=` from item `font` (default `"Alef"`),
  `font_size=` from item. Segment indices in Python are `line[i]`; the measure server returns
  boxes in the same visual order.
- Bold/italic go into the LaTeX source (`\textbf`, `\mathbf`, …), not Python calls.
- `||` is a text-segment separator consumed by the parser; it never reaches the render.

## Before you finish

- [ ] `groupPlaybackSpan.ts` updated if emitted seconds changed.
- [ ] Test added/extended: `manimExporter.overlap.test.ts` for cursor/wait behaviour, or the
      kind's own `*.test.ts` for the emitted snippet. Assert on the exact `self.wait(…)` and
      `run_time=` numbers, derived by hand from the timeline in the test.
- [ ] `npm run test` and `npm run build` green (skill `verify-frontend`).
- [ ] If the generated Python changed shape, ask for `manim-reviewer` (skill
      `manim-render-check`) in the handoff.
- [ ] README "Per-leaf duration accuracy" table and the "Last updated" trailer updated, or
      the handoff tells `docs-keeper` to do it.
