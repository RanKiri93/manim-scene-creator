import type {
  AudioTrackItem,
  ExitAnimStyle,
  ExitAnimationItem,
  BlinkAnimationItem,
  BlinkTargetSpec,
  FrameDef,
  ItemId,
  SceneItem,
  TextLineItem,
  TargetAnimationItem,
  TargetAnimationTargetSpec,
} from '@/types/scene';
import { isVisibleAtSceneStartItem } from '@/types/scene';
import {
  effectiveStart,
  segmentWaitTotal,
  textLineAnimOnlyDuration,
} from '@/lib/time';
import { getSegmentAnimSec } from '@/lib/segmentAnimDurations';
import {
  resolveRecordedPlayback,
  type ExportLeafWithAudio,
} from '@/codegen/lineCodegen';
import {
  resolveTextBlinkPieces,
  textBlinkUsesWholeObjectScale,
} from '@/lib/blinkTextTargets';
import { canBeTargetAnimationTarget } from '@/lib/time';
import { cameraTargetPoint, frameCenterById } from '@/lib/frameGrid';

export interface TextSegmentPreviewState {
  index: number;
  progress: number;
  opacity: number;
  visible: boolean;
}

export interface TextTransformPreviewState {
  source: TextLineItem;
  target: TextLineItem;
  progress: number;
}

export interface ExitPreviewState {
  clip: ExitAnimationItem;
  style: ExitAnimStyle;
  progress: number;
  opacity: number;
  scale: number;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function positiveDuration(sec: number): number {
  return Number.isFinite(sec) && sec > 0 ? sec : 0.01;
}

export function cameraOffsetAtTime(
  time: number,
  items: Map<ItemId, SceneItem>,
  frames: readonly FrameDef[],
  startFrameId: ItemId,
): { x: number; y: number } {
  let current = frameCenterById(frames, startFrameId);
  const clips = Array.from(items.values())
    .filter((it) => it.kind === 'camera_move')
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  for (const clip of clips) {
    const target = cameraTargetPoint(
      frames,
      clip.targetFrameId,
      clip.offsetX ?? 0,
      clip.offsetY ?? 0,
    );
    if (time < clip.startTime) break;
    const dur = positiveDuration(clip.duration);
    if (time >= clip.startTime + dur) {
      current = target;
      continue;
    }
    const t = clamp01((time - clip.startTime) / dur);
    return {
      x: current.x + (target.x - current.x) * t,
      y: current.y + (target.y - current.y) * t,
    };
  }
  return current;
}

function isExportLeafWithAudio(item: SceneItem): item is ExportLeafWithAudio {
  return (
    item.kind === 'textLine' ||
    item.kind === 'axes' ||
    item.kind === 'graphPlot' ||
    item.kind === 'graphCurve' ||
    item.kind === 'graphDot' ||
    item.kind === 'graphField' ||
    item.kind === 'graphFunctionSeries' ||
    item.kind === 'graphPointSequence' ||
    item.kind === 'graphArea' ||
    item.kind === 'shape'
  );
}

export function previewRunTime(
  item: SceneItem,
  items: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
): number {
  if (isExportLeafWithAudio(item)) {
    const recorded = resolveRecordedPlayback(item, items, audioItems);
    if (recorded) return positiveDuration(recorded.runTime);
  }
  if (item.kind === 'textLine') {
    return positiveDuration(textLineAnimOnlyDuration(item, items));
  }
  if ('duration' in item) {
    return positiveDuration(item.duration);
  }
  return 0.01;
}

function textSegmentDurationsForPreview(
  item: TextLineItem,
  items: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
): number[] {
  const baseAnimOnly = textLineAnimOnlyDuration(item, items);
  const raw = getSegmentAnimSec(item.segments, baseAnimOnly);
  const recorded = resolveRecordedPlayback(item, items, audioItems);
  if (!recorded) return raw;
  const denom = baseAnimOnly > 1e-12 ? baseAnimOnly : 1;
  return raw.map((sec) => (recorded.runTime * sec) / denom);
}

export function textIntroSegmentStates(
  item: TextLineItem,
  time: number,
  items: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
): TextSegmentPreviewState[] {
  const t0 = effectiveStart(item, items);
  if (isVisibleAtSceneStartItem(item) && time >= t0) {
    const n = item.segments.length;
    if (n === 0) {
      return [{ index: 0, progress: 1, opacity: 1, visible: true }];
    }
    return item.segments.map((_, i) => ({
      index: i,
      progress: 1,
      opacity: 1,
      visible: true,
    }));
  }
  const n = item.segments.length;
  if (n === 0) {
    const p = clamp01((time - effectiveStart(item, items)) / previewRunTime(item, items, audioItems));
    return [{ index: 0, progress: p, opacity: p, visible: p > 0 }];
  }

  const localT = time - effectiveStart(item, items);
  const animSecs = textSegmentDurationsForPreview(item, items, audioItems);
  const fade = (item.animStyle ?? 'write') === 'fade_in';
  const out: TextSegmentPreviewState[] = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const anim = positiveDuration(animSecs[i] ?? 0);
    let progress = 0;
    if (localT >= cursor + anim) {
      progress = 1;
    } else if (localT >= cursor) {
      progress = clamp01((localT - cursor) / anim);
    }
    out.push({
      index: i,
      progress,
      opacity: fade ? progress : progress > 0 ? 1 : 0,
      visible: progress > 0,
    });
    cursor += anim + Math.max(0, item.segments[i]?.waitAfterSec ?? 0);
  }
  return out;
}

