import { useMemo, useState, type ReactNode } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { ItemId, SceneItem } from '@/types/scene';
import { isTopLevelItem } from '@/lib/time';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { isMultiSelectModifier } from '@/lib/uiModifiers';
import { associatedFrameId, frameDisplayName, readingOrderFrames } from '@/lib/frameGrid';
import { cx } from '@/lib/cx';
import {
  CloseIcon,
  DuplicateIcon,
  IconButton,
  KindSwatch,
  PanelTitle,
  SectionLabel,
  Segmented,
  Select,
  focusRing,
} from '@/components/ui';
import {
  buildObjectPanelModel,
  nestedChildTitle,
  relatedCountLabel,
  type RelatedChildRef,
} from '@/lib/itemRelationships';

type ItemListView = 'timeline' | 'object';

export default function ItemList() {
  const itemsMap = useSceneStore((s) => s.items);
  const selectedIds = useSceneStore((s) => s.selectedIds);
  const select = useSceneStore((s) => s.select);
  const removeItem = useSceneStore((s) => s.removeItem);
  const duplicateItem = useSceneStore((s) => s.duplicateItem);
  const frames = useSceneStore((s) => s.frames);
  const startFrameId = useSceneStore((s) => s.startFrameId);

  const [filterFrameId, setFilterFrameId] = useState<ItemId | 'all'>('all');
  const [viewMode, setViewMode] = useState<ItemListView>('timeline');
  // A deleted frame falls back to showing everything.
  const effectiveFilter =
    filterFrameId !== 'all' && !frames.some((f) => f.id === filterFrameId)
      ? 'all'
      : filterFrameId;

  const items = useMemo(
    () =>
      Array.from(itemsMap.values())
        .filter(isTopLevelItem)
        .sort((a: SceneItem, b: SceneItem) => a.startTime - b.startTime || a.layer - b.layer),
    [itemsMap],
  );

  const visibleItems = useMemo(
    () =>
      effectiveFilter === 'all'
        ? items
        : items.filter(
            (it) => associatedFrameId(it, itemsMap, startFrameId) === effectiveFilter,
          ),
    [items, itemsMap, startFrameId, effectiveFilter],
  );

  const panelModel = useMemo(
    () => buildObjectPanelModel(visibleItems, itemsMap),
    [visibleItems, itemsMap],
  );

  const renderChildTitle = (child: RelatedChildRef, parentId: ItemId): ReactNode => {
    const title = nestedChildTitle(child.item, parentId);
    const extraCount = child.targetCount > 1 ? child.targetCount - 1 : 0;
    const tipParts = [...child.otherTargetNames];
    if (child.hasMissingTarget) tipParts.push('A referenced target is missing.');
    const tip = tipParts.length > 0 ? tipParts.join(', ') : undefined;
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{title}</span>
        {extraCount > 0 ? (
          <span
            className={cx(
              'shrink-0 rounded-ctl bg-ink px-1 text-meta tabular-nums',
              child.hasMissingTarget ? 'text-warn' : 'text-chalk-dim',
            )}
            title={tip}
          >
            +{extraCount}
          </span>
        ) : null}
      </span>
    );
  };

  const renderRow = (
    item: SceneItem,
    opts?: { compact?: boolean; title?: ReactNode; trailing?: ReactNode },
  ) => {
    const isSelected = selectedIds.has(item.id);
    const exitTargets =
      item.kind === 'exit_animation'
        ? item.targets
            .map((row) => itemsMap.get(row.targetId))
            .filter((x): x is SceneItem => !!x)
        : [];
    const blinkTargets =
      item.kind === 'blink_animation'
        ? item.targets
            .map((row) => itemsMap.get(row.targetId))
            .filter((x): x is SceneItem => !!x)
        : [];
    const taTargets =
      item.kind === 'target_animation'
        ? item.targets
            .map((row) => itemsMap.get(row.targetId))
            .filter((x): x is SceneItem => !!x)
        : [];
    const surroundTargets =
      item.kind === 'surroundingRect'
        ? item.targetIds
            .map((id) => itemsMap.get(id))
            .filter((x): x is SceneItem => !!x)
        : [];
    const label =
      item.kind === 'exit_animation'
        ? (() => {
            if (exitTargets.length === 0) return 'Exit (no targets)';
            const names = exitTargets.map((t) => itemClipDisplayName(t));
            const joined =
              names.length <= 2
                ? names.join(', ')
                : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
            return `Exit → ${joined}`;
          })()
        : item.kind === 'blink_animation'
          ? (() => {
              if (blinkTargets.length === 0) return 'Blink (no targets)';
              const names = blinkTargets.map((t) => itemClipDisplayName(t));
              const joined =
                names.length <= 2
                  ? names.join(', ')
                  : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
              return `Blink → ${joined}`;
            })()
          : item.kind === 'target_animation'
            ? (() => {
                if (taTargets.length === 0)
                  return `Target anim (${item.mode}, no targets)`;
                const names = taTargets.map((t) => itemClipDisplayName(t));
                const joined =
                  names.length <= 2
                    ? names.join(', ')
                    : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
                return `${item.mode} → ${joined}`;
              })()
            : item.kind === 'surroundingRect'
            ? (() => {
                if (surroundTargets.length === 0) return 'Rect (no targets)';
                const names = surroundTargets.map((t) => itemClipDisplayName(t));
                const joined =
                  names.length <= 2
                    ? names.join(', ')
                    : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
                return `Rect → ${joined}`;
              })()
            : itemClipDisplayName(item);
    // Axes-attachment chip (option 1): every graph overlay row names the
    // axes it is anchored to via its existing `axesId`. Missing/stale ids
    // render a warning chip instead of crashing.
    const axesChip = (() => {
      switch (item.kind) {
        case 'graphPlot':
        case 'graphCurve':
        case 'graphDot':
        case 'graphField':
        case 'graphFunctionSeries':
        case 'graphPointSequence':
        case 'graphArea':
          break;
        default:
          return null;
      }
      const ax = itemsMap.get(item.axesId);
      if (!ax || ax.kind !== 'axes') {
        return (
          <span
            className="shrink-0 text-meta text-warn"
            title={`Referenced axes "${item.axesId}" is missing. Pick other axes in the graph editor.`}
          >
            No axes
          </span>
        );
      }
      const axesName = itemClipDisplayName(ax);
      return (
        <button
          type="button"
          onClick={() => select(ax.id)}
          className={cx(
            'flex max-w-24 shrink-0 items-center gap-1 rounded-ctl px-1 text-meta text-chalk-faint transition-colors hover:text-chalk',
            focusRing,
          )}
          title={`Attached to axes: ${axesName} (${ax.id}). Click to select the axes.`}
        >
          <KindSwatch kind="axes" size="sm" />
          <span className="truncate" dir="auto">{axesName}</span>
        </button>
      );
    })();

    const timeLabel = `${item.startTime.toFixed(1)} s`;

    return (
      <div
        key={item.id}
        className={cx(
          'group flex items-center gap-1 rounded-[4px] pr-1 transition-colors',
          isSelected ? 'bg-raised ring-1 ring-highlight/45 ring-inset' : 'hover:bg-raised',
        )}
      >
        <button
          type="button"
          aria-pressed={isSelected}
          onClick={(e) => select(item.id, isMultiSelectModifier(e))}
          className={cx(
            'flex min-w-0 flex-1 items-center gap-2.5 rounded-[4px] pl-2 text-left text-body',
            opts?.compact ? 'py-1' : 'py-1.5',
            focusRing,
          )}
        >
          <KindSwatch kind={item.kind} />
          <span className="min-w-0 flex-1 truncate text-chalk" dir="auto">
            {opts?.title ?? label}
          </span>
        </button>
        {axesChip}
        {opts?.trailing}
        <span className="shrink-0 pr-1 text-meta text-chalk-faint tabular-nums">{timeLabel}</span>
        {/* Row actions take space only while the row is hovered, focused or selected. */}
        <span
          className={cx(
            'shrink-0 items-center group-focus-within:flex group-hover:flex',
            isSelected ? 'flex' : 'hidden',
          )}
        >
          <IconButton size="sm" label="Duplicate item" onClick={() => duplicateItem(item.id)}>
            <DuplicateIcon />
          </IconButton>
          <IconButton size="sm" danger label="Delete item" onClick={() => removeItem(item.id)}>
            <CloseIcon />
          </IconButton>
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex shrink-0 items-center gap-2 pt-3 pr-3 pb-2 pl-3.5">
        <PanelTitle className="shrink-0">Items</PanelTitle>
        <Select
          size="sm"
          className="ml-auto min-w-0 max-w-[140px]"
          value={effectiveFilter}
          onChange={(e) => setFilterFrameId(e.target.value as ItemId | 'all')}
          aria-label="Show items from frame"
        >
          <option value="all">All frames</option>
          {readingOrderFrames(frames).map((f) => (
            <option key={f.id} value={f.id}>
              {frameDisplayName(f, frames)}
            </option>
          ))}
        </Select>
      </div>

      <Segmented
        className="mx-3 mb-2 shrink-0"
        aria-label="Item list order"
        options={[
          { value: 'timeline', label: 'By time' },
          { value: 'object', label: 'By object' },
        ]}
        value={viewMode}
        onChange={setViewMode}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1.5 pb-3">
        {items.length === 0 ? (
          <p className="m-0 px-3 py-6 text-center text-ctl text-chalk-faint">
            No items yet. Add text, axes or audio from the Insert toolbar.
          </p>
        ) : visibleItems.length === 0 ? (
          <p className="m-0 px-3 py-6 text-center text-ctl text-chalk-faint">
            Nothing in this frame. Choose All frames to see every item.
          </p>
        ) : null}

        {viewMode === 'timeline' ? (
          <div className="flex flex-col gap-px">
            {visibleItems.map((item) => (
              <div key={item.id}>{renderRow(item)}</div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {panelModel.groups.map((group) => (
              <div key={group.object.id} className="rounded-pop border border-rule p-0.5">
                {renderRow(
                  group.object,
                  group.children.length > 0
                    ? {
                        trailing: (
                          <span className="shrink-0 text-meta text-chalk-faint">
                            {relatedCountLabel(group.children.length)}
                          </span>
                        ),
                      }
                    : undefined,
                )}
                {group.children.length > 0 ? (
                  <div className="ml-3 flex flex-col gap-px border-l border-rule pt-0.5 pl-1">
                    {group.children.map((child) => (
                      <div key={`${group.object.id}-${child.item.id}`}>
                        {renderRow(child.item, {
                          compact: true,
                          title: renderChildTitle(child, group.object.id),
                        })}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {panelModel.unassigned.length > 0 ? (
              <div className="flex flex-col gap-px">
                <SectionLabel className="px-2 pt-1 pb-0.5">Not attached to an object</SectionLabel>
                {panelModel.unassigned.map((item) => (
                  <div key={item.id}>{renderRow(item)}</div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
