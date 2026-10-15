---
slug: text-line-english-and-base-direction
created: 2026-10-15
status: done
owner_role: docs-keeper
next_tool: any
source: user request (text-object rethink, step 2 of 4; step 1 = 2026-10-15-text-line-typed-segment-order)
---

## Plan (architect)

### Goal

A text line can mix Hebrew and English (and math) in either direction. In a right-to-left line
(default) the user marks English with `\en{…}`; in a left-to-right line plain text is English
and Hebrew is marked with `\he{…}`. Math can sit inside either run. English pieces write left
to right, Hebrew pieces right to left, and `||` can split inside a run for timing. Each line
has a base direction (RTL/LTR) and an English font (default: the line's Hebrew font). The editor
flags letters of the other script that are not wrapped and offers a one-click fix.

### Decisions (user, 2026-10-15)

- Base direction per line, default RTL.
- English font: a separate choice per line; default = same as the Hebrew font. The value
  `Latin Modern Roman` means the LaTeX default (no font override).
- Markup is explicit in `raw`; auto-detection is only an editor hint + quick fix.

### Design

**Segments.** Every segment has `lang: 'he' | 'en'` (the run it belongs to; math too) and
`isMath`. Plain text and top-level math get the base language (`he` for RTL, `en` for LTR).
`\en{…}` / `\he{…}` at brace depth 0 outside math open a run; its content is parsed for
`$…$` and `||` like the top level, and every segment inside gets that run's language. No
nesting. An unclosed wrapper is plain text. Wrapper content is stored without the wrapper (like
math without `$`).

**Writing direction** of a segment's glyphs: Hebrew text right to left; English text and all
math left to right.

**Constructor parts** (TS `buildExportParts` → `HebrewMathLine(*parts)`): math `$…$`, text
as is; a segment whose `lang` differs from the base is wrapped as a whole part: `\en{word}`,
`\en{$f$}`. Python `classify_segments` reads a part wrapped in `\en{…}` / `\he{…}` (whole
part, balanced braces) as that language.

**TeX source** (Python `generate_phantom_source` / `reconstruct_line`): consecutive segments
whose `lang` differs from the base are put in one group, `\textenglish{…}` or
`\texthebrew{…}`, with hidden segments as `\phantom{…}` inside the group. An LTR line is
wrapped in `\begin{english}…\end{english}`. Verified with xelatex: one group keeps
"the function f is continuous" in order inside a Hebrew line; two separate groups reverse
(so adjacent same-language wrappers must merge, which this rule does); an LTR line with a
`\texthebrew` run is correct.

**English font.** `get_hebrew_tex_template(english_font=…)` adds
`\newfontfamily\englishfont{…}` unless the value is `Latin Modern Roman`. `HebrewMathLine`
only passes it when the line has English (an `en` segment or LTR base), so existing
Hebrew + math lines keep a byte-identical preamble and do not recompile.

### Non-goals

- No change to timing, `SegmentStyle`, or segment ids (step 3).
- No Unicode-bidi inference: whitespace between two separate `\en{}` wrappers still splits
  them into two groups (document it; the lint does not try to merge).
- Labels (axes / dot / surround) get `\en{}` support for free through the shared parser but
  no UI for base direction or English font.

### Touched files

Python (server-dev):
- `hebrew_math_parser.py` — `Segment.lang`; wrapper parsing in `parse_segments(raw,
  base_lang)`; `classify_segments(*parts, base_lang)`; grouped
  `generate_phantom_source(segments, visible, base_lang)` and `reconstruct_line`.
- `hebrew_math_line.py` — `base_dir` and `english_font` kwargs; glyph sort by `lang`.
- `hebrew_tex_template.py` — `english_font` parameter.
- `measure_server.py` — `MeasureRequest.base_dir`, `english_font`, passed through.
- `test_parser.py`, `test_segment_order.py` — parser, phantom, compile tests.

TS:
- `src/types/scene.ts` — `TextLineItem.baseDir?: 'rtl' | 'ltr'`, `englishFont?: string`
  (optional; no `PROJECT_VERSION` bump per skill `project-schema-migration`).
- `src/codegen/texUtils.ts` — `RawSegment.lang`, `parseSegments(raw, baseDir)`,
  `buildExportParts(raw, segments, baseDir)`.
- `src/codegen/__fixtures__/segmentParse.json` — add `lang` (and `baseDir` per case) plus
  wrapper cases.
- `src/codegen/lineCodegen.ts` — `generateLineDef` only: pass `baseDir` to parts, emit
  `base_dir="ltr"` / `english_font=…` only when not default (existing exports unchanged).
  The file has unrelated WIP (`export-preview-timing-parity`); commit only this hunk.
- `src/codegen/lineCodegen.test.ts` — emitted constructor cases.
- `src/lib/textDirectionLint.ts` (new) + test — unwrapped other-script runs and the fix.
- `src/services/measureClient.ts`, `src/services/measureHooks.ts` — send/track the new fields.
- `src/canvas/layers/TextLineNode.tsx` — reveal direction from `lang`.
- `src/panels/LineEditor.tsx`, `src/panels/SegmentEditor.tsx` — direction toggle, English
  font field, lint hint + fix, `he`/`en`/`math` labels.
- Callers of `parseSegments` pass the line's `baseDir` (`agent/commit.ts`,
  `panels/SegmentMapperModal.tsx`).
