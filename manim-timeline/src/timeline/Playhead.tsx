import { useSceneStore } from '@/store/useSceneStore';

interface PlayheadProps {
  pixelsPerSecond: number;
}

export default function Playhead({ pixelsPerSecond }: PlayheadProps) {
  const currentTime = useSceneStore((s) => s.currentTime);
  const left = currentTime * pixelsPerSecond;

  return (
    <div
      className="absolute top-0 bottom-0 w-px bg-red-500 h-full z-50 pointer-events-none"
      style={{ left }}
    >
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-0 border-b-[7px] border-l-transparent border-r-transparent border-b-red-500" />
    </div>
  );
}
