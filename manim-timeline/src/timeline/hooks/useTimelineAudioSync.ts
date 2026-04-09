import { useEffect } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import {
  ensureTimelineAudioSyncWired,
  pruneTimelineAudioPool,
} from '@/timeline/timelineAudioController';

/**
 * Wires the app-wide timeline audio driver (single RAF + one element per track).
 * Safe under React StrictMode: the heavy lifting lives in `timelineAudioController`.
 */
export function useTimelineAudioSync() {
  const audioItems = useSceneStore((s) => s.audioItems);

  useEffect(() => {
    ensureTimelineAudioSyncWired();
  }, []);

  useEffect(() => {
    pruneTimelineAudioPool(audioItems);
  }, [audioItems]);
}
