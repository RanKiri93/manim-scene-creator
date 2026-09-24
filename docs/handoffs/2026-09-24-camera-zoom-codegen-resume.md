---
slug: camera-zoom-codegen-resume
created: 2026-09-24
status: planned
owner_role: codegen-dev
next_tool: any
source: user request / stopped camera-zoom implementation
---

<!--
Copy this file to docs/handoffs/<created>-<slug>.md.
Each role appends ONLY its own section. Never edit a section written by an earlier role;
add a dated note under your own section instead. Update the frontmatter `status`,
`owner_role`, and `next_tool` when you hand off.
-->

## Plan (architect)

### Goal
Complete the export stage of the approved camera-zoom feature. Manim output must consume the verified stage-1 `lib/camera.ts` schedule, emit absolute center/width poses with the shared cubic easing, preserve later-start interruptions and explicit scheduled returns, and keep camera/object/audio timeline time aligned in both partial and full exports. This is the first remaining implementation stage; the editor handoff is verified, while the current codegen WIP is incomplete and currently breaks existing overlap exports.

### Non-goals
- Do not change the stage-1 editor model, migration, preview, or camera UI, except for a narrowly proven shared-library compatibility fix.
- Do not implement Copilot support; the ordered Copilot handoff follows this one only after verification.
- Do not add a camera track, live object-bound lookup, server endpoint, audio-processing feature, or unrelated scheduler rewrite.
- Do not accept the current partial WIP as correct: `leafConcurrentCodegen.ts` and `targetAnimationCodegen.ts` have an unfinished API integration, and `cameraCodegen.ts` is untracked with no tests.

### Touched files
Paths are relative to `manim-timeline/` unless noted.

**`codegen/`**
- `src/codegen/cameraCodegen.ts` (existing WIP) — finish or replace the deterministic camera helper, absolute pose/width emission, shared easing, validation diagnostics, and one-writer concurrent branch.
- `src/codegen/cameraCodegen.test.ts` (new) — cover emitted helper syntax, quarter/three-quarter easing, full-frame reset, invalid data, partial export, and concurrent interruption behavior.
- `src/codegen/manimExporter.ts` — build the shared camera schedule, wire camera clips into event/cluster scheduling, remove duplicate old camera emission, preserve `MovingCameraScene`, audio starts, cursor accounting, and authored scene tails.
- `src/codegen/leafConcurrentCodegen.ts` — repair the unfinished camera-cluster API and emit one camera branch per concurrent play; retain existing non-camera cluster behavior.
- `src/codegen/targetAnimationCodegen.ts`, `src/codegen/targetAnimationCodegen.test.ts` — only retain a tested delayed path branch if camera/path overlap is safe; otherwise leave the existing exclusion and return that scope decision rather than emitting unsafe Python.
- `src/codegen/groupPlaybackSpan.ts` — align camera runtime/minimum with the approved shared duration policy if needed; keep the per-leaf duration table unchanged.
- `src/codegen/lineCodegen.ts` — only a narrow interface change if interior narration must be scheduled before a blocking camera play.
- `src/codegen/manimExporter.overlap.test.ts` — add exact camera/object/audio cursor and wait assertions; retain all existing overlap regressions.
- `src/codegen/projectExporter.test.ts` — verify helpers, class selection, independent scene schedules, and authored scene lengths.

**`lib/`**
- `src/lib/camera.ts`, `src/lib/camera.test.ts` — consume the verified schedule; extend only for an export-parity case that cannot be tested at the codegen boundary.
- `src/lib/time.test.ts` — add camera authored-end cases; production `time.ts` is conditional and must not receive a camera special case without a failing regression.

**Docs**
- `manim-timeline/README.md` — after verification, document camera export/concurrency/easing and preserve the existing per-leaf duration table and Last-updated trailer.
- `docs/handoffs/2026-09-24-camera-zoom-codegen-resume.md` — later roles append implementation and verification notes only.

