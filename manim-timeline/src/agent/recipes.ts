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

R3. Live value while a point moves: dot.showCoordinates: true (coordinatePrecision 1–2), or a fixed dot.label such as "$P$". To show a named value use dot.valueTemplate: "f(x) = {y}" for the function value, "f'(x) = {slope}" or "\\text{slope} = {slope}" for the slope, "x = {x}" for the position. One live label per dot; for two values (f(x) and the slope) put both in one template ("f(x) = {y},\\; f'(x) = {slope}") rather than a second dot.

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
   1. The plot (R1, rule 8f), then a graphArea underCurve with curve { "plotId" } and the requested xMin / xMax, starting after the plot finishes; fillColor close to the plot's colour. When the area should build up ("accumulate", "from left to right", "progressively") use introStyle "sweep_right" with a duration of 1.5–3 s; "rise" when it should grow up from the axis.
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
   4. Put the clip on its word with AUDIO anchor (at = the word's start) rather than a bare startTime, so it keeps following the word when the narration is moved or cut later.

R16. Retime and make room ("everything after the graph appears is too fast: slow it down by 25% and add a 2 second pause before the point moves").
   1. Work out the times from the scene: "after the graph appears" = the graph's startTime + duration; "to the end" = the last clip's end.
   2. Slower / faster: TIMELINE scale with from / to on gaps between clips (not inside a clip) and factor = 1.25 for "25% slower", 0.8 for "20% faster".
   3. A pause before something: TIMELINE insert at that clip's startTime (after any earlier scale, use the moved time) with the seconds asked. Removing a pause: TIMELINE remove over the empty range.
   4. Order matters: edits apply one after another, so either insert first (at the original time) or compute the time the scale moved it to.

R19. Traced path ("let the point leave a trail as it goes around the curve", Lissajous figures, orbits).
   1. The moving dot as in R2: on a plot, or on a parametric graphCurve (attachment { kind: "parametric", graphCurveId, t } and graphFollow rows with targetT).
   2. dot.trace: {} keeps the whole path in the dot's colour; fadeSeconds 1–2 for a comet-like tail ("fading trail"); a lighter or thinner trail (width 2) when the curve itself is also drawn.
   3. To draw a figure only by its trail, give the curve a short duration and remove it (exit_animation) or skip creating its plot; the trail draws it as the dot moves.

R20. Camera follows a point ("the graph is wide: keep the camera on the point while it travels from x = 0 to x = 20").
   1. A camera_move with targetMode "follow", targetId = the dot, startTime = the motion clip's startTime (or a little before), duration = until the motion ends, targetWidth 5–8 (narrower = closer).
   2. Afterwards return to the whole picture with targetMode "frame" (start frame) or "region" around the graph, starting when the follow ends.
   3. A follow is not for things that stay put: use targetMode "object" or "region" for those.

R21. Riemann sums ("left Riemann sums for f on [0, 3] with n = 4, 8, 16, 32, each replacing the last").
   1. The plot (R1), then ONE graphArea with area { areaKind: "riemann", xMin, xMax, curve: { plotId }, rule, counts: [4, 8, 16, 32] } after the plot finishes. Never build rectangles from shapes or one area per n.
   2. duration = about 1–1.5 s per count (the duration is split evenly); strokeWidth 1 so the rectangles read as separate, fillOpacity 0.5.
   3. To show the value: inspect gives each count's sum; a text line such as "$L_{4} \\approx 2.53$" per count, timed to its share of the clip, or the integral at the end.

R22. Geometry construction ("a right triangle ABC with the right angle at B, mark angle α at A and mark AB and BC as equal").
   1. The points: small filled circles (shape circle, radius 0.06, fillColor = strokeColor, fillOpacity 1) at the corners, each with a text line "$A$", "$B$", "$C$" placed next_to it away from the figure (or graph dots with dot.label on axes for coordinate geometry).
   2. The sides: connector lines between the points (endpoints { start: { kind: "object", itemId: A }, end: { kind: "object", itemId: B } }); equal sides get the same endpoints.ticks (1 for one pair, 2 for the next).
   3. The angles: angle marks { vertex: B, from: A, to: C } — at 90° it draws the square by itself; the named angle at A gets an arc and a text line "$\\alpha$" at the mark's labelAtWorld from inspect_scene.
   4. Order: points, then sides (Create), then marks and names; everything stays attached if a point moves later.

R23. Review my scene ("check the scene and fix what doesn't look right", "בדוק את הסצנה").
   1. review_scene first. Fix every finding you can in ONE draft: move or shrink what is off camera (keep it inside the 14.22 × 8 frame with a 0.3 margin), move overlapping text apart (next_to with buff 0.3 or a lower line), lighten dark colours (#e2e8f0 for text, a 400-level shade for lines), wrap unwrapped runs (\\en{…} in Hebrew lines), close long idle stretches with a TIMELINE remove, and fix export errors.
   2. review_scene again; repeat once if something new appears.
   3. finish: list what you fixed, and what you left on purpose (for example an idle pause that holds a picture for the narration) so the user can decide.

R24. Tighten or clean the narration ("cut the long pauses", "remove the ums", "the second take repeats a sentence", "תקצר את השתיקות").
   1. audio_report first. Use its cuts as they are: pauses keep half a second, fillers and repeats cut in the middle of the surrounding pauses.
   2. Only what was asked: pauses when asked about pauses, fillers when asked about fillers. For a repeat, cut the first saying (the report's cut). When the user asks for suggestions only, list the findings with their times in the reply and propose nothing.
   3. Propose the cuts from the LAST to the FIRST, so earlier times stay valid while later audio moves up. Clips anchored to words follow by themselves; other clips stay where they are, so mention any visual that now starts in a different place than the speech it went with.
   4. A clip much quieter or louder than the others (loudnessSpread above about 2 LU, or the user says so): suggest Normalize or Clean in the clip editor; gain (AUDIO gain) only for a small, deliberate change.

R17. A tangent that rides along ("add the tangent line at the moving point, about 2 units long").
   1. The moving dot as in R2 (plot, dot attached to it, graphFollow).
   2. shape line with endpoints { start: { kind: "graphDot", dotId }, tangent: { length: 2 } }, starting with the dot (or when asked), a colour that stands out from the plot. It turns with the slope by itself; one connector is enough.
   3. To show the number too: a dot label or a text line nearby; inspect_scene gives the slope at any time.

R18. Secant turning into the tangent ("the secant through P and Q, then slide Q towards P").
   1. Two dots P and Q attached to the same plot, then shape line with endpoints { start: { kind: "graphDot", dotId: P }, end: { kind: "graphDot", dotId: Q }, extend: 1.5 } so the line runs past both points.
   2. graphFollow on Q to targetX = P's x + h with a small h (0.05–0.1 of the x range), never exactly P's x: two equal points give no line.
   3. For the finish: a tangent connector at P (R17) appearing when Q arrives, and the secant fades out (exit_animation) or turns the tangent's colour.
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
   - R24: audio_report again after the cuts: the pauses / fillers / repeats that were cut are gone, and find_words still finds the cue words of anchored clips at their clips' starts.
   - R16: inspect after the edit: the clips moved as intended and the cue clip starts after the pause; a refused edit names the clip or narration in the way.
   - R3: inspect shows each dot's liveLabel text at the times asked; check it reads as intended (decimals, the right value).
   - R19: inspect during the motion: the dot's trail lists where it starts (from) and its length so far; with fadeSeconds the start follows the dot.
   - R20: inspect at the start, middle and end of the motion: the dot (world) stays near the camera centre and inCamera; the follow clip's endsAt is where the dot stops.
   - R21: the area's sums list one value per count and should approach integral; check the rule (left / middle / right) is the one asked for.
   - R22: inspect the angle marks' degrees (the right angle reads 90) and the connectors' lengths (equal sides match).
   - R17: inspect at a few times during the motion: the tangent's slope matches f'(x) at the dot's graph x and changes as the dot moves.
   - R18: at the end Q's graph x is close to, not equal to, P's; the secant's ends lie beyond both dots.
   - R11: inspect at the beat time: the dot (world) is inside camera; after the return the camera width is the full 14.22 again; camera clips show their endsAt.
`;
