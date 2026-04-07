import type { SceneItem } from '@/types/scene';
import { useSceneStore } from '@/store/useSceneStore';
import TimelineClip from './TimelineClip';

interface TimelineTrackProps {
  layer: number;
  items: SceneItem[];
  pxPerSecond: number;
  viewStart: number;
}

export default function TimelineTrack({
  layer,
  items,
  pxPerSecond,
  viewStart,
}: TimelineTrackProps) {
  const selectedIds = useSceneStore((s) => s.selectedIds);

  return (
    <div className="relative z-10 h-8 border-b border-slate-700/50">
      {/* Layer label */}
      <span className="absolute left-1 top-0.5 text-[9px] text-slate-500 z-10 pointer-events-none">
        L{layer}
      </span>

      {items.map((item, stackIndex) => (
        <TimelineClip
          key={item.id}
          item={item}
          stackIndex={stackIndex}
          pxPerSecond={pxPerSecond}
          viewStart={viewStart}
          isSelected={selectedIds.has(item.id)}
        />
      ))}
    </div>
  );
}
