import type { ItemId, ShapeAnchor, ShapeEndpoints, ShapeItem, SceneItem, ShapePoint } from '@/types/scene';
import {
  ANGLE_MARK_SEGMENTS,
  isAngleMark,
  isBoundShape,
  isConnectorShape,
  OBJECT_ANCHOR_KINDS,
  RIGHT_ANGLE_TOLERANCE_DEG,
  TICK_HALF_LENGTH,
  TICK_SPACING,
  tangentSource,
} from '@/lib/shapeAnchors';
import {
  arcAngles,
  clampedCornerRadius,
  DASH_PATTERNS,
  innerRadiusOf,
  isArcKind,
  polygonSides,
  regularPolygonStartAngle,
  usesPoints,
} from '@/lib/shapeGeometry';
import { PLOT_SLOPE_STEP } from '@/lib/graphLiveValue';
import { resolvePosition } from '@/lib/resolvePosition';
import { emitNextToPython } from './nextToCodegen';
import { manimColor, overlayDotVar } from './graphCodegen';
import {
  type BoundAudioTailOpts,
  appendAudioTailAfterLeafPlayback,
  boundSoundEmittedAtTrackStart,
  resolveRecordedPlayback,
} from './lineCodegen';
import type { AudioTrackItem } from '@/types/scene';

function fillKwArgs(item: ShapeItem): string {
  if (item.shapeType === 'polyline' || item.shapeType === 'arc') {
    return ', fill_opacity=0';
  }
  if (item.fillColor?.trim()) {
    return `, fill_color=${manimColor(item.fillColor.trim())}, fill_opacity=${Math.max(0, Math.min(1, item.fillOpacity)).toFixed(4)}`;
  }
  return ', fill_opacity=0';
}

function effectivePolylinePoints(item: ShapeItem): ShapePoint[] {
  const p = item.points ?? [];
  if (p.length >= 2) return p;
  return [
    { x: 0, y: 0 },
    { x: 0.001, y: 0 },
  ];
}

/** Short segment near `to` along (from→to), for standalone Arrow tips without redrawing long edges. */
function tipSegmentForExport(
  from: ShapePoint,
  to: ShapePoint,
  len = 0.25,
): { start: ShapePoint; end: ShapePoint } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return null;
  const ux = dx / d;
  const uy = dy / d;
  const t = Math.min(len, d);
  return {
    start: { x: to.x - ux * t, y: to.y - uy * t },
    end: to,
  };
}

function pyCommentValue(value: unknown): string {
  return JSON.stringify(value).replace(/\r?\n/g, ' ');
}

