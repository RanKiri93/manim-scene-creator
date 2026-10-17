import type { SceneItem } from '@/types/scene';

/** Konva node id given to each canvas entry's wrapper group, so chrome can find it on the stage. */
export function canvasItemNodeId(itemId: string): string {
  return `scene-item-${itemId}`;
}

/**
 * The canvas entry whose on-screen bounds stand for a selected item. Graph parts (plots, dots,
 * fields…) are drawn inside their axes, so they anchor to those axes. Clips and audio have no
 * place on the stage.
 */
export function anchorItemIdFor(item: SceneItem): string | null {
  switch (item.kind) {
    case 'textLine':
    case 'shape':
    case 'image':
    case 'matrix':
    case 'surroundingRect':
    case 'axes':
      return item.id;
    default:
      return 'axesId' in item && typeof item.axesId === 'string' ? item.axesId : null;
  }
}

export type AnchorRect = { left: number; top: number; right: number; bottom: number };

/** Union of rects, or null when there are none. */
export function unionRects(rects: readonly AnchorRect[]): AnchorRect | null {
  if (!rects.length) return null;
  return rects.reduce((u, r) => ({
    left: Math.min(u.left, r.left),
    top: Math.min(u.top, r.top),
    right: Math.max(u.right, r.right),
    bottom: Math.max(u.bottom, r.bottom),
  }));
}

/**
 * Where to put a bar of the given size over an anchor inside a container: centred above the
 * anchor, flipped below when there is no room above, and kept inside the container.
 */
export function placeAboveAnchor(
  anchor: AnchorRect,
  bar: { width: number; height: number },
  container: { width: number; height: number },
  gap = 8,
  margin = 4,
): { left: number; top: number } {
  const centre = (anchor.left + anchor.right) / 2;
  const left = Math.max(margin, Math.min(centre - bar.width / 2, container.width - bar.width - margin));
  const above = anchor.top - gap - bar.height;
  const below = anchor.bottom + gap;
  const top =
    above >= margin
      ? above
      : below + bar.height <= container.height - margin
        ? below
        : margin;
  return { left, top };
}
