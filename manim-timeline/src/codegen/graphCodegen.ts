import type {
  AudioTrackItem,
  AxesItem,
  ExitAnimStyle,
  GraphCurveItem,
  GraphPlotItem,
  GraphDotItem,
  GraphFieldItem,
  GraphFunctionSeriesItem,
  GraphPointSequenceItem,
  GraphAreaItem,
  GraphAreaCurveSource,
  ItemId,
  SceneItem,
} from '@/types/scene';
import {
  DEFAULT_FIELD_ARROW_STROKE_WIDTH,
  functionSeriesIndices,
  pointSequenceIndices,
  resolveGraphOverlayLineStyle,
} from '@/types/scene';
import { canBeExitTarget } from '@/lib/time';
import { pythonStringLiteral } from './texUtils';
import {
  type BoundAudioTailOpts,
  appendAudioTailAfterLeafPlayback,
  boundSoundEmittedAtTrackStart,
  lineExitAnimTarget,
  resolveRecordedPlayback,
} from './lineCodegen';
import { FIELD_COLORMAP_HEX, manimColorListHex } from './fieldColormap';
import { emitNextToPython } from './nextToCodegen';
import { resolveAttachedGraphDot, graphProjectionGuides } from '@/lib/graphMotion';
import { areaCanReveal, effectiveAreaIntroStyle } from '@/lib/graphAreaReveal';
import {
  dotFunctionPlot,
  liveTemplateTexSource,
  parseLiveValueTemplate,
  PLOT_SLOPE_STEP,
  templateUsesSlope,
} from '@/lib/graphLiveValue';

export function manimColor(hex: string): string {
  return `ManimColor("${hex}")`;
}

/** Valid Python identifier fragment from an item id. */
export function pythonOverlaySuffix(id: ItemId): string {
  let s = id.replace(/[^a-zA-Z0-9_]/g, '_');
  if (!s) s = 'ov';
  if (/^[0-9]/.test(s)) s = `_${s}`;
  return s;
}

export function generateAxesDef(item: AxesItem, axVar: string, indent: number): string {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 4);

  const [xMin, xMax, xStep] = item.xRange;
  const [yMin, yMax, yStep] = item.yRange;

  const axisConfigPairs: string[] = [];
  if (item.includeNumbers) {
    axisConfigPairs.push('"include_numbers": True');
  }
  const decimalNumberConfigPairs: string[] = [];
  const numberColorTrim =
    typeof item.numberColor === 'string' ? item.numberColor.trim() : '';
  if (numberColorTrim) {
    decimalNumberConfigPairs.push(`"color": ${manimColor(numberColorTrim)}`);
  }
  if (
    typeof item.numberFontSize === 'number' &&
    Number.isFinite(item.numberFontSize)
  ) {
    axisConfigPairs.push(`"font_size": ${item.numberFontSize}`);
  }
  if (decimalNumberConfigPairs.length > 0) {
    axisConfigPairs.push(
      `"decimal_number_config": {${decimalNumberConfigPairs.join(', ')}}`,
    );
  }
  const colorTrim =
    typeof item.axisColor === 'string' ? item.axisColor.trim() : '';
  if (colorTrim) {
    axisConfigPairs.push(`"stroke_color": ${manimColor(colorTrim)}`);
  }
  if (
    typeof item.axisStrokeWidth === 'number' &&
    Number.isFinite(item.axisStrokeWidth)
  ) {
    axisConfigPairs.push(`"stroke_width": ${item.axisStrokeWidth}`);
  }
  if (typeof item.tickLength === 'number' && Number.isFinite(item.tickLength)) {
    axisConfigPairs.push(`"tick_size": ${item.tickLength}`);
  }
  if (item.includeTip) {
    const shape = item.tipShape;
    if (shape && shape !== 'default') {
      axisConfigPairs.push(`"tip_shape": ${shape}`);
    }
    if (typeof item.tipHeight === 'number' && Number.isFinite(item.tipHeight)) {
      axisConfigPairs.push(`"tip_height": ${item.tipHeight}`);
    }
    if (typeof item.tipWidth === 'number' && Number.isFinite(item.tipWidth)) {
      axisConfigPairs.push(`"tip_width": ${item.tipWidth}`);
    }
  }

  let s = '';
  s += `${pad}${axVar} = Axes(\n`;
  s += `${inner}x_range=[${xMin}, ${xMax}, ${xStep}],\n`;
  s += `${inner}y_range=[${yMin}, ${yMax}, ${yStep}],\n`;
  s += `${inner}x_length=${((xMax - xMin) * item.scaleX).toFixed(2)},\n`;
  s += `${inner}y_length=${((yMax - yMin) * item.scaleY).toFixed(2)},\n`;

  if (!item.includeTip) {
    s += `${inner}tips=False,\n`;
  }

  if (axisConfigPairs.length > 0) {
    s += `${inner}axis_config={${axisConfigPairs.join(', ')}},\n`;
  }

  s += `${pad})\n`;

  const tickStylePairs: string[] = [];
  const tickColorTrim =
    typeof item.tickColor === 'string' ? item.tickColor.trim() : '';
  if (tickColorTrim) {
    tickStylePairs.push(`color=${manimColor(tickColorTrim)}`);
  }
  if (
    typeof item.tickStrokeWidth === 'number' &&
    Number.isFinite(item.tickStrokeWidth)
  ) {
    tickStylePairs.push(`width=${item.tickStrokeWidth}`);
  }
  if (tickStylePairs.length > 0) {
    s += `${pad}for _axis in [${axVar}.x_axis, ${axVar}.y_axis]:\n`;
    s += `${inner}if hasattr(_axis, "ticks"):\n`;
    s += `${inner}    _axis.ticks.set_stroke(${tickStylePairs.join(', ')})\n`;
  }

  if (item.xLabel) {
    s += `${pad}${axVar}_xlabel = ${axVar}.get_x_axis_label(${pythonStringLiteral(item.xLabel)})\n`;
  }
  if (item.yLabel) {
    s += `${pad}${axVar}_ylabel = ${axVar}.get_y_axis_label(${pythonStringLiteral(item.yLabel)})\n`;
  }

  if (item.includeTip) {
    const tipStrokePairs: string[] = [];
    if (
      typeof item.tipStrokeWidth === 'number' &&
      Number.isFinite(item.tipStrokeWidth) &&
      item.tipStrokeWidth >= 0
    ) {
      tipStrokePairs.push(`width=${item.tipStrokeWidth}`);
    }
    const fillOp =
      typeof item.tipFillOpacity === 'number' &&
      Number.isFinite(item.tipFillOpacity)
        ? Math.max(0, Math.min(1, item.tipFillOpacity))
        : null;
    if (tipStrokePairs.length > 0 || fillOp != null) {
      s += `${pad}for _tip in [${axVar}.x_axis.tip, ${axVar}.y_axis.tip]:\n`;
      s += `${inner}if _tip is not None:\n`;
      if (tipStrokePairs.length > 0) {
        s += `${inner}    _tip.set_stroke(${tipStrokePairs.join(', ')})\n`;
      }
      if (fillOp != null) {
        s += `${inner}    _tip.set_fill(opacity=${fillOp.toFixed(4)})\n`;
      }
    }
  }

  return s;
}