export function generateShapeDef(
  item: ShapeItem,
  varName: string,
  indent: number,
): string {
  if (isConnectorShape(item)) return generateConnectorDef(item, varName, indent);
  if (isAngleMark(item)) {
    // Placeholder; the angle mark's updater draws it (`generateAngleMarkBind`).
    return `${' '.repeat(indent)}${varName} = VMobject(color=${manimColor(item.strokeColor)}, stroke_width=${item.strokeWidth.toFixed(4)}).set_points_as_corners([ORIGIN, RIGHT * 0.001])\n`;
  }
  const pad = ' '.repeat(indent);
  const stroke = manimColor(item.strokeColor);
  const sw = item.strokeWidth.toFixed(4);
  const fill = fillKwArgs(item);

  // Dashed / dotted outlines: the shape is redrawn as dashes (fill kept underneath).
  const dash = dashArgs(item);
  const styled = (ctor: string) => (dash ? `${SHAPE_DASHED_FN}(${ctor}, ${dash})` : ctor);
  switch (item.shapeType) {
    case 'circle':
      return `${pad}${varName} = ${styled(`Circle(radius=${item.radius.toFixed(4)}, color=${stroke}, stroke_width=${sw}${fill})`)}\n`;
    case 'ellipse':
      return `${pad}${varName} = ${styled(`Ellipse(width=${item.width.toFixed(4)}, height=${item.height.toFixed(4)}, color=${stroke}, stroke_width=${sw}${fill})`)}\n`;
    case 'rectangle': {
      const r = clampedCornerRadius(item);
      const ctor =
        r > 1e-6
          ? `RoundedRectangle(corner_radius=${r.toFixed(4)}, width=${item.width.toFixed(4)}, height=${item.height.toFixed(4)}, color=${stroke}, stroke_width=${sw}${fill})`
          : `Rectangle(width=${item.width.toFixed(4)}, height=${item.height.toFixed(4)}, color=${stroke}, stroke_width=${sw}${fill})`;
      return `${pad}${varName} = ${styled(ctor)}\n`;
    }
    case 'regularPolygon': {
      // Built around the origin with a flat bottom edge, then shifted (its box centre is not its centre).
      const n = polygonSides(item.sides);
      return `${pad}${varName} = ${styled(`RegularPolygon(n=${n}, radius=${item.radius.toFixed(4)}, start_angle=${regularPolygonStartAngle(n).toFixed(6)}, color=${stroke}, stroke_width=${sw}${fill})`)}\n`;
    }
    case 'polygon': {
      const pts = effectivePolylinePoints(item).map((p) => `[${p.x.toFixed(4)}, ${p.y.toFixed(4)}, 0]`).join(', ');
      return `${pad}${varName} = ${styled(`Polygon(${pts}, color=${stroke}, stroke_width=${sw}${fill})`)}\n`;
    }
    case 'arc':
    case 'sector': {
      // Built around the origin (the circle's centre), then shifted like a regular polygon.
      const { start, sweep } = arcAngles(item);
      const ang = `angle=${((sweep * Math.PI) / 180).toFixed(6)}, start_angle=${((start * Math.PI) / 180).toFixed(6)}`;
      const ctor =
        item.shapeType === 'arc'
          ? `Arc(radius=${item.radius.toFixed(4)}, ${ang}, color=${stroke}, stroke_width=${sw}${fill})`
          : `AnnularSector(inner_radius=${innerRadiusOf(item).toFixed(4)}, outer_radius=${item.radius.toFixed(4)}, ${ang}, color=${stroke}, stroke_width=${sw}${fill})`;
      return `${pad}${varName} = ${styled(ctor)}\n`;
    }
    case 'annulus':
      return `${pad}${varName} = ${styled(`Annulus(inner_radius=${innerRadiusOf(item).toFixed(4)}, outer_radius=${item.radius.toFixed(4)}, color=${stroke}, stroke_width=${sw}${fill})`)}\n`;
    case 'arrow': {
      const ex = item.endX.toFixed(4);
      const ey = item.endY.toFixed(4);
      const fill = item.fillColor?.trim() ? fillKwArgs(item) : '';
      return (
        `${pad}${varName} = Arrow(start=[0, 0, 0], end=[${ex}, ${ey}, 0], color=${stroke}, stroke_width=${sw}, buff=0${fill})\n`
      );
    }
    case 'line': {
      const ex = item.endX.toFixed(4);
      const ey = item.endY.toFixed(4);
      return `${pad}${varName} = ${styled(`Line(start=[0, 0, 0], end=[${ex}, ${ey}, 0], color=${stroke}, stroke_width=${sw})`)}\n`;
    }
    case 'polyline': {
      const pathVar = `_${varName}_path`;
      const pts = effectivePolylinePoints(item);
      const cornerLines = pts
        .map((p) => `    [${p.x.toFixed(4)}, ${p.y.toFixed(4)}, 0]`)
        .join(',\n');
      const strokeFill = fillKwArgs(item);
      let block = `${pad}${pathVar} = VMobject(color=${stroke}, stroke_width=${sw}${strokeFill})\n`;
      block += `${pad}${pathVar}.set_points_as_corners([\n${cornerLines}\n${pad}])\n`;
      if (dash) block += `${pad}${pathVar} = ${SHAPE_DASHED_FN}(${pathVar}, ${dash})\n`;

      const rawPts = item.points ?? [];
      const groupParts: string[] = [pathVar];

      if (item.headArrow && rawPts.length >= 2) {
        const seg = tipSegmentForExport(
          rawPts[rawPts.length - 2]!,
          rawPts[rawPts.length - 1]!,
        );
        if (seg) {
          const hv = `_${varName}_head`;
          const sx = seg.start.x.toFixed(4);
          const sy = seg.start.y.toFixed(4);
          const ex = seg.end.x.toFixed(4);
          const ey = seg.end.y.toFixed(4);
          block += `${pad}${hv} = Arrow(start=[${sx}, ${sy}, 0], end=[${ex}, ${ey}, 0], buff=0, color=${stroke}, stroke_width=${sw}, max_tip_length_to_length_ratio=1)\n`;
          block += `${pad}${hv}.set_stroke(opacity=0)\n`;
          groupParts.push(hv);
        }
      }
      if (item.tailArrow && rawPts.length >= 2) {
        const seg = tipSegmentForExport(rawPts[1]!, rawPts[0]!);
        if (seg) {
          const tv = `_${varName}_tail`;
          const sx = seg.start.x.toFixed(4);
          const sy = seg.start.y.toFixed(4);
          const ex = seg.end.x.toFixed(4);
          const ey = seg.end.y.toFixed(4);
          block += `${pad}${tv} = Arrow(start=[${sx}, ${sy}, 0], end=[${ex}, ${ey}, 0], buff=0, color=${stroke}, stroke_width=${sw}, max_tip_length_to_length_ratio=1)\n`;
          block += `${pad}${tv}.set_stroke(opacity=0)\n`;
          groupParts.push(tv);
        }
      }

      if (groupParts.length === 1) {
        block += `${pad}${varName} = ${pathVar}\n`;
      } else {
        block += `${pad}${varName} = VGroup(${groupParts.join(', ')})\n`;
      }
      return block;
    }
    default:
      return `${pad}${varName} = Circle(radius=0.25, color=${stroke}, stroke_width=${sw}${fill})\n`;
  }
}

