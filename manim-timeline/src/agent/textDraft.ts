import { parseSegments } from '@/lib/textSegments';
import { reconcileSegmentStyles } from '@/lib/segmentReconcile';
import { createSegmentStyle, defaultSceneDefaults } from '@/store/factories';
import type { SceneDefaults, SceneItem, SegmentStyle, TextBaseDir, TextLineItem } from '@/types/scene';

/** Fields whose change makes a text line's measure stale (segment colours do not). */
const MEASURED_FIELDS = ['raw', 'baseDir', 'font', 'fontSize', 'englishFont'] as const;

/**
 * A created text line as it will be after Approve: segments parsed from `raw` when the action
 * left them empty (same as `commit.ts`).
 */
export function withParsedSegments(item: SceneItem, defaults: SceneDefaults = defaultSceneDefaults()): SceneItem {
  if (item.kind !== 'textLine' || !item.raw.trim() || item.segments.length > 0) return item;
  const segments = parseSegments(item.raw, item.baseDir ?? 'rtl').map((p) => createSegmentStyle(p.text, p.isMath, defaults));
  return { ...item, segments };
}

/**
 * A text line after an UPDATE, the way Approve applies it: a new `raw` / `baseDir` re-derives the
 * segments (styles follow their text) and `segments` in the patch is applied by index, style and
 * timing only (mirrors the store's `setTextLineSource`). A change to what is measured drops the
 * old measure.
 */
export function mergeTextLineUpdate(
  existing: TextLineItem,
  updates: Partial<TextLineItem>,
  defaults: SceneDefaults = defaultSceneDefaults(),
): TextLineItem {
  const stale = MEASURED_FIELDS.some((key) => key in updates);
  const cleared = stale ? { measure: null, segmentMeasures: null, mathChildMeasures: null, previewDataUrl: null } : {};
  if (!('raw' in updates) && !('baseDir' in updates)) return { ...existing, ...updates, ...cleared } as TextLineItem;
  const { raw, baseDir, segments: patches, ...rest } = updates;
  const source = typeof raw === 'string' ? raw : existing.raw;
  const dir: TextBaseDir = 'baseDir' in updates ? (baseDir ?? 'rtl') : (existing.baseDir ?? 'rtl');
  const { segments } = reconcileSegmentStyles(existing.id, existing.segments, parseSegments(source, dir), (p) =>
    createSegmentStyle(p.text, p.isMath, defaults),
  );
  const styled = segments.map((seg, i): SegmentStyle => {
    const patch = Array.isArray(patches) ? patches[i] : undefined;
    if (!patch) return seg;
    const { color, bold, italic, waitAfterSec, animSec } = patch;
    return {
      ...seg,
      ...(color !== undefined && { color }),
      ...(bold !== undefined && { bold }),
      ...(italic !== undefined && { italic }),
      ...('waitAfterSec' in patch && { waitAfterSec }),
      ...('animSec' in patch && { animSec }),
    };
  });
  return {
    ...existing,
    ...rest,
    ...cleared,
    raw: source,
    baseDir: dir === 'rtl' ? undefined : dir,
    segments: styled,
  } as TextLineItem;
}
