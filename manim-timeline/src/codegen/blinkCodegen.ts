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
            ? `${v}.animate.scale(${sf.toFixed(6)})`
            : `${v}.animate.scale(${inv.toFixed(6)})`,
        );
      } else {
        const exprs = textBlinkMobjectExprs(v, target, spec);
        const g =
          exprs.length === 1
            ? exprs[0]!
            : `VGroup(${exprs.join(', ')})`;
        parts.push(
          forward
            ? `${g}.animate.scale(${sf.toFixed(6)})`
            : `${g}.animate.scale(${inv.toFixed(6)})`,
        );
      }
    }
    if (usesColor(mode)) {
      if (n === 0) {
        parts.push(
          forward
            ? `${v}.animate.set_color(${bc})`
            : `${v}.animate.set_color(${manimColor('#ffffff')})`,
        );
      } else {
        for (const p of pieces) {
          const orig = manimColor(segs[p.segmentIndex]?.color ?? '#ffffff');
          if (p.whole) {
            const i = p.segmentIndex;
            parts.push(
              forward
                ? `${v}[${i}].animate.set_color(${bc})`
                : `${v}[${i}].animate.set_color(${orig})`,
            );
          } else {
            for (const c of p.childIndices) {
              const i = p.segmentIndex;
              parts.push(
                forward
                  ? `${v}[${i}][${c}].animate.set_color(${bc})`
                  : `${v}[${i}][${c}].animate.set_color(${orig})`,
              );
            }
          }
        }
      }
    }
    if (parts.length === 0) return null;
    return parts;
  }

  if (target.kind === 'graphDot') {
    return blinkGraphDotParts(target, spec, idToVarName, forward, sf, inv, bc);
  }

  if (target.kind === 'graphField') {
    return blinkGraphFieldParts(target, spec, idToVarName, forward, sf, inv, bc);
  }

  const expr = resolveExitTargetsForExport(target, idToVarName, 'exit');
  if (!expr) return null;
  const restore = blinkRestoreColorExpr(target);
  if (usesScale(mode) && usesColor(mode)) {
    return [
      forward
        ? `${expr}.animate.scale(${sf.toFixed(6)}).set_color(${bc})`
        : `${expr}.animate.scale(${inv.toFixed(6)}).set_color(${restore})`,
    ];
  }
  if (usesScale(mode)) {
    return [
      forward
        ? `${expr}.animate.scale(${sf.toFixed(6)})`
        : `${expr}.animate.scale(${inv.toFixed(6)})`,
    ];
  }
  if (usesColor(mode)) {
    return [
      forward
        ? `${expr}.animate.set_color(${bc})`
        : `${expr}.animate.set_color(${restore})`,
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
        ? `${dVar}.animate.scale(${sf.toFixed(6)}).set_color(${bc})`
        : `${dVar}.animate.scale(${inv.toFixed(6)}).set_color(${dCol})`;
    }
    if (usesScale(mode)) {
      return forward
        ? `${dVar}.animate.scale(${sf.toFixed(6)})`
        : `${dVar}.animate.scale(${inv.toFixed(6)})`;
    }
    if (usesColor(mode)) {
      return forward
        ? `${dVar}.animate.set_color(${bc})`
        : `${dVar}.animate.set_color(${dCol})`;
    }
    return null;
  })();
  if (!animDot) return null;
  if (!lbl) return [animDot];

  const lblRestore = manimColor('#ffffff');
  const animLbl = (() => {
    if (usesScale(mode) && usesColor(mode)) {
      return forward
        ? `${dVar}_lbl.animate.scale(${sf.toFixed(6)}).set_color(${bc})`
        : `${dVar}_lbl.animate.scale(${inv.toFixed(6)}).set_color(${lblRestore})`;
    }
    if (usesScale(mode)) {
      return forward
        ? `${dVar}_lbl.animate.scale(${sf.toFixed(6)})`
        : `${dVar}_lbl.animate.scale(${inv.toFixed(6)})`;
    }
    if (usesColor(mode)) {
      return forward
        ? `${dVar}_lbl.animate.set_color(${bc})`
        : `${dVar}_lbl.animate.set_color(${lblRestore})`;
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
        ? `${vfVar}.animate.scale(${sf.toFixed(6)}).set_color(${bc})`
        : `${vfVar}.animate.scale(${inv.toFixed(6)}).set_color(${rest})`;
    }
    if (usesScale(mode)) {
      return forward
        ? `${vfVar}.animate.scale(${sf.toFixed(6)})`
        : `${vfVar}.animate.scale(${inv.toFixed(6)})`;
    }
    if (usesColor(mode)) {
      return forward
        ? `${vfVar}.animate.set_color(${bc})`
        : `${vfVar}.animate.set_color(${rest})`;
    }
    return null;
  })();
  if (!animVf) return null;
  if (seeds.length === 0) return [animVf];
  const animSt = (() => {
    if (usesScale(mode) && usesColor(mode)) {
      return forward
        ? `${streamsVar}.animate.scale(${sf.toFixed(6)}).set_color(${bc})`
        : `${streamsVar}.animate.scale(${inv.toFixed(6)}).set_color(${rest})`;
    }
    if (usesScale(mode)) {
      return forward
        ? `${streamsVar}.animate.scale(${sf.toFixed(6)})`
        : `${streamsVar}.animate.scale(${inv.toFixed(6)})`;
    }
    if (usesColor(mode)) {
      return forward
        ? `${streamsVar}.animate.set_color(${bc})`
        : `${streamsVar}.animate.set_color(${rest})`;
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
): string[] | null {
  return blinkRowAnimParts(target, spec, idToVarName, itemsMap, true);
}

function buildRowCombinedGroups(clip: BlinkAnimationItem, idToVarName: Map<ItemId, string>, itemsMap: Map<ItemId, SceneItem>): {
  rowGroupsFwd: string[];
  rowGroupsRev: string[];
} | null {
  const rowGroupsFwd: string[] = [];
  const rowGroupsRev: string[] = [];

  for (const row of clip.targets) {
    const tgt = itemsMap.get(row.targetId);
    if (!tgt) continue;
    const fwd = blinkRowAnimParts(tgt, row, idToVarName, itemsMap, true);
    const rev = blinkRowAnimParts(tgt, row, idToVarName, itemsMap, false);
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
  const groups = buildRowCombinedGroups(clip, idToVarName, itemsMap);
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
  const groups = buildRowCombinedGroups(clip, idToVarName, itemsMap);
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
