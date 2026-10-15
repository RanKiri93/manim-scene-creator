---
slug: text-line-typed-segment-order
created: 2026-10-15
status: planned
owner_role: server-dev
next_tool: any
source: user request (text-object rethink, step 1 of 4; see "Context" below)
---

<!--
Copy this file to docs/handoffs/<created>-<slug>.md.
Each role appends ONLY its own section. Never edit a section written by an earlier role;
add a dated note under your own section instead. Update the frontmatter `status`,
`owner_role`, and `next_tool` when you hand off.
-->

## Plan (architect)

### Context

The user wants text lines to support English (inside Hebrew lines now, and whole English lines
later) and to be easier to work with. Agreed sequence:

1. **This handoff.** One segment order everywhere (the typed order), and one parser (TS) for
   text lines. Groundwork; no persisted-shape change, no visible change for normal lines.
2. Segment kinds `he` / `en` / `math`, `\en{…}` / `\he{…}` markup, per-line `baseDir`
   (`rtl` default, `ltr` option), a phantom generator that keeps one LR/RL group around each
   embedded run. Schema bump + Copilot schemas.
3. Stable segment ids; edits to `raw` keep per-segment style/timing; blink / `next_to` /
   transform reference ids instead of indices. Schema bump.
4. Spike: compile a line once (colour-tagged segments, split SVG by fill) instead of once per
   segment.

Later and separate: replace `animSec` + `waitAfterSec` with per-segment start/length cues.

User decisions so far: English appears mostly inside Hebrew lines today, but whole English
lines will come, so `baseDir` is needed (default `rtl`). The user writes no Manim code outside
the app, so `HebrewMathLine`'s Python string API has no external compatibility constraint
(it is still used internally for axis, dot and surround labels; keep it working).

### Problem being fixed

- `HebrewMathLine._sort_glyphs_for_bidi` (`hebrew_math_line.py`) reorders the top-level
  submobjects by screen x, right to left. Everything in the app (`SegmentStyle[i]`,
  `lineCodegen` `line[i].set_color`, `Write(line[i])` in the segment `Succession`,
  `TextLineNode` pairing `segments[i]` with `segmentMeasures[i]`, the Copilot prompt) assumes
  `line[i]` is the i-th segment **as typed**. These agree for single-row Hebrew + `$math$`
  lines (each segment is one box in an RTL paragraph, so typed order is already right to
  left), and disagree for: `\\` multi-row lines, whitespace-only `||` pieces (their sort key is
  forced to 0, so they land mid-line), and every LTR / English case that step 2 adds.
- The measure server works around it by matching segments by text
  (`_map_parse_index_to_line_index`, `_content_matches_after_style_wrap`), which pairs
  identical segments (two `$x$`) arbitrarily.
- The measure server builds the line from `tex` (single-string parse in Python), while export
  builds it from the pre-split parts made by `buildExportParts` (TS). Two parsers, two
  constructor paths. They already differ: TS `parseSegments` turns `\$` into `$`, Python keeps
  `\$`, so a text segment like `עולה \$5` exports as a bare `$` inside TEXT (TeX math toggle).

### Goal

`line[i]` is the i-th segment in the order the user typed it, in the exported scene, in the
measure server's boxes, in the preview and in the editor. The measure server builds the line
from exactly the parts the exporter emits. The TS parser is the only parser for text lines; a
shared fixture file keeps the Python string parser (used for labels) in agreement with it.
For ordinary single-row Hebrew + math lines, nothing the user sees or exports changes.

### Non-goals

- No `kind` field, no `\en{}`, no `baseDir` (step 2).
- No persisted-shape change, no `PROJECT_VERSION` bump.
- No change to the `HebrewMathLine(...)` call shape emitted by `lineCodegen.ts`. **Do not edit
  `lineCodegen.ts`**: it carries uncommitted WIP owned by
  `2026-10-15-export-preview-timing-parity` (status `implementing`).
- No change to per-glyph order inside a segment (TEXT right to left, MATH left to right).
- No rebuild of `dist/measure-server/` (packaged sidecar copy).
- Labels (`graphCodegen`, `surroundCodegen`) keep the single-string form.

### Touched files

Stage A — server-dev (Python):

- `hebrew_math_line.py` — in `_sort_glyphs_for_bidi`, keep the per-segment glyph sort, remove
  the top-level reorder of `self.segments` / `self.submobjects`. Update the class and method
  docstrings: "`line[i]` is the i-th segment in the order given", and `Write(line)` reveals
  in typed order (which is reading order).
- `measure_server.py`
  - `MeasureRequest`: add optional `parts: list[str] | None` — the exact strings the exporter
    passes to `HebrewMathLine(...)` (math already `$…$`-wrapped, bold/italic already applied).
    When present, build `HebrewMathLine(*parts, **kwargs)` and ignore `tex` for construction.
  - Without `parts` (old clients, `verify-server` skill example): parse `tex`, apply
    bold/italic wraps, and still construct with the multi-arg form, so both paths match export.
  - `_apply_segment_styles`: colour `line[parse_index]` directly. Delete
    `_map_parse_index_to_line_index`, `_content_matches_after_style_wrap` and
    `_build_styled_tex` once unused.
  - Fix docstrings that say "after BIDI sort" / "visual order" (`MathChildBoxOut`, etc.).
- `test_hebrew_math_line.py` — new tests (see Test plan).
- `test_parser.py` — load the shared fixture file and assert `parse_segments` matches it.
- `scripts/audit_segment_order.py` (new) — read-only audit, see Open questions.

Stage B — editor-dev (TS; `codegen/texUtils.ts` edits need the usual ask):

