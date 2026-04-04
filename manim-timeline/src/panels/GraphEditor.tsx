import { useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { createGraphFunction, createGraphDot } from '@/store/factories';
import type { GraphItem, GraphFunction, GraphDot } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import VoiceoverEditor from './VoiceoverEditor';
import PositionStepsEditor from './PositionStepsEditor';

interface GraphEditorProps {
  item: GraphItem;
}

export default function GraphEditor({ item }: GraphEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);

  const set = useCallback(
    (patch: Partial<GraphItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const updateFn = (index: number, patch: Partial<GraphFunction>) => {
    const fns = item.functions.map((f, i) => (i === index ? { ...f, ...patch } : f));
    set({ functions: fns });
  };

  const addFn = () => set({ functions: [...item.functions, createGraphFunction()] });
  const removeFn = (index: number) => set({ functions: item.functions.filter((_, i) => i !== index) });

  const updateDot = (index: number, patch: Partial<GraphDot>) => {
    const dots = item.dots.map((d, i) => (i === index ? { ...d, ...patch } : d));
    set({ dots });
  };

  const addDot = () => set({ dots: [...item.dots, createGraphDot()] });
  const removeDot = (index: number) => set({ dots: item.dots.filter((_, i) => i !== index) });

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Graph (Axes)</h3>

      {/* Axis ranges */}
      <div className="grid grid-cols-3 gap-2">
        <NumberInput label="xMin" value={item.xRange[0]} onChange={(v) => set({ xRange: [v, item.xRange[1], item.xRange[2]] })} />
        <NumberInput label="xMax" value={item.xRange[1]} onChange={(v) => set({ xRange: [item.xRange[0], v, item.xRange[2]] })} />
        <NumberInput label="xStep" value={item.xRange[2]} onChange={(v) => set({ xRange: [item.xRange[0], item.xRange[1], v] })} min={0.1} />
        <NumberInput label="yMin" value={item.yRange[0]} onChange={(v) => set({ yRange: [v, item.yRange[1], item.yRange[2]] })} />
        <NumberInput label="yMax" value={item.yRange[1]} onChange={(v) => set({ yRange: [item.yRange[0], v, item.yRange[2]] })} />
        <NumberInput label="yStep" value={item.yRange[2]} onChange={(v) => set({ yRange: [item.yRange[0], item.yRange[1], v] })} min={0.1} />
      </div>

      {/* Labels + options */}
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

      {/* Timeline */}
      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput label="Start (s)" value={item.startTime} onChange={(v) => set({ startTime: v })} min={0} />
        <NumberInput label="Duration" value={item.duration} onChange={(v) => set({ duration: v })} min={0.01} />
        <NumberInput label="Wait after" value={item.waitAfter} onChange={(v) => set({ waitAfter: v })} min={0} />
        <NumberInput label="Layer" value={item.layer} onChange={(v) => set({ layer: Math.round(v) })} min={0} step={1} />
      </div>

      {/* Exit Animation */}
      <div>
        <div className="text-xs text-slate-400 mb-1 block">Exit Animation</div>
        <select
          value={item.exitAnimStyle ?? 'none'}
          onChange={(e) =>
            set({
              exitAnimStyle: e.target.value as NonNullable<GraphItem['exitAnimStyle']>,
            })
          }
          className="w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          <option value="none">None</option>
          <option value="fade_out">FadeOut</option>
          <option value="uncreate">Uncreate</option>
          <option value="shrink_to_center">ShrinkToCenter</option>
        </select>
        {(item.exitAnimStyle ?? 'none') !== 'none' && (
          <label className="text-xs text-slate-400 mt-2 block">
            Exit run time (s)
            <input
              type="number"
              value={item.exitRunTime ?? 1}
              min={0.1}
              step={0.1}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                set({ exitRunTime: Math.max(0.1, v) });
              }}
              className="ml-1 w-20 bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-300"
            />
          </label>
        )}
      </div>

      {/* Position */}
      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput label="X" value={item.x} onChange={(v) => set({ x: v })} />
        <NumberInput label="Y" value={item.y} onChange={(v) => set({ y: v })} />
        <NumberInput label="Scale" value={item.scale} onChange={(v) => set({ scale: v })} min={0.01} step={0.05} />
      </div>

      {/* Positioning steps */}
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

      {/* Functions */}
      <details open>
        <summary className="text-xs text-slate-400 cursor-pointer select-none">
          Functions ({item.functions.length})
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          {item.functions.map((fn, i) => (
            <div key={fn.id} className="flex flex-col gap-1 p-2 bg-slate-800/50 border border-slate-700 rounded">
              <div className="flex items-center gap-2">
                <ColorPicker value={fn.color} onChange={(c) => updateFn(i, { color: c })} />
                <button onClick={() => removeFn(i)} className="text-red-400 hover:text-red-300 text-xs ml-auto">Remove</button>
              </div>
              <input
                type="text"
                value={fn.jsExpr}
                onChange={(e) => updateFn(i, { jsExpr: e.target.value })}
                placeholder="JS: Math.sin(x)"
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
              />
              <input
                type="text"
                value={fn.pyExpr}
                onChange={(e) => updateFn(i, { pyExpr: e.target.value })}
                placeholder="Python: np.sin(x)"
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
              />
            </div>
          ))}
          <button onClick={addFn} className="text-xs text-blue-400 hover:text-blue-300">+ Add function</button>
        </div>
      </details>

      {/* Dots */}
      <details>
        <summary className="text-xs text-slate-400 cursor-pointer select-none">
          Dots ({item.dots.length})
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          {item.dots.map((dot, i) => (
            <div key={dot.id} className="flex flex-col gap-1 p-2 bg-slate-800/50 border border-slate-700 rounded">
              <div className="flex items-center gap-2 flex-wrap">
                <NumberInput label="x" value={dot.dx} onChange={(v) => updateDot(i, { dx: v })} />
                <NumberInput label="y" value={dot.dy} onChange={(v) => updateDot(i, { dy: v })} />
                <ColorPicker value={dot.color} onChange={(c) => updateDot(i, { color: c })} />
                <button onClick={() => removeDot(i)} className="text-red-400 hover:text-red-300 text-xs ml-auto">Remove</button>
              </div>
              <input
                type="text"
                value={dot.label}
                onChange={(e) => updateDot(i, { label: e.target.value })}
                placeholder="Label"
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300"
              />
            </div>
          ))}
          <button onClick={addDot} className="text-xs text-blue-400 hover:text-blue-300">+ Add dot</button>
        </div>
      </details>

      {/* Voiceover */}
      <details>
        <summary className="text-xs text-slate-400 cursor-pointer select-none">Voiceover</summary>
        <div className="mt-2">
          <VoiceoverEditor voice={item.voice} onChange={(v) => set({ voice: v })} />
        </div>
      </details>
    </div>
  );
}
