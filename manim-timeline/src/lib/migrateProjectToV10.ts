import { newId } from '@/lib/ids';
import type { ExitAnimStyle, ExitAnimationItem, SceneItem } from '@/types/scene';
import {
  canBeExitTarget,
  effectiveStart,
  runDuration,
} from '@/lib/time';

function stripLegacyFields(item: SceneItem): SceneItem {
  const rec = item as unknown as Record<string, unknown>;
  delete rec.waitAfter;
  delete rec.exitAnimStyle;
  delete rec.exitRunTime;
  return item;
}

/**
 * Pre-v10 projects stored exit timing on each clip and used `waitAfter`.
 * Converts to `exit_animation` items and removes legacy fields.
 */
export function migrateItemsFromPreV10(items: SceneItem[]): SceneItem[] {
  const map = new Map(items.map((i) => [i.id, i]));
  const newExits: ExitAnimationItem[] = [];

  for (const item of items) {
    if (item.kind === 'exit_animation') continue;
    if (!canBeExitTarget(item)) continue;
    const rec = item as unknown as Record<string, unknown>;
    const style = rec.exitAnimStyle as ExitAnimStyle | undefined;
    if (!style || style === 'none') continue;
    const wait = (rec.waitAfter as number) ?? 0;
    const rt = (rec.exitRunTime as number) ?? 1;
    const effStart = effectiveStart(item, map);
    const rd = runDuration(item, map);
    newExits.push({
      kind: 'exit_animation',
      id: newId(),
      label: '',
      layer: item.layer,
      startTime: effStart + rd + wait,
      duration: Math.max(0.01, rt),
      targets: [{ targetId: item.id, animStyle: style }],
    });
  }

  const stripped = items
    .filter((i) => i.kind !== 'exit_animation')
    .map((i) => stripLegacyFields(i));

  return [...stripped, ...newExits];
}
