import { useCallback, useMemo } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Group, Rect, Line, Circle, Text, Ellipse } from 'react-konva';
import type {
  AxesItem,
  GraphAreaCurveSource,
  GraphAreaItem,
  GraphFieldItem,
  ItemId,
  SceneItem,
} from '@/types/scene';
import type { GraphAxesDrawSlot } from '@/lib/graphPreview';
import {
  buildFunctionSeriesDrawSpec,
  functionSeriesDashArray,
} from '@/lib/functionSeriesPreview';
import { functionSeriesIsDisabled } from '@/lib/graphPreview';
import { useDragSnap } from '@/canvas/hooks/useDragSnap';
import { FRAME_W, FRAME_H } from '@/lib/constants';
import { useSceneStore } from '@/store/useSceneStore';
import {
  evalGraphField,
  colorForMagnitude,
  rk4Step2d,
} from '@/canvas/layers/graphFieldPreview';
import { createGraphStreamPoint } from '@/store/factories';

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
  canvasWidth: number;
  canvasHeight: number;
  resolvedX: number;
  resolvedY: number;
}

export default function GraphNode({
  axes,
  drawOrder,
  field,
  streamPlacementFieldId,
  isSelected,
  canvasWidth,
  canvasHeight,
  resolvedX,
  resolvedY,
}: GraphNodeProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const currentTime = useSceneStore((s) => s.currentTime);
  const itemsMap = useSceneStore((s) => s.items);

  const pxPerUnitX = canvasWidth / FRAME_W;
  const pxPerUnitY = canvasHeight / FRAME_H;

  const canvasToManim = (cx: number, cy: number) => ({
    mx: (cx / canvasWidth - 0.5) * FRAME_W,
    my: (0.5 - cy / canvasHeight) * FRAME_H,
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

  const ox = (-xMin / (xMax - xMin)) * axW;
  const oy = (yMax / (yMax - yMin)) * axH;

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

  const fieldMode = field?.fieldMode ?? 'none';
  const cmin = field?.colorSchemeMin ?? 0;
  const cmax = field?.colorSchemeMax ?? 2;
  const cmap = field?.fieldColormap;

  const fieldArrows = useMemo(() => {
    if (!field || fieldMode === 'none') return [] as { key: string; points: number[]; color: string }[];
    const step = Math.max(0.05, field.fieldGridStep ?? 0.5);
    let nx = Math.ceil((xMax - xMin) / step);
    let ny = Math.ceil((yMax - yMin) / step);
    const maxCells = 22;
    while (nx * ny > 400) {
      nx = Math.max(4, Math.floor(nx * 0.9));
      ny = Math.max(4, Math.floor(ny * 0.9));
    }
    while (nx > maxCells || ny > maxCells) {
      nx = Math.max(4, Math.floor(nx * 0.85));
      ny = Math.max(4, Math.floor(ny * 0.85));
    }
    const out: { key: string; points: number[]; color: string }[] = [];
    let ki = 0;
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= ny; j++) {
        const x = xMin + (i / Math.max(1, nx)) * (xMax - xMin);
        const y = yMin + (j / Math.max(1, ny)) * (yMax - yMin);
        const v = evalGraphField(field, x, y);
        if (!v) continue;
        const [vx, vy] = v;
        const { lx, ly } = toLocal(x, y);
        const dcx = (vx / (xMax - xMin)) * axW;
        const dcy = -(vy / (yMax - yMin)) * axH;
        const clen = Math.hypot(dcx, dcy);
        const cap = 12;
        const s = clen > 1e-9 ? cap / clen : 0;
        const ex = lx + dcx * s;
        const ey = ly + dcy * s;
        const mag = Math.hypot(vx, vy);
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
        stroke={isSelected ? '#3b82f6' : !draggable ? '#d97706' : '#475569'}
        strokeWidth={isSelected ? 2 : 1}
        dash={!draggable ? [6, 3] : undefined}
        cornerRadius={2}
        listening={bboxListening}
        onClick={placement ? onAxesClick : undefined}
      />

      <Line
        points={[-axW / 2, -axH / 2 + oy, axW / 2, -axH / 2 + oy]}
        stroke="#94a3b8"
        strokeWidth={1}
        listening={false}
      />
      <Line
        points={[-axW / 2 + ox, -axH / 2, -axW / 2 + ox, axH / 2]}
        stroke="#94a3b8"
        strokeWidth={1}
        listening={false}
      />

      {drawOrder.map((slot) => {
        const key = `${slot.kind}-${slot.id}`;
        if (slot.kind === 'area') {
          const it = itemsMap.get(slot.id);
          if (!it || it.kind !== 'graphArea') return null;
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
              <Ellipse
                key={key}
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
            );
          }
          const poly = graphAreaPreviewPoints(it, itemsMap, xMin, xMax, yMin, yMax, toLocal);
          if (!poly || poly.length < 6) return null;
          return (
            <Line
              key={key}
              points={poly}
              closed
              fill={fill}
              opacity={fo}
              stroke={sw > 0 ? sc : undefined}
              strokeWidth={sw}
              listening={false}
            />
          );
        }
        if (slot.kind === 'plot') {
          const it = itemsMap.get(slot.id);
          if (!it || it.kind !== 'graphPlot') return null;
          const xd = it.xDomain;
          const xLo = xd == null ? xMin : Math.min(xd[0], xd[1]);
          const xHi = xd == null ? xMax : Math.max(xd[0], xd[1]);
          const pts = plotPolyline(it.fn.jsExpr, xLo, xHi);
          if (pts.length < 4) return null;
          return (
            <Line
              key={key}
              points={pts}
              stroke={it.fn.color}
              strokeWidth={Math.max(0, it.strokeWidth)}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          );
        }
        if (slot.kind === 'field' && field && field.id === slot.id) {
          return (
            <Group key={key} listening={false}>
              {fieldArrows.map((a) => (
                <Line
                  key={a.key}
                  points={a.points}
                  stroke={a.color}
                  strokeWidth={1.5}
                  lineCap="round"
                  listening={false}
                />
              ))}
              {streamPreviewLines.map((sl) => (
                <Line
                  key={sl.key}
                  points={sl.points}
                  stroke="#38bdf8"
                  strokeWidth={2}
                  lineCap="round"
                  lineJoin="round"
                  opacity={0.9}
                  listening={false}
                />
              ))}
            </Group>
          );
        }
        if (slot.kind === 'functionSeries') {
          const it = itemsMap.get(slot.id);
          if (!it || it.kind !== 'graphFunctionSeries') return null;
          if (functionSeriesIsDisabled(it)) {
            // Origin marker so disabled series is visible but playback-blocked.
            const o = toLocal(0, 0);
            return (
              <Group key={key} listening={false}>
                <Text
                  x={o.lx - 8}
                  y={o.ly - 10}
                  text="⚠"
                  fontSize={18}
                  fill="#fca5a5"
                  listening={false}
                />
              </Group>
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
          return (
            <Group key={key} listening={false}>
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
                    dash={functionSeriesDashArray(
                      layer.lineStyle,
                      layer.strokeWidth,
                    )}
                    listening={false}
                  />
                ) : null,
              )}
            </Group>
          );
        }
        if (slot.kind === 'dot') {
          const it = itemsMap.get(slot.id);
          if (!it || it.kind !== 'graphDot') return null;
          const dot = it.dot;
          const dx = -axW / 2 + ((dot.dx - xMin) / (xMax - xMin)) * axW;
          const dy = -axH / 2 + (1 - (dot.dy - yMin) / (yMax - yMin)) * axH;
          return (
            <Group key={key}>
              <Circle x={dx} y={dy} radius={4} fill={dot.color} listening={false} />
              {dot.label && (
                <Text
                  x={dx + 6}
                  y={dy - 8}
                  text={dot.label}
                  fontSize={10}
                  fill="#e2e8f0"
                  listening={false}
                />
              )}
            </Group>
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

      {draggable && (
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
