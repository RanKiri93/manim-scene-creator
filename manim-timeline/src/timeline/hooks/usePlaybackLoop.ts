import { useEffect, useRef } from 'react';
import { useSceneStore } from '@/store/useSceneStore';

/**
 * requestAnimationFrame loop that advances currentTime while isPlaying is true.
 * Pauses automatically when reaching the end of the scene.
 */
export function usePlaybackLoop() {
  const isPlaying = useSceneStore((s) => s.isPlaying);
  const setCurrentTime = useSceneStore((s) => s.setCurrentTime);
  const pause = useSceneStore((s) => s.pause);
  const prevTs = useRef<number | null>(null);
  const rafId = useRef<number>(0);

  useEffect(() => {
    if (!isPlaying) {
      prevTs.current = null;
      return;
    }

    const tick = (ts: number) => {
      if (prevTs.current !== null) {
        const dt = (ts - prevTs.current) / 1000;
        const store = useSceneStore.getState();
        const next = store.currentTime + dt;

        let dur = 0;
        for (const it of store.items.values()) {
          const end = it.startTime + it.duration + it.waitAfter;
          if (end > dur) dur = end;
        }

        if (next >= dur) {
          setCurrentTime(dur);
          pause();
          prevTs.current = null;
          return;
        }
        setCurrentTime(next);
      }
      prevTs.current = ts;
      rafId.current = requestAnimationFrame(tick);
    };

    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, [isPlaying, setCurrentTime, pause]);
}
