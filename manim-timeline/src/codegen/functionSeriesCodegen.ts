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

/**
 * Name of the custom `ReplacementTransform` subclass we emit at the top of the
 * scene file when any replacement-mode function series is exported.
 */
export const FS_REVEAL_TRANSFORM_CLASS_NAME = '_FSRevealTransform';

/**
 * Returns true if any of `items` would require the `_FSRevealTransform`
 * helper class in the generated Python scene (i.e. a replacement-mode function
 * series with at least two curves).
 */
export function anyReplacementFunctionSeries(items: SceneItem[]): boolean {
  for (const it of items) {
    if (it.kind !== 'graphFunctionSeries') continue;
    if (it.mode !== 'replacement') continue;
    if (functionSeriesIndices(it).length >= 2) return true;
  }
  return false;
}

/**
 * Python source for `_FSRevealTransform` — a plain `Transform` subclass used
 * to morph the **first** curve of a replacement-mode `graphFunctionSeries`
 * through every subsequent shape.
 *
 * Why not `ReplacementTransform(n_{k-1}, n_k)` chains?
 *  - A chain of `ReplacementTransform`s leaves the previous curve on the
 *    scene until the animation's `clean_up_from_scene(scene)` fires, and in a
 *    concurrent-cluster `Succession` that cleanup only runs at the *end* of
 *    the outer `self.play(AnimationGroup(...))`. The intermediate sources
 *    therefore pile up on the scene while later transforms play on top.
 *  - The previous attempt to work around this via opacity toggles or
 *    `.animate(...)` reveal steps either flashed the target curve visibly
 *    before the morph or turned the `ParametricFunction`'s default
 *    `fill_opacity=0` into a filled area.
 *
 * The current design keeps a single mobject (`n_1`) on the scene throughout
 * the series and uses `Transform(n_1, n_k)` to morph it in place toward
 * every subsequent curve's shape. Only `n_1` is ever a *source* of any
 * animation, so the outer `AnimationGroup.group` contains only `n_1`; every
 * target `n_k` (k ≥ 2) is pre-hidden with `set_stroke(opacity=0)` at def
 * time and never ends up visibly on the scene.
 *
 * What this subclass does:
 *  - `begin()`: temporarily sets `target_mobject.stroke_opacity=1` so the
 *    `Transform.begin()` snapshot (`self.target_copy`) drives the morph
 *    toward a visible shape, then immediately re-hides the real
 *    `target_mobject` so if it happens to be on the scene it stays invisible
 *    during the morph (no duplicate rendering alongside the morphing source).
 *
 * Exit-animation invariant: after every transform, `n_1.become(target_copy)`
 * fires at `interpolate(1)` — so `n_1` ends up with the last curve's shape
 * and `stroke_opacity=1`. The exit animation therefore targets `n_1` (see
 * the `'exit'` branch of `resolveExitTargetsForExport`) and correctly fades
 * out the only curve the viewer ever sees.
 *
 * Only *stroke* opacity is touched — `set_opacity` would also lift the
 * default `fill_opacity=0` of `ParametricFunction` and render the curve as
 * a filled area beneath the graph.
 */
