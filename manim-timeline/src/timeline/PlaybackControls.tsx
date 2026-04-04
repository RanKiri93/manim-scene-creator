import { useMemo } from 'react';
import { useSceneStore } from '@/store/useSceneStore';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

export default function PlaybackControls() {
  const currentTime = useSceneStore((s) => s.currentTime);
  const isPlaying = useSceneStore((s) => s.isPlaying);
  const togglePlayback = useSceneStore((s) => s.togglePlayback);
  const setCurrentTime = useSceneStore((s) => s.setCurrentTime);
  const itemsMap = useSceneStore((s) => s.items);

  const duration = useMemo(() => {
    let max = 0;
    for (const it of itemsMap.values()) {
      const end = it.startTime + it.duration + it.waitAfter;
      if (end > max) max = end;
    }
    return max;
  }, [itemsMap]);

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-slate-800 border-t border-slate-700">
      {/* Play/Pause */}
      <button
        onClick={togglePlayback}
        className="w-8 h-8 flex items-center justify-center rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <rect x="2" y="1" width="4" height="12" rx="1" />
            <rect x="8" y="1" width="4" height="12" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <polygon points="2,1 12,7 2,13" />
          </svg>
        )}
      </button>

      {/* Rewind */}
      <button
        onClick={() => setCurrentTime(0)}
        className="w-8 h-8 flex items-center justify-center rounded-md bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors text-xs"
        title="Rewind to start"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="1" y="2" width="2" height="10" rx="0.5" />
          <polygon points="5,2 12,7 5,12" />
        </svg>
      </button>

      {/* Time display */}
      <span className="text-xs text-slate-400 font-mono min-w-[100px]">
        {formatTime(currentTime)} / {formatTime(duration || 0)}
      </span>

      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={Math.max(duration, 1)}
        step={0.01}
        value={currentTime}
        onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
        className="flex-1 accent-blue-500 h-1.5 cursor-pointer"
      />
    </div>
  );
}
