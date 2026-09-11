import { useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { GraphPlotItem, FunctionLineStyle } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import AxesIdSelect from './AxesIdSelect';
import AudioBindingSelect from './AudioBindingSelect';
import PropertyTabs from './PropertyTabs';
import VisibleAtSceneStartRow from './VisibleAtSceneStartRow';
import TargetAnimationEffectsNote from './TargetAnimationEffectsNote';
import MathExpressionEditor from './MathExpressionEditor';

const LINE_STYLES: FunctionLineStyle[] = ['solid', 'dashed', 'dotted'];

interface GraphPlotEditorProps {
  item: GraphPlotItem;
}

export default function GraphPlotEditor({ item }: GraphPlotEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const setItemAudioBinding = useSceneStore((s) => s.setItemAudioBinding);
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

  const baseContent = (
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
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <span>Line style</span>
          <select
            value={item.lineStyle ?? 'solid'}
            onChange={(e) =>
              set({ lineStyle: e.target.value as FunctionLineStyle })
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

      <TargetAnimationEffectsNote targetId={item.id} />
    </div>
  );

  const graphContent = (
    <div className="flex flex-col gap-3">
      <MathExpressionEditor
        label="Function formulae"
        jsExpr={fn.jsExpr}
        pyExpr={fn.pyExpr}
        onChange={patchFnExpr}
        dialogTitle="Plot expression helper"
      />

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
    </div>
  );

  const animationContent = (
    <div className="flex flex-col gap-3">
      <VisibleAtSceneStartRow
        checked={item.visibleAtSceneStart === true}
        note="Intro audio is not synchronized (no intro animation)."
        onChange={(next) =>
          set(
            next
              ? { visibleAtSceneStart: true, startTime: 0 }
              : { visibleAtSceneStart: undefined },
          )
        }
      />
      <div className="flex flex-col gap-1">
        <div className="flex items-end gap-3 flex-wrap">
          <NumberInput
            label="Start (s)"
            value={item.startTime}
            onChange={(v) => set({ startTime: v })}
            min={0}
            disabled={item.visibleAtSceneStart === true}
          />
          <NumberInput label="Duration" value={item.duration} onChange={(v) => set({ duration: v })} min={0.01} />
          <NumberInput label="Layer" value={item.layer} onChange={(v) => set({ layer: Math.round(v) })} min={0} step={1} />
        </div>
        <p className="text-[10px] text-slate-500 leading-snug max-w-md">
          On the same axes, higher Layer draws above other plots, dots, fields, and series clips. If Layer matches,
          order is plot → field → series → dot.
        </p>
      </div>

      <AudioBindingSelect
        value={item.audioTrackId}
        currentItemId={item.id}
        onChange={(audioTrackId) => setItemAudioBinding(item.id, audioTrackId)}
      />
    </div>
  );

  return (
    <PropertyTabs
      key={item.id}
      defaultTabId="base"
      tabs={[
        { id: 'base', label: 'Base', content: baseContent },
        { id: 'graph', label: 'Graph', content: graphContent },
        { id: 'animation', label: 'Animation / Audio', content: animationContent },
      ]}
    />
  );
}
