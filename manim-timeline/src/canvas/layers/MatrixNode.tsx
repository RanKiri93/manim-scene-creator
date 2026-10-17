import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Group, Image as KonvaImage, Path, Rect, Text } from 'react-konva';
import type { AudioTrackItem, ItemId, MatrixItem, MatrixMeasure, SceneItem, SegmentLocalBox } from '@/types/scene';
import { useDragSnap } from '@/canvas/hooks/useDragSnap';
import { useSceneStore } from '@/store/useSceneStore';
import { isMultiSelectModifier } from '@/lib/uiModifiers';
import { FRAME_H, FRAME_W } from '@/lib/constants';
import { CANVAS_CHROME } from '@/lib/theme';
import { texPreviewText } from '@/lib/texPreviewText';
import { cellColorAt, cellKey, cellsBounds, matrixGeometry, measuredMatrixGeometry } from '@/lib/matrix';
import {
  matrixColorState,
  matrixIntroState,
  type ColorLayer,
  type PieceReveal,
} from '@/lib/matrixPreview';
import { lerpHexColor } from '@/lib/visualPlaybackPreview';

interface MatrixNodeProps {
  item: MatrixItem;
  canvasWidth: number;
  canvasHeight: number;
  isSelected: boolean;
  resolvedX: number;
  resolvedY: number;
  frameOffset: { x: number; y: number };
  currentTime: number;
  itemsMap: Map<ItemId, SceneItem>;
  audioItems: AudioTrackItem[];
}

/** Box in canvas pixels, relative to the matrix centre (y down). */
interface PxBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Antialiasing margin kept around each cropped piece, Manim units. */
const PIECE_PAD = 0.01;

