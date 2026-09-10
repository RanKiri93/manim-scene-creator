---
name: manim-render-check
description: Procedure to review and render exported Manim Python from the timeline — static rules check (HebrewMathLine, explicit axes ranges, timing), then a low-quality render via the measure server or the manim CLI, then frame inspection. Load when asked to verify a render, review generated Python, or investigate a visual defect.
---

# Manim render check

Rendering is expensive. Do the static review first; render only what the static review cannot
decide.

## 1. Obtain the Python

Preferred: a full-file export produced by the app (Export panel → full file) or by a codegen
test (`manimExporter` output). If you must generate it yourself, run the relevant vitest with
`console.log` of the exporter result in a temporary test under `/tmp` (not in the repo).

## 2. Static review (no render)

Check, in order, and report each as pass/fail with the offending line:

- Text: every text object is `HebrewMathLine(...)`. Any `Text(`, `Tex(`, `MathTex(` is a
  fail. `hebrew_font=` present; `font_size=` present. Bold/italic via `\textbf`/`\mathbf` in
  the source string, never `.set_weight()`.
- Axes: every `Axes(` has both `x_range=[...]` and `y_range=[...]` with three entries.
- Positioning: `to_edge`/`next_to`/`set_x`/`set_y`/`shift` chains; `move_to(ORIGIN)` only
  when the item is meant to be centred.
- Timing: walk the playback section with a running clock. Each `self.wait(d)` adds `d`; each
  `self.play(..., run_time=r)` adds `r` (default 1 when omitted); `add_sound` adds 0. Compare
  the clock at each leaf's first `self.play` with the item's `effectiveStart` in the project.
  Deviations > 0.05 s are a fail; cite the clip.
- Function series replacement mode: exactly one `Create(n_1)`; hops are
  `_FSRevealTransform(n_1, n_k)`; the class is emitted once at module scope; later curves are
  hidden with `set_stroke(opacity=0)`.
- Exit animations: targets exist; for replacement-mode series the target is `n_1`.
- Sound: `self.add_sound("assets/audio/…")` paths are relative and appear at or before the
  bound leaf, never after it.
- Web export (`isWebExport`): `config.transparent`, `config.format = "webm"`,
  `config.background_color` set at top; render must use `--format=webm`.

## 3. Render (low quality)

Through the server (preferred, matches production):
```
POST http://127.0.0.1:8765/api/render
{"python_code": "<file>", "quality": "l", "scene_name": "<SceneClass>"}
```
Save the returned MP4 under a temp folder outside the repo. On HTTP 500 the `detail` holds
Manim's stderr; the first `Error` or LaTeX `!` line is the root cause.

Directly (when the server is not running), from the repo root so `hebrew_math_line` imports:
```
$env:PYTHONUTF8=1; python -m manim render <file.py> <SceneClass> -ql --format=mp4
```
Output lands under `media/videos/…`; delete it afterwards (`media/` is gitignored but large).

## 4. Inspect frames

Extract stills at the timestamps that matter (clip starts, exits, end):
```
ffmpeg -ss <sec> -i <video.mp4> -frames:v 1 <out.png>
```
Look at each PNG (read the image) and report against this rubric:
- Nothing clipped by the frame edge; Hebrew ink not pushed off the right edge.
- Text readable at 480p: font size and contrast adequate; math colour distinct from text.
- Curves visible: stroke width not hairline; series colours distinguishable.
- Labels placed as configured (`labelDir`), not overlapping the curve or axes numbers.
- At an exit time + duration, the target is gone and nothing else disappeared.

## 5. Report format

```
Static: <n> checks, <m> fails (list with line numbers)
Render: ok | failed (first error line)
Frames: <timestamp> → finding; …
Verdict: pass | fail
Suggested fixes: file:line → change
```
Do not edit project files in this role; write findings to the handoff's "Review notes".
