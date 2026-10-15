/**
 * Schema pieces shared by the canonical envelope (`types.ts`, OpenAI / Anthropic) and the flat
 * Gemini schema (`providers/gemini.ts`), so new fields land in both at once. Only plain
 * `type` / `properties` / `items` / `enum` / `description` here: Gemini rejects the rest.
 */

const DIRECTIONS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'UL', 'UR', 'DL', 'DR'];

/** `graphDot.dot`: position, look, attachment to a plot/curve, and live annotations. */
export const GRAPH_DOT_SCHEMA = {
  type: 'object',
  description:
    'graphDot: the dot. To put it ON a function plot use attachment { kind: "function", graphPlotId, x } (y is computed); on a parametric curve use { kind: "parametric", graphCurveId, t }. Free dots use dx/dy (graph coordinates). On UPDATE send only the fields to change; the rest is kept.',
  properties: {
    dx: { type: 'number', description: 'Free dot: x in graph coordinates.' },
    dy: { type: 'number', description: 'Free dot: y in graph coordinates.' },
    color: { type: 'string' },
    radius: { type: 'number', description: 'Manim units; default 0.08.' },
    label: { type: 'string', description: 'Fixed label text (LaTeX math allowed, e.g. "$P$").' },
    labelDir: { type: 'string', enum: DIRECTIONS },
    attachment: {
      type: 'object',
      description: 'Where the dot sits. A Move-along-graph clip then moves it along that source.',
      properties: {
        kind: { type: 'string', enum: ['free', 'function', 'parametric'] },
        graphPlotId: { type: 'string', description: 'kind "function": graphPlot id on the same axes.' },
        x: { type: 'number', description: 'kind "function": x where the dot sits.' },
        graphCurveId: { type: 'string', description: 'kind "parametric": graphCurve id on the same axes.' },
        t: { type: 'number', description: 'kind "parametric": curve parameter where the dot sits.' },
      },
    },
    showCoordinates: { type: 'boolean', description: 'Live "(x, y)" label that follows the dot.' },
    showProjectionGuides: {
      type: 'boolean',
      description: 'Dashed guides from the dot to BOTH axes. For one guide only, use a connector line shape instead.',
    },
    labelFontSize: { type: 'number' },
    labelColor: { type: 'string' },
    labelSpacing: { type: 'number' },
    coordinateFontSize: { type: 'number' },
    coordinateColor: { type: 'string' },
    coordinateDir: { type: 'string', enum: DIRECTIONS },
    coordinateSpacing: { type: 'number' },
    coordinatePrecision: { type: 'integer', description: 'Decimals in the live coordinate label (0–6).' },
  },
} as const;

/** Row fields of a `target_animation` with `mode: "graphFollow"` (Move along graph). */
export const GRAPH_FOLLOW_ROW_PROPERTIES = {
  targetX: {
    type: 'number',
    description: 'target_animation mode "graphFollow": destination x (graph units) for a dot on a function plot.',
  },
  graphPlotId: {
    type: 'string',
    description: 'target_animation mode "graphFollow": the plot to follow when the dot is free (not attached).',
  },
  targetT: {
    type: 'number',
    description: 'target_animation mode "graphFollow": destination parameter for a dot attached to a parametric curve.',
  },
  graphCurveId: { type: 'string', description: 'target_animation mode "graphFollow": legacy parametric source id.' },
  easing: { type: 'string', enum: ['smooth', 'linear'], description: 'Graph-follow easing; default smooth.' },
} as const;

export const TARGET_ANIMATION_MODES = ['scale', 'color', 'move', 'path', 'rotate', 'graphFollow'] as const;
