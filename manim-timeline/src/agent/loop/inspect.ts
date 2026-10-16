import type { GraphFunctionSeriesItem, ItemId, SceneItem, TextLineItem } from '@/types/scene';
import { functionSeriesChildStartOffset, functionSeriesIndices, resolveFunctionSeriesN } from '@/types/scene';
import { FRAME_H, FRAME_W } from '@/lib/constants';
import { cameraPoseAtTime } from '@/lib/camera';
import { frameCenterById } from '@/lib/frameGrid';
import { resolveGraphDotPosition } from '@/lib/graphMotion';
import { getItemBBox, resolvePosition } from '@/lib/resolvePosition';
import { axesGraphToWorld, isConnectorShape, resolveConnectorEndpoints } from '@/lib/shapeAnchors';
import { buildGraphAnnotationLayout } from '@/lib/graphAnnotationLayout';
import { liveValueSlope } from '@/lib/graphLiveValue';
import { effectiveEnd, effectiveStart, isTransformSourceHiddenInPreview } from '@/lib/time';
import { transformSourceIds } from '@/lib/transformMapping';
import { targetAnimPreviewAccum } from '@/lib/visualPlaybackPreview';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { computeSceneDurationSec } from '@/codegen/manimExporter';
import type { DraftSession } from './draft';
import { actionItemId } from '../types';
import { areaFacts, fieldFacts } from '../graphRegions';
import { transformFacts } from '../textTransforms';
import { narrationWords, wordsDuring, type SpokenWord } from '../narration';

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pt = (p: { x: number; y: number }) => [r3(p.x), r3(p.y)];

const CLIP_KINDS = new Set(['exit_animation', 'blink_animation', 'target_animation', 'camera_move']);

/** Text lines that morph out of `lineId` (animStyle "transform" with it as a source). */
function morphTargets(lineId: ItemId, scene: Map<ItemId, SceneItem>): ItemId[] {
  const out: ItemId[] = [];
  for (const it of scene.values()) {
    if (it.kind === 'textLine' && it.animStyle === 'transform' && it.transformConfig && transformSourceIds(it.transformConfig).includes(lineId)) {
      out.push(it.id);
    }
  }
  return out;
}

