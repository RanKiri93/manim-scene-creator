# -*- mode: python ; coding: utf-8 -*-

import os
import shutil

from PyInstaller.utils.hooks import (
    collect_data_files,
    collect_dynamic_libs,
    collect_submodules,
)


block_cipher = None
project_root = os.path.abspath(os.path.join(SPECPATH, ".."))


def optional_submodules(package):
    try:
        return collect_submodules(package)
    except Exception:
        return []


def optional_data_files(package):
    try:
        return collect_data_files(package)
    except Exception:
        return []


hiddenimports = [
    "fastapi",
    "fastapi.middleware.cors",
    "fastapi.responses",
    "fastapi.staticfiles",
    "starlette.background",
    "uvicorn",
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
    "hebrew_math_line",
    "hebrew_math_parser",
    "hebrew_tex_template",
]
hiddenimports += collect_submodules("manimpango")
hiddenimports += optional_submodules("whisper")
hiddenimports += optional_submodules("tiktoken")
hiddenimports += optional_submodules("tiktoken_ext")
hiddenimports += optional_submodules("gtts")

datas = [
    (os.path.join(project_root, "hebrew_math_line.py"), "."),
    (os.path.join(project_root, "hebrew_math_parser.py"), "."),
    (os.path.join(project_root, "hebrew_tex_template.py"), "."),
]
datas += collect_data_files("manim")
datas += collect_data_files("manimpango")
datas += optional_data_files("whisper")
datas += optional_data_files("tiktoken")
datas += optional_data_files("tiktoken_ext")

whisper_model = os.path.join(os.path.expanduser("~"), ".cache", "whisper", "base.pt")
if os.path.isfile(whisper_model):
    datas.append((whisper_model, "whisper_models"))

binaries = []
binaries += collect_dynamic_libs("manimpango")

ffmpeg = shutil.which("ffmpeg")
if ffmpeg:
    binaries.append((ffmpeg, "ffmpeg"))
ffprobe = shutil.which("ffprobe")
if ffprobe:
    binaries.append((ffprobe, "ffmpeg"))

a = Analysis(
    [os.path.join(project_root, "sidecar_main.py")],
    pathex=[project_root],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "pytest",
        "tensorboard",
        "tensorflow",
        "tkinter",
        "torchaudio",
        "torchvision",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    exclude_binaries=False,
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
