import type {
  AxesItem,
  FrameDef,
  GraphDotItem,
  GraphPlotItem,
  ItemId,
  SceneItem,
  ShapeAnchor,
  ShapeAngleMark,
  ShapeEndpoints,
  ShapeItem,
} from '@/types/scene';
import { axesRasterGeometry } from '@/lib/axesRasterPreview';
import { frameCenterById } from '@/lib/frameGrid';
import { evaluateGraphY, graphProjectionGuides, resolveGraphDotPosition } from '@/lib/graphMotion';
import { dotFunctionPlot, slopeSamplePoints } from '@/lib/graphLiveValue';
import { rawDirectionComponents } from '@/lib/nextToGeometry';
import { getItemBBox, resolvePosition } from '@/lib/resolvePosition';
import { targetAnimPreviewAccum } from '@/lib/visualPlaybackPreview';
import { isTwoPointKind } from '@/lib/shapeGeometry';

/** Scene state an anchor is resolved against. Points come out in world (camera-grid) coordinates. */
export interface AnchorContext {
  items: Map<ItemId, SceneItem>;
  time: number;
  frames: readonly FrameDef[];
  startFrameId: ItemId | null;
}

export type AnchorResult = { point: { x: number; y: number }; error: null } | { point: null; error: string };

/** Kinds an `object` anchor may reference (they have one Manim mobject with a centre and edges). */
export const OBJECT_ANCHOR_KINDS: ReadonlySet<SceneItem['kind']> = new Set(['textLine', 'shape', 'image', 'axes', 'matrix']);

/** True for a line / arrow whose ends follow anchors. */
export function isConnectorShape(item: SceneItem | undefined | null): item is ShapeItem & { endpoints: ShapeEndpoints } {
  return (
    item?.kind === 'shape' &&
    isTwoPointKind(item.shapeType) &&
    item.endpoints != null
  );
}

/** True for a polyline drawn as an angle mark between three anchors. */
export function isAngleMark(item: SceneItem | undefined | null): item is ShapeItem & { angle: ShapeAngleMark } {
  return item?.kind === 'shape' && item.shapeType === 'polyline' && item.angle != null;
}

/** A shape whose geometry follows anchors every frame (connector or angle mark). */
export function isBoundShape(item: SceneItem | undefined | null): boolean {
  return isConnectorShape(item) || isAngleMark(item);
}

function anchorIds(anchor: ShapeAnchor): ItemId[] {
  if (anchor.kind === 'graphPoint') return [anchor.axesId];
  if (anchor.kind === 'graphDot' || anchor.kind === 'graphDotFoot') return [anchor.dotId];
  if (anchor.kind === 'object') return [anchor.itemId];
  return [];
}

/** Ids a bound shape depends on (connector ends, tangent plot, angle anchors). */
export function boundShapeReferencedIds(shape: ShapeItem): ItemId[] {
  const ids = shape.endpoints ? connectorReferencedIds(shape.endpoints) : [];
  if (shape.angle) for (const a of [shape.angle.vertex, shape.angle.from, shape.angle.to]) ids.push(...anchorIds(a));
  return [...new Set(ids)];
}

/** Ids a connector depends on (dots, axes, objects); used for clean-up, remapping and checks. */
export function connectorReferencedIds(endpoints: ShapeEndpoints): ItemId[] {
  const ids: ItemId[] = [];
  for (const anchor of [endpoints.start, endpoints.end]) {
    if (anchor.kind === 'graphPoint') ids.push(anchor.axesId);
    else if (anchor.kind === 'graphDot' || anchor.kind === 'graphDotFoot') ids.push(anchor.dotId);
    else if (anchor.kind === 'object') ids.push(anchor.itemId);
  }
  if (endpoints.tangent?.plotId) ids.push(endpoints.tangent.plotId);
  return [...new Set(ids)];
}

/** Rewrite the ids an anchor references (fragment import, duplication). */
export function remapShapeAnchor(anchor: ShapeAnchor, m: Map<string, string>): ShapeAnchor {
  switch (anchor.kind) {
    case 'graphPoint':
      return { ...anchor, axesId: m.get(anchor.axesId) ?? anchor.axesId };
    case 'graphDot':
    case 'graphDotFoot':
      return { ...anchor, dotId: m.get(anchor.dotId) ?? anchor.dotId };
    case 'object':
      return { ...anchor, itemId: m.get(anchor.itemId) ?? anchor.itemId };
    default:
      return anchor;
  }
}

