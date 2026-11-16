import type {
  BlinkAnimationItem,
  BlinkMode,
  BlinkTargetSpec,
  GraphDotItem,
  ItemId,
  SceneItem,
} from '@/types/scene';
import { resolveFunctionSeriesN } from '@/types/scene';
import { functionSeriesIndices } from '@/types/scene';
import { pointSequenceIndices, resolvePointSequenceN } from '@/types/scene';
import {
  manimColor,
  overlayDotVar,
  pythonOverlaySuffix,
  resolveExitTargetsForExport,
} from './graphCodegen';
import {
  resolveTextBlinkPieces,
  textBlinkMobjectExprs,
  textBlinkUsesWholeObjectScale,
} from '@/lib/blinkTextTargets';
import { allCells, matrixCellsFor, matrixCols, matrixRows } from '@/lib/matrix';
import { matrixColorsBefore } from '@/lib/matrixPreview';
import { matrixViewAt } from '@/lib/matrixSteps';
import { matrixCellsExpr, matrixTargetExpr } from './matrixCodegen';

export const DEFAULT_BLINK_SCALE_FACTOR = 1.15;
export const DEFAULT_BLINK_COLOR_HEX = '#fbbf24';

function resolvedScaleFactor(spec: BlinkTargetSpec): number {
  const s = spec.scaleFactor;
  if (typeof s === 'number' && Number.isFinite(s) && s > 1e-6) return s;
  return DEFAULT_BLINK_SCALE_FACTOR;
}

function resolvedBlinkColorExpr(spec: BlinkTargetSpec): string {
  const h =
    typeof spec.blinkColor === 'string' && spec.blinkColor.trim()
      ? spec.blinkColor.trim()
      : DEFAULT_BLINK_COLOR_HEX;
  return manimColor(h);
}

/**
 * `target.animate.chain`, or with `lazy` an `ApplyFunction` that applies the chain when its step
 * starts. Manim's `.animate` writes the end state into `target.target` as soon as the expression is
 * evaluated, so several `.animate` steps on one mobject built inside one `Succession` (a blink in a
 * concurrent cluster: colour on, colour off, …) all end at the LAST state and the blink is
 * invisible; `ApplyFunction` builds each end state from the mobject as it is then.
 */
function animateExpr(target: string, chain: string, lazy: boolean): string {
  return lazy ? `ApplyFunction(lambda m: m.${chain}, ${target})` : `${target}.animate.${chain}`;
}

function usesScale(mode: BlinkMode): boolean {
  return mode === 'scale';
}

function usesColor(mode: BlinkMode): boolean {
  return mode === 'color';
}

/**
 * Build comma-separated animation args for one target row (forward or reverse half).
 */
