import { useCallback, useMemo } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type {
  ItemId,
  ManimDirection,
  SceneItem,
  SurroundingRectItem,
  TextLineItem,
} from '@/types/scene';
import {
  canBeSurroundTarget,
  effectiveEnd,
  effectiveStart,
} from '@/lib/time';
import { exitTargetSelectLabel } from '@/lib/itemDisplayName';
import NumberInput from '@/components/NumberInput';

function formatSegmentIndices(idxs: number[] | null | undefined): string {
  if (!idxs?.length) return '';
  return idxs.join(', ');
}

function parseSegmentIndices(
  raw: string,
  segmentCount: number,
): number[] | null {
  const t = raw.trim();
  if (!t) return null;
  const parts = t.split(/[,\s]+/).map((x) => parseInt(x.trim(), 10));
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of parts) {
    if (!Number.isFinite(n) || n < 0 || n >= segmentCount) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.sort((a, b) => a - b);
  return out.length > 0 ? out : null;
}

const DIRS: ManimDirection[] = [
  'UP',
  'DOWN',
  'LEFT',
  'RIGHT',
  'UL',
  'UR',
  'DL',
  'DR',
];

interface SurroundingRectEditorProps {
  item: SurroundingRectItem;
}

function minLegalStartForTargets(
  targetIds: readonly ItemId[],
  itemsMap: Map<ItemId, SceneItem>,
): number {
  let m = 0;
  for (const tid of targetIds) {
    const t = itemsMap.get(tid);
    if (t && canBeSurroundTarget(t)) {
      m = Math.max(m, effectiveStart(t, itemsMap));
    }
  }
  return m;
}

