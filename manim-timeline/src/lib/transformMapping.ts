import type { TransformMapping } from '@/types/scene';

/** Ordered source line ids for a transform (multi-source in whole mode). */
export function transformSourceIds(tc: TransformMapping): string[] {
  const ids = tc.sourceLineIds?.length ? tc.sourceLineIds : [tc.sourceLineId];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [tc.sourceLineId, ...ids]) {
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Normalize transform mapping so sourceLineId === sourceLineIds[0]. */
export function normalizeTransformMapping(
  tc: TransformMapping,
): TransformMapping {
  const ids = transformSourceIds(tc);
  return {
    ...tc,
    sourceLineIds: ids,
    sourceLineId: ids[0] ?? tc.sourceLineId,
  };
}
