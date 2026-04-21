import { useMemo, useState, useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import {
  createTextLine,
  createAxes,
  createGraphPlot,
  createGraphDotItem,
  createGraphFieldItem,
  createGraphFunctionSeries,
  createGraphArea,
  createExitAnimation,
  createSurroundingRect,
  createShape,
} from '@/store/factories';
import type { ItemId, SceneItem } from '@/types/scene';
import {
  canBeExitTarget,
  canBeSurroundTarget,
  holdEnd,
  isTopLevelItem,
  effectiveStart,
} from '@/lib/time';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { isMultiSelectModifier } from '@/lib/uiModifiers';
import {
  expandFragmentSelection,
  buildProjectFragmentFile,
} from '@/lib/projectFragment';
import {
  downloadProjectFragmentFile,
  downloadMtprojFragmentBundle,
  MtprojPackError,
} from '@/lib/projectIO';

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

  const [objectMenuOpen, setObjectMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const [fragmentCompact, setFragmentCompact] = useState(false);
  const [fragmentStripSegmentTiming, setFragmentStripSegmentTiming] =
    useState(false);

  const closeMenus = useCallback(() => {
    setObjectMenuOpen(false);
    setAudioMenuOpen(false);
  }, []);

  const buildFragmentOrAlert = useCallback(() => {
    const { items: im, audioItems, selectedIds } = useSceneStore.getState();
    const exp = expandFragmentSelection(im, audioItems, selectedIds);
    if (!exp.ok) {
      window.alert(exp.message);
      return null;
    }
    return buildProjectFragmentFile(
      exp.items,
      exp.audioItems,
      fragmentCompact,
      fragmentStripSegmentTiming,
    );
  }, [fragmentCompact, fragmentStripSegmentTiming]);

  const handleExportFragmentJson = useCallback(() => {
    const frag = buildFragmentOrAlert();
    if (frag) downloadProjectFragmentFile(frag);
  }, [buildFragmentOrAlert]);

  const handleExportFragmentMtproj = useCallback(async () => {
    const frag = buildFragmentOrAlert();
    if (!frag) return;
    try {
      await downloadMtprojFragmentBundle(frag);
    } catch (e) {
      if (e instanceof MtprojPackError) {
        const lines = e.failed
          .map((f) => `• ${f.text.slice(0, 40)}${f.text.length > 40 ? '…' : ''} — ${f.reason}`)
          .join('\n');
        window.alert(`${e.message}\n\n${lines}`);
      } else {
        window.alert(e instanceof Error ? e.message : String(e));
      }
    }
  }, [buildFragmentOrAlert]);

  const handleCopyFragmentJson = useCallback(async () => {
    const frag = buildFragmentOrAlert();
    if (!frag) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(frag, null, 2));
    } catch {
      window.alert('Could not copy to clipboard.');
    }
  }, [buildFragmentOrAlert]);

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

  const addShape = () => {
    const item = createShape(currentTime);
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

  const addGraphFunctionSeries = () => {
    const axId = ensureAxesId();
    const item = createGraphFunctionSeries(axId, currentTime);
    addItem(item);
    select(item.id);
  };

  const addGraphArea = () => {
    const axId = ensureAxesId();
    const item = createGraphArea(axId, currentTime);
    addItem(item);
    select(item.id);
  };

  const addExitAnimationClip = () => {
    const map = useSceneStore.getState().items;
    const selectedTargets = [...selectedIds]
      .map((id) => map.get(id))
      .filter((it): it is SceneItem => !!it && canBeExitTarget(it));
    const seen = new Set<ItemId>();
    const targetIds: ItemId[] = [];
    for (const it of selectedTargets) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      targetIds.push(it.id);
    }
    if (targetIds.length === 0) {
      const candidates = [...map.values()].filter(canBeExitTarget);
      if (candidates.length === 0) return;
      candidates.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
      targetIds.push(candidates[0]!.id);
    }
    const holdEnds = targetIds.map((id) => {
      const t = map.get(id);
      return t && canBeExitTarget(t) ? holdEnd(t, map) : 0;
    });
    const start = Math.max(currentTime, ...holdEnds);
    const toRemove = [...map.entries()]
      .filter(
        ([, it]) =>
          it.kind === 'exit_animation' &&
          it.targets.some((row) => targetIds.includes(row.targetId)),
      )
      .map(([id]) => id);
    for (const id of toRemove) {
      removeItem(id);
    }
    const ex = createExitAnimation(targetIds, start, 1);
    addItem(ex);
    select(ex.id);
  };

  const addSurroundingRectClip = () => {
    const map = useSceneStore.getState().items;
    const selectedTargets = [...selectedIds]
      .map((id) => map.get(id))
      .filter((it): it is SceneItem => !!it && canBeSurroundTarget(it));
    const seen = new Set<ItemId>();
    const surroundTargetIds: ItemId[] = [];
    for (const it of selectedTargets) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      surroundTargetIds.push(it.id);
    }
    if (surroundTargetIds.length === 0) {
      const candidates = [...map.values()].filter(canBeSurroundTarget);
      if (candidates.length === 0) return;
      candidates.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
      surroundTargetIds.push(candidates[0]!.id);
    }
    const starts = surroundTargetIds.map((id) => {
      const t = map.get(id);
      return t && canBeSurroundTarget(t) ? effectiveStart(t, map) : 0;
    });
    const start = Math.max(currentTime, ...starts);
    const item = createSurroundingRect(surroundTargetIds, start);
    addItem(item);
    select(item.id);
  };

  const renderRow = (item: SceneItem) => {
    const isSelected = selectedIds.has(item.id);
    const exitTargets =
      item.kind === 'exit_animation'
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
    } else if (item.kind === 'graphDot') {
      kindBadge = 'bg-cyan-600/30 text-cyan-300';
      kindLetter = 'D';
    } else if (item.kind === 'graphField') {
      kindBadge = 'bg-lime-600/30 text-lime-300';
      kindLetter = 'F';
    } else if (item.kind === 'graphFunctionSeries') {
      kindBadge = 'bg-fuchsia-600/30 text-fuchsia-300';
      kindLetter = 'Fn';
    } else if (item.kind === 'graphArea') {
      kindBadge = 'bg-violet-600/30 text-violet-200';
      kindLetter = 'G';
    } else if (item.kind === 'exit_animation') {
      kindBadge = 'bg-rose-600/30 text-rose-300';
      kindLetter = 'X';
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
        className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs transition-colors ${
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
          {label}
        </span>
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
                title="Circle, rectangle, arrow, or line"
                onClick={() => {
                  addShape();
                  closeMenus();
                }}
              >
                Shape
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
                title="Family f(n, x) or partial sums S_k(x) = Σ f(n, x) for integer n; Accumulation or Replacement playback"
                onClick={() => {
                  addGraphFunctionSeries();
                  closeMenus();
                }}
              >
                Function series
              </button>
              <button
                type="button"
                role="menuitem"
                className="px-3 py-2 text-xs text-left hover:bg-slate-700 text-slate-200 transition-colors"
                title="Filled region on axes: under/between curves, parallelogram, or disk"
                onClick={() => {
                  addGraphArea();
                  closeMenus();
                }}
              >
                Graph area
              </button>
              <button
                type="button"
                role="menuitem"
                className="px-3 py-2 text-xs text-left hover:bg-slate-700 text-slate-200 transition-colors"
                title="Exit one or more objects at once (replaces prior exits touching those targets). Shift/Ctrl/Cmd+click clips in the list or timeline to multi-select targets."
                onClick={() => {
                  addExitAnimationClip();
                  closeMenus();
                }}
              >
                Exit animation
              </button>
              <button
                type="button"
                role="menuitem"
                className="px-3 py-2 text-xs text-left hover:bg-slate-700 text-slate-200 transition-colors"
                title="SurroundingRectangle highlight; remove with Exit targeting this clip"
                onClick={() => {
                  addSurroundingRectClip();
                  closeMenus();
                }}
              >
                Surrounding rectangle
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

      {selectedIds.size > 0 && (
        <div className="px-3 pb-2 flex flex-col gap-1.5 border-b border-slate-700/80 shrink-0">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">
            Selection fragment
          </div>
          <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={fragmentCompact}
              onChange={(e) => setFragmentCompact(e.target.checked)}
              className="rounded border-slate-600 bg-slate-800"
            />
            Compact (omit measure previews)
          </label>
          <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={fragmentStripSegmentTiming}
              onChange={(e) => setFragmentStripSegmentTiming(e.target.checked)}
              className="rounded border-slate-600 bg-slate-800"
            />
            Strip segment wait/anim (waitAfterSec, animSec)
          </label>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={handleExportFragmentJson}
              className="px-2 py-1 text-[11px] bg-slate-700 hover:bg-slate-600 rounded text-slate-100"
              title="Export selection + dependencies as .json"
            >
              Export JSON
            </button>
            <button
              type="button"
              onClick={() => void handleExportFragmentMtproj()}
              className="px-2 py-1 text-[11px] bg-emerald-800/80 hover:bg-emerald-700/80 rounded text-slate-100"
              title="Portable ZIP with embedded audio for this selection"
            >
              Export .mtproj
            </button>
            <button
              type="button"
              onClick={() => void handleCopyFragmentJson()}
              className="px-2 py-1 text-[11px] bg-slate-700 hover:bg-slate-600 rounded text-slate-100"
              title="Copy fragment JSON to clipboard"
            >
              Copy JSON
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-0">
        {items.length === 0 && (
          <p className="text-xs text-slate-500 italic py-4 text-center">
            No items yet. Add text, axes, graph overlays, or shapes.
          </p>
        )}

        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <div key={item.id}>{renderRow(item)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
