import { useState } from 'react';
import { createFrame } from '@/store/factories';
import { useSceneStore } from '@/store/useSceneStore';
import { frameDisplayName, readingOrderFrames } from '@/lib/frameGrid';
import { cx } from '@/lib/cx';
import {
  Button,
  ChevronRightIcon,
  CloseIcon,
  IconButton,
  TextInput,
  focusRing,
} from '@/components/ui';

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
    <div className="shrink-0 border-t border-rule">
      <div className="flex items-center gap-2 pt-2.5 pr-3 pb-2 pl-2.5">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          className={cx(
            'flex flex-1 items-center gap-1.5 rounded-ctl text-left text-chalk [&>svg]:size-3.5',
            focusRing,
          )}
        >
          <span
            className={cx(
              'inline-flex text-chalk-faint transition-transform [&>svg]:size-3.5',
              !collapsed && 'rotate-90',
            )}
          >
            <ChevronRightIcon />
          </span>
          <span className="font-display text-title font-medium">Frames</span>
          <span className="text-meta text-chalk-faint tabular-nums">{frames.length}</span>
        </button>
        <Button size="sm" onClick={handleAdd} title="Add a new frame to the right of the last one">
          Add frame
        </Button>
      </div>

      {!collapsed && (
        <div className="px-2.5 pb-3">
          <p className="m-0 mb-2 px-1 text-meta text-chalk-faint">
            ★ marks where the camera starts. ◉ marks the frame new objects go into.
          </p>
          <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
            {ordered.map((f) => {
              const isStart = f.id === startFrameId;
              const isActive = f.id === activeFrameId;
              return (
                <div key={f.id} className="flex items-center gap-1">
                  <IconButton
                    size="sm"
                    pressed={isStart}
                    label={isStart ? 'Scene start frame' : 'Set as scene start frame'}
                    onClick={() => setStartFrame(f.id)}
                  >
                    <span aria-hidden="true" className={isStart ? 'text-highlight' : undefined}>
                      {isStart ? '★' : '☆'}
                    </span>
                  </IconButton>
                  <TextInput
                    size="sm"
                    className="min-w-0"
                    aria-label="Frame name"
                    value={f.label ?? ''}
                    placeholder={frameDisplayName(f, frames)}
                    onChange={(e) => updateFrame(f.id, { label: e.target.value })}
                  />
                  <span className="shrink-0 px-1 text-meta text-chalk-faint tabular-nums">
                    ({f.col}, {f.row})
                  </span>
                  <IconButton
                    size="sm"
                    pressed={isActive}
                    label={isActive ? 'Default frame for new objects' : 'Use as default frame for new objects'}
                    onClick={() => setActiveFrameId(f.id)}
                  >
                    <span aria-hidden="true">{isActive ? '◉' : '○'}</span>
                  </IconButton>
                  <IconButton
                    size="sm"
                    danger
                    label={frames.length <= 1 ? 'The only frame cannot be removed' : 'Remove frame'}
                    disabled={frames.length <= 1}
                    onClick={() => removeFrame(f.id)}
                  >
                    <CloseIcon />
                  </IconButton>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
