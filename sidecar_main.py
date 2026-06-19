"""
Frozen entry point for the measure server (PyInstaller).

Build with PyInstaller from the repo root so ``measure_server`` and Hebrew math
modules resolve. At runtime, ``sys.path`` includes the bundle directory (onedir)
or extract dir (onefile).
"""
from __future__ import annotations

import os
import runpy
import sys


def _configure_sys_path() -> None:
    if getattr(sys, "frozen", False):
        # PyInstaller onefile: extracted tree is _MEIPASS; onedir: exe folder
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            sys.path.insert(0, meipass)
            bundled_ffmpeg = os.path.join(meipass, "ffmpeg")
            if os.path.isdir(bundled_ffmpeg):
                os.environ["PATH"] = bundled_ffmpeg + os.pathsep + os.environ.get("PATH", "")
            bundled_models = os.path.join(meipass, "whisper_models")
            if os.path.isdir(bundled_models):
                os.environ.setdefault("MANIM_TIMELINE_WHISPER_MODEL_DIR", bundled_models)
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        sys.path.insert(0, exe_dir)
        local_app_data = os.environ.get("LOCALAPPDATA") or exe_dir
        data_dir = os.path.join(local_app_data, "Manim Timeline", "measure-server")
        os.environ.setdefault("MANIM_TIMELINE_DATA_DIR", data_dir)
        if not (len(sys.argv) >= 3 and sys.argv[1] == "-m" and sys.argv[2] == "manim"):
            os.chdir(exe_dir)
    else:
        root = os.path.dirname(os.path.abspath(__file__))
        if root not in sys.path:
            sys.path.insert(0, root)


_configure_sys_path()


def _run_manim_cli_if_requested() -> bool:
    if len(sys.argv) >= 3 and sys.argv[1] == "-m" and sys.argv[2] == "manim":
        if sys.platform == "win32":
            os.environ.setdefault("PYTHONUTF8", "1")
            os.environ.setdefault("PYTHONIOENCODING", "utf-8")
            try:
                import ctypes

                ctypes.windll.kernel32.SetConsoleOutputCP(65001)
                ctypes.windll.kernel32.SetConsoleCP(65001)
            except Exception:
                pass
            for stream in (sys.stdout, sys.stderr):
                try:
                    stream.reconfigure(encoding="utf-8", errors="replace")
                except Exception:
                    pass
        sys.argv = ["manim", *sys.argv[3:]]
        runpy.run_module("manim", run_name="__main__", alter_sys=True)
        return True
    return False


if __name__ == "__main__" and _run_manim_cli_if_requested():
    raise SystemExit(0)

import uvicorn  # noqa: E402

from measure_server import app  # noqa: E402

if app is None:
    raise SystemExit("FastAPI app failed to import (missing fastapi?).")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
