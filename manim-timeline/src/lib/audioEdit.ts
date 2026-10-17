import { getAudioBoundaries, type AudioTrackItem, type WordBoundary } from '@/types/scene';

/*
 * Non-destructive narration edits. A clip plays `[sourceIn, sourceIn + duration)` of its file;
 * `duration` and word boundaries stay clip-local, so every timing rule that reads a clip
 * (codegen run times, binding sync, Copilot narration) keeps working on the edited piece.
 * All helpers are pure and return new clips / arrays.
 */

/** Shortest piece an edit may leave behind (seconds). */
export const MIN_CLIP_SEC = 0.05;

const EPS = 1e-6;

export function clipSourceIn(a: AudioTrackItem): number {
  return Math.max(0, a.sourceIn ?? 0);
}

/** Full file length when known, else what the clip already reaches. */
export function clipFileLength(a: AudioTrackItem): number {
  return Math.max(a.sourceDuration ?? 0, clipSourceIn(a) + a.duration);
}

/** True when the clip plays only part of its file or has gain: export must slice it. */
export function isEditedClip(a: AudioTrackItem): boolean {
  return a.sourceIn != null || a.sourceDuration != null || (a.gainDb ?? 0) !== 0;
}

/**
 * Piece `[from, to)` of a clip in clip-local seconds (may reach outside the clip into the rest of
 * the file, limited by the file). The piece starts on the timeline where that audio already was.
 * Words are kept when their midpoint falls inside, shifted and clamped to the piece.
 */
export function sliceClip(
  a: AudioTrackItem,
  from: number,
  to: number,
  id: string = a.id,
): AudioTrackItem | null {
  const srcIn = clipSourceIn(a);
  const fileLen = clipFileLength(a);
  const f = Math.max(-srcIn, from);
  const t = Math.min(fileLen - srcIn, to);
  if (t - f < MIN_CLIP_SEC - EPS) return null;
  const dur = t - f;
  const words: WordBoundary[] = [];
  for (const b of getAudioBoundaries(a)) {
    const mid = (b.start + b.end) / 2;
    if (mid < f || mid >= t) continue;
    words.push({
      word: b.word,
      start: Math.max(0, b.start - f),
      end: Math.min(dur, Math.max(b.start - f, b.end - f)),
    });
  }
  const hadWords = getAudioBoundaries(a).length > 0;
  const piece: AudioTrackItem = {
    ...a,
    id,
    startTime: Math.max(0, a.startTime + f),
    duration: dur,
    sourceIn: srcIn + f,
    sourceDuration: fileLen,
    boundaries: words,
    text: hadWords ? words.map((w) => w.word).join(' ') : a.text,
  };
  delete piece.word_boundaries;
  return piece;
}

/** Split at clip-local `at`: left keeps the id (and any binding), right gets `newId`. */
export function splitClip(
  a: AudioTrackItem,
  at: number,
  newId: string,
): [AudioTrackItem, AudioTrackItem] | null {
  if (at < MIN_CLIP_SEC - EPS || at > a.duration - MIN_CLIP_SEC + EPS) return null;
  const left = sliceClip(a, 0, at, a.id);
  const right = sliceClip(a, at, a.duration, newId);
  return left && right ? [left, right] : null;
}

/** Move the clip's start edge to timeline time `t` (into the file or back out of it). */
export function trimClipStart(a: AudioTrackItem, t: number): AudioTrackItem {
  const from = Math.min(Math.max(t, 0) - a.startTime, a.duration - MIN_CLIP_SEC);
  return sliceClip(a, from, a.duration) ?? a;
}

/** Move the clip's end edge to timeline time `t`. */
export function trimClipEnd(a: AudioTrackItem, t: number): AudioTrackItem {
  const to = Math.max(t - a.startTime, MIN_CLIP_SEC);
  return sliceClip(a, 0, to) ?? a;
}

/** Copy of clip-local `[from, to)` with `startTime` 0 (clipboard form). */
export function copyRange(a: AudioTrackItem, from: number, to: number, id: string): AudioTrackItem | null {
  const piece = sliceClip(a, Math.max(0, from), Math.min(a.duration, to), id);
  return piece ? { ...piece, startTime: 0 } : null;
}

export interface AudioEditResult {
  audioItems: AudioTrackItem[];
  /** Timeline time from which later things moved, and by how much (negative = left). */
  ripple: { at: number; shift: number } | null;
}

/**
 * Delete clip-local `[from, to)` from clip `id`: the clip is cut in two and the right part closes
 * the gap. Unlinked clips that start at or after the cut's end move left by the same amount.
 */
export function deleteClipRange(
  audioItems: readonly AudioTrackItem[],
  id: string,
  from: number,
  to: number,
  newId: string,
  isLinked: (id: string) => boolean,
): AudioEditResult | null {
  const a = audioItems.find((x) => x.id === id);
  if (!a) return null;
  const f = Math.max(0, Math.min(from, to));
  const t = Math.min(a.duration, Math.max(from, to));
  const removed = t - f;
  if (removed < MIN_CLIP_SEC - EPS) return null;
  const cutAt = a.startTime + f;
  const cutEnd = a.startTime + t;

  const left = f >= MIN_CLIP_SEC ? sliceClip(a, 0, f, a.id) : null;
  const rightRaw = a.duration - t >= MIN_CLIP_SEC ? sliceClip(a, t, a.duration, left ? newId : a.id) : null;
  const right = rightRaw ? { ...rightRaw, startTime: cutAt } : null;

  const out: AudioTrackItem[] = [];
  for (const x of audioItems) {
    if (x.id === id) {
      if (left) out.push(left);
      if (right) out.push(right);
      continue;
    }
    if (x.startTime >= cutEnd - EPS && !isLinked(x.id)) {
      out.push({ ...x, startTime: Math.max(0, x.startTime - removed) });
    } else {
      out.push(x);
    }
  }
  return { audioItems: out, ripple: { at: cutEnd, shift: -removed } };
}

export type PasteMode = 'over' | 'insert';

/**
 * Paste clipboard pieces (startTimes relative to 0) at timeline time `at`.
 * `over` lays them on the lane and leaves everything else alone. `insert` opens a gap: an
 * unlinked clip under `at` is split there, and unlinked audio from `at` on moves right.
 */
export function pasteClips(
  audioItems: readonly AudioTrackItem[],
  pieces: readonly AudioTrackItem[],
  at: number,
  mode: PasteMode,
  newId: () => string,
  isLinked: (id: string) => boolean,
): AudioEditResult {
  const placed = pieces.map((p) => ({ ...p, id: newId(), startTime: Math.max(0, at + p.startTime) }));
  if (mode === 'over' || placed.length === 0) {
    return { audioItems: [...audioItems, ...placed], ripple: null };
  }
  const span = Math.max(...pieces.map((p) => p.startTime + p.duration));
  const out: AudioTrackItem[] = [];
  for (const x of audioItems) {
    const linked = isLinked(x.id);
    const inside = x.startTime < at - EPS && x.startTime + x.duration > at + EPS;
    if (inside && !linked) {
      const parts = splitClip(x, at - x.startTime, newId());
      if (parts) {
        out.push(parts[0], { ...parts[1], startTime: parts[1].startTime + span });
        continue;
      }
    }
    out.push(x.startTime >= at - EPS && !linked ? { ...x, startTime: x.startTime + span } : x);
  }
  return { audioItems: [...out, ...placed], ripple: { at, shift: span } };
}
