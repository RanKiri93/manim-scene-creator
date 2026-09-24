---
slug: vite-tauri-watch
created: 2026-09-23
status: done
owner_role: editor-dev
next_tool: any
source: user startup error report
---

## Plan (architect)

### Goal
Prevent Vite's frontend watcher from watching Tauri Rust build artifacts, which
triggered a Windows EBUSY watch error on target/debug/deps/manim_timeline.exe.

### Non-goals
Changing Rust build behavior or the launcher; clearing build caches.

### Touched files
- Configuration: manim-timeline/vite.config.ts — ignore src-tauri in Vite's watcher.
- Docs: manim-timeline/TAURI.md — explain the Windows watcher error and exclusion.
- Docs: manim-timeline/README.md — extend the last-updated trailer.
- Docs: this handoff (new).

### Invariants at risk
Frontend source hot reload must remain enabled. Tauri continues to watch its own
Rust sources independently.

### Test plan
From manim-timeline/: npm run build; npm run test;
npx eslint vite.config.ts. Inspect Vite resolved watch configuration and confirm
the exclusion matches the reported src-tauri/target/debug/deps executable path.
Full desktop startup is a manual follow-up; do not claim it passed without running it.

### Open questions
None.

## Implementation notes (editor-dev)

- Added server.watch.ignored with **/src-tauri/** to vite.config.ts.
- The screenshot shows EBUSY from Node's FSWatcher on a Rust-generated executable;
  the existing configuration did not exclude src-tauri.
- No dependencies, persisted data, or application UI changed.
- Verification delegated below; no full desktop launch performed.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Build | `npm run build` (from `manim-timeline/`) | pass — `✓ 287 modules transformed` and `✓ built in 1.10s` (chunk-size warning only). |
| Tests | `npm run test` (from `manim-timeline/`) | pass — `Test Files  49 passed (49)` / `Tests  433 passed (433)`. |
| Targeted lint | `npx eslint vite.config.ts` (from `manim-timeline/`) | pass — command exited 0 with no output. |
| Resolved Vite watch config | `node -e "import('vite').then(async ({ resolveConfig }) => { const cfg = await resolveConfig({}, 'serve'); console.log(JSON.stringify({ watchIgnored: cfg.server && cfg.server.watch && cfg.server.watch.ignored }, null, 2)); })"` | pass — resolved `watchIgnored` is `["**/src-tauri/**"]`, matching `src-tauri/target/debug/deps/manim_timeline.exe`. |

- Diff/scope check: `git status --short` showed `M manim-timeline/vite.config.ts` and this new handoff; `git diff --stat` showed only `manim-timeline/vite.config.ts | 4 ++++`. Both changed files are in the plan's Touched files.
- Invariants checked: the `vite.config.ts` diff only adds `server.watch.ignored: ['**/src-tauri/**']`; frontend `src/` is not ignored, and no Tauri/Rust watcher config was changed.
- Out-of-scope changes found in the diff (files not in "Touched files"): none.
- Claims in "Implementation notes" that could not be confirmed: the screenshot itself was not available for independent inspection; full desktop startup was not run per plan.

Verdict: **pass**.

## Docs delta (docs-keeper)

- README Tauri section and Last updated trailer extended; older trailer history
  trimmed per docs-sync conventions.
- TAURI.md explains Windows EBUSY and switching between Windows and Fedora with
  OS-local dependencies/build artifacts. Both node_modules and src-tauri/target
  are already Git-ignored; OneDrive synchronization does not follow Git ignores.
- User supplied Windows/Fedora context after verification. No further code change
  was needed; the Vite exclusion is platform-independent.
- ARCHITECTURE.md and idea.md: no changes needed.
- Docs role model was unavailable; orchestrator completed documentation directly.
- Full desktop startup remains a manual follow-up.
