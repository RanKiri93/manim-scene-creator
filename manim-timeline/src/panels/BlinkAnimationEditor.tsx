import { useCallback, useMemo } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type {
  BlinkAnimationItem,
  BlinkMode,
  BlinkTargetSpec,
  TextLineItem,
} from '@/types/scene';
import {
  canBeBlinkTarget,
  minBlinkStartTimeForClip,
  effectiveStart,
} from '@/lib/time';
import { exitTargetSelectLabel, itemClipDisplayName } from '@/lib/itemDisplayName';
import NumberInput from '@/components/NumberInput';
import PropertyTabs from './PropertyTabs';
import {
  DEFAULT_BLINK_COLOR_HEX,
  DEFAULT_BLINK_SCALE_FACTOR,
} from '@/codegen/blinkCodegen';

interface BlinkAnimationEditorProps {
  item: BlinkAnimationItem;
}

export default function BlinkAnimationEditor({ item }: BlinkAnimationEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const removeItem = useSceneStore((s) => s.removeItem);
  const itemsMap = useSceneStore((s) => s.items);

  const set = useCallback(
    (patch: Partial<BlinkAnimationItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const targets = useMemo(
    () => [...itemsMap.values()].filter((it) => canBeBlinkTarget(it)),
    [itemsMap],
  );

  const targetsList = item.targets?.length ? item.targets : [];

  const minStart = minBlinkStartTimeForClip(item, itemsMap);
  const invalidStart = minStart != null && item.startTime + 1e-6 < minStart;

  const setTargets = useCallback(
    (next: BlinkTargetSpec[]) => set({ targets: next }),
    [set],
  );

  const addRow = () => {
    const pick =
      targets.find((t) => !targetsList.some((r) => r.targetId === t.id)) ??
      targets[0];
    if (!pick) return;
    setTargets([
      ...targetsList,
      {
        targetId: pick.id,
        mode: 'scale_color',
        scaleFactor: DEFAULT_BLINK_SCALE_FACTOR,
        blinkColor: DEFAULT_BLINK_COLOR_HEX,
      },
    ]);
  };

  const removeRow = (index: number) => {
    if (targetsList.length <= 1) return;
    setTargets(targetsList.filter((_, i) => i !== index));
  };

  const patchRow = (index: number, patch: Partial<BlinkTargetSpec>) => {
    setTargets(targetsList.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const onTargetChange = (index: number, newTargetId: string) => {
    const t = itemsMap.get(newTargetId);
    if (!t || !canBeBlinkTarget(t)) return;
    const next = targetsList.map((r, i) =>
      i === index ? { ...r, targetId: newTargetId, segmentIndices: null } : r,
    );
    const est = effectiveStart(t, itemsMap);
    updateItem(item.id, {
      targets: next,
      startTime: Math.max(item.startTime, est),
    });
  };

  const toggleSegment = (rowIndex: number, segIdx: number, line: TextLineItem) => {
    const row = targetsList[rowIndex];
    if (!row) return;
    const cur = row.segmentIndices ?? [];
    const has = cur.includes(segIdx);
    const nextIdx = has ? cur.filter((x) => x !== segIdx) : [...cur, segIdx].sort((a, b) => a - b);
    patchRowAllSegments(rowIndex, line, nextIdx);
  };

  const patchRowAllSegments = (rowIndex: number, line: TextLineItem, nextIdx: number[]) => {
    const n = line.segments.length;
    const valid = nextIdx.filter((i) => i >= 0 && i < n);
    const allSelected = n > 0 && valid.length >= n;
    patchRow(rowIndex, {
      segmentIndices: !n || allSelected || valid.length === 0 ? null : valid,
    });
  };

  const baseContent = (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Blink animation</h3>
      <p className="text-[11px] text-slate-500 leading-snug">
        Pulses scale and/or color on targets, then restores them. Does not remove objects.
        Start time must be at or after each target&apos;s timeline start.
      </p>

      <label className="text-xs text-slate-400 block">
        Label
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Blink emphasize"
          className="mt-1 w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>

      <button
        type="button"
        className="self-start text-xs text-red-300 hover:text-red-200 underline"
        onClick={() => removeItem(item.id)}
      >
        Delete blink clip
      </button>
    </div>
  );

  const targetsContent = (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-xs text-slate-400 mb-1">Targets</div>
        <div className="flex flex-col gap-2">
          {targetsList.map((row, index) => {
            const target = itemsMap.get(row.targetId);
            const hasTarget = targets.some((t) => t.id === row.targetId);
            const line = target?.kind === 'textLine' ? target : null;
            const segIdx = row.segmentIndices?.filter(
              (i) => line && i >= 0 && i < line.segments.length,
            );
            const mathSegments =
              line?.segments
                .map((s, i) => (s.isMath ? i : null))
                .filter((x): x is number => x != null) ?? [];
            return (
              <div
                key={`${row.targetId}-${index}`}
                className="flex flex-wrap gap-2 p-2 rounded border border-slate-700 bg-slate-800/40"
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
                <label className="text-[10px] text-slate-500 w-[140px]">
                  Mode
                  <select
                    value={row.mode}
                    onChange={(e) =>
                      patchRow(index, { mode: e.target.value as BlinkMode })
                    }
                    className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="scale">Scale only</option>
                    <option value="color">Color only</option>
                    <option value="scale_color">Scale + color</option>
                  </select>
                </label>
                {(row.mode === 'scale' || row.mode === 'scale_color') && (
                  <label className="text-[10px] text-slate-500 w-[100px]">
                    Scale
                    <input
                      type="number"
                      step={0.01}
                      min={1.01}
                      max={3}
                      value={row.scaleFactor ?? DEFAULT_BLINK_SCALE_FACTOR}
                      onChange={(e) =>
                        patchRow(index, {
                          scaleFactor: Math.max(1.01, +e.target.value || 1.15),
                        })
                      }
                      className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
                    />
                  </label>
                )}
                {(row.mode === 'color' || row.mode === 'scale_color') && (
                  <label className="text-[10px] text-slate-500 w-[100px]">
                    Blink color
                    <input
                      type="color"
                      value={
                        row.blinkColor && /^#[0-9a-fA-F]{6}$/.test(row.blinkColor)
                          ? row.blinkColor
                          : DEFAULT_BLINK_COLOR_HEX
                      }
                      onChange={(e) => patchRow(index, { blinkColor: e.target.value })}
                      className="mt-0.5 w-full h-7 bg-slate-800 border border-slate-600 rounded"
                    />
                  </label>
                )}
                {targetsList.length > 1 ? (
                  <button
                    type="button"
                    className="text-[10px] text-slate-500 hover:text-red-300 px-1 self-end"
                    onClick={() => removeRow(index)}
                  >
                    Remove
                  </button>
                ) : null}
                {line && line.segments.length > 0 ? (
                  <div className="w-full">
                    <div className="text-[10px] text-slate-500 mb-1">
                      Text segments (optional subset; empty = whole line). Per-segment indices
                      match export order <code className="text-slate-400">line[i]</code>.
                    </div>
                    {mathSegments.length > 0 ? (
                      <p className="text-[10px] text-amber-500/90 mb-1">
                        Math segments: for stable sub-formula emphasis, split into separate{' '}
                        <code className="text-slate-400">$…$</code> segments. Glyph-level pick is
                        not available in the UI yet.
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-1">
                      {line.segments.map((seg, si) => {
                        const active =
                          !segIdx?.length || (segIdx?.includes(si) ?? false);
                        return (
                          <button
                            key={si}
                            type="button"
                            title={seg.text.slice(0, 80)}
                            onClick={() => toggleSegment(index, si, line)}
                            className={`text-[10px] px-1.5 py-0.5 rounded border ${
                              active
                                ? 'bg-sky-700/50 border-sky-500 text-sky-100'
                                : 'bg-slate-900 border-slate-600 text-slate-500 line-through'
                            }`}
                          >
                            #{si}
                            {seg.isMath ? ' m' : ''}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className="text-[10px] text-sky-400 underline"
                        onClick={() => patchRow(index, { segmentIndices: null })}
                      >
                        All
                      </button>
                    </div>
                  </div>
                ) : null}
                {target && canBeBlinkTarget(target) ? (
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
          Start time is before a target timeline start. Increase start to at least{' '}
          {minStart!.toFixed(2)}s.
        </p>
      ) : null}
    </div>
  );

  const animationContent = (
    <div className="flex flex-col gap-3">
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
          label="Repetitions"
          value={item.repetitions}
          onChange={(v) => set({ repetitions: Math.max(1, Math.round(v)) })}
          min={1}
          step={1}
        />
        <NumberInput
          label="Layer"
          value={item.layer}
          onChange={(v) => set({ layer: Math.round(v) })}
          min={0}
          step={1}
        />
      </div>
    </div>
  );

  return (
    <PropertyTabs
      key={item.id}
      defaultTabId="base"
      tabs={[
        { id: 'base', label: 'Base', content: baseContent },
        { id: 'targets', label: 'Targets', content: targetsContent },
        { id: 'animation', label: 'Animation', content: animationContent },
      ]}
    />
  );
}
