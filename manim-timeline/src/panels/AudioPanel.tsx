import { useRef, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { AudioPanelMode } from '@/store/useSceneStore';

type AudioPanelProps = {
  mode: AudioPanelMode;
};

export default function AudioPanel({ mode }: AudioPanelProps) {
  const [script, setScript] = useState('');
  const [lang, setLang] = useState<'iw' | 'en'>('iw');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const chunksRef = useRef<BlobPart[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const addAudioItem = useSceneStore((s) => s.addAudioItem);
  const addRecordedAudioTrack = useSceneStore((s) => s.addRecordedAudioTrack);

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
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        const mime = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        setIsRecording(false);
        setLoading(true);
        try {
          await addRecordedAudioTrack(blob);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setLoading(false);
        }
      };
      rec.start();
      setIsRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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
        <div className="flex items-center gap-3">
          <span className="text-slate-400 shrink-0">Language</span>
          <div className="flex rounded border border-slate-600 overflow-hidden">
            <button
              type="button"
              disabled={loading}
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
              disabled={loading}
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

  return (
    <div className="flex flex-col gap-3 text-xs text-slate-300">
      <label className="flex flex-col gap-1">
        <span className="text-slate-400">Script</span>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={8}
          spellCheck={false}
          className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          placeholder="Script to read while recording…"
        />
      </label>
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
        {isRecording ? 'Stop Recording' : 'Record Mic'}
      </button>
      {error && (
        <p className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1.5 text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
