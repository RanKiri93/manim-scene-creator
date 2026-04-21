import { useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { AxesItem } from '@/types/scene';
import { syncAxesLegacyScale } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import PositionStepsEditor from './PositionStepsEditor';

interface AxesEditorProps {
  item: AxesItem;
}

export default function AxesEditor({ item }: AxesEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);

  const set = useCallback(
    (patch: Partial<AxesItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Axes</h3>

      <label className="text-xs text-slate-400 block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Main axes, Inset B"
          className="mt-1 w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
        <span className="mt-1 block text-[10px] text-slate-500 leading-snug">
          Used in the item list, exit-animation target picker, and overlay &quot;Target axes&quot; menus. Plots and fields still link by the internal id below (unchangeable).
        </span>
      </label>

      <details className="text-[10px] text-slate-500">
        <summary className="cursor-pointer text-slate-400 select-none">Internal axes id</summary>
        <code className="mt-1 block break-all rounded bg-slate-950 px-2 py-1 text-[10px] text-slate-400">
          {item.id}
        </code>
      </details>

      <div className="grid grid-cols-3 gap-2">
        <NumberInput label="xMin" value={item.xRange[0]} onChange={(v) => set({ xRange: [v, item.xRange[1], item.xRange[2]] })} />
        <NumberInput label="xMax" value={item.xRange[1]} onChange={(v) => set({ xRange: [item.xRange[0], v, item.xRange[2]] })} />
        <NumberInput label="xStep" value={item.xRange[2]} onChange={(v) => set({ xRange: [item.xRange[0], item.xRange[1], v] })} min={0.1} />
        <NumberInput label="yMin" value={item.yRange[0]} onChange={(v) => set({ yRange: [v, item.yRange[1], item.yRange[2]] })} />
        <NumberInput label="yMax" value={item.yRange[1]} onChange={(v) => set({ yRange: [item.yRange[0], v, item.yRange[2]] })} />
        <NumberInput label="yStep" value={item.yRange[2]} onChange={(v) => set({ yRange: [item.yRange[0], item.yRange[1], v] })} min={0.1} />
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <label className="text-xs text-slate-400">
          X label
          <input
            type="text"
            value={item.xLabel}
            onChange={(e) => set({ xLabel: e.target.value })}
            className="ml-1 w-16 bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-300"
          />
        </label>
        <label className="text-xs text-slate-400">
          Y label
          <input
            type="text"
            value={item.yLabel}
            onChange={(e) => set({ yLabel: e.target.value })}
            className="ml-1 w-16 bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-300"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer">
          <input type="checkbox" checked={item.includeNumbers} onChange={(e) => set({ includeNumbers: e.target.checked })} className="accent-blue-500" />
          Numbers
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer">
          <input type="checkbox" checked={item.includeTip} onChange={(e) => set({ includeTip: e.target.checked })} className="accent-blue-500" />
          Tips
        </label>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput label="Start (s)" value={item.startTime} onChange={(v) => set({ startTime: v })} min={0} />
        <NumberInput label="Duration" value={item.duration} onChange={(v) => set({ duration: v })} min={0.01} />
        <NumberInput label="Layer" value={item.layer} onChange={(v) => set({ layer: Math.round(v) })} min={0} step={1} />
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput label="X" value={item.x} onChange={(v) => set({ x: v })} />
        <NumberInput label="Y" value={item.y} onChange={(v) => set({ y: v })} />
        <NumberInput
          label="Scale X"
          value={item.scaleX}
          onChange={(v) => {
            const scaleX = Math.max(0.01, v);
            const scaleY = Math.max(0.01, item.scaleY);
            set({ scaleX, scale: syncAxesLegacyScale(scaleX, scaleY) });
          }}
          min={0.01}
          step={0.05}
        />
        <NumberInput
          label="Scale Y"
          value={item.scaleY}
          onChange={(v) => {
            const scaleY = Math.max(0.01, v);
            const scaleX = Math.max(0.01, item.scaleX);
            set({ scaleY, scale: syncAxesLegacyScale(scaleX, scaleY) });
          }}
          min={0.01}
          step={0.05}
        />
      </div>

      <details>
        <summary className="text-xs text-slate-400 cursor-pointer select-none">
          Positioning steps ({item.posSteps.length})
        </summary>
        <div className="mt-2">
          <PositionStepsEditor
            steps={item.posSteps}
            onChange={(s) => set({ posSteps: s })}
            currentItemId={item.id}
          />
        </div>
      </details>
    </div>
  );
}
