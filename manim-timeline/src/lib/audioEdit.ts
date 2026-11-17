import { getAudioBoundaries, type AudioClipPiece, type AudioTrackItem, type WordBoundary } from '@/types/scene';

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

/** One played piece of a clip: clip-local start `at`, and `duration` seconds of the file from `sourceIn`. */
export interface PlayedPiece extends AudioClipPiece {
  at: number;
}

/** The pieces a clip plays back to back (one for an ordinary clip; several after deleting words inside it). */
export function clipPieces(a: AudioTrackItem): PlayedPiece[] {
  if (!a.pieces || a.pieces.length < 2) return [{ at: 0, sourceIn: clipSourceIn(a), duration: a.duration }];
  let at = 0;
  return a.pieces.map((p) => {
    const piece = { at, sourceIn: Math.max(0, p.sourceIn), duration: p.duration };
    at += p.duration;
    return piece;
  });
}

/** Full file length when known, else what the clip already reaches. */
export function clipFileLength(a: AudioTrackItem): number {
  return Math.max(a.sourceDuration ?? 0, ...clipPieces(a).map((p) => p.sourceIn + p.duration));
}

/** True when the clip plays only part of its file or has gain: export must slice it. */
export function isEditedClip(a: AudioTrackItem): boolean {
  return a.sourceIn != null || a.sourceDuration != null || (a.gainDb ?? 0) !== 0 || (a.pieces?.length ?? 0) > 1;
}

/** Pieces covering clip-local `[from, to)`; the ends may reach past the first/last piece into the file. */
function slicePieces(pieces: readonly PlayedPiece[], from: number, to: number): AudioClipPiece[] {
  const out: AudioClipPiece[] = [];
  pieces.forEach((p, i) => {
    const s = i === 0 ? from : Math.max(from, p.at);
    const e = i === pieces.length - 1 ? to : Math.min(to, p.at + p.duration);
    if (e - s <= EPS) return;
    const piece = { sourceIn: p.sourceIn + (s - p.at), duration: e - s };
    const prev = out[out.length - 1];
    // Neighbouring pieces that continue in the file are one piece.
    if (prev && Math.abs(prev.sourceIn + prev.duration - piece.sourceIn) < EPS) prev.duration += piece.duration;
    else out.push(piece);
  });
  return out;
}

/** The clip with these pieces: one piece is stored as plain `sourceIn`, several as `pieces`. */
function withPieces(a: AudioTrackItem, pieces: AudioClipPiece[]): AudioTrackItem {
  const out: AudioTrackItem = { ...a, sourceIn: pieces[0]!.sourceIn, duration: pieces.reduce((n, p) => n + p.duration, 0) };
  if (pieces.length > 1) out.pieces = pieces.map((p) => ({ sourceIn: p.sourceIn, duration: p.duration }));
  else delete out.pieces;
  return out;
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
  const played = clipPieces(a);
  const first = played[0]!;
  const last = played[played.length - 1]!;
  const fileLen = clipFileLength(a);
  const f = Math.max(-first.sourceIn, from);
  const t = Math.min(a.duration + fileLen - (last.sourceIn + last.duration), to);
  if (t - f < MIN_CLIP_SEC - EPS) return null;
  const dur = t - f;
  const words: WordBoundary[] = [];
  for (const b of getAudioBoundaries(a)) {
    const mid = (b.start + b.end) / 2;
    if (mid < f || mid >= t) continue;
    words.push({
      ...b,
      start: Math.max(0, b.start - f),
      end: Math.min(dur, Math.max(b.start - f, b.end - f)),
    });
  }
  const hadWords = getAudioBoundaries(a).length > 0;
  const piece: AudioTrackItem = {
    ...withPieces(a, slicePieces(played, f, t)),
    id,
    startTime: Math.max(0, a.startTime + f),
    duration: dur,
    sourceDuration: fileLen,
    boundaries: words,
    text: hadWords ? words.map((w) => w.word).join(' ') : a.text,
  };
  delete piece.word_boundaries;
  return piece;
}

