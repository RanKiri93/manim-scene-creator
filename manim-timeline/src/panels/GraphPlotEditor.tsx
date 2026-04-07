import { useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { GraphPlotItem } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import VoiceoverEditor from './VoiceoverEditor';
import AxesIdSelect from './AxesIdSelect';

interface GraphPlotEditorProps {
  item: GraphPlotItem;
}

export default function GraphPlotEditor({ item }: GraphPlotEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);

  const set = useCallback(
    (patch: Partial<GraphPlotItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const fn = item.fn;
  const patchFn = (p: Partial<typeof fn>) => set({ fn: { ...fn, ...p } });

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

      <div className="flex items-center gap-2">
        <ColorPicker value={fn.color} onChange={(c) => patchFn({ color: c })} />
      </div>
      <input
        type="text"
        value={fn.jsExpr}
        onChange={(e) => patchFn({ jsExpr: e.target.value })}
        placeholder="JS: Math.sin(x)"
        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
      />
      <input
        type="text"
        value={fn.pyExpr}
        onChange={(e) => patchFn({ pyExpr: e.target.value })}
        placeholder="Python: np.sin(x)"
        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
      />

      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput label="Start (s)" value={item.startTime} onChange={(v) => set({ startTime: v })} min={0} />
        <NumberInput label="Duration" value={item.duration} onChange={(v) => set({ duration: v })} min={0.01} />
        <NumberInput label="Layer" value={item.layer} onChange={(v) => set({ layer: Math.round(v) })} min={0} step={1} />
      </div>

      <details>
        <summary className="text-xs text-slate-400 cursor-pointer select-none">Voiceover</summary>
        <div className="mt-2">
          <VoiceoverEditor voice={item.voice} onChange={(v) => set({ voice: v })} />
        </div>
      </details>
    </div>
  );
}
