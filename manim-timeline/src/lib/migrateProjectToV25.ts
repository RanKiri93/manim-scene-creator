import type { AxesItem, SceneItem } from '@/types/scene';
import { syncAxesLegacyScale } from '@/types/scene';

/**
 * v25: per-axis `scaleX` / `scaleY` on axes (was single `scale` for both lengths).
 */
export function migrateItemsToV25(items: readonly SceneItem[]): SceneItem[] {
  return items.map((it) => {
    if (it.kind !== 'axes') return { ...it };
    const a = it as AxesItem & { scaleX?: number; scaleY?: number };
    const sx = a.scaleX;
    const sy = a.scaleY;
    if (
      typeof sx === 'number' &&
      Number.isFinite(sx) &&
      sx > 0 &&
      typeof sy === 'number' &&
      Number.isFinite(sy) &&
      sy > 0
    ) {
      return { ...it };
    }
    const u = Math.max(0.01, a.scale ?? 1);
    return {
      ...a,
      scaleX: u,
      scaleY: u,
      scale: syncAxesLegacyScale(u, u),
    };
  });
}
