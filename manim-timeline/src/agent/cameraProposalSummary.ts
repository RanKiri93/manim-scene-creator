import { FRAME_W } from '@/lib/constants';
import { resolveCameraSchedule, resolveCameraTargetWidth } from '@/lib/camera';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import type { FrameDef, ItemId, SceneItem, CameraMoveItem } from '@/types/scene';
import type { AgentAction } from './types';

export interface CameraProposalSummary {
  clip: CameraMoveItem;
  displayName: string;
  frameLabel: string;
  overrideLabel: string | null;
  overrideTime: number | null;
  returnStart: number | null;
  returnEnd: number | null;
  targetWidth: number;
}

/** Pure proposal-only summary; schedule precedence always comes from lib/camera. */
export function summarizeCameraProposal(
  actions: readonly AgentAction[] | undefined,
  items: ReadonlyMap<ItemId, SceneItem>,
  frames: readonly FrameDef[],
  startFrameId: ItemId | null,
): CameraProposalSummary[] {
  const virtualItems = new Map<ItemId, SceneItem>(items);
  const proposedCameraIds = new Set<ItemId>();
  for (const action of actions ?? []) {
    if (action.action === 'CREATE') {
      virtualItems.set(action.item.id, action.item);
      if (action.item.kind === 'camera_move') proposedCameraIds.add(action.item.id);
    } else if (action.action === 'UPDATE') {
      const existing = virtualItems.get(action.itemId);
      if (!existing) continue;
      const updated = { ...existing, ...action.updates } as SceneItem;
      virtualItems.set(action.itemId, updated);
      if (existing.kind === 'camera_move' || updated.kind === 'camera_move') proposedCameraIds.add(action.itemId);
    } else {
      if (virtualItems.get(action.itemId)?.kind === 'camera_move') proposedCameraIds.add(action.itemId);
      virtualItems.delete(action.itemId);
    }
  }

  const schedule = resolveCameraSchedule(virtualItems, frames, startFrameId ?? '');
  return [...proposedCameraIds].flatMap((id) => {
    const clip = virtualItems.get(id);
    if (!clip || clip.kind !== 'camera_move') return [];
    const segment = schedule.segments.find((entry) => entry.clip.id === clip.id);
    const returnClip = [...virtualItems.values()]
      .filter((item): item is CameraMoveItem => item.kind === 'camera_move' && item.id !== clip.id && item.startTime >= clip.startTime && resolveCameraTargetWidth(item) >= FRAME_W - 1e-6)
      .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id))[0];
    return [{
      clip,
      displayName: itemClipDisplayName(clip),
      frameLabel: frames.find((frame) => frame.id === clip.targetFrameId)?.label || clip.targetFrameId,
      overrideLabel: segment?.overriddenBy ? itemClipDisplayName(segment.overriddenBy) : null,
      overrideTime: segment?.overriddenBy?.startTime ?? null,
      returnStart: returnClip?.startTime ?? null,
      returnEnd: returnClip ? returnClip.startTime + returnClip.duration : null,
      targetWidth: resolveCameraTargetWidth(clip),
    }];
  });
}
