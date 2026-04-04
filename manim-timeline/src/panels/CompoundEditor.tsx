import { useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { CompoundItem } from '@/types/scene';
import NumberInput from '@/components/NumberInput';

interface CompoundEditorProps {
  item: CompoundItem;
}

export default function CompoundEditor({ item }: CompoundEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const addChildLineToCompound = useSceneStore((s) => s.addChildLineToCompound);
  const itemsMap = useSceneStore((s) => s.items);

  const set = useCallback(
    (patch: Partial<CompoundItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const childCount = item.childIds.length;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Compound clip</h3>
      <p className="text-[10px] text-slate-500 leading-relaxed">
        Groups multiple text lines on one timeline row. Add lines below; each has its own local timing
        (seconds from the compound start). Export flattens them into one Manim script in order.
      </p>

      <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
        <input
          type="checkbox"
          checked={item.centerHorizontally ?? false}
          onChange={(e) => set({ centerHorizontally: e.target.checked })}
          className="accent-violet-500 rounded"
        />
        <span>Center chain horizontally (x = 0)</span>
      </label>
      <p className="text-[10px] text-slate-500">
        Shifts all lines together so the combined width is centered on the frame. Uses measured widths when
        the measure server has run; otherwise an estimate is used.
      </p>

      <label className="text-xs text-slate-400">
        Label
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300"
          placeholder="e.g. Derivation"
        />
      </label>

      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput
          label="Start (s)"
          value={item.startTime}
          onChange={(v) => set({ startTime: v })}
          min={0}
          step={0.1}
        />
        <NumberInput
          label="Duration"
          value={item.duration}
          onChange={(v) => set({ duration: v })}
          min={0.01}
          step={0.1}
        />
        <NumberInput
          label="Wait after"
          value={item.waitAfter}
          onChange={(v) => set({ waitAfter: v })}
          min={0}
          step={0.1}
        />
        <NumberInput
          label="Layer"
          value={item.layer}
          onChange={(v) => set({ layer: Math.round(v) })}
          min={0}
          step={1}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400">
          {childCount} line{childCount !== 1 ? 's' : ''} in sequence
        </span>
        <button
          type="button"
          onClick={() => addChildLineToCompound(item.id)}
          className="ml-auto px-2 py-1 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded transition-colors"
        >
          + Add line to sequence
        </button>
      </div>

      {item.childIds.length > 0 && (
        <ul className="text-[10px] text-slate-500 font-mono space-y-1 max-h-32 overflow-y-auto">
          {item.childIds.map((cid) => {
            const ch = itemsMap.get(cid);
            const preview =
              ch?.kind === 'textLine'
                ? ch.raw.slice(0, 40) || '(empty)'
                : '?';
            const ls = ch?.kind === 'textLine' ? (ch.localStart ?? 0) : 0;
            const ld = ch?.kind === 'textLine' ? (ch.localDuration ?? ch.duration) : 0;
            return (
              <li key={cid}>
                +{ls.toFixed(1)}s–{(ls + ld).toFixed(1)}s — {preview}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
