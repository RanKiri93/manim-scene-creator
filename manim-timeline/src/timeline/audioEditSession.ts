import { create } from 'zustand';
import type { AudioTrackItem } from '@/types/scene';
import { copyRange } from '@/lib/audioEdit';
import { useSceneStore } from '@/store/useSceneStore';

/*
 * Transient narration-editing state that is not part of the project or undo history: the range
 * marked inside a clip (Alt+drag) and the audio clipboard.
 */

export interface AudioRange {
  clipId: string;
  /** Clip-local seconds, from <= to. */
  from: number;
  to: number;
}

interface AudioEditSession {
  range: AudioRange | null;
  /** Pieces with `startTime` relative to the earliest one. */
  clipboard: AudioTrackItem[];
  setRange: (range: AudioRange | null) => void;
}

export const useAudioEditSession = create<AudioEditSession>((set) => ({
  range: null,
  clipboard: [],
  setRange: (range) => set({ range }),
}));

const newId = () => crypto.randomUUID().slice(0, 12);

/** The marked range, when its clip still exists. */
export function activeAudioRange(): { range: AudioRange; clip: AudioTrackItem } | null {
  const range = useAudioEditSession.getState().range;
  if (!range) return null;
  const clip = useSceneStore.getState().audioItems.find((a) => a.id === range.clipId);
  return clip ? { range, clip } : null;
}

/** Copy the marked range, else the selected clips. Returns whether anything was copied. */
export function copyAudioSelection(): boolean {
  const marked = activeAudioRange();
  if (marked) {
    const piece = copyRange(marked.clip, marked.range.from, marked.range.to, newId());
    if (!piece) return false;
    useAudioEditSession.setState({ clipboard: [piece] });
    return true;
  }
  const { audioItems, selectedIds } = useSceneStore.getState();
  const chosen = audioItems.filter((a) => selectedIds.has(a.id));
  if (chosen.length === 0) return false;
  const t0 = Math.min(...chosen.map((a) => a.startTime));
  useAudioEditSession.setState({
    clipboard: chosen.map((a) => ({ ...a, id: newId(), startTime: a.startTime - t0 })),
  });
  return true;
}

/**
 * Delete the marked range (the clip closes up), else remove the selected clips.
 * Returns whether anything changed.
 */
export function deleteAudioSelection(): boolean {
  const marked = activeAudioRange();
  const store = useSceneStore.getState();
  if (marked) {
    const ok = store.deleteAudioRange(marked.clip.id, marked.range.from, marked.range.to);
    useAudioEditSession.setState({ range: null });
    return ok;
  }
  const ids = store.audioItems.filter((a) => store.selectedIds.has(a.id)).map((a) => a.id);
  for (const id of ids) useSceneStore.getState().removeAudioItem(id);
  return ids.length > 0;
}

export function cutAudioSelection(): boolean {
  return copyAudioSelection() && deleteAudioSelection();
}

/** Paste at the playhead: on top (default) or inserted, pushing later audio right. */
export function pasteAudioClipboard(mode: 'over' | 'insert'): boolean {
  const { clipboard } = useAudioEditSession.getState();
  if (clipboard.length === 0) return false;
  const store = useSceneStore.getState();
  store.pasteAudioClips(clipboard, store.currentTime, mode);
  useAudioEditSession.setState({ range: null });
  return true;
}
