import { useCallback, useMemo, type ReactNode } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { ItemId, MatrixItem, MatrixStepOp, MatrixStepSpec, SceneItem, TargetAnimationItem } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import { cx } from '@/lib/cx';
import { focusRing } from '@/components/ui';
import { texPreviewText } from '@/lib/texPreviewText';
import { holdEnd } from '@/lib/time';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { matrixMeasureKey, matrixRows } from '@/lib/matrix';
import { parseSegments } from '@/lib/textSegments';
import {
  MATRIX_STEP_OPS,
  computeStepEntries,
  defaultMatrixStepSpec,
  matrixStates,
  stepBasisChanged,
  stepIsManual,
  matrixStepTitle,
  stepLabelTex,
  stepResultEntries,
} from '@/lib/matrixSteps';
import { createExitAnimation, createSegmentStyle, createTextLine } from '@/store/factories';
import PropertyTabs from './PropertyTabs';

const selectClass = 'bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk';
const linkBtn = 'self-start text-ctl text-chalk-dim underline hover:text-chalk disabled:opacity-40';

interface MatrixStepEditorProps {
  item: TargetAnimationItem;
}

/** Clips that act on `matrixId`'s entries while this step plays (they would see the old entries). */
function overlappingClips(clip: TargetAnimationItem, matrixId: ItemId, items: Map<ItemId, SceneItem>): SceneItem[] {
  const a = clip.startTime;
  const b = clip.startTime + clip.duration;
  const out: SceneItem[] = [];
  for (const it of items.values()) {
    if (it.id === clip.id) continue;
    let start: number;
    let end: number;
    if (it.kind === 'target_animation' || it.kind === 'blink_animation') {
      if (!it.targets.some((r) => r.targetId === matrixId)) continue;
      start = it.startTime;
      end = it.startTime + it.duration;
    } else if (it.kind === 'surroundingRect') {
      if (!it.targetIds.includes(matrixId)) continue;
      start = it.startTime;
      end = it.startTime + it.runTime;
    } else continue;
    if (start < b - 1e-6 && end > a + 1e-6) out.push(it);
  }
  return out;
}

/** Read-only grid of entries (plain-text stand-ins for the LaTeX). */
function EntryGrid({ entries, label }: { entries: string[][]; label: string }) {
  const cols = entries[0]?.length ?? 0;
  return (
    <div>
      <div className="mb-1 text-meta text-chalk-faint">{label}</div>
      <div className="grid w-fit gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(2.25rem, auto))` }}>
        {entries.map((r, i) =>
          r.map((tex, j) => (
            <span key={`${i},${j}`} dir="ltr" className="rounded-ctl border border-rule/60 px-1.5 py-0.5 text-center font-serif text-ctl italic text-chalk-dim" title={tex}>
              {texPreviewText(tex) || ' '}
            </span>
          )),
        )}
      </div>
    </div>
  );
}

/**
 * Editor for a matrix step (`target_animation` with `mode: 'matrix_step'`): which matrix, the
 * operation and its rows and factor, the state before and the result (worked out, or typed by
 * hand), and a button that adds the operation as a label beside the matrix.
 */
