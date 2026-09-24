import { FRAME_H, FRAME_W } from '@/lib/constants';
import type { MeasureResult } from '@/types/scene';

export const DEFAULT_TEXT_SNAP_BUFFER = 0.3;
export const TEXT_SNAP_CAPTURE_PX = 8;
export const TEXT_SNAP_RELEASE_PX = 12;

export interface SnapBox {
  id: string;
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface TextSnapGuide {
  axis: 'x' | 'y';
  value: number;
  from: number;
  to: number;
  label: string;
  targetId: string;
}

export interface TextSnapResult {
  x: number;
  y: number;
  guides: TextSnapGuide[];
}

export function measuredInkOffset(measure: MeasureResult | null | undefined, scale: number) {
  if (!measure || !Number.isFinite(scale)) return { x: 0, y: 0 };
  return { x: (measure.offsetInkX || 0) * scale, y: (measure.offsetInkY || 0) * scale };
}

export function measuredInkBox(
  id: string,
  x: number,
  y: number,
  measure: MeasureResult | null | undefined,
  scale: number,
): SnapBox | null {
  if (!measure || !(measure.widthInk > 0) || !(measure.heightInk > 0)) return null;
  const edges = [measure.inkLeftX, measure.inkRightX, measure.inkBottomY, measure.inkTopY];
  if (!edges.every(Number.isFinite) || !Number.isFinite(scale) || scale <= 0) return null;
  return {
    id,
    left: x + scale * measure.inkLeftX,
    right: x + scale * measure.inkRightX,
    bottom: y + scale * measure.inkBottomY,
    top: y + scale * measure.inkTopY,
  };
}

interface Option {
  correction: number;
  distancePx: number;
  targetId: string;
  value: number;
  from: number;
  to: number;
  label: string;
}

function nearest(options: Option[], priorTargetId: string | null, capture: number, release: number) {
  const eligible = options.filter((o) =>
    Math.abs(o.correction) * o.distancePx <= (o.targetId === priorTargetId ? release : capture) &&
    Math.abs(o.correction) <= (o.targetId === priorTargetId ? 0.3 : 0.2),
  );
  eligible.sort((a, b) =>
    Math.abs(a.correction) * a.distancePx - Math.abs(b.correction) * b.distancePx ||
    a.targetId.localeCompare(b.targetId) || a.value - b.value,
  );
  return eligible[0] ?? null;
}

/** Snap a measured ink box to nearby boxes or the owning frame's equally inset edges. */
export function snapTextPosition(args: {
  x: number;
  y: number;
  ink: { left: number; right: number; bottom: number; top: number };
  targets: SnapBox[];
  frameCenter: { x: number; y: number };
  buffer?: number;
  pxPerUnitX: number;
  pxPerUnitY: number;
  priorXTargetId?: string | null;
  priorYTargetId?: string | null;
  capturePx?: number;
  releasePx?: number;
}): TextSnapResult {
  const {
    x, y, ink, targets, frameCenter,
    pxPerUnitX, pxPerUnitY,
  } = args;
  const buffer = Number.isFinite(args.buffer) ? Math.max(0, args.buffer!) : DEFAULT_TEXT_SNAP_BUFFER;
  const gapLabel = String(Number(buffer.toFixed(3)));
  const capture = args.capturePx ?? TEXT_SNAP_CAPTURE_PX;
  const release = args.releasePx ?? TEXT_SNAP_RELEASE_PX;
  const moving = {
    left: x + ink.left,
    right: x + ink.right,
    bottom: y + ink.bottom,
    top: y + ink.top,
  };
  const validTargets = targets.filter((b) => b.id && b.id !== 'mover' &&
    [b.left, b.right, b.bottom, b.top].every(Number.isFinite));
  const xOptions: Option[] = [];
  const yOptions: Option[] = [];
  const xPx = Math.max(0.001, pxPerUnitX);
  const yPx = Math.max(0.001, pxPerUnitY);
  const proximityX = capture / xPx;
  const proximityY = capture / yPx;

  const frame = {
    left: frameCenter.x - FRAME_W / 2 + buffer,
    right: frameCenter.x + FRAME_W / 2 - buffer,
    bottom: frameCenter.y - FRAME_H / 2 + buffer,
    top: frameCenter.y + FRAME_H / 2 - buffer,
  };
  for (const [edge, edgeName, coordinate] of [
    ['left', 'frame-left', frame.left], ['right', 'frame-right', frame.right],
  ] as const) {
    const own = moving[edge];
    xOptions.push({ correction: coordinate - own, distancePx: xPx, targetId: edgeName, value: coordinate, from: moving.bottom, to: moving.top, label: gapLabel });
  }
  for (const [edge, edgeName, coordinate] of [
    ['bottom', 'frame-bottom', frame.bottom], ['top', 'frame-top', frame.top],
  ] as const) {
    const own = moving[edge];
    yOptions.push({ correction: coordinate - own, distancePx: yPx, targetId: edgeName, value: coordinate, from: moving.left, to: moving.right, label: gapLabel });
  }

  for (const target of validTargets) {
    // A side-to-side gap candidate needs perpendicular overlap/proximity.
    const closeY = moving.top >= target.bottom - proximityY && moving.bottom <= target.top + proximityY;
    const closeX = moving.right >= target.left - proximityX && moving.left <= target.right + proximityX;
    if (closeY) {
      xOptions.push({ correction: target.left - buffer - moving.right, distancePx: xPx, targetId: `${target.id}:left`, value: target.left, from: Math.max(moving.bottom, target.bottom), to: Math.min(moving.top, target.top), label: gapLabel });
      xOptions.push({ correction: target.right + buffer - moving.left, distancePx: xPx, targetId: `${target.id}:right`, value: target.right, from: Math.max(moving.bottom, target.bottom), to: Math.min(moving.top, target.top), label: gapLabel });
      xOptions.push({ correction: target.left - moving.left, distancePx: xPx, targetId: `${target.id}:align-left`, value: target.left, from: moving.bottom, to: moving.top, label: 'Align' });
      xOptions.push({ correction: target.right - moving.right, distancePx: xPx, targetId: `${target.id}:align-right`, value: target.right, from: moving.bottom, to: moving.top, label: 'Align' });
    }
    if (closeX) {
      yOptions.push({ correction: target.bottom - buffer - moving.top, distancePx: yPx, targetId: `${target.id}:bottom`, value: target.bottom, from: Math.max(moving.left, target.left), to: Math.min(moving.right, target.right), label: gapLabel });
      yOptions.push({ correction: target.top + buffer - moving.bottom, distancePx: yPx, targetId: `${target.id}:top`, value: target.top, from: Math.max(moving.left, target.left), to: Math.min(moving.right, target.right), label: gapLabel });
      yOptions.push({ correction: target.top - moving.top, distancePx: yPx, targetId: `${target.id}:align-top`, value: target.top, from: moving.left, to: moving.right, label: 'Align' });
      yOptions.push({ correction: target.bottom - moving.bottom, distancePx: yPx, targetId: `${target.id}:align-bottom`, value: target.bottom, from: moving.left, to: moving.right, label: 'Align' });
    }
  }

  const sx = nearest(xOptions, args.priorXTargetId ?? null, capture, release);
  const sy = nearest(yOptions, args.priorYTargetId ?? null, capture, release);
  return {
    x: x + (sx?.correction ?? 0),
    y: y + (sy?.correction ?? 0),
    guides: [
      ...(sx ? [{ axis: 'x' as const, value: sx.value, from: sx.from, to: sx.to, label: sx.label, targetId: sx.targetId }] : []),
      ...(sy ? [{ axis: 'y' as const, value: sy.value, from: sy.from, to: sy.to, label: sy.label, targetId: sy.targetId }] : []),
    ],
  };
}
