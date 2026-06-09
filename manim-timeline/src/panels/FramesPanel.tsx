import { useState } from 'react';
import { createFrame } from '@/store/factories';
import { useSceneStore } from '@/store/useSceneStore';
import { frameDisplayName, readingOrderFrames } from '@/lib/frameGrid';

const COLLAPSE_KEY = 'manim-timeline.framesPanel.collapsed';

export default function FramesPanel() {
  const frames = useSceneStore((s) => s.frames);
  const startFrameId = useSceneStore((s) => s.startFrameId);
  const activeFrameId = useSceneStore((s) => s.activeFrameId);
  const addFrame = useSceneStore((s) => s.addFrame);
  const updateFrame = useSceneStore((s) => s.updateFrame);
  const removeFrame = useSceneStore((s) => s.removeFrame);
  const setStartFrame = useSceneStore((s) => s.setStartFrame);
  const setActiveFrameId = useSceneStore((s) => s.setActiveFrameId);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const ordered = readingOrderFrames(frames);

  const handleAdd = () => {
    const maxCol = frames.reduce((m, f) => Math.max(m, f.col), 0);
    addFrame(createFrame(maxCol + 1, 0, `Frame ${frames.length + 1}`));
  };

  return (
    <div className="shrink-0 border-t border-slate-700/60">
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          type="button"
          onClick={toggleCollapsed}
          className="flex items-center gap-1 flex-1 text-left text-sm font-semibold text-slate-200 hover:text-white"
          title={collapsed ? 'Expand frames' : 'Collapse frames'}
        >
          <span
            className={`inline-block text-slate-500 transition-transform ${
              collapsed ? '' : 'rotate-90'
            }`}
          >
            ▶
          </span>
          Frames
          <span className="text-[10px] text-slate-500 font-normal">
            ({frames.length})
          </span>
        </button>
        <button
          type="button"
          onClick={handleAdd}
          className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
          title="Add a new frame"
        >
          + Add
        </button>
      </div>

      {!collapsed && (
        <div className="px-3 pb-3 text-xs">
          <p className="text-[10px] text-slate-500 mb-2">
            ★ = scene start frame (camera begins here). ◉ = default frame for new
            objects.
          </p>
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-0.5">
            {ordered.map((f) => {
              const isStart = f.id === startFrameId;
              const isActive = f.id === activeFrameId;
              return (
                <div
                  key={f.id}
                  className="flex items-center gap-1 rounded bg-slate-800/50 px-1.5 py-1"
                >
                  <button
                    type="button"
                    onClick={() => setStartFrame(f.id)}
                    title={
                      isStart ? 'Scene start frame' : 'Set as scene start frame'
                    }
                    className={
                      isStart
                        ? 'text-amber-300'
                        : 'text-slate-600 hover:text-amber-300'
                    }
                  >
                    {isStart ? '★' : '☆'}
                  </button>
                  <input
                    value={f.label ?? ''}
                    placeholder={frameDisplayName(f, frames)}
                    onChange={(e) => updateFrame(f.id, { label: e.target.value })}
                    className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-slate-200"
                  />
                  <span className="text-slate-500 font-mono shrink-0">
                    ({f.col},{f.row})
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveFrameId(f.id)}
                    title={
                      isActive
                        ? 'Default frame for new objects'
                        : 'Use as default frame for new objects'
                    }
                    className={
                      isActive
                        ? 'text-blue-300'
                        : 'text-slate-600 hover:text-blue-300'
                    }
                  >
                    {isActive ? '◉' : '○'}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFrame(f.id)}
                    disabled={frames.length <= 1}
                    title={
                      frames.length <= 1
                        ? 'Cannot remove the only frame'
                        : 'Remove frame'
                    }
                    className="text-slate-500 hover:text-rose-300 disabled:opacity-30 disabled:hover:text-slate-500"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
