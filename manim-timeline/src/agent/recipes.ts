/**
 * Worked patterns for multi-part requests, appended to the system prompt. Each recipe names the
 * pieces and the timing, using only fields the validator accepts.
 */
export const RECIPES_SECTION = `RECIPES (patterns for multi-part requests; adapt ids, labels, colours and times)

R1. Graph that fits the frame. The camera frame is 14.22 × 8 units. Pick scaleX so (xMax − xMin) · scaleX is about 8–11 and scaleY so (yMax − yMin) · scaleY is about 4–6; set scale = √(scaleX · scaleY). Leave room for a title above (to_edge UP) when there is one.

R2. Point moving along a function graph, with a segment down to the x-axis that moves with it.
   1. axes (R1), then graphPlot with xDomain = the requested interval.
   2. graphDot with dot.attachment { kind: "function", graphPlotId, x: <start x> }, starting after the plot finishes (dot.startTime ≥ plot.startTime + plot.duration).
   3. shape line with endpoints { start: { kind: "graphDot", dotId }, end: { kind: "graphDotFoot", dotId, axis: "x" } }, starting with the dot. Use axis "y" for the horizontal segment to the y-axis; both segments = two connectors (or dot.showProjectionGuides: true for dashed guides to both axes).
   4. target_animation mode "graphFollow", startTime after the dot appears, targets [{ targetId: dotId, targetX: <end x>, easing: "linear" or "smooth" }].
   Check: inspect_scene at the start, middle and end of the motion — the dot's graph x should go from start to end and the connector's lower end should stay at y = 0 (or the nearest range edge) with the same x as the dot.

R3. Live value while a point moves: dot.showCoordinates: true (coordinatePrecision 1–2), or a fixed dot.label such as "$P$".

R4. Arrow pointing from a text line to something that moves: shape arrow with endpoints { start: { kind: "object", itemId: <text id>, edge: "DOWN" }, end: { kind: "graphDot", dotId } }.

R5. Emphasise, then remove: blink_animation (or surroundingRect) on the target, then exit_animation with startTime ≥ the emphasis end.

R6. Several steps in sequence: each clip starts when the previous one ends (startTime = previous startTime + duration, plus any pause asked for). For "now", use currentTimeSec. Several moves of one dot are separate graphFollow clips that do not overlap.

R8. Convergence story (Taylor / Fourier partial sums, x^n on [0, 1], a sequence of functions f_n).
   1. One graphFunctionSeries on the axes (rule 8). "Converging", "each replacing the previous", "one at a time" → mode "replacement"; "all together", "the whole family" → mode "accumulation".
   2. A sum of terms (Taylor, Fourier, geometric) → displayMode "partialSum" with jsExpr / pyExpr = the n-th TERM. A sequence of functions (x**n, Math.sin(n*x)/n) → displayMode "individual" with the n-th function. nMin < nMax (a series has at least two curves).
   3. Degree is not n: the Taylor polynomials of sin x up to degree 9 are the terms (-1)^n x^(2n+1)/(2n+1)! for n = 0..4. Factorial: JS "Array.from({length: 2*n+1}, (_, i) => i + 1).reduce((p, k) => p * k, 1)", Python "np.prod(np.arange(1.0, 2*n + 2))" (no math module in the scene).
   4. Pace: when the user names one, set defaults on CREATE: { "animDuration": <seconds per curve>, "waitAfter": <pause> } ("short pause" ≈ 0.5, "slowly" ≈ 1.5 per curve); omit duration so the clip length follows them.
   5. The limit, when it is known (sin x for its Taylor series), as a graphPlot in another colour with lineStyle "dashed", drawn before the series. Pick yRange for the limit with some margin, and xDomain where the early curves do not shoot far outside it.
   Check: the last curve stays on screen at the end (no exit_animation unless asked).

R9. Lesson slide from a few sentences (a title and lines under it, each starting when the previous one finishes).
   1. Title: textLine with posSteps [{ "kind": "to_edge", "edge": "UP", "buff": 0.5 }] and a larger fontSize (about 48 when the lines use the default 36).
   2. Each next line: posSteps [{ "kind": "next_to", "refKind": "line", "refId": <previous line id>, "dir": "DOWN", "buff": 0.3, "alignedEdge": "RIGHT" }]. "RIGHT" lines Hebrew up on its right edge; use "LEFT" for English (baseDir "ltr") lines; leave alignedEdge out to centre them.
   3. Timing as R6: line k starts at line (k-1).startTime + line (k-1).duration (+ a pause when asked). One idea per line; split a long sentence into two lines instead of letting it run past the frame.
   Check: no two text lines overlap and every line stays inside the camera view.

R10. Point at one term of a formula (colour it, pulse it, or box it at a given moment).
   1. Give the term its own segment. Text: ||…|| around the words (rule 5b). Math: close and reopen the dollars around the term, with {} where an operator would lose its spacing: "$(x+1)^2 = x^2 +{}$$2x$\${}+ 1$" gives segments "(x+1)^2 = x^2 +{}", "2x", "{}+ 1". In a Hebrew line, wrap such a split formula in \\en{…} (e.g. "הפיתוח \\en{$x^2 +{}$$2x$\${}+ 1$}"), otherwise its pieces come out in reverse order; a formula-only line can instead use baseDir "ltr".
   2. Segments are numbered in the order they appear in raw, from 0, Hebrew included. When creating a line that will be pointed at, split it from the start so no later re-split is needed.
   3. Colour (lasting): UPDATE raw (unchanged) + segments with the colour on that index (rule 5b). Pulse: blink_animation with targets [{ "targetId": <line id>, "mode": "scale", "segmentIndices": [<index>] }] (mode "color" + blinkColor flashes a colour). Box: surroundingRect with "targetIds": [<line id>], "segmentIndices": [<index>], startTime, runTime; remove it later with an exit_animation.
   4. "When the narration mentions it" without a time → ask for the moment, or use currentTimeSec when the user says now.

R11. Camera story beats (zoom in on the action at a moment, then return).
   1. Zoom: camera_move with targetMode "region" and a world-space region around what matters AT THAT MOMENT (where a dot is at the beat time, not where it starts): about 3–5 units wide with the action in the middle; the camera fits the frame's aspect. targetMode "object" frames an object as it is at the request time, so use it only for things that do not move.
   2. The zoom clip starts a little before the beat (its duration is the camera motion, about 0.8–1.5 s). The camera holds there until the next camera clip.
   3. Return: a second camera_move with targetMode "frame" and targetFrameId = the start frame (startFrameId in the payload), starting when the beat ends ("for three seconds" = zoom end + 3).
   4. Camera clips never overlap: each starts at or after the previous one's startTime + duration.
   Check: the camera rectangle at the beat holds the target, and the view is back to the full frame after the return.

R12. Shaded area labelled as an integral ("shade the area under f between 1 and 3 and label it").
   1. The plot (R1, rule 8f), then a graphArea underCurve with curve { "plotId" } and the requested xMin / xMax, starting after the plot finishes; fillColor close to the plot's colour.
   2. The label: a textLine such as "$\\int_{1}^{3} f(x)\\,dx$" (add "= <value>" when the user wants the number), fontSize about 30, starting when the area starts. In the tool loop place it at the area's labelAtWorld from inspect_scene (posSteps [{ "kind": "absolute" }] with x, y) or just above the area; otherwise next to the axes.
   3. Between two curves: betweenCurves with lower / upper. When they cross inside the interval, say so or split it at the crossing (one area per piece).
   4. A curve below the x-axis gives a negative integral: say "signed area" or split at the root when the user means the geometric area.

R13. Slope or vector field with a solution ("the slope field of y' = x − y on [−3, 3] × [−2, 2] and the solution through (−1, 0.8)").
   1. Axes with exactly the requested ranges (R1); the field covers all of it.
   2. graphField fieldMode "slope" with jsExprSlope "x - y" / pyExprSlope "x - y". fieldGridStep so 12–20 arrows fit across: (xMax − xMin) / 15 rounded to 0.25 or 0.5. slopeArrowLength ≈ 0.7 × fieldGridStep; arrowStrokeWidth 2–3 for a dense field.
   3. The solution through (x0, y0): streamPoints [{ "x": x0, "y": y0 }] with streamVirtualTime ≈ 1.3 × (xMax − x0) / slopeArrowLength so it reaches the right edge. It only goes to the right of the point: when the user wants the whole curve and the solution has a formula (y' = x − y: y = x − 1 + C·e^(−x), C from the point), draw a graphPlot of it instead, in a contrasting colour after the field.
   4. Vector fields: the same with fieldMode "vector" (P, Q); a stream line follows the flow for streamVirtualTime seconds.

R14. Equation steps that morph ("solve 2x + 3 = 7 step by step, each line turning into the next").
   1. One textLine per step, formula-only lines with baseDir "ltr", one segment per term, and {} around an operator or relation that stands at the edge of a piece so spacing stays as in one formula: "$2x$\${}+3$\${}={}$$7$" → segments "2x", "{}+3", "{}={}", "7". Write equal terms the same way in every step so they pair up.
   2. Step k + 1: same posSteps as step k (it replaces it in place), animStyle "transform", transformConfig { "sourceLineId": <step k>, "mode": "segments", "pairs": equal terms, plus the term that changes side (pair "{}+3" with "{}-3" so it flies across and turns into −3) }, unmappedSourceBehavior "fade_out", unmappedTargetBehavior "fade_in".
   3. Timing: step k + 1 starts at step k's startTime + duration + a pause (about 1 s); duration about 1–1.5 s.
   4. A worked solution that stays on screen (every step visible) is not a morph: write each step below the previous one (R9) instead.

R15. Time things to the narration ("show the point exactly when I say 'בנקודה', and start moving it when I say 'שנעה'").
   1. Find each cue word: narration words in the payload, or find_words in the tool loop (it matches Hebrew prefixes and phrases). Spoken more than once: pick by the context or ask which. Not found: say so and name the closest words; do not guess a time.
   2. "Appear when I say X": the item's startTime = X's start, with a short entrance (0.3–0.6 s). "Start moving when I say Y": the motion clip's startTime = Y's start; the thing must have finished appearing before that.
   3. Durations stay inside their sentence: a clip ends by the next cue word or the end of the sentence (the last word before a pause).
`;

