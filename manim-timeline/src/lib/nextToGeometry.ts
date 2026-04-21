/**
 * Manim-compatible `next_to` geometry (ManimCommunity `Mobject.next_to`: critical points
 * with `aligned_edge ± direction`, then shift by target − point + buff·direction).
 */

import type {
  ManimDirection,
  PosStepNextTo,
  SceneItem,
  TextLineItem,
  SegmentLocalBox,
  NextToBoundsMode,
} from '@/types/scene';

export function rawDirectionComponents(dir: ManimDirection): { dx: number; dy: number } {
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

export function normalizedDirection(dir: ManimDirection): { dx: number; dy: number } {
  const v = rawDirectionComponents(dir);
  const len = Math.hypot(v.dx, v.dy);
  if (len < 1e-12) return { dx: 1, dy: 0 };
  return { dx: v.dx / len, dy: v.dy / len };
}

/** `aligned_edge` vector for Manim (cardinal and diagonal constants). */
export function alignedEdgeComponents(edge: ManimDirection): { ex: number; ey: number } {
  const v = rawDirectionComponents(edge);
  return { ex: v.dx, ey: v.dy };
}

export function criticalPoint(
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  vx: number,
  vy: number,
): { x: number; y: number } {
  const px = vx > 0 ? cx + hw : vx < 0 ? cx - hw : cx;
  const py = vy > 0 ? cy + hh : vy < 0 ? cy - hh : cy;
  return { x: px, y: py };
}

export interface AlignBox {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}

function textLineBoxDims(
  line: TextLineItem,
  bounds: NextToBoundsMode | null,
): { hw: number; hh: number } {
  const sc = line.scale;
  const m = line.measure;
  if (!m) {
    return { hw: 2 * sc, hh: 0.25 * sc };
  }
  if (bounds === 'mobject') {
    return { hw: (m.width * sc) / 2, hh: (m.height * sc) / 2 };
  }
  if (bounds === 'ink') {
    return { hw: (m.widthInk * sc) / 2, hh: (m.heightInk * sc) / 2 };
  }
  // legacy: ink size, mobject center (no offset in box center)
  return { hw: (m.widthInk * sc) / 2, hh: (m.heightInk * sc) / 2 };
}

function textLineAlignCenter(
  line: TextLineItem,
  mobX: number,
  mobY: number,
  bounds: NextToBoundsMode | null,
): { cx: number; cy: number } {
  const m = line.measure;
  if (bounds === 'ink' && m) {
    return {
      cx: mobX + m.offsetInkX * line.scale,
      cy: mobY + m.offsetInkY * line.scale,
    };
  }
  return { cx: mobX, cy: mobY };
}

/** Axes / shape / text line (non-segment) align box in scene coords. */
export function alignBoxForItemAt(
  item: SceneItem,
  mobX: number,
  mobY: number,
  bounds: NextToBoundsMode | null,
  segmentIndex: number | null,
  segmentMeasures: SegmentLocalBox[] | null | undefined,
): AlignBox | null {
  if (item.kind === 'exit_animation' || item.kind === 'surroundingRect') return null;

  if (item.kind === 'textLine') {
    const line = item as TextLineItem;
    const segs = segmentMeasures ?? line.segmentMeasures;
    if (
      segmentIndex != null &&
      segs &&
      segmentIndex >= 0 &&
      segmentIndex < segs.length
    ) {
      const b = segs[segmentIndex]!;
      const sc = line.scale;
      return {
        cx: mobX + b.cx * sc,
        cy: mobY + b.cy * sc,
        hw: (b.w * sc) / 2,
        hh: (b.h * sc) / 2,
      };
    }
    const { hw, hh } = textLineBoxDims(line, bounds);
    const { cx, cy } = textLineAlignCenter(line, mobX, mobY, bounds);
    return { cx, cy, hw, hh };
  }

  if (item.kind === 'axes') {
    const [xMin, xMax] = item.xRange;
    const [yMin, yMax] = item.yRange;
    const w = (xMax - xMin) * item.scaleX;
    const h = (yMax - yMin) * item.scaleY;
    return { cx: mobX, cy: mobY, hw: w / 2, hh: h / 2 };
  }

  if (item.kind === 'shape') {
    let w: number;
    let h: number;
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
      default:
        w = 0.5;
        h = 0.5;
    }
    w *= item.scale;
    h *= item.scale;
    return { cx: mobX, cy: mobY, hw: w / 2, hh: h / 2 };
  }

  return { cx: mobX, cy: mobY, hw: 0.25, hh: 0.25 };
}

