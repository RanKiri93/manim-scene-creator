import type { ManimDirection, PosStep, SceneItem, TextLineItem } from '@/types/scene';

const EDGE_ALIGN: ManimDirection[] = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'UL', 'UR', 'DL', 'DR'];

/** Ensures `next_to` steps include v20 fields (also used from `migrateSceneItems`). */
export function normalizeNextToPosStep(step: PosStep): PosStep {
  if (step.kind !== 'next_to') return step;
  const s = step as unknown as Record<string, unknown>;
  const aeRaw = s.alignedEdge;
  const alignedEdge =
    typeof aeRaw === 'string' && EDGE_ALIGN.includes(aeRaw as ManimDirection)
      ? (aeRaw as ManimDirection)
      : null;
  return {
    kind: 'next_to',
    refKind: step.refKind,
    refId: step.refId,
    dir: step.dir,
    buff: step.buff,
    alignedEdge,
    refSegmentIndex:
      typeof s.refSegmentIndex === 'number' && Number.isFinite(s.refSegmentIndex)
        ? s.refSegmentIndex
        : null,
    selfSegmentIndex:
      typeof s.selfSegmentIndex === 'number' && Number.isFinite(s.selfSegmentIndex)
        ? s.selfSegmentIndex
        : null,
    bounds:
      s.bounds === 'mobject' || s.bounds === 'ink' ? s.bounds : null,
  };
}

/**
 * v20: `next_to` gains alignedEdge, ref/self segment indices, bounds (mobject vs ink);
 * text lines gain `segmentMeasures` from measure server.
 */
export function migrateItemsToV20(items: readonly SceneItem[]): SceneItem[] {
  return items.map((it) => {
    if (it.kind === 'exit_animation') return it;
    if (it.kind === 'surroundingRect') return it;
    const next = {
      ...it,
      posSteps: it.posSteps.map(normalizeNextToPosStep),
    } as SceneItem;
    if (next.kind === 'textLine') {
      const t = next as TextLineItem;
      if (t.segmentMeasures === undefined) t.segmentMeasures = null;
    }
    return next;
  });
}
