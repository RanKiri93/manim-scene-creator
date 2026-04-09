import type { SceneItem, SegmentStyle, TextLineItem } from '@/types/scene';

function stripSegmentWaitFields(seg: SegmentStyle): SegmentStyle {
  const r = { ...seg } as Record<string, unknown>;
  delete r.waitAfterEnabled;
  delete r.waitAfterSec;
  return r as unknown as SegmentStyle;
}

/**
 * v14: Remove per-segment `waitAfter*` (post-segment wait feature reverted).
 */
export function migrateItemsToV14(items: SceneItem[]): SceneItem[] {
  return items.map((item) => {
    if (item.kind !== 'textLine') return item;
    const tl = item as TextLineItem;
    return {
      ...tl,
      segments: tl.segments.map(stripSegmentWaitFields),
    };
  });
}
