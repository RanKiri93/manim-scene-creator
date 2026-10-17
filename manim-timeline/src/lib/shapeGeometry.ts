import type { ShapeItem, ShapeLineStyle, ShapePoint } from '@/types/scene';

/** Manim `stroke_width` is in hundredths of a scene unit (same factor as the axes preview). */
export const MANIM_STROKE_UNITS_PER_WIDTH = 0.01;

/** Manim's `Arrow` defaults: tip length 0.35, at most a quarter of the arrow; stroke ≤ 5 × length. */
export const ARROW_TIP_LENGTH = 0.35;
export const ARROW_MAX_TIP_RATIO = 0.25;
export const ARROW_MAX_STROKE_RATIO = 5;
/** Tip length of a polyline's end arrows (export draws a 0.25-long `Arrow` with ratio 1). */
export const POLYLINE_TIP_LENGTH = 0.25;

/** On-canvas stroke width (px) for a Manim stroke width, never thinner than a hairline. */
export function shapeStrokePx(strokeWidth: number, pxPerUnit: number): number {
  return Math.max(0.75, Math.max(0, strokeWidth) * MANIM_STROKE_UNITS_PER_WIDTH * pxPerUnit);
}

/** Tip length (and width) of an `Arrow` of this length, in scene units. */
export function arrowTipLength(length: number): number {
  return Math.min(ARROW_TIP_LENGTH, ARROW_MAX_TIP_RATIO * Math.max(0, length));
}

/** Stroke width Manim actually draws an `Arrow` of this length with. */
export function arrowStrokeWidth(strokeWidth: number, length: number): number {
  return Math.min(strokeWidth, ARROW_MAX_STROKE_RATIO * Math.max(0, length));
}

export interface LocalBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/**
 * Extent of the shape's own geometry in scene units, relative to its anchor (x, y) and before
 * rotation and scale. Lines and arrows are centred on their midpoint.
 */
export function shapeLocalBounds(item: ShapeItem): LocalBounds {
  switch (item.shapeType) {
    case 'circle':
      return { left: -item.radius, right: item.radius, bottom: -item.radius, top: item.radius };
    case 'rectangle':
    case 'ellipse':
      return { left: -item.width / 2, right: item.width / 2, bottom: -item.height / 2, top: item.height / 2 };
    case 'regularPolygon':
      return pointsBounds(regularPolygonVertices(item.sides, item.radius));
    case 'curvedArrow':
    case 'brace':
      return pointsBounds(shapeOutlinePoints(item) ?? []);
    case 'line':
    case 'arrow':
    case 'doubleArrow': {
      const hx = Math.abs(item.endX) / 2;
      const hy = Math.abs(item.endY) / 2;
      return { left: -hx, right: hx, bottom: -hy, top: hy };
    }
    case 'polyline':
    case 'polygon':
      return pointsBounds(item.points);
    case 'arc':
    case 'sector':
      return pointsBounds(shapeOutlinePoints(item) ?? []);
    case 'annulus':
      return { left: -item.radius, right: item.radius, bottom: -item.radius, top: item.radius };
    default:
      return { left: -0.25, right: 0.25, bottom: -0.25, top: 0.25 };
  }
}

export function pointsBounds(points: readonly ShapePoint[]): LocalBounds {
  if (points.length === 0) return { left: 0, right: 0, bottom: 0, top: 0 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
}

/** Snap the direction from `from` to `to` to the nearest multiple of `stepDeg`, keeping the length. */
export function snapDirection(from: ShapePoint, to: ShapePoint, stepDeg = 15): ShapePoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return to;
  const step = (stepDeg * Math.PI) / 180;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + len * Math.cos(a), y: from.y + len * Math.sin(a) };
}

/** Index of the polyline segment closest to `p` (to insert a vertex after), or -1 when < 2 points. */
export function nearestSegment(points: readonly ShapePoint[], p: ShapePoint): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const l2 = vx * vx + vy * vy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2)) : 0;
    const d = Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Sides of a regular polygon, 3–12 (default 6). */
export function polygonSides(sides: number | undefined): number {
  return Math.max(3, Math.min(12, Math.round(Number.isFinite(sides) ? sides! : 6)));
}

/** First vertex angle (radians) that gives a regular polygon a flat bottom edge. */
export function regularPolygonStartAngle(sides: number): number {
  return -Math.PI / 2 + Math.PI / sides;
}

