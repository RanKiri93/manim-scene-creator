import type {
  AudioTrackItem,
  AxesItem,
  ExitAnimStyle,
  GraphPlotItem,
  GraphDotItem,
  GraphFieldItem,
  GraphFunctionSeriesItem,
  GraphAreaItem,
  GraphAreaCurveSource,
  ItemId,
  SceneItem,
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
  let s = '';

  const [xMin, xMax, xStep] = item.xRange;
  const [yMin, yMax, yStep] = item.yRange;

  s += `${pad}${axVar} = Axes(\n`;
  s += `${inner}x_range=[${xMin}, ${xMax}, ${xStep}],\n`;
  s += `${inner}y_range=[${yMin}, ${yMax}, ${yStep}],\n`;
  s += `${inner}x_length=${((xMax - xMin) * item.scaleX).toFixed(2)},\n`;
  s += `${inner}y_length=${((yMax - yMin) * item.scaleY).toFixed(2)},\n`;

  if (item.includeNumbers) {
    s += `${inner}axis_config={"include_numbers": True}`;
    if (!item.includeTip) s += `, tips=False`;
    s += `,\n`;
  } else if (!item.includeTip) {
    s += `${inner}tips=False,\n`;
  }

  s += `${pad})\n`;

  if (item.xLabel) {
    s += `${pad}${axVar}_xlabel = ${axVar}.get_x_axis_label(${pythonStringLiteral(item.xLabel)})\n`;
  }
  if (item.yLabel) {
    s += `${pad}${axVar}_ylabel = ${axVar}.get_y_axis_label(${pythonStringLiteral(item.yLabel)})\n`;
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
        lines.push(`${pad}${axVar}.to_edge(${step.edge}, buff=${step.buff})`);
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
 */
export function resolveExitTargetsForExport(
  target: SceneItem,
  idToVarName: Map<ItemId, string>,
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
    return `${axVar}_fs_${suf}`;
  }
  if (target.kind === 'graphArea') {
    const axVar = idToVarName.get(target.axesId);
    if (!axVar) return null;
    return overlayAreaVar(axVar, target.id);
  }
  if (target.kind === 'shape') {
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

export function overlayAreaVar(axVar: string, itemId: ItemId): string {
  return `${axVar}_area_${pythonOverlaySuffix(itemId)}`;
}

/** After overlay defs + positioning; higher `zIndex` draws on top in Manim. */
export function generateGraphOverlayZIndexLines(
  ov:
    | GraphPlotItem
    | GraphDotItem
    | GraphFieldItem
    | GraphFunctionSeriesItem
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
  // `stroke_width=` on `Axes.plot` is not always honored (kwargs vs. VMobject init).
  // Setting width after construction matches Manim docs / common usage.
  return (
    `${pad}${pVar} = ${axVar}.plot(lambda x: ${fn.pyExpr || 'x'}, color=${manimColor(fn.color)}${xRangeKw})\n` +
    `${pad}${pVar}.set_stroke(width=${sw})\n`
  );
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

export function overlayDotVar(axVar: string, itemId: ItemId): string {
  return `${axVar}_dot_${pythonOverlaySuffix(itemId)}`;
}

export function generateGraphDotDef(
  item: GraphDotItem,
  axVar: string,
  indent: number,
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
    s += `${pad}${lblVar} = Text(${pythonStringLiteral(dot.label.trim())}, font_size=18)\n`;
  }
  return s;
}

/** Call after generateAxesPos for `axVar` so coords_to_point uses the final axes placement. */
export function generateGraphDotSnapToAxes(
  item: GraphDotItem,
  axVar: string,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const dVar = overlayDotVar(axVar, item.id);
  const dot = item.dot;
  let s = `${pad}${dVar}.move_to(${axVar}.coords_to_point(${dot.dx}, ${dot.dy}))\n`;
  if (dot.label.trim()) {
    const lblVar = `${dVar}_lbl`;
    s += `${pad}${lblVar}.next_to(${dVar}, ${dot.labelDir}, buff=0.15)\n`;
  }
  return s;
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
  const dVar = overlayDotVar(axVar, item.id);
  const dot = item.dot;
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
    s += `${pad}self.play(FadeIn(${dVar}), run_time=${rt})\n`;
    if (dot.label.trim()) {
      s += `${pad}self.play(Write(${dVar}_lbl))\n`;
    }
    s += appendAudioTailAfterLeafPlayback(
      pad,
      recorded,
      item,
      itemsMap,
      audioItems,
      tailOpts,
    );
  } else {
    s += `${pad}self.play(FadeIn(${dVar}), run_time=${item.duration})\n`;
    if (dot.label.trim()) {
      s += `${pad}self.play(Write(${dVar}_lbl))\n`;
    }
  }

  return s;
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

function graphAreaBoundaryPlotVars(item: GraphAreaItem, axVar: string): string[] {
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

export function generateGraphAreaPlay(
  item: GraphAreaItem,
  axVar: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
  tailOpts?: BoundAudioTailOpts,
): string {
  const pad = ' '.repeat(indent);
  const areaVar = overlayAreaVar(axVar, item.id);
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
    s += `${pad}self.play(FadeIn(${areaVar}), run_time=${rt})\n`;
    s += appendAudioTailAfterLeafPlayback(
      pad,
      recorded,
      item,
      itemsMap,
      audioItems,
      tailOpts,
    );
  } else {
    s += `${pad}self.play(FadeIn(${areaVar}), run_time=${item.duration})\n`;
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