export function generateShapePos(
  item: ShapeItem,
  varName: string,
  indent: number,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
): string {
  const pad = ' '.repeat(indent);
  // Connectors and angle marks are drawn by their updaters, not placed.
  if (isBoundShape(item)) return '';
  const lines: string[] = [
    `${pad}# timeline shape ${pyCommentValue({
      id: item.id,
      label: item.label,
      shapeType: item.shapeType,
      x: item.x,
      y: item.y,
      scale: item.scale,
      rotationDeg: item.rotationDeg,
      strokeWidth: item.strokeWidth,
      posSteps: item.posSteps,
    })}`,
  ];
  let emittedPlacement = false;

  for (let si = 0; si < item.posSteps.length; si++) {
    const step = item.posSteps[si]!;
    switch (step.kind) {
      case 'absolute':
        if (anchoredAtOrigin(item)) {
          lines.push(
            `${pad}${varName}.shift(${item.x.toFixed(6)}*RIGHT + ${item.y.toFixed(6)}*UP)`,
          );
        } else {
          lines.push(
            `${pad}${varName}.move_to([${item.x.toFixed(6)}, ${item.y.toFixed(6)}, 0])`,
          );
        }
        emittedPlacement = true;
        break;
      case 'next_to': {
        if (!step.refId) break;
        const refVar = idToVarName.get(step.refId);
        if (!refVar) break;
        const refItem = itemsMap.get(step.refId);
        if (!refItem) break;
        lines.push(
          emitNextToPython({
            varName,
            step,
            refVar,
            item,
            refItem,
            itemsMap,
            stepIndex: si,
            indent: pad,
          }),
        );
        emittedPlacement = true;
        break;
      }
      case 'to_edge':
        lines.push(
          `${pad}${varName}.to_edge(${step.edge}, buff=${Number.isFinite(step.buff) ? step.buff : 0.3})`,
        );
        emittedPlacement = true;
        break;
      case 'shift':
        lines.push(
          `${pad}${varName}.shift(${step.dx}*RIGHT + ${step.dy}*UP)`,
        );
        emittedPlacement = true;
        break;
      case 'set_x':
        lines.push(`${pad}${varName}.set_x(${step.x.toFixed(6)})`);
        emittedPlacement = true;
        break;
      case 'set_y':
        lines.push(`${pad}${varName}.set_y(${step.y.toFixed(6)})`);
        emittedPlacement = true;
        break;
    }
  }

  // Match canvas `resolvePosition`: if no placement ran, still apply store coords.
  if (!emittedPlacement) {
    if (anchoredAtOrigin(item)) {
      lines.push(
        `${pad}${varName}.shift(${item.x.toFixed(6)}*RIGHT + ${item.y.toFixed(6)}*UP)`,
      );
    } else {
      lines.push(
        `${pad}${varName}.move_to([${item.x.toFixed(6)}, ${item.y.toFixed(6)}, 0])`,
      );
    }
  }

  // Canvas anchors the arrow at the shaft midpoint (start+end)/2. Manim's Arrow includes the
  // tip in get_center(), so move_to/rotate/scale use a slightly offset pivot — visible on short arrows.
  if (item.shapeType === 'arrow') {
    const c0 = `_${varName}_shaft_c`;
    const s0 = `_${varName}_shaft_s`;
    lines.push(
      `${pad}${c0} = ${varName}.get_center()`,
      `${pad}${s0} = (${varName}.get_start() + ${varName}.get_end()) / 2`,
      `${pad}${varName}.shift(${c0} - ${s0})`,
    );
  }

  if (Math.abs(item.rotationDeg) > 1e-6) {
    // Canvas (Konva): +deg is clockwise. Manim: +deg is CCW in the xy plane (y up).
    const manimDeg = -item.rotationDeg;
    if (item.shapeType === 'arrow') {
      const rp = `_${varName}_shaft_rp`;
      lines.push(
        `${pad}${rp} = (${varName}.get_start() + ${varName}.get_end()) / 2`,
        `${pad}${varName}.rotate(${manimDeg.toFixed(4)} * DEGREES, about_point=${rp})`,
      );
    } else if (anchoredAtOrigin(item)) {
      const ap = resolvePosition(item, itemsMap);
      lines.push(
        `${pad}${varName}.rotate(${manimDeg.toFixed(4)} * DEGREES, about_point=[${ap.x.toFixed(6)}, ${ap.y.toFixed(6)}, 0])`,
      );
    } else {
      lines.push(
        `${pad}${varName}.rotate(${manimDeg.toFixed(4)} * DEGREES)`,
      );
    }
  }
  if (Math.abs(item.scale - 1) > 1e-6) {
    if (item.shapeType === 'arrow') {
      const sp = `_${varName}_shaft_sp`;
      lines.push(
        `${pad}${sp} = (${varName}.get_start() + ${varName}.get_end()) / 2`,
        `${pad}${varName}.scale(${item.scale.toFixed(6)}, about_point=${sp})`,
      );
    } else if (anchoredAtOrigin(item)) {
      const ap = resolvePosition(item, itemsMap);
      lines.push(
        `${pad}${varName}.scale(${item.scale.toFixed(6)}, about_point=[${ap.x.toFixed(6)}, ${ap.y.toFixed(6)}, 0])`,
      );
    } else {
      lines.push(`${pad}${varName}.scale(${item.scale.toFixed(6)})`);
    }
  }

  // A dashed arrow is dashed after placement: the shaft centring above needs the real Arrow.
  const dash = dashArgs(item);
  if (dash && item.shapeType === 'arrow') lines.push(`${pad}${varName} = ${SHAPE_DASHED_ARROW_FN}(${varName}, ${dash})`);

  return lines.join('\n') + (lines.length ? '\n' : '');
}

