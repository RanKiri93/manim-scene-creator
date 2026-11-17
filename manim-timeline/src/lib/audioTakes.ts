import type { AudioTake, AudioTrackItem } from '@/types/scene';
import type { AudioEditResult } from '@/lib/audioEdit';

/*
 * Takes: several recordings of one narration clip. The clip's own sound (file, words, length,
 * edit list) is the take in use; the others wait in `takes`. Swapping keeps the clip's id,
 * start, gain, fades and links, and moves later unlinked narration by the length difference.
 */

const EPS = 1e-6;

/** The clip's current sound as a take (to keep when another one is swapped in). */
export function currentTake(a: AudioTrackItem): AudioTake {
  const t: AudioTake = { id: `${a.id}~${Date.now().toString(36)}`, text: a.text, audioUrl: a.audioUrl, duration: a.duration };
  if (a.assetRelPath != null) t.assetRelPath = a.assetRelPath;
  if (a.audioProcessing != null) t.audioProcessing = a.audioProcessing;
  const words = a.boundaries ?? a.word_boundaries;
  if (words) t.boundaries = words;
  if (a.sourceIn != null) t.sourceIn = a.sourceIn;
  if (a.sourceDuration != null) t.sourceDuration = a.sourceDuration;
  if (a.pieces) t.pieces = a.pieces;
  return t;
}

/** The clip playing `take`, with the replaced sound kept as a take. */
function swapIn(a: AudioTrackItem, take: AudioTake, keepCurrent: boolean): AudioTrackItem {
  const others = (a.takes ?? []).filter((t) => t.id !== take.id);
  const next: AudioTrackItem = {
    ...a,
    text: take.text,
    audioUrl: take.audioUrl,
    duration: take.duration,
    boundaries: take.boundaries ?? [],
    takes: keepCurrent ? [...others, currentTake(a)] : others,
  };
  for (const key of ['assetRelPath', 'audioProcessing', 'sourceIn', 'sourceDuration', 'pieces'] as const) {
    if (take[key] != null) (next as unknown as Record<string, unknown>)[key] = take[key];
    else delete next[key];
  }
  delete next.word_boundaries;
  if (next.takes?.length === 0) delete next.takes;
  return next;
}

function replaceClip(
  audioItems: readonly AudioTrackItem[],
  a: AudioTrackItem,
  next: AudioTrackItem,
  isLinked: (id: string) => boolean,
): AudioEditResult {
  const shift = next.duration - a.duration;
  const oldEnd = a.startTime + a.duration;
  const out = audioItems.map((x) => {
    if (x.id === a.id) return next;
    return Math.abs(shift) > EPS && x.startTime >= oldEnd - EPS && !isLinked(x.id)
      ? { ...x, startTime: Math.max(0, x.startTime + shift) }
      : x;
  });
  return { audioItems: out, ripple: Math.abs(shift) > EPS ? { at: oldEnd, shift } : null };
}

/** Add a new recording to clip `clipId` and use it; the current sound becomes another take. */
export function addTake(
  audioItems: readonly AudioTrackItem[],
  clipId: string,
  take: AudioTake,
  isLinked: (id: string) => boolean,
): AudioEditResult | null {
  const a = audioItems.find((x) => x.id === clipId);
  if (!a || !(take.duration > 0)) return null;
  return replaceClip(audioItems, a, swapIn(a, take, true), isLinked);
}

/** Use the kept take `takeId` on clip `clipId`; the current sound is kept as a take. */
export function swapToTake(
  audioItems: readonly AudioTrackItem[],
  clipId: string,
  takeId: string,
  isLinked: (id: string) => boolean,
): AudioEditResult | null {
  const a = audioItems.find((x) => x.id === clipId);
  const take = a?.takes?.find((t) => t.id === takeId);
  if (!a || !take) return null;
  return replaceClip(audioItems, a, swapIn(a, take, true), isLinked);
}

/** Drop a kept take (the take in use cannot be removed this way). */
export function removeTake(audioItems: readonly AudioTrackItem[], clipId: string, takeId: string): AudioTrackItem[] | null {
  const a = audioItems.find((x) => x.id === clipId);
  if (!a?.takes?.some((t) => t.id === takeId)) return null;
  return audioItems.map((x) => {
    if (x.id !== clipId) return x;
    const takes = x.takes!.filter((t) => t.id !== takeId);
    const next: AudioTrackItem = { ...x, takes };
    if (takes.length === 0) delete next.takes;
    return next;
  });
}

/** A recorded clip (not on the timeline) as a take. */
export function takeFromTrack(track: AudioTrackItem): AudioTake {
  return { ...currentTake(track), id: track.id, recordedAt: new Date().toISOString() };
}
