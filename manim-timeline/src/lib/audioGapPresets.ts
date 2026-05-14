import type { AudioTrackItem } from '@/types/scene';

/** Seconds — comparison tolerance for timeline alignment. */
const TIME_EPS = 1e-6;

export type AudioGapPresetId = 'tight' | 'normal' | 'newIdea' | 'reveal';

export interface AudioGapPreset {
  id: AudioGapPresetId;
  label: string;
  /** Short label for cramped timeline UI */
  shortLabel: string;
  seconds: number;
}

export const AUDIO_GAP_PRESETS: readonly AudioGapPreset[] = [
  { id: 'tight', label: 'Tight', shortLabel: 'T', seconds: 0.35 },
  { id: 'normal', label: 'Normal', shortLabel: 'N', seconds: 0.65 },
  { id: 'newIdea', label: 'New idea', shortLabel: 'I', seconds: 1.1 },
  { id: 'reveal', label: 'Reveal', shortLabel: 'R', seconds: 1.6 },
] as const;

export function presetById(id: AudioGapPresetId): AudioGapPreset | undefined {
  return AUDIO_GAP_PRESETS.find((p) => p.id === id);
}

/**
 * Audio track that ends last among those strictly before `selected.startTime` (excluding self).
 * Includes linked clips as valid anchors.
 */
export function findPreviousAudioEndingBefore(
  audioItems: readonly AudioTrackItem[],
  selectedId: string,
): AudioTrackItem | undefined {
  const sel = audioItems.find((a) => a.id === selectedId);
  if (!sel) return undefined;

  let best: AudioTrackItem | undefined;
  let bestEnd = -Infinity;

  for (const a of audioItems) {
    if (a.id === selectedId) continue;
    const end = a.startTime + a.duration;
    if (end <= sel.startTime + TIME_EPS && end > bestEnd) {
      bestEnd = end;
      best = a;
    }
  }
  return best;
}

/**
 * Start time so `selected` sits `gapSec` after the end of the previous track, or null if none.
 */
export function computeStartAfterPrevious(
  audioItems: readonly AudioTrackItem[],
  selectedId: string,
  gapSec: number,
): number | null {
  const prev = findPreviousAudioEndingBefore(audioItems, selectedId);
  if (!prev) return null;
  const g = Math.max(0, gapSec);
  return Math.max(0, prev.startTime + prev.duration + g);
}

export interface AudioStartUpdate {
  id: string;
  startTime: number;
}

/**
 * Chain unlinked selected clips in timeline order: first keeps its start; each next starts
 * `gapSec` after the previous clip ends (using current start/duration for ordering and durations).
 */
export function computeChainedStartsForSortedUnlinked(
  sortedByTime: readonly AudioTrackItem[],
  gapSec: number,
): AudioStartUpdate[] {
  if (sortedByTime.length < 2) return [];
  const g = Math.max(0, gapSec);
  const out: AudioStartUpdate[] = [];
  let end = sortedByTime[0]!.startTime + sortedByTime[0]!.duration;
  for (let i = 1; i < sortedByTime.length; i++) {
    const t = sortedByTime[i]!;
    const nextStart = end + g;
    out.push({ id: t.id, startTime: Math.max(0, nextStart) });
    end = nextStart + t.duration;
  }
  return out;
}
