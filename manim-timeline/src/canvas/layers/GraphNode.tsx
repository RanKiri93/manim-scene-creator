import { useCallback, useMemo } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Group, Rect, Line, Circle, Text } from 'react-konva';
import type {
  AxesItem,
  GraphDot,
  GraphFieldItem,
  GraphFunction,
  GraphSeriesVizItem,
  ItemId,
} from '@/types/scene';
import { buildSeriesVizDrawSpec } from '@/lib/seriesVizPreview';
import { useDragSnap } from '@/canvas/hooks/useDragSnap';
import { FRAME_W, FRAME_H } from '@/lib/constants';
import { useSceneStore } from '@/store/useSceneStore';
import {
  evalGraphField,
  colorForMagnitude,
  rk4Step2d,
} from '@/canvas/layers/graphFieldPreview';
import { createGraphStreamPoint } from '@/store/factories';

interface GraphNodeProps {
  axes: AxesItem;
  plots: GraphFunction[];
  dots: GraphDot[];
  field: GraphFieldItem | null;
  seriesViz: GraphSeriesVizItem | null;
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
  plots,
  dots,
  field,
  seriesViz,
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
  const axW = (xMax - xMin) * axes.scale * pxPerUnitX;
  const axH = (yMax - yMin) * axes.scale * pxPerUnitY;

  const ox = (-xMin / (xMax - xMin)) * axW;
  const oy = (yMax / (yMax - yMin)) * axH;

  const plotFn = (jsExpr: string): number[] => {
    const points: number[] = [];
    const steps = 200;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = xMin + t * (xMax - xMin);
      let y: number;
      try {
        y = new Function('x', `return ${jsExpr}`)(x) as number;
      } catch {
        continue;
      }
      if (!isFinite(y)) continue;
      const px = -axW / 2 + t * axW;
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

  const seriesSpec = useMemo(() => {
    if (!seriesViz) return null;
    return buildSeriesVizDrawSpec(seriesViz, axes, currentTime, itemsMap, toLocal);
  }, [seriesViz, axes, currentTime, itemsMap, toLocal]);

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

      {plots.map((fn, i) => {
        const pts = plotFn(fn.jsExpr);
        if (pts.length < 4) return null;
        return (
          <Line
            key={fn.id || i}
            points={pts}
            stroke={fn.color}
            strokeWidth={2}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
        );
      })}

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

      {seriesSpec?.limitLineY !== undefined && (
        <Line
          points={[
            -axW / 2,
            -axH / 2 + (1 - (seriesSpec.limitLineY - yMin) / (yMax - yMin)) * axH,
            axW / 2,
            -axH / 2 + (1 - (seriesSpec.limitLineY - yMin) / (yMax - yMin)) * axH,
          ]}
          stroke="#94a3b8"
          strokeWidth={1}
          dash={[6, 4]}
          opacity={0.65}
          listening={false}
        />
      )}

      {seriesSpec?.ghosts.map((g, gi) =>
        g.points.length >= 4 ? (
          <Line
            key={`sv-ghost-${gi}`}
            points={g.points}
            stroke={seriesSpec.strokeColor}
            strokeWidth={Math.max(0.5, seriesSpec.strokeWidth * 0.85)}
            lineCap="round"
            lineJoin="round"
            opacity={g.opacity}
            listening={false}
          />
        ) : null,
      )}

      {seriesSpec && seriesSpec.mainLine.length >= 4 && (
        <Line
          points={seriesSpec.mainLine}
          stroke={seriesSpec.strokeColor}
          strokeWidth={seriesSpec.strokeWidth}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      )}

      {seriesSpec?.showHeadDot && seriesSpec.head && (
        <Circle
          x={seriesSpec.head.lx}
          y={seriesSpec.head.ly}
          radius={5}
          fill={seriesSpec.headColor}
          listening={false}
        />
      )}

      {dots.map((dot, i) => {
        const dx = -axW / 2 + ((dot.dx - xMin) / (xMax - xMin)) * axW;
        const dy = -axH / 2 + (1 - (dot.dy - yMin) / (yMax - yMin)) * axH;
        return (
          <Group key={dot.id || i}>
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
