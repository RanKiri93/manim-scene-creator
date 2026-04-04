# Sidecar binary (optional)

After running `scripts/build-measure-sidecar.ps1` (from `ManimStuff/`), copy the built exe here as:

`measure-server-x86_64-pc-windows-msvc.exe` (name matches `rustc -vV` host triple).

The sidecar is the same **`measure_server.py`** stack as dev Uvicorn: LaTeX measurement plus optional **gTTS / Whisper** endpoints if those packages were included in the PyInstaller build (see **`scripts/README-sidecar.md`**).

Then add to `tauri.conf.json` under `"bundle"`:

```json
"externalBin": ["binaries/measure-server"]
```

Without both the file **and** that entry, the Rust shell can still run the app; `sidecar("measure-server")` will log an error unless the binary is bundled (see `TAURI.md`).