/** The PNG tinted to one colour (alpha kept), drawn over a piece to recolour it. */
function tintCanvas(img: HTMLImageElement, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

/** Bracket outline for the fallback preview (no typeset image yet). */
function bracketPath(kind: MatrixItem['bracket'], b: PxBox, side: 'left' | 'right'): string {
  const inner = side === 'left' ? b.x + b.w : b.x;
  const outer = side === 'left' ? b.x : b.x + b.w;
  const top = b.y;
  const bottom = b.y + b.h;
  const mid = b.y + b.h / 2;
  switch (kind) {
    case 'square':
      return `M${inner},${top} L${outer},${top} L${outer},${bottom} L${inner},${bottom}`;
    case 'round':
      return `M${inner},${top} Q${outer - (inner - outer) * 0.6},${mid} ${inner},${bottom}`;
    case 'curly': {
      const m = (inner + outer) / 2;
      return `M${inner},${top} Q${m},${top} ${m},${top + b.h * 0.12} L${m},${mid - b.h * 0.1} Q${m},${mid} ${outer},${mid} Q${m},${mid} ${m},${mid + b.h * 0.1} L${m},${bottom - b.h * 0.12} Q${m},${bottom} ${inner},${bottom}`;
    }
    case 'bars':
      return `M${(inner + outer) / 2},${top} L${(inner + outer) / 2},${bottom}`;
    case 'double_bars':
      return `M${outer},${top} L${outer},${bottom} M${(inner + outer) / 2},${top} L${(inner + outer) / 2},${bottom}`;
    default:
      return '';
  }
}

/** Colour after laying `layers` over `base` (fallback preview has no image to tint). */
function layeredColor(base: string, layers: readonly ColorLayer[] | undefined): string {
  let c = base;
  for (const l of layers ?? []) c = lerpHexColor(c, l.color, l.opacity);
  return c;
}

/**
 * A matrix on the canvas. With a fresh typeset preview from the measure server, each piece
 * (bracket, bar, entry) is a crop of that image, so intros, colour clips and blinks act on the
 * same pieces as the export's `HebrewMatrix`; until then a plain-text stand-in is drawn.
 */
export default function MatrixNode({
  item,
  canvasWidth,
  canvasHeight,
  isSelected,
  resolvedX,
  resolvedY,
  frameOffset,
  currentTime,
  itemsMap,
  audioItems,
}: MatrixNodeProps) {
  const ppuX = (canvasWidth / FRAME_W) * item.scale;
  const ppuY = (canvasHeight / FRAME_H) * item.scale;
  const canvasToManim = (cx: number, cy: number) => ({
    mx: (cx / canvasWidth - 0.5) * FRAME_W - frameOffset.x,
    my: (0.5 - cy / canvasHeight) * FRAME_H - frameOffset.y,
  });
  const { onDragStart, onDragMove, onDragEnd, draggable } = useDragSnap({
    itemId: item.id,
    posSteps: item.posSteps,
    canvasToManim,
  });
  const posX = (resolvedX / FRAME_W + 0.5) * canvasWidth;
  const posY = (0.5 - resolvedY / FRAME_H) * canvasHeight;

  const measured = measuredMatrixGeometry(item);
  const geom: MatrixMeasure = measured ?? matrixGeometry(item);

  // Last loaded preview stays up while a new one loads (like text lines).
  const [loaded, setLoaded] = useState<{ url: string; img: HTMLImageElement } | null>(null);
  useEffect(() => {
    const url = item.previewDataUrl;
    if (!url) return;
    let cancelled = false;
    const el = new window.Image();
    el.onload = () => {
      if (!cancelled) setLoaded({ url, img: el });
    };
    el.src = url;
    return () => {
      cancelled = true;
      el.onload = null;
    };
  }, [item.previewDataUrl]);
  const img = measured && item.previewDataUrl && loaded?.url === item.previewDataUrl && geom.widthInk > 0 ? loaded.img : null;


  const toPx = (b: SegmentLocalBox, pad = 0): PxBox => ({
    x: (b.cx - b.w / 2 - pad) * ppuX,
    y: -(b.cy + b.h / 2 + pad) * ppuY,
    w: (b.w + 2 * pad) * ppuX,
    h: (b.h + 2 * pad) * ppuY,
  });
  const ink: PxBox = {
    x: geom.inkLeftX * ppuX,
    y: -geom.inkTopY * ppuY,
    w: (geom.inkRightX - geom.inkLeftX) * ppuX,
    h: (geom.inkTopY - geom.inkBottomY) * ppuY,
  };

  const intro = useMemo(
    () => matrixIntroState(item, geom, currentTime, itemsMap, audioItems),
    [item, geom, currentTime, itemsMap, audioItems],
  );
  const colors = useMemo(() => matrixColorState(item, currentTime, itemsMap), [item, currentTime, itemsMap]);
  // One tinted copy of the preview per colour in use; the set stays the same through a clip.
  const tintKey = [...new Set([...colors.frame, ...[...colors.cells.values()].flat()].map((l) => l.color))].sort().join('|');
  const tints = useMemo(() => {
    const m = new Map<string, HTMLCanvasElement>();
    if (img) for (const c of tintKey.split('|').filter(Boolean)) m.set(c, tintCanvas(img, c));
    return m;
  }, [img, tintKey]);
  const tinted = (color: string): HTMLCanvasElement | null => tints.get(color) ?? null;

  /** One piece cropped from the preview (or drawn by `fallback`), revealed and recoloured. */
  const piece = (key: string, box: SegmentLocalBox, reveal: PieceReveal, layers: readonly ColorLayer[] | undefined, fallback: (b: PxBox) => ReactNode) => {
    if (reveal.opacity <= 0 || reveal.wipe <= 0) return null;
    if (!img) {
      return (
        <Group key={key} opacity={reveal.opacity * (reveal.wipe < 1 ? reveal.wipe : 1)} listening={false}>
          {fallback(toPx(box))}
        </Group>
      );
    }
    const px = toPx(box, PIECE_PAD);
    const fx = (v: number) => (v - ink.x) / ink.w;
    const fy = (v: number) => (v - ink.y) / ink.h;
    const w = px.w * reveal.wipe;
    const crop = {
      x: fx(px.x) * img.naturalWidth,
      y: fy(px.y) * img.naturalHeight,
      width: Math.max(1, (w / ink.w) * img.naturalWidth),
      height: Math.max(1, (px.h / ink.h) * img.naturalHeight),
    };
    return (
      <Group key={key} opacity={reveal.opacity} listening={false}>
        <KonvaImage image={img} x={px.x} y={px.y} width={w} height={px.h} crop={crop} />
        {(layers ?? []).map((l, i) => {
          const t = tinted(l.color);
          return t ? <KonvaImage key={i} image={t} x={px.x} y={px.y} width={w} height={px.h} crop={crop} opacity={l.opacity} /> : null;
        })}
      </Group>
    );
  };

  const fontPx = 0.62 * 0.346 * (item.fontSize / 48) * ppuY * 1.45;
  const frameColor = layeredColor(item.color, colors.frame);
  const framePieces: ReactNode[] = [];
  const frameBoxes: [string, SegmentLocalBox | null, 'left' | 'right' | 'bar'][] = [
    ['lb', geom.leftBracket, 'left'],
    ['rb', geom.rightBracket, 'right'],
    ['bar', geom.bar, 'bar'],
  ];
  for (const [key, box, side] of frameBoxes) {
    if (!box) continue;
    framePieces.push(
      piece(key, box, intro.frame, colors.frame, (b) =>
        side === 'bar' ? (
          <Rect x={b.x} y={b.y} width={Math.max(1, b.w)} height={b.h} fill={frameColor} />
        ) : (
          <Path data={bracketPath(item.bracket, b, side)} stroke={frameColor} strokeWidth={Math.max(1, fontPx * 0.07)} lineCap="round" lineJoin="round" />
        ),
      ),
    );
  }

  const scaled = colors.blinkScale;
  const scaledKeys = new Set(scaled?.cells.map(cellKey) ?? []);
  const cellPiece = (c: (typeof geom.cells)[number]) => {
    const key = cellKey(c);
    const reveal = intro.cells.get(key) ?? { opacity: 1, wipe: 1 };
    const layers = colors.cells.get(key);
    return piece(`c${key}`, c, reveal, layers, (b) => (
      <Text
        x={b.x - b.w}
        y={b.y + b.h / 2 - fontPx * 0.55}
        width={b.w * 3}
        align="center"
        text={texPreviewText(item.entries[c.row]?.[c.col] ?? '')}
        fontSize={fontPx}
        fontStyle="italic"
        fontFamily="Times New Roman, serif"
        fill={layeredColor(cellColorAt(item, c.row, c.col), layers)}
        wrap="none"
      />
    ));
  };
  const plainCells = geom.cells.filter((c) => !scaledKeys.has(cellKey(c))).map(cellPiece);
  let scaledGroup: ReactNode = null;
  if (scaled) {
    const b = cellsBounds(geom, scaled.cells);
    if (b) {
      const cx = ((b.left + b.right) / 2) * ppuX;
      const cy = -((b.top + b.bottom) / 2) * ppuY;
      scaledGroup = (
        <Group x={cx} y={cy} scaleX={scaled.scale} scaleY={scaled.scale} listening={false}>
          <Group x={-cx} y={-cy}>
            {geom.cells.filter((c) => scaledKeys.has(cellKey(c))).map(cellPiece)}
          </Group>
        </Group>
      );
    }
  }

  return (
    <Group
      x={posX}
      y={posY}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
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
      <Rect
        x={ink.x - 3}
        y={ink.y - 3}
        width={ink.w + 6}
        height={ink.h + 6}
        fill="transparent"
        stroke={isSelected ? CANVAS_CHROME.selection : !draggable ? CANVAS_CHROME.locked : CANVAS_CHROME.idleOutline}
        strokeWidth={isSelected ? 2 : 1}
        dash={!draggable ? [6, 3] : isSelected ? undefined : [4, 4]}
        cornerRadius={2}
      />
      {framePieces}
      {plainCells}
      {scaledGroup}
    </Group>
  );
}
