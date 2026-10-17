import { useRef, useState, useEffect } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { AudioPanelMode } from '@/store/useSceneStore';
import {
  listMicrophones,
  startMicRecording,
  type MicRecording,
} from '@/services/micRecorder';
import { setTimelineAudioMuted } from '@/timeline/timelineAudioController';

/** Input peak above this (dBFS) counts as clipping. */
const CLIP_DB = -1;

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

type AudioPanelProps = {
  mode: AudioPanelMode;
};

function LangToggle(props: {
  lang: 'iw' | 'en';
  setLang: (l: 'iw' | 'en') => void;
  disabled?: boolean;
  label?: string;
}) {
  const { lang, setLang, disabled, label = 'Language' } = props;
  return (
    <div className="flex items-center gap-3">
      <span className="text-chalk-dim shrink-0">{label}</span>
      <div className="flex rounded-ctl border border-rule overflow-hidden">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setLang('iw')}
          className={`px-3 py-1.5 text-ctl font-medium transition-colors ${
            lang === 'iw'
              ? 'bg-raised text-chalk ring-1 ring-highlight/50 ring-inset'
              : 'bg-raised text-chalk-dim hover:text-chalk'
          } disabled:opacity-50`}
        >
          Hebrew (iw)
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setLang('en')}
          className={`px-3 py-1.5 text-ctl font-medium transition-colors border-l border-rule ${
            lang === 'en'
              ? 'bg-raised text-chalk ring-1 ring-highlight/50 ring-inset'
              : 'bg-raised text-chalk-dim hover:text-chalk'
          } disabled:opacity-50`}
        >
          English (en)
        </button>
      </div>
    </div>
  );
}