/** Shapes built around the origin and placed by shifting (points or a vertex-centred polygon). */
function anchoredAtOrigin(item: ShapeItem): boolean {
  return usesPoints(item) || item.shapeType === 'regularPolygon' || isArcKind(item);
}

export const SHAPE_DASHED_FN = '_dashed';
export const SHAPE_DASHED_ARROW_FN = '_dashed_arrow';

/** `period, ratio` for a dashed / dotted outline, or null when solid. */
function dashArgs(item: ShapeItem): string | null {
  if (!item.lineStyle || item.lineStyle === 'solid') return null;
  const { period, ratio } = DASH_PATTERNS[item.lineStyle];
  return `${period}, ${ratio}`;
}

/** True when some static shape is dashed or dotted (the scene then needs {@link shapeDashSource}). */
export function anyDashedShape(items: readonly SceneItem[]): boolean {
  return items.some((it) => it.kind === 'shape' && !!it.lineStyle && it.lineStyle !== 'solid' && !isBoundShape(it));
}

/**
 * `_dashed(m, period, ratio)`: every outline of `m` as dashes of that period (the share `ratio`
 * drawn), keeping its colour and width, with any fill kept underneath; `_dashed_arrow` dashes
 * the shaft and keeps the tip solid.
 */
export function shapeDashSource(indent = 0): string {
  const p = ' '.repeat(indent);
  return [
    `def ${SHAPE_DASHED_FN}(m, period, ratio):`,
    `    out = VGroup()`,
    `    for sub in m.family_members_with_points():`,
    `        if sub.get_fill_opacity() > 0:`,
    `            out.add(sub.copy().set_stroke(opacity=0))`,
    `        for path in sub.get_subpaths():`,
    `            piece = VMobject().set_points(path)`,
    `            n = max(2, int(round(piece.get_arc_length() / period)))`,
    `            d = DashedVMobject(piece, num_dashes=n, dashed_ratio=ratio)`,
    `            d.set_stroke(color=sub.get_stroke_color(), width=sub.get_stroke_width(), opacity=sub.get_stroke_opacity())`,
    `            d.set_fill(opacity=0)`,
    `            out.add(d)`,
    `    return out`,
    `def ${SHAPE_DASHED_ARROW_FN}(a, period, ratio):`,
    `    tips = a.pop_tips()`,
    `    return VGroup(${SHAPE_DASHED_FN}(a, period, ratio), *tips)`,
  ]
    .map((line) => p + line)
    .join('\n') + '\n';
}

