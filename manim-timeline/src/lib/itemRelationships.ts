import type { ItemId, SceneItem } from '@/types/scene';
import { itemClipDisplayName } from '@/lib/itemDisplayName';

/**
 * Pure helpers for the Items panel "By object" view.
 *
 * Roles:
 * - `object` — drawable rows that become group headers (text, axes, graph
 *   overlays, shapes, and surrounding rects, which exits can target).
 * - `effect` — clips that nest under the objects they target
 *   (`exit_animation`, `blink_animation`, `target_animation`).
 * - `global` — clips with no object scope (`camera_move`); always listed in
 *   the unassigned bucket.
 *
 * Grouping only ever uses the caller-provided (already frame-filtered) item
 * list; multi-target clips are referenced under each visible target object
 * but always point at the single real item id.
 */

export type ItemPanelRole = 'object' | 'effect' | 'global';

export function itemPanelRole(item: SceneItem): ItemPanelRole {
  switch (item.kind) {
    case 'exit_animation':
    case 'blink_animation':
    case 'target_animation':
      return 'effect';
    case 'camera_move':
      return 'global';
    default:
      return 'object';
  }
}

/** Ids of drawable objects this clip directly references (empty for plain objects/globals). */
export function relatedObjectIds(item: SceneItem): ItemId[] {
  switch (item.kind) {
    case 'exit_animation':
    case 'blink_animation':
    case 'target_animation':
      return item.targets.map((t) => t.targetId);
    case 'surroundingRect':
      return [...item.targetIds];
    default:
      return [];
  }
}

export interface RelatedChildRef {
  /** The real clip (effects) or rect — selection/duplicate/delete act on this id. */
  item: SceneItem;
  /** Total referenced targets, for "+N targets" hints. */
  targetCount: number;
  /** Display names of the *other* referenced targets (up to 3) for tooltips. */
  otherTargetNames: string[];
  /** True when at least one referenced target no longer exists. */
  hasMissingTarget: boolean;
}

export interface ObjectGroup {
  object: SceneItem;
  children: RelatedChildRef[];
}

export interface ObjectPanelModel {
  groups: ObjectGroup[];
  /** Global clips + clips with no visible target, in chronological order. */
  unassigned: SceneItem[];
}

function compareRowTime(a: SceneItem, b: SceneItem): number {
  return (
    a.startTime - b.startTime || a.layer - b.layer || a.id.localeCompare(b.id)
  );
}

const EXIT_STYLE_LABELS: Record<string, string> = {
  fade_out: 'FadeOut',
  uncreate: 'Uncreate',
  shrink_to_center: 'ShrinkToCenter',
  none: 'None',
};

/**
 * Compact nested-row title that drops the (redundant under its parent) target
 * names, e.g. "Exit · FadeOut", "Blink · scale", "Color", "Rect".
 */
export function nestedChildTitle(item: SceneItem, parentId: ItemId): string {
  switch (item.kind) {
    case 'exit_animation': {
      const row =
        item.targets.find((t) => t.targetId === parentId) ?? item.targets[0];
      const style = row
        ? (EXIT_STYLE_LABELS[row.animStyle] ?? row.animStyle)
        : null;
      return style ? `Exit · ${style}` : 'Exit';
    }
    case 'blink_animation': {
      const row =
        item.targets.find((t) => t.targetId === parentId) ?? item.targets[0];
      return row ? `Blink · ${row.mode}` : 'Blink';
    }
    case 'target_animation': {
      const m = item.mode;
      return `${m[0]!.toUpperCase()}${m.slice(1)}`;
    }
    case 'surroundingRect':
      return item.label.trim() || 'Rect';
    default:
      return itemClipDisplayName(item);
  }
}

/** Compact group count, e.g. "1 related", "3 related". */
export function relatedCountLabel(count: number): string {
  return `${count} related`;
}

/**
 * Group an already-filtered (frame + top-level) chronological item list into
 * object groups with nested related clips, plus an unassigned bucket.
 */
export function buildObjectPanelModel(
  visibleItems: readonly SceneItem[],
  itemsMap: ReadonlyMap<ItemId, SceneItem>,
): ObjectPanelModel {
  const visibleById = new Map<ItemId, SceneItem>();
  for (const it of visibleItems) visibleById.set(it.id, it);

  const groups: ObjectGroup[] = [];
  const groupIndex = new Map<ItemId, ObjectGroup>();
  for (const it of visibleItems) {
    if (itemPanelRole(it) !== 'object') continue;
    const group: ObjectGroup = { object: it, children: [] };
    groups.push(group);
    groupIndex.set(it.id, group);
  }

  const unassigned: SceneItem[] = [];

  const pushChild = (
    parent: ObjectGroup,
    item: SceneItem,
    targetIds: readonly ItemId[],
  ) => {
    const unique = [...new Set(targetIds)];
    const others = unique.filter((id) => id !== parent.object.id);
    parent.children.push({
      item,
      targetCount: unique.length,
      otherTargetNames: others.slice(0, 3).map((id) => {
        const t = itemsMap.get(id);
        return t ? itemClipDisplayName(t) : '(missing)';
      }),
      hasMissingTarget: unique.some((id) => !itemsMap.has(id)),
    });
  };

  /** Visible object-header targets for a clip, excluding self-references. */
  const visibleObjectTargets = (item: SceneItem): ItemId[] => {
    const out: ItemId[] = [];
    for (const id of new Set(relatedObjectIds(item))) {
      if (id === item.id) continue;
      const t = visibleById.get(id);
      if (t && itemPanelRole(t) === 'object') out.push(id);
    }
    return out;
  };

  for (const it of visibleItems) {
    const role = itemPanelRole(it);
    if (role === 'object') {
      // Surrounding rects are headers too (exits can target them), and also
      // nest under each object they surround.
      if (it.kind === 'surroundingRect') {
        for (const id of visibleObjectTargets(it)) {
          pushChild(groupIndex.get(id)!, it, it.targetIds);
        }
      }
      continue;
    }
    if (role === 'global') {
      unassigned.push(it);
      continue;
    }
    const targets = visibleObjectTargets(it);
    if (targets.length === 0) {
      unassigned.push(it);
      continue;
    }
    for (const id of targets) {
      pushChild(groupIndex.get(id)!, it, relatedObjectIds(it));
    }
  }

  for (const g of groups) {
    g.children.sort((a, b) => compareRowTime(a.item, b.item));
  }
  unassigned.sort(compareRowTime);
  return { groups, unassigned };
}