export default function AudioPanel({ mode }: AudioPanelProps) {
  const isTimelinePlaying = useSceneStore((s) => s.isPlaying);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const [script, setScript] = useState('');
  const [useScript, setUseScript] = useState(false);
  const [lang, setLang] = useState<'iw' | 'en'>('iw');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [browserProcessingEnabled, setBrowserProcessingEnabled] = useState(false);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState('');
  const [countIn, setCountIn] = useState(true);
  const [overTimeline, setOverTimeline] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [peakDb, setPeakDb] = useState(-Infinity);
  const [clipped, setClipped] = useState(false);
  const recRef = useRef<MicRecording | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Record-over-timeline: where the take starts and whether we started playback. */
  const overRef = useRef<{ startAt: number; startedPlayback: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const addAudioItem = useSceneStore((s) => s.addAudioItem);
  const addRecordedAudioTrack = useSceneStore((s) => s.addRecordedAudioTrack);

  /** File chosen locally; upload runs only after Approve. */
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  /** Mic capture waiting for Approve. */
  const [pendingRecord, setPendingRecord] = useState<{
    blob: Blob;
    filename: string;
    /** Timeline start when the take was recorded over the timeline. */
    startAt?: number;
  } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (isTimelinePlaying) {
      previewAudioRef.current?.pause();
    }
  }, [isTimelinePlaying]);

  const clearPendingPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPendingFile(null);
    setPendingRecord(null);
  };

  const setPreviewFromFile = (file: File) => {
    clearPendingPreview();
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const setPreviewFromBlob = (blob: Blob, filename: string, startAt?: number) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(null);
    setPendingRecord({ blob, filename, startAt });
    setPreviewUrl(URL.createObjectURL(blob));
  };

  const refreshMics = () => {
    void listMicrophones()
      .then(setMics)
      .catch(() => setMics([]));
  };

  useEffect(() => {
    if (mode === 'record') refreshMics();
  }, [mode]);

  useEffect(
    () => () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
      recRef.current?.cancel();
      setTimelineAudioMuted(false);
    },
    [],
  );

  const handleGenerate = async () => {
    setError(null);
    setLoading(true);
    try {
      await addAudioItem(script, lang);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setPreviewFromFile(file);
  };

  const approveUpload = async () => {
    const file = pendingFile;
    const rec = pendingRecord;
    if (!file && !rec) return;
    setError(null);
    setLoading(true);
    try {
      const blob = file ?? rec!.blob;
      const filename = file?.name ?? rec!.filename;
      await addRecordedAudioTrack(blob, {
        displayText: useScript ? script : undefined,
        useScriptForTranscription: useScript,
        filename,
        emptyLabel: file ? 'Uploaded audio' : 'Mic recording',
        transcriptionLang: lang,
        // Recordings and uploads both come in fully RAW (untouched). Apply consistency processing
        // on demand via the per-clip "Clean" / "Normalize" / "Match EQ" buttons.
        autoClean: false,
        startTime: rec?.startAt,
      });
      clearPendingPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const beginRecording = async () => {
    try {
      const rec = await startMicRecording({
        deviceId: micId || undefined,
        browserProcessing: browserProcessingEnabled,
        onLevel: ({ peakDb: p }) => {
          // Peak hold with a fall of ~1.5 dB per block (~35 dB/s) so short gaps don't blank it.
          setPeakDb((prev) => (p >= prev || !Number.isFinite(prev) ? p : Math.max(p, prev - 1.5)));
          if (p > CLIP_DB) setClipped(true);
        },
      });
      recRef.current = rec;
      refreshMics(); // labels become available after the first permission grant
      if (overTimeline) {
        const st = useSceneStore.getState();
        overRef.current = { startAt: st.currentTime, startedPlayback: !st.isPlaying };
        setTimelineAudioMuted(true);
        if (!st.isPlaying) st.togglePlayback();
      } else {
        overRef.current = null;
      }
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed(rec.elapsed()), 200);
      setIsRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const stopRecording = async () => {
    const rec = recRef.current;
    recRef.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    const over = overRef.current;
    overRef.current = null;
    if (over) {
      if (over.startedPlayback) useSceneStore.getState().pause();
      setTimelineAudioMuted(false);
    }
    setIsRecording(false);
    setPeakDb(-Infinity);
    if (!rec) return;
    try {
      const take = await rec.stop();
      setPreviewFromBlob(take.blob, take.filename, over?.startAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRecordToggle = () => {
    if (isRecording) {
      void stopRecording();
      return;
    }
    if (countdown != null) {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
      setCountdown(null);
      return;
    }
    setError(null);
    setClipped(false);
    if (!countIn) {
      void beginRecording();
      return;
    }
    let n = 3;
    setCountdown(n);
    countdownTimerRef.current = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCountdown(n);
        return;
      }
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
      setCountdown(null);
      void beginRecording();
    }, 1000);
  };

  const previewActive = Boolean(previewUrl && (pendingFile || pendingRecord));

  if (mode === 'tts') {
    return (
      <div className="flex flex-col gap-3 text-ctl text-chalk-dim">
        <label className="flex flex-col gap-1">
          <span className="text-chalk-dim">Script</span>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={8}
            spellCheck={false}
            disabled={loading}
            className="w-full rounded-ctl border border-rule bg-ink px-2 py-2 text-chalk placeholder:text-chalk-faint focus:border-chalk-faint disabled:opacity-50"
            placeholder="Text to synthesize…"
          />
        </label>
        <LangToggle lang={lang} setLang={setLang} disabled={loading} />
        <button
          type="button"
          disabled={loading || !script.trim()}
          onClick={() => void handleGenerate()}
          className="bg-highlight font-semibold text-highlight-ink enabled:hover:bg-highlight/90 rounded-ctl px-3 py-2 text-ctl disabled:cursor-not-allowed disabled:opacity-50 w-fit"
        >
          {loading ? 'Generating…' : 'Generate Audio Track'}
        </button>
        {error && (
          <p className="rounded-ctl border border-danger/50 bg-danger/10 px-2 py-1.5 text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (mode === 'upload') {
    return (
      <div className="flex flex-col gap-3 text-ctl text-chalk-dim">
        <label className="flex items-start gap-2 rounded-ctl border border-rule bg-ink/60 px-2 py-2">
          <input
            type="checkbox"
            checked={useScript}
            disabled={loading}
            onChange={(e) => setUseScript(e.target.checked)}
            className="mt-0.5"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-chalk-dim">Use script for transcription</span>
            <span className="text-meta leading-snug text-chalk-faint">
              When enabled, the script below is aligned to Whisper word timings. When off, raw
              Whisper transcription is used and the clip keeps a generic label.
            </span>
          </span>
        </label>
        {useScript && (
          <label className="flex flex-col gap-1">
            <span className="text-chalk-dim">Script for guided transcription</span>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={6}
              spellCheck={false}
              disabled={loading}
              className="w-full rounded-ctl border border-rule bg-ink px-2 py-2 text-chalk placeholder:text-chalk-faint focus:border-chalk-faint disabled:opacity-50"
              placeholder="Narration for this recording…"
            />
          </label>
        )}
        {useScript && (
          <p className="text-meta text-chalk-faint leading-snug">
            Wrap math in <code className="text-chalk-dim">$...$</code> for one bookmark per
            formula, e.g.{' '}
            <span dir="rtl" className="text-chalk-dim">
              נגדיר את הפונקציה $f(x)=x^2$ ואז נגזור
            </span>
            .
          </p>
        )}
        <LangToggle
          lang={lang}
          setLang={setLang}
          disabled={loading}
          label="Transcription"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.webm,.wav,.mp3,.m4a,.ogg,.flac,.opus,.aac"
          className="hidden"
          onChange={(e) => handleFileChosen(e)}
        />
        {!previewActive ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => fileInputRef.current?.click()}
            className="bg-highlight font-semibold text-highlight-ink enabled:hover:bg-highlight/90 rounded-ctl px-3 py-2 text-ctl disabled:cursor-not-allowed disabled:opacity-50 w-fit"
          >
            Choose audio file…
          </button>
        ) : (
          <div className="flex flex-col gap-2 rounded-ctl border border-rule bg-ink/80 p-3">
            <span className="text-chalk-dim text-meta">Preview</span>
            <audio
              ref={previewAudioRef}
              controls
              src={previewUrl ?? undefined}
              className="w-full h-9"
            />
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={loading}
                onClick={() => void approveUpload()}
                className="bg-highlight font-semibold text-highlight-ink enabled:hover:bg-highlight/90 rounded-ctl px-3 py-1.5 text-ctl disabled:opacity-50"
              >
                {loading ? 'Uploading…' : 'Add to timeline'}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={clearPendingPreview}
                className="rounded-ctl bg-raised px-3 py-1.5 text-ctl font-medium text-chalk hover:bg-rule disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="rounded-ctl border border-danger/50 bg-danger/10 px-2 py-1.5 text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-ctl text-chalk-dim">
      <label className="flex items-start gap-2 rounded-ctl border border-rule bg-ink/60 px-2 py-2">
        <input
          type="checkbox"
          checked={useScript}
          disabled={(loading && !isRecording) || isRecording}
          onChange={(e) => setUseScript(e.target.checked)}
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-chalk-dim">Use script for transcription</span>
          <span className="text-meta leading-snug text-chalk-faint">
            When enabled, the script below is aligned to Whisper word timings after recording.
            When off, raw Whisper transcription is used and the clip keeps a generic label.
          </span>
        </span>
      </label>
      {useScript && (
        <label className="flex flex-col gap-1">
          <span className="text-chalk-dim">Script to read while recording</span>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={6}
            spellCheck={false}
            disabled={loading && !isRecording}
            className="w-full rounded-ctl border border-rule bg-ink px-2 py-2 text-chalk placeholder:text-chalk-faint focus:border-chalk-faint disabled:opacity-50"
            placeholder="Script to read while recording…"
          />
        </label>
      )}
      {useScript && (
        <p className="text-meta text-chalk-faint leading-snug">
          Wrap math in <code className="text-chalk-dim">$...$</code> for one bookmark per formula,
          e.g.{' '}
          <span dir="rtl" className="text-chalk-dim">
            נגדיר את הפונקציה $f(x)=x^2$ ואז נגזור
          </span>
          .
        </p>
      )}
      <LangToggle
        lang={lang}
        setLang={setLang}
        disabled={loading && !isRecording}
        label="Transcription"
      />
      <label className="flex flex-col gap-1">
        <span className="text-chalk-dim">Microphone</span>
        <select
          value={micId}
          disabled={isRecording || countdown != null}
          onChange={(e) => setMicId(e.target.value)}
          onFocus={refreshMics}
          className="w-full rounded-ctl border border-rule bg-ink px-2 py-1.5 text-chalk disabled:opacity-50"
        >
          <option value="">System default</option>
          {mics.map((m, i) => (
            <option key={m.deviceId || i} value={m.deviceId}>
              {m.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-start gap-2 rounded-ctl border border-rule bg-ink/60 px-2 py-2">
        <input
          type="checkbox"
          checked={browserProcessingEnabled}
          disabled={isRecording || loading}
          onChange={(e) => setBrowserProcessingEnabled(e.target.checked)}
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-chalk-dim">Browser mic processing</span>
          <span className="text-meta leading-snug text-chalk-faint">
            Off (recommended): captures a raw, untouched signal for consistent takes — auto-gain,
            noise suppression, and echo cancellation are disabled so every recording sounds the
            same. Use Clean in the clip editor afterwards for the cleanup chain. Turn on only if
            your raw mic input is unusable.
          </span>
        </span>
      </label>
      <div className="flex flex-col gap-1.5 rounded-ctl border border-rule bg-ink/60 px-2 py-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={countIn}
            disabled={isRecording || countdown != null}
            onChange={(e) => setCountIn(e.target.checked)}
          />
          <span className="text-chalk-dim">Count in 3 s before recording</span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={overTimeline}
            disabled={isRecording || countdown != null}
            onChange={(e) => setOverTimeline(e.target.checked)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-chalk-dim">Record over the timeline</span>
            <span className="text-meta leading-snug text-chalk-faint">
              Plays the scene from the playhead while you talk (other narration muted). The take
              is placed where the playhead was when recording started.
            </span>
          </span>
        </label>
      </div>
      {!previewActive ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={loading && !isRecording}
            onClick={handleRecordToggle}
            className={`rounded-ctl px-3 py-2 text-ctl font-medium w-fit disabled:cursor-not-allowed disabled:opacity-50 ${
              isRecording
                ? 'bg-danger/10 text-chalk hover:bg-danger/10'
                : 'bg-raised text-chalk hover:bg-rule'
            }`}
          >
            {isRecording
              ? `Stop recording · ${formatElapsed(elapsed)}`
              : countdown != null
                ? `Starting in ${countdown}… (click to cancel)`
                : 'Record mic'}
          </button>
          {isRecording ? (
            <div className="flex items-center gap-2" title="Input level (peak)">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink">
                <div
                  className={`h-full ${peakDb > CLIP_DB ? 'bg-danger' : peakDb > -12 ? 'bg-warn' : 'bg-highlight'}`}
                  style={{ width: `${Math.max(0, Math.min(100, ((peakDb + 60) / 60) * 100))}%` }}
                />
              </div>
              <span className="w-14 text-right text-meta tabular-nums text-chalk-faint">
                {Number.isFinite(peakDb) ? `${peakDb.toFixed(0)} dB` : '—'}
              </span>
            </div>
          ) : null}
          {clipped ? (
            <p className="rounded-ctl border border-danger/50 bg-danger/10 px-2 py-1 text-meta text-danger">
              The input clipped (peaks reached 0 dB). Lower the mic gain or move back a little and
              record again.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-ctl border border-rule bg-ink/80 p-3">
          <span className="text-chalk-dim text-meta">Preview</span>
          <audio
            ref={previewAudioRef}
            controls
            src={previewUrl ?? undefined}
            className="w-full h-9"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={loading}
              onClick={() => void approveUpload()}
              className="bg-highlight font-semibold text-highlight-ink enabled:hover:bg-highlight/90 rounded-ctl px-3 py-1.5 text-ctl disabled:opacity-50"
            >
              {loading ? 'Uploading…' : 'Add to timeline'}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={clearPendingPreview}
              className="rounded-ctl bg-raised px-3 py-1.5 text-ctl font-medium text-chalk hover:bg-rule disabled:opacity-50"
            >
              Discard
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="rounded-ctl border border-danger/50 bg-danger/10 px-2 py-1.5 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
