import { useEffect, useRef, useState } from 'react';
import { rememberedMicId, startMicRecording, type MicRecording, type MicTake } from '@/services/micRecorder';

export type RecorderPhase =
  | { kind: 'idle' }
  | { kind: 'countdown'; n: number }
  | { kind: 'recording'; seconds: number }
  | { kind: 'saving' };

/**
 * A 3-second count-in, then a raw WAV recording with the narration panel's microphone. Used by
 * the clip editor's punch-in and takes. `finish` stops and hands the take to `save`.
 */
export function useCountInRecorder() {
  const [phase, setPhase] = useState<RecorderPhase>({ kind: 'idle' });
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

  const finish = async (save: (take: MicTake) => Promise<string | null>) => {
    clearTimer();
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) {
      setPhase({ kind: 'idle' });
      return;
    }
    setPhase({ kind: 'saving' });
    try {
      setError(await save(await rec.stop()));
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

  return { phase, error, start, finish, cancel };
}