/** `right` played straight after `left` as one clip (left's id, start and settings). */
function joinClips(left: AudioTrackItem, right: AudioTrackItem): AudioTrackItem {
  const pieces = [...clipPieces(left), ...clipPieces(right)].map(({ sourceIn, duration }) => ({ sourceIn, duration }));
  const words = [
    ...getAudioBoundaries(left),
    ...getAudioBoundaries(right).map((w) => ({ ...w, start: w.start + left.duration, end: w.end + left.duration })),
  ];
  const hadWords = words.length > 0;
  const out: AudioTrackItem = {
    ...withPieces(left, slicePieces(pieces.map((p, i) => ({ ...p, at: pieces.slice(0, i).reduce((n, q) => n + q.duration, 0) })), 0, left.duration + right.duration)),
    boundaries: words,
    text: hadWords ? words.map((w) => w.word).join(' ') : left.text,
  };
  delete out.word_boundaries;
  return out;
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
 * Delete clip-local `[from, to)` from clip `id`: the rest closes the gap and stays one clip (an
 * edit list of pieces), keeping its id, binding and word ids. Unlinked clips that start at or
 * after the cut's end move left by the same amount.
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
  const kept = left && right ? joinClips(left, right) : left ?? right;

  const out: AudioTrackItem[] = [];
  for (const x of audioItems) {
    if (x.id === id) {
      if (kept) out.push(kept);
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
  // A pasted copy is new speech: its words must not share ids (anchors) with the original.
  const placed = pieces.map((p) => ({
    ...p,
    id: newId(),
    startTime: Math.max(0, at + p.startTime),
    boundaries: p.boundaries?.map((w) => ({ word: w.word, start: w.start, end: w.end })),
  }));
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

/**
 * Clip-local range that removes words `first..last` (indices into the clip's words): each cut
 * sits in the middle of the pause next to the words (or at the clip edge), so what remains keeps
 * half of each pause and the join lands in silence.
 */
export function wordRangeCut(a: AudioTrackItem, first: number, last: number): { from: number; to: number } | null {
  const words = getAudioBoundaries(a);
  const i = Math.max(0, Math.min(first, last));
  const j = Math.min(words.length - 1, Math.max(first, last));
  if (words.length === 0 || i > j) return null;
  const prev = words[i - 1];
  const next = words[j + 1];
  const from = prev ? (prev.end + words[i]!.start) / 2 : 0;
  const to = next ? (words[j]!.end + next.start) / 2 : a.duration;
  return to - from > 0 ? { from: Math.max(0, from), to: Math.min(a.duration, to) } : null;
}

/**
 * Punch-in: replace clip-local `[from, to)` of clip `id` with a new recording `take`. What came
 * before keeps the clip's id; the take follows (`take.id`); what came after continues right after
 * it (`rightId`). Unlinked audio after the replaced part moves by the length difference.
 */
export function punchInClip(
  audioItems: readonly AudioTrackItem[],
  id: string,
  from: number,
  to: number,
  take: AudioTrackItem,
  rightId: string,
  isLinked: (id: string) => boolean,
): AudioEditResult | null {
  const a = audioItems.find((x) => x.id === id);
  if (!a || !(take.duration > 0)) return null;
  const f = Math.max(0, Math.min(from, to));
  const t = Math.min(a.duration, Math.max(from, to));
  if (t - f < MIN_CLIP_SEC - EPS) return null;
  const at = a.startTime + f;
  const shift = take.duration - (t - f);
  const left = f >= MIN_CLIP_SEC ? sliceClip(a, 0, f, a.id) : null;
  const rightRaw = a.duration - t >= MIN_CLIP_SEC ? sliceClip(a, t, a.duration, left ? rightId : a.id) : null;
  const right = rightRaw ? { ...rightRaw, startTime: at + take.duration } : null;
  // The take continues the clip's sound: same gain and cut fades.
  const placed: AudioTrackItem = {
    ...take,
    startTime: at,
    ...(a.gainDb != null ? { gainDb: a.gainDb } : {}),
    ...(a.fadeInMs != null ? { fadeInMs: a.fadeInMs } : {}),
    ...(a.fadeOutMs != null ? { fadeOutMs: a.fadeOutMs } : {}),
  };
  const cutEnd = a.startTime + t;
  const out: AudioTrackItem[] = [];
  for (const x of audioItems) {
    if (x.id === id) {
      if (left) out.push(left);
      out.push(placed);
      if (right) out.push(right);
      continue;
    }
    out.push(x.startTime >= cutEnd - EPS && !isLinked(x.id) ? { ...x, startTime: Math.max(0, x.startTime + shift) } : x);
  }
  return { audioItems: out, ripple: Math.abs(shift) > EPS ? { at: cutEnd, shift } : null };
}

/** Transcription language for a re-recorded part: Hebrew when the clip's text has Hebrew letters. */
export function clipLanguage(a: AudioTrackItem): 'iw' | 'en' {
  return /[\u0590-\u05FF]/.test(a.text) ? 'iw' : 'en';
}