export function functionSeriesRevealTransformSource(indent = 0): string {
  const pad = ' '.repeat(indent);
  return (
    `${pad}class ${FS_REVEAL_TRANSFORM_CLASS_NAME}(Transform):\n` +
    `${pad}    """Transform for replacement-mode graphFunctionSeries.\n` +
    `${pad}\n` +
    `${pad}    Morphs the series' first curve in place through every subsequent\n` +
    `${pad}    shape. Target curves are pre-hidden with stroke_opacity=0 so the\n` +
    `${pad}    outer AnimationGroup.begin() does not flash them onto the scene.\n` +
    `${pad}    begin() temporarily reveals the target's stroke so the Transform\n` +
    `${pad}    snapshot (target_copy) drives the morph toward a visible curve,\n` +
    `${pad}    then re-hides the real target mobject so it stays invisible if\n` +
    `${pad}    it happens to be on the scene.\n` +
    `${pad}    """\n` +
    `${pad}    def begin(self):\n` +
    `${pad}        self.target_mobject.set_stroke(opacity=1)\n` +
    `${pad}        super().begin()\n` +
    `${pad}        self.target_mobject.set_stroke(opacity=0)\n`
  );
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

  // Replacement mode: the playback (see `generateGraphFunctionSeriesPlay` and
  // `functionSeriesConcurrentBranch`) uses `_FSRevealTransform(n_1, n_k)` to
  // morph the first curve in place through every subsequent shape. Every
  // `n_k` with k ≥ 2 exists in Python only as a *transform target* — it is
  // not a source of any animation and should never be visible on the scene
  // (its shape lives on through `n_1.become(target_copy)` inside
  // `Transform.interpolate(1)`).
  //
  // Even so, `n_2 .. n_last` end up in the scene's mobject list because
  // `Scene.add_mobjects_from_animations` (called during
  // `Scene.play(AnimationGroup(Succession(...)))`) walks each child
  // animation's `get_all_mobjects_to_update()` — which for `Transform`
  // includes `target_mobject`. Hiding their stroke keeps them from
  // rendering while still leaving them available as `Transform` targets.
  //
  // Critical: only touch *stroke* opacity. A `ParametricFunction` (and its
  // `DashedVMobject` wrapper) has `fill_opacity=0` by default; calling
  // `set_opacity(0)` would interact oddly once the reveal path re-raises
  // opacity — `set_opacity(1)` also lifts fill and would render the curve
  // as a filled area under the graph.
  if (item.mode === 'replacement' && list.length > 1) {
    for (let i = 1; i < list.length; i++) {
      const n = list[i]!;
      const cvar = functionSeriesCurveVar(axVar, item.id, n);
      s += `${pad}${cvar}.set_stroke(opacity=0)\n`;
    }
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
  if (item.visibleAtSceneStart) return '';

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
    // Replacement mode: source every transform from the *first* curve and
    // morph it in place through every subsequent shape. This keeps exactly
    // one mobject on the scene throughout the series and avoids the
    // `ReplacementTransform` / `scene.replace(...)` cleanup-timing problem
    // where intermediate curves linger visibly until the end of the outer
    // `self.play(...)`. See {@link functionSeriesRevealTransformSource}.
    const firstVar = functionSeriesCurveVar(axVar, item.id, list[0]!);
    list.forEach((n, idx) => {
      const r = resolveFunctionSeriesN(item, n);
      const rt = Math.max(0.01, r.animDuration).toFixed(6);
      const cvar = functionSeriesCurveVar(axVar, item.id, n);
      if (idx === 0) {
        s += `${pad}self.play(Create(${cvar}), run_time=${rt})\n`;
      } else {
        s += `${pad}self.play(${FS_REVEAL_TRANSFORM_CLASS_NAME}(${firstVar}, ${cvar}), run_time=${rt})\n`;
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
  // For replacement mode, every transform sources from the first curve (see
  // {@link functionSeriesRevealTransformSource}) so that only one mobject
  // (the first curve) is ever on the scene. That sidesteps the Succession /
  // `scene.replace(...)` cleanup-timing issue that had earlier transforms
  // leaving their source curves visible for the rest of the cluster.
  const firstVar =
    list.length > 0 ? functionSeriesCurveVar(axVar, item.id, list[0]!) : '';
  list.forEach((n, idx) => {
    const r = resolveFunctionSeriesN(item, n);
    const rt = Math.max(0.01, r.animDuration).toFixed(6);
    const cvar = functionSeriesCurveVar(axVar, item.id, n);
    if (item.mode === 'accumulation' || idx === 0) {
      parts.push(`Create(${cvar}, run_time=${rt})`);
    } else {
      parts.push(
        `${FS_REVEAL_TRANSFORM_CLASS_NAME}(${firstVar}, ${cvar}, run_time=${rt})`,
      );
    }
    const isLast = idx === list.length - 1;
    if (!isLast && r.waitAfter > 1e-6) {
      parts.push(`Wait(${Math.max(0, r.waitAfter).toFixed(4)})`);
    }
  });
  return `Succession(${parts.join(', ')})`;
}
