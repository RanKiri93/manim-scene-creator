import { useEffect, useRef, useState } from 'react';
import { Circle, Group, Layer, Rect } from 'react-konva';
import type Konva from 'konva';
import type { ShapeItem, ShapePoint } from '@/types/scene';
import { createShape } from '@/store/factories';
import {
  draggedShapeGeometry,
  drawsByPoints,
  MIN_DRAG,
  minDrawPoints,
  nextDrawPoint,
  pointsShapeGeometry,
  type DrawModifiers,
  type ShapeDrawPreset,
} from '@/lib/shapeDraw';
import { canvasToWorldPoint, manimToCanvas, type CanvasViewportTransform } from '@/lib/canvasManimCoords';
import { CANVAS_CHROME } from '@/lib/theme';
import ShapeNode from './ShapeNode';

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
}

/**
 * Draw mode for a picked shape. Drag to draw it (Shift: square, round or 45°; Alt: from the
 * centre); a click without dragging places it at its default size. Polylines and polygons are
 * clicked point by point (Shift: 45° segments); double-click or Enter finishes, Backspace removes
 * the last point. Esc cancels. Calls `onDone` with the new item (frame-local position) or null.
 */
export default function ShapeDrawLayer({
  preset,
  width,
  height,
  transform,
  frameCenter,
  startTime,
  onDone,
}: {
  preset: ShapeDrawPreset;
  width: number;
  height: number;
  transform: CanvasViewportTransform;
  /** World centre of the frame new objects go into. */
  frameCenter: { x: number; y: number };
  startTime: number;
  onDone: (item: ShapeItem | null) => void;
}) {
  const kind = preset.shapeType;
  const byPoints = drawsByPoints(kind);
  const [drag, setDrag] = useState<{ start: ShapePoint; current: ShapePoint; mods: DrawModifiers } | null>(null);
  const [points, setPoints] = useState<ShapePoint[]>([]);
  const [hover, setHover] = useState<ShapePoint | null>(null);
  const [shift, setShift] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const toWorld = (stage: Konva.Stage | null): ShapePoint | null => {
    const pos = stage?.getPointerPosition();
    return pos ? canvasToWorldPoint(pos, width, height, transform) : null;
  };

  /** A shape from world-space geometry, moved into the target frame. */
  const build = (geometry: Partial<ShapeItem>): ShapeItem => {
    const item: ShapeItem = { ...createShape(startTime), ...preset.patch, shapeType: kind, ...geometry };
    return { ...item, x: item.x - frameCenter.x, y: item.y - frameCenter.y };
  };

  const finishPoints = (pts: ShapePoint[]) => {
    const geometry = pointsShapeGeometry(kind, pts);
    if (geometry) doneRef.current(build(geometry));
  };

  // Keys while drawing. Escape always cancels; Enter and Backspace leave text fields alone.
  const stateRef = useRef({ points, drag });
  stateRef.current = { points, drag };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(true);
      if (e.key === 'Escape') {
        e.preventDefault();
        doneRef.current(null);
        return;
      }
      if (isTypingTarget(e.target)) return;
      const { points: pts, drag: d } = stateRef.current;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (byPoints) {
          if (pts.length >= minDrawPoints(kind)) finishPoints(pts);
        } else if (!d) {
          // Keyboard insert: default size in the middle of the view.
          const c = canvasToWorldPoint({ x: width / 2, y: height / 2 }, width, height, transform);
          doneRef.current(build({ x: c.x, y: c.y }));
        }
      } else if (e.key === 'Backspace' && byPoints && pts.length > 0) {
        e.preventDefault();
        setPoints(pts.slice(0, -1));
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // build/finishPoints read the latest props through closures recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byPoints, kind, width, height, transform, frameCenter, startTime]);

  // The drag lives in a ref so the release (caught on window, even outside the stage) sees the
  // latest pointer without waiting for a render.
  const dragRef = useRef<{ start: ShapePoint; current: ShapePoint; mods: DrawModifiers } | null>(null);
  const updateDrag = (d: { start: ShapePoint; current: ShapePoint; mods: DrawModifiers } | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const finishDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    updateDrag(null);
    const moved = Math.hypot(d.current.x - d.start.x, d.current.y - d.start.y) >= MIN_DRAG;
    doneRef.current(build(moved ? draggedShapeGeometry(kind, d.start, d.current, d.mods) : { x: d.start.x, y: d.start.y }));
  };

  const draft: ShapeItem | null = (() => {
    if (byPoints) {
      const live = hover ? [...points, nextDrawPoint(points, hover, shift)] : points;
      const g = live.length >= 2 ? pointsShapeGeometry(kind === 'polygon' && live.length < 3 ? 'polyline' : kind, live) : null;
      return g ? { ...createShape(startTime), ...preset.patch, shapeType: kind === 'polygon' && live.length < 3 ? 'polyline' : kind, ...g, id: '__shape_draft__' } : null;
    }
    if (!drag) return null;
    return { ...createShape(startTime), ...preset.patch, shapeType: kind, ...draggedShapeGeometry(kind, drag.start, drag.current, drag.mods), id: '__shape_draft__' };
  })();

  return (
    <Layer>
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="rgba(0,0,0,0.001)"
        onMouseDown={(e) => {
          if (e.evt.button !== 0) return;
          e.cancelBubble = true;
          const p = toWorld(e.target.getStage());
          if (!p) return;
          if (byPoints) {
            setPoints((pts) => [...pts, nextDrawPoint(pts, p, e.evt.shiftKey)]);
            return;
          }
          updateDrag({ start: p, current: p, mods: { shift: e.evt.shiftKey, alt: e.evt.altKey } });
          window.addEventListener('mouseup', finishDrag, { once: true });
        }}
        onMouseMove={(e) => {
          const p = toWorld(e.target.getStage());
          if (!p) return;
          setShift(e.evt.shiftKey);
          if (byPoints) setHover(p);
          else if (dragRef.current) updateDrag({ ...dragRef.current, current: p, mods: { shift: e.evt.shiftKey, alt: e.evt.altKey } });
        }}
        onDblClick={(e) => {
          if (!byPoints) return;
          e.cancelBubble = true;
          finishPoints(points);
        }}
        onClick={(e) => {
          e.cancelBubble = true;
        }}
      />
      <Group x={transform.x} y={transform.y} scaleX={transform.scale} scaleY={transform.scale} listening={false}>
        {draft && (
          <ShapeNode
            item={draft}
            locked
            canvasWidth={width}
            canvasHeight={height}
            isSelected={false}
            resolvedX={draft.x}
            resolvedY={draft.y}
            frameOffset={{ x: 0, y: 0 }}
          />
        )}
        {points.map((p, i) => {
          const c = manimToCanvas(p.x, p.y, width, height);
          return <Circle key={i} x={c.x} y={c.y} radius={4 / transform.scale} fill={CANVAS_CHROME.selection} />;
        })}
      </Group>
    </Layer>
  );
}
