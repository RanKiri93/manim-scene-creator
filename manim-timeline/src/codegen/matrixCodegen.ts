import type { AudioTrackItem, ItemId, MatrixCell, MatrixItem, SceneItem, TargetAnimationItem } from '@/types/scene';
import { pySoundCall } from './audioClipCodegen';
import { matrixCellsFor, matrixEntryColors, matrixRows } from '@/lib/matrix';
import { MATRIX_INTRO_LAG, matrixHasFrame } from '@/lib/matrixPreview';
import { isMatrixStepClip, matrixStates, stepPythonKwargs } from '@/lib/matrixSteps';
import { emitNextToPython } from './nextToCodegen';
import { pythonStringLiteral } from './texUtils';
import { manimColor } from './graphCodegen';
import {
  type BoundAudioTailOpts,
  appendAudioTailAfterLeafPlayback,
  boundSoundEmittedAtTrackStart,
  resolveRecordedPlayback,
} from './lineCodegen';

/**
 * Matrices export as `HebrewMatrix` (hebrew_matrix.py): one LaTeX compile split into entries,
 * brackets and the augment bar, so entries can be addressed with `get_entry(i, j)` / `cells(...)`.
 */

export function anyMatrix(items: Iterable<SceneItem>): boolean {
  for (const it of items) if (it.kind === 'matrix') return true;
  return false;
}

export function anyMatrixStep(items: Iterable<SceneItem>): boolean {
  for (const it of items) if (isMatrixStepClip(it)) return true;
  return false;
}

function entriesLiteral(entries: readonly (readonly string[])[]): string {
  return `[${entries.map((r) => `[${r.map(pythonStringLiteral).join(', ')}]`).join(', ')}]`;
}

