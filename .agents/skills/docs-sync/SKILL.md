---
name: docs-sync
description: Where each kind of documentation lives in this repo and how to update it after a verified change (README sections and its Last-updated trailer, ARCHITECTURE.md, idea.md, TAURI docs). Load when closing a handoff or when asked to update docs.
---

# Docs sync

## Map

| Change type | Update |
|---|---|
| Any user-visible feature or behaviour | `manim-timeline/README.md` — the relevant section, and the `*Last updated: …*` trailer at the very end |
| Export timing / codegen behaviour | README "Export timing and audio synchronization" (+ the per-leaf duration table) and "Files to read first" |
| Project schema | README "Project file format" — add a `**Version N**` line |
| Audio features | README "Global audio timeline" and `idea.md` §3 status lines |
| Copilot (`src/agent`) | `manim-timeline/src/agent/ARCHITECTURE.md` — §3.3 kinds, §7 repairs, §8 prompt rules, §13 limitations |
| Server endpoints | README "Measure server" table and the module docstring at the top of `measure_server.py` |
| Desktop / sidecar | `manim-timeline/TAURI.md`, `scripts/README-sidecar.md`, `src-tauri/binaries/README.md` |
| Backlog | `manim-timeline/idea.md` — mark the item implemented (keep the section; add "(implemented — see handoff <slug>)") or move it to the priority shortlist |
| Agent roles / workflow | `AGENTS.md`, `.agents/skills/*`, `.opencode/agents/*`, `.cursor/agents/*` |

The root `README.md` is a short index; only touch it when the repository layout changes.

## README conventions

- Tables for behaviour matrices; prose for flow explanations.
- File paths in backticks with the `src/`-relative form used throughout.
- "Files to read first" tables at the end of complex sections; keep them current.
- The trailer is a single italic paragraph. Prepend the newest change and demote the previous
  first item to "Earlier:". Keep the whole trailer under ~12 lines; drop the oldest.

## Procedure for a handoff's "Docs delta"

1. Read the handoff's Plan and Implementation notes; list the behaviours that changed.
2. For each, find the README section by heading; update the sentence(s) that are now wrong
   rather than appending a new paragraph.
3. Extend the trailer.
4. If the change was in `idea.md`, mark the item.
5. Run `rg -n "<old term>" manim-timeline/README.md manim-timeline/src/agent/ARCHITECTURE.md`
   to catch stale mentions.
6. Fill "Docs delta" in the handoff with the exact sections touched, set `status: done`.

## Do not

- Do not restructure README headings; other docs and the handoff template link to them.
- Do not document planned work as done. Planned work goes to `idea.md`.
- Do not paste code listings into the README; reference the file and function instead.
