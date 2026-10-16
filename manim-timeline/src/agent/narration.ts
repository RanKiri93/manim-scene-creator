import { getAudioBoundaries, type AudioTrackItem } from '@/types/scene';

/*
 * Narration for the Copilot: the spoken words of the scene's audio tracks with their scene times
 * (track start + word start), a word search that copes with Hebrew prefixes, and the words spoken
 * during a time window.
 */

export interface SpokenWord {
  trackId: string;
  word: string;
  /** Scene seconds. */
  start: number;
  end: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Every spoken word in scene time, in order. */
export function narrationWords(audioItems: readonly AudioTrackItem[]): SpokenWord[] {
  const out: SpokenWord[] = [];
  for (const track of audioItems) {
    for (const b of getAudioBoundaries(track)) {
      if (!b.word?.trim()) continue;
      out.push({ trackId: track.id, word: b.word.trim(), start: track.startTime + b.start, end: track.startTime + b.end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Lower case, no niqqud / cantillation, no punctuation or quotes. */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Hebrew one-letter prefixes (ו, ה, ב, כ, ל, מ, ש) that attach to the next word. */
const HEBREW_PREFIX = /^[והבכלמש]{1,3}$/;

/** How `spoken` matches `wanted`: exactly, with a Hebrew prefix (בנקודה ~ נקודה), or not. */
function wordMatch(spoken: string, wanted: string): 'exact' | 'prefix' | null {
  if (!spoken || !wanted) return null;
  if (spoken === wanted) return 'exact';
  if (spoken.length > wanted.length && spoken.endsWith(wanted) && HEBREW_PREFIX.test(spoken.slice(0, spoken.length - wanted.length))) {
    return 'prefix';
  }
  if (wanted.length > spoken.length && wanted.endsWith(spoken) && HEBREW_PREFIX.test(wanted.slice(0, wanted.length - spoken.length))) {
    return 'prefix';
  }
  return null;
}

export interface WordMatch {
  /** The words as spoken. */
  spoken: string;
  trackId: string;
  start: number;
  end: number;
  /** "exact", or "prefix" when a Hebrew prefix differs (בנקודה for נקודה). */
  match: 'exact' | 'prefix';
  /** A few words around it, to tell repeated words apart. */
  context: string;
}

/** Up to `limit` places where the words of `text` are spoken in a row. */
export function findWords(audioItems: readonly AudioTrackItem[], text: string, limit = 10): WordMatch[] {
  const wanted = text.split(/\s+/).map(normalizeWord).filter(Boolean);
  if (!wanted.length) return [];
  const words = narrationWords(audioItems);
  const norm = words.map((w) => normalizeWord(w.word));
  const out: WordMatch[] = [];
  for (let i = 0; i + wanted.length <= words.length && out.length < limit; i++) {
    let kind: 'exact' | 'prefix' = 'exact';
    let ok = true;
    for (let k = 0; k < wanted.length; k++) {
      const w = words[i + k]!;
      if (w.trackId !== words[i]!.trackId) {
        ok = false;
        break;
      }
      const m = wordMatch(norm[i + k]!, wanted[k]!);
      if (!m) {
        ok = false;
        break;
      }
      if (m === 'prefix') kind = 'prefix';
    }
    if (!ok) continue;
    const last = words[i + wanted.length - 1]!;
    const around = words.slice(Math.max(0, i - 3), i + wanted.length + 3).filter((w) => w.trackId === words[i]!.trackId);
    out.push({
      spoken: words.slice(i, i + wanted.length).map((w) => w.word).join(' '),
      trackId: words[i]!.trackId,
      start: r2(words[i]!.start),
      end: r2(last.end),
      match: kind,
      context: around.map((w) => w.word).join(' '),
    });
  }
  return out;
}

/** The words spoken (at least half) inside [from, to], joined; '' when none. */
export function wordsDuring(words: readonly SpokenWord[], from: number, to: number): string {
  return words
    .filter((w) => Math.min(w.end, to) - Math.max(w.start, from) >= (w.end - w.start) / 2)
    .map((w) => w.word)
    .join(' ');
}

/** Most words sent with every request (longer narration is cut and marked). */
export const NARRATION_WORD_CAP = 600;

/**
 * Narration summary for the request payload: each track's text, time window and its words as
 * [word, scene start] pairs.
 */
export function narrationPayload(audioItems: readonly AudioTrackItem[]) {
  let budget = NARRATION_WORD_CAP;
  return audioItems.map((track) => {
    const words = getAudioBoundaries(track).filter((b) => b.word?.trim());
    const kept = words.slice(0, Math.max(0, budget));
    budget -= kept.length;
    return {
      id: track.id,
      text: track.text,
      startTime: r2(track.startTime),
      endTime: r2(track.startTime + track.duration),
      words: kept.map((b) => [b.word.trim(), r2(track.startTime + b.start)] as [string, number]),
      ...(kept.length < words.length ? { wordsCut: words.length - kept.length } : {}),
    };
  });
}