function num(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

export function generateMatrixDef(item: MatrixItem, varName: string, indent: number): string {
  const pad = ' '.repeat(indent);
  const args = [entriesLiteral(item.entries), `bracket="${item.bracket}"`];
  if (item.align !== 'center') args.push(`align="${item.align}"`);
  const cols = item.entries[0]?.length ?? 0;
  if (item.augmentCol != null && item.augmentCol > 0 && item.augmentCol < cols) args.push(`augment_col=${item.augmentCol}`);
  const rs = num(item.rowSpacing, 1);
  const cs = num(item.colSpacing, 1);
  if (Math.abs(rs - 1) > 1e-9) args.push(`row_spacing=${rs.toFixed(4)}`);
  if (Math.abs(cs - 1) > 1e-9) args.push(`col_spacing=${cs.toFixed(4)}`);
  args.push(`font_size=${num(item.fontSize, 36)}`);
  args.push(`color=${manimColor(item.color)}`);
  const own = matrixEntryColors(item);
  if (own) {
    args.push(`entry_colors=[${own.map((r) => `[${r.map((c) => (c ? manimColor(c) : 'None')).join(', ')}]`).join(', ')}]`);
  }
  return `${pad}${varName} = HebrewMatrix(${args.join(', ')})\n`;
}

export function generateMatrixPos(
  item: MatrixItem,
  varName: string,
  indent: number,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  const scale = Number.isFinite(item.scale) ? item.scale : 1;
  if (Math.abs(scale - 1) > 1e-6) lines.push(`${pad}${varName}.scale(${scale.toFixed(6)})`);
  let placed = false;
  item.posSteps.forEach((step, si) => {
    switch (step.kind) {
      case 'absolute':
        lines.push(`${pad}${varName}.move_to([${item.x.toFixed(6)}, ${item.y.toFixed(6)}, 0])`);
        placed = true;
        break;
      case 'next_to': {
        const refVar = step.refId ? idToVarName.get(step.refId) : undefined;
        const refItem = step.refId ? itemsMap.get(step.refId) : undefined;
        if (!refVar || !refItem) break;
        lines.push(emitNextToPython({ varName, step, refVar, item, refItem, itemsMap, stepIndex: si, indent: pad }));
        placed = true;
        break;
      }
      case 'to_edge':
        lines.push(`${pad}${varName}.to_edge(${step.edge}, buff=${Number.isFinite(step.buff) ? step.buff : 0.3})`);
        placed = true;
        break;
      case 'shift':
        lines.push(`${pad}${varName}.shift(${step.dx}*RIGHT + ${step.dy}*UP)`);
        placed = true;
        break;
      case 'set_x':
        lines.push(`${pad}${varName}.set_x(${step.x.toFixed(6)})`);
        placed = true;
        break;
      case 'set_y':
        lines.push(`${pad}${varName}.set_y(${step.y.toFixed(6)})`);
        placed = true;
        break;
    }
  });
  if (!placed) lines.push(`${pad}${varName}.move_to([${item.x.toFixed(6)}, ${item.y.toFixed(6)}, 0])`);
  return lines.join('\n') + '\n';
}

/** `m.cells((0, 1), (1, 1))` — the given entries (empty ones are left out by `HebrewMatrix`). */
export function matrixCellsExpr(varName: string, cells: readonly MatrixCell[]): string {
  return `${varName}.cells(${cells.map((c) => `(${c.row}, ${c.col})`).join(', ')})`;
}

/** Python for the selected entries of `item`, or the whole matrix when `cells` is empty. */
export function matrixTargetExpr(item: MatrixItem, varName: string, cells: readonly MatrixCell[] | null | undefined): string {
  const sel = matrixCellsFor(item, cells);
  return sel.length ? matrixCellsExpr(varName, sel) : varName;
}

/**
 * `MatrixStep(matrix, entries, ...)` for a matrix step clip (with its run time), or null when the
 * clip is not a step of `matrix`. The step turns the matrix object itself into the next state, so
 * later clips keep using the same variable.
 */
export function matrixStepAnimExpr(
  clip: TargetAnimationItem,
  matrix: MatrixItem,
  varName: string,
  itemsMap: Map<ItemId, SceneItem>,
): string | null {
  const states = matrixStates(matrix, itemsMap);
  const k = states.findIndex((s) => s.clip?.id === clip.id);
  if (k <= 0) return null;
  const spec = states[k]!.spec!;
  const kwargs = stepPythonKwargs(spec, matrixRows(states[k - 1]!.view));
  const rt = Math.max(0.05, clip.duration).toFixed(6);
  return `MatrixStep(${varName}, ${entriesLiteral(states[k]!.view.entries)}${kwargs}, run_time=${rt})`;
}

/**
 * Intro animation (without run time). Row / column / entry intros fade the brackets and bar in,
 * then write each group in a `LaggedStart` whose parts all last 1 so Manim spreads them evenly
 * over the clip (the canvas preview uses the same lag, `MATRIX_INTRO_LAG`).
 */
export function matrixIntroAnimExpr(item: MatrixItem, varName: string): string {
  const v = varName;
  if (item.introStyle === 'fade_in') return `FadeIn(${v})`;
  if (item.introStyle === 'write') return `Write(${v})`;
  // Nothing to stagger: a LaggedStart with no parts is an error in Manim.
  if (!matrixHasFrame(item) && item.entries.every((r) => r.every((e) => !e.trim()))) return `FadeIn(${v})`;
  const groups =
    item.introStyle === 'rows'
      ? `[Write(g, run_time=1) for g in ${v}.get_rows() if g.submobjects]`
      : item.introStyle === 'columns'
        ? `[Write(g, run_time=1) for g in ${v}.get_columns() if g.submobjects]`
        : `[Write(g, run_time=1) for g in ${v}.get_entries()]`;
  const frame = matrixHasFrame(item) ? `FadeIn(VGroup(${v}.get_brackets(), ${v}.get_bar()), run_time=1), ` : '';
  return `LaggedStart(${frame}*${groups}, lag_ratio=${MATRIX_INTRO_LAG})`;
}

export function generateMatrixPlay(
  item: MatrixItem,
  varName: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
  tailOpts?: BoundAudioTailOpts,
): string {
  const pad = ' '.repeat(indent);
  if (item.visibleAtSceneStart) return '';
  const intro = matrixIntroAnimExpr(item, varName);
  const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
  if (recorded) {
    const soundEarly = audioItems?.length && boundSoundEmittedAtTrackStart(item, itemsMap, audioItems);
    return (
      (soundEarly ? '' : `${pad}${pySoundCall(recorded.track)}\n`) +
      `${pad}self.play(${intro}, run_time=${recorded.runTime.toFixed(6)})\n` +
      appendAudioTailAfterLeafPlayback(pad, recorded, item, itemsMap, audioItems, tailOpts)
    );
  }
  return `${pad}self.play(${intro}, run_time=${Math.max(0.05, item.duration).toFixed(6)})\n`;
}
