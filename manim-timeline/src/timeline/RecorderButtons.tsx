import { useSceneStore } from '@/store/useSceneStore';
import type { useCountInRecorder } from './useCountInRecorder';

/** Start / stop / cancel for a count-in recording, with the words to say while it runs. */
export default function RecorderButtons({
  recorder,
  startLabel,
  startTitle,
  stopLabel,
  say,
  onStop,
}: {
  recorder: ReturnType<typeof useCountInRecorder>;
  startLabel: string;
  startTitle: string;
  stopLabel: string;
  say?: string;
  onStop: () => void;
}) {
  const measureEnabled = useSceneStore((s) => s.measureConfig.enabled);
  const { phase, error, start, cancel } = recorder;
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
            title={measureEnabled ? startTitle : 'Needs the measure server (upload, cleanup, transcription)'}
          >
            {startLabel}
          </button>
        ) : phase.kind === 'recording' ? (
          <button
            type="button"
            onClick={onStop}
            className="rounded-ctl border border-danger bg-danger/20 px-2 py-1 text-ctl text-chalk hover:bg-danger/30"
          >
            {stopLabel} ({phase.seconds.toFixed(1)} s)
          </button>
        ) : (
          <span className="text-ctl text-chalk-dim">{phase.kind === 'countdown' ? `Recording in ${phase.n}…` : 'Uploading…'}</span>
        )}
        {busy && phase.kind !== 'saving' ? (
          <button type="button" onClick={cancel} className="rounded-ctl px-2 py-1 text-ctl text-chalk-dim hover:bg-rule">
            Cancel
          </button>
        ) : null}
      </div>
      {busy && say ? (
        <p className="text-body text-chalk leading-relaxed" dir="auto">
          {say}
        </p>
      ) : null}
      {error ? <p className="text-meta text-danger">{error}</p> : null}
    </div>
  );
}