function frameOffset(item: SceneItem, ctx: AnchorContext): { x: number; y: number } {
  return frameCenterById(ctx.frames, 'frameId' in item ? item.frameId : ctx.startFrameId);
}

/**
 * Graph coordinates → world point, matching the canvas overlay mapping: the measured Manim axes
 * transform when the server raster is current, otherwise the ideal linear layout around the axes
 * centre. Includes the axes' frame offset and move / path / scale target animations at `ctx.time`.
 */
export function axesGraphToWorld(axes: AxesItem, gx: number, gy: number, ctx: AnchorContext): { x: number; y: number } {
  const center = resolvePosition(axes, ctx.items);
  const fc = frameOffset(axes, ctx);
  const ta = targetAnimPreviewAccum(axes.id, ctx.time, ctx.items);
  const geometry = axesRasterGeometry({ axes, time: ctx.time, itemsMap: ctx.items, pxPerUnitX: 1, pxPerUnitY: 1 });
  let lx: number;
  let ly: number;
  if (geometry) {
    lx = geometry.graphOrigin.x + gx * geometry.graphXBasis.x + gy * geometry.graphYBasis.x;
    ly = -(geometry.graphOrigin.y + gx * geometry.graphXBasis.y + gy * geometry.graphYBasis.y);
  } else {
    const [xMin, xMax] = axes.xRange;
    const [yMin, yMax] = axes.yRange;
    lx = (gx - (xMin + xMax) / 2) * axes.scaleX;
    ly = (gy - (yMin + yMax) / 2) * axes.scaleY;
  }
  return {
    x: center.x + fc.x + ta.dx + lx * ta.scaleMul,
    y: center.y + fc.y + ta.dy + ly * ta.scaleMul,
  };
}

function dotAndAxes(
  dotId: ItemId,
  ctx: AnchorContext,
): { error: string } | { error: null; axes: AxesItem; point: { x: number; y: number } } {
  const dot = ctx.items.get(dotId);
  if (dot?.kind !== 'graphDot') return { error: `Connector anchor "${dotId}" is not a graph dot.` };
  const axes = ctx.items.get(dot.axesId);
  if (axes?.kind !== 'axes') return { error: `Graph dot "${dotId}" has no axes.` };
  const motion = resolveGraphDotPosition({ dot, items: [...ctx.items.values()], time: ctx.time });
  if (motion.error) return { error: `Graph dot "${dotId}": ${motion.error}` };
  return { error: null, axes, point: motion.point };
}

/** World position of one anchor at `ctx.time`. `owner` is the connector (for `point` anchors). */
export function resolveShapeAnchor(anchor: ShapeAnchor, owner: SceneItem, ctx: AnchorContext): AnchorResult {
  switch (anchor.kind) {
    case 'point': {
      if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return { point: null, error: 'Fixed connector point must be finite.' };
      const fc = frameOffset(owner, ctx);
      return { point: { x: anchor.x + fc.x, y: anchor.y + fc.y }, error: null };
    }
    case 'graphPoint': {
      const axes = ctx.items.get(anchor.axesId);
      if (axes?.kind !== 'axes') return { point: null, error: `Connector anchor axes "${anchor.axesId}" is missing.` };
      if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return { point: null, error: 'Connector graph point must be finite.' };
      return { point: axesGraphToWorld(axes, anchor.x, anchor.y, ctx), error: null };
    }
    case 'graphDot': {
      const r = dotAndAxes(anchor.dotId, ctx);
      if (r.error != null) return { point: null, error: r.error };
      return { point: axesGraphToWorld(r.axes, r.point.x, r.point.y, ctx), error: null };
    }
    case 'graphDotFoot': {
      const r = dotAndAxes(anchor.dotId, ctx);
      if (r.error != null) return { point: null, error: r.error };
      const guides = graphProjectionGuides(r.point, r.axes);
      const foot = anchor.axis === 'y' ? guides.horizontal : guides.vertical;
      return { point: axesGraphToWorld(r.axes, foot.x2, foot.y2, ctx), error: null };
    }
    case 'object': {
      const target = ctx.items.get(anchor.itemId);
      if (!target || !OBJECT_ANCHOR_KINDS.has(target.kind)) {
        return { point: null, error: `Connector anchor "${anchor.itemId}" must be a text line, shape, image or axes.` };
      }
      if (isBoundShape(target)) return { point: null, error: 'A connector or angle mark cannot be anchored to another one.' };
      const center = resolvePosition(target, ctx.items);
      const fc = frameOffset(target, ctx);
      const ta = targetAnimPreviewAccum(target.id, ctx.time, ctx.items);
      const box = getItemBBox(target);
      const edge = anchor.edge && anchor.edge !== 'center' ? rawDirectionComponents(anchor.edge) : { dx: 0, dy: 0 };
      return {
        point: {
          x: center.x + fc.x + ta.dx + (edge.dx * box.w * ta.scaleMul) / 2,
          y: center.y + fc.y + ta.dy + (edge.dy * box.h * ta.scaleMul) / 2,
        },
        error: null,
      };
    }
    default:
      return { point: null, error: 'Unknown connector anchor.' };
  }
}

