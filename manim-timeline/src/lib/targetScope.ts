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

/**
 * The objects an inserted animation clip (blink, exit, surround, move …) will act on: the selected
 * objects that can take it, else the earliest object in the active frame that can.
 * `fromSelection` is false for that fallback; empty `ids` means nothing in the frame can take it.
 * `sameFrameAsFirst`: keep only selected objects in the first one's frame (surrounding rects).
 */
export function resolveAnimationTargets(
  selectedIds: Iterable<ItemId>,
  itemsMap: Map<ItemId, SceneItem>,
  canTake: (item: SceneItem) => boolean,
  startFrameId: ItemId | null | undefined,
  activeFrameId: ItemId | null | undefined,
  options: { sameFrameAsFirst?: boolean } = {},
): { ids: ItemId[]; fromSelection: boolean } {
  const frameId = activeFrameId ?? startFrameId ?? null;
  const seen = new Set<ItemId>();
  let selected: SceneItem[] = [];
  for (const id of selectedIds) {
    const it = itemsMap.get(id);
    if (it && canTake(it) && !seen.has(it.id)) {
      seen.add(it.id);
      selected.push(it);
    }
  }
  if (options.sameFrameAsFirst && selected.length > 0) {
    const firstFrame = targetCandidateFrameId(selected[0]!, itemsMap, frameId);
    selected = selected.filter((t) => targetCandidateFrameId(t, itemsMap, frameId) === firstFrame);
  }
  if (selected.length > 0) return { ids: selected.map((t) => t.id), fromSelection: true };
  const candidates = sameFrameTargets([...itemsMap.values()].filter(canTake), itemsMap, startFrameId, frameId);
  candidates.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  return { ids: candidates.length ? [candidates[0]!.id] : [], fromSelection: false };
}

/**
 * One sentence saying which objects an inserted animation will act on (button tooltips and the
 * Animate group's helper line). `none` when nothing in the frame can take it.
 */
export function describeAnimationTargets(
  result: { ids: ItemId[]; fromSelection: boolean },
  itemsMap: ReadonlyMap<ItemId, SceneItem>,
  hasSelection: boolean,
): { text: string; none: boolean } {
  if (result.ids.length === 0) return { text: 'Nothing in this frame can take it.', none: true };
  const name = (id: ItemId) => {
    const it = itemsMap.get(id);
    const label = it ? itemClipDisplayName(it).trim() : id;
    return `“${label.length > 22 ? `${label.slice(0, 22)}…` : label}”`;
  };
  if (result.fromSelection) {
    if (result.ids.length === 1) return { text: `Will target ${name(result.ids[0]!)}.`, none: false };
    const shown = result.ids.slice(0, 3).map(name).join(', ');
    return { text: `Will target ${result.ids.length} selected: ${shown}${result.ids.length > 3 ? ', …' : ''}.`, none: false };
  }
  return hasSelection
    ? { text: `The selection cannot take it; will target ${name(result.ids[0]!)} instead.`, none: false }
    : { text: `Will target ${name(result.ids[0]!)} (earliest in this frame). Select objects to choose.`, none: false };
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
