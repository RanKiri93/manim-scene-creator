import type { ItemId, SceneItem } from '@/types/scene';
import { FRAME_H, FRAME_W } from '@/lib/constants';
import { cameraPoseAtTime } from '@/lib/camera';
import { frameCenterById } from '@/lib/frameGrid';
import { resolveGraphDotPosition } from '@/lib/graphMotion';
import { getItemBBox, resolvePosition } from '@/lib/resolvePosition';
import { axesGraphToWorld, isConnectorShape, resolveConnectorEndpoints } from '@/lib/shapeAnchors';
import { effectiveEnd, effectiveStart } from '@/lib/time';
import { targetAnimPreviewAccum } from '@/lib/visualPlaybackPreview';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { computeSceneDurationSec } from '@/codegen/manimExporter';
import type { DraftSession } from './draft';

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pt = (p: { x: number; y: number }) => [r3(p.x), r3(p.y)];

const CLIP_KINDS = new Set(['exit_animation', 'blink_animation', 'target_animation', 'camera_move']);

/** Default times: request time, plus the start, middle and end of every draft-touched clip. */
function defaultTimes(session: DraftSession, scene: Map<ItemId, SceneItem>): number[] {
  const times = new Set<number>([r3(session.base.currentTimeSec)]);
  for (const action of session.actions) {
    if (action.action === 'DELETE') continue;
    const item = scene.get(action.action === 'CREATE' ? action.item.id : action.itemId);
    if (!item) continue;
    const start = item.startTime;
    const duration = 'duration' in item ? item.duration : 'runTime' in item ? item.runTime : 0;
    times.add(r3(start));
    times.add(r3(start + duration / 2));
    times.add(r3(start + duration));
  }
  return [...times].sort((a, b) => a - b).slice(0, 8);
}

function itemFacts(item: SceneItem, scene: Map<ItemId, SceneItem>, session: DraftSession, times: number[]) {
  const { frames, startFrameId } = session.base;
  const ctx = (time: number) => ({ items: scene, time, frames, startFrameId });
  const facts: Record<string, unknown> = { id: item.id, kind: item.kind, name: itemClipDisplayName(item) };
  if (CLIP_KINDS.has(item.kind)) {
    const duration = 'duration' in item ? item.duration : 0;
    facts.window = [r3(item.startTime), r3(item.startTime + duration)];
    return facts;
  }
  const start = effectiveStart(item, scene);
  const end = effectiveEnd(item, scene);
  facts.visible = [r3(start), Number.isFinite(end) ? r3(end) : 'end of scene'];
  if (item.kind === 'textLine' && !item.measure) facts.note = 'not measured yet: size is a placeholder';
  facts.at = times.map((time) => {
    const row: Record<string, unknown> = { t: time, onScreen: time >= start && time < end };
    if (item.kind === 'graphDot') {
      const axes = scene.get(item.axesId);
      const motion = resolveGraphDotPosition({ dot: item, items: [...scene.values()], time });
      if (motion.error) row.error = motion.error;
      row.graph = pt(motion.point);
      if (axes?.kind === 'axes') row.world = pt(axesGraphToWorld(axes, motion.point.x, motion.point.y, ctx(time)));
      return row;
    }
    if (isConnectorShape(item)) {
      const ends = resolveConnectorEndpoints(item, ctx(time));
      if (ends.error != null) row.error = ends.error;
      else {
        row.start = pt(ends.start);
        row.end = pt(ends.end);
        row.length = r3(Math.hypot(ends.end.x - ends.start.x, ends.end.y - ends.start.y));
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
    row.center = pt({ x: center.x + fc.x + ta.dx, y: center.y + fc.y + ta.dy });
    row.size = [r3(box.w * ta.scaleMul), r3(box.h * ta.scaleMul)];
    return row;
  });
  return facts;
}

/**
 * Exact facts about the draft scene for the model: scene length, camera view, and for each item
 * its time window and resolved position at the requested times (world units; graph dots also in
 * graph coordinates; connectors as both ends). Same resolvers as the canvas and the exporter.
 */
export function inspectDraft(session: DraftSession, input: { times?: unknown; itemIds?: unknown }): Record<string, unknown> {
  const scene = session.scene();
  const { frames, startFrameId, audioItems } = session.base;
  const times = Array.isArray(input.times)
    ? input.times.filter((t): t is number => typeof t === 'number' && Number.isFinite(t)).slice(0, 8).map(r3)
    : defaultTimes(session, scene);
  const touched = session.actions.map((a) => (a.action === 'CREATE' ? a.item.id : a.itemId));
  const requested = Array.isArray(input.itemIds)
    ? input.itemIds.filter((id): id is string => typeof id === 'string')
    : touched;
  const ids = (requested.length ? requested : [...scene.keys()]).slice(0, 30);
  const items = ids.map((id) => {
    const item = scene.get(id);
    return item ? itemFacts(item, scene, session, times) : { id, error: 'no such item in the draft scene' };
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
    draftActions: session.actions.length,
  };
}
