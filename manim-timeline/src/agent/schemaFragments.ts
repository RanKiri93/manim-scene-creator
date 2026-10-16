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

const SHAPE_ANCHOR_SCHEMA = {
  type: 'object',
  description:
    'One connector end. kind "graphDot" { dotId } follows a graph dot; "graphDotFoot" { dotId, axis: "x" | "y" } is the dot dropped onto the x-axis (vertical drop) or y-axis; "graphPoint" { axesId, x, y } is a fixed point in graph coordinates; "object" { itemId, edge? } is a text line / shape / image / axes centre or edge; "point" { x, y } is a fixed scene point.',
  properties: {
    kind: { type: 'string', enum: ['graphDot', 'graphDotFoot', 'graphPoint', 'object', 'point'] },
    dotId: { type: 'string' },
    axis: { type: 'string', enum: ['x', 'y'] },
    axesId: { type: 'string' },
    itemId: { type: 'string' },
    edge: { type: 'string', enum: ['center', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'UL', 'UR', 'DL', 'DR'] },
    x: { type: 'number' },
    y: { type: 'number' },
  },
} as const;

/** `shape.endpoints` (line / arrow): ends that follow other things every frame ("connector"). */
export const SHAPE_ENDPOINTS_SCHEMA = {
  type: 'object',
  description:
    'shape with shapeType "line" or "arrow": make it a connector whose ends follow anchors every frame (preview and export). Position fields are then ignored.',
  properties: {
    start: SHAPE_ANCHOR_SCHEMA,
    end: SHAPE_ANCHOR_SCHEMA,
  },
} as const;

/** `graphField` properties (vector / slope fields with optional stream lines). */
export const GRAPH_FIELD_PROPERTIES = {
  fieldMode: {
    type: 'string',
    enum: ['vector', 'slope', 'none'],
    description:
      'For kind="graphField": "slope" visualizes a scalar slope field dy/dx = f(x, y) (use jsExprSlope/pyExprSlope); "vector" visualizes a planar vector field (P(x,y), Q(x,y)) (use jsExprP/pyExprP and jsExprQ/pyExprQ); "none" disables arrow rendering (streamlines only).',
  },
  jsExprSlope: {
    type: 'string',
    description:
      'For kind="graphField" with fieldMode="slope": JavaScript expression for dy/dx in terms of `x` and `y`. Example: "x - y" or "Math.sin(x) * y". Use "**" for power.',
  },
  pyExprSlope: {
    type: 'string',
    description:
      'For kind="graphField" with fieldMode="slope": NumPy expression for dy/dx in terms of `x` and `y`. Example: "x - y" or "np.sin(x) * y". Use "**" for power.',
  },
  slopeArrowLength: {
    type: 'number',
    description:
      'For kind="graphField" with fieldMode="slope": rendered length of each slope tick in graph units. Default 0.5.',
  },
  jsExprP: {
    type: 'string',
    description:
      'For kind="graphField" with fieldMode="vector": JavaScript expression for the x-component P(x, y). Example: "-y" or "Math.cos(x)". Use "**" for power.',
  },
  pyExprP: {
    type: 'string',
    description:
      'For kind="graphField" with fieldMode="vector": NumPy expression for the x-component P(x, y). Example: "-y" or "np.cos(x)". Use "**" for power.',
  },
  jsExprQ: {
    type: 'string',
    description:
      'For kind="graphField" with fieldMode="vector": JavaScript expression for the y-component Q(x, y). Example: "x" or "Math.sin(x) - y". Use "**" for power.',
  },
  pyExprQ: {
    type: 'string',
    description:
      'For kind="graphField" with fieldMode="vector": NumPy expression for the y-component Q(x, y). Example: "x" or "np.sin(x) - y". Use "**" for power.',
  },
  fieldGridStep: {
    type: 'number',
    description:
      'For kind="graphField": spacing (in graph units) between sampled arrows on the grid. Default 0.5. Smaller = denser field.',
  },
  fieldColormap: {
    type: 'string',
    enum: ['viridis', 'plasma', 'inferno', 'magma'],
    description:
      'For kind="graphField": colormap used to shade arrows by magnitude. Default "viridis".',
  },
  colorSchemeMin: {
    type: 'number',
    description:
      'For kind="graphField": magnitude mapped to the low end of the colormap. Default 0.',
  },
  colorSchemeMax: {
    type: 'number',
    description:
      'For kind="graphField": magnitude mapped to the high end of the colormap. Default 2.',
  },
  arrowStrokeWidth: {
    type: 'number',
    description:
      'For kind="graphField": stroke width in pixels of each arrow shaft / slope tick. Applied to both the canvas preview and the Manim ArrowVectorField via set_stroke(width=...). Default 4. Use ~1.5–2 for hairline arrows, ~6–8 for bold arrows.',
  },
  streamPoints: {
    type: 'array',
    description:
      'For kind="graphField": optional seed points { x, y } (graph coordinates) for stream lines. A line runs forward only (towards increasing x in a slope field) for streamVirtualTime; inspect_scene reports where it ends. Omit for a plain arrow field.',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
    },
  },
  streamDt: {
    type: 'number',
    description:
      'For kind="graphField": integration timestep for streamlines. Default 0.05.',
  },
  streamVirtualTime: {
    type: 'number',
    description:
      'For kind="graphField": total virtual time (seconds) integrated per streamline. Default 3.',
  },
} as const;

