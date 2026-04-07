import { useCallback, useMemo } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { ExitAnimationItem } from '@/types/scene';
import { canBeExitTarget, holdEnd, minExitStartTime } from '@/lib/time';
import { exitTargetSelectLabel, itemClipDisplayName } from '@/lib/itemDisplayName';
import NumberInput from '@/components/NumberInput';

interface ExitAnimationEditorProps {
  item: ExitAnimationItem;
}

export default function ExitAnimationEditor({ item }: ExitAnimationEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const removeItem = useSceneStore((s) => s.removeItem);
  const itemsMap = useSceneStore((s) => s.items);

  const set = useCallback(
    (patch: Partial<ExitAnimationItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const targets = useMemo(
    () => [...itemsMap.values()].filter((it) => canBeExitTarget(it)),
    [itemsMap],
  );

  const hasCurrentTarget = targets.some((t) => t.id === item.targetId);

  const target = itemsMap.get(item.targetId);
  const minStart = minExitStartTime(item.targetId, itemsMap);
  const invalidStart = minStart != null && item.startTime + 1e-6 < minStart;

  const onTargetChange = (newTargetId: string) => {
    const t = itemsMap.get(newTargetId);
    if (!t || !canBeExitTarget(t)) return;
    const he = holdEnd(t, itemsMap);
    set({
      targetId: newTargetId,
      startTime: Math.max(item.startTime, he),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Exit animation</h3>
      <p className="text-[11px] text-slate-500 leading-snug">
        Runs on the timeline at the start time below. Must begin at or after the target&apos;s run ends (
        {minStart != null ? `${minStart.toFixed(2)}s` : '—'}).
      </p>

      <label className="text-xs text-slate-400 block">
        Label
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Exit title"
          className="mt-1 w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>

      <label className="text-xs text-slate-400 block">
        Target
        <span className="mt-0.5 block text-[10px] text-slate-500 leading-snug">
          Set each object&apos;s <strong className="text-slate-400 font-medium">Clip name</strong> (or
          line-specific labels like plot/dot names) in its properties so this list stays easy to scan.
        </span>
        <select
          value={item.targetId}
          onChange={(e) => onTargetChange(e.target.value)}
          className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          {!hasCurrentTarget ? (
            <option value={item.targetId}>(missing) {item.targetId.slice(0, 10)}</option>
          ) : null}
          {targets.length === 0 && !hasCurrentTarget ? (
            <option value={item.targetId}>No targets</option>
          ) : null}
          {targets.map((t) => (
            <option key={t.id} value={t.id} title={t.id}>
              {exitTargetSelectLabel(t, itemsMap)}
            </option>
          ))}
        </select>
      </label>

      {target && canBeExitTarget(target) ? (
        <p className="text-[10px] text-slate-500">
          Current target: <span className="text-slate-400 font-mono">{item.targetId}</span>
          {' — '}
          <span className="text-slate-400">{itemClipDisplayName(target)}</span>
        </p>
      ) : null}

      {!target || !canBeExitTarget(target) ? (
        <p className="text-xs text-amber-400">Target is missing or invalid. Delete this clip or pick another target.</p>
      ) : null}

      {invalidStart ? (
        <p className="text-xs text-amber-400">
          Start time is before the target run ends. Increase start to at least {minStart!.toFixed(2)}s.
        </p>
      ) : null}

      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput
          label="Start (s)"
          value={item.startTime}
          onChange={(v) => set({ startTime: Math.max(0, v) })}
          min={0}
        />
        <NumberInput
          label="Duration"
          value={item.duration}
          onChange={(v) => set({ duration: Math.max(0.05, v) })}
          min={0.05}
        />
        <NumberInput
          label="Layer"
          value={item.layer}
          onChange={(v) => set({ layer: Math.round(v) })}
          min={0}
          step={1}
        />
      </div>

      <div>
        <div className="text-xs text-slate-400 mb-1 block">Style</div>
        <select
          value={item.animStyle}
          onChange={(e) =>
            set({
              animStyle: e.target.value as ExitAnimationItem['animStyle'],
            })
          }
          className="w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          <option value="fade_out">FadeOut</option>
          <option value="uncreate">Uncreate</option>
          <option value="shrink_to_center">ShrinkToCenter</option>
          <option value="none">None (no-op export)</option>
        </select>
      </div>

      <button
        type="button"
        className="self-start text-xs text-red-300 hover:text-red-200 underline"
        onClick={() => removeItem(item.id)}
      >
        Delete exit clip
      </button>
    </div>
  );
}