export function generateAxesPos(
  item: AxesItem,
  axVar: string,
  indent: number,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  for (let si = 0; si < item.posSteps.length; si++) {
    const step = item.posSteps[si]!;
    switch (step.kind) {
      case 'absolute':
        lines.push(
          `${pad}${axVar}.move_to([${item.x.toFixed(6)}, ${item.y.toFixed(6)}, 0])`,
        );
        break;
      case 'next_to': {
        if (!step.refId) break;
        const refVar = idToVarName.get(step.refId);
        if (!refVar) break;
        const refItem = itemsMap.get(step.refId);
        if (!refItem) break;
        lines.push(
          emitNextToPython({
            varName: axVar,
            step,
            refVar,
            item,
            refItem,
            itemsMap,
            stepIndex: si,
            indent: pad,
          }),
        );
        break;
      }
      case 'to_edge':
        lines.push(
          `${pad}${axVar}.to_edge(${step.edge}, buff=${Number.isFinite(step.buff) ? step.buff : 0.3})`,
        );
        break;
      case 'shift':
        lines.push(
          `${pad}${axVar}.shift(${step.dx}*RIGHT + ${step.dy}*UP)`,
        );
        break;
      case 'set_x':
        lines.push(`${pad}${axVar}.set_x(${step.x.toFixed(6)})`);
        break;
      case 'set_y':
        lines.push(`${pad}${axVar}.set_y(${step.y.toFixed(6)})`);
        break;
    }
  }

  return lines.join('\n') + (lines.length ? '\n' : '');
}

export function exitAnimationExpr(targets: string, animStyle: ExitAnimStyle): string {
  switch (animStyle) {
    case 'fade_out':
      return `FadeOut(${targets})`;
    case 'uncreate':
      return `Uncreate(${targets})`;
    case 'shrink_to_center':
      return `ShrinkToCenter(${targets})`;
    default:
      return '';
  }
}

/** Emit `self.play(FadeOut|...)` for resolved Python target expression(s). */
export function formatExitPlayLine(
  targets: string,
  animStyle: ExitAnimStyle,
  runTime: number,
  pad: string,
): string {
  if (!animStyle || animStyle === 'none') return '';
  const rt = Math.max(0.01, runTime).toFixed(4);
  const inner = exitAnimationExpr(targets, animStyle);
  if (!inner) return '';
  return `${pad}self.play(${inner}, run_time=${rt})\n`;
}

/**
 * One synchronized `self.play(AnimationGroup(...))` for multiple targets / styles.
 */
export function formatExitGroupPlayLine(
  parts: { targetsStr: string; animStyle: ExitAnimStyle }[],
  runTime: number,
  pad: string,
): string {
  const active = parts.filter(
    (p) => p.animStyle && p.animStyle !== 'none',
  );
  if (active.length === 0) return '';
  const rt = Math.max(0.01, runTime).toFixed(4);
  if (active.length === 1) {
    const p = active[0]!;
    return formatExitPlayLine(p.targetsStr, p.animStyle, runTime, pad);
  }
  const anims = active
    .map((p) => exitAnimationExpr(p.targetsStr, p.animStyle))
    .filter(Boolean);
  if (anims.length === 0) return '';
  return `${pad}self.play(AnimationGroup(${anims.join(', ')}, lag_ratio=0), run_time=${rt})\n`;
}

/**
 * Python target expression(s) for an exit_animation clip, or null if vars are missing.
 *
 * `purpose` controls the function-series special case. In `'exit'` mode, a
 * replacement-mode series resolves to **only the first curve's VMobject**
 * (`n_1`). The replacement-mode playback (see `functionSeriesCodegen.ts`)
 * keeps a single on-screen mobject throughout the series: `n_1` is created
 * first, then morphed in place via `_FSRevealTransform(n_1, n_k)` to every
 * subsequent shape. At exit time `n_1` is the only curve visible (it has
 * `n_last`'s shape), so the exit animation must target `n_1` alone.
 * Feeding the parent VGroup to `FadeOut`/`Uncreate`/`ShrinkToCenter` would
 * re-render every other curve (`n_2`..`n_last`) — which are Python objects
 * that exist only as transform targets — for the duration of the play,
 * flashing them onto the screen right before the exit.
 *
 * Surround-rect sizing keeps the legacy VGroup target so a highlight around
 * the full series still spans all curves.
 */
export function resolveExitTargetsForExport(
  target: SceneItem,
  idToVarName: Map<ItemId, string>,
  purpose: 'exit' | 'surround' = 'surround',
): string | null {
  if (!canBeExitTarget(target)) return null;

  if (target.kind === 'surroundingRect') {
    return idToVarName.get(target.id) ?? null;
  }

  if (target.kind === 'textLine') {
    const v = idToVarName.get(target.id);
    if (!v) return null;
    return lineExitAnimTarget(v, target);
  }
  if (target.kind === 'axes') {
    return idToVarName.get(target.id) ?? null;
  }
  if (target.kind === 'graphPlot') {
    const axVar = idToVarName.get(target.axesId);
    if (!axVar) return null;
    return overlayPlotVar(axVar, target.id);
  }
  if (target.kind === 'graphCurve') {
    const axVar = idToVarName.get(target.axesId);
    if (!axVar) return null;
    return overlayCurveVar(axVar, target.id);
  }
  if (target.kind === 'graphDot') {
    const axVar = idToVarName.get(target.axesId);
    if (!axVar) return null;
    const dVar = overlayDotVar(axVar, target.id);
    const dot = target.dot;
    return dot.label.trim() ? `${dVar}, ${dVar}_lbl` : dVar;
  }
  if (target.kind === 'graphField') {
    if (target.fieldMode === 'none') return null;
    const axVar = idToVarName.get(target.axesId);
    if (!axVar) return null;
    const suf = pythonOverlaySuffix(target.id);
    const vfVar = `${axVar}_vf_${suf}`;
    const seeds = target.streamPoints ?? [];
    if (seeds.length > 0) {
      const streamsVar = `${axVar}_streams_${suf}`;
      return `${vfVar}, ${streamsVar}`;
    }
    return vfVar;
  }
  if (target.kind === 'graphFunctionSeries') {
    const axVar = idToVarName.get(target.axesId);
    if (!axVar) return null;
    const suf = pythonOverlaySuffix(target.id);
    if (purpose === 'exit' && target.mode === 'replacement') {
      const list = functionSeriesIndices(target);
      const firstN = list.length > 0 ? list[0]! : null;
      if (firstN != null) {
        // The first curve (`n_1`) is the only on-scene mobject throughout
        // the series — every subsequent shape is morphed into it in place
        // via `_FSRevealTransform`. Must stay in sync with
        // `functionSeriesCurveVar` in `functionSeriesCodegen.ts` (circular
        // import avoided by inlining).
        const ns = firstN < 0 ? `m${Math.abs(firstN)}` : String(firstN);
        return `${axVar}_fs_${suf}_n${ns}`;
      }
      return null;
    }
    return `${axVar}_fs_${suf}`;
  }
  if (target.kind === 'graphPointSequence') {
    const axVar = idToVarName.get(target.axesId);
    if (!axVar) return null;
    const list = pointSequenceIndices(target);
    if (target.mode === 'replacement' && list.length > 0) {
      const lastN = list[list.length - 1]!;
      return overlayPointSequenceDotVar(axVar, target.id, lastN);
    }
    return overlayPointSequenceGroupVar(axVar, target.id);
  }
  if (target.kind === 'graphArea') {
    const axVar = idToVarName.get(target.axesId);
    if (!axVar) return null;
    return overlayAreaVar(axVar, target.id);
  }
  if (target.kind === 'shape') {
    return idToVarName.get(target.id) ?? null;
  }
  if (target.kind === 'image') {
    return idToVarName.get(target.id) ?? null;
  }
  return null;
}

