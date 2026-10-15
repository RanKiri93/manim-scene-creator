import type { SegmentStyle } from '@/types/scene';
import ColorPicker from '@/components/ColorPicker';
import {
  getSegmentAnimSec,
  setSegmentAnimSecAtIndex,
} from '@/lib/segmentAnimDurations';

interface SegmentEditorProps {
  segments: SegmentStyle[];
  /** Animation-only line duration; per-segment anim times sum to this. */
  animDuration: number;
  /** Per segment, from the parsed source: `he`, `en` or `math`. */
  kinds?: readonly ('he' | 'en' | 'math')[];
  onChange: (segments: SegmentStyle[]) => void;
}

const KIND_LABEL = { he: 'Hebrew', en: 'English', math: 'math' } as const;

export default function SegmentEditor({
  segments,
  animDuration,
  kinds,
  onChange,
}: SegmentEditorProps) {
  if (segments.length === 0) {
    return <p className="text-ctl text-chalk-faint italic">No segments parsed yet.</p>;
  }

  const update = (index: number, patch: Partial<SegmentStyle>) => {
    const next = segments.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      {segments.map((seg, i) => (
        <div key={i} className="flex flex-col gap-1 p-2 rounded-ctl bg-ink/40 border border-rule">
          <div className="flex items-center gap-2 text-ctl">
            <span className="text-chalk-faint font-mono w-5">#{i}</span>
            <span className={`truncate flex-1 ${seg.isMath ? 'text-kind-graph' : 'text-chalk-dim'}`}>
              {seg.isMath ? `$${seg.text}$` : seg.text}
            </span>
            <span className="text-meta text-chalk-faint">
              {kinds?.[i] ? KIND_LABEL[kinds[i]] : seg.isMath ? 'math' : 'text'}
            </span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1 text-ctl text-chalk-dim">
              <span className="text-chalk-faint shrink-0">Anim (s)</span>
              <input
                type="number"
                min={0.01}
                step={0.05}
                value={(() => {
                  const arr = getSegmentAnimSec(segments, animDuration);
                  const v = arr[i];
                  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : '';
                })()}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  onChange(setSegmentAnimSecAtIndex(segments, animDuration, i, n));
                }}
                className="w-16 rounded-ctl border border-rule bg-ink px-1 py-0.5 text-chalk text-ctl"
                title="Write/FadeIn time for this segment; others rebalance to keep total duration"
              />
            </label>
            <label className="flex items-center gap-1 text-ctl text-chalk-dim">
              <span className="text-chalk-faint shrink-0">Wait after (s)</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={seg.waitAfterSec ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    update(i, { waitAfterSec: undefined });
                    return;
                  }
                  const n = Number(raw);
                  if (!Number.isFinite(n) || n <= 0) {
                    update(i, { waitAfterSec: undefined });
                  } else {
                    update(i, { waitAfterSec: n });
                  }
                }}
                className="w-16 rounded-ctl border border-rule bg-ink px-1 py-0.5 text-chalk text-ctl"
              />
            </label>
            <ColorPicker value={seg.color} onChange={(c) => update(i, { color: c })} />
            <label className="flex items-center gap-1 text-ctl text-chalk-dim cursor-pointer">
              <input
                type="checkbox"
                checked={seg.bold}
                onChange={(e) => update(i, { bold: e.target.checked })}
                className="accent-highlight"
              />
              B
            </label>
            <label className="flex items-center gap-1 text-ctl text-chalk-dim cursor-pointer italic">
              <input
                type="checkbox"
                checked={seg.italic}
                onChange={(e) => update(i, { italic: e.target.checked })}
                className="accent-highlight"
              />
              I
            </label>
          </div>
        </div>
      ))}
    </div>
  );
}
