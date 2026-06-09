import { useCallback } from 'react';
import { createFrame } from '@/store/factories';
import { useSceneStore } from '@/store/useSceneStore';
import type { CameraMoveItem, FrameDef } from '@/types/scene';
import { frameAtCell, frameDisplayName } from '@/lib/frameGrid';

interface CameraMoveEditorProps {
  item: CameraMoveItem;
}

function num(v: number | undefined, fallback = 0): number {
  return Number.isFinite(v) ? v! : fallback;
}

export default function CameraMoveEditor({ item }: CameraMoveEditorProps) {
  const frames = useSceneStore((s) => s.frames);
  const addFrame = useSceneStore((s) => s.addFrame);
  const updateItem = useSceneStore((s) => s.updateItem);
  const setActiveFrameId = useSceneStore((s) => s.setActiveFrameId);
  const targetFrame = frames.find((f) => f.id === item.targetFrameId) ?? frames[0];

  const set = useCallback(
    (patch: Partial<CameraMoveItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );
  const dirButtonClass =
    'rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700';

  const moveDir = useCallback(
    (dc: number, dr: number) => {
      if (!targetFrame) return;
      const col = targetFrame.col + dc;
      const row = targetFrame.row + dr;
      let next: FrameDef | null = frameAtCell(frames, col, row);
      if (!next) {
        const ok = window.confirm(
          `There is no frame at (${col}, ${row}) yet. Create it and pan there?`,
        );
        if (!ok) return;
        next = createFrame(col, row, `Frame ${frames.length + 1}`);
        addFrame(next);
      }
      set({ targetFrameId: next.id, offsetX: 0, offsetY: 0 });
      setActiveFrameId(next.id);
    },
    [targetFrame, frames, addFrame, set, setActiveFrameId],
  );

  return (
    <div className="p-3 space-y-3 text-xs text-slate-300">
      <div>
        <label className="block text-slate-400 mb-1">Clip name</label>
        <input
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1"
          placeholder="Camera pan"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="block text-slate-400 mb-1">Start</span>
          <input
            type="number"
            step="0.1"
            value={item.startTime}
            onChange={(e) => set({ startTime: Math.max(0, Number(e.target.value) || 0) })}
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1"
          />
        </label>
        <label>
          <span className="block text-slate-400 mb-1">Duration</span>
          <input
            type="number"
            step="0.1"
            min="0.05"
            value={item.duration}
            onChange={(e) => set({ duration: Math.max(0.05, Number(e.target.value) || 0.05) })}
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1"
          />
        </label>
      </div>

      <label>
        <span className="block text-slate-400 mb-1">Target frame</span>
        <select
          value={targetFrame?.id ?? ''}
          onChange={(e) => {
            set({ targetFrameId: e.target.value, offsetX: 0, offsetY: 0 });
            setActiveFrameId(e.target.value);
          }}
          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1"
        >
          {frames.map((f) => (
            <option key={f.id} value={f.id}>
              {frameDisplayName(f, frames)} ({f.col}, {f.row})
            </option>
          ))}
        </select>
      </label>

      <div>
        <div className="text-slate-400 mb-1">Pan one frame</div>
        <div className="grid grid-cols-3 gap-1 max-w-[9rem]">
          <span />
          <button type="button" className={dirButtonClass} onClick={() => moveDir(0, -1)}>
            Up
          </button>
          <span />
          <button type="button" className={dirButtonClass} onClick={() => moveDir(-1, 0)}>
            Left
          </button>
          <button type="button" className={dirButtonClass} onClick={() => moveDir(0, 1)}>
            Down
          </button>
          <button type="button" className={dirButtonClass} onClick={() => moveDir(1, 0)}>
            Right
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="block text-slate-400 mb-1">Offset X</span>
          <input
            type="number"
            step="0.1"
            value={num(item.offsetX)}
            onChange={(e) => set({ offsetX: Number(e.target.value) || 0 })}
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1"
          />
        </label>
        <label>
          <span className="block text-slate-400 mb-1">Offset Y</span>
          <input
            type="number"
            step="0.1"
            value={num(item.offsetY)}
            onChange={(e) => set({ offsetY: Number(e.target.value) || 0 })}
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1"
          />
        </label>
      </div>

      <label>
        <span className="block text-slate-400 mb-1">Layer</span>
        <input
          type="number"
          step="1"
          value={item.layer}
          onChange={(e) => set({ layer: Math.trunc(Number(e.target.value) || 0) })}
          className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-1"
        />
      </label>
    </div>
  );
}
