import { useLayoutEffect, useRef, useState } from 'react';
import {
  Group,
  Circle,
  Rect,
  Line as KonvaLine,
  Arrow as KonvaArrow,
  Transformer,
} from 'react-konva';
import { tickSegments } from '@/lib/shapeAnchors';
import type Konva from 'konva';
import type { ShapeItem, ShapePoint } from '@/types/scene';
import { isFreelyDraggable } from '@/canvas/hooks/useDragSnap';
import { FRAME_W, FRAME_H } from '@/lib/constants';
import { useSceneStore } from '@/store/useSceneStore';
import { isMultiSelectModifier } from '@/lib/uiModifiers';
import { CANVAS_CHROME } from '@/lib/theme';
import { fillWithAlpha } from '@/lib/riemann';
import {
  arrowStrokeWidth,
  arrowTipLength,
  nearestSegment,
  POLYLINE_TIP_LENGTH,
  shapeLocalBounds,
  shapeStrokePx,
  snapDirection,
} from '@/lib/shapeGeometry';

const ALL_ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right'];
const CORNER_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
/** Rotation snaps every 15° (within 4°). */
const ROTATION_SNAPS = Array.from({ length: 24 }, (_, i) => i * 15);
const HANDLE_PX = 8;

function polyArrowSegment(points: ShapePoint[], at: 'head' | 'tail'): [ShapePoint, ShapePoint] | null {
  if (points.length < 2) return null;
  const [a, b] = at === 'head' ? [points[points.length - 2]!, points[points.length - 1]!] : [points[1]!, points[0]!];
  return Math.hypot(b.x - a.x, b.y - a.y) < 1e-9 ? null : [a, b];
}

interface ShapeNodeProps {
  item: ShapeItem;
  canvasWidth: number;
  canvasHeight: number;
  isSelected: boolean;
  resolvedX: number;
  resolvedY: number;
  frameOffset: { x: number; y: number };
  /** Playback preview: overrides item stroke when set. */
  previewStrokeColor?: string;
  /** Playback preview: overrides item fill when set (use transparent to clear). */
  previewFillColor?: string | null;
  /** Playback preview: added to Konva CW rotation (`item.rotationDeg`), e.g. -Manim/CCW TA degrees. */
  previewRotationDeltaDeg?: number;
  /** Connector drawn from its anchors: selectable, but not draggable or resizable. */
  locked?: boolean;
}

/**
 * A shape on the canvas. Handles depend on the shape: circles scale evenly from their corners
 * (no rotation); rectangles and polylines get eight handles and a rotation handle (Shift keeps
 * proportions, Alt scales from the centre, rotation snaps to 15°); lines and arrows get a handle on
 * each end (Shift snaps the angle); polylines also get a handle per vertex (double-click the line
 * to add one, Alt+click a vertex to remove it). Strokes, fills and arrow tips follow Manim's sizes.
 */
