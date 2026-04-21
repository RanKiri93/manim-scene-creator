import { useCallback, useRef } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { GraphPlotItem } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import AxesIdSelect from './AxesIdSelect';
import { GraphFieldHelpIcon } from './GraphFieldExpressionHelp';
import {
  GRAPH_PLOT_JS_HELP,
  GRAPH_PLOT_PY_HELP,
  GRAPH_PLOT_SECTION_HELP,
  GraphPlotExprAssist,
} from './GraphPlotExpressionHelp';

interface GraphPlotEditorProps {
  item: GraphPlotItem;
}

export default function GraphPlotEditor({ item }: GraphPlotEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const axesForPlot = useSceneStore((s) => s.items.get(item.axesId));

  const set = useCallback(
    (patch: Partial<GraphPlotItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const fn = item.fn;
  const patchFn = (p: Partial<typeof fn>) => set({ fn: { ...fn, ...p } });
  const patchFnExpr = useCallback(
    (p: { jsExpr: string; pyExpr: string }) => {
      updateItem(item.id, { fn: { ...fn, ...p } });
    },
    [item.id, updateItem, fn],
  );

  const jsExprRef = useRef<HTMLInputElement>(null);
  const pyExprRef = useRef<HTMLInputElement>(null);
  const lastFormulaFocusRef = useRef<'js' | 'py'>('py');

  const customXDomain = item.xDomain != null;
  const [dxLo, dxHi] = item.xDomain ?? [0, 1];

  const enableCustomXDomain = () => {
    if (axesForPlot?.kind === 'axes') {
      const [a, b] = axesForPlot.xRange;
      set({ xDomain: [Math.min(a, b), Math.max(a, b)] });
    } else {
      set({ xDomain: [-1, 1] });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Graph plot</h3>
      <label className="text-xs text-slate-400 block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Main sine — optional; shown in exit target menu"
          className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>
      <AxesIdSelect value={item.axesId} onChange={(axesId) => set({ axesId })} />

      <div className="flex items-end gap-3 flex-wrap">
        <ColorPicker value={fn.color} onChange={(c) => patchFn({ color: c })} />
        <NumberInput
          label="Stroke width"
          value={item.strokeWidth}
          onChange={(v) => set({ strokeWidth: Math.max(0, v) })}
          min={0}
          step={0.25}
        />
      </div>
      <details open className="rounded border border-slate-600 bg-slate-800/30 px-2 py-2">
        <summary className="text-xs text-slate-400 cursor-pointer select-none flex items-center gap-1.5">
          <span>Function formulae</span>
          <GraphFieldHelpIcon title={GRAPH_PLOT_SECTION_HELP} label="Help: function formulae" />
        </summary>
        <p className="mt-2 text-[11px] leading-snug text-slate-500">
          JavaScript drives the canvas preview; Python (NumPy) drives export. Variable is{' '}
          <code className="text-slate-400">x</code>.
        </p>
        <div className="mt-2 flex items-center gap-1 text-xs text-slate-400">
          <span>Preview (JavaScript)</span>
          <GraphFieldHelpIcon title={GRAPH_PLOT_JS_HELP} label="Help: JavaScript formula" />
        </div>
        <input
          ref={jsExprRef}
          type="text"
          value={fn.jsExpr}
          onChange={(e) => patchFn({ jsExpr: e.target.value })}
          onFocus={() => {
            lastFormulaFocusRef.current = 'js';
          }}
          placeholder="JS: Math.sin(x)"
          className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
        />
        <div className="mt-2 flex items-center gap-1 text-xs text-slate-400">
          <span>Export (Python)</span>
          <GraphFieldHelpIcon title={GRAPH_PLOT_PY_HELP} label="Help: Python formula" />
        </div>
        <input
          ref={pyExprRef}
          type="text"
          value={fn.pyExpr}
          onChange={(e) => patchFn({ pyExpr: e.target.value })}
          onFocus={() => {
            lastFormulaFocusRef.current = 'py';
          }}
          placeholder="Python: np.sin(x)"
          className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
        />
        <GraphPlotExprAssist
          jsExpr={fn.jsExpr}
          pyExpr={fn.pyExpr}
          patchFn={patchFnExpr}
          jsInputRef={jsExprRef}
          pyInputRef={pyExprRef}
          lastFocusRef={lastFormulaFocusRef}
        />
      </details>

      <div className="rounded border border-slate-600 bg-slate-800/40 px-2 py-2 space-y-2">
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={customXDomain}
            onChange={(e) => {
              if (e.target.checked) enableCustomXDomain();
              else set({ xDomain: null });
            }}
            className="rounded border-slate-500"
          />
          Custom x domain (sample curve only on this interval)
        </label>
        {customXDomain && (
          <div className="flex items-end gap-3 flex-wrap pl-5">
            <NumberInput label="x min" value={dxLo} onChange={(v) => set({ xDomain: [v, dxHi] })} />
            <NumberInput label="x max" value={dxHi} onChange={(v) => set({ xDomain: [dxLo, v] })} />
          </div>
        )}
        <p className="text-[10px] text-slate-500 leading-snug pl-5 max-w-md">
          When off, the curve uses the full horizontal range of the axes (same as Manim default). When on, export uses{' '}
          <code className="text-slate-400">plot(..., x_range=[x_min, x_max])</code>.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-end gap-3 flex-wrap">
          <NumberInput label="Start (s)" value={item.startTime} onChange={(v) => set({ startTime: v })} min={0} />
          <NumberInput label="Duration" value={item.duration} onChange={(v) => set({ duration: v })} min={0.01} />
          <NumberInput label="Layer" value={item.layer} onChange={(v) => set({ layer: Math.round(v) })} min={0} step={1} />
        </div>
        <p className="text-[10px] text-slate-500 leading-snug max-w-md">
          On the same axes, higher Layer draws above other plots, dots, fields, and series clips. If Layer matches,
          order is plot → field → series → dot.
        </p>
      </div>

    </div>
  );
}