### Invariants at risk
- **Shared camera channel and interruption semantics** — `src/lib/camera.ts` is authoritative; export must preserve sampled source poses, original easing denominators, deterministic equal-start ID priority, no resumption, and independent future returns.
- **Emitted seconds equal accounted seconds** — `src/codegen/groupPlaybackSpan.ts`, `src/codegen/leafConcurrentCodegen.ts`, and `src/codegen/manimExporter.ts` must agree on `run_time`, `Wait`, cluster wall time, `timelineCursor`, and `padAfter`.
- **No duplicate or delayed camera playback** — `src/codegen/manimExporter.ts` must not emit both the old `cameraMovePlayLine` and the new schedule, and a camera starting inside an object play must begin at its authored offset.
- **Audio plays once at its scheduled time** — `src/codegen/lineCodegen.ts`, `leafConcurrentCodegen.ts`, and `manimExporter.ts` enforce early/unbound binding, offsets, deduplication, and tail ceilings.
- **Path anchors are initialized at playback time** — `src/codegen/targetAnimationCodegen.ts` currently protects this by excluding path mode; remove that protection only with delayed-path tests and real render evidence.
- **Generated Manim contracts remain intact** — `src/codegen/lineCodegen.ts` keeps `HebrewMathLine`, graph code keeps explicit axes ranges, and camera code never scales/moves scene objects to fake a zoom.
- **Authored duration remains independent of effective camera influence** — `src/lib/time.ts` and `computeSceneDurationSec` in `manimExporter.ts` must keep A `0..10` plus B `2..3` at a ten-second scene span.

### Test plan
- First reproduce and then clear the current regression from the stopped WIP:
  `npx vitest run src/codegen/manimExporter.overlap.test.ts src/codegen/targetAnimationCodegen.test.ts src/codegen/projectExporter.test.ts` (working directory `manim-timeline/`). The current baseline is 14 failures in `manimExporter.overlap.test.ts`, including `cameraClips.reduce is not a function`.
- Add `src/codegen/cameraCodegen.test.ts` blocks for standalone/partial output, absolute center and width, explicit cubic easing at quarter and three-quarter progress, non-origin full-frame return, malformed diagnostics, one camera writer, delayed start, sampled non-midpoint interruption, no resumption, hold, and no visible frame rectangle.
- Extend `src/codegen/manimExporter.overlap.test.ts` for object `0..4` plus camera `1..3` (one four-second cluster with exact camera delay and two-second motion), camera-only scenes, touching intervals, A `0..10`/B `2..3`, chained interruptions, equal-start and sub-millisecond starts, preserved return `9..10`, B `7..11` interrupted by that return, malformed data, and interior narration with the exact `time_offset`.
- Extend `src/codegen/targetAnimationCodegen.test.ts` only for delayed polyline/parametric paths and prior-target-motion setup if that branch is retained; otherwise test that the unsafe branch remains excluded.
- Extend `src/lib/time.test.ts` and `src/codegen/projectExporter.test.ts` for authored camera ends, interrupted clips, multi-scene helper isolation, and unchanged scene duration.
- Run the focused suite:
  `npx vitest run src/codegen/cameraCodegen.test.ts src/codegen/manimExporter.overlap.test.ts src/codegen/targetAnimationCodegen.test.ts src/codegen/projectExporter.test.ts src/lib/camera.test.ts src/lib/time.test.ts`
- Run the frontend gates from `manim-timeline/`: `npm run build`, `npm run test`, and `npm run lint`; record unrelated baseline lint failures separately and run touched-file ESLint cleanly.
- Before handoff to `camera-zoom-copilot-resume`, export and low-quality render a real app fixture with a non-origin frame, object animation `0..12`, zoom `5..6`, return `9..10`, delayed path variant, and short narration. Use `npm run dev` plus the existing Export panel, or save to `C:\Users\ranki\AppData\Local\Temp\opencode\camera-zoom-review.py` and run `python -m manim render "C:\Users\ranki\AppData\Local\Temp\opencode\camera-zoom-review.py" CameraZoomReview -ql --format=mp4 --media_dir "C:\Users\ranki\AppData\Local\Temp\opencode\camera-zoom-render"` from the repository root.

### Open questions

## Implementation notes (codegen-dev)

- What changed, per file.
- Deviations from the plan and why.
- Commands run and their result (paste short excerpts, not full logs).
- Anything left undone and why.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| … | … | pass / fail + one-line evidence |

- Out-of-scope changes found in the diff (files not in "Touched files"):
- Claims in "Implementation notes" that could not be confirmed:

Verdict: **pass** / **fail** (fail sends `status` back to `implementing`).

## Review notes (manim-reviewer / ui-reviewer — optional)

Findings in severity order, each with file:line and a concrete fix suggestion.

## Docs delta (docs-keeper)

- README sections touched, `*Last updated:*` trailer extended: yes/no
- ARCHITECTURE.md touched: yes/no
- idea.md item closed or updated: which
