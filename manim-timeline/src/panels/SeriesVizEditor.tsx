import { useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { GraphSeriesVizItem, SeriesNEasing, SeriesNMapping, SeriesVizMode } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import VoiceoverEditor from './VoiceoverEditor';
import AxesIdSelect from './AxesIdSelect';
import { MAX_SERIES_N_SPAN } from '@/lib/seriesVizPreview';

interface SeriesVizEditorProps {
  item: GraphSeriesVizItem;
}

export default function SeriesVizEditor({ item }: SeriesVizEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);

  const set = useCallback(
    (patch: Partial<GraphSeriesVizItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const modeHelp =
    item.vizMode === 'partialPlot'
      ? 'Use variables k and x (term at index k). In Python you can use math.factorial after import math in a custom scene, or keep terms explicit.'
      : 'Use variable n for the term a(n). Series mode sums a(i) from nMin through current n.';

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Series / sequence visualizer</h3>
      <label className="text-xs text-slate-400 block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Harmonic series — optional; shown in exit target menu"
          className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>
      <AxesIdSelect value={item.axesId} onChange={(axesId) => set({ axesId })} />

      <label className="text-xs text-slate-400 block">
        Mode
        <select
          value={item.vizMode}
          onChange={(e) => set({ vizMode: e.target.value as SeriesVizMode })}
          className="mt-1 w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          <option value="sequence">Sequence (n, aₙ)</option>
          <option value="series">Series partial sums</option>
          <option value="partialPlot">Partial sum fₙ(x) = Σ term(k,x)</option>
        </select>
      </label>

      <p className="text-[11px] text-slate-500 leading-snug">{modeHelp}</p>

      <div className="flex flex-wrap gap-3 items-end">
        <NumberInput label="n min" value={item.nMin} onChange={(v) => set({ nMin: Math.round(v) })} step={1} />
        <NumberInput label="n max" value={item.nMax} onChange={(v) => set({ nMax: Math.round(v) })} step={1} />
      </div>
      <p className="text-[10px] text-slate-500">
        Preview caps at {MAX_SERIES_N_SPAN} indices from n min (wider ranges are clipped).
      </p>

      <label className="text-xs text-slate-400 block">
        Index mapping
        <select
          value={item.nMapping}
          onChange={(e) => set({ nMapping: e.target.value as SeriesNMapping })}
          className="mt-1 w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          <option value="linear_discrete">Discrete steps (floor)</option>
          <option value="linear_smooth">Smooth head between integers</option>
        </select>
      </label>

      <label className="text-xs text-slate-400 block">
        Easing (time → n)
        <select
          value={item.nEasing}
          onChange={(e) => set({ nEasing: e.target.value as SeriesNEasing })}
          className="mt-1 w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          <option value="linear">Linear</option>
          <option value="ease_out">Ease out (slow near end)</option>
          <option value="ease_in_out">Ease in–out</option>
        </select>
      </label>

      <input
        type="text"
        value={item.jsExpr}
        onChange={(e) => set({ jsExpr: e.target.value })}
        placeholder="JS: 1/n  or  Math.pow(x, k) / (k+1)  (partialPlot: use k, x)"
        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
      />
      <input
        type="text"
        value={item.pyExpr}
        onChange={(e) => set({ pyExpr: e.target.value })}
        placeholder="Python: 1/n (match JS semantics)"
        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
      />

      <div className="flex flex-wrap gap-3 items-end">
        <NumberInput
          label="Ghost trails"
          value={item.ghostCount}
          onChange={(v) => set({ ghostCount: Math.max(0, Math.min(48, Math.round(v))) })}
          min={0}
          max={48}
          step={1}
        />
        <label className="text-xs text-slate-400 flex items-center gap-2">
          <input
            type="checkbox"
            checked={item.showHeadDot}
            onChange={(e) => set({ showHeadDot: e.target.checked })}
            className="accent-blue-500"
          />
          Head dot
        </label>
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <NumberInput
          label="Ghost α min"
          value={item.ghostOpacityMin}
          onChange={(v) => set({ ghostOpacityMin: Math.max(0, Math.min(1, v)) })}
          min={0}
          max={1}
          step={0.05}
        />
        <NumberInput
          label="Ghost α max"
          value={item.ghostOpacityMax}
          onChange={(v) => set({ ghostOpacityMax: Math.max(0, Math.min(1, v)) })}
          min={0}
          max={1}
          step={0.05}
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <ColorPicker value={item.strokeColor} onChange={(c) => set({ strokeColor: c })} />
        <ColorPicker value={item.headColor} onChange={(c) => set({ headColor: c })} />
        <NumberInput
          label="Stroke"
          value={item.strokeWidth}
          onChange={(v) => set({ strokeWidth: Math.max(0.5, v) })}
          min={0.5}
          step={0.25}
        />
      </div>

      <label className="text-xs text-slate-400 block">
        Limit line y (optional, dashed)
        <input
          type="text"
          value={item.limitY === null ? '' : String(item.limitY)}
          onChange={(e) => {
            const t = e.target.value.trim();
            if (t === '') {
              set({ limitY: null });
              return;
            }
            const n = Number(t);
            if (Number.isFinite(n)) set({ limitY: n });
          }}
          placeholder="e.g. 0 — leave empty to hide"
          className="mt-1 w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
        />
      </label>

      <label className="text-xs text-slate-400 block">
        Voice note (script export)
        <textarea
          value={item.voiceText}
          onChange={(e) => set({ voiceText: e.target.value })}
          rows={2}
          className="mt-1 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300"
        />
      </label>

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
