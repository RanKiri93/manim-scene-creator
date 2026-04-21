import type {
  AudioTrackItem,
  FunctionLineStyle,
  GraphFunctionSeriesItem,
  ItemId,
  SceneItem,
} from '@/types/scene';
import {
  functionSeriesIndices,
  resolveFunctionSeriesDisplayMode,
  resolveFunctionSeriesN,
} from '@/types/scene';
import {
  manimColor,
  pythonOverlaySuffix,
} from './graphCodegen';
import {
  type BoundAudioTailOpts,
  appendAudioTailAfterLeafPlayback,
  boundSoundEmittedAtTrackStart,
  resolveRecordedPlayback,
} from './lineCodegen';

/** Python identifier for the VMobject for curve f_n of a function series. */
export function functionSeriesCurveVar(
  axVar: string,
  itemId: ItemId,
  n: number,
): string {
  const suf = pythonOverlaySuffix(itemId);
  const ns = n < 0 ? `m${Math.abs(n)}` : String(n);
  return `${axVar}_fs_${suf}_n${ns}`;
}

/** Python function name that builds a single curve for integer n. */
export function functionSeriesBuilderVar(
  axVar: string,
  itemId: ItemId,
): string {
  const suf = pythonOverlaySuffix(itemId);
  return `${axVar}_fs_${suf}_build`;
}

function fsPyExpr(expr: string): string {
  const t = (expr ?? '').trim() || '0';
  return t.replace(/\n/g, ' ');
}

/**
 * Stroke + DashedVMobject wrapping for a line style. Returns Python suitable as
 * the right-hand side of an assignment (e.g. `v = <expr>`) given the raw curve.
 *
 * Manim's `DashedVMobject(curve, num_dashes=N, dashed_ratio=r)` draws dashed
 * copies; we reuse it for dotted with a tighter ratio.
 */
function wrapLineStyleExpr(
  rawVar: string,
  style: FunctionLineStyle,
): string {
  switch (style) {
    case 'dashed':
      return `DashedVMobject(${rawVar}, num_dashes=32, dashed_ratio=0.55)`;
    case 'dotted':
      return `DashedVMobject(${rawVar}, num_dashes=96, dashed_ratio=0.25)`;
    default:
      return rawVar;
  }
}

/**
 * Definition block: a helper to build curve `f(n, x)` plus one VMobject per
 * active `n` in the series. Must be emitted *after* `generateAxesPos` for the
 * referenced axes, since `Axes.plot(...)` samples `coords_to_point` immediately.
 */
export function generateGraphFunctionSeriesDef(
  item: GraphFunctionSeriesItem,
  axVar: string,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 4);
  const suf = pythonOverlaySuffix(item.id);
  const py = fsPyExpr(item.pyExpr);
  const builder = functionSeriesBuilderVar(axVar, item.id);
  const displayMode = resolveFunctionSeriesDisplayMode(item);
  const termFn = `${axVar}_fs_${suf}_term`;
  const sumFn = `${axVar}_fs_${suf}_S`;
  const nMin = Math.trunc(item.nMin);

  let s = '';
  // Term helper shared by both display modes (keeps the Python lambda below terse).
  s += `${pad}def ${termFn}(n, x):\n`;
  s += `${inner}return (${py})\n`;
  if (displayMode === 'partialSum') {
    // S_k(x) = sum_{n=nMin}^{k} f(n, x). NaN / Infinity from any term short-circuits.
    s += `${pad}def ${sumFn}(k, x):\n`;
    s += `${inner}_total = 0.0\n`;
    s += `${inner}for _n in range(${nMin}, int(k) + 1):\n`;
    s += `${inner}    _total = _total + ${termFn}(_n, x)\n`;
    s += `${inner}return _total\n`;
  }

  s += `${pad}def ${builder}(n, color, stroke_w, line_style):\n`;
  if (displayMode === 'partialSum') {
    s += `${inner}_raw = ${axVar}.plot(lambda x, k=n: ${sumFn}(k, x), color=color`;
  } else {
    s += `${inner}_raw = ${axVar}.plot(lambda x, n=n: ${termFn}(n, x), color=color`;
  }
  if (item.xDomain != null) {
    const lo = Math.min(item.xDomain[0], item.xDomain[1]);
    const hi = Math.max(item.xDomain[0], item.xDomain[1]);
    s += `, x_range=[${lo}, ${hi}]`;
  }
  s += `)\n`;
  s += `${inner}_raw.set_stroke(width=stroke_w, color=color)\n`;
  s += `${inner}if line_style == "dashed":\n`;
  s += `${inner}    _m = DashedVMobject(_raw, num_dashes=32, dashed_ratio=0.55)\n`;
  s += `${inner}    _m.set_stroke(width=stroke_w, color=color)\n`;
  s += `${inner}    return _m\n`;
  s += `${inner}if line_style == "dotted":\n`;
  s += `${inner}    _m = DashedVMobject(_raw, num_dashes=96, dashed_ratio=0.25)\n`;
  s += `${inner}    _m.set_stroke(width=stroke_w, color=color)\n`;
  s += `${inner}    return _m\n`;
  s += `${inner}return _raw\n`;

  const list = functionSeriesIndices(item);
  for (const n of list) {
    const r = resolveFunctionSeriesN(item, n);
    const cvar = functionSeriesCurveVar(axVar, item.id, n);
    const style = JSON.stringify(r.lineStyle);
    const sw = Math.max(0.5, r.strokeWidth);
    s += `${pad}${cvar} = ${builder}(${n}, ${manimColor(r.color)}, ${sw}, ${style})\n`;
  }

  // Anchor so z-index lines can target the stack (shared var for overlay z indexing).
  s += `${pad}${axVar}_fs_${suf} = VGroup()\n`;
  for (const n of list) {
    const cvar = functionSeriesCurveVar(axVar, item.id, n);
    s += `${pad}${axVar}_fs_${suf}.add(${cvar})\n`;
  }

  // Suppress unused warnings if no indices (empty invalid series — export blocks this anyway).
  if (list.length === 0) {
    s += `${pad}_ = ${builder}\n`;
  }

  // Unused helper: silence the wrapLineStyleExpr import warning in typecheck.
  void wrapLineStyleExpr;

  return s;
}

