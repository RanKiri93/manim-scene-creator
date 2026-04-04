# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for measure_server (Manim + FastAPI + HebrewMathLine).
#
# Usage (from repo root ``ManimStuff/``, with a venv that has manim, fastapi, etc.):
#   pip install pyinstaller
#   pyinstaller scripts/measure-server.spec
#
# Output (onedir, recommended for large Manim stacks):
#   dist/measure-server/measure-server(.exe)
#
# Copy the executable to Tauri (see scripts/README-sidecar.md). Tauri expects:
#   manim-timeline/src-tauri/binaries/measure-server-<target-triple>.exe
#
# You will likely need to extend ``hiddenimports`` / ``datas`` after a test run
# if PyInstaller misses dynamic imports (run the exe once and check stderr).

from pathlib import Path

# SPEC is provided by PyInstaller — path to this file (…/scripts/measure-server.spec)
ROOT = Path(SPEC).resolve().parent.parent  # ManimStuff/

block_cipher = None

# Project Python sources to bundle as data if not picked up automatically
datas = [
    (str(ROOT / "hebrew_math_line.py"), "."),
    (str(ROOT / "hebrew_math_parser.py"), "."),
    (str(ROOT / "hebrew_tex_template.py"), "."),
    (str(ROOT / "measure_server.py"), "."),
]

a = Analysis(
    [str(ROOT / "sidecar_main.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=[
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "pydantic",
        "fastapi",
        "starlette",
        "anyio",
        "manim",
        "manim.utils",
        "PIL",
        "numpy",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="measure-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="measure-server",
)
