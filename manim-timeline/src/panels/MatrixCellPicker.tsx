import { useEffect, useRef, useState } from 'react';
import type { MatrixCell, MatrixItem } from '@/types/scene';
import { cx } from '@/lib/cx';
import { focusRing } from '@/components/ui';
import { texPreviewText } from '@/lib/texPreviewText';
import {
  allCells,
  blockCells,
  cellColorAt,
  cellKey,
  columnCells,
  crossCells,
  describeCells,
  diagonalCells,
  matrixCols,
  matrixRows,
  minorCells,
  normalizeCells,
  rowCells,
} from '@/lib/matrix';

interface MatrixCellPickerProps {
  matrix: MatrixItem;
  value: readonly MatrixCell[];
  onChange: (cells: MatrixCell[]) => void;
  /** What an empty selection means, shown in the summary ("whole matrix" by default). */
  emptyLabel?: string;
}

const pickBtn = cx(
  'rounded-ctl border border-rule bg-raised px-1.5 py-0.5 text-meta text-chalk-dim hover:text-chalk disabled:opacity-40',
  focusRing,
);

/**
 * Choose entries of a matrix: click an entry to toggle it, drag across entries to pick a block,
 * or use the quick picks (row, column, diagonal, minor, row + column) around the last entry
 * clicked.
 */
export default function MatrixCellPicker({ matrix, value, onChange, emptyLabel = 'whole matrix' }: MatrixCellPickerProps) {
  const rows = matrixRows(matrix);
  const cols = matrixCols(matrix);
  const selected = new Set(value.map(cellKey));
  const [focus, setFocus] = useState<MatrixCell>({ row: 0, col: 0 });
  const f = { row: Math.min(focus.row, rows - 1), col: Math.min(focus.col, cols - 1) };
  const drag = useRef<{ start: MatrixCell; moved: boolean; base: MatrixCell[] } | null>(null);

  useEffect(() => {
    const end = () => {
      drag.current = null;
    };
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, []);

  const set = (cells: MatrixCell[]) => onChange(normalizeCells(cells, rows, cols));

  const onDown = (c: MatrixCell) => {
    drag.current = { start: c, moved: false, base: [...value] };
    setFocus(c);
  };
  const onEnter = (c: MatrixCell) => {
    const d = drag.current;
    if (!d) return;
    if (c.row === d.start.row && c.col === d.start.col && !d.moved) return;
    d.moved = true;
    set(blockCells(d.start, c));
  };
  const onUp = (c: MatrixCell) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const k = cellKey(c);
      set(selected.has(k) ? value.filter((v) => cellKey(v) !== k) : [...value, c]);
    }
  };

  const summary = value.length === 0 ? emptyLabel : describeCells(value, rows, cols);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="grid"
        aria-label="Matrix entries"
        className="grid w-fit select-none gap-0.5 rounded-ctl border border-rule bg-ink p-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(1.75rem, auto))` }}
      >
        {matrix.entries.map((r, i) =>
          r.map((tex, j) => {
            const c = { row: i, col: j };
            const on = selected.has(cellKey(c));
            const isFocus = f.row === i && f.col === j;
            return (
              <button
                key={`${i},${j}`}
                type="button"
                role="gridcell"
                aria-selected={on}
                aria-label={`Row ${i + 1}, column ${j + 1}: ${tex || 'empty'}`}
                title={`(${i + 1}, ${j + 1}) ${tex}`}
                onPointerDown={() => onDown(c)}
                onPointerEnter={() => onEnter(c)}
                onPointerUp={() => onUp(c)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    setFocus(c);
                    onUp(c);
                  }
                }}
                className={cx(
                  'h-6 max-w-20 truncate rounded-[3px] px-1 text-meta',
                  on ? 'bg-highlight/30 text-chalk' : 'bg-raised text-chalk-dim hover:text-chalk',
                  isFocus && 'ring-1 ring-chalk-faint',
                  focusRing,
                )}
                style={{ color: on ? undefined : cellColorAt(matrix, i, j) }}
              >
                {texPreviewText(tex) || '·'}
              </button>
            );
          }),
        )}
      </div>
      <div className="flex flex-wrap gap-1" aria-label="Quick picks">
        <button type="button" className={pickBtn} onClick={() => set(rowCells(cols, f.row))} title="Every entry in the row of the last entry clicked">
          Row {f.row + 1}
        </button>
        <button type="button" className={pickBtn} onClick={() => set(columnCells(rows, f.col))} title="Every entry in the column of the last entry clicked">
          Column {f.col + 1}
        </button>
        <button type="button" className={pickBtn} onClick={() => set(diagonalCells(rows, cols))}>
          Diagonal
        </button>
        <button
          type="button"
          className={pickBtn}
          disabled={rows < 2 || cols < 2}
          onClick={() => set(minorCells(rows, cols, f.row, f.col))}
          title="Everything outside the row and column of the last entry clicked"
        >
          Minor M{f.row + 1}{f.col + 1}
        </button>
        <button
          type="button"
          className={pickBtn}
          onClick={() => set(crossCells(rows, cols, f.row, f.col))}
          title="The row and column of the last entry clicked (cross them out to show the minor)"
        >
          Row {f.row + 1} + column {f.col + 1}
        </button>
        <button type="button" className={pickBtn} onClick={() => set(allCells(rows, cols))}>
          All
        </button>
        <button type="button" className={pickBtn} disabled={value.length === 0} onClick={() => set([])}>
          Clear
        </button>
      </div>
      <p className="m-0 text-meta text-chalk-faint">
        Selected: <span className="text-chalk-dim">{summary}</span>. Click entries to toggle, drag to pick a block.
      </p>
    </div>
  );
}
