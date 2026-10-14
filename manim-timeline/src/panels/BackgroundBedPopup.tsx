import { useRef, useState } from 'react';
import FloatingPanel from '@/components/FloatingPanel';
import { useSceneStore } from '@/store/useSceneStore';
import type { AudioBedKind } from '@/types/scene';
import type { BedNoiseColor } from '@/services/measureClient';

function recordingFilenameFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('ogg')) return 'roomtone.ogg';
  if (m.includes('wav')) return 'roomtone.wav';
  return 'roomtone.webm';
}

function bedKindLabel(kind: AudioBedKind): string {
  if (kind === 'music') return 'Music';
  if (kind === 'roomtone') return 'Room tone';
  return 'Generated noise';
}

type SourceTab = 'upload' | 'record' | 'noise';

export function BackgroundBedEditor() {
  const audioBed = useSceneStore((s) => s.audioBed);
  const defaults = useSceneStore((s) => s.defaults);
  const uploadAudioBed = useSceneStore((s) => s.uploadAudioBed);
  const generateAudioBedNoise = useSceneStore((s) => s.generateAudioBedNoise);
  const removeAudioBed = useSceneStore((s) => s.removeAudioBed);
  const setAudioBedGain = useSceneStore((s) => s.setAudioBedGain);
  const setCutFadeDefault = useSceneStore((s) => s.setCutFadeDefault);

  const bedFileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceTab, setSourceTab] = useState<SourceTab>('upload');
  const [noiseColor, setNoiseColor] = useState<BedNoiseColor>('pink');
  const [noiseDuration, setNoiseDuration] = useState(8);
  const [noiseLevelDb, setNoiseLevelDb] = useState(-40);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const cutFadeMs = defaults.audioCutFadeMs ?? 40;

  const uploadBed = async (blob: Blob, kind: AudioBedKind, filename: string) => {
    setError(null);
    setBusy(true);
    try {
      await uploadAudioBed(blob, {
        kind,
        filename,
        gainDb: audioBed?.gainDb ?? -24,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onMusicChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await uploadBed(file, 'music', file.name);
  };

  const stopRoomToneRecording = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  };

  const startRoomToneRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          noiseSuppression: false,
          echoCancellation: false,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        const mime = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        await uploadBed(blob, 'roomtone', recordingFilenameFromMime(mime));
      };
      rec.start();
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onGenerateNoise = async () => {
    setError(null);
    setBusy(true);
    try {
      await generateAudioBedNoise({
        color: noiseColor,
        durationSec: noiseDuration,
        levelDb: noiseLevelDb,
        gainDb: audioBed?.gainDb ?? -24,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-ctl text-chalk-dim p-1">
      <p className="text-meta text-chalk-faint leading-snug">
        Post-production background bed: looped under narration at export. Spans the full scene on
        the Bed lane. Not audible in timeline preview yet.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-chalk-dim">Cut fade default (ms)</span>
        <input
          type="number"
          min={0}
          max={500}
          step={5}
          value={cutFadeMs}
          onChange={(e) => setCutFadeDefault(Number(e.target.value))}
          className="w-24 rounded-ctl border border-rule bg-ink px-2 py-1 text-chalk"
          title="Fade-in/out at narration cut boundaries during export"
        />
        <span className="text-meta text-chalk-faint">Typical: 20–80 ms.</span>
      </label>

      {audioBed ? (
        <div className="rounded-ctl border border-rule bg-ink/70 p-2 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-chalk-dim">Active: {bedKindLabel(audioBed.kind)}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => removeAudioBed()}
              className="rounded-ctl bg-raised px-2 py-1 text-meta text-chalk hover:bg-rule disabled:opacity-50"
            >
              Remove
            </button>
          </div>
          <audio controls src={audioBed.audioUrl} className="w-full h-8" />
          <label className="flex items-center gap-2">
            <span className="text-chalk-dim shrink-0">Mix gain (dB)</span>
            <input
              type="range"
              min={-48}
              max={0}
              step={1}
              value={audioBed.gainDb}
              onChange={(e) => setAudioBedGain(Number(e.target.value))}
              className="flex-1"
            />
            <span className="font-mono text-meta w-8 text-right">{audioBed.gainDb}</span>
          </label>
        </div>
      ) : null}

      <div className="flex rounded-ctl border border-rule overflow-hidden text-meta">
        {(
          [
            ['upload', 'Upload'],
            ['record', 'Record'],
            ['noise', 'Generate'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            disabled={busy || recording}
            onClick={() => setSourceTab(id)}
            className={`flex-1 px-2 py-1.5 font-medium transition-colors ${
              sourceTab === id
                ? 'bg-raised text-chalk ring-1 ring-highlight/50 ring-inset'
                : 'bg-raised text-chalk-dim hover:text-chalk'
            } disabled:opacity-50`}
          >
            {label}
          </button>
        ))}
      </div>

      {sourceTab === 'upload' ? (
        <div className="flex flex-col gap-2">
          <input
            ref={bedFileRef}
            type="file"
            accept="audio/*,.webm,.wav,.mp3,.m4a,.ogg,.flac,.opus,.aac"
            className="hidden"
            onChange={(e) => void onMusicChosen(e)}
          />
          <button
            type="button"
            disabled={busy || recording}
            onClick={() => bedFileRef.current?.click()}
            className="bg-highlight font-semibold text-highlight-ink enabled:hover:bg-highlight/90 rounded-ctl px-3 py-1.5 text-ctl disabled:opacity-50 w-fit"
          >
            {busy ? 'Uploading…' : 'Choose music file…'}
          </button>
        </div>
      ) : null}

      {sourceTab === 'record' ? (
        <div className="flex flex-col gap-2">
          <p className="text-meta text-chalk-faint">
            Record 30–60 s of room silence for a natural noise floor under cuts.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => (recording ? stopRoomToneRecording() : void startRoomToneRecording())}
            className={`rounded-ctl px-3 py-1.5 text-ctl font-medium disabled:opacity-50 w-fit ${
              recording
                ? 'bg-danger/10 text-chalk hover:bg-danger/10'
                : 'bg-raised text-chalk hover:bg-rule'
            }`}
          >
            {recording ? 'Stop recording' : 'Record room tone'}
          </button>
        </div>
      ) : null}

      {sourceTab === 'noise' ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-chalk-dim">Color</span>
            <select
              value={noiseColor}
              onChange={(e) => setNoiseColor(e.target.value as BedNoiseColor)}
              className="rounded-ctl border border-rule bg-ink px-2 py-1 text-chalk"
            >
              <option value="pink">Pink (room-like)</option>
              <option value="brown">Brown (deeper)</option>
              <option value="white">White (bright hiss)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-chalk-dim">Clip length (s)</span>
            <input
              type="number"
              min={1}
              max={30}
              step={1}
              value={noiseDuration}
              onChange={(e) => setNoiseDuration(Number(e.target.value))}
              className="w-20 rounded-ctl border border-rule bg-ink px-2 py-1 text-chalk"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-chalk-dim">Source level (dB)</span>
            <input
              type="number"
              min={-80}
              max={0}
              step={1}
              value={noiseLevelDb}
              onChange={(e) => setNoiseLevelDb(Number(e.target.value))}
              className="w-20 rounded-ctl border border-rule bg-ink px-2 py-1 text-chalk"
            />
          </label>
          <button
            type="button"
            disabled={busy || recording}
            onClick={() => void onGenerateNoise()}
            className="bg-highlight font-semibold text-highlight-ink enabled:hover:bg-highlight/90 rounded-ctl px-3 py-1.5 text-ctl disabled:opacity-50 w-fit"
          >
            {busy ? 'Generating…' : 'Generate noise bed'}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-ctl border border-danger/50 bg-danger/10 px-2 py-1.5 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type BackgroundBedPopupProps = {
  onClose: () => void;
};

export default function BackgroundBedPopup({ onClose }: BackgroundBedPopupProps) {
  return (
    <FloatingPanel title="Background bed" onClose={onClose} defaultSize={{ w: 380, h: 480 }}>
      <BackgroundBedEditor />
    </FloatingPanel>
  );
}
