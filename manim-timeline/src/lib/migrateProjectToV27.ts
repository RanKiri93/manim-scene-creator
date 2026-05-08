import type { GraphFieldItem, SceneItem } from '@/types/scene';
import { DEFAULT_FIELD_ARROW_STROKE_WIDTH } from '@/types/scene';

/**
 * v27: introduce `arrowStrokeWidth` on `graphField` items.
 *
 * Older projects were rendered with Manim's per-arrow adaptive stroke width
 * and with a hard-coded 1.5 px Konva preview. This migration simply seeds the
 * field with the new default so the editor, preview, and codegen all see a
 * well-defined value. Projects that already carry the key (future or
 * manually edited files) are left untouched.
 */
export function migrateItemsToV27(items: readonly SceneItem[]): SceneItem[] {
  return items.map((raw) => {
    if (raw.kind !== 'graphField') return { ...raw };
    const it = raw as GraphFieldItem & { arrowStrokeWidth?: number };
    if (typeof it.arrowStrokeWidth === 'number') return { ...it };
    return { ...it, arrowStrokeWidth: DEFAULT_FIELD_ARROW_STROKE_WIDTH };
  });
}
