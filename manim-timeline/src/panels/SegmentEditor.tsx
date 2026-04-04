import type { SegmentStyle } from '@/types/scene';
import ColorPicker from '@/components/ColorPicker';

interface SegmentEditorProps {
  segments: SegmentStyle[];
  onChange: (segments: SegmentStyle[]) => void;
}

export default function SegmentEditor({ segments, onChange }: SegmentEditorProps) {
  if (segments.length === 0) {
    return <p className="text-xs text-slate-500 italic">No segments parsed yet.</p>;
  }

  const update = (index: number, patch: Partial<SegmentStyle>) => {
    const next = segments.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      {segments.map((seg, i) => (
        <div key={i} className="flex flex-col gap-1 p-2 rounded bg-slate-800/50 border border-slate-700">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-mono w-5">#{i}</span>
            <span className={`truncate flex-1 ${seg.isMath ? 'text-cyan-400' : 'text-slate-300'}`}>
              {seg.isMath ? `$${seg.text}$` : seg.text}
            </span>
            <span className="text-[9px] text-slate-500">{seg.isMath ? 'math' : 'text'}</span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <ColorPicker value={seg.color} onChange={(c) => update(i, { color: c })} />
            <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={seg.bold}
                onChange={(e) => update(i, { bold: e.target.checked })}
                className="accent-blue-500"
              />
              B
            </label>
            <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer italic">
              <input
                type="checkbox"
                checked={seg.italic}
                onChange={(e) => update(i, { italic: e.target.checked })}
                className="accent-blue-500"
              />
              I
            </label>
          </div>

          <input
            type="text"
            value={seg.voiceText}
            onChange={(e) => update(i, { voiceText: e.target.value })}
            placeholder="Segment narration (optional)"
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300"
            dir="rtl"
          />
        </div>
      ))}
    </div>
  );
}
