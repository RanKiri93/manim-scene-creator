import { useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { GraphCurveItem, FunctionLineStyle } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import AxesIdSelect from './AxesIdSelect';
import AudioBindingSelect from './AudioBindingSelect';
import PropertyTabs from './PropertyTabs';
import VisibleAtSceneStartRow from './VisibleAtSceneStartRow';
import MathExpressionEditor from './MathExpressionEditor';
import { PARAM_T_PROFILE } from './mathExpressionPresets';

const LINE_STYLES: FunctionLineStyle[] = ['solid', 'dashed', 'dotted'];

interface GraphCurveEditorProps {
  item: GraphCurveItem;
}

export default function GraphCurveEditor({ item }: GraphCurveEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const setItemAudioBinding = useSceneStore((s) => s.setItemAudioBinding);

  const set = useCallback(
    (patch: Partial<GraphCurveItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const curve = item.curve;
  const patchCurve = (p: Partial<typeof curve>) =>
    set({ curve: { ...curve, ...p } });
  const patchXExprs = useCallback(
    (p: { jsExpr: string; pyExpr: string }) => {
      updateItem(item.id, {
        curve: { ...curve, jsXExpr: p.jsExpr, pyXExpr: p.pyExpr },
      });
    },
    [item.id, updateItem, curve],
  );
  const patchYExprs = useCallback(
    (p: { jsExpr: string; pyExpr: string }) => {
      updateItem(item.id, {
        curve: { ...curve, jsYExpr: p.jsExpr, pyYExpr: p.pyExpr },
      });
    },
    [item.id, updateItem, curve],
  );

  const [tLo, tHi] = item.tDomain;

  const baseContent = (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Graph curve</h3>
      <label className="text-xs text-slate-400 block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Circle trace — optional; shown in exit target menu"
          className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>
      <AxesIdSelect value={item.axesId} onChange={(axesId) => set({ axesId })} />

      <div className="flex items-end gap-3 flex-wrap">
        <ColorPicker
          value={curve.color}
          onChange={(c) => patchCurve({ color: c })}
        />
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
    </div>
  );

  const graphContent = (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-slate-600 bg-slate-800/30 px-2 py-2">
        <div className="text-xs text-slate-400 mb-1">Parametric formulae γ(t) = (x(t), y(t))</div>
        <p className="mt-1 text-[11px] leading-snug text-slate-500">
          JavaScript drives the canvas preview; Python (NumPy) drives export. Variable is{' '}
          <code className="text-slate-400">t</code> in graph coordinates on the axes.
        </p>

        <div className="mt-3 flex flex-col gap-2">
          <MathExpressionEditor
            label="x(t)"
            jsExpr={curve.jsXExpr}
            pyExpr={curve.pyXExpr}
            onChange={patchXExprs}
            profile={PARAM_T_PROFILE}
            dialogTitle="Curve x(t) — expression helper"
          />
          <MathExpressionEditor
            label="y(t)"
            jsExpr={curve.jsYExpr}
            pyExpr={curve.pyYExpr}
            onChange={patchYExprs}
            profile={PARAM_T_PROFILE}
            dialogTitle="Curve y(t) — expression helper"
          />
        </div>
      </div>

      <div className="rounded border border-slate-600 bg-slate-800/40 px-2 py-2 space-y-2">
        <div className="text-xs text-slate-300">Parameter domain</div>
        <div className="flex items-end gap-3 flex-wrap">
          <NumberInput label="t min" value={tLo} onChange={(v) => set({ tDomain: [v, tHi] })} />
          <NumberInput label="t max" value={tHi} onChange={(v) => set({ tDomain: [tLo, v] })} />
        </div>
        <p className="text-[10px] text-slate-500 leading-snug max-w-md">
          The curve is sampled from t min to t max (same interval as exported{' '}
          <code className="text-slate-400">ParametricFunction(..., t_range=[...])</code>).
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
          <NumberInput
            label="Duration"
            value={item.duration}
            onChange={(v) => set({ duration: v })}
            min={0.01}
          />
          <NumberInput
            label="Layer"
            value={item.layer}
            onChange={(v) => set({ layer: Math.round(v) })}
            min={0}
            step={1}
          />
        </div>
        <p className="text-[10px] text-slate-500 leading-snug max-w-md">
          On the same axes, higher Layer draws above other plots and curves when layer ties apply.
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
