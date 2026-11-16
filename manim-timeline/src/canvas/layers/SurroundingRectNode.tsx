import { Group, Line, Rect, Shape, Text } from 'react-konva';
import { FRAME_W, FRAME_H } from '@/lib/constants';
import type { SurroundingRectItem } from '@/types/scene';
import type { Segment2 } from '@/lib/matrix';
import { shapeCreateFrame, surroundCreatePlan } from '@/lib/shapeCreatePreview';
import { surroundLabelLayout } from '@/lib/surroundCanvasPreview';

export interface SurroundingRectNodeProps {
  item: SurroundingRectItem;
  bboxManim: { left: number; right: number; bottom: number; top: number };
  canvasWidth: number;
  canvasHeight: number;
  isSelected: boolean;
  previewStrokeColor?: string;
  /** Strike highlight: draw these lines (scene coords) instead of the rectangle. */
  strike?: Segment2[] | null;
  /** Playback preview: linear progress (0–1) of its `Create`; unset or 1 = drawn in full. */
  createProgress?: number;
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

/** The rect's label, written in step with its Create (export: `Write(label)` in the same play). */
function SurroundLabel({
  item,
  bboxManim,
  canvasWidth,
  canvasHeight,
  color,
  progress,
}: {
  item: SurroundingRectItem;
  bboxManim: SurroundingRectNodeProps['bboxManim'];
  canvasWidth: number;
  canvasHeight: number;
  color: string;
  progress: number;
}) {
  const label = surroundLabelLayout(item, bboxManim);
  if (!label || progress <= 0) return null;
  const pxPerUnit = canvasWidth / FRAME_W;
  const w = label.width * pxPerUnit;
  const h = label.height * pxPerUnit;
  return (
    <Text
      listening={false}
      x={(label.cx / FRAME_W + 0.5) * canvasWidth - w / 2}
      y={(0.5 - label.cy / FRAME_H) * canvasHeight - h / 2}
      width={w}
      height={h}
      align="center"
      verticalAlign="middle"
      wrap="none"
      text={label.text}
      fontSize={0.62 * label.em * pxPerUnit * 1.45}
      fontFamily="'Frank Ruhl Libre', 'IBM Plex Sans Hebrew', serif"
      fill={color}
      opacity={Math.min(1, progress)}
    />
  );
}

export default function SurroundingRectNode(props: SurroundingRectNodeProps) {
  const { item, bboxManim, canvasWidth, canvasHeight, createProgress } = props;
  return (
    <Group listening={false}>
      <SurroundingRectBody {...props} />
      <SurroundLabel
        item={item}
        bboxManim={bboxManim}
        canvasWidth={canvasWidth}
        canvasHeight={canvasHeight}
        color="#ffffff" // export: HebrewMathLine with no colour → Manim's default white
        progress={createProgress ?? 1}
      />
    </Group>
  );
}

function SurroundingRectBody({
  item,
  bboxManim,
  canvasWidth,
  canvasHeight,
  isSelected,
  previewStrokeColor,
  strike,
  createProgress,
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

  // While it is being created: the part of the outline (or the strike lines) drawn so far.
  if (createProgress != null && createProgress < 1) {
    const frame = shapeCreateFrame(surroundCreatePlan(bboxManim, item.cornerRadius, strike), Math.max(0, createProgress));
    const toC = (mx: number, my: number): [number, number] => [(mx / FRAME_W + 0.5) * canvasWidth, (0.5 - my / FRAME_H) * canvasHeight];
    return (
      <Shape
        listening={false}
        sceneFunc={(ctx, shape) => {
          ctx.beginPath();
          for (const { subpaths } of frame.parts) {
            for (const sp of subpaths) sp.forEach((p, j) => (j === 0 ? ctx.moveTo(...toC(p.x, p.y)) : ctx.lineTo(...toC(p.x, p.y))));
          }
          ctx.strokeShape(shape);
        }}
        stroke={previewStrokeColor ?? item.color}
        strokeWidth={strokeW}
        lineCap={strike ? 'round' : 'butt'}
        dash={isSelected ? [6, 4] : undefined}
      />
    );
  }

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
