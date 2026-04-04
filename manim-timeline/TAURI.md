# Tauri + measure-server sidecar

This app can run as a **desktop shell** (Tauri) with a **PyInstaller** build of `measure_server` registered as an **external binary** (sidecar). Spawning is done from **Rust** (`src-tauri/src/main.rs`); the React UI is unchanged.

## Prerequisites (required for `npm run tauri:dev`)

Tauri shells out to **`cargo`**. If you see:

`failed to run 'cargo metadata' ... program not found`

then **Rust is not installed** or **Cargo is not on your PATH** (e.g. new terminal after install, or IDE terminal not picking up `PATH`).

1. Install **Rust** with [rustup](https://rustup.rs/) (includes `cargo` and `rustc`).
2. **Windows:** Install **Visual Studio Build Tools** with the **“Desktop development with C++”** workload (MSVC + Windows SDK). Tauri needs this to compile the native shell. [Microsoft’s guide](https://learn.microsoft.com/en-us/visualstudio/install/workload-component-id-vs-build-tools) / [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
3. Close and reopen the terminal (or sign out/in), then verify:

   ```bash
   cargo --version
   rustc --version
   ```

4. Optional: `npx tauri info` should show rustc/cargo detected.

**Web-only (no Tauri):** you do **not** need Rust. Use `npm run dev` and run `measure_server` with Uvicorn separately, as in the main README.

**Windows icon:** `tauri-build` expects **`src-tauri/icons/icon.ico`** for the `.exe` resource. If you see `icons/icon.ico not found`, add that file (e.g. `npx tauri icon your.png` or keep the repo’s generated `icons/icon.ico`).

## Phase 1 — PyInstaller

- **Entry:** `../sidecar_main.py` (repo root `ManimStuff/`) imports `measure_server:app` and runs Uvicorn on `127.0.0.1:8765`.
- **Spec:** `../scripts/measure-server.spec` — extend `hiddenimports` / `datas` if Manim misses modules.
- **Build scripts:** `../scripts/build-measure-sidecar.ps1` (Windows) and `../scripts/build-measure-sidecar.sh` (Unix) run PyInstaller and copy the executable to:
  - `manim-timeline/src-tauri/binaries/measure-server-<rust-host-triple>.exe` (or no `.exe` on Unix).

## Phase 2 — `tauri.conf.json`

- **`bundle.externalBin`:** To **embed** the PyInstaller exe in the installer, add:

  ```json
  "externalBin": ["binaries/measure-server"]
  ```

  inside `"bundle"`, **after** the file exists at  
  `src-tauri/binaries/measure-server-<target-triple>.exe`  
  (see `scripts/build-measure-sidecar.ps1`). If this entry is present **without** that file, **`cargo` / `tauri dev` will fail** with  
  `resource path 'binaries\measure-server-….exe' doesn't exist`.

  The default repo config **omits** `externalBin` so `tauri dev` works **without** building the heavy Python bundle first; run `measure_server` with Uvicorn manually on port 8765, or build the sidecar and add the JSON entry when you want the desktop app to spawn it.

- **Permissions:** Spawning the sidecar from **Rust** does not require `shell` IPC permissions for the webview. Capabilities in `capabilities/default.json` are for the window only. If you later **invoke** the sidecar from JavaScript, add a scoped `shell:allow-execute` entry per [Tauri sidecar docs](https://v2.tauri.app/develop/sidecar/).

## Phase 3 — Rust

- **`tauri-plugin-shell`** provides `ShellExt::sidecar("measure-server")` and `CommandEvent` for stdout/stderr.
- **Lifecycle:** `App::run` handles `RunEvent::Exit`; `on_window_event` handles `CloseRequested` — both call `kill()` on the child.
- If the binary is missing (e.g. dev without build), the app still starts and logs to the console.

## Phase 4 — Frontend

- **`src/services/useSidecarStatus.ts`** — polls `GET /health` until `{ status: "ok" }`. Wire it where you need “server ready” (optional; not imported by existing components).

## Commands

Run these from **`manim-timeline/`** (where `package.json` is), not from `ManimStuff/`.

```bash
cd manim-timeline
npm install
npm run tauri:dev      # Vite + Tauri (needs cargo — see Prerequisites)
npm run tauri:build    # production bundle
```

Requires **Node**, **Rust/Cargo on PATH**, **Windows: MSVC build tools**, and (for a real sidecar) a built binary under `src-tauri/binaries/`.