- Copilot: `agent/types.ts` (canonical), `agent/providers/gemini.ts` (flat),
  `agent/validate.ts` (normalizer), `agent/systemPrompt.ts`.

Docs: README (feature row, project-format note, trailer), `agent/ARCHITECTURE.md`,
`.cursor/rules/manim-text-and-point-accuracy.mdc`.

### Invariants at risk

- Existing lines: same parts, same TeX, same preamble → identical export and measure. Pinned by
  codegen tests (no `base_dir` / `english_font` emitted by default) and the unchanged fixture
  expectations for wrapper-free input.
- Python and TS parsers agree (fixture, both suites).
- Copilot canonical + Gemini schemas both carry `baseDir` / `englishFont`.

### Test plan

- `pytest test_parser.py test_script_alignment.py test_segment_order.py`
- New compile tests: an English run inside a Hebrew line, split by `||`, keeps typed order
  left to right inside the run; an LTR line's segments run left to right; glyphs in an `en`
  segment are sorted left to right.
- `/health`, `/measure` once with `base_dir="ltr"` and once with an `\en{}` part.
- `npm run build`, `npm run test`, `npm run lint` (touched files), `npx vitest run src/agent`.
- One `-ql` render of a mixed line in each direction (manim-reviewer check).

### Open questions

None.

## Implementation notes (server-dev)

All stages were implemented in one Claude Code session.

- `hebrew_math_parser.py`: `Segment.lang`, `Segment.is_rtl`, `segment_part()`; wrapper runs
  (`_split_language_runs`, brace matching that skips `\{` `\}`); `parse_segments(raw,
  base_lang)`, `classify_segments(*parts, base_lang)`; `generate_phantom_source` /
  `reconstruct_line` group foreign runs and wrap LTR lines in the `english` environment.
- `hebrew_tex_template.py`: `english_font`, `mixed_language`. With `mixed_language` the
  preamble defines `\en` / `\he` as `\textenglish` / `\texthebrew` (so a wrapper the parser
  does not treat as a run, e.g. inside `\textbf{…}` or unclosed, still compiles) and sets
  `\englishfont` unless the font is `Latin Modern Roman`.
- `hebrew_math_line.py`: `base_dir`, `english_font`; the template gets the language preamble
  only when the line has English, an LTR base or a nested wrapper
  (`test_plain_hebrew_line_keeps_its_preamble`). Glyph sort uses `is_rtl`.
- `measure_server.py`: `base_dir` (`Literal["rtl","ltr"]`), `english_font`; the `tex`
  fallback builds parts with `segment_part`; the bold/italic wrap keeps `lang`.
- Finding (not a regression): spaces on both sides of `||` give a double space in the
  per-segment compile (each phantom is a box). Hebrew lines have always behaved this way;
  segments still align with each other. The full-compile alignment test uses a line without
  `||` and matches within 0.5 %.
