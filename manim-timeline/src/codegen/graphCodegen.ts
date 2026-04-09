import type {
  AudioTrackItem,
  AxesItem,
  ExitAnimStyle,
  GraphPlotItem,
  GraphDotItem,
  GraphFieldItem,
  GraphSeriesVizItem,
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
  s += `${inner}x_length=${((xMax - xMin) * item.scale).toFixed(2)},\n`;
  s += `${inner}y_length=${((yMax - yMin) * item.scale).toFixed(2)},\n`;

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
): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  for (const step of item.posSteps) {
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
        lines.push(
          `${pad}${axVar}.next_to(${refVar}, ${step.dir}, buff=${step.buff})`,
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
  if (target.kind === 'graphSeriesViz') {
    const axVar = idToVarName.get(target.axesId);
    if (!axVar) return null;
    const suf = pythonOverlaySuffix(target.id);
    const ghostN = Math.max(0, Math.min(12, Math.floor(target.ghostCount ?? 0)));
    const parts: string[] = [`sv_main_${suf}`];
    if (ghostN > 0) parts.push(`sv_ghost_${suf}`);
    if (target.showHeadDot) parts.push(`sv_head_${suf}`);
    if (target.limitY !== null && Number.isFinite(target.limitY)) {
      parts.push(`sv_lim_${suf}`);
    }
    return parts.join(', ');
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

export function generateGraphPlotDef(
  item: GraphPlotItem,
  axVar: string,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const pVar = overlayPlotVar(axVar, item.id);
  const fn = item.fn;
  return `${pad}${pVar} = ${axVar}.plot(lambda x: ${fn.pyExpr || 'x'}, color=${manimColor(fn.color)})\n`;
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
  let line = `${pad}${dVar} = Dot(${axVar}.coords_to_point(${dot.dx}, ${dot.dy}), color=${manimColor(dot.color)}`;
  if (dot.radius !== 0.08) line += `, radius=${dot.radius}`;
  line += ')\n';
  let s = line;
  if (dot.label.trim()) {
    const lblVar = `${dVar}_lbl`;
    s += `${pad}${lblVar} = Text(${pythonStringLiteral(dot.label.trim())}, font_size=18)\n`;
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
    if (it.kind === 'graphPlot' || it.kind === 'graphDot' || it.kind === 'graphSeriesViz') {
      if (it.axesId === axesId) n += 1;
    } else if (it.kind === 'graphField' && it.fieldMode !== 'none') {
      if (it.axesId === axesId) n += 1;
    }
  }
  return n;
}

function seriesPyExpr(expr: string): string {
  const t = (expr ?? '').trim() || '0';
  return t.replace(/\n/g, ' ');
}

export function seriesRateFuncArg(easing: GraphSeriesVizItem['nEasing']): string {
  switch (easing) {
    case 'ease_out':
      return ', rate_func=ease_out_sine';
    case 'ease_in_out':
      return ', rate_func=smooth';
    default:
      return '';
  }
}

export function generateGraphSeriesVizDef(
  item: GraphSeriesVizItem,
  axVar: string,
  axItem: AxesItem,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 4);
  const inner2 = ' '.repeat(indent + 8);
  const inner3 = ' '.repeat(indent + 12);
  const suf = pythonOverlaySuffix(item.id);
  const [xMin, xMax] = axItem.xRange;
  const nMin = Math.round(item.nMin);
  const nMax = Math.round(item.nMax);
  const lo = Math.min(nMin, nMax);
  const hi = Math.max(nMin, nMax);
  const py = seriesPyExpr(item.pyExpr);
  const strokeW = Math.max(0.5, item.strokeWidth ?? 2);
  const strokeC = manimColor(item.strokeColor);
  const headC = manimColor(item.headColor);
  const discrete = item.nMapping === 'linear_discrete';
  const mode = item.vizMode;
  const steps = 100;
  const ghostN = Math.max(0, Math.min(12, Math.floor(item.ghostCount ?? 0)));

  let s = '';
  s += `${pad}n_min_${suf} = ${lo}\n`;
  s += `${pad}n_max_${suf} = ${hi}\n`;
  s += `${pad}x_min_${suf} = ${xMin}\n`;
  s += `${pad}x_max_${suf} = ${xMax}\n`;
  s += `${pad}sv_nt_${suf} = ValueTracker(${lo})\n`;

  if (mode === 'partialPlot') {
    s += `${pad}def sv_term_kx_${suf}(k, x):\n`;
    s += `${inner}return (${py})\n`;
  } else {
    s += `${pad}def sv_term_n_${suf}(n):\n`;
    s += `${inner}return (${py})\n`;
  }

  s += `${pad}def sv_poly_at_${suf}(n_end, opacity, width, color):\n`;
  s += `${inner}n_end = int(np.clip(n_end, n_min_${suf}, n_max_${suf}))\n`;
  s += `${inner}pts = []\n`;

  if (mode === 'sequence') {
    s += `${inner}for i in range(n_min_${suf}, n_end + 1):\n`;
    s += `${inner2}yv = sv_term_n_${suf}(i)\n`;
    s += `${inner2}pts.append(${axVar}.coords_to_point(i, yv))\n`;
  } else if (mode === 'series') {
    s += `${inner}acc = 0.0\n`;
    s += `${inner}for i in range(n_min_${suf}, n_end + 1):\n`;
    s += `${inner2}acc += sv_term_n_${suf}(i)\n`;
    s += `${inner2}pts.append(${axVar}.coords_to_point(i, acc))\n`;
  } else {
    s += `${inner}for sidx in range(${steps} + 1):\n`;
    s += `${inner2}t = sidx / ${steps}\n`;
    s += `${inner2}xv = x_min_${suf} + t * (x_max_${suf} - x_min_${suf})\n`;
    s += `${inner2}s = 0.0\n`;
    s += `${inner2}for k in range(n_min_${suf}, n_end + 1):\n`;
    s += `${inner3}s += sv_term_kx_${suf}(k, xv)\n`;
    s += `${inner2}pts.append(${axVar}.coords_to_point(xv, s))\n`;
  }

  s += `${inner}if len(pts) < 2:\n`;
  s += `${inner2}return VMobject()\n`;
  s += `${inner}m = VMobject()\n`;
  s += `${inner}m.set_points_as_corners(np.array(pts))\n`;
  s += `${inner}m.set_stroke(width=width, color=color, opacity=opacity)\n`;
  s += `${inner}return m\n`;

  s += `${pad}def sv_n_disc_${suf}():\n`;
  if (discrete) {
    s += `${inner}nf = float(sv_nt_${suf}.get_value())\n`;
    s += `${inner}return int(np.clip(np.floor(nf + 1e-9), n_min_${suf}, n_max_${suf}))\n`;
  } else {
    s += `${inner}nf = float(np.clip(sv_nt_${suf}.get_value(), n_min_${suf}, n_max_${suf}))\n`;
    s += `${inner}return int(np.clip(np.floor(nf + 1e-9), n_min_${suf}, n_max_${suf}))\n`;
  }

  s += `${pad}sv_main_${suf} = always_redraw(\n`;
  s += `${inner}lambda: sv_poly_at_${suf}(sv_n_disc_${suf}(), 1.0, ${strokeW}, ${strokeC})\n`;
  s += `${pad})\n`;

  if (ghostN > 0) {
    s += `${pad}sv_ghost_${suf} = VGroup()\n`;
    for (let g = 1; g <= ghostN; g++) {
      const op = 0.15 + (0.35 * (ghostN - g)) / Math.max(1, ghostN - 1);
      s += `${pad}sv_ghost_${suf}.add(\n`;
      s += `${inner}always_redraw(\n`;
      s += `${inner2}lambda g=${g}: sv_poly_at_${suf}(\n`;
      s += `${inner2}    max(n_min_${suf}, sv_n_disc_${suf}() - g),\n`;
      s += `${inner2}    ${op.toFixed(3)},\n`;
      s += `${inner2}    ${(strokeW * 0.85).toFixed(3)},\n`;
      s += `${inner2}    ${strokeC},\n`;
      s += `${inner2})\n`;
      s += `${inner})\n`;
      s += `${pad})\n`;
    }
  }

  if (item.showHeadDot) {
    s += `${pad}def sv_head_point_${suf}():\n`;
    s += `${inner}nf = float(np.clip(sv_nt_${suf}.get_value(), n_min_${suf}, n_max_${suf}))\n`;
    if (mode === 'partialPlot') {
      if (discrete) {
        s += `${inner}ni = sv_n_disc_${suf}()\n`;
        s += `${inner}xv = 0.5 * (x_min_${suf} + x_max_${suf})\n`;
        s += `${inner}s = 0.0\n`;
        s += `${inner}for k in range(n_min_${suf}, ni + 1):\n`;
        s += `${inner2}s += sv_term_kx_${suf}(k, xv)\n`;
        s += `${inner}return ${axVar}.coords_to_point(xv, s)\n`;
      } else {
        s += `${inner}i0 = int(np.clip(np.floor(nf), n_min_${suf}, n_max_${suf}))\n`;
        s += `${inner}i1 = int(np.clip(min(i0 + 1, n_max_${suf}), n_min_${suf}, n_max_${suf}))\n`;
        s += `${inner}frac = nf - i0\n`;
        s += `${inner}xv = 0.5 * (x_min_${suf} + x_max_${suf})\n`;
        s += `${inner}s0 = sum(sv_term_kx_${suf}(k, xv) for k in range(n_min_${suf}, i0 + 1))\n`;
        s += `${inner}s1 = sum(sv_term_kx_${suf}(k, xv) for k in range(n_min_${suf}, i1 + 1))\n`;
        s += `${inner}gy = s0 + frac * (s1 - s0)\n`;
        s += `${inner}return ${axVar}.coords_to_point(xv, gy)\n`;
      }
    } else if (discrete) {
      s += `${inner}ni = sv_n_disc_${suf}()\n`;
      if (mode === 'sequence') {
        s += `${inner}return ${axVar}.coords_to_point(ni, sv_term_n_${suf}(ni))\n`;
      } else {
        s += `${inner}acc = sum(sv_term_n_${suf}(j) for j in range(n_min_${suf}, ni + 1))\n`;
        s += `${inner}return ${axVar}.coords_to_point(ni, acc)\n`;
      }
    } else {
      s += `${inner}i0 = int(np.clip(np.floor(nf), n_min_${suf}, n_max_${suf}))\n`;
      s += `${inner}i1 = int(np.clip(min(i0 + 1, n_max_${suf}), n_min_${suf}, n_max_${suf}))\n`;
      s += `${inner}frac = nf - i0\n`;
      if (mode === 'sequence') {
        s += `${inner}y0 = sv_term_n_${suf}(i0)\n`;
        s += `${inner}y1 = sv_term_n_${suf}(i1)\n`;
        s += `${inner}gx = i0 + frac * (i1 - i0)\n`;
        s += `${inner}gy = y0 + frac * (y1 - y0)\n`;
        s += `${inner}return ${axVar}.coords_to_point(gx, gy)\n`;
      } else {
        s += `${inner}y0 = sum(sv_term_n_${suf}(j) for j in range(n_min_${suf}, i0 + 1))\n`;
        s += `${inner}y1 = sum(sv_term_n_${suf}(j) for j in range(n_min_${suf}, i1 + 1))\n`;
        s += `${inner}gx = i0 + frac * (i1 - i0)\n`;
        s += `${inner}gy = y0 + frac * (y1 - y0)\n`;
        s += `${inner}return ${axVar}.coords_to_point(gx, gy)\n`;
      }
    }
    s += `${pad}sv_head_${suf} = always_redraw(\n`;
    s += `${inner}lambda: Dot(sv_head_point_${suf}(), radius=0.08, color=${headC})\n`;
    s += `${pad})\n`;
  }

  if (item.limitY !== null && Number.isFinite(item.limitY)) {
    const L = item.limitY;
    s += `${pad}sv_lim_${suf} = DashedLine(\n`;
    s += `${inner}${axVar}.coords_to_point(x_min_${suf}, ${L}),\n`;
    s += `${inner}${axVar}.coords_to_point(x_max_${suf}, ${L}),\n`;
    s += `${inner}color=GRAY,\n`;
    s += `${inner}stroke_opacity=0.45,\n`;
    s += `${pad})\n`;
  }

  return s;
}

/** `self.add(...)` for series viz mobjects (before tracker play). */
export function buildGraphSeriesVizAddLine(
  item: GraphSeriesVizItem,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const suf = pythonOverlaySuffix(item.id);
  const ghostN = Math.max(0, Math.min(12, Math.floor(item.ghostCount ?? 0)));
  const addParts: string[] = [`sv_main_${suf}`];
  if (ghostN > 0) addParts.push(`sv_ghost_${suf}`);
  if (item.showHeadDot) addParts.push(`sv_head_${suf}`);
  if (item.limitY !== null && Number.isFinite(item.limitY)) addParts.push(`sv_lim_${suf}`);
  return `${pad}self.add(${addParts.join(', ')})\n`;
}

export function generateGraphSeriesVizPlay(
  item: GraphSeriesVizItem,
  _axVar: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
  tailOpts?: BoundAudioTailOpts,
): string {
  const pad = ' '.repeat(indent);
  const suf = pythonOverlaySuffix(item.id);
  const hi = Math.max(Math.round(item.nMin), Math.round(item.nMax));
  const rateArg = seriesRateFuncArg(item.nEasing);

  let s = '';
  const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
  const rt = recorded ? recorded.runTime.toFixed(6) : item.duration.toFixed(6);

  if (
    recorded &&
    (!audioItems?.length ||
      !boundSoundEmittedAtTrackStart(item, itemsMap, audioItems))
  ) {
    s += `${pad}self.add_sound("${recorded.soundPath}")\n`;
  }
  s += buildGraphSeriesVizAddLine(item, indent);
  s += `${pad}self.play(\n`;
  s += `${pad}    sv_nt_${suf}.animate.set_value(${hi}), run_time=${rt}${rateArg}\n`;
  s += `${pad})\n`;
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