/** Vertices of a regular polygon around (0, 0): `radius` = centre to vertex, flat bottom edge. */
export function regularPolygonVertices(sides: number | undefined, radius: number): ShapePoint[] {
  const n = polygonSides(sides);
  const a0 = regularPolygonStartAngle(n);
  return Array.from({ length: n }, (_, i) => ({ x: radius * Math.cos(a0 + (2 * Math.PI * i) / n), y: radius * Math.sin(a0 + (2 * Math.PI * i) / n) }));
}

/** Corner radius a rectangle can actually have (at most half its shorter side). */
export function clampedCornerRadius(item: Pick<ShapeItem, 'cornerRadius' | 'width' | 'height'>): number {
  const r = Number.isFinite(item.cornerRadius) ? Math.max(0, item.cornerRadius!) : 0;
  return Math.min(r, Math.abs(item.width) / 2, Math.abs(item.height) / 2);
}

/**
 * Dash pattern of an outline style in scene units: one dash plus its gap (`period`) and the share
 * of it that is drawn (`ratio`). Dotted = very short dashes, which read as dots at normal widths.
 */
export const DASH_PATTERNS: Record<Exclude<ShapeLineStyle, 'solid'>, { period: number; ratio: number }> = {
  dashed: { period: 0.2, ratio: 0.55 },
  dotted: { period: 0.1, ratio: 0.2 },
};

/** Konva `dash` array (px) for an outline style, or undefined when solid. */
export function konvaDash(style: ShapeLineStyle | undefined, pxPerUnit: number): number[] | undefined {
  if (!style || style === 'solid') return undefined;
  const { period, ratio } = DASH_PATTERNS[style];
  return [period * ratio * pxPerUnit, period * (1 - ratio) * pxPerUnit];
}

/** Shapes defined by a start and an end (`x`, `y` = midpoint; `endX`, `endY` = end − start). */
export function isTwoPointKind(kind: ShapeItem['shapeType']): boolean {
  return kind === 'line' || kind === 'arrow' || kind === 'doubleArrow' || kind === 'curvedArrow' || kind === 'brace';
}

export const DEFAULT_CURVED_ARROW_DEG = 60;

/** A curved arrow's turn in degrees, kept within ±300° and away from 0 (Manim needs a real arc). */
export function curvedArrowAngle(item: Pick<ShapeItem, 'arcAngleDeg'>): number {
  const raw = Number.isFinite(item.arcAngleDeg) ? item.arcAngleDeg! : DEFAULT_CURVED_ARROW_DEG;
  const a = Math.max(-300, Math.min(300, raw));
  return Math.abs(a) < 1 ? (a < 0 ? -1 : 1) : a;
}

/**
 * Points along Manim's `ArcBetweenPoints(a, b, angle)`: the arc turns counter-clockwise by
 * `angleDeg` from a to b, so a positive angle bulges to the right of a → b.
 */
export function arcBetweenPoints(a: ShapePoint, b: ShapePoint, angleDeg: number): ShapePoint[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const t = (angleDeg * Math.PI) / 180;
  if (d < 1e-9 || Math.abs(t) < 1e-6) return [a, b];
  // Centre on the left of a → b for a counter-clockwise turn.
  const k = d / 2 / Math.tan(t / 2);
  const cx = (a.x + b.x) / 2 - (dy / d) * k;
  const cy = (a.y + b.y) / 2 + (dx / d) * k;
  const r = Math.hypot(a.x - cx, a.y - cy);
  const a0 = Math.atan2(a.y - cy, a.x - cx);
  const n = Math.max(8, Math.ceil(Math.abs(angleDeg) / 3));
  return Array.from({ length: n + 1 }, (_, i) => (i === n ? b : { x: cx + r * Math.cos(a0 + (t * i) / n), y: cy + r * Math.sin(a0 + (t * i) / n) }));
}

/** Middle of that arc (where the curved arrow's bend handle sits). */
export function arcMidpoint(a: ShapePoint, b: ShapePoint, angleDeg: number): ShapePoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return a;
  const s = (d / 2) * Math.tan((angleDeg * Math.PI) / 180 / 4);
  // Right of a → b is (dy, -dx) / d.
  return { x: (a.x + b.x) / 2 + (dy / d) * s, y: (a.y + b.y) / 2 - (dx / d) * s };
}

/** The turn of the arc from a to b through p (degrees), for dragging a curved arrow's bend. */
export function arcAngleThrough(a: ShapePoint, b: ShapePoint, p: ShapePoint): number {
  const ux = a.x - p.x;
  const uy = a.y - p.y;
  const vx = b.x - p.x;
  const vy = b.y - p.y;
  const at = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  // Inscribed angle at p: the arc through p turns 2 × (180° − ∠apb), towards p's side.
  const deg = 2 * (180 - (Math.abs(at) * 180) / Math.PI);
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return cross < 0 ? deg : -deg;
}