/** Tool-loop only: how to check a visual result before finishing. */
export const LOOP_RECIPE = `R7. Before finishing anything visual: inspect_scene to confirm everything is on screen when it should be (onScreen, inCamera, no textOverlaps), snapshot_preview at the key moment when available, and check_export. Per recipe:
   - R8: the series' curves list when each n draws; at the end its showing is the last n (replacement) or every n (accumulation).
   - R9: inspect measures new text first; when a line has outside or a pair is in textOverlaps, shorten the line, split it, lower the fontSize or raise the buff, then inspect again.
   - R10: the line's segments list gives the index to use (i); check it is the term you mean before the blink / surround / colour.
   - R12: the area's value is the integral; check its sign and that xMin..xMax is what was asked. The label sits at labelAtWorld (or just above it) and is inCamera.
   - R13: field.arrows stays below about 400; each stream that should cross the picture has endedBy "left the axes".
   - R14: each step's transform lists pairs with their texts: "a → b" marks a piece that changes, check those are the moves you mean; the previous step shows onScreen false after the morph.
   - R15: inspect lists what is spoken during each clip (spoken); it should begin with the cue word.
   - R11: inspect at the beat time: the dot (world) is inside camera; after the return the camera width is the full 14.22 again; camera clips show their endsAt.
`;