export function generateShapePlay(
  item: ShapeItem,
  varName: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
  tailOpts?: BoundAudioTailOpts,
): string {
  const pad = ' '.repeat(indent);
  if (item.visibleAtSceneStart) return '';
  const intro =
    item.introStyle === 'fade_in' ? `FadeIn(${varName})` : `Create(${varName})`;
  const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
  if (recorded) {
    const rt = recorded.runTime.toFixed(6);
    const soundEarly =
      audioItems?.length &&
      boundSoundEmittedAtTrackStart(item, itemsMap, audioItems);
    return (
      (soundEarly ? '' : `${pad}self.add_sound("${recorded.soundPath}")\n`) +
      `${pad}self.play(${intro}, run_time=${rt})\n` +
      appendAudioTailAfterLeafPlayback(
        pad,
        recorded,
        item,
        itemsMap,
        audioItems,
        tailOpts,
      )
    );
  }
  const rt = Math.max(0.05, item.duration).toFixed(6);
  return `${pad}self.play(${intro}, run_time=${rt})\n`;
}

function pyNum(n: number): string {
  return Number.isFinite(n) ? n.toFixed(6) : '0.0';
}

/** Python expression for one connector anchor's live position (world coordinates). */
export function connectorAnchorExpr(
  anchor: ShapeAnchor,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
  ownerFrameCenter: { x: number; y: number },
): string {
  switch (anchor.kind) {
    case 'point':
      return `np.array([${pyNum(anchor.x + ownerFrameCenter.x)}, ${pyNum(anchor.y + ownerFrameCenter.y)}, 0.0])`;
    case 'graphPoint': {
      const axVar = idToVarName.get(anchor.axesId);
      if (!axVar || itemsMap.get(anchor.axesId)?.kind !== 'axes') {
        throw new Error(`Connector anchor axes "${anchor.axesId}" is missing.`);
      }
      return `${axVar}.c2p(${pyNum(anchor.x)}, ${pyNum(anchor.y)})`;
    }
    case 'graphDot':
    case 'graphDotFoot': {
      const dot = itemsMap.get(anchor.dotId);
      const axes = dot?.kind === 'graphDot' ? itemsMap.get(dot.axesId) : undefined;
      const axVar = dot?.kind === 'graphDot' ? idToVarName.get(dot.axesId) : undefined;
      if (dot?.kind !== 'graphDot' || axes?.kind !== 'axes' || !axVar) {
        throw new Error(`Connector anchor "${anchor.dotId}" is not a graph dot on exported axes.`);
      }
      const dVar = overlayDotVar(axVar, dot.id);
      if (anchor.kind === 'graphDot') return `${dVar}.get_center()`;
      // Same foot as `graphProjectionGuides`: 0 when inside the range, else the nearest range edge.
      const [lo, hi] = anchor.axis === 'y' ? axes.xRange : axes.yRange;
      const c = anchor.axis === 'y' ? '_c[0]' : '_c[1]';
      const foot =
        lo <= 0 && hi >= 0
          ? '0.0'
          : `(${pyNum(lo)} if abs(${c} - ${pyNum(lo)}) <= abs(${c} - ${pyNum(hi)}) else ${pyNum(hi)})`;
      return anchor.axis === 'y'
        ? `(lambda _c: ${axVar}.c2p(${foot}, _c[1]))(${axVar}.p2c(${dVar}.get_center()))`
        : `(lambda _c: ${axVar}.c2p(_c[0], ${foot}))(${axVar}.p2c(${dVar}.get_center()))`;
    }
    case 'object': {
      const target = itemsMap.get(anchor.itemId);
      const v = idToVarName.get(anchor.itemId);
      if (!target || !v || !OBJECT_ANCHOR_KINDS.has(target.kind) || isBoundShape(target)) {
        throw new Error(`Connector anchor "${anchor.itemId}" must be an exported text line, shape, image or axes.`);
      }
      const edge = anchor.edge ?? 'center';
      if (edge === 'center') return `${v}.get_center()`;
      return edge.length === 2 ? `${v}.get_corner(${edge})` : `${v}.get_edge_center(${edge})`;
    }
    default:
      throw new Error('Unknown connector anchor.');
  }
}