interface Rect {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** What the camera shows at `time` (world units), or null without a start frame. */
function cameraRect(session: DraftSession, scene: Map<ItemId, SceneItem>, time: number): Rect | null {
  const { frames, startFrameId } = session.base;
  if (!startFrameId) return null;
  const pose = cameraPoseAtTime(time, scene, frames, startFrameId);
  const h = (pose.width * FRAME_H) / FRAME_W;
  return { left: pose.x - pose.width / 2, right: pose.x + pose.width / 2, bottom: pose.y - h / 2, top: pose.y + h / 2 };
}

function rectOf(center: { x: number; y: number }, w: number, h: number): Rect {
  return { left: center.x - w / 2, right: center.x + w / 2, bottom: center.y - h / 2, top: center.y + h / 2 };
}

/** Sides of `inner` that stick out of `outer` (empty when it fits; 0.02 units of slack). */
function outsideSides(inner: Rect, outer: Rect): string[] {
  const eps = 0.02;
  const out: string[] = [];
  if (inner.left < outer.left - eps) out.push('left');
  if (inner.right > outer.right + eps) out.push('right');
  if (inner.top > outer.top + eps) out.push('top');
  if (inner.bottom < outer.bottom - eps) out.push('bottom');
  return out;
}

/** Segment list of a text line with the indices blink / surround / styling use (line[i]). */
function segmentFacts(item: TextLineItem): Record<string, unknown>[] {
  return item.segments.map((seg, i) => ({
    i,
    text: seg.text,
    ...(seg.isMath ? { math: true } : {}),
    color: seg.color,
    ...(seg.bold ? { bold: true } : {}),
    ...(seg.italic ? { italic: true } : {}),
  }));
}

interface CurveWindow {
  n: number;
  from: number;
  to: number;
}

/** When each curve of a function series animates (scene seconds). */
function seriesSchedule(item: GraphFunctionSeriesItem, start: number): CurveWindow[] {
  return functionSeriesIndices(item).map((n) => {
    const from = start + functionSeriesChildStartOffset(item, n);
    return { n, from: r3(from), to: r3(from + Math.max(0, resolveFunctionSeriesN(item, n).animDuration)) };
  });
}

/** Which curves of a series show at `time`: replacement shows one (or a morph), accumulation all drawn so far. */
function seriesShowing(item: GraphFunctionSeriesItem, schedule: CurveWindow[], time: number): (number | string)[] {
  const begun = schedule.filter((c) => time >= c.from);
  if (!begun.length) return [];
  if (item.mode !== 'replacement') return begun.map((c) => (time < c.to ? `${c.n} (drawing)` : c.n));
  const last = begun[begun.length - 1]!;
  if (time >= last.to) return [last.n];
  return begun.length > 1 ? [`${begun[begun.length - 2]!.n}→${last.n} (morphing)`] : [`${last.n} (drawing)`];
}

/** Default times: request time, plus the start, middle and end of every draft-touched clip. */
function defaultTimes(session: DraftSession, scene: Map<ItemId, SceneItem>): number[] {
  const times = new Set<number>([r3(session.base.currentTimeSec)]);
  for (const action of session.actions) {
    const id = action.action === 'DELETE' ? null : actionItemId(action);
    const item = id == null ? undefined : scene.get(id);
    if (!item) continue;
    const start = item.startTime;
    const duration = 'duration' in item ? item.duration : 'runTime' in item ? item.runTime : 0;
    times.add(r3(start));
    times.add(r3(start + duration / 2));
    times.add(r3(start + duration));
  }
  return [...times].sort((a, b) => a - b).slice(0, 8);
}

function itemFacts(
  item: SceneItem,
  scene: Map<ItemId, SceneItem>,
  session: DraftSession,
  times: number[],
  words: readonly SpokenWord[],
) {
  const { frames, startFrameId } = session.base;
  const ctx = (time: number) => ({ items: scene, time, frames, startFrameId });
  const facts: Record<string, unknown> = { id: item.id, kind: item.kind, name: itemClipDisplayName(item) };
  if (words.length) {
    const span = 'duration' in item ? item.duration : 'runTime' in item ? item.runTime : 0;
    facts.spoken = wordsDuring(words, item.startTime, item.startTime + span);
  }
  if (CLIP_KINDS.has(item.kind)) {
    const duration = 'duration' in item ? item.duration : 0;
    facts.window = [r3(item.startTime), r3(item.startTime + duration)];
    if (item.kind === 'camera_move') {
      const cam = cameraRect(session, scene, item.startTime + item.duration);
      if (cam) {
        facts.endsAt = { center: pt({ x: (cam.left + cam.right) / 2, y: (cam.bottom + cam.top) / 2 }), width: r3(cam.right - cam.left) };
      }
    }
    return facts;
  }
  const start = effectiveStart(item, scene);
  const end = effectiveEnd(item, scene);
  facts.visible = [r3(start), Number.isFinite(end) ? r3(end) : 'end of scene'];
  if (item.kind === 'textLine') {
    if (!item.measure) facts.note = 'not measured yet: size is a placeholder';
    facts.segments = segmentFacts(item);
    const transform = transformFacts(item, scene);
    if (transform) facts.transform = transform;
    const into = morphTargets(item.id, scene);
    if (into.length) facts.turnsInto = into;
  }
  const schedule = item.kind === 'graphFunctionSeries' ? seriesSchedule(item, start) : null;
  if (schedule) facts.curves = schedule;
  if (item.kind === 'graphArea' || item.kind === 'graphField') {
    const axes = scene.get(item.axesId);
    if (item.kind === 'graphArea') {
      const area = areaFacts(item, scene);
      if (Array.isArray(area.labelAt) && axes?.kind === 'axes') {
        const [gx, gy] = area.labelAt as [number, number];
        area.labelAtWorld = pt(axesGraphToWorld(axes, gx, gy, ctx(Number.isFinite(start) ? start : 0)));
      }
      facts.area = area;
    } else {
      facts.field = fieldFacts(item, axes?.kind === 'axes' ? axes : undefined);
    }
  }
  facts.at = times.map((time) => {
    const row: Record<string, unknown> = { t: time, onScreen: time >= start && time < end };
    if (item.kind === 'textLine' && row.onScreen && isTransformSourceHiddenInPreview(item, time, scene)) {
      row.onScreen = false;
      row.note = 'morphed into the next line';
    }
    if (item.kind === 'graphFunctionSeries' && schedule) {
      row.showing = row.onScreen ? seriesShowing(item, schedule, time) : [];
      return row;
    }
    if (item.kind === 'graphDot') {
      const axes = scene.get(item.axesId);
      const motion = resolveGraphDotPosition({ dot: item, items: [...scene.values()], time });
      if (motion.error) row.error = motion.error;
      row.graph = pt(motion.point);
      if (axes?.kind === 'axes') row.world = pt(axesGraphToWorld(axes, motion.point.x, motion.point.y, ctx(time)));
      if (item.dot.showCoordinates && !motion.error) {
        row.liveLabel = buildGraphAnnotationLayout({
          dot: item.dot,
          point: { x: 0, y: 0 },
          coordinate: motion.point,
          radiusPx: 1,
          pxPerUnit: 1,
          slope: liveValueSlope(item, motion.point.x, scene),
        }).coordinateText;
      }
      return row;
    }
    if (isConnectorShape(item)) {
      const ends = resolveConnectorEndpoints(item, ctx(time));
      if (ends.error != null) row.error = ends.error;
      else {
        row.start = pt(ends.start);
        row.end = pt(ends.end);
        row.length = r3(Math.hypot(ends.end.x - ends.start.x, ends.end.y - ends.start.y));
        if (ends.slope != null) row.slope = r3(ends.slope);
      }
      return row;
    }
    if ('axesId' in item) {
      row.note = 'drawn on its axes';
      return row;
    }
    if (!('posSteps' in item)) return row;
    const center = resolvePosition(item, scene);
    const fc = frameCenterById(frames, item.frameId ?? startFrameId);
    const ta = targetAnimPreviewAccum(item.id, time, scene);
    const box = getItemBBox(item);
    const world = { x: center.x + fc.x + ta.dx, y: center.y + fc.y + ta.dy };
    const w = box.w * ta.scaleMul;
    const h = box.h * ta.scaleMul;
    row.center = pt(world);
    row.size = [r3(w), r3(h)];
    const cam = cameraRect(session, scene, time);
    if (cam && !(item.kind === 'textLine' && !item.measure)) {
      const sides = outsideSides(rectOf(world, w, h), cam);
      row.inCamera = sides.length === 0;
      if (sides.length) row.outside = sides;
    }
    return row;
  });
  return facts;
}

/**
 * Pairs of measured text lines whose boxes overlap while both are on screen, at the inspected
 * times (at most 10).
 */
function textOverlaps(scene: Map<ItemId, SceneItem>, session: DraftSession, times: number[]) {
  const { frames, startFrameId } = session.base;
  const lines = [...scene.values()].filter((it): it is TextLineItem => it.kind === 'textLine' && !!it.measure);
  const morphPair = (a: string, b: string) => morphTargets(a, scene).includes(b) || morphTargets(b, scene).includes(a);
  const out: { t: number; ids: [string, string]; overlap: [number, number] }[] = [];
  for (const time of times) {
    const boxes = lines
      .filter((line) => time >= effectiveStart(line, scene) && time < effectiveEnd(line, scene))
      .filter((line) => !isTransformSourceHiddenInPreview(line, time, scene))
      .map((line) => {
        const center = resolvePosition(line, scene);
        const fc = frameCenterById(frames, line.frameId ?? startFrameId);
        const ta = targetAnimPreviewAccum(line.id, time, scene);
        const box = getItemBBox(line);
        const world = { x: center.x + fc.x + ta.dx, y: center.y + fc.y + ta.dy };
        return { id: line.id, rect: rectOf(world, box.w * ta.scaleMul, box.h * ta.scaleMul) };
      });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (morphPair(boxes[i]!.id, boxes[j]!.id)) continue; // a line and the step it morphs into
        const a = boxes[i]!.rect;
        const b = boxes[j]!.rect;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom);
        if (w > 0.02 && h > 0.02) out.push({ t: time, ids: [boxes[i]!.id, boxes[j]!.id], overlap: [r3(w), r3(h)] });
        if (out.length >= 10) return out;
      }
    }
  }
  return out;
}

