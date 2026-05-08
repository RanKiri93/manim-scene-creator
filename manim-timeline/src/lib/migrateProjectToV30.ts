import type { AxesItem, SceneItem } from '@/types/scene';

/**
 * v30: `AxesItem` gains client-only axis raster preview fields from measure server.
 */
export function migrateItemsToV30(items: readonly SceneItem[]): SceneItem[] {
  return items.map((item) => {
    if (item.kind !== 'axes') return { ...item };
    const ax = item as AxesItem;
    return {
      ...item,
      axisPreviewDataUrl: ax.axisPreviewDataUrl ?? null,
      axisPreviewError: ax.axisPreviewError ?? null,
      axisPreviewHash: ax.axisPreviewHash ?? null,
      axisPreviewBounds: ax.axisPreviewBounds ?? null,
    };
  });
}
