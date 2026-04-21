import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type {
  FunctionLineStyle,
  FunctionSeriesPerN,
  GraphFunctionSeriesItem,
} from '@/types/scene';
import {
  functionSeriesIndices,
  resolveFunctionSeriesN,
} from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import FloatingPanel from '@/components/FloatingPanel';

interface Props {
  item: GraphFunctionSeriesItem;
  focusedN: number | null;
  onClose: () => void;
}

const LINE_STYLES: FunctionLineStyle[] = ['solid', 'dashed', 'dotted'];

export default function FunctionSeriesIndividualPanel({
  item,
  focusedN,
  onClose,
}: Props) {
  const updateItem = useSceneStore((s) => s.updateItem);

  const indices = useMemo(() => functionSeriesIndices(item), [item]);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (focusedN == null) return;
    const el = rowRefs.current.get(focusedN);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('ring-1', 'ring-blue-400');
      const t = setTimeout(() => {
        el.classList.remove('ring-1', 'ring-blue-400');
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [focusedN]);

  const patchPerN = useCallback(
    (n: number, patch: Partial<FunctionSeriesPerN>) => {
      const key = String(n);
      const existing = item.perN[key] ?? {};
      const next = { ...existing, ...patch };
      const cleaned: FunctionSeriesPerN = {};
      if (next.color !== undefined) cleaned.color = next.color;
      if (next.strokeWidth !== undefined)
        cleaned.strokeWidth = next.strokeWidth;
      if (next.lineStyle !== undefined) cleaned.lineStyle = next.lineStyle;
      if (next.animDuration !== undefined)
        cleaned.animDuration = next.animDuration;
      if (next.waitAfter !== undefined) cleaned.waitAfter = next.waitAfter;
      updateItem(item.id, {
        perN: { ...item.perN, [key]: cleaned },
      });
    },
    [item.id, item.perN, updateItem],
  );

  const clearOverride = useCallback(
    (n: number, field: keyof FunctionSeriesPerN) => {
      const key = String(n);
      const existing = item.perN[key] ?? {};
      if (!(field in existing)) return;
      const next: FunctionSeriesPerN = { ...existing };
      delete next[field];
      updateItem(item.id, {
        perN: { ...item.perN, [key]: next },
      });
    },
    [item.id, item.perN, updateItem],
  );

  const resetRow = useCallback(
    (n: number) => {
      const key = String(n);
      if (!item.perN[key]) return;
      const next = { ...item.perN };
      delete next[key];
      updateItem(item.id, { perN: next });
    },
    [item.id, item.perN, updateItem],
  );

  return (
    <FloatingPanel
      title={`Individual curves (n = ${item.nMin}…${item.nMax})`}
      onClose={onClose}
      defaultSize={{ w: 440, h: 520 }}
    >
      <div className="flex flex-col gap-2 text-xs">
        {indices.length === 0 && (
          <p className="text-slate-500 italic">
            No curves in range. Set n_min &lt; n_max to populate.
          </p>
        )}
        {indices.map((n) => {
          const key = String(n);
          const resolved = resolveFunctionSeriesN(item, n);
          const override = item.perN[key] ?? {};
          const error = item.perNErrors?.[key];
          const isLast = n === indices[indices.length - 1];
          return (
            <div
              key={n}
              ref={(el) => {
                if (el) rowRefs.current.set(n, el);
                else rowRefs.current.delete(n);
              }}
              className={`rounded border px-2 py-2 space-y-2 ${
                error
                  ? 'border-red-700 bg-red-900/20'
                  : 'border-slate-600 bg-slate-800/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">n = {n}</span>
                <button
                  type="button"
                  onClick={() => resetRow(n)}
                  className="text-[10px] text-slate-400 hover:text-slate-100"
                  title="Clear all per-n overrides for this index"
                  disabled={Object.keys(override).length === 0}
                >
                  reset
                </button>
              </div>
              <div className="flex items-end gap-3 flex-wrap">
                <ColorPicker
                  value={resolved.color}
                  onChange={(c) => patchPerN(n, { color: c })}
                />
                {override.color !== undefined && (
                  <button
                    type="button"
                    onClick={() => clearOverride(n, 'color')}
                    className="text-[10px] text-slate-400 hover:text-slate-100"
                    title="Revert to default color"
                  >
                    ↺
                  </button>
                )}
                <NumberInput
                  label="Stroke"
                  value={resolved.strokeWidth}
                  onChange={(v) =>
                    patchPerN(n, { strokeWidth: Math.max(0, v) })
                  }
                  min={0}
                  step={0.25}
                />
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <span>Style</span>
                  <select
                    value={resolved.lineStyle}
                    onChange={(e) =>
                      patchPerN(n, {
                        lineStyle: e.target.value as FunctionLineStyle,
                      })
                    }
                    className="bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-200"
                  >
                    {LINE_STYLES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex items-end gap-3 flex-wrap">
                <NumberInput
                  label="Anim (s)"
                  value={resolved.animDuration}
                  onChange={(v) =>
                    patchPerN(n, { animDuration: Math.max(0.01, v) })
                  }
                  min={0.01}
                  step={0.1}
                />
                <NumberInput
                  label={isLast ? 'Wait (last, unused)' : 'Wait before next (s)'}
                  value={resolved.waitAfter}
                  onChange={(v) =>
                    patchPerN(n, { waitAfter: Math.max(0, v) })
                  }
                  min={0}
                  step={0.1}
                />
              </div>
              {error && (
                <div className="text-[11px] text-red-300" role="alert">
                  Error: {error}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </FloatingPanel>
  );
}