/**
 * Exact facts about the draft scene for the model: scene length, camera view, and for each item
 * its time window and resolved position at the requested times (world units; graph dots also in
 * graph coordinates; connectors as both ends). Same resolvers as the canvas and the exporter.
 */
export function inspectDraft(session: DraftSession, input: { times?: unknown; itemIds?: unknown }): Record<string, unknown> {
  const scene = session.scene();
  const { frames, startFrameId } = session.base;
  const audioItems = session.audio();
  const times = Array.isArray(input.times)
    ? input.times.filter((t): t is number => typeof t === 'number' && Number.isFinite(t)).slice(0, 8).map(r3)
    : defaultTimes(session, scene);
  const touched = session.actions.map(actionItemId).filter((id): id is ItemId => id != null);
  const requested = Array.isArray(input.itemIds)
    ? input.itemIds.filter((id): id is string => typeof id === 'string')
    : touched;
  const ids = (requested.length ? requested : [...scene.keys()]).slice(0, 30);
  const words = narrationWords(audioItems);
  const items = ids.map((id) => {
    const item = scene.get(id);
    return item ? itemFacts(item, scene, session, times, words) : { id, error: 'no such item in the draft scene' };
  });
  const sceneDurationSec = r3(computeSceneDurationSec([...scene.values()], { audioItems, frames, startFrameId: startFrameId ?? undefined }));
  const camera = startFrameId
    ? times.map((t) => {
        const pose = cameraPoseAtTime(t, scene, frames, startFrameId);
        return { t, center: pt(pose), width: r3(pose.width), height: r3((pose.width * FRAME_H) / FRAME_W) };
      })
    : [];
  return {
    sceneDurationSec,
    units: 'Manim scene units; the default camera frame is 14.22 × 8 centred on (0, 0) of the home frame',
    camera,
    items,
    textOverlaps: textOverlaps(scene, session, times),
    draftActions: session.actions.length,
  };
}
