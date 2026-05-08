import { FRAME_W, FRAME_H } from '@/lib/constants';
import type { SceneItem, ItemId, ManimDirection, PosStep, PosStepToEdge } from '@/types/scene';
import { computeNextToMobCenter } from '@/lib/nextToGeometry';
import { polylinePointExtents } from '@/lib/polylineExtents';

export interface ItemBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Graph overlays are drawn on the canvas at their axes center (see SceneCanvas / GraphNode).
 * Use this for preview features that should match that anchor (e.g. surrounding rectangles).
 */
export function resolvePositionOrAxesAnchor(
  item: SceneItem,
  allItems: Map<ItemId, SceneItem>,
): { x: number; y: number } {
  if (
    (item.kind === 'graphPlot' ||
      item.kind === 'graphDot' ||
      item.kind === 'graphField' ||
      item.kind === 'graphFunctionSeries' ||
      item.kind === 'graphArea') &&
    item.axesId
  ) {
    const ax = allItems.get(item.axesId);
    if (ax?.kind === 'axes') return resolvePosition(ax, allItems);
  }
  return resolvePosition(item, allItems);
}

/** Bbox for surround-style UI when the target is a graph overlay (use parent axes extents). */
export function getItemSurroundBBox(
  item: SceneItem,
  allItems: Map<ItemId, SceneItem>,
): ItemBBox {
  if (
    (item.kind === 'graphPlot' ||
      item.kind === 'graphDot' ||
      item.kind === 'graphField' ||
      item.kind === 'graphFunctionSeries' ||
      item.kind === 'graphArea') &&
    item.axesId
  ) {
    const ax = allItems.get(item.axesId);
    if (ax?.kind === 'axes') return getItemBBox(ax);
  }
  return getItemBBox(item);
}