/**
 * Mob center of `selfItem` after a `next_to` step (Manim-equivalent).
 */
export function computeNextToMobCenter(params: {
  selfMobX: number;
  selfMobY: number;
  selfItem: SceneItem;
  refMobX: number;
  refMobY: number;
  refItem: SceneItem;
  step: PosStepNextTo;
  /** When set for a text-line ref/self, overrides `step.bounds` for that side (ink correction). */
  refTextBounds?: NextToBoundsMode | null;
  selfTextBounds?: NextToBoundsMode | null;
}): { x: number; y: number } {
  const {
    selfMobX,
    selfMobY,
    selfItem,
    refMobX,
    refMobY,
    refItem,
    step,
    refTextBounds,
    selfTextBounds,
  } = params;
  const d = normalizedDirection(step.dir);
  const ae = step.alignedEdge
    ? alignedEdgeComponents(step.alignedEdge)
    : { ex: 0, ey: 0 };

  const refBounds =
    refItem.kind === 'textLine'
      ? (refTextBounds !== undefined ? refTextBounds : (step.bounds ?? null))
      : null;
  const selfBounds =
    selfItem.kind === 'textLine'
      ? (selfTextBounds !== undefined ? selfTextBounds : (step.bounds ?? null))
      : null;

  const refBox = alignBoxForItemAt(
    refItem,
    refMobX,
    refMobY,
    refItem.kind === 'textLine' ? refBounds : null,
    step.refSegmentIndex,
    refItem.kind === 'textLine'
      ? (refItem as TextLineItem).segmentMeasures
      : undefined,
  );
  const selfBox = alignBoxForItemAt(
    selfItem,
    selfMobX,
    selfMobY,
    selfItem.kind === 'textLine' ? selfBounds : null,
    step.selfSegmentIndex,
    selfItem.kind === 'textLine'
      ? (selfItem as TextLineItem).segmentMeasures
      : undefined,
  );

  if (!refBox || !selfBox) {
    return { x: selfMobX, y: selfMobY };
  }

  const target = criticalPoint(
    refBox.cx,
    refBox.cy,
    refBox.hw,
    refBox.hh,
    ae.ex + d.dx,
    ae.ey + d.dy,
  );
  const point = criticalPoint(
    selfBox.cx,
    selfBox.cy,
    selfBox.hw,
    selfBox.hh,
    ae.ex - d.dx,
    ae.ey - d.dy,
  );

  return {
    x: selfMobX + (target.x - point.x + step.buff * d.dx),
    y: selfMobY + (target.y - point.y + step.buff * d.dy),
  };
}

/**
 * After mobject-based `next_to`, ink mode needs an extra shift so ink boxes match.
 * Returns `(dx, dy)` for `shift(dx * RIGHT + dy * UP)` in Manim coords.
 */
export function computeInkCorrectiveShift(params: {
  selfMobBefore: { x: number; y: number };
  selfItem: TextLineItem;
  refMobX: number;
  refMobY: number;
  refItem: SceneItem;
  step: PosStepNextTo;
}): { dx: number; dy: number } {
  const { selfMobBefore, selfItem, refMobX, refMobY, refItem, step } = params;

  const inkCenter = computeNextToMobCenter({
    selfMobX: selfMobBefore.x,
    selfMobY: selfMobBefore.y,
    selfItem,
    refMobX,
    refMobY,
    refItem,
    step,
    refTextBounds: refItem.kind === 'textLine' ? 'ink' : undefined,
    selfTextBounds: 'ink',
  });

  const mobCenter = computeNextToMobCenter({
    selfMobX: selfMobBefore.x,
    selfMobY: selfMobBefore.y,
    selfItem,
    refMobX,
    refMobY,
    refItem,
    step,
    refTextBounds: refItem.kind === 'textLine' ? 'mobject' : undefined,
    selfTextBounds: 'mobject',
  });

  return {
    dx: inkCenter.x - mobCenter.x,
    dy: inkCenter.y - mobCenter.y,
  };
}
