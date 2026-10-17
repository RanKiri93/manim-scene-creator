import { useCallback, useRef, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { MatrixAlign, MatrixCell, MatrixIntroStyle, MatrixItem } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import { cx } from '@/lib/cx';
import { focusRing } from '@/components/ui';
import {
  MATRIX_BRACKETS,
  MATRIX_MAX_SIZE,
  cellColorAt,
  matrixCols,
  matrixMeasureKey,
  matrixRows,
  normalizeCells,
  parseMatrixLatex,
  resizeMatrixPatch,
  withCellColors,
} from '@/lib/matrix';
import PositionStepsEditor from './PositionStepsEditor';
import AudioBindingSelect from './AudioBindingSelect';
import PropertyTabs from './PropertyTabs';
import VisibleAtSceneStartRow from './VisibleAtSceneStartRow';
import TargetAnimationEffectsNote from './TargetAnimationEffectsNote';
import MatrixCellPicker from './MatrixCellPicker';

const ALIGNS: { value: MatrixAlign; label: string }[] = [
  { value: 'center', label: 'Centre' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

const INTROS: { value: MatrixIntroStyle; label: string }[] = [
  { value: 'write', label: 'Write (all at once)' },
  { value: 'fade_in', label: 'Fade in' },
  { value: 'rows', label: 'Brackets, then row by row' },
  { value: 'columns', label: 'Brackets, then column by column' },
  { value: 'entries', label: 'Brackets, then entry by entry' },
];

const selectClass = 'mt-1 w-full max-w-xs bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk';

interface MatrixEditorProps {
  item: MatrixItem;
}

export default function MatrixEditor({ item }: MatrixEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const setItemAudioBinding = useSceneStore((s) => s.setItemAudioBinding);
  const removeItem = useSceneStore((s) => s.removeItem);
  const setMatrixMeasure = useSceneStore((s) => s.setMatrixMeasure);
  const set = useCallback((patch: Partial<MatrixItem>) => updateItem(item.id, patch), [item.id, updateItem]);

  const rows = matrixRows(item);
  const cols = matrixCols(item);
  const gridRef = useRef<HTMLDivElement>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [colorCells, setColorCells] = useState<MatrixCell[]>([]);
  const [cellColor, setCellColor] = useState('#fbbf24');

  const setEntry = (i: number, j: number, tex: string) => {
    set({ entries: item.entries.map((r, ri) => (ri === i ? r.map((e, ci) => (ci === j ? tex : e)) : r)) });
  };
  const focusEntry = (i: number, j: number) => {
    gridRef.current?.querySelector<HTMLInputElement>(`input[data-cell="${i},${j}"]`)?.focus();
  };

  const stale = item.measureKey !== matrixMeasureKey(item);
  const status = item.measureError
    ? null
    : stale
      ? 'Typesetting…'
      : item.measure
        ? null
        : 'Not typeset yet (is the measure server running?)';

  const applyPaste = () => {
    const parsed = parseMatrixLatex(paste ?? '');
    if (!parsed) {
      setPasteError(`Not a matrix this can read. Paste a pmatrix / bmatrix / vmatrix (or \\left[\\begin{array}…\\right]), up to ${MATRIX_MAX_SIZE}×${MATRIX_MAX_SIZE}.`);
      return;
    }
    const r = parsed.entries.length;
    const c = parsed.entries[0]!.length;
    set({
      entries: parsed.entries,
      bracket: parsed.bracket,
      augmentCol: parsed.augmentCol,
      cellColors: (item.cellColors ?? []).filter((cc) => cc.row < r && cc.col < c),
    });
    setPaste(null);
    setPasteError(null);
  };

  const baseContent = (
    <div className="flex flex-col gap-3">
      <label className="text-ctl text-chalk-dim block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Coefficient matrix"
          className="mt-1 w-full max-w-md bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk"
        />
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <NumberInput label="Rows" value={rows} onChange={(v) => set(resizeMatrixPatch(item, v, cols))} min={1} max={MATRIX_MAX_SIZE} step={1} />
        <NumberInput label="Columns" value={cols} onChange={(v) => set(resizeMatrixPatch(item, rows, v))} min={1} max={MATRIX_MAX_SIZE} step={1} />
      </div>

      <div>
        <div className="mb-1 text-ctl text-chalk-dim">Brackets</div>
        <div role="group" aria-label="Brackets" className="flex flex-wrap gap-1">
          {MATRIX_BRACKETS.map((b) => (
            <button
              key={b.id}
              type="button"
              aria-pressed={item.bracket === b.id}
              title={b.label}
              onClick={() => set({ bracket: b.id })}
              className={cx(
                'min-w-10 rounded-ctl border px-2 py-1 text-ctl',
                item.bracket === b.id ? 'border-highlight bg-highlight/15 text-chalk' : 'border-rule bg-raised text-chalk-dim hover:text-chalk',
                focusRing,
              )}
            >
              {b.open ? (
                <span className="font-serif">
                  {b.open}&thinsp;·&thinsp;{b.close}
                </span>
              ) : (
                b.label
              )}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-ctl text-chalk-dim">Entries (LaTeX math, no $)</div>
        <div
          ref={gridRef}
          className="grid w-fit gap-1"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(3rem, 6rem))` }}
        >
          {item.entries.map((r, i) =>
            r.map((tex, j) => (
              <input
                key={`${i},${j}`}
                data-cell={`${i},${j}`}
                type="text"
                dir="ltr"
                spellCheck={false}
                value={tex}
                aria-label={`Entry row ${i + 1}, column ${j + 1}`}
                onChange={(e) => setEntry(i, j, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    focusEntry(e.shiftKey ? Math.max(0, i - 1) : Math.min(rows - 1, i + 1), j);
                  }
                }}
                className="min-w-0 rounded-ctl border border-rule bg-raised px-1.5 py-1 font-mono text-ctl text-chalk"
                style={{ borderLeftColor: cellColorAt(item, i, j), borderLeftWidth: 3 }}
              />
            )),
          )}
        </div>
        <p className="m-0 mt-1 text-meta text-chalk-faint">Tab moves along a row, Enter down a column. Leave an entry empty for a blank.</p>
        {status ? <p className="m-0 mt-1 text-meta text-chalk-faint">{status}</p> : null}
        {item.measureError ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="m-0 text-meta text-danger" dir="auto">
              Typesetting failed: {item.measureError.split('\n')[0]}
            </p>
            <button
              type="button"
              className="text-meta text-chalk-dim underline hover:text-chalk"
              onClick={() => setMatrixMeasure(item.id, '', null, null)}
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>

      {paste == null ? (
        <button type="button" className="self-start text-ctl text-chalk-dim underline hover:text-chalk" onClick={() => setPaste('')}>
          Paste a LaTeX matrix…
        </button>
      ) : (
        <div className="flex flex-col gap-1">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={3}
            dir="ltr"
            spellCheck={false}
            autoFocus
            placeholder={'\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}'}
            aria-label="LaTeX matrix to paste"
            className="w-full max-w-md rounded-ctl border border-rule bg-raised px-2 py-1 font-mono text-ctl text-chalk"
          />
          <div className="flex gap-2">
            <button type="button" className="rounded-ctl bg-raised px-2 py-1 text-ctl text-chalk hover:bg-rule" onClick={applyPaste}>
              Use it
            </button>
            <button type="button" className="text-ctl text-chalk-dim hover:text-chalk" onClick={() => { setPaste(null); setPasteError(null); }}>
              Cancel
            </button>
          </div>
          {pasteError ? <p className="m-0 text-meta text-danger">{pasteError}</p> : null}
        </div>
      )}

      <TargetAnimationEffectsNote targetId={item.id} />

      <button type="button" className="self-start text-ctl text-danger hover:text-danger underline" onClick={() => removeItem(item.id)}>
        Delete matrix
      </button>
    </div>
  );

  const styleContent = (
    <div className="flex flex-col gap-3">
      <ColorPicker label="Colour" value={item.color} onChange={(c) => set({ color: c })} />
      <div className="flex flex-wrap items-end gap-3">
        <NumberInput label="Font size" value={item.fontSize} onChange={(v) => set({ fontSize: Math.max(4, v) })} min={4} step={2} />
        <NumberInput label="Row spacing" value={item.rowSpacing} onChange={(v) => set({ rowSpacing: Math.min(4, Math.max(0.5, v)) })} min={0.5} max={4} step={0.1} />
        <NumberInput label="Column spacing" value={item.colSpacing} onChange={(v) => set({ colSpacing: Math.min(8, Math.max(0.2, v)) })} min={0.2} max={8} step={0.1} />
      </div>
      <label className="text-ctl text-chalk-dim block">
        Column alignment
        <select value={item.align} onChange={(e) => set({ align: e.target.value as MatrixAlign })} className={selectClass}>
          {ALIGNS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-ctl text-chalk-dim block">
        Augmented matrix bar
        <select
          value={item.augmentCol ?? 0}
          onChange={(e) => set({ augmentCol: Number(e.target.value) || null })}
          className={selectClass}
          disabled={cols < 2}
        >
          <option value={0}>None</option>
          {Array.from({ length: cols - 1 }, (_, k) => k + 1).map((k) => (
            <option key={k} value={k}>
              After column {k}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1.5">
        <div className="text-ctl text-chalk-dim">Entry colours</div>
        <MatrixCellPicker matrix={item} value={colorCells} onChange={setColorCells} emptyLabel="nothing" />
        <div className="flex flex-wrap items-center gap-2">
          <ColorPicker value={cellColor} onChange={setCellColor} />
          <button
            type="button"
            disabled={colorCells.length === 0}
            className="rounded-ctl bg-raised px-2 py-1 text-ctl text-chalk hover:bg-rule disabled:opacity-40"
            onClick={() => set({ cellColors: withCellColors(item, normalizeCells(colorCells, rows, cols), cellColor) })}
          >
            Colour selected
          </button>
          <button
            type="button"
            disabled={colorCells.length === 0}
            className="text-ctl text-chalk-dim underline hover:text-chalk disabled:opacity-40"
            onClick={() => set({ cellColors: withCellColors(item, normalizeCells(colorCells, rows, cols), null) })}
          >
            Reset selected
          </button>
        </div>
      </div>
    </div>
  );

  const animationContent = (
    <div className="flex flex-col gap-3">
      <label className="text-ctl text-chalk-dim block">
        Appears with
        <select value={item.introStyle} onChange={(e) => set({ introStyle: e.target.value as MatrixIntroStyle })} className={selectClass}>
          {INTROS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <VisibleAtSceneStartRow
        checked={item.visibleAtSceneStart === true}
        note="No intro animation is played for export (shown from the first frame)."
        onChange={(next) => set(next ? { visibleAtSceneStart: true, startTime: 0 } : { visibleAtSceneStart: undefined })}
      />
      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput
          label="Start (s)"
          value={item.startTime}
          onChange={(v) => set({ startTime: Math.max(0, v) })}
          min={0}
          disabled={item.visibleAtSceneStart === true}
        />
        <NumberInput label="Duration" value={item.duration} onChange={(v) => set({ duration: Math.max(0.05, v) })} min={0.05} />
        <NumberInput label="Layer" value={item.layer} onChange={(v) => set({ layer: Math.round(v) })} min={0} step={1} />
      </div>
      <AudioBindingSelect
        value={item.audioTrackId}
        currentItemId={item.id}
        onChange={(audioTrackId) => setItemAudioBinding(item.id, audioTrackId)}
      />
    </div>
  );

  const positionContent = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <NumberInput label="X" value={item.x} onChange={(v) => set({ x: v })} step={0.1} />
        <NumberInput label="Y" value={item.y} onChange={(v) => set({ y: v })} step={0.1} />
        <NumberInput label="Scale" value={item.scale} onChange={(v) => set({ scale: Math.max(0.05, v) })} min={0.05} step={0.05} />
      </div>
      <div>
        <div className="text-ctl text-chalk-dim mb-1">Position steps</div>
        <PositionStepsEditor steps={item.posSteps} onChange={(posSteps) => set({ posSteps })} currentItemId={item.id} />
      </div>
    </div>
  );

  return (
    <PropertyTabs
      key={item.id}
      defaultTabId="base"
      tabs={[
        { id: 'base', label: 'Matrix', content: baseContent },
        { id: 'style', label: 'Style', content: styleContent },
        { id: 'animation', label: 'Animation / Audio', content: animationContent },
        { id: 'position', label: 'Positioning', content: positionContent },
      ]}
    />
  );
}
