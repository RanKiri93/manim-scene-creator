import { newId } from '@/lib/ids';
import { DEFAULT_FIELD_ARROW_STROKE_WIDTH } from '@/types/scene';
import { GRAPH_AREA_INTRO_STYLES } from '@/lib/graphAreaReveal';
import type {
  AxesItem,
  GraphAreaCurveSource,
  GraphAreaIntroStyle,
  GraphAreaItem,
  GraphAreaMode,
  GraphFieldColormap,
  GraphFieldItem,
  GraphFieldMode,
  GraphPlotItem,
  GraphPoint2,
  GraphStreamPoint,
  ItemId,
  SceneItem,
} from '@/types/scene';

/*
 * Copilot support for shaded areas (`graphArea`) and vector / slope fields (`graphField`):
 * normalizers for CREATE / UPDATE, scene checks, and the numbers `inspect_scene` reports.
 *
 * The model sends an area's geometry as `area` (the stored field is `mode`, which the flat
 * Gemini schema already uses for a string enum); `mode` as an object is accepted too.
 */

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** JS ↔ NumPy for simple expressions (`Math.sin` ↔ `np.sin`, `^` → `**`). */
const toPy = (s: string) => s.replace(/\^/g, '**').replace(/\bMath\.(\w+)/g, 'np.$1');
const toJs = (s: string) => s.replace(/\^/g, '**').replace(/\bnp\.(\w+)/g, 'Math.$1');

/** One expression in both dialects from `js` / `py` (either may be missing), or null. */
function exprPair(js: unknown, py: unknown): { js: string; py: string } | null {
  let j = str(js);
  let p = str(py);
  if (!j && !p) return null;
  if (!p) p = toPy(j);
  if (!j) j = toJs(p);
  return { js: j.replace(/\^/g, '**'), py: p.replace(/\^/g, '**') };
}

/** Names an expression may use besides its variables (functions and constants come after a dot). */
const ALLOWED_NAMES = new Set(['Math', 'np']);

/** Identifiers in `expr` that are not `vars` (function names after `Math.` / `np.` are fine). */
export function strayNames(expr: string, vars: readonly string[]): string[] {
  const out = new Set<string>();
  const re = /(\.)?\b([A-Za-z_]\w*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) {
    if (m[1]) continue; // property after a dot: Math.sin, np.exp
    const name = m[2]!;
    if (vars.includes(name) || ALLOWED_NAMES.has(name)) continue;
    out.add(name);
  }
  return [...out];
}