export function textIntroFinished(
  item: TextLineItem,
  time: number,
  items: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
): boolean {
  const t0 = effectiveStart(item, items);
  if (isVisibleAtSceneStartItem(item) && time >= t0) return true;
  const animOnly = previewRunTime(item, items, audioItems);
  return time >= t0 + animOnly + segmentWaitTotal(item.segments);
}

export function activeTextTransformForLine(
  line: TextLineItem,
  time: number,
  items: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
): TextTransformPreviewState | null {
  let best: TextTransformPreviewState | null = null;
  let bestStart = -Infinity;
  for (const it of items.values()) {
    if (it.kind !== 'textLine') continue;
    if (it.animStyle !== 'transform') continue;
    const sourceId = it.transformConfig?.sourceLineId;
    if (sourceId !== line.id && it.id !== line.id) continue;
    const source = sourceId ? items.get(sourceId) : null;
    if (!source || source.kind !== 'textLine') continue;
    const start = effectiveStart(it, items);
    const dur = previewRunTime(it, items, audioItems);
    if (time < start || time >= start + dur) continue;
    if (start < bestStart) continue;
    bestStart = start;
    best = {
      source,
      target: it,
      progress: clamp01((time - start) / dur),
    };
  }
  return best;
}

export function exitPreviewForTarget(
  targetId: ItemId,
  time: number,
  items: Map<ItemId, SceneItem>,
): ExitPreviewState | null {
  let best: ExitPreviewState | null = null;
  let bestStart = -Infinity;
  for (const it of items.values()) {
    if (it.kind !== 'exit_animation') continue;
    if (time < it.startTime || time >= it.startTime + positiveDuration(it.duration)) continue;
    const spec = it.targets.find(
      (row) => row.targetId === targetId && row.animStyle !== 'none',
    );
    if (!spec) continue;
    if (it.startTime < bestStart) continue;
    bestStart = it.startTime;
    const progress = clamp01((time - it.startTime) / positiveDuration(it.duration));
    const opacity =
      spec.animStyle === 'fade_out' || spec.animStyle === 'uncreate'
        ? 1 - progress
        : progress >= 0.98
          ? 0
          : 1;
    const scale =
      spec.animStyle === 'shrink_to_center' || spec.animStyle === 'uncreate'
        ? Math.max(0.001, 1 - progress)
        : 1;
    best = {
      clip: it,
      style: spec.animStyle,
      progress,
      opacity,
      scale,
    };
  }
  return best;
}

function blinkEnvelopeAtTime(clip: BlinkAnimationItem, time: number): number {
  const dur = positiveDuration(clip.duration);
  if (time < clip.startTime || time >= clip.startTime + dur) return 0;
  const local = time - clip.startTime;
  const reps = Math.max(1, Math.round(clip.repetitions) || 1);
  const cycleLen = dur / reps;
  const u = (local % cycleLen) / cycleLen;
  return u < 0.5 ? u * 2 : (1 - u) * 2;
}

function resolvedBlinkSf(row: BlinkTargetSpec): number {
  const s = row.scaleFactor;
  if (typeof s === 'number' && Number.isFinite(s) && s > 1e-6) return s;
  return 1.15;
}

function resolvedBlinkHex(row: BlinkTargetSpec): string {
  const h = row.blinkColor?.trim();
  return h || '#fbbf24';
}

