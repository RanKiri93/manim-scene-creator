import { useRef, useState, useEffect } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { AudioPanelMode } from '@/store/useSceneStore';

type AudioPanelProps = {
  mode: AudioPanelMode;
};

function recordingFilenameFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('ogg')) return 'recording.ogg';
  if (m.includes('mp4') || m.includes('m4a')) return 'recording.m4a';
  if (m.includes('wav')) return 'recording.wav';
  return 'recording.webm';
}

function LangToggle(props: {
  lang: 'iw' | 'en';
  setLang: (l: 'iw' | 'en') => void;
  disabled?: boolean;
  label?: string;
}) {
  const { lang, setLang, disabled, label = 'Language' } = props;
  return (
    <div className="flex items-center gap-3">
      <span className="text-slate-400 shrink-0">{label}</span>
      <div className="flex rounded border border-slate-600 overflow-hidden">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setLang('iw')}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            lang === 'iw'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
          } disabled:opacity-50`}
        >
          Hebrew (iw)
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setLang('en')}
          className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-slate-600 ${
            lang === 'en'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
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
  const [lang, setLang] = useState<'iw' | 'en'>('iw');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const chunksRef = useRef<BlobPart[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const addAudioItem = useSceneStore((s) => s.addAudioItem);
  const addRecordedAudioTrack = useSceneStore((s) => s.addRecordedAudioTrack);

  /** File chosen locally; upload runs only after Approve. */
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  /** Mic capture waiting for Approve. */
  const [pendingRecord, setPendingRecord] = useState<{
    blob: Blob;
    filename: string;
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

  const setPreviewFromBlob = (blob: Blob, filename: string) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(null);
    setPendingRecord({ blob, filename });
    setPreviewUrl(URL.createObjectURL(blob));
  };

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
        displayText: script,
        filename,
        emptyLabel: file ? 'Uploaded audio' : 'Mic recording',
        transcriptionLang: lang,
      });
      clearPendingPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRecordToggle = async () => {
    if (isRecording) {
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        rec.stop();
      }
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        const mime = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        setIsRecording(false);
        setPreviewFromBlob(blob, recordingFilenameFromMime(mime));
      };
      rec.start();
      setIsRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const previewActive = Boolean(previewUrl && (pendingFile || pendingRecord));

  if (mode === 'tts') {
    return (
      <div className="flex flex-col gap-3 text-xs text-slate-300">
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">Script</span>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={8}
            spellCheck={false}
            disabled={loading}
            className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
            placeholder="Text to synthesize…"
          />
        </label>
        <LangToggle lang={lang} setLang={setLang} disabled={loading} />
        <button
          type="button"
          disabled={loading || !script.trim()}
          onClick={() => void handleGenerate()}
          className="rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 w-fit"
        >
          {loading ? 'Generating…' : 'Generate Audio Track'}
        </button>
        {error && (
          <p className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1.5 text-red-300">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (mode === 'upload') {
    return (
      <div className="flex flex-col gap-3 text-xs text-slate-300">
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">Script / label (stored on the track)</span>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={6}
            spellCheck={false}
            disabled={loading}
            className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
            placeholder="Narration for this recording…"
          />
        </label>
        <LangToggle
          lang={lang}
          setLang={setLang}
          disabled={loading}
          label="Transcription"
        />
        <p className="text-[10px] text-slate-500 leading-snug">
          Whisper / word timings use this language when the server supports it.
        </p>
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
            className="rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 w-fit"
          >
            Choose audio file…
          </button>
        ) : (
          <div className="flex flex-col gap-2 rounded border border-slate-600 bg-slate-900/80 p-3">
            <span className="text-slate-400 text-[11px]">Preview</span>
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
                className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {loading ? 'Uploading…' : 'Add to timeline'}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={clearPendingPreview}
                className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1.5 text-red-300">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-xs text-slate-300">
      <label className="flex flex-col gap-1">
        <span className="text-slate-400">Script to read while recording</span>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={6}
          spellCheck={false}
          disabled={loading && !isRecording}
          className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          placeholder="Script to read while recording…"
        />
      </label>
      <LangToggle
        lang={lang}
        setLang={setLang}
        disabled={loading && !isRecording}
        label="Transcription"
      />
      {!previewActive ? (
        <button
          type="button"
          disabled={loading && !isRecording}
          onClick={() => void handleRecordToggle()}
          className={`rounded px-3 py-2 text-xs font-medium w-fit disabled:cursor-not-allowed disabled:opacity-50 ${
            isRecording
              ? 'bg-red-600 text-white hover:bg-red-500'
              : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
          }`}
        >
          {isRecording ? 'Stop recording' : 'Record mic'}
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded border border-slate-600 bg-slate-900/80 p-3">
          <span className="text-slate-400 text-[11px]">Preview</span>
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
              className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {loading ? 'Uploading…' : 'Add to timeline'}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={clearPendingPreview}
              className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
            >
              Discard
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1.5 text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