export function generateAxesPlay(
  item: AxesItem,
  axVar: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
  tailOpts?: BoundAudioTailOpts,
): string {
  const pad = ' '.repeat(indent);
  if (item.visibleAtSceneStart) return '';
  let s = '';

  const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
  if (recorded) {
    const rt = recorded.runTime.toFixed(6);
    if (
      !audioItems?.length ||
      !boundSoundEmittedAtTrackStart(item, itemsMap, audioItems)
    ) {
      s += `${pad}self.add_sound("${recorded.soundPath}")\n`;
    }
    s += `${pad}self.play(Create(${axVar}), run_time=${rt})\n`;
    s += appendAudioTailAfterLeafPlayback(
      pad,
      recorded,
      item,
      itemsMap,
      audioItems,
      tailOpts,
    );
  } else {
    s += `${pad}self.play(Create(${axVar}), run_time=${item.duration})\n`;
  }

  return s;
}

export function overlayPlotVar(axVar: string, itemId: ItemId): string {
  return `${axVar}_plot_${pythonOverlaySuffix(itemId)}`;
}

export function overlayCurveVar(axVar: string, itemId: ItemId): string {
  return `${axVar}_curve_${pythonOverlaySuffix(itemId)}`;
}

export function overlayAreaVar(axVar: string, itemId: ItemId): string {
  return `${axVar}_area_${pythonOverlaySuffix(itemId)}`;
}

/** Indexed dot for graphPointSequence (must match pointSequenceCodegen). */
export function overlayPointSequenceDotVar(
  axVar: string,
  itemId: ItemId,
  n: number,
): string {
  const ns = n < 0 ? `m${Math.abs(n)}` : String(n);
  return `${axVar}_ps_${pythonOverlaySuffix(itemId)}_n${ns}`;
}

export function overlayPointSequenceGroupVar(
  axVar: string,
  itemId: ItemId,
): string {
  return `${axVar}_ps_${pythonOverlaySuffix(itemId)}`;
}

/** After overlay defs + positioning; higher `zIndex` draws on top in Manim. */
export function generateGraphOverlayZIndexLines(
  ov:
    | GraphPlotItem
    | GraphCurveItem
    | GraphDotItem
    | GraphFieldItem
    | GraphFunctionSeriesItem
    | GraphPointSequenceItem
    | GraphAreaItem,
  axVar: string,
  zIndex: number,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const z = zIndex.toFixed(6);
  if (ov.kind === 'graphArea') {
    return `${pad}${overlayAreaVar(axVar, ov.id)}.set_z_index(${z})\n`;
  }
  if (ov.kind === 'graphPlot') {
    return `${pad}${overlayPlotVar(axVar, ov.id)}.set_z_index(${z})\n`;
  }
  if (ov.kind === 'graphCurve') {
    return `${pad}${overlayCurveVar(axVar, ov.id)}.set_z_index(${z})\n`;
  }
  if (ov.kind === 'graphDot') {
    const dVar = overlayDotVar(axVar, ov.id);
    let s = `${pad}${dVar}.set_z_index(${z})\n`;
    if (ov.dot.label.trim()) {
      s += `${pad}${dVar}_lbl.set_z_index(${z})\n`;
    }
    return s;
  }
  if (ov.kind === 'graphField' && ov.fieldMode !== 'none') {
    const suf = pythonOverlaySuffix(ov.id);
    const vfVar = `${axVar}_vf_${suf}`;
    const streamsVar = `${axVar}_streams_${suf}`;
    let s = `${pad}${vfVar}.set_z_index(${z})\n`;
    if ((ov.streamPoints ?? []).length > 0) {
      s += `${pad}${streamsVar}.set_z_index(${z})\n`;
    }
    return s;
  }
  if (ov.kind === 'graphFunctionSeries') {
    const suf = pythonOverlaySuffix(ov.id);
    return `${pad}${axVar}_fs_${suf}.set_z_index(${z})\n`;
  }
  if (ov.kind === 'graphPointSequence') {
    return `${pad}${overlayPointSequenceGroupVar(axVar, ov.id)}.set_z_index(${z})\n`;
  }
  return '';
}

/**
 * Must run after `generateAxesPos` for `axVar`. Manim's `Axes.plot()` samples
 * `coords_to_point` when the ParametricFunction is built; the curve is not a
 * child of the axes, so defining it before `move_to` leaves it stuck at the origin.
 */
export function generateGraphPlotDef(
  item: GraphPlotItem,
  axVar: string,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const pVar = overlayPlotVar(axVar, item.id);
  const fn = item.fn;
  let xRangeKw = '';
  if (item.xDomain != null) {
    const lo = Math.min(item.xDomain[0], item.xDomain[1]);
    const hi = Math.max(item.xDomain[0], item.xDomain[1]);
    xRangeKw = `, x_range=[${lo}, ${hi}]`;
  }
  const sw = Math.max(0, item.strokeWidth);
  const ls = resolveGraphOverlayLineStyle(item.lineStyle);
  const pRaw = `${pVar}_raw`;
  let s =
    `${pad}${pRaw} = ${axVar}.plot(lambda x: ${fn.pyExpr || 'x'}, color=${manimColor(fn.color)}${xRangeKw})\n` +
    `${pad}${pRaw}.set_stroke(width=${sw})\n`;
  if (ls === 'solid') {
    s += `${pad}${pVar} = ${pRaw}\n`;
  } else if (ls === 'dashed') {
    s +=
      `${pad}${pVar} = DashedVMobject(${pRaw}, num_dashes=32, dashed_ratio=0.55)\n` +
      `${pad}${pVar}.set_stroke(width=${sw})\n`;
  } else {
    s +=
      `${pad}${pVar} = DashedVMobject(${pRaw}, num_dashes=96, dashed_ratio=0.25)\n` +
      `${pad}${pVar}.set_stroke(width=${sw})\n`;
  }
  return s;
}

/**
 * Parametric curve in graph coordinates, evaluated after axes positioning (see
 * {@link generateGraphPlotDef}).
 */
export function generateGraphCurveDef(
  item: GraphCurveItem,
  axVar: string,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const cVar = overlayCurveVar(axVar, item.id);
  const curve = item.curve;
  const px = (curve.pyXExpr ?? 't').trim() || 't';
  const py = (curve.pyYExpr ?? '0').trim() || '0';
  const [tA, tB] = item.tDomain;
  const tLo = Math.min(tA, tB);
  const tHi = Math.max(tA, tB);
  const hex =
    typeof curve.color === 'string' && curve.color.trim()
      ? curve.color.trim()
      : '#3b82f6';
  const sw = Math.max(0, item.strokeWidth ?? 2);
  const ls = resolveGraphOverlayLineStyle(item.lineStyle);
  const cRaw = `${cVar}_raw`;
  let s =
    `${pad}${cRaw} = ParametricFunction(\n` +
    `${pad}    lambda t: ${axVar}.coords_to_point(${px}, ${py}),\n` +
    `${pad}    t_range=[${tLo}, ${tHi}],\n` +
    `${pad}    color=${manimColor(hex)},\n` +
    `${pad})\n` +
    `${pad}${cRaw}.set_stroke(width=${sw})\n`;
  if (ls === 'solid') {
    s += `${pad}${cVar} = ${cRaw}\n`;
  } else if (ls === 'dashed') {
    s +=
      `${pad}${cVar} = DashedVMobject(${cRaw}, num_dashes=32, dashed_ratio=0.55)\n` +
      `${pad}${cVar}.set_stroke(width=${sw})\n`;
  } else {
    s +=
      `${pad}${cVar} = DashedVMobject(${cRaw}, num_dashes=96, dashed_ratio=0.25)\n` +
      `${pad}${cVar}.set_stroke(width=${sw})\n`;
  }
  return s;
}