- Python: `pytest test_parser.py test_script_alignment.py test_segment_order.py` → 51 passed.
- Server on :8766 (user's :8765 untouched): `/health` ok; `/measure` with an `\en{}` part and
  with `base_dir="ltr"` + `english_font="Latin Modern Roman"` (tex only) → ok, boxes in reading
  order, previews correct.
- `-ql` render of both directions with `Write`: mid-animation frame shows the English run
  written left to right inside the Hebrew line and the Hebrew run right to left inside the
  English line; final frame correct.

## Implementation notes (editor-dev)

- Deviation: the parser moved from `codegen/texUtils.ts` to `src/lib/textSegments.ts`
  because the canvas preview now needs it (layering rule); `texUtils.ts` re-exports it. The
  fixture moved to `src/lib/__fixtures__/segmentParse.json` (25 cases, both suites).
- `types/scene.ts`: `TextBaseDir`, `TextLang`, `LATEX_DEFAULT_ENGLISH_FONT`,
  `TextLineItem.baseDir?`, `englishFont?`. Optional, so no version bump (skill
  `project-schema-migration`); the README format section says so.
- `lib/textDirectionLint.ts` (new): unwrapped other-script runs (outside math, wrappers and
  command names; `||`, spaces, digits and punctuation join words into one run) and
  `wrapForeignRuns`.
- `lineCodegen.ts` (`generateLineDef` only): parts with `baseDir`; `base_dir="ltr"` and
  `english_font=` emitted only when set. The old one-part and many-part branches emitted the
  same text and are merged. `lineCodegen.test.ts` pins the default output byte for byte.
- `measureClient.ts` / `measureHooks.ts`: send and re-measure on `baseDir` / `englishFont`.
- `TextLineNode.tsx`: reveal direction from the parsed segment (English and math LTR).
- `LineEditor.tsx`: direction `Segmented`, "Hebrew font" / "English font" fields (datalist
  offers `Latin Modern Roman`, placeholder shows the Hebrew font), source `dir="ltr"` for LTR
  lines, warning + "Wrap in \en{…}" button. Changing direction re-parses segments.
  `SegmentEditor` labels segments Hebrew / English / math. `SegmentMapperModal` parses each
  line with its own direction.
- Copilot: `baseDir` / `englishFont` in canonical and Gemini create + update schemas
  (`schema.test.ts`), normalized on CREATE and UPDATE (`validate.test.ts`), prompt rule for
  `\en{}` / `baseDir`; `commit.ts` parses with the line's direction.
- `npm run build` ok; `npm run test` → 81 files, 680 passed; `npx vitest run src/agent` → 90
  passed; eslint on touched files: only the 2 pre-existing `react-hooks/set-state-in-effect`
  errors in `SegmentMapperModal.tsx` (same 2 at HEAD). Design-token grep clean.
- Not done: looking at the panel in a running dev server (skill `ui-design-system` step 3).
- Timing sweep not run: no emitted timing changed.

## Verification (verifier)

No independent verifier pass. The gates below were run by the implementing session; the user
accepted the step on that basis (2026-10-15).

| Gate | Command | Result |
|---|---|---|
| Python tests | `pytest test_parser.py test_script_alignment.py test_segment_order.py` | pass, 51 passed |
| Server | `/health`, `/measure` with `\en{}` part and with `base_dir="ltr"` on :8766 | pass |
| Frontend build | `npm run build` | pass |
| Frontend tests | `npm run test` | pass, 680 passed |
| Copilot | `npx vitest run src/agent` | pass, 90 passed |
| Lint | `npx eslint` on touched files | 2 pre-existing errors in `SegmentMapperModal.tsx` only |
| Render | `-ql` render of both directions | pass, reveal order correct |

- Not run: looking at the panel in a running dev server.

Verdict: **pass** (self-verified, see above).

## Docs delta (docs-keeper)

- README sections touched, `*Last updated:*` trailer extended: yes. "Text line" feature row,
  "Project file format" note on the two optional fields, trailer entry prepended.
- ARCHITECTURE.md touched: yes. Prompt rule 5, `normalizeTextLine` specifics,
  `ensureTextLineSegments`.
- `.cursor/rules/manim-text-and-point-accuracy.mdc`: new "English text" section.
- `.agents/skills/codegen-invariants/SKILL.md`: Text bullet on wrapped parts and non-default
  kwargs.
- idea.md item closed or updated: none.
