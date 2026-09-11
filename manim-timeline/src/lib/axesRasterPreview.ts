import type { AxesItem, ItemId, SceneItem } from '@/types/scene';
import { axesPreviewVisualKey } from '@/lib/axesPreviewRequest';
import { createProgress } from '@/lib/createPlaybackPreview';

/** Local Konva geometry (pixels, axes-centered) for a rasterized axes PNG. */
export interface AxesRasterGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AxesRasterPreviewArgs {
  axes: AxesItem;
  time: number;
  itemsMap: Map<ItemId, SceneItem>;
  pxPerUnitX: number;
  pxPerUnitY: number;
}

/**
 * Decide whether the cached Manim-rasterized axes PNG is safe to draw, and
 * where to place it in axes-local Konva coordinates.
 *
 * Returns `null` (keep the fast vector preview) when the server raster is
 * missing, stale, still animating its Create, or geometrically invalid.
 *
 * `axisPreviewBounds` are Manim-unit ink extents measured with the axes group
 * centered at the origin (`grp.move_to(ORIGIN)` server-side), so a Manim
 * point `(mx, my)` maps to local Konva `(mx * pxPerUnitX, -my * pxPerUnitY)`.
 */
export function axesRasterGeometry(
  args: AxesRasterPreviewArgs,
): AxesRasterGeometry | null {
  const { axes, time, itemsMap, pxPerUnitX, pxPerUnitY } = args;

  const dataUrl =
    typeof axes.axisPreviewDataUrl === 'string'
      ? axes.axisPreviewDataUrl.trim()
      : '';
  if (!dataUrl) return null;

  const bounds = axes.axisPreviewBounds;
  if (!bounds) return null;
  const { left, right, top, bottom } = bounds;
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    !Number.isFinite(top) ||
    !Number.isFinite(bottom)
  ) {
    return null;
  }
  if (!(right > left) || !(top > bottom)) return null;
  if (
    !Number.isFinite(pxPerUnitX) ||
    !Number.isFinite(pxPerUnitY) ||
    !(pxPerUnitX > 0) ||
    !(pxPerUnitY > 0)
  ) {
    return null;
  }

  // Never show a raster rendered for older visual settings.
  if (axes.axisPreviewHash !== axesPreviewVisualKey(axes)) return null;

  // Keep the responsive vector reveal while Create is still playing; the
  // raster is the completed-axes look. `createProgress` already returns 1
  // immediately for `visibleAtSceneStart` axes.
  if (createProgress(axes, time, itemsMap) < 1) return null;

  const width = (right - left) * pxPerUnitX;
  const height = (top - bottom) * pxPerUnitY;
  if (!(width > 0) || !(height > 0)) return null;

  return {
    x: left * pxPerUnitX,
    y: -top * pxPerUnitY,
    width,
    height,
  };
}