/** Playback for a function series (Accumulation or Replacement modes). */
export function generateGraphFunctionSeriesPlay(
  item: GraphFunctionSeriesItem,
  axVar: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
  tailOpts?: BoundAudioTailOpts,
): string {
  const pad = ' '.repeat(indent);
  const list = functionSeriesIndices(item);
  if (list.length === 0) return '';

  let s = '';
  const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
  if (
    recorded &&
    (!audioItems?.length ||
      !boundSoundEmittedAtTrackStart(item, itemsMap, audioItems))
  ) {
    s += `${pad}self.add_sound("${recorded.soundPath}")\n`;
  }

  if (item.mode === 'accumulation') {
    list.forEach((n, idx) => {
      const r = resolveFunctionSeriesN(item, n);
      const rt = Math.max(0.01, r.animDuration).toFixed(6);
      const cvar = functionSeriesCurveVar(axVar, item.id, n);
      s += `${pad}self.play(Create(${cvar}), run_time=${rt})\n`;
      const isLast = idx === list.length - 1;
      if (!isLast && r.waitAfter > 1e-6) {
        s += `${pad}self.wait(${Math.max(0, r.waitAfter).toFixed(4)})\n`;
      }
    });
  } else {
    list.forEach((n, idx) => {
      const r = resolveFunctionSeriesN(item, n);
      const rt = Math.max(0.01, r.animDuration).toFixed(6);
      const cvar = functionSeriesCurveVar(axVar, item.id, n);
      if (idx === 0) {
        s += `${pad}self.play(Create(${cvar}), run_time=${rt})\n`;
      } else {
        const prev = functionSeriesCurveVar(axVar, item.id, list[idx - 1]!);
        s += `${pad}self.play(ReplacementTransform(${prev}, ${cvar}), run_time=${rt})\n`;
      }
      const isLast = idx === list.length - 1;
      if (!isLast && r.waitAfter > 1e-6) {
        s += `${pad}self.wait(${Math.max(0, r.waitAfter).toFixed(4)})\n`;
      }
    });
  }

  if (recorded) {
    s += appendAudioTailAfterLeafPlayback(
      pad,
      recorded,
      item,
      itemsMap,
      audioItems,
      tailOpts,
    );
  }
  return s;
}

/** Concurrent-cluster Succession expression for a function series branch. */
export function functionSeriesConcurrentBranch(
  item: GraphFunctionSeriesItem,
  axVar: string,
  relWait: number,
): string {
  const list = functionSeriesIndices(item);
  const wStr = Math.max(0, relWait).toFixed(4);
  if (list.length === 0) {
    return `Succession(Wait(${wStr}), Wait(0.01), run_time=0.01)`;
  }
  const parts: string[] = [`Wait(${wStr})`];
  list.forEach((n, idx) => {
    const r = resolveFunctionSeriesN(item, n);
    const rt = Math.max(0.01, r.animDuration).toFixed(6);
    const cvar = functionSeriesCurveVar(axVar, item.id, n);
    if (item.mode === 'accumulation' || idx === 0) {
      parts.push(`Create(${cvar}, run_time=${rt})`);
    } else {
      const prev = functionSeriesCurveVar(axVar, item.id, list[idx - 1]!);
      parts.push(
        `ReplacementTransform(${prev}, ${cvar}, run_time=${rt})`,
      );
    }
    const isLast = idx === list.length - 1;
    if (!isLast && r.waitAfter > 1e-6) {
      parts.push(`Wait(${Math.max(0, r.waitAfter).toFixed(4)})`);
    }
  });
  return `Succession(${parts.join(', ')})`;
}