export type ConnectorResult =
  | {
      start: { x: number; y: number };
      end: { x: number; y: number };
      /** Tangent connectors: the plot's slope dy/dx (graph units) at the dot. */
      slope?: number;
      error: null;
    }
  | { start: null; end: null; error: string };

/**
 * The dot and the function plot a tangent connector uses: `tangent.plotId`, else the plot the dot
 * is attached to, else the one plot its Move-along-graph clips follow.
 */
export function tangentSource(
  endpoints: ShapeEndpoints,
  items: ReadonlyMap<ItemId, SceneItem>,
):
  | { dot: GraphDotItem; plot: GraphPlotItem; axes: AxesItem; domain: [number, number]; error: null }
  | { error: string } {
  if (endpoints.start.kind !== 'graphDot') return { error: 'A tangent needs its start anchor on a graph dot.' };
  const dot = items.get(endpoints.start.dotId);
  if (dot?.kind !== 'graphDot') return { error: `Tangent dot "${endpoints.start.dotId}" is not a graph dot.` };
  const r = dotFunctionPlot(dot, items, endpoints.tangent?.plotId);
  if (r.error != null) return { error: `${r.error} Set the tangent's plotId.` };
  return { dot, ...r };
}

function resolveTangent(shape: ShapeItem & { endpoints: ShapeEndpoints }, ctx: AnchorContext): ConnectorResult {
  const length = shape.endpoints.tangent?.length ?? 0;
  if (!Number.isFinite(length) || length <= 0) return { start: null, end: null, error: 'Tangent length must be a positive number.' };
  const src = tangentSource(shape.endpoints, ctx.items);
  if (src.error != null) return { start: null, end: null, error: src.error };
  const at = dotAndAxes(src.dot.id, ctx);
  if (at.error != null) return { start: null, end: null, error: at.error };
  const [x0, x1] = slopeSamplePoints(at.point.x, src.domain);
  const noSlope = `Plot "${src.plot.id}" has no slope at x = ${at.point.x.toFixed(3)}.`;
  let y0: number;
  let y1: number;
  try {
    y0 = evaluateGraphY(src.plot, x0);
    y1 = evaluateGraphY(src.plot, x1);
  } catch {
    return { start: null, end: null, error: `Could not evaluate plot "${src.plot.id}" for the tangent.` };
  }
  if (!(x1 > x0) || !Number.isFinite(y0) || !Number.isFinite(y1)) return { start: null, end: null, error: noSlope };
  // Direction on screen from two nearby curve points, so axes scaling and moves are included.
  const p0 = axesGraphToWorld(src.axes, x0, y0, ctx);
  const p1 = axesGraphToWorld(src.axes, x1, y1, ctx);
  const norm = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (!(norm > 0)) return { start: null, end: null, error: noSlope };
  const c = axesGraphToWorld(at.axes, at.point.x, at.point.y, ctx);
  const ux = ((p1.x - p0.x) / norm) * (length / 2);
  const uy = ((p1.y - p0.y) / norm) * (length / 2);
  return {
    start: { x: c.x - ux, y: c.y - uy },
    end: { x: c.x + ux, y: c.y + uy },
    slope: (y1 - y0) / (x1 - x0),
    error: null,
  };
}