export function generateGraphPlotPlay(
  item: GraphPlotItem,
  axVar: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
  tailOpts?: BoundAudioTailOpts,
): string {
  const pad = ' '.repeat(indent);
  if (item.visibleAtSceneStart) return '';
  const pVar = overlayPlotVar(axVar, item.id);
  let s = '';

  const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
  if (recorded) {
    const rt = recorded.runTime.toFixed(6);
    if (
      !audioItems?.length ||
      !boundSoundEmittedAtTrackStart(item, itemsMap, audioItems)
    ) {
      s += `${pad}self.add_sound("${recorded.soundPath}")\n`;
    }
    s += `${pad}self.play(Create(${pVar}), run_time=${rt})\n`;
    s += appendAudioTailAfterLeafPlayback(
      pad,
      recorded,
      item,
      itemsMap,
      audioItems,
      tailOpts,
    );
  } else {
    s += `${pad}self.play(Create(${pVar}), run_time=${item.duration})\n`;
  }

  return s;
}

export function generateGraphCurvePlay(
  item: GraphCurveItem,
  axVar: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
  tailOpts?: BoundAudioTailOpts,
): string {
  const pad = ' '.repeat(indent);
  if (item.visibleAtSceneStart) return '';
  const cVar = overlayCurveVar(axVar, item.id);
  let s = '';

  const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
  if (recorded) {
    const rt = recorded.runTime.toFixed(6);
    if (
      !audioItems?.length ||
      !boundSoundEmittedAtTrackStart(item, itemsMap, audioItems)
    ) {
      s += `${pad}self.add_sound("${recorded.soundPath}")\n`;
    }
    s += `${pad}self.play(Create(${cVar}), run_time=${rt})\n`;
    s += appendAudioTailAfterLeafPlayback(
      pad,
      recorded,
      item,
      itemsMap,
      audioItems,
      tailOpts,
    );
  } else {
    s += `${pad}self.play(Create(${cVar}), run_time=${item.duration})\n`;
  }

  return s;
}

export function overlayDotVar(axVar: string, itemId: ItemId): string {
  return `${axVar}_dot_${pythonOverlaySuffix(itemId)}`;
}

export function generateGraphDotDef(
  item: GraphDotItem,
  axVar: string,
  indent: number,
  itemsMap: ReadonlyMap<ItemId, SceneItem> = new Map(),
): string {
  const pad = ' '.repeat(indent);
  const dVar = overlayDotVar(axVar, item.id);
  const dot = item.dot;
  // Dot must not use coords_to_point here: defs run before generateAxesPos, so the axes
  // transform would still be default. Snap to graph coords in generateGraphDotSnapToAxes.
  let line = `${pad}${dVar} = Dot(color=${manimColor(dot.color)}`;
  if (dot.radius !== 0.08) line += `, radius=${dot.radius}`;
  line += ')\n';
  let s = line;
  if (dot.label.trim()) {
    const lblVar = `${dVar}_lbl`;
    s += `${pad}${lblVar} = HebrewMathLine(${pythonStringLiteral(dot.label.trim())}, font_size=${Number.isFinite(dot.labelFontSize) ? dot.labelFontSize : 18}, color=${manimColor(dot.labelColor ?? '#ffffff')}, hebrew_font="Alef")\n`;
  }
  if (dot.showCoordinates && dot.valueTemplate?.trim()) s += graphDotValueTextDef(item, dVar, pad, itemsMap);
  else if (dot.showCoordinates) s += `${pad}${dVar}_coord = _graph_coord_text(${dVar}, ${Number.isFinite(dot.coordinateFontSize) ? dot.coordinateFontSize : 18}, ${manimColor(dot.coordinateColor ?? '#e2e8f0')}, ${Math.max(0, Math.min(6, Math.trunc(dot.coordinatePrecision ?? 2)))})\n`;
  if (dot.showProjectionGuides) {
    s += `${pad}${dVar}_guide_v = Line(ORIGIN, ORIGIN, color=ManimColor("#94a3b8"), stroke_width=1)\n`;
    s += `${pad}${dVar}_guide_h = Line(ORIGIN, ORIGIN, color=ManimColor("#94a3b8"), stroke_width=1)\n`;
  }
  const pyLabel = dot.label.trim() ? `${dVar}_lbl` : 'None';
  const pyCoordinate = dot.showCoordinates ? `${dVar}_coord` : 'None';
  const pyGuideV = dot.showProjectionGuides ? `${dVar}_guide_v` : 'None';
  const pyGuideH = dot.showProjectionGuides ? `${dVar}_guide_h` : 'None';
  s += `${pad}${dVar}_update = lambda point: _graph_update_dot(${dVar}, point, ${pyLabel}, ${pyCoordinate}, ${pyGuideV}, ${pyGuideH}, ${axVar}, ${dot.labelDir}, ${Number.isFinite(dot.labelSpacing) ? dot.labelSpacing : 0.15}, ${dot.coordinateDir ?? 'DOWN'}, ${Number.isFinite(dot.coordinateSpacing) ? dot.coordinateSpacing : 0.15}, ${Math.max(0, Math.min(6, Math.trunc(dot.coordinatePrecision ?? 2)))})\n`;
  return s;
}

/**
 * Live label from `dot.valueTemplate`: fixed pieces are `HebrewMathLine`s built once here, values
 * are drawn from the cached digit glyphs in the updater (no TeX while playing). `{slope}` uses the
 * plot's Python expression with the same step and domain clamp as the preview.
 */
function graphDotValueTextDef(item: GraphDotItem, dVar: string, pad: string, itemsMap: ReadonlyMap<ItemId, SceneItem>): string {
  const dot = item.dot;
  const fontSize = Number.isFinite(dot.coordinateFontSize) ? dot.coordinateFontSize! : 18;
  const color = manimColor(dot.coordinateColor ?? '#e2e8f0');
  const { parts, unknown } = parseLiveValueTemplate(dot.valueTemplate ?? '');
  if (unknown.length) {
    throw new Error(`Graph dot "${item.label || item.id}": live value template has {${unknown[0]}}; use {x}, {y} or {slope}.`);
  }
  const pyParts = parts.flatMap((part) => {
    if (part.kind === 'value') return [JSON.stringify(part.key)];
    const tex = liveTemplateTexSource(part.text);
    return tex ? [`HebrewMathLine(${pythonStringLiteral(tex)}, font_size=${fontSize}, color=${color}, hebrew_font="Alef")`] : [];
  });
  let slope = 'None';
  if (templateUsesSlope(dot.valueTemplate)) {
    const src = dotFunctionPlot(item, itemsMap);
    if (src.error != null) throw new Error(`Graph dot "${item.label || item.id}": {slope} needs a function plot. ${src.error}`);
    const [lo, hi] = src.domain;
    const h = Math.max(1e-9, (hi - lo) * PLOT_SLOPE_STEP).toExponential(6);
    const f = `(lambda x: (${(src.plot.fn.pyExpr || 'x').replace(/\s+/g, ' ')}))`;
    slope =
      `lambda _x: (lambda _f, _x0, _x1: (_f(_x1) - _f(_x0)) / (_x1 - _x0) if _x1 > _x0 else float("nan"))` +
      `(${f}, max(${lo}, _x - ${h}), min(${hi}, _x + ${h}))`;
  }
  return `${pad}${dVar}_coord = _graph_value_text(${fontSize}, ${color}, [${pyParts.join(', ')}], ${slope})\n`;
}

