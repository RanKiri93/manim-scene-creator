import { Group, Line, Rect } from 'react-konva';
import { FRAME_W, FRAME_H } from '@/lib/constants';
import type { SurroundingRectItem } from '@/types/scene';
import type { Segment2 } from '@/lib/matrix';

export interface SurroundingRectNodeProps {
  item: SurroundingRectItem;
  bboxManim: { left: number; right: number; bottom: number; top: number };
  canvasWidth: number;
  canvasHeight: number;
  isSelected: boolean;
  previewStrokeColor?: string;
  /** Strike highlight: draw these lines (scene coords) instead of the rectangle. */
  strike?: Segment2[] | null;
}

function manimAabbToCanvasRect(
  left: number,
  right: number,
  bottom: number,
  top: number,
  cw: number,
  ch: number,
): { x: number; y: number; width: number; height: number } {
  const x1 = (left / FRAME_W + 0.5) * cw;
  const x2 = (right / FRAME_W + 0.5) * cw;
  const yTop = (0.5 - top / FRAME_H) * ch;
  const yBot = (0.5 - bottom / FRAME_H) * ch;
  return {
    x: Math.min(x1, x2),
    y: Math.min(yTop, yBot),
    width: Math.abs(x2 - x1),
    height: Math.abs(yBot - yTop),
  };
}

export default function SurroundingRectNode({
  item,
  bboxManim,
  canvasWidth,
  canvasHeight,
  isSelected,
  previewStrokeColor,
  strike,
}: SurroundingRectNodeProps) {
  const { x, y, width, height } = manimAabbToCanvasRect(
    bboxManim.left,
    bboxManim.right,
    bboxManim.bottom,
    bboxManim.top,
    canvasWidth,
    canvasHeight,
  );

  const pxPer = Math.min(canvasWidth / FRAME_W, canvasHeight / FRAME_H);
  // Manim `stroke_width` on SurroundingRectangle is pixel-like at render resolution, not
  // Manim scene units — do not multiply by pxPer (that yields ~100px strokes and glitches).
  const strokeW = Math.max(1, item.strokeWidth * 0.35);
  const rawCornerR = item.cornerRadius * pxPer;
  const cornerR = Math.max(
    0,
    Math.min(
      rawCornerR,
      Math.min(width, height) > 1
        ? Math.min(width, height) / 2 - 0.5
        : rawCornerR,
    ),
  );

  if (strike) {
    const toC = (mx: number, my: number) => [(mx / FRAME_W + 0.5) * canvasWidth, (0.5 - my / FRAME_H) * canvasHeight];
    return (
      <Group listening={false}>
        {strike.map((s, i) => (
          <Line
            key={i}
            points={[...toC(s.x1, s.y1), ...toC(s.x2, s.y2)]}
            stroke={previewStrokeColor ?? item.color}
            strokeWidth={strokeW}
            lineCap="round"
            dash={isSelected ? [6, 4] : undefined}
          />
        ))}
      </Group>
    );
  }

  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={height}
      stroke={previewStrokeColor ?? item.color}
      strokeWidth={strokeW}
      cornerRadius={cornerR}
      fillEnabled={false}
      listening={false}
      dash={isSelected ? [6, 4] : undefined}
    />
  );
}