/**
 * Updater lines that set `_a`, `_b` to the tangent at the dot: the slope comes from the plot's
 * Python expression at the dot's current x, with the same step and domain clamp as the preview
 * (`resolveConnectorEndpoints`).
 */
function connectorTangentLines(
  endpoints: ShapeEndpoints,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
): string[] {
  const src = tangentSource(endpoints, itemsMap);
  if (src.error != null) throw new Error(src.error);
  const axVar = idToVarName.get(src.axes.id);
  if (!axVar) throw new Error(`Tangent axes "${src.axes.id}" are not exported.`);
  const [lo, hi] = src.domain;
  const h = Math.max(1e-9, (hi - lo) * PLOT_SLOPE_STEP);
  const half = (endpoints.tangent?.length ?? 0) / 2;
  const f = `(lambda x: (${(src.plot.fn.pyExpr || 'x').replace(/\s+/g, ' ')}))`;
  return [
    `_c = ${overlayDotVar(axVar, src.dot.id)}.get_center()`,
    `_x = ${axVar}.p2c(_c)[0]`,
    `_x0, _x1 = max(${pyNum(lo)}, _x - ${h.toExponential(6)}), min(${pyNum(hi)}, _x + ${h.toExponential(6)})`,
    `_f = ${f}`,
    `_d = ${axVar}.c2p(_x1, _f(_x1)) - ${axVar}.c2p(_x0, _f(_x0))`,
    `_d = _d / max(np.linalg.norm(_d), 1e-9) * ${pyNum(half)}`,
    '_a, _b = _c - _d, _c + _d',
  ];
}

export const ANGLE_MARK_FN = '_angle_mark_points';
export const TICK_MARKS_FN = '_tick_marks';

/** True when the scene needs {@link geometryMarksSource} (an angle mark or a connector with ticks). */
export function anyGeometryMarks(items: readonly SceneItem[]): boolean {
  return items.some((it) => isAngleMark(it) || (isConnectorShape(it) && (it.endpoints.ticks ?? 0) > 0));
}

/**
 * Python helpers matching `resolveAngleMark` and `tickSegments` in `src/lib/shapeAnchors.ts`: the
 * smaller angle at `v` as an arc of `r` (32 segments) or a square at a right angle, and 1–3
 * ticks across the middle of a segment.
 */