export default function SurroundingRectEditor({ item }: SurroundingRectEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const removeItem = useSceneStore((s) => s.removeItem);
  const itemsMap = useSceneStore((s) => s.items);

  const set = useCallback(
    (patch: Partial<SurroundingRectItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const candidates = useMemo(
    () => [...itemsMap.values()].filter((it) => canBeSurroundTarget(it)),
    [itemsMap],
  );

  const targetIdsList = item.targetIds?.length ? item.targetIds : [];

  const setTargetIds = useCallback(
    (nextIds: ItemId[]) => {
      const unique: ItemId[] = [];
      const seen = new Set<ItemId>();
      for (const id of nextIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        unique.push(id);
      }
      const minT = minLegalStartForTargets(unique, itemsMap);
      const sole = unique.length === 1 ? itemsMap.get(unique[0]!) : null;
      updateItem(item.id, {
        targetIds: unique,
        startTime: Math.max(item.startTime, minT),
        segmentIndices:
          unique.length === 1 && sole?.kind === 'textLine'
            ? item.segmentIndices
            : null,
      });
    },
    [item.id, item.startTime, item.segmentIndices, itemsMap, updateItem],
  );

  const validTargets = useMemo(
    () =>
      targetIdsList
        .map((id) => itemsMap.get(id))
        .filter((t): t is SceneItem => !!t && canBeSurroundTarget(t)),
    [targetIdsList, itemsMap],
  );

  const hasTargets = validTargets.length > 0;
  const tStart =
    validTargets.length > 0
      ? Math.max(...validTargets.map((t) => effectiveStart(t, itemsMap)))
      : null;
  const tEnd =
    validTargets.length > 0
      ? Math.min(...validTargets.map((t) => effectiveEnd(t, itemsMap)))
      : null;

  const invalidWindow =
    hasTargets &&
    tStart != null &&
    (item.startTime + 1e-6 < tStart ||
      (Number.isFinite(tEnd) && item.startTime >= (tEnd as number) - 1e-6));

  const onTargetChange = (index: number, newTargetId: string) => {
    const t = itemsMap.get(newTargetId);
    if (!t || !canBeSurroundTarget(t)) return;
    const list = [...targetIdsList];
    list[index] = newTargetId;
    setTargetIds(list);
  };

  const addRow = () => {
    const pick =
      candidates.find((c) => !targetIdsList.includes(c.id)) ?? candidates[0];
    if (!pick) return;
    setTargetIds([...targetIdsList, pick.id]);
  };

  const removeRow = (index: number) => {
    if (targetIdsList.length <= 1) return;
    setTargetIds(targetIdsList.filter((_, i) => i !== index));
  };

  const soleTarget =
    targetIdsList.length === 1 ? itemsMap.get(targetIdsList[0]!) : null;
  const lineTarget =
    soleTarget?.kind === 'textLine' ? (soleTarget as TextLineItem) : null;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Surrounding rectangle</h3>
      <p className="text-[11px] text-slate-500 leading-snug">
        Draws a Manim <code className="text-slate-400">SurroundingRectangle</code> around the
        chosen object(s) after each is positioned (multiple objects become one <code className="text-slate-400">VGroup</code>
        ). The highlight stays on screen until an <strong className="text-slate-400">Exit animation</strong> targets this clip
        (the timeline bar is only the Create/FadeIn <code className="text-slate-400">run_time</code>).
      </p>

      <label className="text-xs text-slate-400 block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Highlight formula"
          className="mt-1 w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>

      <div>
        <div className="text-xs text-slate-400 mb-1">Targets</div>
        <div className="flex flex-col gap-2">
          {targetIdsList.map((tid, index) => {
            const rowTarget = itemsMap.get(tid);
            const hasRow = rowTarget && canBeSurroundTarget(rowTarget);
            const inList = candidates.some((c) => c.id === tid);
            return (
              <div
                key={`${tid}-${index}`}
                className="flex flex-wrap items-end gap-2 p-2 rounded border border-slate-700 bg-slate-800/40"
              >
                <label className="text-[10px] text-slate-500 flex-1 min-w-[140px]">
                  Object
                  <select
                    value={tid}
                    onChange={(e) => onTargetChange(index, e.target.value)}
                    className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
                  >
                    {!hasRow ? (
                      <option value={tid}>(missing) {tid.slice(0, 10)}</option>
                    ) : null}
                    {!inList && hasRow ? (
                      <option value={tid}>{exitTargetSelectLabel(rowTarget, itemsMap)}</option>
                    ) : null}
                    {candidates.map((t) => (
                      <option key={t.id} value={t.id} title={t.id}>
                        {exitTargetSelectLabel(t, itemsMap)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="text-[10px] text-slate-500 hover:text-red-300 px-2 py-1"
                  disabled={targetIdsList.length <= 1}
                  onClick={() => removeRow(index)}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="mt-2 text-xs text-sky-400 hover:text-sky-300"
          onClick={addRow}
          disabled={candidates.length === 0}
        >
          + Add object
        </button>
        {targetIdsList.length === 0 ? (
          <p className="text-xs text-amber-400 mt-1">Add at least one target to export.</p>
        ) : null}
      </div>

      {lineTarget && lineTarget.segments.length > 0 ? (
        <label className="text-xs text-slate-400 block">
          Text segments to surround (optional)
          <input
            type="text"
            value={formatSegmentIndices(item.segmentIndices)}
            onChange={(e) =>
              set({
                segmentIndices: parseSegmentIndices(
                  e.target.value,
                  lineTarget.segments.length,
                ),
              })
            }
            placeholder="e.g. 2 or 1, 2 — 0-based; empty = whole line"
            className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 font-mono"
          />
          <span className="block mt-1 text-[10px] text-slate-500">
            Split the line with <code className="text-slate-400">||</code> or math segments so each
            part has an index. Preview still shows the full line box.
          </span>
        </label>
      ) : null}

      {hasTargets ? (
        <p className="text-[10px] text-slate-500">
          All visible (intersection, approx.):{' '}
          {tStart != null ? `${tStart.toFixed(2)}s` : '—'}
          {' — '}
          {tEnd != null && Number.isFinite(tEnd)
            ? `${(tEnd as number).toFixed(2)}s`
            : '∞'}
        </p>
      ) : null}

      {invalidWindow ? (
        <p className="text-xs text-amber-400">
          Start time should fall within the overlap when every target is on screen.
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
          label="Runtime (s)"
          value={item.runTime}
          onChange={(v) => set({ runTime: Math.max(0.05, v) })}
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
      <p className="text-[10px] text-slate-500 -mt-1">
        Width of the clip on the timeline matches this runtime (Manim{' '}
        <code className="text-slate-400">self.play(…, run_time=…)</code>).
      </p>

      <div className="grid grid-cols-2 gap-2 max-w-md">
        <NumberInput
          label="Buff"
          value={item.buff}
          onChange={(v) => set({ buff: Math.max(0, v) })}
          min={0}
          step={0.02}
        />
        <label className="text-xs text-slate-400 block col-span-2">
          Stroke color (hex)
          <input
            type="text"
            value={item.color}
            onChange={(e) => set({ color: e.target.value })}
            className="mt-1 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 font-mono"
          />
        </label>
        <NumberInput
          label="Corner radius"
          value={item.cornerRadius}
          onChange={(v) => set({ cornerRadius: Math.max(0, v) })}
          min={0}
          step={0.02}
        />
        <NumberInput
          label="Stroke width"
          value={item.strokeWidth}
          onChange={(v) => set({ strokeWidth: Math.max(0.5, v) })}
          min={0.5}
          step={0.5}
        />
      </div>

      <div>
        <div className="text-xs text-slate-400 mb-1">Intro style</div>
        <select
          value={item.introStyle}
          onChange={(e) =>
            set({
              introStyle: e.target.value as SurroundingRectItem['introStyle'],
            })
          }
          className="w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          <option value="create">Create</option>
          <option value="fade_in">FadeIn</option>
        </select>
      </div>

      <div className="border-t border-slate-700 pt-3">
        <div className="text-xs text-slate-400 mb-2">Label (optional)</div>
        <label className="text-xs text-slate-400 block mb-2">
          Text
          <input
            type="text"
            value={item.labelText}
            onChange={(e) => set({ labelText: e.target.value })}
            placeholder="e.g. Step 1"
            className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
          />
        </label>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs text-slate-400">
            Direction
            <select
              value={item.labelDir}
              onChange={(e) =>
                set({ labelDir: e.target.value as ManimDirection })
              }
              className="mt-1 block w-28 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
            >
              {DIRS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <NumberInput
            label="Font size"
            value={item.labelFontSize}
            onChange={(v) => set({ labelFontSize: Math.max(8, Math.round(v)) })}
            min={8}
            step={1}
          />
        </div>
      </div>

      <button
        type="button"
        className="self-start text-xs text-red-300 hover:text-red-200 underline"
        onClick={() => removeItem(item.id)}
      >
        Delete surrounding rectangle
      </button>
    </div>
  );
}
