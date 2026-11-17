import { useState } from 'react';
import type { AudioTrackItem } from '@/types/scene';
import { useSceneStore } from '@/store/useSceneStore';
import { dbToGain } from '@/lib/audioSchedule';
import { clipPieces } from '@/lib/audioEdit';
import { playAudioPiecesPreview, stopAudioPreview } from './audioBuffers';
import { useCountInRecorder } from './useCountInRecorder';
import RecorderButtons from './RecorderButtons';

/**
 * Takes of a narration clip: record another take of the same sentence (its text is shown to read),
 * listen to each, and pick the one to use. The clip keeps its place, links and settings.
 */
export default function TakesSection({ item, linked }: { item: AudioTrackItem; linked: boolean }) {
  const recordAudioTake = useSceneStore((s) => s.recordAudioTake);
  const switchAudioTake = useSceneStore((s) => s.switchAudioTake);
  const removeAudioTake = useSceneStore((s) => s.removeAudioTake);
  const recorder = useCountInRecorder();
  const [playing, setPlaying] = useState<string | null>(null);
  const takes = item.takes ?? [];

  const play = (key: string, sound: Pick<AudioTrackItem, 'audioUrl' | 'duration' | 'sourceIn' | 'pieces'>) => {
    if (playing === key) {
      stopAudioPreview();
      return;
    }
    setPlaying(key);
    void playAudioPiecesPreview(
      sound.audioUrl,
      clipPieces({ ...item, ...sound, pieces: sound.pieces, sourceIn: sound.sourceIn }),
      dbToGain(item.gainDb ?? 0),
      () => setPlaying((p) => (p === key ? null : p)),
    );
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-chalk-dim font-medium text-meta">Takes</h3>
      <ul className="flex flex-col gap-1">
        <li className="flex items-center gap-2 text-ctl">
          <span className="rounded-ctl bg-highlight/20 px-1.5 text-meta text-chalk">In use</span>
          <span className="tabular-nums text-chalk-dim">{item.duration.toFixed(2)} s</span>
          <button type="button" className="ml-auto rounded-ctl px-2 py-0.5 hover:bg-rule" onClick={() => play('current', item)}>
            {playing === 'current' ? 'Stop' : 'Play'}
          </button>
        </li>
        {takes.map((t, i) => (
          <li key={t.id} className="flex items-center gap-2 text-ctl">
            <span className="text-chalk-dim">Take {i + 1}</span>
            <span className="tabular-nums text-chalk-faint">{t.duration.toFixed(2)} s</span>
            <span className="truncate text-meta text-chalk-faint" dir="auto" title={t.text}>
              {t.text}
            </span>
            <button type="button" className="ml-auto rounded-ctl px-2 py-0.5 hover:bg-rule" onClick={() => play(t.id, t)}>
              {playing === t.id ? 'Stop' : 'Play'}
            </button>
            <button
              type="button"
              className="rounded-ctl border border-highlight/60 px-2 py-0.5 hover:bg-rule"
              title={linked ? 'Use this take (the linked visual clip follows its new length)' : 'Use this take; later narration moves by the length difference'}
              onClick={() => switchAudioTake(item.id, t.id)}
            >
              Use
            </button>
            <button type="button" className="rounded-ctl px-2 py-0.5 text-chalk-faint hover:bg-rule" title="Forget this take" onClick={() => removeAudioTake(item.id, t.id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <RecorderButtons
        recorder={recorder}
        startLabel="Record another take"
        startTitle="Record the same sentence again and use it; the current take is kept to switch back"
        stopLabel="Stop and use it"
        say={item.text}
        onStop={() =>
          void recorder.finish(async (take) =>
            (await recordAudioTake(item.id, take.blob, take.filename)) ? null : 'Could not add the take (the clip changed).',
          )
        }
      />
    </section>
  );
}
