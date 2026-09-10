# Manim Timeline — agent brief

Read by OpenCode and Cursor at session start. Keep this file short; long procedures live in
`.agents/skills/*/SKILL.md` and are loaded on demand.

## What this repo is

An all-in-one editor for Manim videos with Hebrew + math text: React timeline editor
(`manim-timeline/`), a FastAPI measure/render/audio server (`measure_server.py`), shared
Python modules for Hebrew LaTeX (`hebrew_math_line.py`, `hebrew_math_parser.py`,
`hebrew_tex_template.py`), an in-app AI Copilot (`manim-timeline/src/agent/`), and an
optional Tauri desktop shell (`manim-timeline/src-tauri/`).

Canonical docs, in order of authority:
1. `manim-timeline/README.md` — features, export/timing model, project format. Ends with a
   `*Last updated: …*` trailer that must be extended when behaviour changes.
2. `manim-timeline/src/agent/ARCHITECTURE.md` — the in-app Copilot.
3. `manim-timeline/idea.md` — backlog and priority shortlist.
4. `manim-timeline/TAURI.md`, `scripts/README-sidecar.md` — desktop packaging.

## Two roots, two toolchains

| Work | Run from | Commands |
|---|---|---|
| Frontend | `manim-timeline/` | `npm run build` (= `tsc -b && vite build`), `npm run test` (vitest), `npm run lint`, `npm run dev` |
| Server / Python | repo root | `uvicorn measure_server:app --reload --port 8765`, `pytest test_parser.py test_script_alignment.py`, `curl http://127.0.0.1:8765/health` |
| Desktop | `manim-timeline/` | `npm run tauri:dev` (needs Rust + MSVC; usually not required) |

Never run `npm` from the repo root. Shell is PowerShell on Windows: no `head`/`tail`; use
`Select-Object -First N` or `rg`.

## Layering (enforced by review)

`src/types/` (pure models, no React) → `src/lib/` (pure math/time/layout, shared by preview and
export) → `src/codegen/` (deterministic string generation) → `src/store/` (single source of
truth, zundo undo) → `src/canvas/`, `src/timeline/`, `src/panels/` (presentation only: read
store, dispatch actions). Logic that both the canvas preview and the Manim export need belongs
in `src/lib/`, never in a component.

## Verification gates (a task is not done until these pass)

- Frontend change: `npm run build` and `npm run test` green; `npm run lint` clean for touched files.
- Codegen change: additionally a test in `src/codegen/*.test.ts` covering the new emitted
  Python, and the per-leaf duration table in README "Per-leaf duration accuracy" still holds.
- `types/scene.ts` change that alters persisted shape: `PROJECT_VERSION` bump + migration +
  migration test (skill `project-schema-migration`).
- Server change: `pytest test_parser.py test_script_alignment.py` green, `/health` returns
  `{"status":"ok"}`, and the affected endpoint exercised once for real.
- Copilot change: `npx vitest run src/agent` green and both schemas (canonical + Gemini flat)
  updated together.

There is no CI. The `verifier` role is the CI.

## Hard rules

- Only `HebrewMathLine` for text in generated Manim; never `Text`/`Tex`/`MathTex`. Axes always
  get explicit `x_range`/`y_range`. Full rules: `.cursor/rules/*.mdc`.
- Do not read or list `assets/audio/`, `media/`, `render_debug/`, `node_modules/`,
  `src-tauri/target/`, `src-tauri/binaries/*.exe`. They are large binaries.
- Run `git status` before editing. Uncommitted files you did not create are someone's work in
  progress; do not revert, reformat, or "clean up" them unless the task says so.
- Never call `git push`, `git reset --hard`, `git checkout -- <file>`, or delete branches
  without explicit instruction. Commits are fine when a command or handoff asks for one.
- Rendering with Manim is slow (minutes). Use `-ql` and only when a handoff or the
  `manim-reviewer` role needs it.
- Copilot API keys live in browser `localStorage`; never hardcode keys or write them to files.
- `measure_server.py` runs TeX with shell escape; do not add endpoints that pass user strings
  into TeX or a shell without going through the existing helpers.

## Working model: roles and handoffs

Work flows `architect → <domain>-dev → verifier → (reviewers) → docs-keeper`. The contract
between roles is a file `docs/handoffs/<yyyy-mm-dd>-<slug>.md` created from
`docs/handoffs/TEMPLATE.md`. Each role appends its own section and never rewrites an earlier
one. The file's frontmatter (`status`, `owner_role`, `next_tool`) is the only place task
status lives. Handoff files are committed.

Roles are defined per tool in `.opencode/agents/` and `.cursor/agents/`. Their prompts are
short on purpose; the domain knowledge they need is in `.agents/skills/`.