/** Curved arrow drawn like Manim's `CurvedArrow`: shaft from a to the tip's base, tip at b. */
export function curvedArrowGeometry(a: ShapePoint, b: ShapePoint, angleDeg: number): { shaft: ShapePoint[]; tipBase: ShapePoint; tipLength: number } {
  const tipLength = arrowTipLength(Math.hypot(b.x - a.x, b.y - a.y));
  const full = arcBetweenPoints(a, b, angleDeg);
  const prev = full[full.length - 2] ?? a;
  const dl = Math.hypot(b.x - prev.x, b.y - prev.y) || 1;
  const tipBase = { x: b.x - ((b.x - prev.x) / dl) * tipLength, y: b.y - ((b.y - prev.y) / dl) * tipLength };
  // Manim keeps the arc's shape and moves its end onto the tip's base.
  return { shaft: arcBetweenPoints(a, tipBase, angleDeg), tipBase, tipLength };
}

/**
 * Manim's brace outline (`Brace`, sharpness 2) as SVG path data; `{0}` is the straight part.
 * Its box is (2 × straight + BRACE_MIN_WIDTH) wide and BRACE_HEIGHT tall, tip pointing down.
 */
const BRACE_PATH_TEMPLATE =
  'm0.01216 0c-0.01152 0-0.01216 6.103e-4 -0.01216 0.01311v0.007762c0.06776 0.122 0.1799 0.1455 0.2307 0.1455h{0}c0.03046 3.899e-4 0.07964 0.00449 0.1246 0.02636 0.0537 0.02695 0.07418 0.05816 0.08648 0.07769 0.001562 0.002538 0.004539 0.002563 0.01098 0.002563 0.006444-2e-8 0.009421-2.47e-5 0.01098-0.002563 0.0123-0.01953 0.03278-0.05074 0.08648-0.07769 0.04491-0.02187 0.09409-0.02597 0.1246-0.02636h{0}c0.05077 0 0.1629-0.02346 0.2307-0.1455v-0.007762c-1.78e-6 -0.0125-6.365e-4 -0.01311-0.01216-0.01311-0.006444-3.919e-8 -0.009348 2.448e-5 -0.01091 0.002563-0.0123 0.01953-0.03278 0.05074-0.08648 0.07769-0.04491 0.02187-0.09416 0.02597-0.1246 0.02636h{1}c-0.04786 0-0.1502 0.02094-0.2185 0.1256-0.06833-0.1046-0.1706-0.1256-0.2185-0.1256h{1}c-0.03046-3.899e-4 -0.07972-0.004491-0.1246-0.02636-0.0537-0.02695-0.07418-0.05816-0.08648-0.07769-0.001562-0.002538-0.004467-0.002563-0.01091-0.002563z';
export const BRACE_MIN_WIDTH = 0.90552;
export const BRACE_HEIGHT = 0.272985;
/** Gap between the segment and the brace (export passes `buff`). */
export const BRACE_BUFF = 0.1;
/** Gap between the brace's tip and its label (`next_to(..., buff)`). */
export const BRACE_LABEL_BUFF = 0.15;
export const DEFAULT_BRACE_LABEL_SIZE = 32;

/** SVG path of a brace `width` units wide (before it is stretched to that width) and its natural width. */
export function bracePath(width: number): { data: string; naturalWidth: number } {
  const straight = Math.max(0, (width * 2 - BRACE_MIN_WIDTH) / 2);
  return {
    data: BRACE_PATH_TEMPLATE.replaceAll('{0}', String(straight)).replaceAll('{1}', String(-straight)),
    naturalWidth: 2 * straight + BRACE_MIN_WIDTH,
  };
}

/**
 * Where `BraceBetweenPoints(a, b)` sits: on the right of a → b, `BRACE_BUFF` away, `BRACE_HEIGHT`
 * deep. `normal` points from the segment to the tip; `labelDir` is Manim's rounded direction.
 */
