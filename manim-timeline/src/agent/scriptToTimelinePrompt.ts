export interface ScriptToTimelineOptions {
  script: string;
}

const SCRIPT_TO_TIMELINE_PREAMBLE = `
You are converting a pasted Hebrew lesson script into a Manim Timeline proposal.
Use the existing scene-edit action format. The user will review a preview and click Approve before anything is applied.

Important constraints:
- Emit CREATE/UPDATE/DELETE actions only through the normal action schema.
- Prefer CREATE actions for a new timeline draft.
- Convert titles, explanations, formulas, summaries, and important proof steps into textLine items.
- Use textLine.raw for Hebrew/math text; wrap every math fragment in $...$.
- For new textLine items, set raw and omit segments or set segments: [].
- Use projectDefaults.font for every new textLine.
- Prefer posSteps: use to_edge for the first title, then next_to for following lines.
- Avoid absolute positioning unless the script explicitly asks for center.
- Schedule items sequentially from currentTimeSec unless the script explicitly says otherwise.
- Use short durations: title around 1.5 to 2 seconds, regular lines around 2 to 3 seconds, graph elements around 1 to 2 seconds.
- If creating axes, both xRange and yRange must be explicit, and scaleX, scaleY, and scale must all be set.
- If graph information is underspecified, ask a clarifying question with actions: [] instead of guessing.
- Create graphPlot only when a valid function expression is specified or can be safely inferred from the script.
- Create graphDot only when its graph coordinates are known; for "mark point at x=...", compute y from the function if the function is explicit.
- For vague graph moments, create explanatory text placeholders instead of invalid graph objects.
- Do not create graphArea or graphField in this v1 flow.
- Keep the proposal compact and editable; prefer 5 to 12 scene items over a huge timeline.
- Use Hebrew labels when the script is Hebrew.
- End the reply with a short explanation of what was proposed and remind the user to Approve or Reject the preview.
`.trim();

export function buildScriptToTimelinePrompt({
  script,
}: ScriptToTimelineOptions): string {
  const trimmed = script.trim();
  if (!trimmed) return '';

  return `${SCRIPT_TO_TIMELINE_PREAMBLE}\n\nSCRIPT:\n${trimmed}`;
}