export interface BlinkPreviewState {
  clip: BlinkAnimationItem;
  row: BlinkTargetSpec;
  envelope: number;
  /** Multiply with exit/other scale. */
  scaleMultiplier: number;
  /** 0..1 lerp toward blinkColor for flat colors (shapes / simple strokes). */
  colorMix: number;
  blinkColor: string;
  /** For text lines: blink tint only these segment indices; `null` = all segments. */
  textSegmentIndices: Set<number> | null;
  /** Manim math subobjects (`line[seg][child]`) to tint; skips full-segment tint for those segments. */
  textMathChildHighlights: { segmentIndex: number; childIndex: number }[] | null;
  /**
   * When false, canvas should apply blink scale inside the text preview (piecewise) instead of
   * scaling the whole line node.
   */
  applyOuterBlinkScale: boolean;
}

export function blinkPreviewForTarget(
  targetId: ItemId,
  time: number,
  items: Map<ItemId, SceneItem>,
): BlinkPreviewState | null {
  let best: BlinkPreviewState | null = null;
  let bestStart = -Infinity;
  for (const it of items.values()) {
    if (it.kind !== 'blink_animation') continue;
    if (it.targets.length === 0) continue;
    const row = it.targets.find((r) => r.targetId === targetId);
    if (!row) continue;
    const dur = positiveDuration(it.duration);
    if (time < it.startTime || time >= it.startTime + dur) continue;
    if (it.startTime < bestStart) continue;
    const env = blinkEnvelopeAtTime(it, time);
    const mode = row.mode;
    const sf = resolvedBlinkSf(row);
    const bc = resolvedBlinkHex(row);
    let scaleMul = 1;
    let colorMix = 0;
    if (mode === 'scale') {
      scaleMul = 1 + (sf - 1) * env;
    }
    if (mode === 'color') {
      colorMix = env;
    }

    const tgt = items.get(targetId);
    let textSegmentIndices: Set<number> | null = null;
    let textMathChildHighlights: {
      segmentIndex: number;
      childIndex: number;
    }[] | null = null;
    let applyOuterBlinkScale = true;

    if (tgt?.kind === 'textLine') {
      const line = tgt;
      const rawSeg = row.segmentIndices?.filter(
        (i) => Number.isInteger(i) && i >= 0 && i < line.segments.length,
      );
      textSegmentIndices =
        rawSeg != null && rawSeg.length > 0 ? new Set(rawSeg) : null;

      const childHits: { segmentIndex: number; childIndex: number }[] = [];
      for (const p of resolveTextBlinkPieces(line, row)) {
        if (!p.whole) {
          for (const c of p.childIndices) {
            childHits.push({ segmentIndex: p.segmentIndex, childIndex: c });
          }
        }
      }
      textMathChildHighlights = childHits.length > 0 ? childHits : null;

      const usesSc = mode === 'scale';
      applyOuterBlinkScale = !usesSc || textBlinkUsesWholeObjectScale(line, row);
    }

    bestStart = it.startTime;
    best = {
      clip: it,
      row,
      envelope: env,
      scaleMultiplier: scaleMul,
      colorMix,
      blinkColor: bc,
      textSegmentIndices,
      textMathChildHighlights,
      applyOuterBlinkScale,
    };
  }
  return best;
}

function resolvedTaScale(sf: TargetAnimationTargetSpec): number {
  const s = sf.scaleFactor;
  if (typeof s === 'number' && Number.isFinite(s) && s > 1e-9) return s;
  return 1.15;
}

function resolvedTaHex(sf: TargetAnimationTargetSpec): string {
  const h = sf.color?.trim();
  return h && /^#[0-9a-fA-F]{6}$/.test(h) ? h : '#38bdf8';
}

function interpolatePathOffset(
  pts: TargetAnimationTargetSpec['pathPoints'],
  u: number,
): { x: number; y: number } | null {
  if (!pts || pts.length < 2) return null;
  const t = clamp01(u);
  let total = 0;
  const lens: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    lens.push(len);
    total += len;
  }
  if (total <= 1e-9) {
    const last = pts[pts.length - 1]!;
    const first = pts[0]!;
    return { x: last.x - first.x, y: last.y - first.y };
  }
  let remain = t * total;
  const first = pts[0]!;
  for (let i = 1; i < pts.length; i++) {
    const segLen = lens[i - 1] ?? 0;
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (remain <= segLen || i === pts.length - 1) {
      const local = segLen > 1e-9 ? remain / segLen : 1;
      return {
        x: a.x + (b.x - a.x) * local - first.x,
        y: a.y + (b.y - a.y) * local - first.y,
      };
    }
    remain -= segLen;
  }
  const last = pts[pts.length - 1]!;
  return { x: last.x - first.x, y: last.y - first.y };
}

