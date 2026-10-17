import { getAudioBoundaries, type AudioTrackItem, type SceneItem } from '@/types/scene';

/*
 * Word anchors: a visual clip that starts on a spoken word keeps following that word through
 * narration edits. The follow is relative — when an edit moves the word by Δ, the clip moves by
 * Δ — so a clip nudged by hand stays where it was put until its word moves again.
 */

/** Scene time of every word that has an id. */
export function wordStartTimes(audioItems: readonly AudioTrackItem[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of audioItems) {
    for (const b of getAudioBoundaries(a)) {
      if (b.id) out.set(b.id, a.startTime + b.start);
    }
  }
  return out;
}

/** The track holding a word id, and the word's scene start. */
export function findAnchorWord(
  audioItems: readonly AudioTrackItem[],
  wordId: string,
): { track: AudioTrackItem; word: string; start: number } | null {
  for (const a of audioItems) {
    for (const b of getAudioBoundaries(a)) {
      if (b.id === wordId) return { track: a, word: b.word, start: a.startTime + b.start };
    }
  }
  return null;
}

/** New start times for anchored clips whose word moved between `before` and `after`. */
export function anchoredStartShifts(
  items: Iterable<SceneItem>,
  before: readonly AudioTrackItem[],
  after: readonly AudioTrackItem[],
): { id: string; startTime: number }[] {
  const anchored = [...items].filter((it) => it.wordAnchor?.wordId);
  if (anchored.length === 0 || before === after) return [];
  const t0 = wordStartTimes(before);
  const t1 = wordStartTimes(after);
  const out: { id: string; startTime: number }[] = [];
  for (const it of anchored) {
    const id = it.wordAnchor!.wordId;
    const a = t0.get(id);
    const b = t1.get(id);
    if (a == null || b == null || Math.abs(b - a) < 1e-9) continue;
    out.push({ id: it.id, startTime: Math.max(0, it.startTime + (b - a)) });
  }
  return out;
}

/** Copy of a clip whose words all have ids (new ids from `newId`). */
export function withWordIds(a: AudioTrackItem, newId: () => string): AudioTrackItem {
  const words = getAudioBoundaries(a);
  if (words.every((w) => w.id)) return a;
  const next: AudioTrackItem = { ...a, boundaries: words.map((w) => (w.id ? w : { ...w, id: newId() })) };
  delete next.word_boundaries;
  return next;
}