function blinkRowAnimParts(
  target: SceneItem,
  spec: BlinkTargetSpec,
  idToVarName: Map<ItemId, string>,
  _itemsMap: Map<ItemId, SceneItem>,
  forward: boolean,
  /**
   * Clip start: a matrix's entries are those of its state then (after any matrix steps), and it
   * restores the colours its colour clips set before this.
   */
  atTime = Number.POSITIVE_INFINITY,
  /** Steps run inside one `Succession` (concurrent cluster): see {@link animateExpr}. */
  lazy = false,
): string[] | null {
  const mode = spec.mode;
  const sf = resolvedScaleFactor(spec);
  const inv = 1 / sf;
  const bc = resolvedBlinkColorExpr(spec);

  if (target.kind === 'textLine') {
    const v = idToVarName.get(target.id);
    if (!v) return null;
    const n = target.segments.length;
    const segs = target.segments;
    const pieces = resolveTextBlinkPieces(target, spec);
    const wholeScale = textBlinkUsesWholeObjectScale(target, spec);

    const parts: string[] = [];
    if (usesScale(mode)) {
      if (wholeScale || n === 0) {
        parts.push(
          forward
            ? animateExpr(`${v}`, `scale(${sf.toFixed(6)})`, lazy)
            : animateExpr(`${v}`, `scale(${inv.toFixed(6)})`, lazy),
        );
      } else {
        const exprs = textBlinkMobjectExprs(v, target, spec);
        const g =
          exprs.length === 1
            ? exprs[0]!
            : `VGroup(${exprs.join(', ')})`;
        parts.push(
          forward
            ? animateExpr(`${g}`, `scale(${sf.toFixed(6)})`, lazy)
            : animateExpr(`${g}`, `scale(${inv.toFixed(6)})`, lazy),
        );
      }
    }
    if (usesColor(mode)) {
      if (n === 0) {
        parts.push(
          forward
            ? animateExpr(`${v}`, `set_color(${bc})`, lazy)
            : animateExpr(`${v}`, `set_color(${manimColor('#ffffff')})`, lazy),
        );
      } else {
        for (const p of pieces) {
          const orig = manimColor(segs[p.segmentIndex]?.color ?? '#ffffff');
          if (p.whole) {
            const i = p.segmentIndex;
            parts.push(
              forward
                ? animateExpr(`${v}[${i}]`, `set_color(${bc})`, lazy)
                : animateExpr(`${v}[${i}]`, `set_color(${orig})`, lazy),
            );
          } else {
            for (const c of p.childIndices) {
              const i = p.segmentIndex;
              parts.push(
                forward
                  ? animateExpr(`${v}[${i}][${c}]`, `set_color(${bc})`, lazy)
                  : animateExpr(`${v}[${i}][${c}]`, `set_color(${orig})`, lazy),
              );
            }
          }
        }
      }
    }
    if (parts.length === 0) return null;
    return parts;
  }

  if (target.kind === 'matrix') {
    const v = idToVarName.get(target.id);
    if (!v) return null;
    const view = matrixViewAt(target, _itemsMap, atTime);
    const sel = matrixCellsFor(view, spec.cells);
    const g = matrixTargetExpr(view, v, sel);
    const parts: string[] = [];
    if (usesScale(mode)) {
      parts.push(animateExpr(`${g}`, `scale(${(forward ? sf : inv).toFixed(6)})`, lazy));
    }
    if (usesColor(mode)) {
      if (forward) {
        parts.push(animateExpr(`${g}`, `set_color(${bc})`, lazy));
      } else {
        // Back to each entry's colour when the blink started (grouped by colour), brackets / bar likewise.
        const before = matrixColorsBefore(target, atTime, _itemsMap);
        const byColor = new Map<string, typeof sel>();
        for (const c of sel.length ? sel : allCells(matrixRows(view), matrixCols(view))) {
          const col = before.cell(c.row, c.col);
          byColor.set(col, [...(byColor.get(col) ?? []), c]);
        }
        for (const [col, cells] of byColor) parts.push(animateExpr(`${matrixCellsExpr(v, cells)}`, `set_color(${manimColor(col)})`, lazy));
        if (!sel.length) parts.push(animateExpr(`VGroup(${v}.get_brackets(), ${v}.get_bar())`, `set_color(${manimColor(before.frame)})`, lazy));
      }
    }
    return parts.length ? parts : null;
  }

  if (target.kind === 'graphDot') {
    return blinkGraphDotParts(target, spec, idToVarName, forward, sf, inv, bc, lazy);
  }

  if (target.kind === 'graphField') {
    return blinkGraphFieldParts(target, spec, idToVarName, forward, sf, inv, bc, lazy);
  }

  if (target.kind === 'image' && usesColor(mode)) {
    return null;
  }

  const expr = resolveExitTargetsForExport(target, idToVarName, 'exit');
  if (!expr) return null;
  const restore = blinkRestoreColorExpr(target);
  if (usesScale(mode) && usesColor(mode)) {
    return [
      forward
        ? animateExpr(`${expr}`, `scale(${sf.toFixed(6)}).set_color(${bc})`, lazy)
        : animateExpr(`${expr}`, `scale(${inv.toFixed(6)}).set_color(${restore})`, lazy),
    ];
  }
  if (usesScale(mode)) {
    return [
      forward
        ? animateExpr(`${expr}`, `scale(${sf.toFixed(6)})`, lazy)
        : animateExpr(`${expr}`, `scale(${inv.toFixed(6)})`, lazy),
    ];
  }
  if (usesColor(mode)) {
    return [
      forward
        ? animateExpr(`${expr}`, `set_color(${bc})`, lazy)
        : animateExpr(`${expr}`, `set_color(${restore})`, lazy),
    ];
  }
  return null;
}

