import type {
  AxesItem,
  FrameDef,
  GraphDotItem,
  GraphPlotItem,
  ItemId,
  SceneItem,
  ShapeAnchor,
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

/** Scene state an anchor is resolved against. Points come out in world (camera-grid) coordinates. */
export interface AnchorContext {
  items: Map<ItemId, SceneItem>;
  time: number;
  frames: readonly FrameDef[];
  startFrameId: ItemId | null;
}

export type AnchorResult = { point: { x: number; y: number }; error: null } | { point: null; error: string };

/** Kinds an `object` anchor may reference (they have one Manim mobject with a centre and edges). */
export const OBJECT_ANCHOR_KINDS: ReadonlySet<SceneItem['kind']> = new Set(['textLine', 'shape', 'image', 'axes']);

/** True for a line / arrow whose ends follow anchors. */
export function isConnectorShape(item: SceneItem | undefined | null): item is ShapeItem & { endpoints: ShapeEndpoints } {
  return (
    item?.kind === 'shape' &&
    (item.shapeType === 'line' || item.shapeType === 'arrow') &&
    item.endpoints != null
  );
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
      if (isConnectorShape(target)) return { point: null, error: 'A connector cannot be anchored to another connector.' };
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
  if (shape.shapeType !== 'line' && shape.shapeType !== 'arrow') {
    return { start: null, end: null, error: 'Only lines and arrows can have bound endpoints.' };
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
