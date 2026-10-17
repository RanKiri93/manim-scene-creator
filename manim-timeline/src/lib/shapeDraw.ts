import type { ShapeItem, ShapeKind, ShapePoint } from '@/types/scene';
import { isTwoPointKind, snapDirection } from '@/lib/shapeGeometry';

/** What the Shape picker starts drawing: a kind plus preset fields (a triangle is a 3-sided regular polygon). */
export interface ShapeDrawPreset {
  shapeType: ShapeKind;
  /** Name shown while drawing ("Triangle"). */
  label: string;
  patch?: Partial<ShapeItem>;
}

export interface DrawModifiers {
  /** Square box, round circle, or a 45° line (15° for an arc's start). */
  shift: boolean;
  /** Box shapes grow from the press point as their centre. */
  alt: boolean;
}

/** A press that moves less than this (scene units) is a click: the shape gets its default size there. */
export const MIN_DRAG = 0.08;

/** Polylines and polygons are drawn by clicking their points; everything else by dragging. */
export function drawsByPoints(kind: ShapeKind): boolean {
  return kind === 'polyline' || kind === 'polygon';
}

/** Arcs, sectors and rings are dragged from their centre outwards. */
function drawsFromCentre(kind: ShapeKind): boolean {
  return kind === 'arc' || kind === 'sector' || kind === 'annulus';
}

/**
 * Position and size of a shape dragged from `a` to `b` (scene units, in one frame). Two-point
 * shapes run from a to b; arcs are centred on a; other shapes fill the box between a and b.
 */
export function draggedShapeGeometry(kind: ShapeKind, a: ShapePoint, b: ShapePoint, mods: DrawModifiers): Partial<ShapeItem> {
  if (isTwoPointKind(kind)) {
    const end = mods.shift ? snapDirection(a, b, 45) : b;
    return { x: (a.x + end.x) / 2, y: (a.y + end.y) / 2, endX: end.x - a.x, endY: end.y - a.y, rotationDeg: 0, scale: 1 };
  }
  if (drawsFromCentre(kind)) {
    const radius = Math.max(0.05, Math.hypot(b.x - a.x, b.y - a.y));
    if (kind === 'annulus') return { x: a.x, y: a.y, radius, innerRadius: radius / 2 };
    let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (mods.shift) deg = Math.round(deg / 15) * 15;
    // The drag points at the middle of a quarter turn.
    return { x: a.x, y: a.y, radius, startAngleDeg: deg - 45, angleDeg: 90 };
  }
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (mods.shift || kind === 'circle' || kind === 'regularPolygon') {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * side;
    dy = (dy < 0 ? -1 : 1) * side;
  }
  const x = mods.alt ? a.x : a.x + dx / 2;
  const y = mods.alt ? a.y : a.y + dy / 2;
  const w = Math.max(0.05, Math.abs(dx) * (mods.alt ? 2 : 1));
  const h = Math.max(0.05, Math.abs(dy) * (mods.alt ? 2 : 1));
  if (kind === 'circle' || kind === 'regularPolygon') return { x, y, radius: w / 2, rotationDeg: 0, scale: 1 };
  return { x, y, width: w, height: h, rotationDeg: 0, scale: 1 };
}

/** Where the next clicked point goes (Shift keeps the new segment at a multiple of 45°). */
export function nextDrawPoint(points: readonly ShapePoint[], p: ShapePoint, shift: boolean): ShapePoint {
  const prev = points[points.length - 1];
  return shift && prev ? snapDirection(prev, p, 45) : p;
}

/** Fewest points a finished polyline (2) or polygon (3) needs. */
export function minDrawPoints(kind: ShapeKind): number {
  return kind === 'polygon' ? 3 : 2;
}

/**
 * Shape fields for clicked points: anchored at the middle of their box, points relative to it.
 * Repeated points (the two clicks of a double-click) count once. Null when there are too few.
 */
export function pointsShapeGeometry(kind: ShapeKind, clicked: readonly ShapePoint[]): Partial<ShapeItem> | null {
  const pts: ShapePoint[] = [];
  for (const p of clicked) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.02) pts.push(p);
  }
  if (pts.length < minDrawPoints(kind)) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2;
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  return { x, y, points: pts.map((p) => ({ x: p.x - x, y: p.y - y })), rotationDeg: 0, scale: 1 };
}