/** Both ends of a connector at `ctx.time`, in world coordinates. */
export function resolveConnectorEndpoints(shape: ShapeItem, ctx: AnchorContext): ConnectorResult {
  if (!shape.endpoints) return { start: null, end: null, error: 'Shape has no bound endpoints.' };
  if (!isTwoPointKind(shape.shapeType)) {
    return { start: null, end: null, error: 'Only lines, arrows and braces can have bound endpoints.' };
  }
  let r: ConnectorResult;
  if (shape.endpoints.tangent) {
    r = resolveTangent(shape as ShapeItem & { endpoints: ShapeEndpoints }, ctx);
    if (r.error != null) return { start: null, end: null, error: `Connector tangent: ${r.error}` };
  } else {
    const start = resolveShapeAnchor(shape.endpoints.start, shape, ctx);
    if (start.error != null) return { start: null, end: null, error: `Connector start: ${start.error}` };
    const end = resolveShapeAnchor(shape.endpoints.end, shape, ctx);
    if (end.error != null) return { start: null, end: null, error: `Connector end: ${end.error}` };
    r = { start: start.point, end: end.point, error: null };
  }
  const extend = shape.endpoints.extend ?? 0;
  const len = Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y);
  if (extend > 0 && len > 1e-9) {
    const ex = ((r.end.x - r.start.x) / len) * extend;
    const ey = ((r.end.y - r.start.y) / len) * extend;
    r = { ...r, start: { x: r.start.x - ex, y: r.start.y - ey }, end: { x: r.end.x + ex, y: r.end.y + ey } };
  }
  return r;
}

/**
 * Static fields (`x`, `y`, `endX`, `endY`) matching the connector at `time`, frame-local to the
 * connector. Keeps bounding boxes, camera fitting and "unbind" sensible. Null when unresolved.
 */
export function connectorStaticGeometry(
  shape: ShapeItem,
  ctx: AnchorContext,
): Pick<ShapeItem, 'x' | 'y' | 'endX' | 'endY' | 'rotationDeg' | 'scale' | 'posSteps'> | null {
  const r = resolveConnectorEndpoints(shape, ctx);
  if (r.error != null) return null;
  const fc = frameOffset(shape, ctx);
  return {
    x: (r.start.x + r.end.x) / 2 - fc.x,
    y: (r.start.y + r.end.y) / 2 - fc.y,
    endX: r.end.x - r.start.x,
    endY: r.end.y - r.start.y,
    rotationDeg: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
  };
}

/** Segments of an angle arc (preview and export draw the same polyline). */
export const ANGLE_MARK_SEGMENTS = 32;
/** Within this of 90° an 'auto' mark is drawn as a right-angle square. */
export const RIGHT_ANGLE_TOLERANCE_DEG = 0.5;

export type AngleMarkResult =
  | { points: { x: number; y: number }[]; vertex: { x: number; y: number }; degrees: number; right: boolean; labelAt: { x: number; y: number }; error: null }
  | { points: null; error: string };

/**
 * The angle at `vertex` between the rays to `from` and `to`, at `ctx.time`, in world coordinates:
 * the smaller angle (0–180°), drawn as an arc of `radius` or a square when it is a right angle.
 * `labelAt` is on the bisector at 1.8 × radius (where an angle name such as α reads well).
 */
