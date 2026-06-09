import { useCallback, useMemo } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Group, Rect, Line, Circle, Text, Ellipse, Arrow } from 'react-konva';
import type {
  AxesItem,
  GraphAreaCurveSource,
  GraphAreaItem,
  GraphFieldItem,
  ItemId,
  SceneItem,
} from '@/types/scene';
import { DEFAULT_FIELD_ARROW_STROKE_WIDTH, resolveGraphOverlayLineStyle } from '@/types/scene';
import type { GraphAxesDrawSlot } from '@/lib/graphPreview';
import {
  buildFunctionSeriesDrawSpec,
  functionSeriesDashArray,
} from '@/lib/functionSeriesPreview';
import { buildPointSequenceDrawSpec } from '@/lib/pointSequencePreview';
import { functionSeriesIsDisabled, pointSequenceIsDisabled } from '@/lib/graphPreview';
import { useDragSnap } from '@/canvas/hooks/useDragSnap';
import { FRAME_W, FRAME_H } from '@/lib/constants';
import { useSceneStore } from '@/store/useSceneStore';
import {
  evalGraphField,
  colorForMagnitude,
  rk4Step2d,
  manimArrowLengthScene,
} from '@/canvas/layers/graphFieldPreview';
import { FIELD_COLORMAP_HEX } from '@/codegen/fieldColormap';
import { createGraphStreamPoint } from '@/store/factories';
import {
  buildAxesCreatePreviewSpec,
  buildGraphDotPreviewSpec,
  buildPlotCreatePreviewSpec,
  buildCurveCreatePreviewSpec,
  clampedAxesZeroOffsets,
} from '@/lib/graphCreatePreview';
import {
  exitPreviewForTarget,
  type ExitPreviewState,
} from '@/lib/visualPlaybackPreview';

function evalGraphY(jsExpr: string, x: number): number | null {
  try {
    const y = new Function('x', `return ${jsExpr}`)(x) as number;
    return Number.isFinite(y) ? y : null;
  } catch {
    return null;
  }
}

function yFromAreaCurveSource(
  src: GraphAreaCurveSource,
  x: number,
  itemsMap: Map<ItemId, SceneItem>,
): number | null {
  if (src.sourceKind === 'plot') {
    const p = itemsMap.get(src.plotId);
    if (!p || p.kind !== 'graphPlot') return null;
    return evalGraphY(p.fn.jsExpr, x);
  }
  return evalGraphY(src.jsExpr, x);
}

function graphAreaPreviewPoints(
  area: GraphAreaItem,
  itemsMap: Map<ItemId, SceneItem>,
  xMin: number,
  xMax: number,
  _yMin: number,
  _yMax: number,
  toLocal: (gx: number, gy: number) => { lx: number; ly: number },
): number[] | null {
  const m = area.mode;
  const axLo = xMin;
  const axHi = xMax;

  if (m.areaKind === 'underCurve') {
    const xa = Math.max(axLo, Math.min(axHi, m.xMin));
    const xb = Math.max(axLo, Math.min(axHi, m.xMax));
    if (!(xb > xa)) return null;
    const steps = 80;
    const pts: number[] = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const gx = xa + t * (xb - xa);
      const y = yFromAreaCurveSource(m.curve, gx, itemsMap);
      if (y == null) continue;
      const { lx, ly } = toLocal(gx, y);
      pts.push(lx, ly);
    }
    if (pts.length < 4) return null;
    const br = toLocal(xb, 0);
    const bl = toLocal(xa, 0);
    return [...pts, br.lx, br.ly, bl.lx, bl.ly];
  }

  if (m.areaKind === 'betweenCurves') {
    const xa = Math.max(axLo, Math.min(axHi, m.xMin));
    const xb = Math.max(axLo, Math.min(axHi, m.xMax));
    if (!(xb > xa)) return null;
    const steps = 80;
    const lower: { lx: number; ly: number }[] = [];
    const upper: { lx: number; ly: number }[] = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const gx = xa + t * (xb - xa);
      const y1 = yFromAreaCurveSource(m.lower, gx, itemsMap);
      const y2 = yFromAreaCurveSource(m.upper, gx, itemsMap);
      if (y1 != null) lower.push(toLocal(gx, y1));
      if (y2 != null) upper.push(toLocal(gx, y2));
    }
    if (lower.length < 2 || upper.length < 2) return null;
    const pts: number[] = [];
    for (const p of lower) pts.push(p.lx, p.ly);
    for (let i = upper.length - 1; i >= 0; i--) {
      const p = upper[i]!;
      pts.push(p.lx, p.ly);
    }
    return pts;
  }

  if (m.areaKind === 'parallelogramFour') {
    return m.corners.flatMap((c) => {
      const p = toLocal(c.x, c.y);
      return [p.lx, p.ly];
    });
  }

  if (m.areaKind === 'parallelogramVec') {
    const { ox, oy, ux, uy, vx, vy } = m;
    const corners = [
      toLocal(ox, oy),
      toLocal(ox + ux, oy + uy),
      toLocal(ox + ux + vx, oy + uy + vy),
      toLocal(ox + vx, oy + vy),
    ];
    return corners.flatMap((p) => [p.lx, p.ly]);
  }

  return null;
}

