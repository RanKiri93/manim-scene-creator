import { useCallback, useMemo } from 'react';
import { createFrame } from '@/store/factories';
import { useSceneStore } from '@/store/useSceneStore';
import type { CameraMoveItem, FrameDef } from '@/types/scene';
import { frameAtCell, frameDisplayName } from '@/lib/frameGrid';
import { cameraFollowAnchor, resolveCameraSchedule } from '@/lib/camera';
import { FRAME_W } from '@/lib/constants';
import { usePreviewMergedItems, usePreviewOps } from '@/agent/previewSelectors';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { useCameraRegionSelection } from '@/canvas/hooks/useCameraRegionSelection';

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
  const cameraObjectFitPadding = useSceneStore((s) => s.cameraObjectFitPadding);
  const setCameraObjectFitPadding = useSceneStore((s) => s.setCameraObjectFitPadding);
  const startFrameId = useSceneStore((s) => s.startFrameId);
  const itemsMap = usePreviewMergedItems();
  const previewOps = usePreviewOps();
  const deletedCameraIds = useMemo(
    () => new Set([...previewOps].filter(([, op]) => op === 'delete').map(([id]) => id)),
    [previewOps],
  );
  const schedule = useMemo(
    () => resolveCameraSchedule(itemsMap, frames, startFrameId, deletedCameraIds),
    [itemsMap, deletedCameraIds, frames, startFrameId],
  );
  const ownSegment = schedule.segments.find((segment) => segment.clip.id === item.id);
  const selectedIds = useSceneStore((s) => s.selectedIds);
  const hasObjectSelection = [...selectedIds].some((id) => {
    const target = itemsMap.get(id);
    return target && ['axes', 'shape', 'image', 'textLine'].includes(target.kind);
  });
  const { requestCameraObjectFit } = useCameraRegionSelection();
  const targetFrame = frames.find((f) => f.id === item.targetFrameId) ?? frames[0];
  const followTargets = [...itemsMap.values()].filter(
    (it) => it.id !== item.id && typeof cameraFollowAnchor(it.id, itemsMap) !== 'string',
  );
  const followProblem = schedule.diagnostics.find((d) => d.clipId === item.id && /follow/i.test(d.message))?.message;

  const set = useCallback(
    (patch: Partial<CameraMoveItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );
  const dirButtonClass =
    'rounded-ctl border border-rule bg-raised px-2 py-1 text-meta text-chalk hover:bg-rule';

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
    <div className="p-3 space-y-3 text-ctl text-chalk-dim">
      <div>
        <label className="block text-chalk-dim mb-1">Clip name</label>
        <input
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          className="w-full bg-raised border border-rule rounded-ctl px-2 py-1"
          placeholder="Camera pan"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="block text-chalk-dim mb-1">Start</span>
          <input
            type="number"
            step="0.1"
            value={item.startTime}
            onChange={(e) => set({ startTime: Math.max(0, Number(e.target.value) || 0) })}
            className="w-full bg-raised border border-rule rounded-ctl px-2 py-1"
          />
        </label>
        <label>
          <span className="block text-chalk-dim mb-1">Duration (seconds)</span>
          <input
            type="number"
            step="0.1"
            min="0.05"
            value={item.duration}
            onChange={(e) => set({ duration: Math.max(0.05, Number(e.target.value) || 0.05) })}
            className="w-full bg-raised border border-rule rounded-ctl px-2 py-1"
          />
        </label>
      </div>

      <label className="block">
        <span className="block text-chalk-dim mb-1">Follow</span>
        <select
          value={item.follow?.targetId ?? ''}
          onChange={(e) => set({ follow: e.target.value ? { targetId: e.target.value } : null, offsetX: 0, offsetY: 0 })}
          className="w-full bg-raised border border-rule rounded-ctl px-2 py-1"
        >
          <option value="">Nothing (move to a fixed spot)</option>
          {followTargets.map((it) => (
            <option key={it.id} value={it.id}>
              {itemClipDisplayName(it)}
            </option>
          ))}
        </select>
        {item.follow && (
          <span className="mt-1 block text-meta text-chalk-faint">
            Eases onto it, keeps it centred until the clip ends, then stays there. Width sets the zoom; offsets shift the view from its centre.
          </span>
        )}
        {followProblem && <span className="mt-1 block text-meta text-warn">{followProblem}</span>}
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="block text-chalk-dim mb-1">Target width</span>
          <input
            type="number"
            step="0.1"
            min="0.01"
            value={item.targetWidth ?? FRAME_W}
            onChange={(e) => set({ targetWidth: Math.max(0.01, Number(e.target.value) || FRAME_W) })}
            className="w-full bg-raised border border-rule rounded-ctl px-2 py-1"
          />
        </label>
        <label>
          <span className="block text-chalk-dim mb-1">Object fit padding</span>
          <input
            type="number"
            step="0.1"
            min="0"
            value={cameraObjectFitPadding}
            onChange={(e) => setCameraObjectFitPadding(Number(e.target.value))}
            className="w-full bg-raised border border-rule rounded-ctl px-2 py-1"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={!hasObjectSelection}
        onClick={() => requestCameraObjectFit(item.id)}
        className="w-full rounded-ctl border border-rule bg-raised px-2 py-1 text-chalk hover:bg-rule disabled:opacity-40"
      >
        Fit selected object
      </button>
      <div className="text-meta text-chalk-faint">Full frame width: {FRAME_W.toFixed(2)} Manim units</div>

      <label>
        <span className="block text-chalk-dim mb-1">Target frame</span>
        <select
          value={targetFrame?.id ?? ''}
          onChange={(e) => {
            set({ targetFrameId: e.target.value, offsetX: 0, offsetY: 0 });
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

      <div>
        <div className="text-chalk-dim mb-1">Pan one frame</div>
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
          <span className="block text-chalk-dim mb-1">Offset X</span>
          <input
            type="number"
            step="0.1"
            value={num(item.offsetX)}
            onChange={(e) => set({ offsetX: Number(e.target.value) || 0 })}
            className="w-full bg-raised border border-rule rounded-ctl px-2 py-1"
          />
        </label>
        <label>
          <span className="block text-chalk-dim mb-1">Offset Y</span>
          <input
            type="number"
            step="0.1"
            value={num(item.offsetY)}
            onChange={(e) => set({ offsetY: Number(e.target.value) || 0 })}
            className="w-full bg-raised border border-rule rounded-ctl px-2 py-1"
          />
        </label>
      </div>

      {ownSegment?.overriddenBy ? (
        <div className="rounded-ctl border border-warn/45 bg-warn/10 px-2 py-1 text-warn">
          Overridden by {itemClipDisplayName(ownSegment.overriddenBy)} at {ownSegment.overriddenBy.startTime.toFixed(2)}s
        </div>
      ) : ownSegment?.supersededByEqualStart ? (
        <div className="rounded-ctl border border-warn/45 bg-warn/10 px-2 py-1 text-warn">
          Superseded by {itemClipDisplayName(ownSegment.supersededByEqualStart)} at the same start time
        </div>
      ) : null}

      <label>
        <span className="block text-chalk-dim mb-1">Layer</span>
        <input
          type="number"
          step="1"
          value={item.layer}
          onChange={(e) => set({ layer: Math.trunc(Number(e.target.value) || 0) })}
          className="w-24 bg-raised border border-rule rounded-ctl px-2 py-1"
        />
      </label>
    </div>
  );
}