function blinkGraphDotParts(
  item: GraphDotItem,
  spec: BlinkTargetSpec,
  idToVarName: Map<ItemId, string>,
  forward: boolean,
  sf: number,
  inv: number,
  bc: string,
  lazy: boolean,
): string[] | null {
  const mode = spec.mode;
  const axVar = idToVarName.get(item.axesId);
  if (!axVar) return null;
  const dVar = overlayDotVar(axVar, item.id);
  const lbl = item.dot.label.trim();
  const dCol = manimColor(item.dot.color);

  const animDot = (() => {
    if (usesScale(mode) && usesColor(mode)) {
      return forward
        ? animateExpr(`${dVar}`, `scale(${sf.toFixed(6)}).set_color(${bc})`, lazy)
        : animateExpr(`${dVar}`, `scale(${inv.toFixed(6)}).set_color(${dCol})`, lazy);
    }
    if (usesScale(mode)) {
      return forward
        ? animateExpr(`${dVar}`, `scale(${sf.toFixed(6)})`, lazy)
        : animateExpr(`${dVar}`, `scale(${inv.toFixed(6)})`, lazy);
    }
    if (usesColor(mode)) {
      return forward
        ? animateExpr(`${dVar}`, `set_color(${bc})`, lazy)
        : animateExpr(`${dVar}`, `set_color(${dCol})`, lazy);
    }
    return null;
  })();
  if (!animDot) return null;
  if (!lbl) return [animDot];

  const lblRestore = manimColor('#ffffff');
  const animLbl = (() => {
    if (usesScale(mode) && usesColor(mode)) {
      return forward
        ? animateExpr(`${dVar}_lbl`, `scale(${sf.toFixed(6)}).set_color(${bc})`, lazy)
        : animateExpr(`${dVar}_lbl`, `scale(${inv.toFixed(6)}).set_color(${lblRestore})`, lazy);
    }
    if (usesScale(mode)) {
      return forward
        ? animateExpr(`${dVar}_lbl`, `scale(${sf.toFixed(6)})`, lazy)
        : animateExpr(`${dVar}_lbl`, `scale(${inv.toFixed(6)})`, lazy);
    }
    if (usesColor(mode)) {
      return forward
        ? animateExpr(`${dVar}_lbl`, `set_color(${bc})`, lazy)
        : animateExpr(`${dVar}_lbl`, `set_color(${lblRestore})`, lazy);
    }
    return null;
  })();
  if (!animLbl) return [animDot];
  return [`AnimationGroup(${animDot}, ${animLbl}, lag_ratio=0)`];
}

