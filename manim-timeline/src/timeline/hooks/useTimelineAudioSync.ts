import { useEffect } from 'react';
import { ensureTimelineAudioSyncWired } from '@/timeline/timelineAudioController';

/**
 * Wires the app-wide timeline audio driver (single RAF + one Web Audio session).
 * Safe under React StrictMode: the heavy lifting lives in `timelineAudioController`.
 */
export function useTimelineAudioSync() {
  useEffect(() => {
    ensureTimelineAudioSyncWired();
  }, []);
}
