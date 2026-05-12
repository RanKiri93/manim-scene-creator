import { useCallback, useMemo, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type {
  TargetAnimationItem,
  TargetAnimationTargetSpec,
  TextLineItem,
} from '@/types/scene';
import {
  canBeTargetAnimationTarget,
  minTargetAnimationStartTimeForClip,
  effectiveStart,
} from '@/lib/time';
import { exitTargetSelectLabel, itemClipDisplayName } from '@/lib/itemDisplayName';
import NumberInput from '@/components/NumberInput';
import PropertyTabs from './PropertyTabs';
import {
  DEFAULT_BLINK_COLOR_HEX,
  DEFAULT_BLINK_SCALE_FACTOR,
} from '@/codegen/blinkCodegen';
import { defaultTargetAnimationRow } from '@/store/factories';
import MathSubobjectPicker from './MathSubobjectPicker';

function defaultParametricPath() {
  return {
    jsXExpr: 'Math.cos(t)',
    jsYExpr: 'Math.sin(t)',
    pyXExpr: 'np.cos(t)',
    pyYExpr: 'np.sin(t)',
    tMin: 0,
    tMax: Math.PI * 2,
    samples: 80,
  };
}

interface TargetAnimationEditorProps {
  item: TargetAnimationItem;
}

export default function TargetAnimationEditor({ item }: TargetAnimationEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const removeItem = useSceneStore((s) => s.removeItem);
  const itemsMap = useSceneStore((s) => s.items);
  const pathCapture = useSceneStore((s) => s.targetAnimationPathCapture);
  const setPathCapture = useSceneStore((s) => s.setTargetAnimationPathCapture);
  const [picker, setPicker] = useState<{ rowIndex: number; segmentIndex: number } | null>(
    null,
  );

  const set = useCallback(
    (patch: Partial<TargetAnimationItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const targets = useMemo(
    () =>
      [...itemsMap.values()].filter((it) =>
        canBeTargetAnimationTarget(it, item.mode),
      ),
    [itemsMap, item.mode],
  );

  const targetsList = item.targets?.length ? item.targets : [];

  const minStart = minTargetAnimationStartTimeForClip(item, itemsMap);
  const invalidStart = minStart != null && item.startTime + 1e-6 < minStart;

  const setTargets = useCallback(
    (next: TargetAnimationTargetSpec[]) => set({ targets: next }),
    [set],
  );

  const addRow = () => {
    const pick =
      targets.find((t) => !targetsList.some((r) => r.targetId === t.id)) ??
      targets[0];
    if (!pick) return;
    setTargets([...targetsList, defaultTargetAnimationRow(item.mode, pick.id)]);
  };

  const removeRow = (index: number) => {
    if (targetsList.length <= 1) return;
    setTargets(targetsList.filter((_, i) => i !== index));
  };

  const patchRow = (index: number, patch: Partial<TargetAnimationTargetSpec>) => {
    setTargets(targetsList.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const onTargetChange = (index: number, newTargetId: string) => {
    const t = itemsMap.get(newTargetId);
    if (!t || !canBeTargetAnimationTarget(t, item.mode)) return;
    const next = targetsList.map((r, i) =>
      i === index
        ? {
            ...defaultTargetAnimationRow(item.mode, newTargetId),
            ...r,
            targetId: newTargetId,
            segmentIndices: null,
            mathSubtargets: null,
          }
        : r,
    );
    const est = effectiveStart(t, itemsMap);
    updateItem(item.id, {
      targets: next,
      startTime: Math.max(item.startTime, est),
    });
  };

  const pruneMathSubtargetsForRow = (
    row: TargetAnimationTargetSpec,
    line: TextLineItem,
    segmentIndices: number[] | null,
  ): { segmentIndex: number; childIndices: number[] }[] | null => {
    const raw = row.mathSubtargets ?? [];
    if (raw.length === 0) return null;
    const n = line.segments.length;
    const allowed = (() => {
      if (!segmentIndices || segmentIndices.length === 0) {
        return new Set(line.segments.map((_, i) => i));
      }
      return new Set(segmentIndices.filter((i) => i >= 0 && i < n));
    })();
    const next = raw.filter((x) => allowed.has(x.segmentIndex));
    return next.length > 0 ? next : null;
  };

  const upsertMathSubtargets = (
    rowIndex: number,
    segmentIndex: number,
    childIndices: number[],
  ) => {
    const row = targetsList[rowIndex];
    if (!row) return;
    const cur = [...(row.mathSubtargets ?? [])].filter(
      (x) => x.segmentIndex !== segmentIndex,
    );
    if (childIndices.length > 0) {
      cur.push({
        segmentIndex,
        childIndices: [...childIndices].sort((a, b) => a - b),
      });
    }
    cur.sort((a, b) => a.segmentIndex - b.segmentIndex);
    patchRow(rowIndex, {
      mathSubtargets: cur.length > 0 ? cur : null,
    });
  };

  const toggleSegment = (rowIndex: number, segIdx: number, line: TextLineItem) => {
    const row = targetsList[rowIndex];
    if (!row) return;
    const cur = row.segmentIndices ?? [];
    const has = cur.includes(segIdx);
    const nextIdx = has ? cur.filter((x) => x !== segIdx) : [...cur, segIdx].sort((a, b) => a - b);
    const n = line.segments.length;
    const valid = nextIdx.filter((i) => i >= 0 && i < n);
    const allSelected = n > 0 && valid.length >= n;
    const seg = !n || allSelected || valid.length === 0 ? null : valid;
    const mathSubtargets = pruneMathSubtargetsForRow(row, line, seg);
    patchRow(rowIndex, { segmentIndices: seg, mathSubtargets });
  };

  const modeHint =
    item.mode === 'scale'
      ? 'Persistent scale multiplier (whole line or selected segments/math subparts).'
      : item.mode === 'color'
        ? 'Permanent color on stroke-capable targets (whole line or segment subset).'
        : item.mode === 'move'
          ? 'Additive shift vs anchor at clip start (RIGHT / UP axes). Does not overwrite posSteps.'
          : item.mode === 'path'
            ? 'Relative path offsets; final vertex is the persistent displacement.'
            : 'Rotation in degrees CCW (Manim).';

  const baseContent = (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Target animation</h3>
      <p className="text-[11px] text-sky-400/95 leading-snug">
        Clip mode: <strong className="text-sky-300">{item.mode}</strong>. {modeHint}
      </p>
      <p className="text-[11px] text-slate-500 leading-snug">
        Effect is kept after the clip ends (preview + export accumulate in timeline order).
        Start time must be at or after each target&apos;s timeline start.
      </p>

      <label className="text-xs text-slate-400 block">
        Label
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Emphasize title"
          className="mt-1 w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>

      <button
        type="button"
        className="self-start text-xs text-red-300 hover:text-red-200 underline"
        onClick={() => removeItem(item.id)}
      >
        Delete target animation clip
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
                {item.mode === 'scale' && (
                  <label className="text-[10px] text-slate-500 w-[100px]">
                    Scale ×
                    <input
                      type="number"
                      step={0.01}
                      min={1.01}
                      max={3}
                      value={
                        row.scaleFactor != null &&
                        Number.isFinite(row.scaleFactor) &&
                        row.scaleFactor >= 1.01
                          ? row.scaleFactor
                          : DEFAULT_BLINK_SCALE_FACTOR
                      }
                      onChange={(e) =>
                        patchRow(index, {
                          scaleFactor: Math.max(1.01, +e.target.value || 1.15),
                        })
                      }
                      className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
                    />
                  </label>
                )}
                {item.mode === 'color' && (
                  <label className="text-[10px] text-slate-500 w-[100px]">
                    New color
                    <input
                      type="color"
                      value={
                        row.color && /^#[0-9a-fA-F]{6}$/.test(row.color)
                          ? row.color
                          : DEFAULT_BLINK_COLOR_HEX
                      }
                      onChange={(e) => patchRow(index, { color: e.target.value })}
                      className="mt-0.5 w-full h-7 bg-slate-800 border border-slate-600 rounded"
                    />
                  </label>
                )}
                {item.mode === 'move' ? (
                  <div className="flex gap-2">
                    <NumberInput
                      label="Δx"
                      value={row.dx ?? 0}
                      onChange={(v) => patchRow(index, { dx: v })}
                      step={0.05}
                    />
                    <NumberInput
                      label="Δy"
                      value={row.dy ?? 0}
                      onChange={(v) => patchRow(index, { dy: v })}
                      step={0.05}
                    />
                  </div>
                ) : null}
                {item.mode === 'rotate' ? (
                  <NumberInput
                    label="Angle (° CCW)"
                    value={
                      typeof row.angleDeg === 'number' && Number.isFinite(row.angleDeg)
                        ? row.angleDeg
                        : 45
                    }
                    onChange={(v) => patchRow(index, { angleDeg: v })}
                    step={1}
                  />
                ) : null}
                {item.mode === 'path' ? (
                  <div className="w-full flex flex-col gap-1">
                    <div className="text-[10px] text-slate-500">
                      Path offsets (Manim RIGHT/UP). Parametric paths are normalized so the
                      object starts at its current position.
                    </div>
                    <label className="text-[10px] text-slate-500 w-[150px]">
                      Path type
                      <select
                        value={row.pathKind ?? 'polyline'}
                        onChange={(e) => {
                          const pathKind =
                            e.target.value === 'parametric'
                              ? 'parametric'
                              : 'polyline';
                          patchRow(index, {
                            pathKind,
                            parametricPath:
                              pathKind === 'parametric'
                                ? (row.parametricPath ?? defaultParametricPath())
                                : row.parametricPath,
                            pathPoints:
                              pathKind === 'polyline'
                                ? (row.pathPoints && row.pathPoints.length > 0
                                    ? row.pathPoints
                                    : [
                                        { x: 0, y: 0 },
                                        { x: 0.5, y: 0 },
                                      ])
                                : row.pathPoints,
                          });
                        }}
                        className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
                      >
                        <option value="polyline">Clicked / polyline</option>
                        <option value="parametric">Parametric x(t), y(t)</option>
                      </select>
                    </label>
                    {(row.pathKind ?? 'polyline') === 'parametric' ? (
                      <div className="w-full rounded border border-slate-700 bg-slate-900/35 p-2 flex flex-col gap-2">
                        <p className="text-[10px] text-slate-500 leading-snug">
                          JavaScript is used for canvas preview; Python/NumPy is used for export.
                          Values are offsets and the first sample is subtracted automatically.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label className="text-[10px] text-slate-500">
                            Preview x(t)
                            <input
                              value={(row.parametricPath ?? defaultParametricPath()).jsXExpr}
                              onChange={(e) =>
                                patchRow(index, {
                                  pathKind: 'parametric',
                                  parametricPath: {
                                    ...(row.parametricPath ?? defaultParametricPath()),
                                    jsXExpr: e.target.value,
                                  },
                                })
                              }
                              className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 font-mono"
                            />
                          </label>
                          <label className="text-[10px] text-slate-500">
                            Preview y(t)
                            <input
                              value={(row.parametricPath ?? defaultParametricPath()).jsYExpr}
                              onChange={(e) =>
                                patchRow(index, {
                                  pathKind: 'parametric',
                                  parametricPath: {
                                    ...(row.parametricPath ?? defaultParametricPath()),
                                    jsYExpr: e.target.value,
                                  },
                                })
                              }
                              className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 font-mono"
                            />
                          </label>
                          <label className="text-[10px] text-slate-500">
                            Export x(t)
                            <input
                              value={(row.parametricPath ?? defaultParametricPath()).pyXExpr}
                              onChange={(e) =>
                                patchRow(index, {
                                  pathKind: 'parametric',
                                  parametricPath: {
                                    ...(row.parametricPath ?? defaultParametricPath()),
                                    pyXExpr: e.target.value,
                                  },
                                })
                              }
                              className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 font-mono"
                            />
                          </label>
                          <label className="text-[10px] text-slate-500">
                            Export y(t)
                            <input
                              value={(row.parametricPath ?? defaultParametricPath()).pyYExpr}
                              onChange={(e) =>
                                patchRow(index, {
                                  pathKind: 'parametric',
                                  parametricPath: {
                                    ...(row.parametricPath ?? defaultParametricPath()),
                                    pyYExpr: e.target.value,
                                  },
                                })
                              }
                              className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 font-mono"
                            />
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <NumberInput
                            label="t min"
                            value={(row.parametricPath ?? defaultParametricPath()).tMin}
                            onChange={(v) =>
                              patchRow(index, {
                                pathKind: 'parametric',
                                parametricPath: {
                                  ...(row.parametricPath ?? defaultParametricPath()),
                                  tMin: v,
                                },
                              })
                            }
                            step={0.1}
                          />
                          <NumberInput
                            label="t max"
                            value={(row.parametricPath ?? defaultParametricPath()).tMax}
                            onChange={(v) =>
                              patchRow(index, {
                                pathKind: 'parametric',
                                parametricPath: {
                                  ...(row.parametricPath ?? defaultParametricPath()),
                                  tMax: v,
                                },
                              })
                            }
                            step={0.1}
                          />
                        </div>
                      </div>
                    ) : null}
                    {(row.pathKind ?? 'polyline') === 'polyline' ? (
                      <>
                    <div className="flex flex-wrap gap-2 items-center">
                      {pathCapture?.clipId === item.id &&
                      pathCapture.rowIndex === index ? (
                        <button
                          type="button"
                          className="text-[10px] text-amber-300 hover:text-amber-200 underline"
                          onClick={() => setPathCapture(null)}
                        >
                          Stop canvas picking
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-[10px] text-sky-400 hover:text-sky-300 underline"
                          onClick={() =>
                            setPathCapture({ clipId: item.id, rowIndex: index })
                          }
                        >
                          Pick points on canvas
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-[10px] text-slate-400 hover:text-slate-300 underline"
                        onClick={() =>
                          patchRow(index, { pathPoints: [{ x: 0, y: 0 }] })
                        }
                      >
                        Reset to origin
                      </button>
                      {pathCapture?.clipId === item.id &&
                      pathCapture.rowIndex === index ? (
                        <span className="text-[10px] text-amber-300/90">
                          Click empty canvas to append path corners.
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-1">
                      {(row.pathPoints && row.pathPoints.length > 0
                        ? row.pathPoints
                        : [
                            { x: 0, y: 0 },
                            { x: 0.5, y: 0 },
                          ]
                      ).map((p, pi, arr) => (
                        <div key={pi} className="flex gap-2 items-end flex-wrap">
                          <span className="text-[9px] text-slate-500 w-14">#{pi}</span>
                          <NumberInput
                            label="x"
                            value={p.x}
                            onChange={(v) => {
                              const base =
                                row.pathPoints && row.pathPoints.length > 0
                                  ? [...row.pathPoints]
                                  : [...arr];
                              const next = base.map((q, qi) =>
                                qi === pi ? { ...q, x: v } : q,
                              );
                              patchRow(index, { pathPoints: next });
                            }}
                            step={0.05}
                          />
                          <NumberInput
                            label="y"
                            value={p.y}
                            onChange={(v) => {
                              const base =
                                row.pathPoints && row.pathPoints.length > 0
                                  ? [...row.pathPoints]
                                  : [...arr];
                              const next = base.map((q, qi) =>
                                qi === pi ? { ...q, y: v } : q,
                              );
                              patchRow(index, { pathPoints: next });
                            }}
                            step={0.05}
                          />
                          {arr.length > 2 ? (
                            <button
                              type="button"
                              className="text-[10px] text-red-400"
                              onClick={() => {
                                const base =
                                  row.pathPoints && row.pathPoints.length > 0
                                    ? [...row.pathPoints]
                                    : [...arr];
                                base.splice(pi, 1);
                                patchRow(index, {
                                  pathPoints:
                                    base.length >= 2
                                      ? base
                                      : [
                                          { x: 0, y: 0 },
                                          { x: 0.5, y: 0 },
                                        ],
                                });
                              }}
                            >
                              ✕
                            </button>
                          ) : null}
                        </div>
                      ))}
                      <button
                        type="button"
                        className="text-[10px] text-sky-400 self-start mt-1"
                        onClick={() => {
                          const base =
                            row.pathPoints && row.pathPoints.length > 0
                              ? [...row.pathPoints]
                              : [
                                  { x: 0, y: 0 },
                                  { x: 0.5, y: 0 },
                                ];
                          const last = base[base.length - 1] ?? { x: 0, y: 0 };
                          patchRow(index, {
                            pathPoints: [...base, { x: last.x + 0.3, y: last.y }],
                          });
                        }}
                      >
                        + Corner
                      </button>
                    </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {targetsList.length > 1 ? (
                  <button
                    type="button"
                    className="text-[10px] text-slate-500 hover:text-red-300 px-1 self-end"
                    onClick={() => removeRow(index)}
                  >
                    Remove
                  </button>
                ) : null}
                {(item.mode === 'scale' || item.mode === 'color') &&
                line &&
                line.segments.length > 0 ? (
                  <div className="w-full">
                    <div className="text-[10px] text-slate-500 mb-1">
                      Text segments (optional subset; empty = whole line). Per-segment indices
                      match export order <code className="text-slate-400">line[i]</code>.
                    </div>
                    {mathSegments.length > 0 ? (
                      <p className="text-[10px] text-slate-500 mb-1 leading-snug">
                        Math segments: use <strong className="text-slate-300">Pick parts</strong>{' '}
                        to target Manim subobjects inside a formula (indices match{' '}
                        <code className="text-slate-400">line[i][j]</code> after measurement).
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-x-2 gap-y-1 items-center">
                      {line.segments.map((seg, si) => {
                        const active =
                          !segIdx?.length || (segIdx?.includes(si) ?? false);
                        return (
                          <div key={si} className="flex items-center gap-0.5">
                            <button
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
                            {seg.isMath ? (
                              <button
                                type="button"
                                className="shrink-0 text-[9px] text-amber-400 hover:text-amber-300 underline"
                                onClick={() => setPicker({ rowIndex: index, segmentIndex: si })}
                              >
                                Pick parts
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        className="text-[10px] text-sky-400 underline"
                        onClick={() => {
                          const trow = targetsList[index];
                          if (!trow || !line) {
                            patchRow(index, { segmentIndices: null });
                            return;
                          }
                          const mathSubtargets = pruneMathSubtargetsForRow(trow, line, null);
                          patchRow(index, { segmentIndices: null, mathSubtargets });
                        }}
                      >
                        All
                      </button>
                    </div>
                  </div>
                ) : null}
                {target && canBeTargetAnimationTarget(target, item.mode) ? (
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
          label="Layer"
          value={item.layer}
          onChange={(v) => set({ layer: Math.round(v) })}
          min={0}
          step={1}
        />
      </div>
    </div>
  );

  const pickerLine: TextLineItem | null = (() => {
    if (!picker) return null;
    const id = item.targets[picker.rowIndex]?.targetId;
    const it = id ? itemsMap.get(id) : undefined;
    return it?.kind === 'textLine' ? it : null;
  })();

  return (
    <>
      <PropertyTabs
        key={item.id}
        defaultTabId="base"
        tabs={[
          { id: 'base', label: 'Base', content: baseContent },
          { id: 'targets', label: 'Targets', content: targetsContent },
          { id: 'animation', label: 'Timing', content: animationContent },
        ]}
      />
      {(item.mode === 'scale' || item.mode === 'color') &&
      picker &&
      pickerLine ? (
        <MathSubobjectPicker
          open
          onClose={() => setPicker(null)}
          measure={pickerLine.measure}
          previewDataUrl={pickerLine.previewDataUrl}
          segmentIndex={picker.segmentIndex}
          mathChildMeasures={pickerLine.mathChildMeasures}
          initialSelected={
            item.targets[picker.rowIndex]?.mathSubtargets?.find(
              (x) => x.segmentIndex === picker.segmentIndex,
            )?.childIndices ?? []
          }
          onApply={(childIndices) =>
            upsertMathSubtargets(picker.rowIndex, picker.segmentIndex, childIndices)
          }
        />
      ) : null}
    </>
  );
}