/** Call after generateAxesPos for `axVar` so coords_to_point uses the final axes placement. */
export function generateGraphDotSnapToAxes(
  item: GraphDotItem,
  axVar: string,
  indent: number,
  items: readonly SceneItem[] = [item],
  axes?: AxesItem,
): string {
  const pad = ' '.repeat(indent);
  const dVar = overlayDotVar(axVar, item.id);
  const dot = item.dot;
  const resolved = resolveAttachedGraphDot(item, items);
  if (resolved.error) throw new Error(`Graph dot "${item.label || item.id}": ${resolved.error}`);
  const point = resolved.point;
  const s = `${pad}${dVar}_update((${point.x}, ${point.y}))\n`;
  if (dot.showProjectionGuides && axes) {
    // graphProjectionGuides is also used by preview; updater emits the same nearest-boundary rule.
    graphProjectionGuides(point, axes);
  }
  return s;
}

/** Scene-local cached HebrewMathLine glyph atlas; recomposition occurs only on changed text. */
export function graphDotAnnotationHelperSource(indent = 0, includeCoordinates = true): string {
  const p = ' '.repeat(indent), q = ' '.repeat(indent + 4);
  let source = '';
  if (includeCoordinates) {
    source += `${p}from decimal import Decimal, ROUND_HALF_UP\n`+
      `${p}_graph_glyphs = {c: HebrewMathLine(c, font_size=18, hebrew_font="Alef") for c in "0123456789-.(),"}\n` +
      `${p}def _graph_fixed(value, precision):\n`+
      `${q}rounded = Decimal.from_float(abs(float(value))).quantize(Decimal(1).scaleb(-precision), rounding=ROUND_HALF_UP)\n`+
      `${q}text = f"{rounded:.{precision}f}"\n`+
      `${q}return ("-" if value < 0 and rounded != 0 else "") + text\n`+
      `${p}def _graph_coordinate_glyphs(text, font_size, color):\n`+
      `${q}group = VGroup()\n`+
      `${q}cursor = 0.0\n`+
      `${q}scale = font_size / 18.0\n`+
      `${q}for char in text:\n`+
      `${q}    if char == " ":\n`+
      `${q}        cursor += 0.24 * scale\n`+
      `${q}        continue\n`+
      `${q}    glyph = _graph_glyphs[char].copy().scale(scale).set_color(color)\n`+
      `${q}    ink_left = glyph.get_left()[0]\n`+
      `${q}    ink_right = glyph.get_right()[0]\n`+
      `${q}    ink_width = max(0.0, ink_right - ink_left)\n`+
      `${q}    glyph.shift(np.array([cursor - ink_left, -glyph.get_center()[1], 0.0]))\n`+
      `${q}    glyph._graph_char = char\n`+
      `${q}    group.add(glyph)\n`+
      `${q}    cursor += ink_width + 0.012 * scale\n`+
      `${q}group.move_to(ORIGIN)\n`+
      `${q}return group\n`+
      // A play fixes its list of moving mobjects (whole families) when it starts, so a glyph
      // swapped out mid-play would still be drawn where it was left; empty it first.
      `${p}def _graph_retire_glyphs(coord):\n`+
      `${q}for old in coord.family_members_with_points():\n`+
      `${q}    old.clear_points()\n`+
      `${q}coord.remove(*coord.submobjects)\n`+
      `${p}def _graph_coord_text(dot, font_size, color, precision):\n`+
      `${q}group = _graph_coordinate_glyphs("", font_size, color)\n`+
      `${q}group._graph_text = None\n`+
      `${q}group._graph_font_size = font_size\n`+
      `${q}group._graph_color = color\n`+
      `${q}return group\n`+
      // Live label from a template: parts are value names ("x", "y", "slope") or fixed mobjects.
      `${p}def _graph_value_text(font_size, color, parts, slope):\n`+
      `${q}group = VGroup()\n`+
      `${q}group._graph_text = None\n`+
      `${q}group._graph_font_size = font_size\n`+
      `${q}group._graph_color = color\n`+
      `${q}group._graph_parts = parts\n`+
      `${q}group._graph_slope = slope\n`+
      `${q}return group\n`+
      `${p}def _graph_value_texts(coord, x, y, precision):\n`+
      `${q}values = {"x": x, "y": y}\n`+
      `${q}if coord._graph_slope is not None: values["slope"] = coord._graph_slope(x)\n`+
      `${q}return [(_graph_fixed(values[part], precision) if np.isfinite(values[part]) else "?") if isinstance(part, str) else part for part in coord._graph_parts]\n`;
  }
  source +=
    `${p}def _graph_update_dot(dot, point, label, coord, guide_v, guide_h, axes, label_dir, label_gap, coord_dir, coord_gap, precision):\n`+
    `${q}dot.move_to(axes.coords_to_point(point[0], point[1]))\n`+
    `${q}if label is not None: label.next_to(dot, label_dir, buff=label_gap)\n`;
  if (includeCoordinates) {
    source += `${q}if coord is not None: _graph_update_coordinate(coord, point, dot, coord_dir, coord_gap, precision)\n`;
  }
  source += `${q}if guide_v is not None:\n`+
    `${q}    x, y = point; xmin, xmax = axes.x_range[:2]; ymin, ymax = axes.y_range[:2]\n`+
    `${q}    gx = 0 if xmin <= 0 <= xmax else (xmin if abs(x-xmin) <= abs(x-xmax) else xmax)\n`+
    `${q}    gy = 0 if ymin <= 0 <= ymax else (ymin if abs(y-ymin) <= abs(y-ymax) else ymax)\n`+
    `${q}    v_start = axes.coords_to_point(x,y); v_end = axes.coords_to_point(x,gy)\n`+
    `${q}    if np.linalg.norm(v_end - v_start) <= 1e-8: guide_v.set_opacity(0)\n`+
    `${q}    else: guide_v.put_start_and_end_on(v_start, v_end); guide_v.set_opacity(1)\n`+
    `${q}    h_start = axes.coords_to_point(x,y); h_end = axes.coords_to_point(gx,y)\n`+
    `${q}    if np.linalg.norm(h_end - h_start) <= 1e-8: guide_h.set_opacity(0)\n`+
    `${q}    else: guide_h.put_start_and_end_on(h_start, h_end); guide_h.set_opacity(1)\n`;
  if (includeCoordinates) {
    source += `${p}def _graph_update_coordinate(coord, point, dot, coord_dir, coord_gap, precision):\n`+
      `${q}x = 0.0 if point[0] == 0 else point[0]\n`+
      `${q}y = 0.0 if point[1] == 0 else point[1]\n`+
      `${q}if getattr(coord, "_graph_parts", None) is not None:\n`+
      `${q}    texts = _graph_value_texts(coord, x, y, precision)\n`+
      `${q}    key = tuple(t if isinstance(t, str) else id(t) for t in texts)\n`+
      `${q}    if coord._graph_text != key:\n`+
      `${q}        scale = coord._graph_font_size / 18.0\n`+
      `${q}        pieces = [_graph_coordinate_glyphs(t, coord._graph_font_size, coord._graph_color) if isinstance(t, str) else t.copy() for t in texts]\n`+
      `${q}        row = VGroup(*pieces).arrange(RIGHT, buff=0.08 * scale)\n`+
      `${q}        _graph_retire_glyphs(coord)\n`+
      `${q}        coord.add(*row.submobjects)\n`+
      `${q}        coord._graph_text = key\n`+
      `${q}    coord.next_to(dot, coord_dir, buff=coord_gap)\n`+
      `${q}    return\n`+
      `${q}text = f"({_graph_fixed(x, precision)}, {_graph_fixed(y, precision)})"\n`+
      `${q}if getattr(coord, "_graph_text", None) != text:\n`+
      `${q}    glyph_group = _graph_coordinate_glyphs(text, coord._graph_font_size, coord._graph_color)\n`+
      `${q}    _graph_retire_glyphs(coord)\n`+
      `${q}    coord.add(*glyph_group.submobjects)\n`+
      `${q}    coord._graph_text = text\n`+
      `${q}coord.next_to(dot, coord_dir, buff=coord_gap)\n`;
  }
  return source;
}

