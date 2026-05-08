import { useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { GraphDotItem, ManimDirection } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import AxesIdSelect from './AxesIdSelect';
import AudioBindingSelect from './AudioBindingSelect';
import PropertyTabs from './PropertyTabs';
import VisibleAtSceneStartRow from './VisibleAtSceneStartRow';

const DIRS: ManimDirection[] = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'UL', 'UR', 'DL', 'DR'];

interface GraphDotEditorProps {
  item: GraphDotItem;
}

export default function GraphDotEditor({ item }: GraphDotEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const setItemAudioBinding = useSceneStore((s) => s.setItemAudioBinding);

  const set = useCallback(
    (patch: Partial<GraphDotItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const dot = item.dot;
  const patchDot = (p: Partial<typeof dot>) => set({ dot: { ...dot, ...p } });

  const baseContent = (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Graph dot</h3>
      <label className="text-xs text-slate-400 block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Fixed point A — optional; exit target menu prefers this over dot label"
          className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>
      <AxesIdSelect value={item.axesId} onChange={(axesId) => set({ axesId })} />

      <div className="flex items-center gap-2 flex-wrap">
        <NumberInput label="x" value={dot.dx} onChange={(v) => patchDot({ dx: v })} />
        <NumberInput label="y" value={dot.dy} onChange={(v) => patchDot({ dy: v })} />
      </div>
      <label className="text-xs text-slate-400 block">
        On-canvas label
        <input
          type="text"
          value={dot.label}
          onChange={(e) => patchDot({ label: e.target.value })}
          placeholder="Drawn next to the dot"
          className="mt-1 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300"
        />
      </label>
      <label className="text-xs text-slate-400">
        Label dir
        <select
          value={dot.labelDir}
          onChange={(e) => patchDot({ labelDir: e.target.value as ManimDirection })}
          className="ml-2 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          {DIRS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  const styleContent = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400">Dot color</span>
        <ColorPicker value={dot.color} onChange={(c) => patchDot({ color: c })} />
        <NumberInput label="Radius" value={dot.radius} onChange={(v) => patchDot({ radius: v })} min={0.01} step={0.01} />
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
          Raise Layer above the plot&apos;s Layer to draw this dot on top (preview + Manim export). Same Layer: dots
          render above curves by default.
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
        { id: 'style', label: 'Style', content: styleContent },
        { id: 'animation', label: 'Animation / Audio', content: animationContent },
      ]}
    />
  );
}
