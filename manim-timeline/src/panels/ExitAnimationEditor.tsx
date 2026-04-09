import { useCallback, useMemo } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { ExitAnimStyle, ExitAnimationItem, ExitTargetSpec } from '@/types/scene';
import {
  canBeExitTarget,
  holdEnd,
  minExitStartTimeForClip,
} from '@/lib/time';
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

  const targetsList = item.targets?.length ? item.targets : [];

  const minStart = minExitStartTimeForClip(item, itemsMap);
  const invalidStart = minStart != null && item.startTime + 1e-6 < minStart;

  const setTargets = useCallback(
    (next: ExitTargetSpec[]) => set({ targets: next }),
    [set],
  );

  const addRow = () => {
    const pick =
      targets.find((t) => !targetsList.some((r) => r.targetId === t.id)) ??
      targets[0];
    if (!pick) return;
    setTargets([
      ...targetsList,
      { targetId: pick.id, animStyle: 'fade_out' as ExitAnimStyle },
    ]);
  };

  const removeRow = (index: number) => {
    if (targetsList.length <= 1) return;
    setTargets(targetsList.filter((_, i) => i !== index));
  };

  const patchRow = (index: number, patch: Partial<ExitTargetSpec>) => {
    const next = targetsList.map((r, i) => (i === index ? { ...r, ...patch } : r));
    setTargets(next);
  };

  const onTargetChange = (index: number, newTargetId: string) => {
    const t = itemsMap.get(newTargetId);
    if (!t || !canBeExitTarget(t)) return;
    const he = holdEnd(t, itemsMap);
    const next = targetsList.map((r, i) =>
      i === index ? { ...r, targetId: newTargetId } : r,
    );
    updateItem(item.id, {
      targets: next,
      startTime: Math.max(item.startTime, he),
    });
  };

  const allNone = targetsList.every((r) => r.animStyle === 'none');

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Exit animation</h3>
      <p className="text-[11px] text-slate-500 leading-snug">
        All rows run together at the start time below. Each row must begin at or after that
        target&apos;s run end. Start time is clamped to the latest required hold among targets.
      </p>

      <label className="text-xs text-slate-400 block">
        Label
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Exit group"
          className="mt-1 w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>

      <div>
        <div className="text-xs text-slate-400 mb-1">Targets</div>
        <div className="flex flex-col gap-2">
          {targetsList.map((row, index) => {
            const target = itemsMap.get(row.targetId);
            const hasTarget = targets.some((t) => t.id === row.targetId);
            return (
              <div
                key={`${row.targetId}-${index}`}
                className="flex flex-wrap items-end gap-2 p-2 rounded border border-slate-700 bg-slate-800/40"
              >
                <label className="text-[10px] text-slate-500 flex-1 min-w-[140px]">
                  Object
                  <select
                    value={row.targetId}
                    onChange={(e) => onTargetChange(index, e.target.value)}
                    className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
                  >
                    {!hasTarget ? (
                      <option value={row.targetId}>
                        (missing) {row.targetId.slice(0, 10)}
                      </option>
                    ) : null}
                    {targets.map((t) => (
                      <option key={t.id} value={t.id} title={t.id}>
                        {exitTargetSelectLabel(t, itemsMap)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[10px] text-slate-500 w-[130px]">
                  Style
                  <select
                    value={row.animStyle}
                    onChange={(e) =>
                      patchRow(index, {
                        animStyle: e.target.value as ExitAnimStyle,
                      })
                    }
                    className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="fade_out">FadeOut</option>
                    <option value="uncreate">Uncreate</option>
                    <option value="shrink_to_center">ShrinkToCenter</option>
                    <option value="none">None</option>
                  </select>
                </label>
                {targetsList.length > 1 ? (
                  <button
                    type="button"
                    className="text-[10px] text-slate-500 hover:text-red-300 px-1"
                    onClick={() => removeRow(index)}
                  >
                    Remove
                  </button>
                ) : null}
                {target && canBeExitTarget(target) ? (
                  <p className="w-full text-[10px] text-slate-500">
                    {itemClipDisplayName(target)}
                  </p>
                ) : (
                  <p className="w-full text-[10px] text-amber-400">
                    Invalid or missing target.
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="mt-2 text-xs text-sky-400 hover:text-sky-300"
          onClick={addRow}
        >
          + Add target
        </button>
      </div>

      {invalidStart ? (
        <p className="text-xs text-amber-400">
          Start time is before a target run ends. Increase start to at least{' '}
          {minStart!.toFixed(2)}s.
        </p>
      ) : null}

      {allNone ? (
        <p className="text-xs text-amber-400">
          All styles are &quot;None&quot; — export will skip this clip.
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