export function geometryMarksSource(indent = 0): string {
  const p = ' '.repeat(indent);
  return [
    `def ${ANGLE_MARK_FN}(v, p1, p2, r, mode):`,
    `    u1, u2 = p1 - v, p2 - v`,
    `    n1, n2 = np.linalg.norm(u1), np.linalg.norm(u2)`,
    `    if n1 < 1e-9 or n2 < 1e-9:`,
    `        return [v, v + RIGHT * 1e-4]`,
    `    u1, u2 = u1 / n1, u2 / n2`,
    `    theta = float(np.arccos(np.clip(np.dot(u1, u2), -1.0, 1.0)))`,
    `    if mode == "right" or (mode == "auto" and abs(theta * 180 / PI - 90) < ${RIGHT_ANGLE_TOLERANCE_DEG}):`,
    `        return [v + u1 * r, v + (u1 + u2) * r, v + u2 * r]`,
    `    sign = 1.0 if u1[0] * u2[1] - u1[1] * u2[0] >= 0 else -1.0`,
    `    a0 = float(np.arctan2(u1[1], u1[0]))`,
    `    return [v + r * np.array([np.cos(a0 + sign * theta * i / ${ANGLE_MARK_SEGMENTS}), np.sin(a0 + sign * theta * i / ${ANGLE_MARK_SEGMENTS}), 0.0]) for i in range(${ANGLE_MARK_SEGMENTS + 1})]`,
    `def ${TICK_MARKS_FN}(a, b, n, color, width):`,
    `    length = np.linalg.norm(b - a)`,
    `    if length < 1e-9:`,
    `        return []`,
    `    d = (b - a) / length`,
    `    nrm = np.array([-d[1], d[0], 0.0])`,
    `    mid = (a + b) / 2`,
    `    marks = []`,
    `    for i in range(n):`,
    `        c = mid + d * (i - (n - 1) / 2) * ${TICK_SPACING}`,
    `        marks.append(Line(c - nrm * ${TICK_HALF_LENGTH}, c + nrm * ${TICK_HALF_LENGTH}, color=color, stroke_width=width))`,
    `    return marks`,
  ]
    .map((line) => p + line)
    .join('\n') + '\n';
}

/**
 * Bind an angle mark to its three anchors, like a connector: its own updater redraws it while it
 * is on screen, and an always-present driver keeps it current before its intro.
 */
export function generateAngleMarkBind(
  item: ShapeItem,
  varName: string,
  indent: number,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
  ownerFrameCenter: { x: number; y: number },
): string {
  if (!item.angle) return '';
  const pad = ' '.repeat(indent);
  const a = item.angle;
  let v: string;
  let p1: string;
  let p2: string;
  try {
    v = connectorAnchorExpr(a.vertex, idToVarName, itemsMap, ownerFrameCenter);
    p1 = connectorAnchorExpr(a.from, idToVarName, itemsMap, ownerFrameCenter);
    p2 = connectorAnchorExpr(a.to, idToVarName, itemsMap, ownerFrameCenter);
  } catch (e) {
    throw new Error(`Angle mark "${item.label || item.id}": ${(e as Error).message}`);
  }
  const fn = `_${varName}_redraw`;
  const r = pyNum(Number.isFinite(a.radius) && a.radius > 0 ? a.radius : 0.4);
  return (
    `${pad}# angle mark ${pyCommentValue({ id: item.id, angle: item.angle })}\n` +
    `${pad}def ${fn}(m):\n` +
    `${pad}    _pts = ${ANGLE_MARK_FN}(${v}, ${p1}, ${p2}, ${r}, "${a.mark ?? 'auto'}")\n` +
    `${pad}    m.become(VMobject(color=m.get_color(), stroke_width=${item.strokeWidth.toFixed(4)}).set_points_as_corners(_pts))\n` +
    `${pad}${varName}.add_updater(${fn})\n` +
    `${pad}_${varName}_driver = Mobject()\n` +
    `${pad}_${varName}_driver.add_updater(lambda _d: None if ${varName} in self.mobjects else ${fn}(${varName}))\n` +
    `${pad}self.add(_${varName}_driver)\n` +
    `${pad}${fn}(${varName})\n`
  );
}

