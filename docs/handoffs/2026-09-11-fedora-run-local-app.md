---
slug: fedora-run-local-app
created: 2026-09-11
status: planned
owner_role: editor-dev
next_tool: any
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
Make the local Fedora development path explicit so a user can start the React/Vite editor and the FastAPI measure server in separate terminals, verify server liveness, and point the app at the default measure URL.

### Non-goals
Do not change application behavior, server endpoints, export/codegen, persisted project shape, Tauri packaging, or audio/render pipeline behavior. Do not replace the existing cross-platform README instructions; add Fedora-specific notes only if documentation is updated later.

### Touched files
- docs/
  - `manim-timeline/README.md` — optional documentation-only addition under “Running locally” with Fedora package/setup commands and the two-terminal run sequence.

### Invariants at risk
- `npm` commands must run only from `manim-timeline/`; enforced by `AGENTS.md` and documented in `manim-timeline/README.md`.
- Measure server liveness must remain `GET /health -> {"status":"ok"}`; enforced by `measure_server.py` and documented in `manim-timeline/README.md`.
- Default app measure URL must remain `http://127.0.0.1:8765`; enforced by `manim-timeline/src/lib/constants.ts` and surfaced by `manim-timeline/src/services/measureClient.ts`.

### Test plan
- Documentation-only update: no unit tests need to be added or extended.
- Exact smoke commands to validate the documented flow:
  - From repo root: `python -m uvicorn measure_server:app --host 127.0.0.1 --port 8765`
  - From repo root in another terminal: `curl http://127.0.0.1:8765/health` and expect `{"status":"ok"}`
  - From `manim-timeline/`: `npm run dev -- --host 127.0.0.1`
  - Open `http://localhost:5173/` and confirm app settings use `http://127.0.0.1:8765`.

### Open questions
Empty.

## Implementation notes (<owner_role>)

## Verification (verifier)

## Review notes (manim-reviewer / ui-reviewer — optional)

## Docs delta (docs-keeper)
