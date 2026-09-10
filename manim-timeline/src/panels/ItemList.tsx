import { useMemo, useState, type ReactNode } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { ItemId, SceneItem } from '@/types/scene';
import { isTopLevelItem } from '@/lib/time';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { isMultiSelectModifier } from '@/lib/uiModifiers';
import { associatedFrameId, frameDisplayName, readingOrderFrames } from '@/lib/frameGrid';
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
            className={`shrink-0 rounded px-1 text-[9px] ${
              child.hasMissingTarget
                ? 'bg-amber-900/50 text-amber-200'
                : 'bg-slate-700/80 text-slate-300'
            }`}
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
    let kindBadge = 'bg-slate-600/30 text-slate-300';
    let kindLetter = '?';
    if (item.kind === 'textLine') {
      kindBadge = 'bg-blue-600/30 text-blue-300';
      kindLetter = 'T';
    } else if (item.kind === 'axes') {
      kindBadge = 'bg-emerald-600/30 text-emerald-300';
      kindLetter = 'A';
    } else if (item.kind === 'graphPlot') {
      kindBadge = 'bg-teal-600/30 text-teal-300';
      kindLetter = 'P';
    } else if (item.kind === 'graphCurve') {
      kindBadge = 'bg-sky-600/30 text-sky-200';
      kindLetter = 'C';
    } else if (item.kind === 'graphDot') {
      kindBadge = 'bg-cyan-600/30 text-cyan-300';
      kindLetter = 'D';
    } else if (item.kind === 'graphField') {
      kindBadge = 'bg-lime-600/30 text-lime-300';
      kindLetter = 'F';
    } else if (item.kind === 'graphFunctionSeries') {
      kindBadge = 'bg-fuchsia-600/30 text-fuchsia-300';
      kindLetter = 'Fn';
    } else if (item.kind === 'graphPointSequence') {
      kindBadge = 'bg-indigo-600/30 text-indigo-300';
      kindLetter = 'Pt';
    } else if (item.kind === 'graphArea') {
      kindBadge = 'bg-violet-600/30 text-violet-200';
      kindLetter = 'G';
    } else if (item.kind === 'exit_animation') {
      kindBadge = 'bg-rose-600/30 text-rose-300';
      kindLetter = 'X';
    } else if (item.kind === 'blink_animation') {
      kindBadge = 'bg-amber-600/30 text-amber-200';
      kindLetter = 'B';
    } else if (item.kind === 'target_animation') {
      kindBadge = 'bg-yellow-900/35 text-yellow-200';
      kindLetter = 'TA';
    } else if (item.kind === 'camera_move') {
      kindBadge = 'bg-purple-700/35 text-purple-200';
      kindLetter = 'Cam';
    } else if (item.kind === 'surroundingRect') {
      kindBadge = 'bg-orange-600/30 text-orange-200';
      kindLetter = 'R';
    } else if (item.kind === 'shape') {
      kindBadge = 'bg-pink-600/30 text-pink-200';
      kindLetter = 'S';
    }

    const timeLabel = `${item.startTime.toFixed(1)}s`;

    return (
      <div
        key={item.id}
        onClick={(e) => select(item.id, isMultiSelectModifier(e))}
        className={`flex items-center gap-2 px-2 ${opts?.compact ? 'py-1' : 'py-1.5'} rounded cursor-pointer text-xs transition-colors ${
          isSelected
            ? 'bg-blue-600/20 border border-blue-500/40'
            : 'bg-slate-800/50 border border-transparent hover:bg-slate-700/50'
        }`}
      >
        <span className="w-4 shrink-0" />

        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${kindBadge}`}>
          {kindLetter}
        </span>
        <span className="flex-1 truncate text-slate-300" dir="auto">
          {opts?.title ?? label}
        </span>
        {opts?.trailing}
        <span className="text-slate-500 font-mono text-[10px] shrink-0">{timeLabel}</span>

        <button
          onClick={(e) => {
            e.stopPropagation();
            duplicateItem(item.id);
          }}
          className="text-slate-500 hover:text-slate-300 transition-colors"
          title="Duplicate"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <rect x="4" y="4" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <rect x="2" y="2" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeItem(item.id);
          }}
          className="text-slate-500 hover:text-red-400 transition-colors"
          title="Delete"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 p-3 shrink-0 border-b border-slate-700/60">
        <h3 className="text-sm font-semibold text-slate-200 shrink-0">Items</h3>
        <select
          value={effectiveFilter}
          onChange={(e) =>
            setFilterFrameId(e.target.value as ItemId | 'all')
          }
          title="Filter items by frame"
          className="ml-auto min-w-0 max-w-[140px] bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-300"
        >
          <option value="all">All frames</option>
          {readingOrderFrames(frames).map((f) => (
            <option key={f.id} value={f.id}>
              {frameDisplayName(f, frames)}
            </option>
          ))}
        </select>
      </div>

      <div
        className="flex shrink-0 gap-1 border-b border-slate-700/60 px-3 pb-2"
        role="tablist"
        aria-label="Items view"
      >
        {(
          [
            { id: 'timeline', label: 'Timeline' },
            { id: 'object', label: 'By object' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={viewMode === tab.id}
            onClick={() => setViewMode(tab.id)}
            className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              viewMode === tab.id
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-0">
        {items.length === 0 ? (
          <p className="text-xs text-slate-500 italic py-4 text-center">
            No items yet. Use the toolbar beside the list to add objects or audio.
          </p>
        ) : visibleItems.length === 0 ? (
          <p className="text-xs text-slate-500 italic py-4 text-center">
            No items in this frame.
          </p>
        ) : null}

        {viewMode === 'timeline' ? (
          <div className="flex flex-col gap-0.5">
            {visibleItems.map((item) => (
              <div key={item.id}>{renderRow(item)}</div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {panelModel.groups.map((group) => (
              <div
                key={group.object.id}
                className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-1"
              >
                {renderRow(
                  group.object,
                  group.children.length > 0
                    ? {
                        trailing: (
                          <span className="shrink-0 text-[10px] text-slate-500">
                            {relatedCountLabel(group.children.length)}
                          </span>
                        ),
                      }
                    : undefined,
                )}
                {group.children.length > 0 ? (
                  <div className="ml-4 flex flex-col gap-0.5 border-l-2 border-slate-600/60 pl-1 pt-1">
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
              <div className="flex flex-col gap-0.5">
                <div className="px-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  Unassigned
                </div>
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
