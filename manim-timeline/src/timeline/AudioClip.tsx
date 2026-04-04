import { boundaryTimeToSeconds, type AudioTrackItem } from '@/types/scene';

interface AudioClipProps {
  item: AudioTrackItem;
  pxPerSecond: number;
  viewStart: number;
}

export default function AudioClip({ item, pxPerSecond, viewStart }: AudioClipProps) {
  const left = (item.startTime - viewStart) * pxPerSecond;
  const width = Math.max(item.duration * pxPerSecond, 4);
  const rawList = item.boundaries ?? [];
  const boundaries = rawList.map((b) => ({
    word: b.word,
    start: boundaryTimeToSeconds(b.start, item.duration),
    end: boundaryTimeToSeconds(b.end, item.duration),
  }));

  return (
    <div
      className="absolute top-0 bottom-0 z-10 overflow-visible rounded-sm border border-slate-500/60 bg-slate-700/50"
      style={{ left: `${left}px`, width: `${width}px` }}
    >
      {boundaries.map((boundary, i) => {
        const raw = rawList[i];
        const startRaw = raw?.start ?? boundary.start;
        let tickLeft = startRaw * pxPerSecond;
        if (tickLeft > width + 2) {
          tickLeft = (startRaw / 1000) * pxPerSecond;
        }
        return (
          <div
            key={`${boundary.start}-${i}`}
            className="pointer-events-none absolute top-0 bottom-0 z-20 flex h-full flex-row items-stretch"
            style={{ left: `${tickLeft}px` }}
          >
            <div
              className="shrink-0 bg-cyan-400"
              style={{ width: '2px', height: '100%', zIndex: 20 }}
              aria-hidden
            />
            <span className="pointer-events-none max-w-[96px] truncate pl-1 pt-0.5 text-[8px] font-bold leading-tight text-white drop-shadow-sm">
              {boundary.word}
            </span>
          </div>
        );
      })}
    </div>
  );
}
