import { createFrame } from '@/store/factories';
import { useSceneStore } from '@/store/useSceneStore';
import type { SceneItem } from '@/types/scene';
import { frameAtCell, frameDisplayName } from '@/lib/frameGrid';

interface FrameAssignmentPanelProps {
  item: SceneItem;
}

function isDrawableItem(item: SceneItem): boolean {
  return !(
    item.kind === 'exit_animation' ||
    item.kind === 'blink_animation' ||
    item.kind === 'target_animation' ||
    item.kind === 'camera_move' ||
    item.kind === 'surroundingRect'
  );
}

export default function FrameAssignmentPanel({ item }: FrameAssignmentPanelProps) {
  const frames = useSceneStore((s) => s.frames);
  const startFrameId = useSceneStore((s) => s.startFrameId);
  const activeFrameId = useSceneStore((s) => s.activeFrameId);
  const updateItem = useSceneStore((s) => s.updateItem);
  const addFrame = useSceneStore((s) => s.addFrame);
  const setActiveFrameId = useSceneStore((s) => s.setActiveFrameId);

  if (!isDrawableItem(item)) return null;

  const currentFrameId = 'frameId' in item ? (item.frameId ?? startFrameId) : startFrameId;
  const current = frames.find((f) => f.id === currentFrameId) ?? frames[0];

  const addAdjacent = () => {
    if (!current) return;
    const col = current.col - 1;
    const row = current.row;
    let next = frameAtCell(frames, col, row);
    if (!next) {
      next = createFrame(col, row, `Frame ${frames.length + 1}`);
      addFrame(next);
    }
    updateItem(item.id, { frameId: next.id } as Partial<typeof item>);
    setActiveFrameId(next.id);
  };

  return (
    <div className="border-b border-rule bg-ink/80 p-3 text-ctl text-chalk-dim">
      <div className="flex items-center gap-2">
        <label className="flex-1">
          <span className="block text-chalk-dim mb-1">Frame</span>
          <select
            value={currentFrameId}
            onChange={(e) => {
              updateItem(item.id, { frameId: e.target.value } as Partial<typeof item>);
              setActiveFrameId(e.target.value);
            }}
            className="w-full bg-raised border border-rule rounded-ctl px-2 py-1"
          >
            {frames.map((f) => (
              <option key={f.id} value={f.id}>
                {frameDisplayName(f, frames)} ({f.col}, {f.row})
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveFrameId(currentFrameId)}
          className="rounded-ctl border border-rule bg-raised px-2 py-1 hover:bg-rule"
        >
          Use as active
        </button>
        <button
          type="button"
          onClick={addAdjacent}
          className="rounded-ctl border border-rule bg-raised px-2 py-1 hover:bg-rule"
        >
          Add frame left
        </button>
        <span className="text-chalk-faint py-1">
          Active: {frameDisplayName(frames.find((f) => f.id === activeFrameId), frames)}
        </span>
      </div>
    </div>
  );
}