export default function MatrixStepEditor({ item }: MatrixStepEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const removeItem = useSceneStore((s) => s.removeItem);
  const addItem = useSceneStore((s) => s.addItem);
  const select = useSceneStore((s) => s.select);
  const setMatrixStepMeasure = useSceneStore((s) => s.setMatrixStepMeasure);
  const itemsMap = useSceneStore((s) => s.items);
  const defaults = useSceneStore((s) => s.defaults);

  const set = useCallback((patch: Partial<TargetAnimationItem>) => updateItem(item.id, patch), [item.id, updateItem]);
  const row = item.targets[0];
  const spec: MatrixStepSpec = row?.step ?? defaultMatrixStepSpec();
  const matrix = row ? itemsMap.get(row.targetId) : undefined;
  const matrices = useMemo(() => [...itemsMap.values()].filter((it): it is MatrixItem => it.kind === 'matrix'), [itemsMap]);

  const states = useMemo(() => (matrix?.kind === 'matrix' ? matrixStates(matrix, itemsMap) : []), [matrix, itemsMap]);
  const k = states.findIndex((s) => s.clip?.id === item.id);
  const before = k > 0 ? states[k - 1]!.view : null;
  const after = k > 0 ? states[k]!.view : null;

  const setSpec = (patch: Partial<MatrixStepSpec>) => {
    if (!row) return;
    set({ targets: [{ ...row, step: { ...spec, ...patch } }] });
  };
  const setMatrix = (id: ItemId) => set({ targets: [{ targetId: id, step: { ...spec, entries: null, basis: null } }] });

  const label = stepLabelTex(spec);
  const addLabel = () => {
    if (!label || matrix?.kind !== 'matrix') return;
    const line = createTextLine(defaults, item.startTime);
    const raw = `$${label}$`;
    line.raw = raw;
    line.baseDir = 'ltr';
    line.segments = parseSegments(raw, 'ltr').map((p) => createSegmentStyle(p.text, p.isMath, defaults));
    line.label = 'Row operation';
    line.duration = Math.min(1, Math.max(0.3, item.duration));
    line.fontSize = Math.round(matrix.fontSize * 0.8);
    line.posSteps = [
      { kind: 'next_to', refKind: 'matrix', refId: matrix.id, dir: 'RIGHT', buff: 0.5, alignedEdge: null, refSegmentIndex: null, selfSegmentIndex: null, bounds: null },
    ];
    addItem(line);
    addItem(createExitAnimation([line.id], item.startTime + item.duration, 0.5));
    select(line.id);
  };

  if (!row || matrix?.kind !== 'matrix' || !before || !after) {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-body font-semibold text-chalk">Matrix step</h3>
        <p className="m-0 text-ctl text-warn">This step has no matrix. Choose one:</p>
        <select value="" onChange={(e) => e.target.value && setMatrix(e.target.value)} className={selectClass} aria-label="Matrix">
          <option value="">Choose a matrix…</option>
          {matrices.map((m) => (
            <option key={m.id} value={m.id}>
              {itemClipDisplayName(m)}
            </option>
          ))}
        </select>
        <button type="button" className="self-start text-ctl text-danger underline" onClick={() => removeItem(item.id)}>
          Delete matrix step
        </button>
      </div>
    );
  }

  const rows = matrixRows(before);
  const manual = stepIsManual(spec);
  const result = stepResultEntries(before.entries, spec);
  const rowSelect = (value: number, onChange: (r: number) => void, aria: string, exclude?: number) => (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={selectClass} aria-label={aria}>
      {Array.from({ length: rows }, (_, i) => i)
        .filter((i) => i !== exclude)
        .map((i) => (
          <option key={i} value={i}>
            row {i + 1}
          </option>
        ))}
    </select>
  );
  const factorInput = (
    <input
      type="text"
      dir="ltr"
      spellCheck={false}
      value={spec.factor}
      onChange={(e) => setSpec({ factor: e.target.value })}
      aria-label="Factor"
      placeholder="-2"
      className="w-20 rounded-ctl border border-rule bg-raised px-1.5 py-1 font-mono text-ctl text-chalk"
    />
  );
  // A row that is not there (the matrix shrank) or the same row twice: pick sensible ones.
  const fixRows = (op: MatrixStepOp): Partial<MatrixStepSpec> => {
    const r = Math.min(spec.row, rows - 1);
    const o = spec.otherRow < rows && spec.otherRow !== r ? spec.otherRow : r === 0 ? Math.min(1, rows - 1) : 0;
    return { op, row: Math.max(0, r), otherRow: o, entries: null, basis: null };
  };

  let params: ReactNode = null;
  switch (spec.op) {
    case 'swap_rows':
      params = (
        <div className="flex flex-wrap items-center gap-2 text-ctl text-chalk-dim">
          Swap {rowSelect(spec.row, (r) => setSpec({ row: r }), 'First row')} with {rowSelect(spec.otherRow, (r) => setSpec({ otherRow: r }), 'Second row', spec.row)}
        </div>
      );
      break;
    case 'scale_row':
      params = (
        <div className="flex flex-wrap items-center gap-2 text-ctl text-chalk-dim">
          Multiply {rowSelect(spec.row, (r) => setSpec({ row: r }), 'Row')} by {factorInput}
        </div>
      );
      break;
    case 'add_row':
      params = (
        <div className="flex flex-wrap items-center gap-2 text-ctl text-chalk-dim">
          To {rowSelect(spec.row, (r) => setSpec({ row: r }), 'Row that changes')} add {factorInput} × {rowSelect(spec.otherRow, (r) => setSpec({ otherRow: r }), 'Row added', spec.row)}
        </div>
      );
      break;
    case 'edit':
      params = <p className="m-0 text-meta text-chalk-faint">Type the new entries below; only the ones you change animate.</p>;
      break;
    case 'transpose':
      params = <p className="m-0 text-meta text-chalk-faint">Entry (i, j) moves to (j, i){before.augmentCol != null ? '; the augment bar is dropped' : ''}.</p>;
      break;
  }
  const rowOpInvalid =
    (spec.op === 'swap_rows' || spec.op === 'add_row') && (spec.row === spec.otherRow || spec.otherRow >= rows || spec.row >= rows);
  const factorMissing = (spec.op === 'scale_row' || spec.op === 'add_row') && !spec.factor.trim();

  const setResultEntry = (i: number, j: number, tex: string) => {
    const next = result.map((r, ri) => (ri === i ? r.map((e, ci) => (ci === j ? tex : e)) : [...r]));
    setSpec({ entries: next, basis: before.entries.map((r) => [...r]) });
  };
  const resultCols = result[0]?.length ?? 0;
  const resultView = after;
  const typesetting = resultView.measureKey !== matrixMeasureKey(resultView);
  const overlaps = overlappingClips(item, matrix.id, itemsMap);
  const tooEarly = item.startTime + 1e-6 < holdEnd(matrix, itemsMap);

  const baseContent = (
    <div className="flex flex-col gap-3">
      <h3 className="text-body font-semibold text-chalk">Matrix step</h3>
      <label className="text-ctl text-chalk-dim block">
        Matrix
        <select value={matrix.id} onChange={(e) => setMatrix(e.target.value)} className={cx('mt-1 block w-full max-w-xs', selectClass)}>
          {matrices.map((m) => (
            <option key={m.id} value={m.id}>
              {itemClipDisplayName(m)}
            </option>
          ))}
        </select>
      </label>

      <div>
        <div className="mb-1 text-ctl text-chalk-dim">Operation</div>
        <div role="group" aria-label="Operation" className="flex flex-wrap gap-1">
          {MATRIX_STEP_OPS.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={spec.op === o.id}
              title={o.hint}
              onClick={() => setSpec(fixRows(o.id))}
              className={cx(
                'rounded-ctl border px-2 py-1 text-ctl',
                spec.op === o.id ? 'border-highlight bg-highlight/15 text-chalk' : 'border-rule bg-raised text-chalk-dim hover:text-chalk',
                focusRing,
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="m-0 mt-1 text-meta text-chalk-faint">{MATRIX_STEP_OPS.find((o) => o.id === spec.op)?.hint}</p>
      </div>

      {params}
      {rowOpInvalid ? <p className="m-0 text-meta text-warn">Choose two different rows.</p> : null}
      {factorMissing ? <p className="m-0 text-meta text-warn">Type a factor, e.g. -2 or \frac{'{1}{2}'}.</p> : null}

      <div className="flex flex-wrap items-start gap-4">
        <EntryGrid entries={before.entries} label="Before" />
        <div>
          <div className="mb-1 text-meta text-chalk-faint">After{spec.op === 'transpose' ? '' : ' (you can change entries)'}</div>
          <div className="grid w-fit gap-1" style={{ gridTemplateColumns: `repeat(${resultCols}, minmax(3rem, 6rem))` }}>
            {result.map((r, i) =>
              r.map((tex, j) => (
                <input
                  key={`${i},${j}`}
                  type="text"
                  dir="ltr"
                  spellCheck={false}
                  value={tex}
                  readOnly={spec.op === 'transpose'}
                  aria-label={`Result row ${i + 1}, column ${j + 1}`}
                  onChange={(e) => setResultEntry(i, j, e.target.value)}
                  className={cx(
                    'min-w-0 rounded-ctl border bg-raised px-1.5 py-1 font-mono text-ctl text-chalk',
                    tex.trim() !== (before.entries[i]?.[j] ?? '').trim() && spec.op !== 'transpose' ? 'border-highlight/70' : 'border-rule',
                  )}
                />
              )),
            )}
          </div>
        </div>
      </div>
      {manual && spec.op !== 'edit' ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 text-meta text-chalk-faint">Result typed by hand.</p>
          <button type="button" className={linkBtn} onClick={() => setSpec({ entries: null, basis: null })}>
            Work it out from the operation again
          </button>
        </div>
      ) : null}
      {stepBasisChanged(before.entries, spec) ? (
        <p className="m-0 text-meta text-warn">
          The matrix before this step has changed since this result was typed.
          {spec.op === 'edit' ? null : (
            <>
              {' '}
              <button type="button" className="underline" onClick={() => setSpec({ entries: null, basis: null })}>
                Work it out again
              </button>
            </>
          )}
        </p>
      ) : null}
      {spec.op !== 'edit' && !manual && JSON.stringify(computeStepEntries(before.entries, spec)) === JSON.stringify(before.entries) && spec.op !== 'transpose' ? (
        <p className="m-0 text-meta text-chalk-faint">This step changes nothing yet.</p>
      ) : null}
      {typesetting ? <p className="m-0 text-meta text-chalk-faint">Typesetting the result…</p> : null}
      {resultView.measureError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 text-meta text-danger" dir="auto">
            Typesetting the result failed: {resultView.measureError.split('\n')[0]}
          </p>
          <button type="button" className={linkBtn} onClick={() => setMatrixStepMeasure(item.id, '', null, null)}>
            Try again
          </button>
        </div>
      ) : null}

      {label ? (
        <div className="flex flex-col gap-1">
          <button type="button" className="self-start rounded-ctl bg-raised px-2 py-1 text-ctl text-chalk hover:bg-rule" onClick={addLabel}>
            Add the label “{matrixStepTitle(spec)}” beside the matrix
          </button>
          <p className="m-0 text-meta text-chalk-faint">A text line next to the matrix, written as the step starts and faded out when it ends.</p>
        </div>
      ) : null}

      {overlaps.length ? (
        <p className="m-0 text-meta text-warn">
          {overlaps.map((o) => itemClipDisplayName(o)).join(', ')} {overlaps.length === 1 ? 'plays' : 'play'} while this step changes the matrix.
          Play {overlaps.length === 1 ? 'it' : 'them'} before or after the step: during it they would act on the old entries.
        </p>
      ) : null}
      {tooEarly ? <p className="m-0 text-meta text-warn">The step starts before the matrix has finished appearing.</p> : null}

      <button type="button" className="self-start text-ctl text-danger hover:text-danger underline" onClick={() => removeItem(item.id)}>
        Delete matrix step
      </button>
    </div>
  );

  const timingContent = (
    <div className="flex items-end gap-3 flex-wrap">
      <NumberInput label="Start (s)" value={item.startTime} onChange={(v) => set({ startTime: Math.max(0, v) })} min={0} />
      <NumberInput label="Duration" value={item.duration} onChange={(v) => set({ duration: Math.max(0.05, v) })} min={0.05} />
      <NumberInput label="Layer" value={item.layer} onChange={(v) => set({ layer: Math.round(v) })} min={0} step={1} />
    </div>
  );

  return (
    <PropertyTabs
      key={item.id}
      defaultTabId="base"
      tabs={[
        { id: 'base', label: 'Step', content: baseContent },
        { id: 'timing', label: 'Timing', content: timingContent },
      ]}
    />
  );
}