function compile(expr: string, vars: readonly string[]): ((...args: number[]) => number) | string {
  try {
    return new Function(...vars, `"use strict"; return (${expr});`) as (...args: number[]) => number;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Error text when `expr` does not compile, uses other names, or is never finite on `samples`. */
function exprProblem(expr: string, vars: readonly string[], samples: number[][]): string | null {
  const stray = strayNames(expr, vars);
  if (stray.length) return `uses ${stray.join(', ')}; only ${vars.join(' and ')} are allowed (with Math.* / np.*)`;
  const fn = compile(expr, vars);
  if (typeof fn === 'string') return `does not compile (${fn})`;
  for (const args of samples) {
    try {
      if (Number.isFinite(fn(...args))) return null;
    } catch {
      // try the next sample
    }
  }
  return 'is not finite anywhere it was sampled';
}

// ── Areas ─────────────────────────────────────────────────────────────────

function curveSource(raw: unknown, path: string, errors: string[]): GraphAreaCurveSource | null {
  const o = obj(raw);
  if (!o) {
    errors.push(`${path} must be { plotId } (an existing graphPlot) or { jsExpr, pyExpr } in x.`);
    return null;
  }
  const plotId = str(o.plotId) || str(o.graphPlotId);
  if (plotId) return { sourceKind: 'plot', plotId };
  const pair = exprPair(o.jsExpr, o.pyExpr ?? o.expr);
  if (!pair) {
    errors.push(`${path} needs plotId or an expression (jsExpr / pyExpr in x).`);
    return null;
  }
  return { sourceKind: 'expr', jsExpr: pair.js, pyExpr: pair.py };
}

function point(raw: unknown): GraphPoint2 | null {
  const o = obj(raw);
  if (!o || typeof o.x !== 'number' || typeof o.y !== 'number' || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
  return { x: o.x, y: o.y };
}

/** Area geometry from the model's `area` (or `mode`) object, merged over `base` on UPDATE. */
export function normalizeAreaMode(
  raw: unknown,
  path: string,
  errors: string[],
  base?: GraphAreaMode,
): GraphAreaMode | null {
  const o0 = obj(raw);
  if (!o0) {
    errors.push(`${path} must be an object with areaKind ("underCurve" | "betweenCurves" | "parallelogramFour" | "parallelogramVec" | "disk").`);
    return null;
  }
  const o = base && (!o0.areaKind || o0.areaKind === base.areaKind) ? { ...base, ...o0 } as Record<string, unknown> : o0;
  const before = errors.length;
  const range = (): { xMin: number; xMax: number } | null => {
    const xMin = num(o.xMin, NaN);
    const xMax = num(o.xMax, NaN);
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) {
      errors.push(`${path} needs finite xMin and xMax.`);
      return null;
    }
    if (!(xMin < xMax)) {
      errors.push(`${path}: xMin (${xMin}) must be less than xMax (${xMax}).`);
      return null;
    }
    return { xMin, xMax };
  };
  // A stored source stays as it is when the patch does not replace it.
  const source = (key: 'curve' | 'lower' | 'upper') => {
    const value = o[key];
    const stored = obj(value);
    if (stored && (stored.sourceKind === 'plot' || stored.sourceKind === 'expr')) return value as GraphAreaCurveSource;
    return curveSource(value, `${path}.${key}`, errors);
  };
  switch (o.areaKind) {
    case 'underCurve': {
      const r = range();
      const curve = source('curve');
      if (!r || !curve || errors.length > before) return null;
      return { areaKind: 'underCurve', ...r, curve, showBoundaryPlot: o.showBoundaryPlot === true };
    }
    case 'betweenCurves': {
      const r = range();
      const lower = source('lower');
      const upper = source('upper');
      if (!r || !lower || !upper || errors.length > before) return null;
      return { areaKind: 'betweenCurves', ...r, lower, upper, showBoundaryPlot: o.showBoundaryPlot === true };
    }
    case 'parallelogramFour': {
      const corners = Array.isArray(o.corners) ? o.corners.map(point) : [];
      if (corners.length !== 4 || corners.some((c) => !c)) {
        errors.push(`${path}.corners must be four { x, y } points in graph coordinates.`);
        return null;
      }
      return { areaKind: 'parallelogramFour', corners: corners as [GraphPoint2, GraphPoint2, GraphPoint2, GraphPoint2] };
    }
    case 'parallelogramVec': {
      const keys = ['ox', 'oy', 'ux', 'uy', 'vx', 'vy'] as const;
      if (keys.some((k) => !Number.isFinite(num(o[k], NaN)))) {
        errors.push(`${path} needs finite ox, oy (corner) and ux, uy, vx, vy (the two edge vectors).`);
        return null;
      }
      const [ox, oy, ux, uy, vx, vy] = keys.map((k) => o[k] as number) as [number, number, number, number, number, number];
      return { areaKind: 'parallelogramVec', ox, oy, ux, uy, vx, vy };
    }
    case 'disk': {
      const cx = num(o.cx, NaN);
      const cy = num(o.cy, NaN);
      const radius = num(o.radius, NaN);
      if (![cx, cy].every(Number.isFinite) || !(radius > 0)) {
        errors.push(`${path} needs finite cx, cy and radius > 0.`);
        return null;
      }
      return { areaKind: 'disk', cx, cy, radius };
    }
    default:
      errors.push(`${path}.areaKind must be "underCurve", "betweenCurves", "parallelogramFour", "parallelogramVec" or "disk".`);
      return null;
  }
}

/** Shared drawable fields (id, label, timing, position) come from the validator's `baseDefaults`. */
export function normalizeGraphArea(
  raw: Record<string, unknown>,
  base: Omit<GraphAreaItem, 'kind' | 'axesId' | 'mode' | 'fillColor' | 'fillOpacity' | 'strokeColor' | 'strokeWidth'>,
  errors: string[],
  prefix: string,
): GraphAreaItem | null {
  const axesId = str(raw.axesId);
  if (!axesId) {
    errors.push(`${prefix}.item.axesId is required for graphArea.`);
    return null;
  }
  const mode = normalizeAreaMode(raw.area ?? raw.mode, `${prefix}.item.area`, errors);
  if (!mode) return null;
  return {
    ...base,
    kind: 'graphArea',
    axesId,
    mode,
    fillColor: str(raw.fillColor) || str(raw.color) || '#3b82f6',
    fillOpacity: Math.max(0, Math.min(1, num(raw.fillOpacity, 0.35))),
    strokeColor: str(raw.strokeColor) || '#1e40af',
    strokeWidth: Math.max(0, num(raw.strokeWidth, 0)),
    introStyle: normalizeAreaIntroStyle(raw.introStyle, `${prefix}.item.introStyle`, errors) ?? 'fade_in',
  };
}

/** `introStyle` of an area: fade_in, sweep_right, sweep_left or rise. */
export function normalizeAreaIntroStyle(v: unknown, path: string, errors: string[]): GraphAreaIntroStyle | undefined {
  if (v == null) return undefined;
  if (GRAPH_AREA_INTRO_STYLES.includes(v as GraphAreaIntroStyle)) return v as GraphAreaIntroStyle;
  errors.push(`${path} must be one of ${GRAPH_AREA_INTRO_STYLES.join(', ')}.`);
  return undefined;
}

// ── Fields ────────────────────────────────────────────────────────────────

const COLORMAPS: readonly GraphFieldColormap[] = ['viridis', 'plasma', 'inferno', 'magma'];

function streamPoints(raw: unknown, path: string, errors: string[]): GraphStreamPoint[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    errors.push(`${path} must be an array of { x, y } seed points.`);
    return [];
  }
  const out: GraphStreamPoint[] = [];
  raw.forEach((entry, i) => {
    const p = point(entry);
    if (!p) {
      errors.push(`${path}[${i}] must be { x, y } in graph coordinates.`);
      return;
    }
    out.push({ id: str((entry as Record<string, unknown>).id) || newId(), ...p });
  });
  return out;
}

/**
 * Field fields from a CREATE (`existing` undefined) or an UPDATE patch (only the keys present;
 * expressions keep both dialects in step). Returns the normalized fields.
 */
export function normalizeFieldFields(
  raw: Record<string, unknown>,
  path: string,
  errors: string[],
  existing?: GraphFieldItem,
): Partial<GraphFieldItem> {
  const out: Partial<GraphFieldItem> = {};
  if ('fieldMode' in raw) {
    const mode = raw.fieldMode;
    if (mode === 'slope' || mode === 'vector' || mode === 'none') out.fieldMode = mode as GraphFieldMode;
    else errors.push(`${path}.fieldMode must be "slope", "vector" or "none".`);
  }
  const slope = exprPair(raw.jsExprSlope ?? raw.jsExpr, raw.pyExprSlope ?? raw.pyExpr ?? raw.slope);
  if (slope) {
    out.jsExprSlope = slope.js;
    out.pyExprSlope = slope.py;
  }
  const p = exprPair(raw.jsExprP, raw.pyExprP);
  if (p) {
    out.jsExprP = p.js;
    out.pyExprP = p.py;
  }
  const q = exprPair(raw.jsExprQ, raw.pyExprQ);
  if (q) {
    out.jsExprQ = q.js;
    out.pyExprQ = q.py;
  }
  const positive = (key: 'fieldGridStep' | 'slopeArrowLength' | 'streamDt' | 'streamVirtualTime' | 'arrowStrokeWidth') => {
    if (!(key in raw)) return;
    const v = num(raw[key], NaN);
    if (v > 0) out[key] = v;
    else errors.push(`${path}.${key} must be a number greater than 0.`);
  };
  positive('fieldGridStep');
  positive('slopeArrowLength');
  positive('streamDt');
  positive('streamVirtualTime');
  positive('arrowStrokeWidth');
  if ('fieldColormap' in raw) {
    if (COLORMAPS.includes(raw.fieldColormap as GraphFieldColormap)) out.fieldColormap = raw.fieldColormap as GraphFieldColormap;
    else errors.push(`${path}.fieldColormap must be one of ${COLORMAPS.join(', ')}.`);
  }
  if ('colorSchemeMin' in raw) out.colorSchemeMin = num(raw.colorSchemeMin, 0);
  if ('colorSchemeMax' in raw) out.colorSchemeMax = num(raw.colorSchemeMax, 2);
  if ('streamPoints' in raw) out.streamPoints = streamPoints(raw.streamPoints, `${path}.streamPoints`, errors);
  if (!existing) {
    const mode = out.fieldMode ?? (slope ? 'slope' : 'vector');
    out.fieldMode = mode;
    if (mode === 'slope' && !slope) errors.push(`${path}: a slope field needs jsExprSlope / pyExprSlope (dy/dx in x and y).`);
    if (mode === 'vector' && (!p || !q)) errors.push(`${path}: a vector field needs both components: jsExprP / pyExprP and jsExprQ / pyExprQ (in x and y).`);
  }
  return out;
}

export function normalizeGraphField(
  raw: Record<string, unknown>,
  base: Omit<GraphFieldItem, 'kind' | 'axesId' | keyof ReturnType<typeof fieldDefaults>>,
  errors: string[],
  prefix: string,
): GraphFieldItem | null {
  const axesId = str(raw.axesId);
  if (!axesId) {
    errors.push(`${prefix}.item.axesId is required for graphField.`);
    return null;
  }
  const before = errors.length;
  const fields = normalizeFieldFields(raw, `${prefix}.item`, errors);
  if (errors.length > before) return null;
  return { ...base, kind: 'graphField', axesId, ...fieldDefaults(), ...fields } as GraphFieldItem;
}

/** Same defaults as `createGraphFieldItem`. */
function fieldDefaults() {
  return {
    fieldMode: 'vector' as GraphFieldMode,
    pyExprSlope: '0',
    jsExprSlope: '0',
    slopeArrowLength: 0.5,
    pyExprP: '1',
    pyExprQ: '0',
    jsExprP: '1',
    jsExprQ: '0',
    fieldGridStep: 0.5,
    fieldColormap: 'viridis' as GraphFieldColormap,
    colorSchemeMin: 0,
    colorSchemeMax: 2,
    arrowStrokeWidth: DEFAULT_FIELD_ARROW_STROKE_WIDTH,
    streamPoints: [] as GraphStreamPoint[],
    streamPlacementActive: false,
    streamDt: 0.05,
    streamVirtualTime: 3,
  };
}

// ── Scene checks ──────────────────────────────────────────────────────────

/** Most arrows a field may draw (the preview and Manim slow down past this). */
export const MAX_FIELD_ARROWS = 900;

function plotDomain(plot: GraphPlotItem, axes: AxesItem | undefined): [number, number] | null {
  if (plot.xDomain) return [Math.min(...plot.xDomain), Math.max(...plot.xDomain)];
  return axes ? [axes.xRange[0], axes.xRange[1]] : null;
}

function gridSamples(axes: AxesItem | undefined, withY: boolean): number[][] {
  const [x0, x1] = axes ? [axes.xRange[0], axes.xRange[1]] : [-5, 5];
  const [y0, y1] = axes ? [axes.yRange[0], axes.yRange[1]] : [-3, 3];
  const out: number[][] = [];
  for (let i = 0; i <= 6; i++) {
    const x = x0 + ((x1 - x0) * i) / 6;
    if (!withY) out.push([x]);
    else for (let j = 0; j <= 6; j++) out.push([x, y0 + ((y1 - y0) * j) / 6]);
  }
  return out;
}

/** Check areas and fields in the scene the draft produces (`ids`: the ones the draft touches). */
export function checkGraphRegions(scene: Map<ItemId, SceneItem>, ids: Iterable<ItemId>, errors: string[]): void {
  for (const id of ids) {
    const item = scene.get(id);
    if (item?.kind !== 'graphArea' && item?.kind !== 'graphField') continue;
    const axesItem = scene.get(item.axesId);
    const axes = axesItem?.kind === 'axes' ? axesItem : undefined;
    const at = `${item.kind} "${id}"`;
    if (item.kind === 'graphArea') {
      const mode = item.mode;
      if (mode.areaKind !== 'underCurve' && mode.areaKind !== 'betweenCurves') continue;
      const sources = mode.areaKind === 'underCurve' ? [mode.curve] : [mode.lower, mode.upper];
      for (const src of sources) {
        if (src.sourceKind === 'plot') {
          const plot = scene.get(src.plotId);
          if (plot?.kind !== 'graphPlot') {
            errors.push(`${at}: "${src.plotId}" is not a graphPlot in the scene.`);
            continue;
          }
          if (plot.axesId !== item.axesId) {
            errors.push(`${at}: plot "${src.plotId}" is on axes "${plot.axesId}", the area on "${item.axesId}"; both must use the same axes.`);
            continue;
          }
          const domain = plotDomain(plot, axes);
          if (domain && (mode.xMin < domain[0] - 1e-9 || mode.xMax > domain[1] + 1e-9)) {
            errors.push(`${at}: x from ${mode.xMin} to ${mode.xMax} leaves plot "${src.plotId}"'s domain [${domain[0]}, ${domain[1]}].`);
          }
        } else {
          const problem = exprProblem(src.jsExpr, ['x'], gridSamples(axes, false));
          if (problem) errors.push(`${at}: boundary expression "${src.jsExpr}" ${problem}.`);
          if (axes && (mode.xMin < axes.xRange[0] - 1e-9 || mode.xMax > axes.xRange[1] + 1e-9)) {
            errors.push(`${at}: x from ${mode.xMin} to ${mode.xMax} leaves the axes' x range [${axes.xRange[0]}, ${axes.xRange[1]}].`);
          }
        }
      }
      continue;
    }
    if (item.fieldMode === 'none') continue;
    const exprs: [string, string][] =
      item.fieldMode === 'slope' ? [['slope', item.jsExprSlope]] : [['P', item.jsExprP], ['Q', item.jsExprQ]];
    for (const [name, expr] of exprs) {
      const problem = exprProblem(expr, ['x', 'y'], gridSamples(axes, true));
      if (problem) errors.push(`${at}: ${name} expression "${expr}" ${problem}.`);
    }
    if (axes) {
      const step = Math.max(0.05, item.fieldGridStep);
      const count = (Math.floor((axes.xRange[1] - axes.xRange[0]) / step) + 1) * (Math.floor((axes.yRange[1] - axes.yRange[0]) / step) + 1);
      if (count > MAX_FIELD_ARROWS) {
        errors.push(`${at}: fieldGridStep ${item.fieldGridStep} draws ${count} arrows on these axes (at most ${MAX_FIELD_ARROWS}); use a larger step.`);
      }
      item.streamPoints.forEach((p, i) => {
        if (p.x < axes.xRange[0] || p.x > axes.xRange[1] || p.y < axes.yRange[0] || p.y > axes.yRange[1]) {
          errors.push(`${at}: streamPoints[${i}] (${p.x}, ${p.y}) is outside the axes.`);
        }
      });
    }
  }
}

// ── Inspect facts ─────────────────────────────────────────────────────────

function areaCurve(src: GraphAreaCurveSource, scene: Map<ItemId, SceneItem>): ((x: number) => number) | null {
  const expr = src.sourceKind === 'plot' ? (scene.get(src.plotId) as GraphPlotItem | undefined)?.fn?.jsExpr : src.jsExpr;
  if (!expr) return null;
  const fn = compile(expr, ['x']);
  return typeof fn === 'string' ? null : (x) => fn(x);
}

/** Simpson's rule on [a, b] (n even); NaN when the function is not finite somewhere. */
function integrate(f: (x: number) => number, a: number, b: number, n = 200): number {
  const h = (b - a) / n;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const y = f(a + i * h);
    if (!Number.isFinite(y)) return NaN;
    s += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * y;
  }
  return (s * h) / 3;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * What inspect reports for an area: its signed value (∫ f, or ∫ (upper − lower)), its graph-space
 * extent and a centre to put a label at (graph coordinates).
 */
export function areaFacts(item: GraphAreaItem, scene: Map<ItemId, SceneItem>): Record<string, unknown> {
  const m = item.mode;
  try {
    if (m.areaKind === 'underCurve' || m.areaKind === 'betweenCurves') {
      const top = areaCurve(m.areaKind === 'underCurve' ? m.curve : m.upper, scene);
      const bottom = m.areaKind === 'underCurve' ? () => 0 : areaCurve(m.lower, scene);
      if (!top || !bottom) return { areaKind: m.areaKind, error: 'boundary could not be evaluated' };
      const diff = (x: number) => top(x) - bottom(x);
      const value = integrate(diff, m.xMin, m.xMax);
      const xMid = (m.xMin + m.xMax) / 2;
      return {
        areaKind: m.areaKind,
        x: [m.xMin, m.xMax],
        value: Number.isFinite(value) ? r3(value) : 'not finite',
        labelAt: [r3(xMid), r3((top(xMid) + bottom(xMid)) / 2)],
      };
    }
    if (m.areaKind === 'disk') return { areaKind: 'disk', value: r3(Math.PI * m.radius * m.radius), labelAt: [m.cx, m.cy] };
    const corners =
      m.areaKind === 'parallelogramFour'
        ? m.corners
        : [
            { x: m.ox, y: m.oy },
            { x: m.ox + m.ux, y: m.oy + m.uy },
            { x: m.ox + m.ux + m.vx, y: m.oy + m.uy + m.vy },
            { x: m.ox + m.vx, y: m.oy + m.vy },
          ];
    let twice = 0;
    corners.forEach((c, i) => {
      const n = corners[(i + 1) % corners.length]!;
      twice += c.x * n.y - n.x * c.y;
    });
    const cx = corners.reduce((s, c) => s + c.x, 0) / corners.length;
    const cy = corners.reduce((s, c) => s + c.y, 0) / corners.length;
    return { areaKind: m.areaKind, value: r3(Math.abs(twice) / 2), labelAt: [r3(cx), r3(cy)] };
  } catch {
    return { areaKind: m.areaKind, error: 'boundary could not be evaluated' };
  }
}

/**
 * Where each stream line of a field ends, integrated like the export (RK4 on the same field,
 * stopping half a unit outside the axes).
 */
export function fieldFacts(item: GraphFieldItem, axes: AxesItem | undefined): Record<string, unknown> {
  const facts: Record<string, unknown> = { fieldMode: item.fieldMode, gridStep: item.fieldGridStep };
  if (!axes) return facts;
  const step = Math.max(0.05, item.fieldGridStep);
  facts.arrows =
    item.fieldMode === 'none'
      ? 0
      : (Math.floor((axes.xRange[1] - axes.xRange[0]) / step) + 1) * (Math.floor((axes.yRange[1] - axes.yRange[0]) / step) + 1);
  if (!item.streamPoints.length) return facts;
  const L = item.slopeArrowLength;
  const slope = compile(item.jsExprSlope, ['x', 'y']);
  const P = compile(item.jsExprP, ['x', 'y']);
  const Q = compile(item.jsExprQ, ['x', 'y']);
  const field = (x: number, y: number): [number, number] => {
    if (item.fieldMode === 'slope') {
      if (typeof slope === 'string') return [NaN, NaN];
      const f = slope(x, y);
      const den = Math.sqrt(1 + f * f);
      return [L / den, (L * f) / den];
    }
    if (typeof P === 'string' || typeof Q === 'string') return [NaN, NaN];
    return [P(x, y), Q(x, y)];
  };
  const [xMin, xMax] = axes.xRange;
  const [yMin, yMax] = axes.yRange;
  const dt = item.streamDt;
  const maxSteps = Math.max(2, Math.ceil(item.streamVirtualTime / dt) + 1);
  facts.streams = item.streamPoints.map((seed) => {
    let x = seed.x;
    let y = seed.y;
    let leftAxes = false;
    try {
      for (let i = 1; i < maxSteps; i++) {
        const [k1x, k1y] = field(x, y);
        const [k2x, k2y] = field(x + (dt / 2) * k1x, y + (dt / 2) * k1y);
        const [k3x, k3y] = field(x + (dt / 2) * k2x, y + (dt / 2) * k2y);
        const [k4x, k4y] = field(x + dt * k3x, y + dt * k3y);
        x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
        y += (dt / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) break;
        if (x < xMin - 0.5 || x > xMax + 0.5 || y < yMin - 0.5 || y > yMax + 0.5) {
          leftAxes = true;
          break;
        }
      }
    } catch {
      return { from: [seed.x, seed.y], error: 'field could not be evaluated' };
    }
    return { from: [seed.x, seed.y], to: [r3(x), r3(y)], endedBy: leftAxes ? 'left the axes' : 'streamVirtualTime ran out' };
  });
  return facts;
}
