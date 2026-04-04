import { Group, Rect, Line, Circle, Text } from 'react-konva';
import type { GraphItem } from '@/types/scene';
import { useDragSnap } from '@/canvas/hooks/useDragSnap';
import { FRAME_W, FRAME_H } from '@/lib/constants';

interface GraphNodeProps {
  item: GraphItem;
  canvasWidth: number;
  canvasHeight: number;
  isSelected: boolean;
  resolvedX: number;
  resolvedY: number;
}

export default function GraphNode({
  item,
  canvasWidth,
  canvasHeight,
  isSelected,
  resolvedX,
  resolvedY,
}: GraphNodeProps) {
  const pxPerUnitX = canvasWidth / FRAME_W;
  const pxPerUnitY = canvasHeight / FRAME_H;

  const canvasToManim = (cx: number, cy: number) => ({
    mx: (cx / canvasWidth - 0.5) * FRAME_W,
    my: (0.5 - cy / canvasHeight) * FRAME_H,
  });

  const { onDragStart, onDragEnd, draggable } = useDragSnap({
    itemId: item.id,
    posSteps: item.posSteps,
    canvasToManim,
  });

  const posX = (resolvedX / FRAME_W + 0.5) * canvasWidth;
  const posY = (0.5 - resolvedY / FRAME_H) * canvasHeight;

  const [xMin, xMax] = item.xRange;
  const [yMin, yMax] = item.yRange;
  const axW = (xMax - xMin) * item.scale * pxPerUnitX;
  const axH = (yMax - yMin) * item.scale * pxPerUnitY;

  // Graph origin (0,0) offset inside the axes rect
  const ox = (-xMin / (xMax - xMin)) * axW;
  const oy = (yMax / (yMax - yMin)) * axH;

  // Plot a JS function onto canvas points
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

  return (
    <Group x={posX} y={posY} draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {/* Axes background — amber border when constrained (locked) */}
      <Rect
        x={-axW / 2}
        y={-axH / 2}
        width={axW}
        height={axH}
        stroke={isSelected ? '#3b82f6' : !draggable ? '#d97706' : '#475569'}
        strokeWidth={isSelected ? 2 : 1}
        dash={!draggable ? [6, 3] : undefined}
        cornerRadius={2}
      />

      {/* X axis line */}
      <Line
        points={[-axW / 2, -axH / 2 + oy, axW / 2, -axH / 2 + oy]}
        stroke="#94a3b8"
        strokeWidth={1}
      />
      {/* Y axis line */}
      <Line
        points={[-axW / 2 + ox, -axH / 2, -axW / 2 + ox, axH / 2]}
        stroke="#94a3b8"
        strokeWidth={1}
      />

      {/* Function curves */}
      {item.functions.map((fn, i) => {
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
          />
        );
      })}

      {/* Dots */}
      {item.dots.map((dot, i) => {
        const dx = -axW / 2 + ((dot.dx - xMin) / (xMax - xMin)) * axW;
        const dy = -axH / 2 + (1 - (dot.dy - yMin) / (yMax - yMin)) * axH;
        return (
          <Group key={dot.id || i}>
            <Circle x={dx} y={dy} radius={4} fill={dot.color} />
            {dot.label && (
              <Text
                x={dx + 6}
                y={dy - 8}
                text={dot.label}
                fontSize={10}
                fill="#e2e8f0"
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
}
