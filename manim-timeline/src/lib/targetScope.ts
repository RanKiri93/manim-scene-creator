import type { FrameDef, ItemId, SceneItem } from '@/types/scene';
import { associatedFrameId, frameDisplayName } from '@/lib/frameGrid';
import { exitTargetSelectLabel, itemClipDisplayName } from '@/lib/itemDisplayName';

export type TargetScope = 'same-frame' | 'all-frames';

export function targetScopeFrameId(
  owner: SceneItem | null | undefined,
  itemsMap: ReadonlyMap<ItemId, SceneItem>,
  startFrameId: ItemId | null | undefined,
): ItemId | null {
  return owner ? associatedFrameId(owner, itemsMap, startFrameId) : (startFrameId ?? null);
}

export function targetCandidateFrameId(
  item: SceneItem,
  itemsMap: ReadonlyMap<ItemId, SceneItem>,
  startFrameId: ItemId | null | undefined,
): ItemId | null {
  return associatedFrameId(item, itemsMap, startFrameId);
}

export function filterTargetsByScope<T extends SceneItem>(
  candidates: readonly T[],
  itemsMap: ReadonlyMap<ItemId, SceneItem>,
  startFrameId: ItemId | null | undefined,
  ownerFrameId: ItemId | null,
  scope: TargetScope,
): T[] {
  if (scope === 'all-frames' || !ownerFrameId) return [...candidates];
  return candidates.filter(
    (candidate) => targetCandidateFrameId(candidate, itemsMap, startFrameId) === ownerFrameId,
  );
}

export function sameFrameTargets<T extends SceneItem>(
  candidates: readonly T[],
  itemsMap: ReadonlyMap<ItemId, SceneItem>,
  startFrameId: ItemId | null | undefined,
  frameId: ItemId | null,
): T[] {
  if (!frameId) return [...candidates];
  return candidates.filter(
    (candidate) => targetCandidateFrameId(candidate, itemsMap, startFrameId) === frameId,
  );
}

export function frameAwareItemLabel(
  item: SceneItem,
  itemsMap: Map<ItemId, SceneItem>,
  frames: readonly FrameDef[],
  startFrameId: ItemId | null | undefined,
  includeFrame: boolean,
): string {
  const base = exitTargetSelectLabel(item, itemsMap);
  if (!includeFrame) return base;
  const frameId = targetCandidateFrameId(item, itemsMap, startFrameId);
  const frame = frames.find((f) => f.id === frameId);
  return `${frameDisplayName(frame, frames)}  ·  ${base}`;
}

export function frameAwareShortLabel(
  item: SceneItem,
  itemsMap: ReadonlyMap<ItemId, SceneItem>,
  frames: readonly FrameDef[],
  startFrameId: ItemId | null | undefined,
  includeFrame: boolean,
): string {
  const base = itemClipDisplayName(item);
  if (!includeFrame) return base;
  const frameId = targetCandidateFrameId(item, itemsMap, startFrameId);
  const frame = frames.find((f) => f.id === frameId);
  return `${frameDisplayName(frame, frames)} · ${base}`;
}
