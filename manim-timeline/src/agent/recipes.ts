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
`;

/** Tool-loop only: how to check a visual result before finishing. */
export const LOOP_RECIPE = `R7. Before finishing anything visual: inspect_scene to confirm everything is on screen when it should be (onScreen, positions inside the camera rectangle), snapshot_preview at the key moment when available, and check_export.
`;