function blinkGraphFieldParts(
  target: Extract<SceneItem, { kind: 'graphField' }>,
  spec: BlinkTargetSpec,
  idToVarName: Map<ItemId, string>,
  forward: boolean,
  sf: number,
  inv: number,
  bc: string,
  lazy: boolean,
): string[] | null {
  if (target.fieldMode === 'none') return null;
  const mode = spec.mode;
  const axVar = idToVarName.get(target.axesId);
  if (!axVar) return null;
  const suf = pythonOverlaySuffix(target.id);
  const vfVar = `${axVar}_vf_${suf}`;
  const seeds = target.streamPoints ?? [];
  const streamsVar = `${axVar}_streams_${suf}`;
  const rest = manimColor('#ffffff');

  const animVf = (() => {
    if (usesScale(mode) && usesColor(mode)) {
      return forward
        ? animateExpr(`${vfVar}`, `scale(${sf.toFixed(6)}).set_color(${bc})`, lazy)
        : animateExpr(`${vfVar}`, `scale(${inv.toFixed(6)}).set_color(${rest})`, lazy);
    }
    if (usesScale(mode)) {
      return forward
        ? animateExpr(`${vfVar}`, `scale(${sf.toFixed(6)})`, lazy)
        : animateExpr(`${vfVar}`, `scale(${inv.toFixed(6)})`, lazy);
    }
    if (usesColor(mode)) {
      return forward
        ? animateExpr(`${vfVar}`, `set_color(${bc})`, lazy)
        : animateExpr(`${vfVar}`, `set_color(${rest})`, lazy);
    }
    return null;
  })();
  if (!animVf) return null;
  if (seeds.length === 0) return [animVf];
  const animSt = (() => {
    if (usesScale(mode) && usesColor(mode)) {
      return forward
        ? animateExpr(`${streamsVar}`, `scale(${sf.toFixed(6)}).set_color(${bc})`, lazy)
        : animateExpr(`${streamsVar}`, `scale(${inv.toFixed(6)}).set_color(${rest})`, lazy);
    }
    if (usesScale(mode)) {
      return forward
        ? animateExpr(`${streamsVar}`, `scale(${sf.toFixed(6)})`, lazy)
        : animateExpr(`${streamsVar}`, `scale(${inv.toFixed(6)})`, lazy);
    }
    if (usesColor(mode)) {
      return forward
        ? animateExpr(`${streamsVar}`, `set_color(${bc})`, lazy)
        : animateExpr(`${streamsVar}`, `set_color(${rest})`, lazy);
    }
    return null;
  })();
  if (!animSt) return [animVf];
  return [`AnimationGroup(${animVf}, ${animSt}, lag_ratio=0)`];
}

function blinkRestoreColorExpr(target: SceneItem): string {
  switch (target.kind) {
    case 'shape':
      return manimColor(target.strokeColor);
    case 'axes': {
      const c = target.axisColor?.trim();
      return c ? manimColor(c) : manimColor('#ffffff');
    }
    case 'graphPlot':
      return manimColor(target.fn.color);
    case 'graphCurve':
      return manimColor(target.curve.color);
    case 'graphArea': {
      if (target.strokeWidth > 1e-9) {
        return manimColor(target.strokeColor);
      }
      return manimColor(target.fillColor);
    }
    case 'graphFunctionSeries': {
      const list = functionSeriesIndices(target);
      const last = list[list.length - 1];
      const n =
        last != null
          ? last
          : Math.max(0, Math.trunc(target.nMin));
      const r = resolveFunctionSeriesN(target, n);
      return manimColor(r.color);
    }
    case 'graphPointSequence': {
      const list = pointSequenceIndices(target);
      const last = list[list.length - 1];
      const n =
        last != null
          ? last
          : Math.max(0, Math.trunc(target.nMin));
      const r = resolvePointSequenceN(target, n);
      return manimColor(r.color);
    }
    case 'graphField':
      return manimColor('#ffffff');
    case 'surroundingRect':
      return manimColor(target.color);
    default:
      return manimColor('#ffffff');
  }
}

export function blinkClipHasActiveTargets(clip: BlinkAnimationItem): boolean {
  return clip.targets.length > 0;
}

/** Forward-only blink-style scale/color parts (permanent target animations; no reverse half). */
export function permanentBlinkStyleParts(
  target: SceneItem,
  spec: BlinkTargetSpec,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
  /** Clip start (a matrix's entries are those of its state then). */
  atTime = Number.POSITIVE_INFINITY,
): string[] | null {
  return blinkRowAnimParts(target, spec, idToVarName, itemsMap, true, atTime);
}

