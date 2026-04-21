import { newId } from '@/lib/ids';
import { PROJECT_VERSION } from '@/lib/constants';
import {
  PROJECT_FRAGMENT_KIND,
  type AudioTrackItem,
  type GraphAreaItem,
  type ItemId,
  type PosStep,
  type ProjectFragmentFile,
  type SceneItem,
} from '@/types/scene';
import { isTopLevelItem } from '@/lib/time';

function collectGraphAreaPlotDeps(mode: GraphAreaItem['mode']): ItemId[] {
  const out: ItemId[] = [];
  if (mode.areaKind === 'underCurve') {
    if (mode.curve.sourceKind === 'plot') out.push(mode.curve.plotId);
  } else if (mode.areaKind === 'betweenCurves') {
    if (mode.lower.sourceKind === 'plot') out.push(mode.lower.plotId);
    if (mode.upper.sourceKind === 'plot') out.push(mode.upper.plotId);
  }
  return out;
}

/** Direct scene-item dependencies (other item ids) required for this item to be valid. */
export function getDirectItemDeps(item: SceneItem): ItemId[] {
  const deps: ItemId[] = [];
  switch (item.kind) {
    case 'graphPlot':
    case 'graphDot':
    case 'graphField':
    case 'graphFunctionSeries':
    case 'graphArea':
      deps.push(item.axesId);
      if (item.kind === 'graphArea') {
        deps.push(...collectGraphAreaPlotDeps(item.mode));
      }
      break;
    case 'exit_animation':
      for (const t of item.targets) deps.push(t.targetId);
      break;
    case 'surroundingRect':
      deps.push(...item.targetIds);
      break;
    case 'textLine':
      if (item.transformConfig?.sourceLineId) {
        deps.push(item.transformConfig.sourceLineId);
      }
      break;
    default:
      break;
  }

  if ('posSteps' in item) {
    for (const step of item.posSteps) {
      if (step.kind === 'next_to' && step.refId) {
        deps.push(step.refId);
      }
    }
  }
  return deps;
}

export type ExpandFragmentResult =
  | {
      ok: true;
      itemIds: ItemId[];
      items: SceneItem[];
      audioItems: AudioTrackItem[];
    }
  | { ok: false; message: string };

/**
 * Expand selected ids to a closed set (dependencies), ordered for export like the timeline list.
 */