export function getItemBBox(item: SceneItem): ItemBBox {
  if (item.kind === 'exit_animation' || item.kind === 'blink_animation' || item.kind === 'surroundingRect') {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const x = item.x;
  const y = item.y;
  let w: number, h: number;

  if (item.kind === 'textLine') {
    w = item.measure?.widthInk ?? 4;
    h = item.measure?.heightInk ?? 0.5;
  } else if (item.kind === 'axes') {
    const [xMin, xMax] = item.xRange;
    const [yMin, yMax] = item.yRange;
    w = (xMax - xMin) * item.scaleX;
    h = (yMax - yMin) * item.scaleY;
    return { x, y, w, h };
  } else if (item.kind === 'shape') {
    switch (item.shapeType) {
      case 'circle':
        w = 2 * item.radius;
        h = 2 * item.radius;
        break;
      case 'rectangle':
        w = item.width;
        h = item.height;
        break;
      case 'arrow':
      case 'line':
        w = Math.max(0.15, Math.abs(item.endX));
        h = Math.max(0.15, Math.abs(item.endY));
        break;
      case 'polyline': {
        const d = polylinePointExtents(item.points);
        w = d.w;
        h = d.h;
        break;
      }
      default:
        w = 0.5;
        h = 0.5;
    }
  } else {
    w = 0.5;
    h = 0.5;
  }

  return { x, y, w: w * item.scale, h: h * item.scale };
}

function directionVector(dir: ManimDirection): { dx: number; dy: number } {
  switch (dir) {
    case 'UP':
      return { dx: 0, dy: 1 };
    case 'DOWN':
      return { dx: 0, dy: -1 };
    case 'LEFT':
      return { dx: -1, dy: 0 };
    case 'RIGHT':
      return { dx: 1, dy: 0 };
    case 'UL':
      return { dx: -1, dy: 1 };
    case 'UR':
      return { dx: 1, dy: 1 };
    case 'DL':
      return { dx: -1, dy: -1 };
    case 'DR':
      return { dx: 1, dy: -1 };
  }
}

function resolveTextLineToEdgeCoordinate(
  item: SceneItem,
  step: PosStepToEdge,
  dir: { dx: number; dy: number },
  fallbackBBox: ItemBBox,
): { x?: number; y?: number } {
  const buff = Number.isFinite(step.buff) ? step.buff : 0.3;
  const bounds = step.bounds ?? null;
  if (item.kind !== 'textLine' || bounds === null) {
    return {
      x: dir.dx !== 0 ? dir.dx * (FRAME_W / 2 - fallbackBBox.w / 2 - buff) : undefined,
      y: dir.dy !== 0 ? dir.dy * (FRAME_H / 2 - fallbackBBox.h / 2 - buff) : undefined,
    };
  }

  const scale = Number.isFinite(item.scale) ? item.scale : 1;
  const m = item.measure;
  if (bounds === 'mobject') {
    const w = m ? m.width * scale : fallbackBBox.w;
    const h = m ? m.height * scale : fallbackBBox.h;
    return {
      x: dir.dx !== 0 ? dir.dx * (FRAME_W / 2 - w / 2 - buff) : undefined,
      y: dir.dy !== 0 ? dir.dy * (FRAME_H / 2 - h / 2 - buff) : undefined,
    };
  }

  if (!m) {
    return {
      x: dir.dx !== 0 ? dir.dx * (FRAME_W / 2 - fallbackBBox.w / 2 - buff) : undefined,
      y: dir.dy !== 0 ? dir.dy * (FRAME_H / 2 - fallbackBBox.h / 2 - buff) : undefined,
    };
  }

  return {
    x:
      dir.dx > 0
        ? FRAME_W / 2 - buff - m.inkRightX * scale
        : dir.dx < 0
          ? -FRAME_W / 2 + buff - m.inkLeftX * scale
          : undefined,
    y:
      dir.dy > 0
        ? FRAME_H / 2 - buff - m.inkTopY * scale
        : dir.dy < 0
          ? -FRAME_H / 2 + buff - m.inkBottomY * scale
          : undefined,
  };
}

function applyPosSteps(
  item: SceneItem,
  allItems: Map<ItemId, SceneItem>,
  steps: readonly PosStep[],
): { x: number; y: number } {
  if (item.kind === 'exit_animation' || item.kind === 'blink_animation' || item.kind === 'surroundingRect') {
    return { x: 0, y: 0 };
  }

  let x = item.x;
  let y = item.y;

  const selfBBox = getItemBBox(item);

  for (const step of steps) {
    switch (step.kind) {
      case 'absolute':
        x = item.x;
        y = item.y;
        break;

      case 'next_to': {
        if (!step.refId) break;
        const ref = allItems.get(step.refId);
        if (!ref) break;

        const refResolved = resolvePosition(ref, allItems);
        const next = computeNextToMobCenter({
          selfMobX: x,
          selfMobY: y,
          selfItem: item,
          refMobX: refResolved.x,
          refMobY: refResolved.y,
          refItem: ref,
          step,
        });
        x = next.x;
        y = next.y;
        break;
      }

      case 'to_edge': {
        const dir = directionVector(step.edge);
        const next = resolveTextLineToEdgeCoordinate(item, step, dir, selfBBox);
        if (next.x !== undefined) x = next.x;
        if (next.y !== undefined) y = next.y;
        break;
      }

      case 'shift':
        x += step.dx;
        y += step.dy;
        break;

      case 'set_x':
        x = step.x;
        break;

      case 'set_y':
        y = step.y;
        break;
    }
  }

  return { x, y };
}

/**
 * Resolve the final Manim-space center of an item by walking its posSteps chain.
 */
export function resolvePosition(
  item: SceneItem,
  allItems: Map<ItemId, SceneItem>,
): { x: number; y: number } {
  if (item.kind === 'exit_animation' || item.kind === 'blink_animation' || item.kind === 'surroundingRect') {
    return { x: 0, y: 0 };
  }
  return applyPosSteps(item, allItems, item.posSteps);
}

/**
 * Position after applying `posSteps[0..endExclusive)` (for codegen ink shift).
 */
export function resolvePositionBeforeStep(
  item: SceneItem,
  allItems: Map<ItemId, SceneItem>,
  endExclusive: number,
): { x: number; y: number } {
  if (item.kind === 'exit_animation' || item.kind === 'blink_animation' || item.kind === 'surroundingRect') {
    return { x: 0, y: 0 };
  }
  const slice = item.posSteps.slice(0, Math.max(0, endExclusive));
  return applyPosSteps(item, allItems, slice);
}
