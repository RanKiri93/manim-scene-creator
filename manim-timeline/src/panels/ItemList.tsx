import { useMemo, useState, useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { createTextLine, createGraph, createCompound } from '@/store/factories';
import type { SceneItem } from '@/types/scene';
import { isTopLevelItem } from '@/lib/time';

export default function ItemList() {
  const itemsMap = useSceneStore((s) => s.items);
  const currentTime = useSceneStore((s) => s.currentTime);
  const selectedIds = useSceneStore((s) => s.selectedIds);
  const select = useSceneStore((s) => s.select);
  const removeItem = useSceneStore((s) => s.removeItem);
  const duplicateItem = useSceneStore((s) => s.duplicateItem);
  const addItem = useSceneStore((s) => s.addItem);
  const defaults = useSceneStore((s) => s.defaults);

  const [expandedCompounds, setExpandedCompounds] = useState<Set<string>>(() => new Set());

  const toggleCompound = useCallback((id: string) => {
    setExpandedCompounds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const items = useMemo(
    () =>
      Array.from(itemsMap.values())
        .filter(isTopLevelItem)
        .sort((a: SceneItem, b: SceneItem) => a.startTime - b.startTime || a.layer - b.layer),
    [itemsMap],
  );

  const addTextLine = () => {
    const item = createTextLine(defaults, currentTime);
    addItem(item);
    select(item.id);
  };

  const addGraph = () => {
    const item = createGraph(defaults, currentTime);
    addItem(item);
    select(item.id);
  };

  const addCompound = () => {
    const item = createCompound(currentTime);
    addItem(item);
    select(item.id);
    setExpandedCompounds((s) => new Set(s).add(item.id));
  };

  const renderRow = (
    item: SceneItem,
    opts: { depth?: number; isChild?: boolean } = {},
  ) => {
    const depth = opts.depth ?? 0;
    const isChild = opts.isChild ?? false;
    const isSelected = selectedIds.has(item.id);
    const label =
      item.label ||
      (item.kind === 'textLine'
        ? item.raw.slice(0, 30) || '(empty line)'
        : item.kind === 'graph'
          ? 'Graph'
          : item.kind === 'compound'
            ? 'Compound'
            : '?');
    let kindBadge = 'bg-slate-600/30 text-slate-300';
    let kindLetter = '?';
    if (item.kind === 'textLine') {
      kindBadge = 'bg-blue-600/30 text-blue-300';
      kindLetter = 'T';
    } else if (item.kind === 'graph') {
      kindBadge = 'bg-emerald-600/30 text-emerald-300';
      kindLetter = 'G';
    } else if (item.kind === 'compound') {
      kindBadge = 'bg-violet-600/30 text-violet-300';
      kindLetter = 'C';
    }

    const timeLabel =
      item.kind === 'textLine' && item.parentId
        ? `+${(item.localStart ?? 0).toFixed(1)}s`
        : `${item.startTime.toFixed(1)}s`;

    return (
      <div
        key={item.id}
        onClick={() => select(item.id)}
        style={{ paddingLeft: depth ? 12 + depth * 10 : undefined }}
        className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ${
          isSelected
            ? 'bg-blue-600/20 border border-blue-500/40'
            : 'bg-slate-800/50 border border-transparent hover:bg-slate-700/50'
        }`}
      >
        {item.kind === 'compound' && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleCompound(item.id);
            }}
            className="text-slate-400 hover:text-slate-200 w-4 text-center shrink-0"
            title={expandedCompounds.has(item.id) ? 'Collapse' : 'Expand sequence'}
          >
            {expandedCompounds.has(item.id) ? '▼' : '▶'}
          </button>
        )}
        {isChild && <span className="w-4 shrink-0 text-slate-600">↳</span>}
        {!isChild && item.kind !== 'compound' && <span className="w-4 shrink-0" />}

        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${kindBadge}`}>
          {kindLetter}
        </span>
        <span className="flex-1 truncate text-slate-300" dir="auto">
          {label}
        </span>
        <span className="text-slate-500 font-mono text-[10px] shrink-0">{timeLabel}</span>

        {isChild && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeItem(item.id);
            }}
            className="text-slate-500 hover:text-red-400 transition-colors"
            title="Remove line from sequence"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}

        {!isChild && (
          <>
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
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-200 flex-1 min-w-[80px]">Items</h3>
        <button
          onClick={addTextLine}
          className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
        >
          + Text
        </button>
        <button
          onClick={addGraph}
          className="px-2 py-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors"
        >
          + Graph
        </button>
        <button
          onClick={addCompound}
          className="px-2 py-1 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded transition-colors"
          title="Compound clip — group text lines on one timeline row"
        >
          + Compound
        </button>
      </div>

      {items.length === 0 && (
        <p className="text-xs text-slate-500 italic py-4 text-center">
          No items yet. Add text, a graph, or a compound clip.
        </p>
      )}

      <div className="flex flex-col gap-0.5 max-h-[60vh] overflow-y-auto">
        {items.map((item) => (
          <div key={item.id}>
            {renderRow(item)}
            {item.kind === 'compound' && expandedCompounds.has(item.id) && (
              <div className="flex flex-col gap-0.5 border-l border-violet-800/50 ml-3 pl-1 mt-0.5">
                {item.childIds.length === 0 && (
                  <p className="text-[10px] text-slate-500 pl-6 py-1">
                    No lines yet. Select the compound and click &quot;Add line to sequence&quot;, or use + Add line in properties.
                  </p>
                )}
                {item.childIds.map((cid) => {
                  const ch = itemsMap.get(cid);
                  if (!ch) return null;
                  return renderRow(ch, { depth: 1, isChild: true });
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
