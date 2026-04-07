import { getAudioBoundaries, type AudioTrackItem } from '@/types/scene';

export const SNAP_THRESHOLD = 0.15;

/** Absolute timeline times of word-boundary starts; optionally skip one track (e.g. while dragging it). */
export function collectAudioBoundaryTimes(
  audioItems: AudioTrackItem[],
  excludeTrackId?: string,
): number[] {
  const out: number[] = [];
  for (const a of audioItems) {
    if (excludeTrackId && a.id === excludeTrackId) continue;
    for (const b of getAudioBoundaries(a)) {
      out.push(a.startTime + b.start);
    }
  }
  return out;
}

export function snapToNearestBoundary(t: number, boundaries: number[]): number {
  if (boundaries.length === 0) return t;
  let closest = boundaries[0];
  let best = Math.abs(t - closest);
  for (let i = 1; i < boundaries.length; i++) {
    const d = Math.abs(t - boundaries[i]);
    if (d < best) {
      best = d;
      closest = boundaries[i];
    }
  }
  return best < SNAP_THRESHOLD ? closest : t;
}