/** Placeholder mobject for a connector; its updater draws the real geometry (see below). */
export function generateConnectorDef(item: ShapeItem, varName: string, indent: number): string {
  const pad = ' '.repeat(indent);
  const ticks = connectorTicks(item);
  if (ticks > 0) {
    const tick = `Line(ORIGIN, RIGHT * 0.001, color=${manimColor(item.strokeColor)}, stroke_width=${item.strokeWidth.toFixed(4)})`;
    return `${pad}${varName} = VGroup(${connectorMobjectCall(item, 'ORIGIN', 'RIGHT * 0.001')}, ${Array.from({ length: ticks }, () => tick).join(', ')})\n`;
  }
  return `${pad}${varName} = ${connectorMobjectCall(item, 'ORIGIN', 'RIGHT * 0.001')}\n`;
}

/** Equal-length ticks on a connector, 0–3. */
function connectorTicks(item: ShapeItem): number {
  return Math.max(0, Math.min(3, Math.round(item.endpoints?.ticks ?? 0)));
}

function connectorMobjectCall(item: ShapeItem, a: string, b: string, color?: string): string {
  const stroke = color ?? manimColor(item.strokeColor);
  const sw = item.strokeWidth.toFixed(4);
  return item.shapeType === 'arrow'
    ? `Arrow(${a}, ${b}, color=${stroke}, stroke_width=${sw}, buff=0)`
    : `Line(${a}, ${b}, color=${stroke}, stroke_width=${sw})`;
}

/**
 * Bind a connector to its anchors. Emitted after every object is positioned and shifted into its
 * frame. The connector's own updater redraws it every frame while it is on screen; a driver that
 * is always in the scene keeps it current before its intro (intro animations suspend the
 * connector's own updaters and start from its geometry at that moment).
 */
export function generateConnectorBind(
  item: ShapeItem,
  varName: string,
  indent: number,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
  ownerFrameCenter: { x: number; y: number },
): string {
  if (!item.endpoints) return '';
  const pad = ' '.repeat(indent);
  const label = item.label || item.id;
  let ends: string[];
  try {
    ends = item.endpoints.tangent
      ? connectorTangentLines(item.endpoints, idToVarName, itemsMap)
      : [
          `_a = ${connectorAnchorExpr(item.endpoints.start, idToVarName, itemsMap, ownerFrameCenter)}`,
          `_b = ${connectorAnchorExpr(item.endpoints.end, idToVarName, itemsMap, ownerFrameCenter)}`,
        ];
  } catch (e) {
    throw new Error(`Connector "${label}": ${(e as Error).message}`);
  }
  const extend = item.endpoints.extend ?? 0;
  if (extend > 0) {
    ends.push(
      '_n = np.linalg.norm(_b - _a)',
      'if _n > 1e-9:',
      `    _e = (_b - _a) / _n * ${pyNum(extend)}`,
      '    _a, _b = _a - _e, _b + _e',
    );
  }
  const fn = `_${varName}_redraw`;
  const ticks = connectorTicks(item);
  return (
    `${pad}# connector ${pyCommentValue({ id: item.id, endpoints: item.endpoints })}\n` +
    `${pad}def ${fn}(m):\n` +
    ends.map((line) => `${pad}    ${line}\n`).join('') +
    `${pad}    if np.linalg.norm(_b - _a) < 1e-6:\n` +
    `${pad}        _b = _a + RIGHT * 1e-4\n` +
    // Keep the current colour so color animations on the connector persist.
    // With ticks the connector is a fixed group (line + ticks) whose parts are redrawn in place:
    // \`become\` into a group would add children that copy this updater and recurse.
    (ticks > 0
      ? `${pad}    _parts = [${connectorMobjectCall(item, '_a', '_b', 'm[0].get_color()')}] + ${TICK_MARKS_FN}(_a, _b, ${ticks}, m[0].get_color(), ${item.strokeWidth.toFixed(4)})\n` +
        `${pad}    for _old, _new in zip(m.submobjects, _parts):\n` +
        `${pad}        _old.become(_new)\n`
      : `${pad}    m.become(${connectorMobjectCall(item, '_a', '_b', 'm.get_color()')})\n`) +
    `${pad}${varName}.add_updater(${fn})\n` +
    `${pad}_${varName}_driver = Mobject()\n` +
    `${pad}_${varName}_driver.add_updater(lambda _d: None if ${varName} in self.mobjects else ${fn}(${varName}))\n` +
    `${pad}self.add(_${varName}_driver)\n` +
    `${pad}${fn}(${varName})\n`
  );
}
