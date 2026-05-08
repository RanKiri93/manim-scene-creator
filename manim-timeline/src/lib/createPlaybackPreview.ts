import type { ItemId, SceneItem } from '@/types/scene';
import { isVisibleAtSceneStartItem } from '@/types/scene';
import { effectiveStart, runDuration } from '@/lib/time';
/** Clip a polyline to the first `progress` fraction of its vertices (for Create animation). */
export function clipPolylineByProgress(pts: number[], progress: number): number[] {
  if (progress >= 1) return pts;
  if (progress <= 0) return [];
  const totalVerts = pts.length / 2;
  if (totalVerts < 2) return pts;
  const keepVerts = Math.max(2, Math.floor(totalVerts * progress) + 1);
  if (keepVerts >= totalVerts) return pts;
  return pts.slice(0, keepVerts * 2);
}

/**
 * Progress `[0, 1]` for Manim-like `Create` over `runDuration`, aligned with export
 * (`run_time=item.duration` for axes/graphPlot etc.).
 *
 * Before `effectiveStart`: `0`.
 * Non-positive duration after start: immediate `1` (matches "instant create" degeneracy).
 */
export function createProgress(
  item: SceneItem,
  time: number,
  items: Map<ItemId, SceneItem>,
): number {
  const t0 = effectiveStart(item, items);
  if (time < t0) return 0;
  if (isVisibleAtSceneStartItem(item)) return 1;
  const dur = runDuration(item, items);
  if (!(dur > 0) || !Number.isFinite(dur)) return 1;
  return Math.max(0, Math.min(1, (time - t0) / dur));
}
