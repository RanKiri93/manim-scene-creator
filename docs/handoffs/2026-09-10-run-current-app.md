---
slug: run-current-app
created: 2026-09-10
status: planned
owner_role: editor-dev
next_tool: cursor
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
Start the existing Manim Timeline frontend in its current checkout so the user can open the Vite dev server in a browser and inspect the app without changing application behavior.

### Non-goals
Do not modify source code, install or upgrade dependencies unless `npm run dev` reports missing packages, start the optional Tauri shell, or run a Manim render. Do not start the measure server unless the user specifically wants measurement/render/audio endpoints while inspecting the app.

### Touched files
- docs
  - `docs/handoffs/2026-09-10-run-current-app.md` (new) — records the run-only plan.
- UI
  - No UI source files should be edited.
- server
  - No server files should be edited.

### Invariants at risk
- Frontend dev script remains `vite` in `manim-timeline/package.json`; running locally must use `npm` from `manim-timeline/`, as documented in `AGENTS.md` and `manim-timeline/README.md` §Running locally.
- Repository WIP must not be disturbed; enforced operationally by `AGENTS.md` lines 60-61 and the initial `git status` check.
- Optional `/health` liveness is only relevant if the measure server is started; enforced by `measure_server.py` and documented in `manim-timeline/README.md` §Measure server.

### Test plan
- From `manim-timeline/`: `npm run dev -- --host 127.0.0.1`
- Smoke check in a second terminal: `Invoke-WebRequest -Uri "http://127.0.0.1:5173/" -UseBasicParsing -TimeoutSec 10`
- Browser check: open `http://localhost:5173/` and confirm the editor loads.
- No test files should be added or changed because this is a run-only task. If any code/dependency change becomes necessary, run from `manim-timeline/`: `npm run build`, `npm run test` (existing Vitest files under `src/**/*.test.ts`), and `npm run lint`.

### Open questions
None.

## Implementation notes (<owner_role>)

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
