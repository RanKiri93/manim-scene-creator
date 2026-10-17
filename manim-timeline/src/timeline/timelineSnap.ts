import { create } from 'zustand';
import { getAudioBoundaries, type AudioTrackItem, type ItemId, type SceneItem } from '@/types/scene';
import { isTopLevelItem, runDuration } from '@/lib/time';

/*
 * Timeline drag snapping. A dragged clip's edges snap to spoken words (start and end), the
 * playhead, and other clips' edges when within `SNAP_PX` on screen; Alt turns snapping off.
 * While a snap is active `useSnapGuide` holds the target so the timeline can draw a guide line.
 */

/** Snap distance in screen pixels (so it feels the same at every zoom). */
export const SNAP_PX = 8;

export interface SnapTarget {
  t: number;
  label: string;
  /** Set for a word start: a clip whose start lands here can anchor to the word. */
  word?: { trackId: string; wordIndex: number };
}

export interface SnapResult {
  /** Add to every dragged edge. */
  delta: number;
  target: SnapTarget;
  /** Index into the `edges` passed to `snapEdges`. */
  edgeIndex: number;
}

export function collectSnapTargets(opts: {
  audioItems: readonly AudioTrackItem[];
  items: Iterable<SceneItem>;
  itemsMap: Map<ItemId, SceneItem>;
  playhead: number;
  excludeAudioIds?: ReadonlySet<string>;
  excludeItemIds?: ReadonlySet<string>;
}): SnapTarget[] {
  const out: SnapTarget[] = [{ t: opts.playhead, label: 'playhead' }];
  for (const a of opts.audioItems) {
    if (opts.excludeAudioIds?.has(a.id)) continue;
    getAudioBoundaries(a).forEach((b, i) => {
      if (!b.word?.trim()) return;
      out.push({ t: a.startTime + b.start, label: b.word, word: { trackId: a.id, wordIndex: i } });
      out.push({ t: a.startTime + b.end, label: `${b.word} (end)` });
    });
    out.push({ t: a.startTime, label: 'narration start' });
    out.push({ t: a.startTime + a.duration, label: 'narration end' });
  }
  for (const it of opts.items) {
    if (!isTopLevelItem(it) || opts.excludeItemIds?.has(it.id)) continue;
    out.push({ t: it.startTime, label: `${it.label || it.kind} start` });
    out.push({ t: it.startTime + runDuration(it, opts.itemsMap), label: `${it.label || it.kind} end` });
  }
  return out;
}

/**
 * Closest (edge, target) pair within `thresholdSec`. Word starts win ties so a clip prefers to
 * start on a word.
 */
export function snapEdges(
  edges: readonly number[],
  targets: readonly SnapTarget[],
  thresholdSec: number,
): SnapResult | null {
  let best: SnapResult | null = null;
  let bestD = Infinity;
  const anchorsWord = (r: SnapResult) => Boolean(r.target.word) && r.edgeIndex === 0;
  edges.forEach((e, edgeIndex) => {
    for (const target of targets) {
      const d = Math.abs(target.t - e);
      if (d > thresholdSec) continue;
      const cand = { delta: target.t - e, target, edgeIndex };
      const tie = Math.abs(d - bestD) < 1e-6;
      if (d < bestD - 1e-6 || (tie && best && anchorsWord(cand) && !anchorsWord(best))) {
        bestD = d;
        best = cand;
      }
    }
  });
  return best;
}

export const useSnapGuide = create<{ guide: SnapTarget | null }>(() => ({ guide: null }));

export function showSnapGuide(target: SnapTarget | null) {
  if (useSnapGuide.getState().guide !== target) useSnapGuide.setState({ guide: target });
}
