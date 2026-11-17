import type { AudioTrackItem } from '@/types/scene';
import { getAudioBoundaries } from '@/types/scene';
import { useSceneStore } from '@/store/useSceneStore';
import { useAudioEditSession } from './audioEditSession';
import { useCountInRecorder } from './useCountInRecorder';
import RecorderButtons from './RecorderButtons';

/**
 * Punch-in for the marked part of a narration clip: a 3-second count-in, record (the narration
 * panel's microphone, raw WAV), then the take replaces only that part (`punchInAudio`).
 */
export default function PunchInControl({ item, range }: { item: AudioTrackItem; range: { from: number; to: number } }) {
  const punchInAudio = useSceneStore((s) => s.punchInAudio);
  const recorder = useCountInRecorder();
  const words = getAudioBoundaries(item)
    .filter((w) => (w.start + w.end) / 2 >= range.from && (w.start + w.end) / 2 < range.to)
    .map((w) => w.word)
    .join(' ');
  return (
    <RecorderButtons
      recorder={recorder}
      startLabel="Re-record this part"
      startTitle="Record this part again; the new take replaces only the marked part"
      stopLabel="Stop and replace"
      say={words}
      onStop={() =>
        void recorder.finish(async (take) => {
          const ok = await punchInAudio(item.id, range.from, range.to, take.blob, take.filename);
          if (!ok) return 'Could not replace that part (the clip or the marked range changed).';
          useAudioEditSession.getState().setRange(null);
          return null;
        })
      }
    />
  );
}
