import { useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { createGraphStreamPoint } from '@/store/factories';
import type { GraphFieldItem, GraphFieldMode, GraphFieldColormap } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import AxesIdSelect from './AxesIdSelect';
import {
  GRAPH_FIELD_SECTION_HELP,
  GRAPH_FIELD_JS_HELP,
  GRAPH_FIELD_PY_HELP,
  GraphFieldHelpIcon,
  GraphFieldPresetRow,
  SLOPE_FIELD_PRESETS,
  VECTOR_FIELD_PRESETS,
} from './GraphFieldExpressionHelp';

interface GraphFieldEditorProps {
  item: GraphFieldItem;
}

export default function GraphFieldEditor({ item }: GraphFieldEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);

  const set = useCallback(
    (patch: Partial<GraphFieldItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const updateStream = (index: number, patch: Partial<{ x: number; y: number }>) => {
    const pts = (item.streamPoints ?? []).map((p, i) =>
      i === index ? { ...p, ...patch } : p,
    );
    set({ streamPoints: pts });
  };
  const addStream = () =>
    set({ streamPoints: [...(item.streamPoints ?? []), createGraphStreamPoint()] });
  const removeStream = (index: number) =>
    set({ streamPoints: (item.streamPoints ?? []).filter((_, i) => i !== index) });

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Vector / slope field</h3>
      <label className="text-xs text-slate-400 block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Gradient field — optional; shown in exit target menu"
          className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>
      <AxesIdSelect value={item.axesId} onChange={(axesId) => set({ axesId })} />

      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput label="Start (s)" value={item.startTime} onChange={(v) => set({ startTime: v })} min={0} />
        <NumberInput label="Duration" value={item.duration} onChange={(v) => set({ duration: v })} min={0.01} />
        <NumberInput label="Layer" value={item.layer} onChange={(v) => set({ layer: Math.round(v) })} min={0} step={1} />
      </div>

      <details open>
        <summary className="text-xs text-slate-400 cursor-pointer select-none flex items-center gap-1.5">
          <span>Field expressions</span>
          <GraphFieldHelpIcon
            title={GRAPH_FIELD_SECTION_HELP}
            label="Help: two expression boxes (preview vs export)"
          />
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[11px] leading-snug text-slate-500">
            JavaScript drives the canvas preview; Python (NumPy) drives export.
          </p>
          <label className="text-xs text-slate-400">
            Mode
            <select
              value={item.fieldMode ?? 'vector'}
              onChange={(e) =>
                set({ fieldMode: e.target.value as GraphFieldMode })
              }
              className="ml-2 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
            >
              <option value="none">None</option>
              <option value="vector">Vector field F = ⟨P, Q⟩</option>
              <option value="slope">Slope field dy/dx = f(x,y)</option>
            </select>
          </label>

          {item.fieldMode === 'vector' && (
            <>
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <span>P(x, y) — preview (JavaScript)</span>
                <GraphFieldHelpIcon title={GRAPH_FIELD_JS_HELP} label="Help: JavaScript P" />
              </div>
              <input
                type="text"
                value={item.jsExprP ?? '1'}
                onChange={(e) => set({ jsExprP: e.target.value })}
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
              />
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <span>P(x, y) — export (Python)</span>
                <GraphFieldHelpIcon title={GRAPH_FIELD_PY_HELP} label="Help: Python P" />
              </div>
              <input
                type="text"
                value={item.pyExprP ?? '1'}
                onChange={(e) => set({ pyExprP: e.target.value })}
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
              />
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <span>Q(x, y) — preview (JavaScript)</span>
                <GraphFieldHelpIcon title={GRAPH_FIELD_JS_HELP} label="Help: JavaScript Q" />
              </div>
              <input
                type="text"
                value={item.jsExprQ ?? '0'}
                onChange={(e) => set({ jsExprQ: e.target.value })}
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
              />
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <span>Q(x, y) — export (Python)</span>
                <GraphFieldHelpIcon title={GRAPH_FIELD_PY_HELP} label="Help: Python Q" />
              </div>
              <input
                type="text"
                value={item.pyExprQ ?? '0'}
                onChange={(e) => set({ pyExprQ: e.target.value })}
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
              />
              <GraphFieldPresetRow
                hint="Insert both P and Q (JS + Python) for a common field:"
                presets={VECTOR_FIELD_PRESETS}
                onPick={(i) => {
                  const p = VECTOR_FIELD_PRESETS[i]!;
                  set({
                    jsExprP: p.jsP,
                    pyExprP: p.pyP,
                    jsExprQ: p.jsQ,
                    pyExprQ: p.pyQ,
                  });
                }}
              />
            </>
          )}

          {item.fieldMode === 'slope' && (
            <>
              <NumberInput
                label="Arrow length L"
                value={item.slopeArrowLength ?? 0.5}
                onChange={(v) => set({ slopeArrowLength: v })}
                min={0.05}
                step={0.05}
              />
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <span>f(x, y) = dy/dx — preview (JavaScript)</span>
                <GraphFieldHelpIcon title={GRAPH_FIELD_JS_HELP} label="Help: JavaScript slope" />
              </div>
              <input
                type="text"
                value={item.jsExprSlope ?? '0'}
                onChange={(e) => set({ jsExprSlope: e.target.value })}
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
              />
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <span>f(x, y) = dy/dx — export (Python)</span>
                <GraphFieldHelpIcon title={GRAPH_FIELD_PY_HELP} label="Help: Python slope" />
              </div>
              <input
                type="text"
                value={item.pyExprSlope ?? '0'}
                onChange={(e) => set({ pyExprSlope: e.target.value })}
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
              />
              <GraphFieldPresetRow
                hint="Insert the same formula in both boxes (JS + NumPy):"
                presets={SLOPE_FIELD_PRESETS}
                onPick={(i) => {
                  const p = SLOPE_FIELD_PRESETS[i]!;
                  set({ jsExprSlope: p.js, pyExprSlope: p.py });
                }}
              />
            </>
          )}

          {item.fieldMode !== 'none' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <NumberInput
                  label="Grid step"
                  value={item.fieldGridStep ?? 0.5}
                  onChange={(v) => set({ fieldGridStep: Math.max(0.05, v) })}
                  min={0.05}
                  step={0.05}
                />
                <label className="text-xs text-slate-400">
                  Colormap
                  <select
                    value={item.fieldColormap ?? 'viridis'}
                    onChange={(e) =>
                      set({ fieldColormap: e.target.value as GraphFieldColormap })
                    }
                    className="ml-1 w-full bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-slate-200"
                  >
                    <option value="viridis">Viridis</option>
                    <option value="plasma">Plasma</option>
                    <option value="inferno">Inferno</option>
                    <option value="magma">Magma</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberInput
                  label="Color min"
                  value={item.colorSchemeMin ?? 0}
                  onChange={(v) => set({ colorSchemeMin: v })}
                />
                <NumberInput
                  label="Color max"
                  value={item.colorSchemeMax ?? 2}
                  onChange={(v) => set({ colorSchemeMax: v })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberInput
                  label="Stream dt"
                  value={item.streamDt ?? 0.05}
                  onChange={(v) => set({ streamDt: Math.max(0.01, v) })}
                  min={0.01}
                  step={0.01}
                />
                <NumberInput
                  label="Stream time"
                  value={item.streamVirtualTime ?? 3}
                  onChange={(v) => set({ streamVirtualTime: Math.max(0.1, v) })}
                  min={0.1}
                  step={0.1}
                />
              </div>
            </>
          )}

          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={item.streamPlacementActive ?? false}
              onChange={(e) => set({ streamPlacementActive: e.target.checked })}
              className="accent-blue-500"
            />
            Click canvas to add streamline seed (when this clip is selected)
          </label>

          <div className="text-xs text-slate-500">
            Seeds: {(item.streamPoints ?? []).length}
          </div>
          {(item.streamPoints ?? []).map((sp, i) => (
            <div
              key={sp.id}
              className="flex flex-wrap items-center gap-2 p-2 bg-slate-800/50 border border-slate-700 rounded"
            >
              <NumberInput label="x0" value={sp.x} onChange={(v) => updateStream(i, { x: v })} />
              <NumberInput label="y0" value={sp.y} onChange={(v) => updateStream(i, { y: v })} />
              <button
                type="button"
                onClick={() => removeStream(i)}
                className="text-red-400 hover:text-red-300 text-xs ml-auto"
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={addStream} className="text-xs text-blue-400 hover:text-blue-300 text-left">
            + Add streamline seed
          </button>
        </div>
      </details>

    </div>
  );
}
