---
name: verify-server
description: Run and interpret the Python/measure-server gates (pytest, /health, endpoint smoke checks). Use after any change to measure_server.py, hebrew_*.py, sidecar_main.py, or scripts/.
---

# Verify server

All commands run from the repo root (the folder containing `measure_server.py`), inside a
Python environment that has Manim, FastAPI, Uvicorn, and the XeLaTeX/dvisvgm toolchain.

## Gates

1. Pure-Python tests (no server needed, no LaTeX needed for `test_parser.py`):
   ```
   pytest test_parser.py test_script_alignment.py -q
   ```
   `test_script_alignment.py` imports `measure_server` (so Manim must import) but does not
   start Uvicorn.
   The other `test_*.py` at root (`test_hebrew_math_line.py`, `test_font_size.py`,
   `test_hebrew_template.py`) are Manim scene scripts for manual visual checks, not pytest
   suites; do not treat their absence from the run as a failure.
2. Import check (catches syntax errors and missing optional deps early):
   ```
   python -c "import measure_server; print(measure_server.app is not None)"
   ```
   Must print `True`. `None` means the FastAPI import block failed; read the traceback.
3. Liveness, with the server running (`uvicorn measure_server:app --port 8765`):
   ```
   curl http://127.0.0.1:8765/health
   ```
   Expect `{"status":"ok"}`.
4. Exercise the endpoint you changed once, for real. Minimal bodies:
   - `POST /measure` — `{"tex":"אם $x>0$","hebrew_font":"Alef","font_size":36,"include_preview":false}`.
     Expect `ok: true`, positive `width`/`height`, `segment_boxes` present.
   - `POST /api/preview_axes` — see `AxesPreviewRequest` in the file.
   - `POST /api/render` — only when the task is about rendering; use `"quality":"l"`. Body:
     `{"python_code": "...", "quality": "l", "scene_name": "Scene1"}`. Returns an MP4; on
     failure the `detail` contains Manim's stderr. Skill `manim-render-check` has the full
     procedure.
   - Audio endpoints (`/api/normalize_audio`, `/api/process_audio`, `/api/match_eq`,
     `/api/mixdown_audio`, `/api/generate_bed_noise`) need `ffmpeg` on PATH. Skill
     `audio-pipeline` describes inputs and outputs.

## Contract discipline

Every endpoint has a typed client in `manim-timeline/src/services/measureClient.ts`. If you
add or rename a request/response field, list the exact client delta in the handoff file under
"Implementation notes" so `editor-dev` (or you, if permitted) updates `measureClient.ts` and
the TS types in the same task. Search: `rg "api/<endpoint>" manim-timeline/src`.

## Environment gotchas

- Windows: the render endpoint sets `PYTHONUTF8=1`; if you shell out elsewhere, copy that
  pattern or Rich logging will crash on Hebrew.
- `_DATA_ROOT` differs when frozen (PyInstaller) vs. source. Paths for `assets/audio/`,
  `render_debug/` must go through the existing helpers, not `os.path.join(_ROOT, ...)`.
- Do not add top-level imports of optional packages (`gtts`, `whisper`, `librosa`); follow the
  lazy-import pattern already used so the server starts without them.
- Sidecar packaging: if you add a new Python dependency, add it to
  `scripts/measure-server.spec` `hiddenimports` and mention it in the handoff.