export default function ShapeNode({
  item: storedItem,
  canvasWidth,
  canvasHeight,
  isSelected,
  resolvedX,
  resolvedY,
  frameOffset,
  previewStrokeColor,
  previewFillColor,
  previewRotationDeltaDeg = 0,
  locked = false,
}: ShapeNodeProps) {
  const pxPerUnitX = canvasWidth / FRAME_W;
  const pxPerUnitY = canvasHeight / FRAME_H;
  const ppu = (pxPerUnitX + pxPerUnitY) / 2;
  const updateItem = useSceneStore((s) => s.updateItem);
  const setItemPosition = useSceneStore((s) => s.setItemPosition);
  const select = useSceneStore((s) => s.select);
  const selectedIds = useSceneStore((s) => s.selectedIds);

  /** Geometry being dragged by an end or vertex handle (committed on release, one undo step). */
  const [draft, setDraft] = useState<Partial<ShapeItem> | null>(null);
  const item: ShapeItem = draft ? { ...storedItem, ...draft } : storedItem;

  const shapeGroupRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  /** True while dragging the body or transforming — skip React→Konva sync that causes jumps. */
  const interactionRef = useRef(false);

  const canvasToManim = (cx: number, cy: number) => ({
    mx: (cx / canvasWidth - 0.5) * FRAME_W - frameOffset.x,
    my: (0.5 - cy / canvasHeight) * FRAME_H - frameOffset.y,
  });
  const manimToCanvas = (mx: number, my: number) => ({
    x: ((mx + frameOffset.x) / FRAME_W + 0.5) * canvasWidth,
    y: (0.5 - (my + frameOffset.y) / FRAME_H) * canvasHeight,
  });

  const kind = item.shapeType;
  const draggable = !locked && isFreelyDraggable(item.posSteps);
  const editable = isSelected && draggable && selectedIds.size === 1 && selectedIds.has(item.id);
  const twoPoint = kind === 'line' || kind === 'arrow';
  const showTransformer = editable && !twoPoint;
  const showEndHandles = editable && twoPoint;
  const showVertexHandles = editable && kind === 'polyline';

  const anchorPos = draft && draft.x != null && draft.y != null ? manimToCanvas(draft.x, draft.y) : null;
  const posX = anchorPos?.x ?? (resolvedX / FRAME_W + 0.5) * canvasWidth;
  const posY = anchorPos?.y ?? (0.5 - resolvedY / FRAME_H) * canvasHeight;
  const rotation = item.rotationDeg + previewRotationDeltaDeg;
  const scale = item.scale;

  // Local (pre-rotation, pre-scale) px ↔ parent px, matching the Group's transform.
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const unitToLocalPx = (p: ShapePoint) => ({ x: p.x * pxPerUnitX, y: -p.y * pxPerUnitY });
  const localPxToParent = (l: { x: number; y: number }) => ({
    x: posX + (l.x * cos - l.y * sin) * scale,
    y: posY + (l.x * sin + l.y * cos) * scale,
  });
  const parentToLocalUnit = (w: { x: number; y: number }): ShapePoint => {
    const dx = (w.x - posX) / scale;
    const dy = (w.y - posY) / scale;
    return { x: (dx * cos + dy * sin) / pxPerUnitX, y: -(-dx * sin + dy * cos) / pxPerUnitY };
  };

  useLayoutEffect(() => {
    const tr = transformerRef.current;
    const sh = shapeGroupRef.current;
    if (!tr) return;
    tr.nodes(showTransformer && sh ? [sh] : []);
    tr.getLayer()?.batchDraw();
  }, [showTransformer, item.id]);

  useLayoutEffect(() => {
    const n = shapeGroupRef.current;
    if (!n || interactionRef.current) return;
    n.x(posX);
    n.y(posY);
    n.rotation(rotation);
    n.scaleX(scale);
    n.scaleY(scale);
    transformerRef.current?.forceUpdate();
    n.getLayer()?.batchDraw();
  }, [posX, posY, rotation, scale, item.radius, item.width, item.height, item.endX, item.endY, kind, item.points, item.id]);

  const onDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    if (e.target !== shapeGroupRef.current) return;
    interactionRef.current = true;
    useSceneStore.temporal.getState().pause();
    select(item.id, isMultiSelectModifier(e.evt));
  };

  const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    if (e.target !== shapeGroupRef.current) return;
    const n = e.target as Konva.Group;
    const { mx, my } = canvasToManim(n.x(), n.y());
    setItemPosition(item.id, mx, my);
    interactionRef.current = false;
    useSceneStore.temporal.getState().resume();
  };

  const onTransformStart = () => {
    interactionRef.current = true;
    useSceneStore.temporal.getState().pause();
  };

  const onTransformEnd = () => {
    const n = shapeGroupRef.current;
    if (!n) {
      interactionRef.current = false;
      useSceneStore.temporal.getState().resume();
      return;
    }
    const raw = useSceneStore.getState().items.get(item.id);
    const base = raw?.kind === 'shape' ? raw : item;
    // The node carries scale × the item's own scale; bake both into the geometry.
    const sx = n.scaleX();
    const sy = n.scaleY();
    const { mx, my } = canvasToManim(n.x(), n.y());
    const minDim = 0.05;
    const patch: Partial<ShapeItem> = { x: mx, y: my, rotationDeg: kind === 'circle' ? base.rotationDeg : n.rotation(), scale: 1 };
    switch (base.shapeType) {
      case 'circle':
        patch.radius = Math.max(minDim, base.radius * Math.sqrt(Math.max(1e-8, sx * sy)));
        break;
      case 'rectangle':
        patch.width = Math.max(minDim, base.width * sx);
        patch.height = Math.max(minDim, base.height * sy);
        break;
      case 'polyline':
        patch.points = base.points.map((p) => ({ x: p.x * sx, y: p.y * sy }));
        break;
      default:
        break;
    }
    updateItem(item.id, patch);
    n.scaleX(1);
    n.scaleY(1);
    transformerRef.current?.forceUpdate();
    interactionRef.current = false;
    useSceneStore.temporal.getState().resume();
    n.getLayer()?.batchDraw();
  };

  // ── Line / arrow ends ──
  const ends = twoPoint
    ? {
        a: localPxToParent(unitToLocalPx({ x: -item.endX / 2, y: -item.endY / 2 })),
        b: localPxToParent(unitToLocalPx({ x: item.endX / 2, y: item.endY / 2 })),
      }
    : null;
  const moveEnd = (which: 'a' | 'b', px: { x: number; y: number }, snap: boolean, commit: boolean) => {
    if (!ends) return;
    const fixedPx = which === 'a' ? ends.b : ends.a;
    const fixed = canvasToManim(fixedPx.x, fixedPx.y);
    const moved = canvasToManim(px.x, px.y);
    const f = { x: fixed.mx, y: fixed.my };
    const m = snap ? snapDirection(f, { x: moved.mx, y: moved.my }) : { x: moved.mx, y: moved.my };
    const [a, b] = which === 'a' ? [m, f] : [f, m];
    const patch: Partial<ShapeItem> = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, endX: b.x - a.x, endY: b.y - a.y, rotationDeg: 0, scale: 1 };
    if (commit) {
      updateItem(item.id, patch);
      setDraft(null);
    } else setDraft(patch);
  };

  // ── Polyline vertices ──
  const moveVertex = (index: number, px: { x: number; y: number }, snap: boolean, commit: boolean) => {
    let p = parentToLocalUnit(px);
    const prev = item.points[index - 1] ?? item.points[index + 1];
    if (snap && prev) p = snapDirection(prev, p);
    const points = item.points.map((q, i) => (i === index ? p : q));
    if (commit) {
      updateItem(item.id, { points });
      setDraft(null);
    } else setDraft({ points });
  };
  const insertVertex = () => {
    const n = shapeGroupRef.current;
    const local = n?.getRelativePointerPosition();
    if (!local) return;
    const p = { x: local.x / pxPerUnitX, y: -local.y / pxPerUnitY };
    const i = nearestSegment(item.points, p);
    if (i < 0) return;
    updateItem(item.id, { points: [...item.points.slice(0, i + 1), p, ...item.points.slice(i + 1)] });
  };

  // ── Drawing ──
  const stroke = previewStrokeColor ?? (item.strokeColor || '#60a5fa');
  const fillSource = previewFillColor !== undefined ? previewFillColor : item.fillColor;
  const fill = fillSource?.trim() ? fillWithAlpha(fillSource, item.fillOpacity) : undefined;
  const sw = shapeStrokePx(item.strokeWidth, ppu);

  const inner = (() => {
    switch (kind) {
      case 'circle':
        return <Circle radius={item.radius * pxPerUnitX} stroke={stroke} strokeWidth={sw} fill={fill} />;
      case 'rectangle': {
        const w = item.width * pxPerUnitX;
        const h = item.height * pxPerUnitY;
        return <Rect x={-w / 2} y={-h / 2} width={w} height={h} stroke={stroke} strokeWidth={sw} fill={fill} />;
      }
      case 'arrow': {
        const x2 = item.endX * pxPerUnitX;
        const y2 = -item.endY * pxPerUnitY;
        const len = Math.hypot(item.endX, item.endY);
        const tip = arrowTipLength(len) * ppu;
        return (
          <KonvaArrow
            points={[-x2 / 2, -y2 / 2, x2 / 2, y2 / 2]}
            stroke={stroke}
            fill={stroke}
            strokeWidth={shapeStrokePx(arrowStrokeWidth(item.strokeWidth, len), ppu)}
            pointerLength={tip}
            pointerWidth={tip}
            hitStrokeWidth={12}
          />
        );
      }
      case 'line': {
        const x2 = item.endX * pxPerUnitX;
        const y2 = -item.endY * pxPerUnitY;
        // Equal-length ticks (geometry), in scene units around the line's middle.
        const ticks = tickSegments({ x: -item.endX / 2, y: -item.endY / 2 }, { x: item.endX / 2, y: item.endY / 2 }, item.endpoints?.ticks ?? 0);
        return (
          <Group>
            <KonvaLine points={[-x2 / 2, -y2 / 2, x2 / 2, y2 / 2]} stroke={stroke} strokeWidth={sw} hitStrokeWidth={12} />
            {ticks.map(([a, b], i) => (
              <KonvaLine key={`tick-${i}`} points={[a.x * pxPerUnitX, -a.y * pxPerUnitY, b.x * pxPerUnitX, -b.y * pxPerUnitY]} stroke={stroke} strokeWidth={sw} />
            ))}
          </Group>
        );
      }
      case 'polyline': {
        const pts = item.points;
        if (pts.length === 0) return <KonvaLine points={[0, 0, 0.5, 0]} stroke={stroke} strokeWidth={1} opacity={0.35} dash={[4, 4]} />;
        const tip = POLYLINE_TIP_LENGTH * ppu;
        const tipLine = (seg: [ShapePoint, ShapePoint] | null, key: string) =>
          seg ? (
            <KonvaArrow
              key={key}
              points={[seg[0].x * pxPerUnitX, -seg[0].y * pxPerUnitY, seg[1].x * pxPerUnitX, -seg[1].y * pxPerUnitY]}
              stroke={stroke}
              fill={stroke}
              strokeWidth={sw}
              pointerLength={tip}
              pointerWidth={tip}
            />
          ) : null;
        return (
          <Group>
            <KonvaLine
              points={pts.flatMap((p) => [p.x * pxPerUnitX, -p.y * pxPerUnitY])}
              stroke={stroke}
              strokeWidth={sw}
              lineCap="round"
              lineJoin="round"
              hitStrokeWidth={12}
              onDblClick={(e) => {
                if (!showVertexHandles) return;
                e.cancelBubble = true;
                insertVertex();
              }}
            />
            {item.headArrow ? tipLine(polyArrowSegment(pts, 'head'), 'head') : null}
            {item.tailArrow ? tipLine(polyArrowSegment(pts, 'tail'), 'tail') : null}
          </Group>
        );
      }
      default:
        return null;
    }
  })();

  // Outline hugging the shape when selected without its own handles (multi-select, connectors).
  const outline = (() => {
    if (!isSelected || showTransformer || showEndHandles) return null;
    const b = shapeLocalBounds(item);
    const pad = 4;
    return (
      <Rect
        x={b.left * pxPerUnitX - pad}
        y={-b.top * pxPerUnitY - pad}
        width={(b.right - b.left) * pxPerUnitX + 2 * pad}
        height={(b.top - b.bottom) * pxPerUnitY + 2 * pad}
        stroke={CANVAS_CHROME.selection}
        strokeWidth={1.5}
        dash={[4, 4]}
        listening={false}
      />
    );
  })();

  // Point handles (line ends, vertices) are round and filled with the selection colour, so they
  // read differently from the Transformer's square box handles.
  const handle = (key: string, at: { x: number; y: number }, onMove: (p: { x: number; y: number }, snap: boolean, commit: boolean) => void, onAltClick?: () => void) => (
    <Circle
      key={key}
      x={at.x}
      y={at.y}
      radius={HANDLE_PX / 2 + 1}
      fill={CANVAS_CHROME.selection}
      stroke={CANVAS_CHROME.handleFill}
      strokeWidth={1.5}
      draggable
      onMouseEnter={(e) => {
        const c = e.target.getStage()?.container();
        if (c) c.style.cursor = 'crosshair';
      }}
      onMouseLeave={(e) => {
        const c = e.target.getStage()?.container();
        if (c) c.style.cursor = '';
      }}
      onDragStart={(e) => {
        e.cancelBubble = true;
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        onMove({ x: e.target.x(), y: e.target.y() }, e.evt.shiftKey, false);
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        onMove({ x: e.target.x(), y: e.target.y() }, e.evt.shiftKey, true);
      }}
      onClick={(e) => {
        e.cancelBubble = true;
        if (e.evt.altKey) onAltClick?.();
      }}
    />
  );

  return (
    <>
      <Group
        ref={shapeGroupRef}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={(e) => {
          e.cancelBubble = true;
          useSceneStore.getState().select(item.id, isMultiSelectModifier(e.evt));
        }}
        onTap={(e) => {
          e.cancelBubble = true;
          useSceneStore.getState().select(item.id, isMultiSelectModifier(e.evt));
        }}
      >
        {inner}
        {outline}
      </Group>
      {showTransformer && (
        <Transformer
          ref={transformerRef}
          rotateEnabled={kind !== 'circle'}
          rotationSnaps={ROTATION_SNAPS}
          rotationSnapTolerance={4}
          enabledAnchors={kind === 'circle' ? CORNER_ANCHORS : ALL_ANCHORS}
          keepRatio={kind === 'circle'}
          ignoreStroke
          padding={4}
          borderStroke={CANVAS_CHROME.selection}
          borderStrokeWidth={1}
          anchorFill={CANVAS_CHROME.handleFill}
          anchorStroke={CANVAS_CHROME.handleStroke}
          anchorSize={HANDLE_PX}
          boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 6 || Math.abs(newBox.height) < 6 ? oldBox : newBox)}
          onTransformStart={onTransformStart}
          onTransformEnd={onTransformEnd}
        />
      )}
      {showEndHandles && ends && (
        <>
          <KonvaLine points={[ends.a.x, ends.a.y, ends.b.x, ends.b.y]} stroke={CANVAS_CHROME.selection} strokeWidth={1} dash={[4, 4]} listening={false} />
          {handle('end-a', ends.a, (p, snap, commit) => moveEnd('a', p, snap, commit))}
          {handle('end-b', ends.b, (p, snap, commit) => moveEnd('b', p, snap, commit))}
        </>
      )}
      {showVertexHandles &&
        item.points.map((p, i) =>
          handle(
            `v-${i}`,
            localPxToParent(unitToLocalPx(p)),
            (px, snap, commit) => moveVertex(i, px, snap, commit),
            () => {
              if (item.points.length > 2) updateItem(item.id, { points: item.points.filter((_, j) => j !== i) });
            },
          ),
        )}
    </>
  );
}
