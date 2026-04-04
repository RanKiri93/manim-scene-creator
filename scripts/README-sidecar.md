# Measure server sidecar (PyInstaller → Tauri)

1. Activate a Python environment with **Manim**, **FastAPI**, **Uvicorn**, and the same deps as `measure_server.py` at the repo root.
2. **Optional (Audio tab parity):** install **`gTTS`** and **`openai-whisper`** in that environment if you want the bundled exe to serve `POST /api/generate_audio` and `POST /api/upload_audio`. Whisper pulls model weights at runtime on first use (large disk/network). PyInstaller may need extra `hiddenimports` / data files for Whisper — treat audio APIs as advanced when packaging.
3. From **`ManimStuff/`** run:
   - **Windows:** `.\scripts\build-measure-sidecar.ps1`
   - **Unix:** `bash scripts/build-measure-sidecar.sh`
4. The script copies the built executable to  
   `manim-timeline/src-tauri/binaries/measure-server-<rust-host-triple>.exe` (or without `.exe` on Unix).

Tauri’s `bundle.externalBin` entry `binaries/measure-server` resolves to that file per target.

If PyInstaller misses imports, re-run with `--log-level=DEBUG` or add `hiddenimports` / `datas` in `measure-server.spec`. Manim often needs extra hooks; see [PyInstaller docs](https://pyinstaller.org).
