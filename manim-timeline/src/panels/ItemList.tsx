import { useMemo, useState, useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import {
  createTextLine,
  createAxes,
  createGraphPlot,
  createGraphDotItem,
  createGraphFieldItem,
  createGraphSeriesViz,
  createCompound,
  createExitAnimation,
} from '@/store/factories';
import type { ItemId, SceneItem } from '@/types/scene';
import { canBeExitTarget, holdEnd, isTopLevelItem } from '@/lib/time';
import { itemClipDisplayName } from '@/lib/itemDisplayName';

function pickDefaultAxesId(
  itemsMap: Map<ItemId, SceneItem>,
  selectedIds: Set<ItemId>,
): string | null {
  for (const id of selectedIds) {
    const it = itemsMap.get(id);
    if (it?.kind === 'axes') return id;
  }
  const axes = [...itemsMap.values()].filter((i) => i.kind === 'axes');
  if (axes.length === 0) return null;
  if (axes.length === 1) return axes[0]!.id;
  return [...axes].sort((a, b) => a.startTime - b.startTime)[0]!.id;
}

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
  const [objectMenuOpen, setObjectMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);

  const closeMenus = useCallback(() => {
    setObjectMenuOpen(false);
    setAudioMenuOpen(false);
  }, []);

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

  const ensureAxesId = (): string => {
    let axId = pickDefaultAxesId(itemsMap, selectedIds);
    if (!axId) {
      const ax = createAxes(defaults, currentTime);
      addItem(ax);
      axId = ax.id;
    }
    return axId;
  };

  const addAxes = () => {
    const item = createAxes(defaults, currentTime);
    addItem(item);
    select(item.id);
  };

  const addGraphPlot = () => {
    const axId = ensureAxesId();
    const item = createGraphPlot(axId, currentTime);
    addItem(item);
    select(item.id);
  };

  const addGraphDot = () => {
    const axId = ensureAxesId();
    const item = createGraphDotItem(axId, currentTime);
    addItem(item);
    select(item.id);
  };

  const addGraphField = () => {
    const axId = ensureAxesId();
    const item = createGraphFieldItem(axId, currentTime);
    addItem(item);
    select(item.id);
  };

  const addGraphSeriesViz = () => {
    const axId = ensureAxesId();
    const item = createGraphSeriesViz(axId, currentTime);
    addItem(item);
    select(item.id);
  };

  const addCompound = () => {
    const item = createCompound(currentTime);
    addItem(item);
    select(item.id);
    setExpandedCompounds((s) => new Set(s).add(item.id));
  };

  const addExitAnimationClip = () => {
    const map = useSceneStore.getState().items;
    let targetId: ItemId | null = null;
    for (const id of selectedIds) {
      const it = map.get(id);
      if (it && canBeExitTarget(it)) {
        targetId = id;
        break;
      }
    }
    if (!targetId) {
      const candidates = [...map.values()].filter(canBeExitTarget);
      if (candidates.length === 0) return;
      candidates.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
      targetId = candidates[0]!.id;
    }
    const t = map.get(targetId);
    if (!t || !canBeExitTarget(t)) return;
    const he = holdEnd(t, map);
    const start = Math.max(currentTime, he);
    const toRemove = [...map.entries()]
      .filter(([, it]) => it.kind === 'exit_animation' && it.targetId === targetId)
      .map(([id]) => id);
    for (const id of toRemove) {
      removeItem(id);
    }
    const ex = createExitAnimation(targetId, start, 1);
    addItem(ex);
    select(ex.id);
  };

  const renderRow = (
    item: SceneItem,
    opts: { depth?: number; isChild?: boolean } = {},
  ) => {
    const depth = opts.depth ?? 0;
    const isChild = opts.isChild ?? false;
    const isSelected = selectedIds.has(item.id);
    const exitTarget =
      item.kind === 'exit_animation' ? itemsMap.get(item.targetId) : undefined;
    const label =
      item.kind === 'exit_animation'
        ? `Exit → ${
            exitTarget
              ? itemClipDisplayName(exitTarget)
              : `(missing ${item.targetId.slice(0, 8)}…)`
          }`
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
    } else if (item.kind === 'graphDot') {
      kindBadge = 'bg-cyan-600/30 text-cyan-300';
      kindLetter = 'D';
    } else if (item.kind === 'graphField') {
      kindBadge = 'bg-lime-600/30 text-lime-300';
      kindLetter = 'F';
    } else if (item.kind === 'graphSeriesViz') {
      kindBadge = 'bg-amber-600/30 text-amber-300';
      kindLetter = 'S';
    } else if (item.kind === 'compound') {
      kindBadge = 'bg-violet-600/30 text-violet-300';
      kindLetter = 'C';
    } else if (item.kind === 'exit_animation') {
      kindBadge = 'bg-rose-600/30 text-rose-300';
      kindLetter = 'X';
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
    <div className="flex flex-col h-full">
      {(objectMenuOpen || audioMenuOpen) && (
        <div
          className="fixed inset-0 z-40"
          aria-hidden
          onClick={closeMenus}
        />
      )}

      <div className="flex items-center gap-1 flex-wrap p-3 shrink-0 relative z-50">
        <h3 className="text-sm font-semibold text-slate-200 flex-1 min-w-[80px]">Items</h3>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setAudioMenuOpen(false);
              setObjectMenuOpen((o) => !o);
            }}
            className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-100 rounded transition-colors"
          >
            + Object
          </button>
          {objectMenuOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-600 rounded shadow-lg flex flex-col min-w-[140px]"
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                className="px-3 py-2 text-xs text-left hover:bg-slate-700 text-slate-200 transition-colors"
                onClick={() => {
                  addTextLine();
                  closeMenus();
                }}
              >
                Text Line
              </button>
              <button
                type="button"
                role="menuitem"
                className="px-3 py-2 text-xs text-left hover:bg-slate-700 text-slate-200 transition-colors"
                onClick={() => {
                  addAxes();
                  closeMenus();
                }}
              >
                Axes
              </button>
              <button
                type="button"
                role="menuitem"
                className="px-3 py-2 text-xs text-left hover:bg-slate-700 text-slate-200 transition-colors"
                onClick={() => {
                  addGraphPlot();
                  closeMenus();
                }}
              >
                Graph plot
              </button>
              <button
                type="button"
                role="menuitem"
                className="px-3 py-2 text-xs text-left hover:bg-slate-700 text-slate-200 transition-colors"
                onClick={() => {
                  addGraphDot();
                  closeMenus();
                }}
              >
                Graph dot
              </button>
              <button
                type="button"
                role="menuitem"
                className="px-3 py-2 text-xs text-left hover:bg-slate-700 text-slate-200 transition-colors"
                onClick={() => {
                  addGraphField();
                  closeMenus();
                }}
              >
                Vector / slope field
              </button>
              <button
                type="button"
                role="menuitem"
                className="px-3 py-2 text-xs text-left hover:bg-slate-700 text-slate-200 transition-colors"
                title="Animated n — sequence, partial sums, or partial function plots"
                onClick={() => {
                  addGraphSeriesViz();
                  closeMenus();
                }}
              >
                Series / sequence viz
              </button>
              <button
                type="button"
                role="menuitem"
                className="px-3 py-2 text-xs text-left hover:bg-slate-700 text-slate-200 transition-colors"
                title="Compound clip — group text lines on one timeline row"
                onClick={() => {
                  addCompound();
                  closeMenus();
                }}
              >
                Compound Clip
              </button>
              <button
                type="button"
                role="menuitem"
                className="px-3 py-2 text-xs text-left hover:bg-slate-700 text-slate-200 transition-colors"
                title="Separate timeline clip that removes a target object (replaces any prior exit for that target)"
                onClick={() => {
                  addExitAnimationClip();
                  closeMenus();
                }}
              >
                Exit animation
              </button>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setObjectMenuOpen(false);
              setAudioMenuOpen((o) => !o);
            }}
            className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-100 rounded transition-colors"
          >
            + Audio
          </button>
          {audioMenuOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-600 rounded shadow-lg flex flex-col min-w-[120px]"
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                className="px-3 py-2 text-xs text-left hover:bg-slate-700 text-slate-200 transition-colors"
                onClick={() => {
                  useSceneStore.getState().setAudioMode('record');
                  closeMenus();
                }}
              >
                Recording
              </button>
              <button
                type="button"
                role="menuitem"
                className="px-3 py-2 text-xs text-left hover:bg-slate-700 text-slate-200 transition-colors"
                onClick={() => {
                  useSceneStore.getState().setAudioMode('upload');
                  closeMenus();
                }}
              >
                Upload recording
              </button>
              <button
                type="button"
                role="menuitem"
                className="px-3 py-2 text-xs text-left hover:bg-slate-700 text-slate-200 transition-colors"
                onClick={() => {
                  useSceneStore.getState().setAudioMode('tts');
                  closeMenus();
                }}
              >
                Text-to-Speech
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-0">
        {items.length === 0 && (
          <p className="text-xs text-slate-500 italic py-4 text-center">
            No items yet. Add text, axes, graph overlays, or a compound clip.
          </p>
        )}

        <div className="flex flex-col gap-0.5">
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
    </div>
  );
}
