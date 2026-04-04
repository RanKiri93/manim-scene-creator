import type { VoiceoverConfig, AnimMode, VoiceKind } from '@/types/scene';

interface VoiceoverEditorProps {
  voice: VoiceoverConfig;
  onChange: (voice: VoiceoverConfig) => void;
}

export default function VoiceoverEditor({ voice, onChange }: VoiceoverEditorProps) {
  const set = (patch: Partial<VoiceoverConfig>) => onChange({ ...voice, ...patch });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <label className="text-xs text-slate-400">
          Mode
          <select
            value={voice.animMode}
            onChange={(e) => set({ animMode: e.target.value as AnimMode })}
            className="ml-1 bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-300"
          >
            <option value="runtime">Runtime</option>
            <option value="voiceover">Voiceover</option>
          </select>
        </label>

        <label className="text-xs text-slate-400">
          Kind
          <select
            value={voice.voiceKind}
            onChange={(e) => set({ voiceKind: e.target.value as VoiceKind })}
            className="ml-1 bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-300"
          >
            <option value="tts">TTS (gTTS)</option>
            <option value="recorder">Recorder (mic)</option>
          </select>
        </label>
      </div>

      <textarea
        value={voice.preamble}
        onChange={(e) => set({ preamble: e.target.value })}
        placeholder="Preamble narration (spoken before item appears)"
        rows={2}
        dir="rtl"
        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 resize-y"
      />

      <textarea
        value={voice.script}
        onChange={(e) => set({ script: e.target.value })}
        placeholder="Main narration script"
        rows={3}
        dir="rtl"
        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 resize-y"
      />

      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={voice.singleTakeBookmarks}
            onChange={(e) => set({ singleTakeBookmarks: e.target.checked })}
            className="accent-blue-500"
          />
          Single-take bookmarks
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={voice.mergeWithNext}
            onChange={(e) => set({ mergeWithNext: e.target.checked })}
            className="accent-blue-500"
          />
          Merge with next
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={voice.perSegmentNarration}
            onChange={(e) => set({ perSegmentNarration: e.target.checked })}
            className="accent-blue-500"
          />
          Per-segment narration
        </label>
      </div>
    </div>
  );
}
