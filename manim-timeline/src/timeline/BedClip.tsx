import { useSceneStore } from '@/store/useSceneStore';
import type { AudioBed, AudioBedKind } from '@/types/scene';
import { Button, CloseIcon, IconButton } from '@/components/ui';

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
        className="absolute inset-y-0.5 left-24 flex min-w-[140px] items-center justify-center rounded-ctl border border-dashed border-rule px-2 text-meta text-chalk-dim transition-colors hover:border-kind-audio/70 hover:text-chalk"
        style={{ width: `${Math.min(width, 200)}px` }}
      >
        Add background music
      </button>
    );
  }

  return (
    <div
      className="absolute top-0 bottom-0 rounded-ctl border border-kind-audio/60 bg-kind-audio/10 pointer-events-auto"
      style={{ left: 0, width: `${width}px` }}
      title="Background bed: looped under the narration for the whole scene at export"
    >
      <div className="absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(90deg,transparent,transparent_8px,rgb(154_114_172/0.10)_8px,rgb(154_114_172/0.10)_16px)]" />
      <div className="relative z-10 flex h-full items-center gap-2 pr-1 pl-24">
        <span className="shrink-0 text-meta font-medium text-chalk">
          {bedKindLabel(audioBed.kind)}
        </span>
        <span className="shrink-0 text-meta text-chalk-dim tabular-nums">
          {audioBed.gainDb} dB
        </span>
        <span className="flex-1 truncate text-meta text-chalk-faint">Loops under the whole scene</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          Edit
        </Button>
        <IconButton
          size="sm"
          danger
          label="Remove background bed"
          onClick={(e) => {
            e.stopPropagation();
            removeAudioBed();
          }}
        >
          <CloseIcon />
        </IconButton>
      </div>
    </div>
  );
}