- `src/codegen/texUtils.ts` — `parseSegments` keeps `\$` as `\$` in text and math (matching
  Python). `buildExportParts` stays the single place that turns segments into constructor
  strings.
- `src/codegen/__fixtures__/segmentParse.json` (new) — `[{ "raw": "...", "segments":
  [{ "text": "...", "isMath": bool }] }]`. Cover: plain Hebrew; Hebrew + math; math first /
  last; adjacent math; `||` splits incl. leading/trailing/empty pieces; `||` inside math;
  `\$` in text and in math; empty string; whitespace-only pieces.
- `src/codegen/texUtils.test.ts` (new or extend) — read the fixture with `fs.readFileSync`
  (no `resolveJsonModule` in tsconfig) and assert `parseSegments` matches; add a
  `buildExportParts` case showing `\$` survives into the emitted part.
- `src/services/measureClient.ts` — send `parts: buildExportParts(item.raw, item.segments)`
  alongside `tex`. `segment_styles` keeps `parse_index: i`, which is now also `line[i]`.

Stage C — docs-keeper:

- `.cursor/rules/manim-text-and-point-accuracy.mdc` "Segment addressing" — currently says
  indices are visual right-to-left order; rewrite to typed order.
- `.agents/skills/codegen-invariants/SKILL.md` Text bullet "boxes in the same visual order" →
  typed order. That file has unrelated uncommitted WIP; change only this bullet.
- `manim-timeline/README.md` — one line under text segments + `*Last updated:*` trailer.
  README also has unrelated uncommitted WIP; touch only those lines.
- `src/agent/ARCHITECTURE.md` l.501 already says parse order; confirm, no change expected.

### Invariants at risk

- **Existing projects' segment indices.** For lines where legacy order ≠ typed order, stored
  per-segment colours, blink `segmentIndices`, `next_to` `refSegmentIndex` /
  `selfSegmentIndex`, transform `segmentPairs` and `mathChildMeasures.segmentIndex` would
  point at a different segment after the change. They become *correct* relative to what the
  user typed in the editor, but a project exported before and after may differ. Scope this
  with the audit before merging (Open questions).
- **Write order of whole-line `Write(line)`**: now typed order. Same as before for single-row
  RTL lines.
- **Preview/export parity**: measure boxes and the PNG must come from the same parts as the
  export. After Stage B, a line with bold/italic and a line without must both measure via
  `parts`.
- **Labels**: axis / dot / surround labels still go through Python `parse_segments`; the
  fixture parity test is what keeps them consistent with text lines.
- **Timing**: no emitted seconds change, so the timing sweep is not required; run it anyway
  only if any codegen file other than `texUtils.ts` ends up touched.

### Test plan

Stage A (repo root):

- `pytest test_parser.py test_script_alignment.py test_hebrew_math_line.py`
- New in `test_hebrew_math_line.py` (needs xelatex, like the existing tests there):
  - `test_submobjects_follow_given_order` — for `"אם", "$f(x)$", "רציפה", "$[a,b]$"`,
    `line.segments[i].content` equals the i-th argument.
  - `test_typed_order_matches_legacy_for_single_row_rtl` — for a small corpus of single-row
    Hebrew + math lines (adjacent math, `||` splits, digits and punctuation in text), the
    typed order equals the old right-to-left sort by segment centre x (compute the legacy
    order inside the test from the built line). This is the "no visible change" claim.
  - `test_whitespace_only_segment_keeps_position` — a `||` piece that is only spaces stays at
    its typed index.
- `uvicorn measure_server:app --port 8765`, `curl http://127.0.0.1:8765/health` →
  `{"status":"ok"}`. Exercise `POST /measure` once with `parts` and once with only `tex`
  (the `verify-server` example body); for `"אם $x$ ו $x$"` with `segment_styles` colouring
  index 3 only, `segment_boxes[3]` is the second `$x$` (left of the first).

Stage B (`manim-timeline/`):

- `npm run build`, `npm run test`, `npm run lint` clean for touched files.
- `npx vitest run src/codegen/texUtils.test.ts` covers the fixture and the `\$` case.

Manual, once (editor + measure server running): a line with two identical `$x$`, colour only
the second in the Properties panel; the canvas preview colours the left one; export, render
`-ql`, same result.

### Open questions

1. **Audit against real projects (blocks merge, not implementation).** The user's `.mtproj`
   files are not in the repo. `scripts/audit_segment_order.py <file.mtproj ...>` should unzip
   each bundle (layout in `src/lib/mtprojBundle.ts`), and for every `textLine` build the line
   with `HebrewMathLine(*parts)` (parts reproduced exactly as `buildExportParts` would; a
   small port is fine for a one-off script), compute the legacy x-sort order, and print lines
   where it differs, plus whether any colour, blink, `next_to` or transform references a
   moved index. Ask the user which project files to run it on. If nothing moves, no migration
   is needed. If something moves, stop and bring the list to the user before deciding on a
   remap migration.
2. None other.

## Implementation notes (server-dev)

## Implementation notes (editor-dev)

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| … | … | pass / fail + one-line evidence |

- Out-of-scope changes found in the diff (files not in "Touched files"):
- Claims in "Implementation notes" that could not be confirmed:

Verdict: **pass** / **fail** (fail sends `status` back to `implementing`).

## Review notes (manim-reviewer / ui-reviewer — optional)

## Docs delta (docs-keeper)

- README sections touched, `*Last updated:*` trailer extended: yes/no
- ARCHITECTURE.md touched: yes/no
- idea.md item closed or updated: which
