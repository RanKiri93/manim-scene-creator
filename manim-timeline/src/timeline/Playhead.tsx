import { useSceneStore } from '@/store/useSceneStore';

interface PlayheadProps {
  pixelsPerSecond: number;
}

export default function Playhead({ pixelsPerSecond }: PlayheadProps) {
  const currentTime = useSceneStore((s) => s.currentTime);
  const left = currentTime * pixelsPerSecond;

  return (
    <div
      className="absolute top-0 bottom-0 z-50 w-px bg-red-500 pointer-events-none [&_*]:pointer-events-none"
      style={{ left }}
      aria-hidden
    >
      <div className="pointer-events-none absolute -top-2 left-1/2 w-0 -translate-x-1/2 border-b-[7px] border-l-[5px] border-r-[5px] border-t-0 border-l-transparent border-r-transparent border-b-red-500" />
    </div>
  );
}
