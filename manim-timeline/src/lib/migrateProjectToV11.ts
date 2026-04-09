import type {
  ExitAnimStyle,
  ExitAnimationItem,
  ExitTargetSpec,
  SceneItem,
} from '@/types/scene';

function normalizeExitAnimation(item: ExitAnimationItem): ExitAnimationItem {
  const rec = item as unknown as Record<string, unknown>;
  const hasTargets =
    Array.isArray(rec.targets) &&
    (rec.targets as ExitTargetSpec[]).length > 0;
  if (hasTargets) {
    const targets = (rec.targets as ExitTargetSpec[]).map((t) => ({
      targetId: String(t.targetId),
      animStyle: (t.animStyle ?? 'fade_out') as ExitAnimStyle,
    }));
    return {
      ...item,
      targets,
    };
  }
  const legacyTarget = rec.targetId as string | undefined;
  const legacyStyle = (rec.animStyle ?? 'fade_out') as ExitAnimStyle;
  if (legacyTarget) {
    return {
      ...item,
      targets: [{ targetId: legacyTarget, animStyle: legacyStyle }],
    };
  }
  return {
    ...item,
    targets: [],
  };
}

/**
 * v11: `exit_animation` uses `targets[]` instead of flat `targetId` / `animStyle`.
 */
export function migrateItemsToV11(items: SceneItem[]): SceneItem[] {
  const out: SceneItem[] = [];
  for (const item of items) {
    if (item.kind !== 'exit_animation') {
      out.push(item);
      continue;
    }
    const n = normalizeExitAnimation(item);
    if (n.targets.length === 0) continue;
    out.push(n);
  }
  return out;
}