export function braceGeometry(a: ShapePoint, b: ShapePoint): {
  normal: ShapePoint;
  tip: ShapePoint;
  outerA: ShapePoint;
  outerB: ShapePoint;
  labelDir: ShapePoint;
} {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const normal = { x: dy / d, y: -dx / d };
  const depth = BRACE_BUFF + BRACE_HEIGHT;
  return {
    normal,
    tip: { x: (a.x + b.x) / 2 + normal.x * depth, y: (a.y + b.y) / 2 + normal.y * depth },
    outerA: { x: a.x + normal.x * depth, y: a.y + normal.y * depth },
    outerB: { x: b.x + normal.x * depth, y: b.y + normal.y * depth },
    labelDir: { x: Math.round(normal.x) || 0, y: Math.round(normal.y) || 0 },
  };
}

/**
 * Centre of a w × h label put `next_to` the brace tip in Manim (its edge facing the brace sits
 * `BRACE_LABEL_BUFF` × direction from the tip; the direction is rounded, so diagonals go further).
 */
export function braceLabelCenter(a: ShapePoint, b: ShapePoint, w: number, h: number): ShapePoint {
  const g = braceGeometry(a, b);
  const dir = g.labelDir;
  return {
    x: g.tip.x + dir.x * BRACE_LABEL_BUFF + (dir.x * w) / 2,
    y: g.tip.y + dir.y * BRACE_LABEL_BUFF + (dir.y * h) / 2,
  };
}

/** Shapes drawn through `points` (relative to the anchor): open polylines and closed polygons. */
/** Arcs, sectors and rings: drawn around the anchor (their circle's centre). */
export function isArcKind(item: Pick<ShapeItem, 'shapeType'>): boolean {
  return item.shapeType === 'arc' || item.shapeType === 'sector' || item.shapeType === 'annulus';
}

export const DEFAULT_ARC_START_DEG = 0;
export const DEFAULT_ARC_ANGLE_DEG = 90;

/** Start and turn of an arc / sector in degrees, with the turn kept within ±360° and never 0. */
export function arcAngles(item: Pick<ShapeItem, 'startAngleDeg' | 'angleDeg'>): { start: number; sweep: number } {
  const start = Number.isFinite(item.startAngleDeg) ? item.startAngleDeg! : DEFAULT_ARC_START_DEG;
  const raw = Number.isFinite(item.angleDeg) ? item.angleDeg! : DEFAULT_ARC_ANGLE_DEG;
  const sweep = Math.max(-360, Math.min(360, raw));
  return { start, sweep: Math.abs(sweep) < 0.01 ? 0.01 : sweep };
}

/** Inner radius of a sector (default 0) or ring (default half the radius), kept below the radius. */
export function innerRadiusOf(item: Pick<ShapeItem, 'shapeType' | 'radius' | 'innerRadius'>): number {
  const fallback = item.shapeType === 'annulus' ? item.radius / 2 : 0;
  const r = Number.isFinite(item.innerRadius) ? item.innerRadius! : fallback;
  return Math.max(0, Math.min(r, item.radius * 0.98));
}

/** Points along an arc (local units, y up), about one every 3°. */
export function arcPoints(radius: number, startDeg: number, sweepDeg: number): ShapePoint[] {
  const n = Math.max(8, Math.ceil(Math.abs(sweepDeg) / 3));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((startDeg + (sweepDeg * i) / n) * Math.PI) / 180;
    return { x: radius * Math.cos(a), y: radius * Math.sin(a) };
  });
}

/**
 * Outline of shapes whose box is not centred on the anchor: regular polygon vertices, an arc's
 * points, or a sector's closed outline (outer arc, then the centre or the inner arc back).
 */
export function shapeOutlinePoints(item: ShapeItem): ShapePoint[] | null {
  if (item.shapeType === 'regularPolygon') return regularPolygonVertices(item.sides, item.radius);
  if (item.shapeType === 'curvedArrow' || item.shapeType === 'brace') {
    const a = { x: -item.endX / 2, y: -item.endY / 2 };
    const b = { x: item.endX / 2, y: item.endY / 2 };
    if (item.shapeType === 'curvedArrow') return arcBetweenPoints(a, b, curvedArrowAngle(item));
    const g = braceGeometry(a, b);
    return [a, b, g.outerA, g.outerB];
  }
  if (item.shapeType !== 'arc' && item.shapeType !== 'sector') return null;
  const { start, sweep } = arcAngles(item);
  const outer = arcPoints(item.radius, start, sweep);
  if (item.shapeType === 'arc') return outer;
  const inner = innerRadiusOf(item);
  return inner > 1e-6 ? [...outer, ...arcPoints(inner, start + sweep, -sweep)] : [...outer, { x: 0, y: 0 }];
}

export function usesPoints(item: Pick<ShapeItem, 'shapeType'>): boolean {
  return item.shapeType === 'polyline' || item.shapeType === 'polygon';
}
