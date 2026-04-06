# ManimStuff

This repository holds **Manim-related tooling** for Hebrew and mathematical video content. The primary maintained application is **`manim-timeline/`** — a React + TypeScript editor with a timeline, Konva frame preview, and Python export. Supporting assets live at the **repository root** (measure server, Hebrew LaTeX helpers).

---

## Repository layout

| Path | Description |
|------|-------------|
| **`manim-timeline/`** | **Main application** — Vite + React 19, Zustand, Konva. See **[manim-timeline/README.md](manim-timeline/README.md)** for full documentation (features, export model, audio timeline, compound clips, dev setup, Tauri). |
| **`measure_server.py`** | **FastAPI** service: LaTeX measurement for previews, optional **gTTS + Whisper** for the Audio panel, audio upload, Manim **`POST /api/render`** (MP4 or transparent **WebM** via `is_web_export`), **`GET /health`**. Run with **Uvicorn** alongside the Vite dev server. |
| **`hebrew_math_line.py`**, **`hebrew_math_parser.py`**, … | Python modules used by Manim scenes and by the measure server for layout and styling. |

---

## Quick start (Manim Timeline)

```bash
cd manim-timeline
npm install
npm run dev
```

In another terminal, from **this directory** (repo root):

```bash
pip install fastapi uvicorn
uvicorn measure_server:app --reload --port 8765
```

Open the app at **http://localhost:5173/** and ensure the measure URL is **http://127.0.0.1:8765** (default).

For **TTS and mic transcription** on the Audio timeline, install optional server deps (e.g. `gtts`, `openai-whisper`) — details in **`manim-timeline/README.md`**.

---

## Documentation index

- **[manim-timeline/README.md](manim-timeline/README.md)** — Elaborate guide: architecture, audio export alignment, compound clips, project JSON, troubleshooting.
- **`manim-timeline/TAURI.md`** — Desktop build with Tauri (Rust, Windows MSVC).
- **`manim-timeline/src-tauri/binaries/README.md`** — Optional PyInstaller sidecar for the measure server.

---

## Requirements (summary)

- **Node.js** (current LTS recommended) for `manim-timeline`.
- **Python 3** with **Manim** and project Hebrew math modules for measurement and rendering.
- **Rust + MSVC** (Windows) only if you build the Tauri desktop target.

---

*For feature-level documentation, always prefer **manim-timeline/README.md**.*
