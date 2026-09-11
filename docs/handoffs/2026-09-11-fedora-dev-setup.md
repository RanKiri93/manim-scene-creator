---
slug: fedora-dev-setup
created: 2026-09-11
status: planned
owner_role: editor-dev
next_tool: any
source: user request
---

## Plan (architect)

### Goal
Document and verify a Fedora development setup path so a new Fedora workstation can run the Vite/React editor, the FastAPI measure/render server, the existing frontend and Python tests, and optional audio/Tauri workflows, assuming the user already has a working XeLaTeX/dvisvgm LaTeX installation.

### Non-goals
- Do not change runtime behavior, package versions, project schema, codegen output, or server endpoints.
- Do not assume Tauri desktop packaging or Whisper/audio transcription are required for baseline editor + measure server use.
- Do not install anything into the repository or vendor system packages.

### Touched files
- docs
  - `manim-timeline/README.md` — optionally expand `Running locally` with Fedora-specific system package and Python/Node setup notes.
  - `requirements-server.txt` — optionally add missing server/test extras if the team wants a checked-in Python requirements file to represent current FastAPI form/audio import needs.
  - `docs/handoffs/2026-09-11-fedora-dev-setup.md` (new) — this handoff.

### Invariants at risk
- Two-root command model — enforced by `AGENTS.md` and `manim-timeline/README.md`; npm commands must remain under `manim-timeline/`, Python server commands under the repo root.
- Frontend verification scripts — enforced by `manim-timeline/package.json`; documented commands must keep matching `dev`, `build`, `lint`, and `test` scripts.
- Server liveness contract — enforced by `measure_server.py` `/health`; setup must leave `uvicorn measure_server:app --reload --port 8765` able to return `{"status":"ok"}`.
- Hebrew/math rendering toolchain — enforced by `hebrew_tex_template.py` and `hebrew_math_line.py`; setup must preserve XeLaTeX + dvisvgm + Hebrew font availability.
- Existing Python test import surface — enforced by `test_parser.py` and `test_script_alignment.py`; documented Python dependencies must allow these tests to import `measure_server`, `numpy`, `PIL`, `pydantic`, and FastAPI route definitions.

### Test plan
- From repo root: `python3 -m venv .venv && source .venv/bin/activate`
- From repo root: `python -m pip install -U pip wheel setuptools`
- From repo root: `python -m pip install manim fastapi uvicorn[standard] python-multipart pytest`
- From repo root: `python -m pytest test_parser.py test_script_alignment.py`
- From repo root: `uvicorn measure_server:app --reload --port 8765`, then in another shell `curl http://127.0.0.1:8765/health`
- From `manim-timeline/`: `npm ci`
- From `manim-timeline/`: `npm run build`
- From `manim-timeline/`: `npm run test`
- From `manim-timeline/`: `npm run lint`
- No tests need to be added; this is environment/docs-only.

### Open questions
- Should Fedora setup instructions be committed into `manim-timeline/README.md`, or is a one-off setup answer sufficient?
- Do you want optional audio transcription/TTS parity (`gTTS`, `openai-whisper`, model downloads) and optional Tauri desktop shell setup on this Fedora machine now, or only the web app + measure/render server?