export function expandFragmentSelection(
  items: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[],
  selectedIds: Set<ItemId>,
): ExpandFragmentResult {
  const seeds = [...selectedIds].filter((id) => items.has(id));
  if (selectedIds.size > 0 && seeds.length === 0) {
    return {
      ok: false,
      message: 'Selection does not match any scene objects.',
    };
  }
  if (seeds.length === 0) {
    return { ok: false, message: 'Select one or more objects to export.' };
  }

  const closed = new Set<ItemId>();
  const queue: ItemId[] = [];

  for (const id of seeds) {
    if (!closed.has(id)) {
      closed.add(id);
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const id = queue.pop()!;
    const item = items.get(id);
    if (!item) {
      return { ok: false, message: `Missing item "${id}" in scene.` };
    }
    for (const dep of getDirectItemDeps(item)) {
      if (!items.has(dep)) {
        return {
          ok: false,
          message: `"${item.label || item.id}" references missing object "${dep}".`,
        };
      }
      if (!closed.has(dep)) {
        closed.add(dep);
        queue.push(dep);
      }
    }
  }

  const audioNeeded = new Set<string>();
  for (const id of closed) {
    const it = items.get(id)!;
    if ('audioTrackId' in it && it.audioTrackId) {
      audioNeeded.add(it.audioTrackId);
    }
  }

  const audioById = new Map(audioItems.map((a) => [a.id, a] as const));
  for (const aid of audioNeeded) {
    if (!audioById.has(aid)) {
      return {
        ok: false,
        message: `A clip references audio track "${aid}" which is not in this project.`,
      };
    }
  }

  const orderedIds = [...closed].sort((a, b) => {
    const ia = items.get(a)!;
    const ib = items.get(b)!;
    return ia.startTime - ib.startTime || ia.layer - ib.layer;
  });

  const outItems = orderedIds.map((id) =>
    structuredClone(items.get(id)!) as SceneItem,
  );
  const outAudio = [...audioNeeded]
    .sort((a, b) => {
      const ta = audioById.get(a)!;
      const tb = audioById.get(b)!;
      return ta.startTime - tb.startTime;
    })
    .map((id) => structuredClone(audioById.get(id)!) as AudioTrackItem);

  return { ok: true, itemIds: orderedIds, items: outItems, audioItems: outAudio };
}

/** Ids used in codegen / cross-refs for collision checks and remapping. */
export function collectCodegenIdsFromItems(items: SceneItem[]): Set<string> {
  const s = new Set<string>();
  for (const it of items) {
    s.add(it.id);
    if (it.kind === 'graphPlot') s.add(it.fn.id);
    if (it.kind === 'graphDot') s.add(it.dot.id);
    if (it.kind === 'graphField') {
      for (const p of it.streamPoints) s.add(p.id);
    }
    if (it.kind === 'graphArea') {
      const mode = it.mode;
      if (mode.areaKind === 'underCurve' && mode.curve.sourceKind === 'plot') {
        s.add(mode.curve.plotId);
      }
      if (mode.areaKind === 'betweenCurves') {
        if (mode.lower.sourceKind === 'plot') s.add(mode.lower.plotId);
        if (mode.upper.sourceKind === 'plot') s.add(mode.upper.plotId);
      }
    }
  }
  return s;
}

function allocFreshId(used: Set<string>): string {
  let id: string;
  do {
    id = newId();
  } while (used.has(id));
  used.add(id);
  return id;
}

function buildRemapMap(
  fragmentItems: SceneItem[],
  fragmentAudio: AudioTrackItem[],
  reservedIds: Set<string>,
): Map<string, string> {
  const used = new Set(reservedIds);
  const oldIds = new Set<string>();
  for (const id of collectCodegenIdsFromItems(fragmentItems)) oldIds.add(id);
  for (const a of fragmentAudio) oldIds.add(a.id);

  const map = new Map<string, string>();
  for (const old of oldIds) {
    map.set(old, allocFreshId(used));
  }
  return map;
}

function remapPosSteps(steps: PosStep[], m: Map<string, string>): PosStep[] {
  return steps.map((step) => {
    if (step.kind !== 'next_to' || !step.refId) return step;
    const nextId = m.get(step.refId);
    if (nextId == null) return step;
    return { ...step, refId: nextId };
  });
}

function remapGraphAreaMode(
  mode: GraphAreaItem['mode'],
  m: Map<string, string>,
): GraphAreaItem['mode'] {
  if (mode.areaKind === 'underCurve') {
    const c = mode.curve;
    if (c.sourceKind !== 'plot') return mode;
    const plotId = m.get(c.plotId) ?? c.plotId;
    return {
      ...mode,
      curve: { ...c, plotId },
    };
  }
  if (mode.areaKind === 'betweenCurves') {
    const lower =
      mode.lower.sourceKind === 'plot'
        ? { ...mode.lower, plotId: m.get(mode.lower.plotId) ?? mode.lower.plotId }
        : mode.lower;
    const upper =
      mode.upper.sourceKind === 'plot'
        ? { ...mode.upper, plotId: m.get(mode.upper.plotId) ?? mode.upper.plotId }
        : mode.upper;
    return { ...mode, lower, upper };
  }
  return mode;
}

export function remapSceneItem(it: SceneItem, m: Map<string, string>): void {
  const newTop = m.get(it.id);
  if (newTop) (it as { id: string }).id = newTop;

  switch (it.kind) {
    case 'textLine': {
      it.posSteps = remapPosSteps(it.posSteps, m);
      if (it.transformConfig?.sourceLineId) {
        const sid = m.get(it.transformConfig.sourceLineId);
        if (sid) it.transformConfig = { ...it.transformConfig, sourceLineId: sid };
      }
      if (it.audioTrackId) {
        const aid = m.get(it.audioTrackId);
        if (aid) it.audioTrackId = aid;
      }
      break;
    }
    case 'axes':
    case 'shape':
      it.posSteps = remapPosSteps(it.posSteps, m);
      if (it.audioTrackId) {
        const aid = m.get(it.audioTrackId);
        if (aid) it.audioTrackId = aid;
      }
      break;
    case 'graphPlot':
      it.axesId = m.get(it.axesId) ?? it.axesId;
      it.posSteps = remapPosSteps(it.posSteps, m);
      it.fn = { ...it.fn, id: m.get(it.fn.id) ?? it.fn.id };
      if (it.audioTrackId) {
        const aid = m.get(it.audioTrackId);
        if (aid) it.audioTrackId = aid;
      }
      break;
    case 'graphDot':
      it.axesId = m.get(it.axesId) ?? it.axesId;
      it.posSteps = remapPosSteps(it.posSteps, m);
      it.dot = { ...it.dot, id: m.get(it.dot.id) ?? it.dot.id };
      if (it.audioTrackId) {
        const aid = m.get(it.audioTrackId);
        if (aid) it.audioTrackId = aid;
      }
      break;
    case 'graphField':
      it.axesId = m.get(it.axesId) ?? it.axesId;
      it.posSteps = remapPosSteps(it.posSteps, m);
      it.streamPoints = it.streamPoints.map((p) => ({
        ...p,
        id: m.get(p.id) ?? p.id,
      }));
      if (it.audioTrackId) {
        const aid = m.get(it.audioTrackId);
        if (aid) it.audioTrackId = aid;
      }
      break;
    case 'graphFunctionSeries':
      it.axesId = m.get(it.axesId) ?? it.axesId;
      it.posSteps = remapPosSteps(it.posSteps, m);
      if (it.audioTrackId) {
        const aid = m.get(it.audioTrackId);
        if (aid) it.audioTrackId = aid;
      }
      break;
    case 'graphArea':
      it.axesId = m.get(it.axesId) ?? it.axesId;
      it.posSteps = remapPosSteps(it.posSteps, m);
      it.mode = remapGraphAreaMode(it.mode, m);
      if (it.audioTrackId) {
        const aid = m.get(it.audioTrackId);
        if (aid) it.audioTrackId = aid;
      }
      break;
    case 'exit_animation':
      it.targets = it.targets.map((t) => ({
        ...t,
        targetId: m.get(t.targetId) ?? t.targetId,
      }));
      break;
    case 'surroundingRect':
      it.targetIds = it.targetIds.map((tid) => m.get(tid) ?? tid);
      break;
    default:
      break;
  }
}

export function remapFragmentItemsInPlace(
  items: SceneItem[],
  audioItems: AudioTrackItem[],
  reservedIds: Set<string>,
): Map<string, string> {
  const m = buildRemapMap(items, audioItems, reservedIds);
  for (const it of items) remapSceneItem(it, m);
  for (const a of audioItems) {
    const nid = m.get(a.id);
    if (nid) a.id = nid;
  }
  return m;
}

export function stripHeavyTextLinePayload(items: SceneItem[]): void {
  for (const it of items) {
    if (it.kind === 'textLine') {
      it.measure = null;
      it.previewDataUrl = null;
      it.segmentMeasures = null;
    }
  }
}

/** Remove per-segment timing overrides so pasted lines use default pacing (equal anim share, no waits). */
export function stripTextLineSegmentTiming(items: SceneItem[]): void {
  for (const it of items) {
    if (it.kind !== 'textLine') continue;
    for (const seg of it.segments) {
      delete seg.waitAfterSec;
      delete seg.animSec;
    }
  }
}

export type FragmentTimeMode = 'preserve' | 'playhead' | 'appendEnd';

function fragmentTimelineMinStart(items: SceneItem[]): number {
  let min = Infinity;
  for (const it of items) {
    if (!isTopLevelItem(it)) continue;
    min = Math.min(min, it.startTime);
  }
  return Number.isFinite(min) ? min : 0;
}

function fragmentAudioMinStart(audio: AudioTrackItem[]): number {
  if (audio.length === 0) return Infinity;
  return Math.min(...audio.map((a) => a.startTime));
}

/** Earliest start among scene clips and bundled audio (for a common shift). */
export function fragmentEarliestStart(
  items: SceneItem[],
  audio: AudioTrackItem[],
): number {
  const clipMin = fragmentTimelineMinStart(items);
  const audioMin = fragmentAudioMinStart(audio);
  const m = Math.min(
    Number.isFinite(clipMin) ? clipMin : Infinity,
    audioMin,
  );
  return Number.isFinite(m) ? m : 0;
}

export function applyTimeShiftToFragment(
  items: SceneItem[],
  audio: AudioTrackItem[],
  delta: number,
): void {
  if (delta === 0) return;
  for (const it of items) {
    if ('startTime' in it) {
      (it as { startTime: number }).startTime = Math.max(0, it.startTime + delta);
    }
  }
  for (const a of audio) {
    a.startTime = Math.max(0, a.startTime + delta);
  }
}

export function buildProjectFragmentFile(
  items: SceneItem[],
  audioItems: AudioTrackItem[],
  compact: boolean,
  stripSegmentTiming = false,
): ProjectFragmentFile {
  const clonedItems = structuredClone(items) as SceneItem[];
  const clonedAudio =
    audioItems.length > 0
      ? (structuredClone(audioItems) as AudioTrackItem[])
      : undefined;
  if (compact) stripHeavyTextLinePayload(clonedItems);
  if (stripSegmentTiming) stripTextLineSegmentTiming(clonedItems);
  return {
    kind: PROJECT_FRAGMENT_KIND,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    items: clonedItems,
    audioItems: clonedAudio,
  };
}

/** Reserved = codegen ids already used in the destination project. */
export function collectReservedIdsFromMap(items: Map<ItemId, SceneItem>): Set<string> {
  return collectCodegenIdsFromItems([...items.values()]);
}