function evalParametricPathExpr(expr: string, t: number): number | null {
  const src = expr.trim() || '0';
  try {
    const v = new Function('t', `"use strict"; return (${src});`)(t);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function parametricPathOffset(
  row: TargetAnimationTargetSpec,
  u: number,
): { x: number; y: number } | null {
  const p = row.parametricPath;
  if (!p) return null;
  const t0 = Number.isFinite(p.tMin) ? p.tMin : 0;
  const t1 = Number.isFinite(p.tMax) ? p.tMax : 1;
  const t = t0 + clamp01(u) * (t1 - t0);
  const x0 = evalParametricPathExpr(p.jsXExpr, t0);
  const y0 = evalParametricPathExpr(p.jsYExpr, t0);
  const x = evalParametricPathExpr(p.jsXExpr, t);
  const y = evalParametricPathExpr(p.jsYExpr, t);
  if (x0 == null || y0 == null || x == null || y == null) return null;
  return { x: x - x0, y: y - y0 };
}

export interface TargetAnimPreviewAccum {
  dx: number;
  dy: number;
  scaleMul: number;
  rotDeg: number;
  /** When set, preview uses this stroke/line color (after finished color animations). */
  strokeReplaceHex?: string;
  /** In-progress color morph toward this hex (`t` ∈ [0,1]). */
  colorLerpTo?: string;
  colorLerpT?: number;
}

export function targetAnimPreviewAccum(
  targetId: ItemId,
  time: number,
  items: Map<ItemId, SceneItem>,
): TargetAnimPreviewAccum {
  const clips = [...items.values()]
    .filter((it): it is TargetAnimationItem => it.kind === 'target_animation')
    .filter((c) => c.targets.some((r) => r.targetId === targetId))
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));

  let dx = 0;
  let dy = 0;
  let scaleMul = 1;
  let rotDeg = 0;
  let strokeReplaceHex: string | undefined;
  let colorLerpTo: string | undefined;
  let colorLerpT = 0;

  for (const clip of clips) {
    const row = clip.targets.find((r) => r.targetId === targetId);
    if (!row) continue;
    const tgt = items.get(targetId);
    if (!tgt || !canBeTargetAnimationTarget(tgt, clip.mode)) continue;

    const dur = positiveDuration(clip.duration);
    const t0 = clip.startTime;
    const tEnd = t0 + dur;
    if (time < t0) continue;

    const u = time >= tEnd ? 1 : clamp01((time - t0) / dur);

    switch (clip.mode) {
      case 'scale': {
        const sf = resolvedTaScale(row);
        scaleMul *= 1 + u * (sf - 1);
        break;
      }
      case 'move': {
        const mdx = row.dx ?? 0;
        const mdy = row.dy ?? 0;
        dx += u * mdx;
        dy += u * mdy;
        break;
      }
      case 'path': {
        const off =
          row.pathKind === 'parametric'
            ? parametricPathOffset(row, u)
            : interpolatePathOffset(row.pathPoints, u);
        if (off) {
          dx += off.x;
          dy += off.y;
        }
        break;
      }
      case 'rotate': {
        rotDeg += u * (row.angleDeg ?? 0);
        break;
      }
      case 'color': {
        const h = resolvedTaHex(row);
        if (time >= tEnd) {
          strokeReplaceHex = h;
          colorLerpTo = undefined;
          colorLerpT = 0;
        } else {
          colorLerpTo = h;
          colorLerpT = u;
        }
        break;
      }
      default:
        break;
    }
  }

  const out: TargetAnimPreviewAccum = {
    dx,
    dy,
    scaleMul,
    rotDeg,
  };
  if (strokeReplaceHex) out.strokeReplaceHex = strokeReplaceHex;
  if (colorLerpTo != null && colorLerpT > 1e-6) {
    out.colorLerpTo = colorLerpTo;
    out.colorLerpT = colorLerpT;
  }
  return out;
}

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Linear RGB lerp between two #RRGGBB colors. */
export function lerpHexColor(from: string, to: string, t: number): string {
  const x = clamp01(t);
  const a = parseHexColor(from) ?? { r: 255, g: 255, b: 255 };
  const b = parseHexColor(to) ?? { r: 251, g: 191, b: 36 };
  const r = Math.round(a.r + (b.r - a.r) * x);
  const gch = Math.round(a.g + (b.g - a.g) * x);
  const bl = Math.round(a.b + (b.b - a.b) * x);
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(gch)}${h(bl)}`;
}
