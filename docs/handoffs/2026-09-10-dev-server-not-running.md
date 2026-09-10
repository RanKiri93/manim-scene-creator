---
slug: dev-server-not-running
created: 2026-09-10
status: planned
owner_role: editor-dev
next_tool: cursor
source: user request
---

## Plan (architect)

### Goal
Make the current Manim Timeline frontend reachable at `http://localhost:5173/` for user inspection, using the existing Vite dev server and without changing app behavior.

### Non-goals
Do not modify source code, run Tauri, start Manim renders, or start the measure server unless the user requests server-backed measure/render/audio features during inspection.

### Touched files
- docs
  - `docs/handoffs/2026-09-10-dev-server-not-running.md` (new) — records the plan to bring up the dev server.
- UI
  - No UI source files should be edited.
- server
  - No server files should be edited.

### Invariants at risk
- `npm` commands must run from `manim-timeline/`, enforced by `AGENTS.md` and `manim-timeline/README.md` §Running locally.
- Vite dev URL should remain the standard `http://localhost:5173/`, enforced by `manim-timeline/package.json` script `dev: vite` and documented in `manim-timeline/README.md` §Frontend.
- Existing uncommitted work must not be disturbed, enforced by `AGENTS.md` git-status-first rule.

### Test plan
- Confirm current state: request `http://127.0.0.1:5173/` or `http://localhost:5173/`; it should fail before startup and return HTTP 200 after startup.
- Start from `manim-timeline/`: `npm run dev -- --host 127.0.0.1`
- Browser check: open `http://localhost:5173/` and confirm the editor loads.
- No test files should be added or changed. If dependency installation or source changes become necessary, run from `manim-timeline/`: `npm run build`, `npm run test`, and `npm run lint`.

### Open questions
None.
