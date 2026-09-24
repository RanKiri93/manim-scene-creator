import type { CameraMoveItem, ItemId } from '@/types/scene';
import type { CameraSchedule, CameraTransitionSegment } from '@/lib/camera';
import { itemClipDisplayName } from '@/lib/itemDisplayName';

export interface CameraClipPresentation {
  overridden: boolean;
  effectiveStart: number;
  effectiveEnd: number;
  overrideStart: number | null;
  winnerLabel: string | null;
  superseded: boolean;
}

export function cameraClipPresentation(
  item: CameraMoveItem,
  schedule: CameraSchedule,
): CameraClipPresentation {
  const segment = schedule.segments.find((candidate) => candidate.clip.id === item.id) as CameraTransitionSegment | undefined;
  return {
    overridden: Boolean(segment?.overriddenBy),
    effectiveStart: segment?.startTime ?? item.startTime,
    effectiveEnd: segment?.effectiveEndTime ?? item.startTime + item.duration,
    overrideStart: segment?.overriddenBy?.startTime ?? null,
    winnerLabel: segment?.overriddenBy
      ? itemClipDisplayName(segment.overriddenBy)
      : segment?.supersededByEqualStart
        ? itemClipDisplayName(segment.supersededByEqualStart)
        : null,
    superseded: Boolean(segment?.supersededByEqualStart),
  };
}

export function cameraPreviewDeletedIds(ops: ReadonlyMap<ItemId, string>): ReadonlySet<ItemId> {
  return new Set([...ops].filter(([, op]) => op === 'delete').map(([id]) => id));
}
