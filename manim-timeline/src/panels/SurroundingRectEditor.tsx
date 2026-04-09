import { useCallback, useMemo } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type {
  ManimDirection,
  SurroundingRectItem,
  TextLineItem,
} from '@/types/scene';
import {
  canBeSurroundTarget,
  effectiveEnd,
  effectiveStart,
} from '@/lib/time';
import { exitTargetSelectLabel, itemClipDisplayName } from '@/lib/itemDisplayName';
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

  const target = itemsMap.get(item.targetId);
  const hasTarget = target && canBeSurroundTarget(target);

  const tStart = target ? effectiveStart(target, itemsMap) : null;
  const tEnd = target ? effectiveEnd(target, itemsMap) : null;
  const invalidWindow =
    hasTarget &&
    tStart != null &&
    (item.startTime + 1e-6 < tStart ||
      (Number.isFinite(tEnd) && item.startTime >= (tEnd as number) - 1e-6));

  const onTargetChange = (newTargetId: string) => {
    const t = itemsMap.get(newTargetId);
    if (!t || !canBeSurroundTarget(t)) return;
    set({
      targetId: newTargetId,
      startTime: Math.max(item.startTime, effectiveStart(t, itemsMap)),
      segmentIndices: null,
    });
  };

  const lineTarget = target?.kind === 'textLine' ? (target as TextLineItem) : null;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Surrounding rectangle</h3>
      <p className="text-[11px] text-slate-500 leading-snug">
        Draws a Manim <code className="text-slate-400">SurroundingRectangle</code> around the
        target after it is positioned. Add an <strong className="text-slate-400">Exit animation</strong>{' '}
        targeting this clip to remove the box.
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

      <label className="text-xs text-slate-400 block">
        Target
        <select
          value={item.targetId}
          onChange={(e) => onTargetChange(e.target.value)}
          className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          {!hasTarget ? (
            <option value={item.targetId}>(missing) {item.targetId.slice(0, 10)}</option>
          ) : null}
          {candidates.length === 0 && !hasTarget ? (
            <option value={item.targetId}>No targets</option>
          ) : null}
          {candidates.map((t) => (
            <option key={t.id} value={t.id} title={t.id}>
              {exitTargetSelectLabel(t, itemsMap)}
            </option>
          ))}
        </select>
      </label>

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

      {hasTarget && target ? (
        <p className="text-[10px] text-slate-500">
          Target visible (approx.):{' '}
          {tStart != null ? `${tStart.toFixed(2)}s` : '—'}
          {' — '}
          {tEnd != null && Number.isFinite(tEnd)
            ? `${(tEnd as number).toFixed(2)}s`
            : '∞'}
          {' · '}
          {itemClipDisplayName(target)}
        </p>
      ) : null}

      {invalidWindow ? (
        <p className="text-xs text-amber-400">
          Start time should be while the target is on screen (after its start, before it exits).
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
          label="Hold (s)"
          value={item.duration}
          onChange={(v) => set({ duration: Math.max(0.1, v) })}
          min={0.1}
        />
        <NumberInput
          label="Layer"
          value={item.layer}
          onChange={(v) => set({ layer: Math.round(v) })}
          min={0}
          step={1}
        />
      </div>

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
        <div className="text-xs text-slate-400 mb-1">Intro</div>
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
        <div className="mt-2 max-w-[200px]">
          <NumberInput
            label="Intro run time (s)"
            value={item.introRunTime}
            onChange={(v) => set({ introRunTime: Math.max(0.05, v) })}
            min={0.05}
          />
        </div>
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