export function generateGraphDotPlay(
  item: GraphDotItem,
  axVar: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
  tailOpts?: BoundAudioTailOpts,
): string {
  const pad = ' '.repeat(indent);
  if (item.visibleAtSceneStart) return '';
  const dVar = overlayDotVar(axVar, item.id);
  const dot = item.dot;
  let s = '';

  const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
  // Dot, annotations and label all come in together inside the clip's run time.
  const parts = graphDotIntroParts(dVar, dot);
  const intro = parts.length === 1 ? parts[0]! : `AnimationGroup(${parts.join(', ')}, lag_ratio=0)`;

  if (recorded) {
    const rt = recorded.runTime.toFixed(6);
    if (
      !audioItems?.length ||
      !boundSoundEmittedAtTrackStart(item, itemsMap, audioItems)
    ) {
      s += `${pad}self.add_sound("${recorded.soundPath}")\n`;
    }
    s += `${pad}self.play(${intro}, run_time=${rt})\n`;
    s += appendAudioTailAfterLeafPlayback(
      pad,
      recorded,
      item,
      itemsMap,
      audioItems,
      tailOpts,
    );
  } else {
    s += `${pad}self.play(${intro}, run_time=${item.duration})\n`;
  }

  return s;
}

/**
 * Intro animations for a graph dot, all spanning the clip's run time: the dot, its live
 * coordinate and projection guides fade in while the fixed label is written.
 * Shared with the concurrent-cluster branch in `leafConcurrentCodegen.ts`.
 */
export function graphDotIntroParts(
  dVar: string,
  dot: GraphDotItem['dot'],
  /** Extra keyword arguments for every part, e.g. `, run_time=0.600000`. */
  kwargs = '',
): string[] {
  const parts = [`FadeIn(${dVar}${kwargs})`];
  if (dot.showCoordinates) parts.push(`FadeIn(${dVar}_coord${kwargs})`);
  if (dot.showProjectionGuides) parts.push(`FadeIn(${dVar}_guide_v${kwargs})`, `FadeIn(${dVar}_guide_h${kwargs})`);
  if (dot.label.trim()) parts.push(`Write(${dVar}_lbl${kwargs})`);
  return parts;
}

export function generateGraphFieldDef(
  item: GraphFieldItem,
  axVar: string,
  axes: AxesItem,
  indent: number,
): string {
  if (item.fieldMode === 'none') return '';

  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 4);
  const innerDef = ' '.repeat(indent + 8);
  const suf = pythonOverlaySuffix(item.id);
  const fieldFn = `${axVar}_field_${suf}`;
  const [xMin, xMax] = axes.xRange;
  const [yMin, yMax] = axes.yRange;

  let s = '';
  if (item.fieldMode === 'slope') {
    const L = item.slopeArrowLength ?? 0.5;
    const expr = (item.pyExprSlope ?? '0').trim() || '0';
    s += `${pad}def ${fieldFn}(pos):\n`;
    s += `${inner}x, y = pos[0], pos[1]\n`;
    s += `${inner}f = (${expr})\n`;
    s += `${inner}den = np.sqrt(1.0 + f * f)\n`;
    s += `${inner}return np.array([${L} / den, ${L} * f / den, 0.0])\n`;
  } else {
    const pEx = (item.pyExprP ?? '1').trim() || '0';
    const qEx = (item.pyExprQ ?? '0').trim() || '0';
    s += `${pad}def ${fieldFn}(pos):\n`;
    s += `${inner}x, y = pos[0], pos[1]\n`;
    s += `${inner}return np.array([${pEx}, ${qEx}, 0.0])\n`;
  }

  const step = Math.max(0.05, item.fieldGridStep ?? 0.5);
  const cmap = item.fieldColormap ?? 'viridis';
  const colorsPy = manimColorListHex(FIELD_COLORMAP_HEX[cmap] ?? FIELD_COLORMAP_HEX.viridis);
  const cmin = item.colorSchemeMin ?? 0;
  const cmax = item.colorSchemeMax ?? 2;
  const vfVar = `${axVar}_vf_${suf}`;
  s += `${pad}${vfVar} = ArrowVectorField(\n`;
  s += `${inner}${fieldFn},\n`;
  s += `${inner}x_range=[${xMin}, ${xMax}, ${step}],\n`;
  s += `${inner}y_range=[${yMin}, ${yMax}, ${step}],\n`;
  s += `${inner}min_color_scheme_value=${cmin},\n`;
  s += `${inner}max_color_scheme_value=${cmax},\n`;
  s += `${inner}colors=${colorsPy},\n`;
  s += `${pad})\n`;
  s += `${pad}${vfVar}.fit_to_coordinate_system(${axVar})\n`;
  const arrowSw = Math.max(
    0,
    item.arrowStrokeWidth ?? DEFAULT_FIELD_ARROW_STROKE_WIDTH,
  );
  // Override Manim's per-arrow adaptive stroke scaling so each shaft lands at
  // the user-chosen thickness and matches the Konva preview. Also pin
  // `initial_stroke_width` on each child Arrow so subsequent scale calls do
  // not reset it back to Manim's default.
  s += `${pad}for _a in ${vfVar}.submobjects:\n`;
  s += `${inner}_a.set_stroke(width=${arrowSw})\n`;
  s += `${inner}if hasattr(_a, "initial_stroke_width"):\n`;
  s += `${innerDef}_a.initial_stroke_width = ${arrowSw}\n`;

  const seeds = item.streamPoints ?? [];
  if (seeds.length > 0) {
    const dt = item.streamDt ?? 0.05;
    const vt = item.streamVirtualTime ?? 3;
    const streamsVar = `${axVar}_streams_${suf}`;
    const rk4 = `${axVar}_rk4_${suf}`;
    s += `${pad}def ${rk4}(f, p, dt):\n`;
    s += `${inner}k1 = f(p)\n`;
    s += `${inner}k2 = f(p + dt / 2.0 * k1)\n`;
    s += `${inner}k3 = f(p + dt / 2.0 * k2)\n`;
    s += `${inner}k4 = f(p + dt * k3)\n`;
    s += `${inner}return p + (dt / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4)\n`;
    const strokeHex = FIELD_COLORMAP_HEX[cmap]?.[2] ?? '#22a884';
    const seedPairs = seeds.map((sp) => `(${sp.x}, ${sp.y})`).join(', ');
    const maxSteps = Math.max(2, Math.ceil(vt / dt) + 1);
    s += `${pad}${streamsVar} = VGroup()\n`;
    s += `${pad}for _sx, _sy in [${seedPairs}]:\n`;
    s += `${inner}_pts = []\n`;
    s += `${inner}_p = np.array([_sx, _sy, 0.0])\n`;
    s += `${inner}for _ in range(${maxSteps}):\n`;
    s += `${innerDef}_pts.append(${axVar}.coords_to_point(_p[0], _p[1]))\n`;
    s += `${innerDef}_p = ${rk4}(${fieldFn}, _p, ${dt})\n`;
    s += `${innerDef}if _p[0] < ${xMin} - 0.5 or _p[0] > ${xMax} + 0.5 or _p[1] < ${yMin} - 0.5 or _p[1] > ${yMax} + 0.5:\n`;
    s += `${innerDef}    break\n`;
    s += `${inner}if len(_pts) > 1:\n`;
    s += `${innerDef}_ln = VMobject()\n`;
    s += `${innerDef}_ln.set_points_smoothly(_pts)\n`;
    s += `${innerDef}_ln.set_stroke(color=ManimColor("${strokeHex}"), width=2)\n`;
    s += `${innerDef}${streamsVar}.add(_ln)\n`;
  }

  return s;
}

