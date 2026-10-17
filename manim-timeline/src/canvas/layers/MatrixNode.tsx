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
import { matrixStateIndexAt, matrixStates, stepProgress } from '@/lib/matrixSteps';
import {
  matrixColorState,
  matrixIntroState,
  matrixStepPieces,
  type ColorLayer,
  type MatrixPieceRef,
  type PieceColorLayers,
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

/** Loaded typeset previews by data URL, so stepping back and forth does not reload them. */
const imageCache = new Map<string, HTMLImageElement>();
const IMAGE_CACHE_MAX = 48;

function cachedImage(url: string | null | undefined): HTMLImageElement | null {
  const img = url ? imageCache.get(url) : undefined;
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

/** Loads `urls` into the cache; re-renders when one arrives. */
function usePreviewImages(urls: readonly (string | null | undefined)[]): void {
  const [, setTick] = useState(0);
  const key = urls.filter(Boolean).join('\n');
  useEffect(() => {
    const pending: HTMLImageElement[] = [];
    for (const url of key ? key.split('\n') : []) {
      if (imageCache.has(url)) continue;
      const el = new window.Image();
      el.onload = () => setTick((t) => t + 1);
      el.src = url;
      imageCache.set(url, el);
      pending.push(el);
      while (imageCache.size > IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value!);
    }
    return () => {
      for (const el of pending) el.onload = null;
    };
  }, [key]);
}

const NO_LAYERS: PieceColorLayers = { frame: [], cells: new Map() };

/** Every colour laid over some piece, as a stable key. */
function layerColorKey(layers: PieceColorLayers): string {
  return [...new Set([...layers.frame, ...[...layers.cells.values()].flat()].map((l) => l.color))].sort().join('|');
}

/** One state's typeset preview, ready to crop (null until measured and loaded). */
interface StateArt {
  view: MatrixItem;
  geom: MatrixMeasure;
  img: HTMLImageElement | null;
  layers: PieceColorLayers;
}

/**
 * A matrix on the canvas. With a fresh typeset preview from the measure server, each piece
 * (bracket, bar, entry) is a crop of that image, so intros, steps, colour clips and blinks act on
 * the same pieces as the export's `HebrewMatrix`; until then a plain-text stand-in is drawn.
 * After a matrix step the preview of that state is shown; while a step plays, the pieces of the
 * states before and after move and cross-fade as `MatrixStep` animates them.
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

  const states = useMemo(() => matrixStates(item, itemsMap), [item, itemsMap]);
  const k = matrixStateIndexAt(states, currentTime);
  const state = states[k]!;
  const progress = stepProgress(state, currentTime);
  const prevView = progress != null && k > 0 ? states[k - 1]!.view : null;
  const curMeasured = measuredMatrixGeometry(state.view);
  const prevMeasured = prevView ? measuredMatrixGeometry(prevView) : null;
  // Preview images only for fresh measures (the crops are placed with that geometry).
  const curUrl = curMeasured && curMeasured.widthInk > 0 ? state.view.previewDataUrl : null;
  const prevUrl = prevView && prevMeasured && prevMeasured.widthInk > 0 ? prevView.previewDataUrl : null;
  usePreviewImages([curUrl, prevUrl]);

  const colors = useMemo(() => matrixColorState(item, currentTime, itemsMap), [item, currentTime, itemsMap]);
  const prevLayers = colors.previous ?? NO_LAYERS;

  // One tinted copy of a preview per colour in use; the set stays the same through a clip.
  const curTintKey = layerColorKey(colors);
  const prevTintKey = prevView ? layerColorKey(prevLayers) : '';
  const curLoaded = cachedImage(curUrl) != null;
  const prevLoaded = cachedImage(prevUrl) != null;
  const tints = useMemo(() => {
    const m = new Map<string, HTMLCanvasElement>();
    const curImg = curLoaded ? cachedImage(curUrl) : null;
    const prevImg = prevLoaded ? cachedImage(prevUrl) : null;
    if (curImg) for (const c of curTintKey.split('|').filter(Boolean)) m.set(`cur|${c}`, tintCanvas(curImg, c));
    if (prevImg) for (const c of prevTintKey.split('|').filter(Boolean)) m.set(`prev|${c}`, tintCanvas(prevImg, c));
    return m;
  }, [curUrl, curLoaded, curTintKey, prevUrl, prevLoaded, prevTintKey]);

  const cur: StateArt = { view: state.view, geom: curMeasured ?? matrixGeometry(state.view), img: cachedImage(curUrl), layers: colors };
  const prev: StateArt | null = prevView
    ? { view: prevView, geom: prevMeasured ?? matrixGeometry(prevView), img: cachedImage(prevUrl), layers: prevLayers }
    : null;

  const toPx = (b: SegmentLocalBox, pad = 0): PxBox => ({
    x: (b.cx - b.w / 2 - pad) * ppuX,
    y: -(b.cy + b.h / 2 + pad) * ppuY,
    w: (b.w + 2 * pad) * ppuX,
    h: (b.h + 2 * pad) * ppuY,
  });
  const inkOf = (geom: MatrixMeasure): PxBox => ({
    x: geom.inkLeftX * ppuX,
    y: -geom.inkTopY * ppuY,
    w: (geom.inkRightX - geom.inkLeftX) * ppuX,
    h: (geom.inkTopY - geom.inkBottomY) * ppuY,
  });
  const ink = inkOf(cur.geom);

  // Only the matrix as created has an intro; later states are on screen already.
  const intro = useMemo(
    () => (k === 0 ? matrixIntroState(item, matrixGeometry(item), currentTime, itemsMap, audioItems) : null),
    [k, item, currentTime, itemsMap, audioItems],
  );

  const fontPx = 0.62 * 0.346 * (item.fontSize / 48) * ppuY * 1.45;

  /** Stand-in for a piece when there is no typeset preview yet. */
  const fallbackPiece = (a: StateArt, ref: MatrixPieceRef, b: PxBox, layers: readonly ColorLayer[] | undefined): ReactNode => {
    if ('cell' in ref) {
      const { row, col } = ref.cell;
      return (
        <Text
          x={b.x - b.w}
          y={b.y + b.h / 2 - fontPx * 0.55}
          width={b.w * 3}
          align="center"
          text={texPreviewText(a.view.entries[row]?.[col] ?? '')}
          fontSize={fontPx}
          fontStyle="italic"
          fontFamily="Times New Roman, serif"
          fill={layeredColor(cellColorAt(a.view, row, col), layers)}
          wrap="none"
        />
      );
    }
    const color = layeredColor(item.color, layers);
    return ref.frame === 'bar' ? (
      <Rect x={b.x} y={b.y} width={Math.max(1, b.w)} height={b.h} fill={color} />
    ) : (
      <Path data={bracketPath(item.bracket, b, ref.frame === 'lb' ? 'left' : 'right')} stroke={color} strokeWidth={Math.max(1, fontPx * 0.07)} lineCap="round" lineJoin="round" />
    );
  };

  /** One piece cropped from a state's preview at `crop`, drawn at `box`, revealed and recoloured. */
  const piece = (key: string, a: StateArt, which: 'cur' | 'prev', ref: MatrixPieceRef, crop: SegmentLocalBox, box: SegmentLocalBox, reveal: PieceReveal) => {
    if (reveal.opacity <= 0 || reveal.wipe <= 0) return null;
    const layers = 'cell' in ref ? a.layers.cells.get(cellKey(ref.cell)) : a.layers.frame;
    const img = a.img;
    if (!img) {
      return (
        <Group key={key} opacity={reveal.opacity * (reveal.wipe < 1 ? reveal.wipe : 1)} listening={false}>
          {fallbackPiece(a, ref, toPx(box), layers)}
        </Group>
      );
    }
    const src = toPx(crop, PIECE_PAD);
    const dst = toPx(box, PIECE_PAD);
    const srcInk = inkOf(a.geom);
    const fx = (v: number) => (v - srcInk.x) / srcInk.w;
    const fy = (v: number) => (v - srcInk.y) / srcInk.h;
    const w = dst.w * reveal.wipe;
    const c = {
      x: fx(src.x) * img.naturalWidth,
      y: fy(src.y) * img.naturalHeight,
      width: Math.max(1, ((src.w * reveal.wipe) / srcInk.w) * img.naturalWidth),
      height: Math.max(1, (src.h / srcInk.h) * img.naturalHeight),
    };
    // A layer at full opacity replaces the colour: start from its tinted copy instead of drawing
    // it over the original, which would thicken the antialiased edges.
    const all = layers ?? [];
    let first = -1;
    all.forEach((l, i) => {
      if (l.opacity >= 0.999 && tints.has(`${which}|${l.color}`)) first = i;
    });
    const base = first >= 0 ? tints.get(`${which}|${all[first]!.color}`)! : img;
    return (
      <Group key={key} opacity={reveal.opacity} listening={false}>
        <KonvaImage image={base} x={dst.x} y={dst.y} width={w} height={dst.h} crop={c} />
        {all.slice(first + 1).map((l, i) => {
          const t = tints.get(`${which}|${l.color}`);
          return t ? <KonvaImage key={i} image={t} x={dst.x} y={dst.y} width={w} height={dst.h} crop={c} opacity={l.opacity} /> : null;
        })}
      </Group>
    );
  };

  let content: ReactNode;
  if (prev && progress != null && state.spec) {
    // A step is playing: pieces of both states, moving and cross-fading.
    content = matrixStepPieces(state.spec, prev.view, prev.geom, cur.view, cur.geom, progress).map((p) =>
      piece(p.key, p.from === 'prev' ? prev : cur, p.from, p.ref, p.crop, p.box, { opacity: p.opacity, wipe: 1 }),
    );
  } else {
    const geom = cur.geom;
    const frameReveal = intro?.frame ?? { opacity: 1, wipe: 1 };
    const framePieces: ReactNode[] = [];
    for (const [name, box] of [['lb', geom.leftBracket], ['rb', geom.rightBracket], ['bar', geom.bar]] as const) {
      if (box) framePieces.push(piece(name, cur, 'cur', { frame: name }, box, box, frameReveal));
    }
    const scaled = colors.blinkScale;
    const scaledKeys = new Set(scaled?.cells.map(cellKey) ?? []);
    const cellPiece = (c: (typeof geom.cells)[number]) =>
      piece(`c${cellKey(c)}`, cur, 'cur', { cell: { row: c.row, col: c.col } }, c, c, intro?.cells.get(cellKey(c)) ?? { opacity: 1, wipe: 1 });
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
    content = (
      <>
        {framePieces}
        {geom.cells.filter((c) => !scaledKeys.has(cellKey(c))).map(cellPiece)}
        {scaledGroup}
      </>
    );
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
      {content}
    </Group>
  );
}
