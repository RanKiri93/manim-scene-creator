import type { AudioTrackItem, ItemId, SceneItem } from '@/types/scene';
import { getAudioBoundaries } from '@/types/scene';
import { deleteClipRange } from '@/lib/audioEdit';
import { explicitVisualOwnerForAudioTrack } from '@/lib/audioBinding';
import { anchoredStartShifts, withWordIds } from '@/lib/wordAnchors';

/*
 * Copilot `AUDIO` actions — narration edits the user can preview and undo like any proposal:
 *   cut    remove scene range [from, to) from the one narration clip it lies in; the rest of the
 *          clip, later unlinked narration and clips anchored to later words move up
 *   gain   set a clip's gain in dB
 *   anchor start a clip on the word that starts at scene time `at` and keep it on that word
 * `applyAudioEdit` runs the editor's own edit helpers on copies; commit calls the store.
 */

export type AgentAudioEdit =
  | { op: 'cut'; from: number; to: number }
  | { op: 'gain'; trackId: string; gainDb: number }
  | { op: 'anchor'; itemId: ItemId; at: number };

/** How far `anchor.at` may be from a word start (s). */
export const ANCHOR_TOLERANCE_SEC = 0.06;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const s2 = (n: number) => `${+n.toFixed(2)}s`;

export function normalizeAudioEdit(raw: Record<string, unknown>, path: string, errors: string[]): AgentAudioEdit | null {
  const e = raw.edit && typeof raw.edit === 'object' ? (raw.edit as Record<string, unknown>) : raw;
  switch (e.op) {
    case 'cut': {
      const from = num(e.from);
      const to = num(e.to);
      if (Number.isNaN(from) || Number.isNaN(to) || to <= from) {
        errors.push(`${path}: cut needs numbers from < to (scene seconds).`);
        return null;
      }
      return { op: 'cut', from, to };
    }
    case 'gain': {
      const gainDb = num(e.gainDb);
      if (typeof e.trackId !== 'string' || !e.trackId || Number.isNaN(gainDb)) {
        errors.push(`${path}: gain needs trackId (a narration id) and gainDb (number).`);
        return null;
      }
      return { op: 'gain', trackId: e.trackId, gainDb: Math.max(-40, Math.min(20, gainDb)) };
    }
    case 'anchor': {
      const at = num(e.at);
      if (typeof e.itemId !== 'string' || !e.itemId || Number.isNaN(at)) {
        errors.push(`${path}: anchor needs itemId and at (scene start of the word).`);
        return null;
      }
      return { op: 'anchor', itemId: e.itemId, at };
    }
    default:
      errors.push(`${path}.edit.op must be "cut", "gain" or "anchor".`);
      return null;
  }
}

export function describeAudioEdit(edit: AgentAudioEdit): string {
  if (edit.op === 'cut') return `cut narration ${s2(edit.from)}–${s2(edit.to)}`;
  if (edit.op === 'gain') return `gain ${edit.gainDb} dB on ${edit.trackId}`;
  return `anchor ${edit.itemId} to the word at ${s2(edit.at)}`;
}

/** The narration clip a cut lies in (clip-local range), or why there is none. */
export function locateCut(
  audio: readonly AudioTrackItem[],
  from: number,
  to: number,
): { track: AudioTrackItem; from: number; to: number } | string {
  const track = audio.find((a) => from >= a.startTime - 1e-3 && to <= a.startTime + a.duration + 1e-3);
  if (!track) {
    const near = audio
      .filter((a) => a.startTime < to && a.startTime + a.duration > from)
      .map((a) => `"${a.text.slice(0, 30)}" (${a.id}) ${s2(a.startTime)}–${s2(a.startTime + a.duration)}`);
    return near.length
      ? `the range crosses a narration clip edge; cut inside one clip: ${near.join('; ')}.`
      : 'no narration plays there.';
  }
  return { track, from: Math.max(0, from - track.startTime), to: Math.min(track.duration, to - track.startTime) };
}

/** The word starting at scene time `at` (closest within tolerance). */
export function locateWord(
  audio: readonly AudioTrackItem[],
  at: number,
): { track: AudioTrackItem; wordIndex: number; start: number; word: string } | null {
  let best: { track: AudioTrackItem; wordIndex: number; start: number; word: string } | null = null;
  let bestD = ANCHOR_TOLERANCE_SEC;
  for (const a of audio) {
    const words = getAudioBoundaries(a);
    for (let i = 0; i < words.length; i++) {
      const d = Math.abs(a.startTime + words[i]!.start - at);
      if (d <= bestD) {
        bestD = d;
        best = { track: a, wordIndex: i, start: a.startTime + words[i]!.start, word: words[i]!.word };
      }
    }
  }
  return best;
}

export type AudioEditResult =
  | { ok: true; items: Map<ItemId, SceneItem>; audioItems: AudioTrackItem[] }
  | { ok: false; error: string };

let virtualIds = 0;
const virtualId = () => `ai_audio_${++virtualIds}`;

/** The edit on copies of the scene and its narration (for validation, the draft and preview). */
export function applyAudioEdit(
  items: ReadonlyMap<ItemId, SceneItem>,
  audio: readonly AudioTrackItem[],
  edit: AgentAudioEdit,
): AudioEditResult {
  const map = new Map(items);
  if (edit.op === 'cut') {
    const where = locateCut(audio, edit.from, edit.to);
    if (typeof where === 'string') return { ok: false, error: where };
    const res = deleteClipRange(audio, where.track.id, where.from, where.to, virtualId(), (id) =>
      explicitVisualOwnerForAudioTrack(map, id) != null,
    );
    if (!res) return { ok: false, error: 'the range is too short to cut.' };
    for (const { id, startTime } of anchoredStartShifts(map.values(), audio, res.audioItems)) {
      const it = map.get(id);
      if (it) map.set(id, { ...it, startTime } as SceneItem);
    }
    return { ok: true, items: map, audioItems: res.audioItems };
  }
  if (edit.op === 'gain') {
    if (!audio.some((a) => a.id === edit.trackId)) return { ok: false, error: `no narration clip "${edit.trackId}".` };
    return {
      ok: true,
      items: map,
      audioItems: audio.map((a) => (a.id === edit.trackId ? { ...a, gainDb: edit.gainDb } : a)),
    };
  }
  const item = map.get(edit.itemId);
  if (!item) return { ok: false, error: `no clip "${edit.itemId}".` };
  const hit = locateWord(audio, edit.at);
  if (!hit) return { ok: false, error: `no word starts at ${s2(edit.at)} (use a word time from the narration or find_words).` };
  if ('audioTrackId' in item && item.audioTrackId === hit.track.id) {
    return { ok: false, error: `${edit.itemId} owns that narration (audioTrackId), so it cannot also follow one of its words.` };
  }
  const track = withWordIds(hit.track, virtualId);
  const wordId = getAudioBoundaries(track)[hit.wordIndex]!.id!;
  map.set(edit.itemId, { ...item, startTime: hit.start, wordAnchor: { wordId } } as SceneItem);
  return { ok: true, items: map, audioItems: audio.map((a) => (a.id === track.id ? track : a)) };
}