export function generateGraphFieldPlay(
  item: GraphFieldItem,
  axVar: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
  tailOpts?: BoundAudioTailOpts,
): string {
  if (item.fieldMode === 'none') return '';
  if (item.visibleAtSceneStart) return '';

  const pad = ' '.repeat(indent);
  const suf = pythonOverlaySuffix(item.id);
  const vfVar = `${axVar}_vf_${suf}`;
  const streamsVar = `${axVar}_streams_${suf}`;
  const seeds = item.streamPoints ?? [];

  let s = '';
  const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
  if (recorded) {
    const rt = recorded.runTime.toFixed(6);
    if (
      !audioItems?.length ||
      !boundSoundEmittedAtTrackStart(item, itemsMap, audioItems)
    ) {
      s += `${pad}self.add_sound("${recorded.soundPath}")\n`;
    }
    s += `${pad}self.play(Create(${vfVar}), run_time=${rt})\n`;
  } else {
    s += `${pad}self.play(Create(${vfVar}), run_time=${item.duration})\n`;
  }
  if (seeds.length > 0) {
    s += `${pad}self.play(Create(${streamsVar}))\n`;
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

export function countOverlaysReferencingAxes(
  axesId: ItemId,
  items: SceneItem[],
): number {
  let n = 0;
  for (const it of items) {
    if (
      it.kind === 'graphPlot' ||
      it.kind === 'graphCurve' ||
      it.kind === 'graphDot' ||
      it.kind === 'graphFunctionSeries' ||
      it.kind === 'graphArea'
    ) {
      if (it.axesId === axesId) n += 1;
    } else if (it.kind === 'graphField' && it.fieldMode !== 'none') {
      if (it.axesId === axesId) n += 1;
    }
  }
  return n;
}

function tmpAreaPlotVar(axVar: string, areaId: ItemId, tag: string): string {
  return `${axVar}_areaplot_${pythonOverlaySuffix(areaId)}_${tag}`;
}

function resolveGraphAreaCurve(
  item: GraphAreaItem,
  axVar: string,
  src: GraphAreaCurveSource,
  tag: string,
  pad: string,
  itemsMap: Map<ItemId, SceneItem>,
): { prelude: string; varName: string } {
  if (src.sourceKind === 'plot') {
    const p = itemsMap.get(src.plotId);
    if (!p || p.kind !== 'graphPlot' || p.axesId !== item.axesId) {
      throw new Error(
        `Graph area "${item.label || item.id}" references plot "${src.plotId}" that is missing or not on the same axes.`,
      );
    }
    return { prelude: '', varName: overlayPlotVar(axVar, src.plotId) };
  }
  const ex = (src.pyExpr ?? '0').trim() || '0';
  const v = tmpAreaPlotVar(axVar, item.id, tag);
  const prelude =
    `${pad}${v} = ${axVar}.plot(lambda x: (${ex}), color=${manimColor('#94a3b8')})\n` +
    `${pad}${v}.set_stroke(width=2)\n`;
  return { prelude, varName: v };
}

export function graphAreaBoundaryPlotVars(item: GraphAreaItem, axVar: string): string[] {
  const suf = pythonOverlaySuffix(item.id);
  const base = `${axVar}_areaplot_${suf}_`;
  const m = item.mode;
  if (m.areaKind === 'underCurve') {
    if (m.curve.sourceKind === 'expr' && m.showBoundaryPlot) return [`${base}c`];
    return [];
  }
  if (m.areaKind === 'betweenCurves') {
    const v: string[] = [];
    if (m.lower.sourceKind === 'expr' && m.showBoundaryPlot) v.push(`${base}l`);
    if (m.upper.sourceKind === 'expr' && m.showBoundaryPlot) v.push(`${base}u`);
    return v;
  }
  return [];
}

/**
 * After axes position + `plot`/`field`/`series` defs on this axes (needs referenced plot vars).
 */
export function generateGraphAreaDef(
  item: GraphAreaItem,
  axVar: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
): string {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 4);
  const areaVar = overlayAreaVar(axVar, item.id);
  const fillC = manimColor(item.fillColor);
  const op = Math.max(0, Math.min(1, item.fillOpacity)).toFixed(4);
  const strokeW = Math.max(0, item.strokeWidth ?? 0);
  const strokeC = manimColor(item.strokeColor);
  const suf = pythonOverlaySuffix(item.id);
  const mode = item.mode;

  let s = '';

  if (mode.areaKind === 'underCurve') {
    const { prelude, varName } = resolveGraphAreaCurve(item, axVar, mode.curve, 'c', pad, itemsMap);
    s += prelude;
    s += `${pad}${areaVar} = ${axVar}.get_area(${varName}, x_range=(${mode.xMin}, ${mode.xMax}), color=${fillC}, opacity=${op})\n`;
    return s;
  }

  if (mode.areaKind === 'betweenCurves') {
    const lo = resolveGraphAreaCurve(item, axVar, mode.lower, 'l', pad, itemsMap);
    const up = resolveGraphAreaCurve(item, axVar, mode.upper, 'u', pad, itemsMap);
    s += lo.prelude;
    s += up.prelude;
    s += `${pad}${areaVar} = ${axVar}.get_area(${lo.varName}, x_range=(${mode.xMin}, ${mode.xMax}), color=${fillC}, opacity=${op}, bounded_graph=${up.varName})\n`;
    return s;
  }

  if (mode.areaKind === 'parallelogramFour') {
    const pts = mode.corners
      .map((c) => `${inner}${axVar}.coords_to_point(${c.x}, ${c.y})`)
      .join(',\n');
    s += `${pad}${areaVar} = Polygon(\n${pts},\n${inner}fill_color=${fillC}, fill_opacity=${op}, stroke_width=${strokeW.toFixed(4)}, stroke_color=${strokeC}\n${pad})\n`;
    return s;
  }

  if (mode.areaKind === 'parallelogramVec') {
    const { ox, oy, ux, uy, vx, vy } = mode;
    const x0 = ox;
    const y0 = oy;
    const x1 = ox + ux;
    const y1 = oy + uy;
    const x2 = ox + ux + vx;
    const y2 = oy + uy + vy;
    const x3 = ox + vx;
    const y3 = oy + vy;
    s += `${pad}${areaVar} = Polygon(\n`;
    s += `${inner}${axVar}.coords_to_point(${x0}, ${y0}),\n`;
    s += `${inner}${axVar}.coords_to_point(${x1}, ${y1}),\n`;
    s += `${inner}${axVar}.coords_to_point(${x2}, ${y2}),\n`;
    s += `${inner}${axVar}.coords_to_point(${x3}, ${y3}),\n`;
    s += `${inner}fill_color=${fillC}, fill_opacity=${op}, stroke_width=${strokeW.toFixed(4)}, stroke_color=${strokeC}\n`;
    s += `${pad})\n`;
    return s;
  }

  if (mode.areaKind === 'disk') {
    const { cx, cy, radius: r } = mode;
    const cvar = `_gadisk_${suf}_c`;
    const rxv = `_gadisk_${suf}_rx`;
    const ryv = `_gadisk_${suf}_ry`;
    s += `${pad}${cvar} = np.array(${axVar}.coords_to_point(${cx}, ${cy}))\n`;
    s += `${pad}${rxv} = float(np.linalg.norm(np.array(${axVar}.coords_to_point(${cx + r}, ${cy})) - ${cvar}))\n`;
    s += `${pad}${ryv} = float(np.linalg.norm(np.array(${axVar}.coords_to_point(${cx}, ${cy + r})) - ${cvar}))\n`;
    s += `${pad}${areaVar} = Ellipse(\n`;
    s += `${inner}width=2 * ${rxv}, height=2 * ${ryv},\n`;
    s += `${inner}fill_color=${fillC}, fill_opacity=${op}, stroke_width=${strokeW.toFixed(4)}, stroke_color=${strokeC}\n`;
    s += `${pad})\n`;
    s += `${pad}${areaVar}.move_to(${cvar})\n`;
    return s;
  }

  return s;
}

/** Python class for sweep / rise entrances of graph areas (see `graphAreaRevealSource`). */
export const GRAPH_AREA_REVEAL_CLASS = '_AreaReveal';

/** True when some area enters with a sweep or rise (the scene then needs `_AreaReveal`). */
export function anyGraphAreaReveal(items: readonly SceneItem[]): boolean {
  return items.some((it) => it.kind === 'graphArea' && !it.visibleAtSceneStart && effectiveAreaIntroStyle(it) !== 'fade_in');
}

/**
 * `_AreaReveal(area, axes, upper, lower, x0, x1, style)`: redraws the area's outline every frame
 * from its boundary functions (graph coordinates) — x from `lo` to `hi`, filled from the lower
 * boundary `k` of the way to the upper one, as in `areaRevealWindow` — and ends on the exact
 * `get_area` shape, so exits and later animations see the usual mobject. An introducer like
 * `FadeIn`: inside a `Succession` the area is added only when its turn starts.
 */
export function graphAreaRevealSource(indent = 0): string {
  const p = ' '.repeat(indent);
  return [
    `class ${GRAPH_AREA_REVEAL_CLASS}(Animation):`,
    `    """Graph-area entrance: sweep from the left or right edge, or rise from the lower boundary."""`,
    `    def __init__(self, area, axes, upper, lower, x0, x1, style, samples=72, **kwargs):`,
    `        self._axes, self._upper, self._lower = axes, upper, lower`,
    `        self._x0, self._x1, self._style, self._samples = x0, x1, style, samples`,
    `        self._final = area.points.copy()`,
    `        super().__init__(area, introducer=True, **kwargs)`,
    ``,
    `    def interpolate_mobject(self, alpha):`,
    `        if alpha >= 1:`,
    `            self.mobject.set_points(self._final.copy())`,
    `            return`,
    `        a = min(1.0, max(1e-3, alpha))`,
    `        x0, x1 = self._x0, self._x1`,
    `        if self._style == "sweep_left":`,
    `            lo, hi, k = x1 - (x1 - x0) * a, x1, 1.0`,
    `        elif self._style == "rise":`,
    `            lo, hi, k = x0, x1, a`,
    `        else:`,
    `            lo, hi, k = x0, x0 + (x1 - x0) * a, 1.0`,
    `        n = self._samples`,
    `        xs = [lo + (hi - lo) * i / n for i in range(n + 1)]`,
    `        bottom = [float(self._lower(x)) for x in xs]`,
    `        top = [b + k * (float(self._upper(x)) - b) for x, b in zip(xs, bottom)]`,
    `        pts = [self._axes.c2p(x, y) for x, y in zip(xs, top)]`,
    `        pts += [self._axes.c2p(x, y) for x, y in zip(reversed(xs), reversed(bottom))]`,
    `        self.mobject.set_points_as_corners(pts + [pts[0]])`,
  ]
    .map((line) => (line ? p + line : line))
    .join('\n') + '\n';
}

function areaBoundaryLambda(src: GraphAreaCurveSource, itemsMap: Map<ItemId, SceneItem>): string {
  if (src.sourceKind === 'plot') {
    const plot = itemsMap.get(src.plotId);
    const expr = plot?.kind === 'graphPlot' ? plot.fn.pyExpr || 'x' : '0';
    return `lambda x: (${expr})`;
  }
  return `lambda x: (${(src.pyExpr ?? '0').trim() || '0'})`;
}

/**
 * The entrance animation of a graph area: `FadeIn(area)` or `_AreaReveal(...)` for a sweep /
 * rise, with `, run_time=…` when `runTime` is given.
 */
export function graphAreaIntroAnim(
  item: GraphAreaItem,
  axVar: string,
  itemsMap: Map<ItemId, SceneItem>,
  runTime?: string,
): string {
  const areaVar = overlayAreaVar(axVar, item.id);
  const rt = runTime != null ? `, run_time=${runTime}` : '';
  const style = effectiveAreaIntroStyle(item);
  const m = item.mode;
  if (style === 'fade_in' || !areaCanReveal(m)) return `FadeIn(${areaVar}${rt})`;
  const upper = areaBoundaryLambda(m.areaKind === 'underCurve' ? m.curve : m.upper, itemsMap);
  const lower = m.areaKind === 'underCurve' ? 'lambda x: 0.0' : areaBoundaryLambda(m.lower, itemsMap);
  return `${GRAPH_AREA_REVEAL_CLASS}(${areaVar}, ${axVar}, ${upper}, ${lower}, ${m.xMin}, ${m.xMax}, "${style}"${rt})`;
}

export function generateGraphAreaPlay(
  item: GraphAreaItem,
  axVar: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
  tailOpts?: BoundAudioTailOpts,
): string {
  const pad = ' '.repeat(indent);
  if (item.visibleAtSceneStart) return '';
  const boundaries = graphAreaBoundaryPlotVars(item, axVar);
  const bRt = Math.max(0.05, Math.min(0.75, item.duration * 0.35)).toFixed(4);

  let s = '';
  const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
  const rt = recorded ? recorded.runTime.toFixed(6) : item.duration.toFixed(6);

  if (
    recorded &&
    (!audioItems?.length || !boundSoundEmittedAtTrackStart(item, itemsMap, audioItems))
  ) {
    s += `${pad}self.add_sound("${recorded.soundPath}")\n`;
  }

  for (const bv of boundaries) {
    s += `${pad}self.play(Create(${bv}), run_time=${bRt})\n`;
  }

  if (recorded) {
    s += `${pad}self.play(${graphAreaIntroAnim(item, axVar, itemsMap)}, run_time=${rt})\n`;
    s += appendAudioTailAfterLeafPlayback(
      pad,
      recorded,
      item,
      itemsMap,
      audioItems,
      tailOpts,
    );
  } else {
    s += `${pad}self.play(${graphAreaIntroAnim(item, axVar, itemsMap)}, run_time=${item.duration})\n`;
  }

  return s;
}

export function validateAxesExit(
  axes: AxesItem,
  items: SceneItem[],
): string | null {
  const hasExit = items.some(
    (it) =>
      it.kind === 'exit_animation' &&
      it.targets.some(
        (t) => t.targetId === axes.id && t.animStyle !== 'none',
      ),
  );
  if (!hasExit) return null;
  if (countOverlaysReferencingAxes(axes.id, items) === 0) return null;
  return (
    `Axes "${axes.label || axes.id}" has an exit animation but graph overlays still reference it. ` +
    `Remove overlays or delete the exit clip.`
  );
}
