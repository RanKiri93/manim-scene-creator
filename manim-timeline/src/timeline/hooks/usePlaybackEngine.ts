import { useEffect, useRef } from 'react';
import { useSceneStore } from '@/store/useSceneStore';

/**
 * Single RAF loop: advance `currentTime`, auto-scroll the timeline, stop at scene end.
 * (Do not mount a second playback loop — duplicate loops double clock speed and can
 * restart or stack media that keys off `currentTime`.)
 */
export function usePlaybackEngine(
  timelineRef: React.RefObject<HTMLDivElement>,
  pixelsPerSecond: number,
) {
  const isPlaying = useSceneStore((s) => s.isPlaying);
  const setCurrentTime = useSceneStore((s) => s.setCurrentTime);
  const rafIdRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      lastTsRef.current = null;
      return;
    }

    const tick = (ts: number) => {
      if (lastTsRef.current === null) {
        lastTsRef.current = ts;
      } else {
        const deltaTime = (ts - lastTsRef.current) / 1000;
        lastTsRef.current = ts;

        const store = useSceneStore.getState();
        const prevTime = store.currentTime;
        let newTime = Math.max(0, prevTime + deltaTime);
        const dur = store.getSceneDuration();

        if (dur > 0 && newTime >= dur) {
          newTime = dur;
          setCurrentTime(newTime);
          store.pause();
          lastTsRef.current = null;
          rafIdRef.current = null;
          return;
        }

        setCurrentTime(newTime);

        const timeline = timelineRef.current;
        if (timeline) {
          const playheadX = newTime * pixelsPerSecond;
          const visibleRight = timeline.scrollLeft + timeline.clientWidth - 100;
          if (playheadX > visibleRight) {
            timeline.scrollLeft = Math.max(0, playheadX - timeline.clientWidth + 100);
          }
        }
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      lastTsRef.current = null;
    };
  }, [isPlaying, pixelsPerSecond, setCurrentTime, timelineRef]);
}
