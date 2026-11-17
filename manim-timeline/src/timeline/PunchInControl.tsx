import { useEffect, useRef, useState } from 'react';
import type { AudioTrackItem } from '@/types/scene';
import { getAudioBoundaries } from '@/types/scene';
import { useSceneStore } from '@/store/useSceneStore';
import { rememberedMicId, startMicRecording, type MicRecording } from '@/services/micRecorder';
import { useAudioEditSession } from './audioEditSession';

type Phase = { kind: 'idle' } | { kind: 'countdown'; n: number } | { kind: 'recording'; seconds: number } | { kind: 'saving' };

/**
 * Punch-in for the marked part of a narration clip: a 3-second count-in, record (the narration
 * panel's microphone, raw WAV), then the take replaces only that part (`punchInAudio`).
 */
export default function PunchInControl({ item, range }: { item: AudioTrackItem; range: { from: number; to: number } }) {
  const punchInAudio = useSceneStore((s) => s.punchInAudio);
  const measureEnabled = useSceneStore((s) => s.measureConfig.enabled);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MicRecording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };
  useEffect(
    () => () => {
      clearTimer();
      recRef.current?.cancel();
    },
    [],
  );

  const words = getAudioBoundaries(item)
    .filter((w) => (w.start + w.end) / 2 >= range.from && (w.start + w.end) / 2 < range.to)
    .map((w) => w.word)
    .join(' ');

  const begin = async () => {
    try {
      const rec = await startMicRecording({ deviceId: rememberedMicId() || undefined, browserProcessing: false });
      recRef.current = rec;
      setPhase({ kind: 'recording', seconds: 0 });
      timerRef.current = setInterval(() => setPhase({ kind: 'recording', seconds: rec.elapsed() }), 200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase({ kind: 'idle' });
    }
  };

  const start = () => {
    setError(null);
    let n = 3;
    setPhase({ kind: 'countdown', n });
    timerRef.current = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setPhase({ kind: 'countdown', n });
        return;
      }
      clearTimer();
      void begin();
    }, 1000);
  };

  const stop = async () => {
    clearTimer();
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) {
      setPhase({ kind: 'idle' });
      return;
    }
    setPhase({ kind: 'saving' });
    try {
      const take = await rec.stop();
      const ok = await punchInAudio(item.id, range.from, range.to, take.blob, take.filename);
      if (!ok) setError('Could not replace that part (the clip or the marked range changed).');
      else useAudioEditSession.getState().setRange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase({ kind: 'idle' });
    }
  };

  const cancel = () => {
    clearTimer();
    recRef.current?.cancel();
    recRef.current = null;
    setPhase({ kind: 'idle' });
  };

  const busy = phase.kind !== 'idle';
  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {phase.kind === 'idle' ? (
          <button
            type="button"
            disabled={!measureEnabled}
            onClick={start}
            className="rounded-ctl border border-danger/60 bg-raised px-2 py-1 text-ctl text-chalk hover:bg-rule disabled:opacity-50"
            title={measureEnabled ? 'Record this part again; the new take replaces only the marked part' : 'Needs the measure server (upload, cleanup, transcription)'}
          >
            Re-record this part
          </button>
        ) : phase.kind === 'recording' ? (
          <button
            type="button"
            onClick={() => void stop()}
            className="rounded-ctl border border-danger bg-danger/20 px-2 py-1 text-ctl text-chalk hover:bg-danger/30"
          >
            Stop and replace ({phase.seconds.toFixed(1)} s)
          </button>
        ) : (
          <span className="text-ctl text-chalk-dim">{phase.kind === 'countdown' ? `Recording in ${phase.n}…` : 'Uploading and replacing…'}</span>
        )}
        {busy && phase.kind !== 'saving' ? (
          <button type="button" onClick={cancel} className="rounded-ctl px-2 py-1 text-ctl text-chalk-dim hover:bg-rule">
            Cancel
          </button>
        ) : null}
      </div>
      {busy && words ? <p className="text-meta text-chalk" dir="auto">Say: {words}</p> : null}
      {error ? <p className="text-meta text-danger">{error}</p> : null}
    </div>
  );
}