export function resolveAngleMark(shape: ShapeItem, ctx: AnchorContext): AngleMarkResult {
  const a = shape.angle;
  if (!a) return { points: null, error: 'Shape is not an angle mark.' };
  const resolve = (anchor: ShapeAnchor, name: string) => {
    const r = resolveShapeAnchor(anchor, shape, ctx);
    return r.error != null ? `Angle ${name}: ${r.error}` : r.point;
  };
  const v = resolve(a.vertex, 'vertex');
  if (typeof v === 'string') return { points: null, error: v };
  const p = resolve(a.from, 'from');
  if (typeof p === 'string') return { points: null, error: p };
  const q = resolve(a.to, 'to');
  if (typeof q === 'string') return { points: null, error: q };
  const n1 = Math.hypot(p.x - v.x, p.y - v.y);
  const n2 = Math.hypot(q.x - v.x, q.y - v.y);
  if (n1 < 1e-9 || n2 < 1e-9) return { points: null, error: 'Angle mark: an arm has zero length (a point sits on the vertex).' };
  const r = Number.isFinite(a.radius) && a.radius > 0 ? a.radius : 0.4;
  const u1 = { x: (p.x - v.x) / n1, y: (p.y - v.y) / n1 };
  const u2 = { x: (q.x - v.x) / n2, y: (q.y - v.y) / n2 };
  const theta = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
  const degrees = (theta * 180) / Math.PI;
  const mode = a.mark ?? 'auto';
  const right = mode === 'right' || (mode === 'auto' && Math.abs(degrees - 90) < RIGHT_ANGLE_TOLERANCE_DEG);
  const bis = { x: u1.x + u2.x, y: u1.y + u2.y };
  const bn = Math.hypot(bis.x, bis.y);
  const bisector = bn > 1e-9 ? { x: bis.x / bn, y: bis.y / bn } : { x: -u1.y, y: u1.x };
  const labelAt = { x: v.x + bisector.x * r * 1.8, y: v.y + bisector.y * r * 1.8 };
  if (right) {
    return {
      points: [
        { x: v.x + u1.x * r, y: v.y + u1.y * r },
        { x: v.x + (u1.x + u2.x) * r, y: v.y + (u1.y + u2.y) * r },
        { x: v.x + u2.x * r, y: v.y + u2.y * r },
      ],
      vertex: v,
      degrees,
      right,
      labelAt,
      error: null,
    };
  }
  const sign = u1.x * u2.y - u1.y * u2.x >= 0 ? 1 : -1;
  const a0 = Math.atan2(u1.y, u1.x);
  const points = Array.from({ length: ANGLE_MARK_SEGMENTS + 1 }, (_, i) => {
    const t = a0 + (sign * theta * i) / ANGLE_MARK_SEGMENTS;
    return { x: v.x + r * Math.cos(t), y: v.y + r * Math.sin(t) };
  });
  return { points, vertex: v, degrees, right, labelAt, error: null };
}

/** Half length and spacing of equal-length ticks (Manim units). */
export const TICK_HALF_LENGTH = 0.12;
export const TICK_SPACING = 0.08;

/** Tick segments across the middle of a→b (1–3 ticks), in the same coordinates as a and b. */
export function tickSegments(a: { x: number; y: number }, b: { x: number; y: number }, count: number): [{ x: number; y: number }, { x: number; y: number }][] {
  const n = Math.max(0, Math.min(3, Math.round(count)));
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (n === 0 || len < 1e-9) return [];
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const nrm = { x: -d.y, y: d.x };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return Array.from({ length: n }, (_, i) => {
    const off = (i - (n - 1) / 2) * TICK_SPACING;
    const c = { x: mid.x + d.x * off, y: mid.y + d.y * off };
    return [
      { x: c.x - nrm.x * TICK_HALF_LENGTH, y: c.y - nrm.y * TICK_HALF_LENGTH },
      { x: c.x + nrm.x * TICK_HALF_LENGTH, y: c.y + nrm.y * TICK_HALF_LENGTH },
    ];
  });
}

/**
 * Static polyline fields (`x`, `y`, `points`) matching an angle mark at `time`, frame-local to the
 * shape: keeps bounding boxes, camera fitting and "unbind" sensible. Null when unresolved.
 */
export function angleMarkStaticGeometry(shape: ShapeItem, ctx: AnchorContext): Pick<ShapeItem, 'x' | 'y' | 'points' | 'rotationDeg' | 'scale' | 'posSteps'> | null {
  const r = resolveAngleMark(shape, ctx);
  if (r.error != null) return null;
  const fc = frameOffset(shape, ctx);
  return {
    x: r.vertex.x - fc.x,
    y: r.vertex.y - fc.y,
    points: r.points.map((q) => ({ x: q.x - r.vertex.x, y: q.y - r.vertex.y })),
    rotationDeg: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
  };
}