const AREA_CURVE_SOURCE = {
  type: 'object',
  description: 'A boundary: { plotId } of a graphPlot on the same axes, or { jsExpr, pyExpr } in x.',
  properties: {
    plotId: { type: 'string' },
    jsExpr: { type: 'string', description: 'JavaScript in x, e.g. "x*x". Use "**" for power.' },
    pyExpr: { type: 'string', description: 'NumPy in x, e.g. "x**2".' },
  },
};

/** `graphArea` properties: the geometry goes under `area` (stored as the item's `mode`). */
export const GRAPH_AREA_PROPERTIES = {
  area: {
    type: 'object',
    description:
      'For kind="graphArea": the shaded region in graph coordinates. underCurve: xMin < xMax and curve (between the curve and y = 0). betweenCurves: xMin, xMax, lower, upper. parallelogramFour: corners (4 points). parallelogramVec: corner ox, oy and edge vectors ux, uy, vx, vy. disk: cx, cy, radius. On UPDATE send only what changes; the rest is kept.',
    properties: {
      areaKind: { type: 'string', enum: ['underCurve', 'betweenCurves', 'parallelogramFour', 'parallelogramVec', 'disk'] },
      xMin: { type: 'number' },
      xMax: { type: 'number' },
      curve: AREA_CURVE_SOURCE,
      lower: AREA_CURVE_SOURCE,
      upper: AREA_CURVE_SOURCE,
      showBoundaryPlot: { type: 'boolean', description: 'For expression boundaries: also draw the boundary curves.' },
      corners: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } } },
      ox: { type: 'number' }, oy: { type: 'number' }, ux: { type: 'number' }, uy: { type: 'number' }, vx: { type: 'number' }, vy: { type: 'number' },
      cx: { type: 'number' }, cy: { type: 'number' }, radius: { type: 'number' },
    },
  },
  fillColor: { type: 'string', description: 'For kind="graphArea": CSS hex fill. Default "#3b82f6".' },
  fillOpacity: { type: 'number', description: 'For kind="graphArea": 0–1. Default 0.35.' },
  strokeColor: { type: 'string', description: 'For kind="graphArea": outline colour (polygons and disks).' },
  strokeWidth: { type: 'number', description: 'For kind="graphArea": outline width; 0 = none (default).' },
  introStyle: {
    type: 'string',
    enum: ['fade_in', 'sweep_right', 'sweep_left', 'rise'],
    description:
      'For kind="graphArea": how it enters over its duration. "sweep_right" fills from xMin to xMax (accumulating area), "sweep_left" from xMax back, "rise" grows from the axis (or the lower curve) up to the curve. Sweeps and rise apply to underCurve / betweenCurves; other areas fade. Default "fade_in".',
  },
} as const;

/** textLine entrance: `animStyle` and, for equation steps, the line it morphs from. */
export const TEXT_ANIM_PROPERTIES = {
  animStyle: {
    type: 'string',
    enum: ['write', 'fade_in', 'transform'],
    description: 'textLine: how the line enters. "transform" morphs an earlier line into this one (set transformConfig). Default "write".',
  },
  transformConfig: {
    type: 'object',
    description:
      'textLine with animStyle "transform": the line it morphs from. mode "segments" moves paired pieces (pairs: from = source segment index, to = this line\'s segment index; unpaired source pieces fade out or stay, unpaired new pieces fade or write in); mode "whole" morphs the whole line. The source line disappears when the morph ends.',
    properties: {
      sourceLineId: { type: 'string', description: 'The earlier textLine this one morphs from.' },
      mode: { type: 'string', enum: ['segments', 'whole'] },
      pairs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from: { type: 'integer', description: 'Segment index on the source line.' },
            to: { type: 'integer', description: 'Segment index on this line.' },
          },
        },
      },
      unmappedSourceBehavior: { type: 'string', enum: ['fade_out', 'leave'] },
      unmappedTargetBehavior: { type: 'string', enum: ['fade_in', 'write'] },
    },
  },
} as const;

/** `TIMELINE` action: a time edit that moves every later clip and the narration with them. */
export const TIMELINE_EDIT_SCHEMA = {
  type: 'object',
  description:
    'TIMELINE action: op "insert" adds `seconds` of empty time at `at`; "remove" closes the empty range from `from` to `to`; "scale" stretches (factor > 1, slower) or squeezes (factor < 1) the clips starting in [from, to). Later clips and narration move along. Blocked when a clip crosses the point or an edge, or (scale) when narration plays inside the range.',
  properties: {
    op: { type: 'string', enum: ['insert', 'remove', 'scale'] },
    at: { type: 'number', description: 'insert: scene time in seconds.' },
    seconds: { type: 'number', description: 'insert: how much empty time to add.' },
    from: { type: 'number', description: 'remove / scale: range start (s).' },
    to: { type: 'number', description: 'remove / scale: range end (s).' },
    factor: { type: 'number', description: 'scale: 1.25 = 25% slower, 0.8 = 20% faster (0.25–4).' },
  },
} as const;
