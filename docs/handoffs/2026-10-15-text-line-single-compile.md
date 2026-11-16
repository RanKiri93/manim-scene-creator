---
slug: text-line-single-compile
created: 2026-10-15
status: done
owner_role: verifier
next_tool: any
source: user request (text-object rethink, step 4 of 4: single-compile spike)
---

## Plan (architect)

### Goal

Compile a `HebrewMathLine` with one XeLaTeX run instead of one run per segment (each with the
other segments `\phantom`ed), without changing any geometry: faster measure-server previews and
renders, and no per-segment baseline/flip workaround on the main path.

### Approach (spike first)

Typeset the whole line once with every segment wrapped in `{\color[RGB]{tag}{}…}` (a distinct
tag colour per segment), split the SVG paths by fill colour, then apply the real colour. Keep
the phantom compile as a fallback. Accept only if per-segment boxes and glyph counts match the
phantom compile exactly on a varied corpus.

### Non-goals

No change to the parser's segments, codegen, the measure API or the editor.

## Implementation notes (server-dev)

Spike (scratchpad, then integrated). Findings, in order:

1. The first segment lost its tag colour: the colour special came before the paragraph began
   and the RTL paragraph setup dropped it → start the paragraph first (`\leavevmode`, inside
   the `english` environment for LTR lines).
2. Segments starting with a space were one word space off: LaTeX's `\color` ends with
   `\ignorespaces` → an empty group after it (`\color[RGB]{…}{}`) keeps the space.
3. With both fixes, per-segment centre, width, height and glyph count match the phantom compile
   exactly (worst difference 0.0000) on: a long theorem line with an integral; `\frac` and
   `\sqrt` split by `||`; blank `||` pieces next to math; an English run split by `||`; an
   LTR line with a Hebrew run. No untagged paths.
4. Cold compile time (fresh TeX cache): single ≈ 0.85 s for 4–7 segments; phantom 3.2 s (4),
   4.0 s (5), 4.8–5.0 s (6), 5.6 s (7). A cold `/measure` of a 10-segment line took 1.12 s.

Integrated:

- `hebrew_math_parser.py`: `generate_tagged_source`, `segment_tag_rgb`; phantom and tagged
  sources share `_assemble_line` (run grouping, LTR wrapper).
- `hebrew_tex_template.py`: `\usepackage{xcolor}` before polyglossia (bidi must load last).
  Changes every line's preamble, so existing TeX caches recompile once.
- `hebrew_math_line.py`: `compile_mode` (`auto` default, `single`, `phantom`).
  `_compile_tagged` returns `None` if any path has no known tag colour (e.g. `\textcolor` in
  the source); `auto` then, or on a TeX error, uses `_compile_phantom` (the old path,
  unchanged). Segments from the single compile are `VGroup`s of the glyph paths (phantom
  segments were `SVGMobject`s); both expose the glyphs as `submobjects`.
- Tests (`test_segment_order.py`): `test_single_compile_matches_phantom_compile` (5 lines,
  exact geometry + glyph counts), `test_auto_falls_back_when_the_source_sets_its_own_colour`.
  All earlier compile tests now run through the single path.
- `pytest test_parser.py test_script_alignment.py test_segment_order.py` → 53 passed.
- Server on :8766 (user's :8765 untouched): `/health` ok; cold `/measure` with preview and a
  colour on segment 1 → ok, correct colour and positions.
- `-ql` render of the mixed-direction scene with `Write`: identical frames to step 2.
- Seen, not changed: Manim's INFO "Writing … to …" log line fails to print Hebrew on a cp1252
  Windows console (`UnicodeEncodeError` in rich logging); harmless and pre-existing.
- `dist/measure-server/` (packaged sidecar) not rebuilt.

## Verification (verifier)

Verified 2026-11-17 against the user's running server (:8765), which had served this code since
October (the user's renders with multi-segment text lines looked right).

| Gate | Command | Result |
|---|---|---|
| Server tests | `pytest test_parser.py test_script_alignment.py test_segment_order.py` | pass: 53 passed (includes single-vs-phantom geometry and the colour fallback) |
| Health | `curl http://127.0.0.1:8765/health` | pass: `{"status":"ok"}` |
| Endpoint, real | `POST /measure`, RTL line with `\int`, `\frac`, a `\|\|` split and `\sqrt`, red segment 1, preview on | pass: ok, 5 segments, preview PNG correct (RTL order, segment 1 red), 1.18 s |
| Render | `-ql` frames of user scenes with segmented lines (blink debugging, same day) | pass: segments addressed and coloured as expected |

Not done: `dist/measure-server/` (packaged desktop sidecar) is not rebuilt; tracked as the open-items
review item `desktop`.

Verdict: **pass**.

## Docs delta (docs-keeper)

- README: Measure server paragraph and trailer entry.
