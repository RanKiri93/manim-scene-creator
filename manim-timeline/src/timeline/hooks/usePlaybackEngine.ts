import { useEffect, useRef } from 'react';
import { useSceneStore } from '@/store/useSceneStore';

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

        const prevTime = useSceneStore.getState().currentTime;
        const newTime = Math.max(0, prevTime + deltaTime);
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
