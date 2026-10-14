import type { AxesItem, ItemId, SceneItem } from '@/types/scene';
import { AXES_PREVIEW_METADATA_VERSION, axesPreviewVisualKey } from '@/lib/axesPreviewRequest';
import { createProgress } from '@/lib/createPlaybackPreview';

/** Local Konva geometry (pixels, axes-centered) for a rasterized axes PNG. */
export interface AxesRasterGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  graphOrigin: { x: number; y: number };
  graphXBasis: { x: number; y: number };
  graphYBasis: { x: number; y: number };
}

export function axesRasterGraphToLocal(geometry: AxesRasterGeometry, x: number, y: number): { x: number; y: number } {
  return {
    x: geometry.graphOrigin.x + x * geometry.graphXBasis.x + y * geometry.graphYBasis.x,
    y: geometry.graphOrigin.y + x * geometry.graphXBasis.y + y * geometry.graphYBasis.y,
  };
}

export function axesRasterLocalToGraph(geometry: AxesRasterGeometry, x: number, y: number): { x: number; y: number } | null {
  const dx = x - geometry.graphOrigin.x;
  const dy = y - geometry.graphOrigin.y;
  const determinant = geometry.graphXBasis.x * geometry.graphYBasis.y - geometry.graphYBasis.x * geometry.graphXBasis.y;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) return null;
  return {
    x: (dx * geometry.graphYBasis.y - dy * geometry.graphYBasis.x) / determinant,
    y: (dy * geometry.graphXBasis.x - dx * geometry.graphXBasis.y) / determinant,
  };
}

/** Translation applied around ideal vector geometry so it matches post-recenter raster coordinates. */
export function axesVectorOverlayOffset(args: {
  geometry: AxesRasterGeometry;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  axW: number;
  axH: number;
}): { x: number; y: number } {
  const idealOriginX = -args.axW / 2 + ((0 - args.xMin) / (args.xMax - args.xMin)) * args.axW;
  const idealOriginY = -args.axH / 2 + (1 - (0 - args.yMin) / (args.yMax - args.yMin)) * args.axH;
  return { x: args.geometry.graphOrigin.x - idealOriginX, y: args.geometry.graphOrigin.y - idealOriginY };
}

export function axesOverlayPoint(args: {
  point: { x: number; y: number };
  geometry: AxesRasterGeometry | null;
  rasterActive: boolean;
  vectorOffset: { x: number; y: number };
  xMin: number; xMax: number; yMin: number; yMax: number; axW: number; axH: number;
}): { x: number; y: number } {
  if (args.geometry) {
    const p = axesRasterGraphToLocal(args.geometry, args.point.x, args.point.y);
    return args.rasterActive ? p : { x: p.x - args.vectorOffset.x, y: p.y - args.vectorOffset.y };
  }
  return {
    x: -args.axW / 2 + ((args.point.x - args.xMin) / (args.xMax - args.xMin)) * args.axW,
    y: -args.axH / 2 + (1 - (args.point.y - args.yMin) / (args.yMax - args.yMin)) * args.axH,
  };
}

export interface AxesRasterPreviewArgs {
  axes: AxesItem;
  time: number;
  itemsMap: Map<ItemId, SceneItem>;
  pxPerUnitX: number;
  pxPerUnitY: number;
}

export function axesRasterCoordinateGeometry(args: Pick<AxesRasterPreviewArgs, 'axes' | 'pxPerUnitX' | 'pxPerUnitY'>): AxesRasterGeometry | null {
  const { axes, pxPerUnitX, pxPerUnitY } = args;
  const bounds = axes.axisPreviewBounds;
  if (!bounds || bounds.metadataVersion !== AXES_PREVIEW_METADATA_VERSION || axes.axisPreviewHash !== axesPreviewVisualKey(axes)) return null;
  const { left, right, top, bottom, originX, originY, xUnitX, xUnitY, yUnitX, yUnitY, coordLeft, coordRight, coordTop, coordBottom } = bounds;
  const numbers = [left, right, top, bottom, originX, originY, xUnitX, xUnitY, yUnitX, yUnitY, coordLeft, coordRight, coordTop, coordBottom, pxPerUnitX, pxPerUnitY];
  if (!numbers.every(Number.isFinite) || !(right > left) || !(top > bottom) || !(coordRight! > coordLeft!) || !(coordTop! > coordBottom!) || !(pxPerUnitX > 0) || !(pxPerUnitY > 0)) return null;
  const width = (right - left) * pxPerUnitX;
  const height = (top - bottom) * pxPerUnitY;
  if (!(width > 0) || !(height > 0)) return null;
  return {
    x: left * pxPerUnitX,
    y: -top * pxPerUnitY,
    width,
    height,
    graphOrigin: { x: originX! * pxPerUnitX, y: -originY! * pxPerUnitY },
    graphXBasis: { x: xUnitX! * pxPerUnitX, y: -xUnitY! * pxPerUnitY },
    graphYBasis: { x: yUnitX! * pxPerUnitX, y: -yUnitY! * pxPerUnitY },
  };
}

/**
 * Decide whether the cached Manim-rasterized axes PNG is safe to draw, and
 * where to place it in axes-local Konva coordinates.
 *
 * Returns `null` (keep the fast vector preview) when the server raster is
 * missing, stale, still animating its Create, or geometrically invalid.
 *
 * `left/right/top/bottom` are aggregate cropped-ink bounds. Graph points use
 * the separately measured post-recenter origin and basis vectors; never infer
 * the mathematical origin from the crop center or legacy ink offsets.
 */
export function axesRasterGeometry(
  args: AxesRasterPreviewArgs,
): AxesRasterGeometry | null {
  const { axes, time, itemsMap } = args;

  const dataUrl =
    typeof axes.axisPreviewDataUrl === 'string'
      ? axes.axisPreviewDataUrl.trim()
      : '';
  if (!dataUrl) return null;

  const geometry = axesRasterCoordinateGeometry(args);
  if (!geometry) return null;

  // Keep the responsive vector reveal while Create is still playing; the
  // raster is the completed-axes look. `createProgress` already returns 1
  // immediately for `visibleAtSceneStart` axes.
  if (createProgress(axes, time, itemsMap) < 1) return null;
  return geometry;
}
