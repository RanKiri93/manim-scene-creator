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
    case 'line':
    case 'arrow': {
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