interface GraphNodeProps {
  axes: AxesItem;
  drawOrder: GraphAxesDrawSlot[];
  field: GraphFieldItem | null;
  /** When set, clicks add streamline seeds to this field item. */
  streamPlacementFieldId: ItemId | null;
  isSelected: boolean;
  /** Hide editor chrome (bbox stroke, drag handle) and rely on parent to hide grid. */
  renderLikePreview?: boolean;
  canvasWidth: number;
  canvasHeight: number;
  resolvedX: number;
  resolvedY: number;
  frameOffset: { x: number; y: number };
  currentTime: number;
  itemsMap: Map<ItemId, SceneItem>;
}

export default function GraphNode({
  axes,
  drawOrder,
  field,
  streamPlacementFieldId,
  isSelected,
  renderLikePreview = false,
  canvasWidth,
  canvasHeight,
  resolvedX,
  resolvedY,
  frameOffset,
  currentTime,
  itemsMap,
}: GraphNodeProps) {
  const updateItem = useSceneStore((s) => s.updateItem);

  const pxPerUnitX = canvasWidth / FRAME_W;
  const pxPerUnitY = canvasHeight / FRAME_H;

  const canvasToManim = (cx: number, cy: number) => ({
    mx: (cx / canvasWidth - 0.5) * FRAME_W - frameOffset.x,
    my: (0.5 - cy / canvasHeight) * FRAME_H - frameOffset.y,
  });

  const placement = Boolean(streamPlacementFieldId) && isSelected;

  const { onDragStart, onDragMove, onDragEnd, draggable: baseDraggable } = useDragSnap({
    itemId: axes.id,
    posSteps: axes.posSteps,
    canvasToManim,
  });
  const draggable = baseDraggable && !placement;
  /** Bbox ignores pointer when a dedicated handle is used so drag always starts cleanly. */
  const bboxListening = placement || !draggable;

  const posX = (resolvedX / FRAME_W + 0.5) * canvasWidth;
  const posY = (0.5 - resolvedY / FRAME_H) * canvasHeight;

  const [xMin, xMax] = axes.xRange;
  const [yMin, yMax] = axes.yRange;
  const axW = (xMax - xMin) * axes.scaleX * pxPerUnitX;
  const axH = (yMax - yMin) * axes.scaleY * pxPerUnitY;

  const { ox, oy } = clampedAxesZeroOffsets({
    xRange: axes.xRange,
    yRange: axes.yRange,
    axW,
    axH,
  });

  const axesPreviewSpec = useMemo(
    () =>
      buildAxesCreatePreviewSpec({
        axes,
        time: currentTime,
        itemsMap,
        axW,
        axH,
        ox,
        oy,
        xMin,
        xMax,
        yMin,
        yMax,
        scenePxPerUnit: (pxPerUnitX + pxPerUnitY) / 2,
        pxPerUnitX: pxPerUnitX,
        pxPerUnitY: pxPerUnitY,
      }),
    [
      axes,
      currentTime,
      itemsMap,
      axW,
      axH,
      ox,
      oy,
      xMin,
      xMax,
      yMin,
      yMax,
      pxPerUnitX,
      pxPerUnitY,
    ],
  );

  const plotPolyline = (jsExpr: string, xLo: number, xHi: number): number[] => {
    const points: number[] = [];
    const steps = 200;
    const span = xMax - xMin;
    if (!(span > 0) || !(xHi > xLo)) return points;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = xLo + t * (xHi - xLo);
      let y: number;
      try {
        y = new Function('x', `return ${jsExpr}`)(x) as number;
      } catch {
        continue;
      }
      if (!isFinite(y)) continue;
      const px = -axW / 2 + ((x - xMin) / span) * axW;
      const py = -axH / 2 + (1 - (y - yMin) / (yMax - yMin)) * axH;
      points.push(px, py);
    }
    return points;
  };

  const toLocal = useCallback(
    (gx: number, gy: number) => {
      const lx = -axW / 2 + ((gx - xMin) / (xMax - xMin)) * axW;
      const ly = -axH / 2 + (1 - (gy - yMin) / (yMax - yMin)) * axH;
      return { lx, ly };
    },
    [axW, axH, xMin, xMax, yMin, yMax],
  );

  const curvePolyline = (
    jsXExpr: string,
    jsYExpr: string,
    tLo: number,
    tHi: number,
  ): number[] => {
    const points: number[] = [];
    const steps = 200;
    if (!(tHi > tLo)) return points;
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const tPar = tLo + u * (tHi - tLo);
      let gx: number;
      let gy: number;
      try {
        gx = new Function('t', `return ${jsXExpr}`)(tPar) as number;
        gy = new Function('t', `return ${jsYExpr}`)(tPar) as number;
      } catch {
        continue;
      }
      if (!isFinite(gx) || !isFinite(gy)) continue;
      const { lx, ly } = toLocal(gx, gy);
      points.push(lx, ly);
    }
    return points;
  };

  const fieldMode = field?.fieldMode ?? 'none';
  const cmin = field?.colorSchemeMin ?? 0;
  const cmax = field?.colorSchemeMax ?? 2;
  const cmap = field?.fieldColormap;

  const fieldArrows = useMemo(() => {
    // TODO(animation): fade in / stagger these arrows over the field's
    // effective run_time (currentTime - effectiveStart(field)) so the preview
    // mirrors the Create(vf) animation emitted by graphCodegen. Kept static
    // here for now — see plan "Align field preview with render".
    if (!field || fieldMode === 'none')
      return [] as { key: string; points: number[]; color: string }[];

    const xSpan = xMax - xMin;
    const ySpan = yMax - yMin;
    const step = Math.max(0.05, field.fieldGridStep ?? 0.5);

    // Match Manim's `x_range=[xMin,xMax,step]`/`y_range=[...]` sampling:
    // inclusive sample count on each axis.
    let nx = Math.max(1, Math.round(xSpan / step));
    let ny = Math.max(1, Math.round(ySpan / step));
    // Performance safety cap: coarsen proportionally while preserving the
    // step ratio so the grid stays visually regular.
    const maxCells = 2000;
    if ((nx + 1) * (ny + 1) > maxCells) {
      const scale = Math.sqrt(maxCells / ((nx + 1) * (ny + 1)));
      nx = Math.max(4, Math.floor(nx * scale));
      ny = Math.max(4, Math.floor(ny * scale));
    }

    const dx = xSpan / nx;
    const dy = ySpan / ny;
    const pxPerX = axW / xSpan;
    const pxPerY = axH / ySpan;

    const out: { key: string; points: number[]; color: string }[] = [];
    let ki = 0;
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= ny; j++) {
        const x = xMin + i * dx;
        const y = yMin + j * dy;
        const v = evalGraphField(field, x, y);
        if (!v) continue;
        const [vx, vy] = v;
        const { lx, ly } = toLocal(x, y);

        // Compute arrow delta in axes-local pixels.
        // - slope mode: `evalGraphField` already returns a vector of target
        //   data-length `slopeArrowLength`, so just map data->pixels.
        // - vector mode: mirror Manim's
        //     length_func(norm) = 0.45 * sigmoid(norm)
        //   applied to the unit direction in scene units, then
        //   `fit_to_coordinate_system` multiplies by the axes unit sizes.
        let dpx: number;
        let dpy: number;
        const mag = Math.hypot(vx, vy);
        if (fieldMode === 'slope') {
          dpx = vx * pxPerX;
          dpy = -vy * pxPerY;
        } else if (mag > 1e-9) {
          const Lscene = manimArrowLengthScene(mag);
          const ux = vx / mag;
          const uy = vy / mag;
          dpx = Lscene * ux * pxPerX;
          dpy = -Lscene * uy * pxPerY;
        } else {
          dpx = 0;
          dpy = 0;
        }

        const ex = lx + dpx;
        const ey = ly + dpy;
        const color = colorForMagnitude(mag, cmap, cmin, cmax);
        out.push({
          key: `fa-${ki++}`,
          points: [lx, ly, ex, ey],
          color,
        });
      }
    }
    return out;
  }, [field, fieldMode, xMin, xMax, yMin, yMax, axW, axH, toLocal, cmap, cmin, cmax]);

  const streamPreviewLines = useMemo(() => {
    // TODO(animation): in a future pass, reveal each streamline progressively
    // (trim endpoints by `currentTime - effectiveStart(field)` over the stream
    // run_time) to match the Create(streams) animation in graphCodegen.
    if (!field || fieldMode === 'none') return [] as { key: string; points: number[] }[];
    const seeds = field.streamPoints ?? [];
    if (seeds.length === 0) return [];
    const dt = field.streamDt ?? 0.05;
    const vt = field.streamVirtualTime ?? 3;
    const maxSteps = Math.max(2, Math.ceil(vt / dt) + 1);
    const pad = 0.5;
    const fx = (x: number, y: number) => evalGraphField(field, x, y);
    const lines: { key: string; points: number[] }[] = [];
    seeds.forEach((seed, si) => {
      const pts: number[] = [];
      let x = seed.x;
      let y = seed.y;
      for (let k = 0; k < maxSteps; k++) {
        const { lx, ly } = toLocal(x, y);
        pts.push(lx, ly);
        const next = rk4Step2d(fx, x, y, dt);
        if (!next) break;
        x = next[0];
        y = next[1];
        if (
          x < xMin - pad ||
          x > xMax + pad ||
          y < yMin - pad ||
          y > yMax + pad
        ) {
          break;
        }
      }
      if (pts.length >= 4) {
        lines.push({ key: `sl-${seed.id ?? si}`, points: pts });
      }
    });
    return lines;
  }, [field, fieldMode, xMin, xMax, yMin, yMax, toLocal]);

  const onAxesClick = useCallback(
    (ev: KonvaEventObject<MouseEvent>) => {
      if (!placement || !streamPlacementFieldId) return;
      ev.cancelBubble = true;
      const rect = ev.target;
      const pos = rect.getRelativePointerPosition();
      if (!pos) return;
      const rx = pos.x;
      const ry = pos.y;
      const gx = xMin + (rx / axW) * (xMax - xMin);
      const gy = yMax - (ry / axH) * (yMax - yMin);
      const sp = createGraphStreamPoint();
      sp.x = gx;
      sp.y = gy;
      const target = useSceneStore.getState().items.get(streamPlacementFieldId);
      if (target?.kind !== 'graphField') return;
      updateItem(streamPlacementFieldId, {
        streamPoints: [...(target.streamPoints ?? []), sp],
      });
    },
    [
      placement,
      streamPlacementFieldId,
      axW,
      axH,
      xMin,
      xMax,
      yMin,
      yMax,
      updateItem,
    ],
  );

  const hideEditorChrome = renderLikePreview && !placement;

  return (
    <Group
      x={posX}
      y={posY}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
    >
      <Rect
        x={-axW / 2}
        y={-axH / 2}
        width={axW}
        height={axH}
        fill="rgba(0,0,0,0.001)"
        stroke={
          hideEditorChrome
            ? 'transparent'
            : isSelected
              ? '#3b82f6'
              : !draggable
                ? '#d97706'
                : '#475569'
        }
        strokeWidth={hideEditorChrome ? 0 : isSelected ? 2 : 1}
        dash={hideEditorChrome ? undefined : !draggable ? [6, 3] : undefined}
        cornerRadius={2}
        listening={bboxListening}
        onClick={placement ? onAxesClick : undefined}
      />

      {axesPreviewSpec.xAxisPoints.length >= 4 ? (
        axes.includeTip ? (
          <Arrow
            points={axesPreviewSpec.xAxisPoints}
            stroke={axesPreviewSpec.axisStrokeColor}
            fill={axesPreviewSpec.axisStrokeColor}
            strokeWidth={axesPreviewSpec.axisStrokeWidth}
            pointerLength={axesPreviewSpec.xPointerLength}
            pointerWidth={axesPreviewSpec.xPointerWidth}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
        ) : (
        <Line
          points={axesPreviewSpec.xAxisPoints}
          stroke={axesPreviewSpec.axisStrokeColor}
          strokeWidth={axesPreviewSpec.axisStrokeWidth}
          lineCap="round"
          listening={false}
        />
        )
      ) : null}
      {axesPreviewSpec.yAxisPoints.length >= 4 ? (
        axes.includeTip ? (
          <Arrow
            points={axesPreviewSpec.yAxisPoints}
            stroke={axesPreviewSpec.axisStrokeColor}
            fill={axesPreviewSpec.axisStrokeColor}
            strokeWidth={axesPreviewSpec.axisStrokeWidth}
            pointerLength={axesPreviewSpec.yPointerLength}
            pointerWidth={axesPreviewSpec.yPointerWidth}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
        ) : (
        <Line
          points={axesPreviewSpec.yAxisPoints}
          stroke={axesPreviewSpec.axisStrokeColor}
          strokeWidth={axesPreviewSpec.axisStrokeWidth}
          lineCap="round"
          listening={false}
        />
        )
      ) : null}

      <Group listening={false}>
        {axesPreviewSpec.tickOpacity > 0
          ? axesPreviewSpec.xTickSegments.map((seg, i) => (
              <Line
                key={`xt-${i}`}
                points={seg}
                stroke={axesPreviewSpec.tickStrokeColor}
                strokeWidth={axesPreviewSpec.tickStrokeWidth}
                opacity={axesPreviewSpec.tickOpacity}
                lineCap="round"
                listening={false}
              />
            ))
          : null}
        {axesPreviewSpec.tickOpacity > 0
          ? axesPreviewSpec.yTickSegments.map((seg, i) => (
              <Line
                key={`yt-${i}`}
                points={seg}
                stroke={axesPreviewSpec.tickStrokeColor}
                strokeWidth={axesPreviewSpec.tickStrokeWidth}
                opacity={axesPreviewSpec.tickOpacity}
                lineCap="round"
                listening={false}
              />
            ))
          : null}
        {axesPreviewSpec.xNumberLabels.map((lbl) => (
          <Text
            key={lbl.key}
            x={lbl.x - lbl.text.length * axesPreviewSpec.numberFontSize * 0.25}
            y={lbl.y}
            text={lbl.text}
            fontSize={axesPreviewSpec.numberFontSize}
            fill={axesPreviewSpec.numberColor}
            opacity={axesPreviewSpec.tickOpacity}
            listening={false}
          />
        ))}
        {axesPreviewSpec.yNumberLabels.map((lbl) => (
          <Text
            key={lbl.key}
            x={lbl.x - lbl.text.length * axesPreviewSpec.numberFontSize * 0.25}
            y={lbl.y}
            text={lbl.text}
            fontSize={axesPreviewSpec.numberFontSize}
            fill={axesPreviewSpec.numberColor}
            opacity={axesPreviewSpec.tickOpacity}
            listening={false}
          />
        ))}
        {axesPreviewSpec.xAxisLabel && axesPreviewSpec.xLabelOpacity > 0 ? (
          <Text
            x={axesPreviewSpec.xAxisLabel.x}
            y={axesPreviewSpec.xAxisLabel.y}
            text={axesPreviewSpec.xAxisLabel.text}
            fontSize={axesPreviewSpec.axisLabelFontSize}
            fill={axesPreviewSpec.axisLabelColor}
            opacity={axesPreviewSpec.xLabelOpacity}
            align="right"
            listening={false}
          />
        ) : null}
        {axesPreviewSpec.yAxisLabel && axesPreviewSpec.yLabelOpacity > 0 ? (
          <Text
            x={axesPreviewSpec.yAxisLabel.x}
            y={axesPreviewSpec.yAxisLabel.y}
            text={axesPreviewSpec.yAxisLabel.text}
            fontSize={axesPreviewSpec.axisLabelFontSize}
            fill={axesPreviewSpec.axisLabelColor}
            opacity={axesPreviewSpec.yLabelOpacity}
            align="left"
            listening={false}
          />
        ) : null}
      </Group>

      {axesPreviewSpec.revealHead ? (
        <Circle
          x={axesPreviewSpec.revealHead.x}
          y={axesPreviewSpec.revealHead.y}
          radius={4}
          stroke="#ffffff"
          strokeWidth={1.5}
          fill="#fbbf24"
          listening={false}
        />
      ) : null}

      {drawOrder.map((slot) => {
        const key = `${slot.kind}-${slot.id}`;
        if (slot.kind === 'area') {
          const it = itemsMap.get(slot.id);
          if (!it || it.kind !== 'graphArea') return null;
          const exit = exitPreviewForTarget(it.id, currentTime, itemsMap);
          const fill = it.fillColor;
          const fo = Math.max(0, Math.min(1, it.fillOpacity));
          const sw = Math.max(0, it.strokeWidth);
          const sc = it.strokeColor;
          const m = it.mode;
          if (m.areaKind === 'disk') {
            const c = toLocal(m.cx, m.cy);
            const pr = toLocal(m.cx + m.radius, m.cy);
            const pu = toLocal(m.cx, m.cy + m.radius);
            const rx = Math.hypot(pr.lx - c.lx, pr.ly - c.ly);
            const ry = Math.hypot(pu.lx - c.lx, pu.ly - c.ly);
            if (!(rx > 0.5 && ry > 0.5)) return null;
            return (
              <GraphPlaybackWrap key={key} exit={exit}>
              <Ellipse
                x={c.lx}
                y={c.ly}
                radiusX={rx}
                radiusY={ry}
                fill={fill}
                opacity={fo}
                stroke={sc}
                strokeWidth={sw}
                listening={false}
              />
              </GraphPlaybackWrap>
            );
          }
          const poly = graphAreaPreviewPoints(it, itemsMap, xMin, xMax, yMin, yMax, toLocal);
          if (!poly || poly.length < 6) return null;
          return (
            <GraphPlaybackWrap key={key} exit={exit}>
            <Line
              points={poly}
              closed
              fill={fill}
              opacity={fo}
              stroke={sw > 0 ? sc : undefined}
              strokeWidth={sw}
              listening={false}
            />
            </GraphPlaybackWrap>
          );
        }
        if (slot.kind === 'plot') {
          const it = itemsMap.get(slot.id);
          if (!it || it.kind !== 'graphPlot') return null;
          const exit = exitPreviewForTarget(it.id, currentTime, itemsMap);
          const xd = it.xDomain;
          const xLo = xd == null ? xMin : Math.min(xd[0], xd[1]);
          const xHi = xd == null ? xMax : Math.max(xd[0], xd[1]);
          const pts = plotPolyline(it.fn.jsExpr, xLo, xHi);
          if (pts.length < 4) return null;
          const plotPreview = buildPlotCreatePreviewSpec({
            plot: it,
            time: currentTime,
            itemsMap,
            fullPoints: pts,
          });
          if (plotPreview.points.length < 4) return null;
          return (
            <GraphPlaybackWrap key={key} exit={exit}>
            <Group listening={false}>
              <Line
                points={plotPreview.points}
                stroke={it.fn.color}
                strokeWidth={Math.max(0, it.strokeWidth)}
                lineCap="round"
                lineJoin="round"
                dash={functionSeriesDashArray(
                  resolveGraphOverlayLineStyle(it.lineStyle),
                  Math.max(0, it.strokeWidth),
                )}
                listening={false}
              />
              {plotPreview.revealHead ? (
                <Circle
                  x={plotPreview.revealHead.x}
                  y={plotPreview.revealHead.y}
                  radius={4}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  fill={it.fn.color}
                  listening={false}
                />
              ) : null}
            </Group>
            </GraphPlaybackWrap>
          );
        }
        if (slot.kind === 'curve') {
          const it = itemsMap.get(slot.id);
          if (!it || it.kind !== 'graphCurve') return null;
          const exit = exitPreviewForTarget(it.id, currentTime, itemsMap);
          const td = it.tDomain;
          const tLo = Math.min(td[0], td[1]);
          const tHi = Math.max(td[0], td[1]);
          const pts = curvePolyline(
            it.curve.jsXExpr,
            it.curve.jsYExpr,
            tLo,
            tHi,
          );
          if (pts.length < 4) return null;
          const curvePreview = buildCurveCreatePreviewSpec({
            curveItem: it,
            time: currentTime,
            itemsMap,
            fullPoints: pts,
          });
          if (curvePreview.points.length < 4) return null;
          const strokeCol =
            typeof it.curve.color === 'string' && it.curve.color.trim()
              ? it.curve.color.trim()
              : '#3b82f6';
          return (
            <GraphPlaybackWrap key={key} exit={exit}>
              <Group listening={false}>
                <Line
                  points={curvePreview.points}
                  stroke={strokeCol}
                  strokeWidth={Math.max(0, it.strokeWidth)}
                  lineCap="round"
                  lineJoin="round"
                  dash={functionSeriesDashArray(
                    resolveGraphOverlayLineStyle(it.lineStyle),
                    Math.max(0, it.strokeWidth),
                  )}
                  listening={false}
                />
                {curvePreview.revealHead ? (
                  <Circle
                    x={curvePreview.revealHead.x}
                    y={curvePreview.revealHead.y}
                    radius={4}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                    fill={strokeCol}
                    listening={false}
                  />
                ) : null}
              </Group>
            </GraphPlaybackWrap>
          );
        }
        if (slot.kind === 'field' && field && field.id === slot.id) {
          const exit = exitPreviewForTarget(field.id, currentTime, itemsMap);
          const streamStroke =
            FIELD_COLORMAP_HEX[field.fieldColormap ?? 'viridis']?.[2] ??
            '#22a884';
          const arrowSw = Math.max(
            0,
            field.arrowStrokeWidth ?? DEFAULT_FIELD_ARROW_STROKE_WIDTH,
          );
          // Head scales with shaft width so thicker arrows get proportional
          // pointers instead of stubby caps. Clamped so it never exceeds
          // half the arrow length on small arrows.
          const headBase = Math.max(3, arrowSw * 1.6);
          return (
            <GraphPlaybackWrap key={key} exit={exit}>
            <Group listening={false}>
              {fieldArrows.map((a) => {
                const [sx, sy, ex, ey] = a.points;
                const plen = Math.hypot(ex - sx, ey - sy);
                // Below ~3px the arrowhead would dwarf the shaft and look
                // like noise; fall back to a plain segment.
                if (plen < 3) {
                  return (
                    <Line
                      key={a.key}
                      points={a.points}
                      stroke={a.color}
                      strokeWidth={arrowSw}
                      lineCap="round"
                      listening={false}
                    />
                  );
                }
                const pointerLen = Math.min(headBase, plen * 0.5);
                return (
                  <Arrow
                    key={a.key}
                    points={a.points}
                    fill={a.color}
                    stroke={a.color}
                    strokeWidth={arrowSw}
                    pointerLength={pointerLen}
                    pointerWidth={pointerLen}
                    lineCap="round"
                    lineJoin="round"
                    listening={false}
                  />
                );
              })}
              {streamPreviewLines.map((sl) => (
                <Line
                  key={sl.key}
                  points={sl.points}
                  stroke={streamStroke}
                  strokeWidth={2}
                  lineCap="round"
                  lineJoin="round"
                  opacity={0.9}
                  listening={false}
                />
              ))}
            </Group>
            </GraphPlaybackWrap>
          );
        }
        if (slot.kind === 'functionSeries') {
          const it = itemsMap.get(slot.id);
          if (!it || it.kind !== 'graphFunctionSeries') return null;
          const exit = exitPreviewForTarget(it.id, currentTime, itemsMap);
          if (functionSeriesIsDisabled(it)) {
            // Origin marker so disabled series is visible but playback-blocked.
            const o = toLocal(0, 0);
            return (
              <GraphPlaybackWrap key={key} exit={exit}>
              <Group listening={false}>
                <Text
                  x={o.lx - 8}
                  y={o.ly - 10}
                  text="⚠"
                  fontSize={18}
                  fill="#fca5a5"
                  listening={false}
                />
              </Group>
              </GraphPlaybackWrap>
            );
          }
          const spec = buildFunctionSeriesDrawSpec(
            it,
            axes,
            currentTime,
            itemsMap,
            toLocal,
          );
          if (!spec) return null;
          // Replacement-mode series: `buildFunctionSeriesDrawSpec` only returns
          // the currently-active curve — predecessors are NOT emitted as layers.
          // `visible={layer.opacity > 0}` is a belt-and-suspenders safeguard: any
          // future exit-animation fade that multiplies opacity on a parent Group
          // can never resurrect a curve that this spec considers hidden.
          return (
            <GraphPlaybackWrap key={key} exit={exit}>
            <Group listening={false}>
              {spec.layers.map((layer) =>
                layer.points.length >= 4 ? (
                  <Line
                    key={layer.key}
                    points={layer.points}
                    stroke={layer.color}
                    strokeWidth={layer.strokeWidth}
                    lineCap="round"
                    lineJoin="round"
                    opacity={layer.opacity}
                    visible={layer.opacity > 0}
                    dash={functionSeriesDashArray(
                      layer.lineStyle,
                      layer.strokeWidth,
                    )}
                    listening={false}
                  />
                ) : null,
              )}
            </Group>
            </GraphPlaybackWrap>
          );
        }
        if (slot.kind === 'pointSequence') {
          const it = itemsMap.get(slot.id);
          if (!it || it.kind !== 'graphPointSequence') return null;
          const exit = exitPreviewForTarget(it.id, currentTime, itemsMap);
          if (pointSequenceIsDisabled(it)) {
            const o = toLocal(0, 0);
            return (
              <GraphPlaybackWrap key={key} exit={exit}>
              <Group listening={false}>
                <Text
                  x={o.lx - 8}
                  y={o.ly - 10}
                  text="⚠"
                  fontSize={18}
                  fill="#fca5a5"
                  listening={false}
                />
              </Group>
              </GraphPlaybackWrap>
            );
          }
          const scenePxPerUnit = (pxPerUnitX + pxPerUnitY) / 2;
          const spec = buildPointSequenceDrawSpec(
            it,
            currentTime,
            itemsMap,
            toLocal,
            scenePxPerUnit,
          );
          if (!spec || spec.dots.length === 0) return null;
          return (
            <GraphPlaybackWrap key={key} exit={exit}>
            <Group listening={false}>
              {spec.dots.map((d) => (
                <Circle
                  key={d.key}
                  x={d.lx}
                  y={d.ly}
                  radius={d.radiusPx}
                  fill={d.color}
                  opacity={d.opacity}
                  listening={false}
                />
              ))}
            </Group>
            </GraphPlaybackWrap>
          );
        }
        if (slot.kind === 'dot') {
          const it = itemsMap.get(slot.id);
          if (!it || it.kind !== 'graphDot') return null;
          const exit = exitPreviewForTarget(it.id, currentTime, itemsMap);
          const dotPreview = buildGraphDotPreviewSpec({
            dot: it.dot,
            axW,
            axH,
            xMin,
            xMax,
            yMin,
            yMax,
            scenePxPerUnit: (pxPerUnitX + pxPerUnitY) / 2,
          });
          return (
            <GraphPlaybackWrap key={key} exit={exit}>
            <Group>
              <Circle
                x={dotPreview.x}
                y={dotPreview.y}
                radius={dotPreview.radius}
                fill={it.dot.color}
                listening={false}
              />
              {dotPreview.label && (
                <Text
                  x={dotPreview.label.x}
                  y={dotPreview.label.y}
                  text={dotPreview.label.text}
                  fontSize={dotPreview.label.fontSize}
                  fill={dotPreview.label.fill}
                  listening={false}
                />
              )}
            </Group>
            </GraphPlaybackWrap>
          );
        }
        return null;
      })}

      {placement && (
        <Text
          x={-axW / 2 + 4}
          y={-axH / 2 + 4}
          text="Click to place seed"
          fontSize={10}
          fill="#38bdf8"
          listening={false}
        />
      )}

      {draggable && !hideEditorChrome && (
        <Group x={axW / 2 - 14} y={-axH / 2 + 14}>
          <Rect
            x={-18}
            y={-18}
            width={36}
            height={36}
            fill="rgba(0,0,0,0.001)"
            cornerRadius={6}
          />
          <Rect
            x={-12}
            y={-12}
            width={24}
            height={24}
            fill="#1e293b"
            stroke={isSelected ? '#60a5fa' : '#64748b'}
            strokeWidth={1}
            cornerRadius={4}
          />
          <Line
            points={[-7, -4, 7, -4]}
            stroke="#94a3b8"
            strokeWidth={1.5}
            lineCap="round"
            listening={false}
          />
          <Line
            points={[-7, 0, 7, 0]}
            stroke="#94a3b8"
            strokeWidth={1.5}
            lineCap="round"
            listening={false}
          />
          <Line
            points={[-7, 4, 7, 4]}
            stroke="#94a3b8"
            strokeWidth={1.5}
            lineCap="round"
            listening={false}
          />
        </Group>
      )}
    </Group>
  );
}

function GraphPlaybackWrap({
  exit,
  children,
}: {
  exit: ExitPreviewState | null;
  children: React.ReactNode;
}) {
  if (!exit) return <>{children}</>;
  return (
    <Group opacity={exit.opacity} scaleX={exit.scale} scaleY={exit.scale}>
      {children}
    </Group>
  );
}
