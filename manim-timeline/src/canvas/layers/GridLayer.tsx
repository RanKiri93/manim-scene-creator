import { Line } from 'react-konva';
import { FRAME_W, FRAME_H } from '@/lib/constants';

interface GridLayerProps {
  canvasWidth: number;
  canvasHeight: number;
  divisions: number;
  showGrid: boolean;
  showAxes: boolean;
}

export default function GridLayer({
  canvasWidth,
  canvasHeight,
  divisions,
  showGrid,
  showAxes,
}: GridLayerProps) {
  const pxPerUnitX = canvasWidth / FRAME_W;
  const pxPerUnitY = canvasHeight / FRAME_H;
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;

  const lines: React.ReactNode[] = [];

  if (showGrid) {
    const stepX = canvasWidth / divisions;
    const stepY = canvasHeight / divisions;

    for (let i = 1; i < divisions; i++) {
      const x = i * stepX;
      lines.push(
        <Line
          key={`gv-${i}`}
          points={[x, 0, x, canvasHeight]}
          stroke="#94a3b8"
          strokeWidth={0.75}
          opacity={0.45}
        />,
      );
    }
    for (let i = 1; i < divisions; i++) {
      const y = i * stepY;
      lines.push(
        <Line
          key={`gh-${i}`}
          points={[0, y, canvasWidth, y]}
          stroke="#94a3b8"
          strokeWidth={0.75}
          opacity={0.45}
        />,
      );
    }
  }

  if (showAxes) {
    lines.push(
      <Line
        key="axis-h"
        points={[0, cy, canvasWidth, cy]}
        stroke="#cbd5e1"
        strokeWidth={1}
        opacity={0.85}
      />,
      <Line
        key="axis-v"
        points={[cx, 0, cx, canvasHeight]}
        stroke="#cbd5e1"
        strokeWidth={1}
        opacity={0.85}
      />,
    );

    // Unit ticks along horizontal axis
    for (let u = -Math.floor(FRAME_W / 2); u <= Math.floor(FRAME_W / 2); u++) {
      if (u === 0) continue;
      const tx = cx + u * pxPerUnitX;
      lines.push(
        <Line
          key={`tick-x-${u}`}
          points={[tx, cy - 4, tx, cy + 4]}
          stroke="#94a3b8"
          strokeWidth={1}
          opacity={0.75}
        />,
      );
    }
    for (let u = -Math.floor(FRAME_H / 2); u <= Math.floor(FRAME_H / 2); u++) {
      if (u === 0) continue;
      const ty = cy - u * pxPerUnitY;
      lines.push(
        <Line
          key={`tick-y-${u}`}
          points={[cx - 4, ty, cx + 4, ty]}
          stroke="#94a3b8"
          strokeWidth={1}
          opacity={0.75}
        />,
      );
    }
  }

  return <>{lines}</>;
}
