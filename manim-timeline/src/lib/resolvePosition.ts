import { FRAME_W, FRAME_H } from '@/lib/constants';
import type { SceneItem, ItemId, ManimDirection } from '@/types/scene';

export interface ItemBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function getItemBBox(item: SceneItem): ItemBBox {
  if (item.kind === 'compound') {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const x = item.x;
  const y = item.y;
  let w: number, h: number;

  if (item.kind === 'textLine') {
    w = item.measure?.widthInk ?? 4;
    h = item.measure?.heightInk ?? 0.5;
  } else {
    const [xMin, xMax] = item.xRange;
    const [yMin, yMax] = item.yRange;
    w = (xMax - xMin) * item.scale;
    h = (yMax - yMin) * item.scale;
  }

  return { x, y, w: w * item.scale, h: h * item.scale };
}

function directionVector(dir: ManimDirection): { dx: number; dy: number } {
  switch (dir) {
    case 'UP':    return { dx:  0, dy:  1 };
    case 'DOWN':  return { dx:  0, dy: -1 };
    case 'LEFT':  return { dx: -1, dy:  0 };
    case 'RIGHT': return { dx:  1, dy:  0 };
    case 'UL':    return { dx: -1, dy:  1 };
    case 'UR':    return { dx:  1, dy:  1 };
    case 'DL':    return { dx: -1, dy: -1 };
    case 'DR':    return { dx:  1, dy: -1 };
  }
}

/**
 * Resolve the final Manim-space center of an item by walking its posSteps chain.
 */
export function resolvePosition(
  item: SceneItem,
  allItems: Map<ItemId, SceneItem>,
): { x: number; y: number } {
  if (item.kind === 'compound') {
    return { x: 0, y: 0 };
  }

  let x = item.x;
  let y = item.y;

  const selfBBox = getItemBBox(item);
  const selfW = selfBBox.w;
  const selfH = selfBBox.h;

  for (const step of item.posSteps) {
    switch (step.kind) {
      case 'absolute':
        break;

      case 'next_to': {
        if (!step.refId) break;
        const ref = allItems.get(step.refId);
        if (!ref) break;

        const refResolved = resolvePosition(ref, allItems);
        const refBBox = getItemBBox(ref);
        const dir = directionVector(step.dir);

        x = refResolved.x + dir.dx * (refBBox.w / 2 + selfW / 2 + step.buff);
        y = refResolved.y + dir.dy * (refBBox.h / 2 + selfH / 2 + step.buff);

        if (dir.dx === 0) x = refResolved.x;
        if (dir.dy === 0) y = refResolved.y;
        break;
      }

      case 'to_edge': {
        const dir = directionVector(step.edge);
        if (dir.dx !== 0) {
          x = dir.dx * (FRAME_W / 2 - selfW / 2 - step.buff);
        }
        if (dir.dy !== 0) {
          y = dir.dy * (FRAME_H / 2 - selfH / 2 - step.buff);
        }
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
