"""
Frozen entry point for the measure server (PyInstaller).

Build with PyInstaller from the repo root so ``measure_server`` and Hebrew math
modules resolve. At runtime, ``sys.path`` includes the bundle directory (onedir)
or extract dir (onefile).
"""
from __future__ import annotations

import os
import sys


def _configure_sys_path() -> None:
    if getattr(sys, "frozen", False):
        # PyInstaller onefile: extracted tree is _MEIPASS; onedir: exe folder
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            sys.path.insert(0, meipass)
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        sys.path.insert(0, exe_dir)
        os.chdir(exe_dir)
    else:
        root = os.path.dirname(os.path.abspath(__file__))
        if root not in sys.path:
            sys.path.insert(0, root)


_configure_sys_path()

import uvicorn  # noqa: E402

from measure_server import app  # noqa: E402

if app is None:
    raise SystemExit("FastAPI app failed to import (missing fastapi?).")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