function buildRowCombinedGroups(clip: BlinkAnimationItem, idToVarName: Map<ItemId, string>, itemsMap: Map<ItemId, SceneItem>, lazy: boolean): {
  rowGroupsFwd: string[];
  rowGroupsRev: string[];
} | null {
  const rowGroupsFwd: string[] = [];
  const rowGroupsRev: string[] = [];

  for (const row of clip.targets) {
    const tgt = itemsMap.get(row.targetId);
    if (!tgt) continue;
    const fwd = blinkRowAnimParts(tgt, row, idToVarName, itemsMap, true, clip.startTime, lazy);
    const rev = blinkRowAnimParts(tgt, row, idToVarName, itemsMap, false, clip.startTime, lazy);
    if (!fwd?.length || !rev?.length) continue;
    const fInner = fwd.join(', ');
    const rInner = rev.join(', ');
    rowGroupsFwd.push(
      fwd.length === 1 ? fwd[0]! : `AnimationGroup(${fInner}, lag_ratio=0)`,
    );
    rowGroupsRev.push(
      rev.length === 1 ? rev[0]! : `AnimationGroup(${rInner}, lag_ratio=0)`,
    );
  }
  if (rowGroupsFwd.length === 0) return null;
  return { rowGroupsFwd, rowGroupsRev };
}

/**
 * Comma-separated Succession children for concurrent cluster (forward/reverse halves).
 * No leading `Succession(…)` wrapper — caller supplies `Wait(rel)` and final `run_time`.
 */
export function buildBlinkConcurrentSuccessionInner(
  clip: BlinkAnimationItem,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
): string | null {
  // All steps sit in one Succession built up front: they must read the mobject when they start.
  const groups = buildRowCombinedGroups(clip, idToVarName, itemsMap, true);
  if (!groups) return null;
  const { rowGroupsFwd, rowGroupsRev } = groups;
  const reps = Math.max(1, Math.round(clip.repetitions) || 1);
  const steps: string[] = [];
  for (let r = 0; r < reps; r++) {
    const f =
      rowGroupsFwd.length === 1
        ? rowGroupsFwd[0]!
        : `AnimationGroup(${rowGroupsFwd.join(', ')}, lag_ratio=0)`;
    const b =
      rowGroupsRev.length === 1
        ? rowGroupsRev[0]!
        : `AnimationGroup(${rowGroupsRev.join(', ')}, lag_ratio=0)`;
    steps.push(f, b);
  }
  return steps.join(', ');
}

export function formatBlinkClipPlay(
  clip: BlinkAnimationItem,
  pad: string,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
): string {
  // One self.play per step: `.animate` is built just before it plays.
  const groups = buildRowCombinedGroups(clip, idToVarName, itemsMap, false);
  if (!groups) return '';

  const reps = Math.max(1, Math.round(clip.repetitions) || 1);
  const total = Math.max(0.05, clip.duration);
  const half = total / (2 * reps);
  const halfStr = Math.max(0.01, half).toFixed(4);

  const { rowGroupsFwd, rowGroupsRev } = groups;
  let s = '';
  for (let r = 0; r < reps; r++) {
    const f =
      rowGroupsFwd.length === 1
        ? rowGroupsFwd[0]!
        : `AnimationGroup(${rowGroupsFwd.join(', ')}, lag_ratio=0)`;
    const b =
      rowGroupsRev.length === 1
        ? rowGroupsRev[0]!
        : `AnimationGroup(${rowGroupsRev.join(', ')}, lag_ratio=0)`;
    s += `${pad}self.play(${f}, run_time=${halfStr})\n`;
    s += `${pad}self.play(${b}, run_time=${halfStr})\n`;
  }
  return s;
}
