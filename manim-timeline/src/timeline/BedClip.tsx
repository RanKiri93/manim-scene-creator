import { useSceneStore } from '@/store/useSceneStore';
import type { AudioBed, AudioBedKind } from '@/types/scene';

function bedKindLabel(kind: AudioBedKind): string {
  if (kind === 'music') return 'Music';
  if (kind === 'roomtone') return 'Room tone';
  return 'Noise';
}

interface BedClipProps {
  audioBed: AudioBed | null;
  sceneDurationSec: number;
  pxPerSecond: number;
  onEdit: () => void;
}

export default function BedClip({
  audioBed,
  sceneDurationSec,
  pxPerSecond,
  onEdit,
}: BedClipProps) {
  const removeAudioBed = useSceneStore((s) => s.removeAudioBed);
  const width = Math.max(sceneDurationSec * pxPerSecond, 48);

  if (!audioBed) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="absolute inset-y-0 left-0 flex min-w-[120px] items-center justify-center rounded-sm border border-dashed border-slate-600/80 bg-slate-900/40 px-2 text-[10px] text-slate-400 hover:border-indigo-500/60 hover:bg-slate-900/70 hover:text-slate-200"
        style={{ width: `${Math.min(width, 200)}px` }}
      >
        + Background bed
      </button>
    );
  }

  return (
    <div
      className="absolute top-0 bottom-0 rounded-sm border border-indigo-500/50 bg-indigo-950/40 pointer-events-auto"
      style={{ left: 0, width: `${width}px` }}
      title="Background bed — looped under narration at export (full scene)"
    >
      <div className="absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(90deg,transparent,transparent_8px,rgba(99,102,241,0.08)_8px,rgba(99,102,241,0.08)_16px)]" />
      <div className="relative z-10 flex h-full items-center gap-2 px-2">
        <span className="text-[9px] font-medium text-indigo-200 shrink-0">
          {bedKindLabel(audioBed.kind)}
        </span>
        <span className="text-[9px] text-indigo-300/80 font-mono shrink-0">
          {audioBed.gainDb} dB
        </span>
        <span className="text-[8px] text-slate-500 truncate flex-1">looped · full scene</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="shrink-0 rounded border border-indigo-400/50 bg-indigo-900/80 px-1.5 py-0.5 text-[8px] text-indigo-100 hover:bg-indigo-800"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            removeAudioBed();
          }}
          className="shrink-0 flex h-4 w-4 items-center justify-center rounded bg-slate-900/90 text-slate-400 hover:bg-red-900/90 hover:text-red-100 border border-slate-600/80"
          title="Remove background bed"
          aria-label="Remove background bed"
        >
          <span className="text-[11px] leading-none font-bold">×</span>
        </button>
      </div>
    </div>
  );
}
