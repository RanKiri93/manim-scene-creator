import { useEffect, useMemo, useRef, useState } from 'react';
import FloatingPanel from '@/components/FloatingPanel';
import { splitScriptLines } from '@/lib/prompter';

/**
 * Large-type script prompter shown while recording narration. The current line is bright, the
 * next ones dim; ↓ / Page Down / Enter (or a click on a line) moves on, ↑ goes back.
 */
export default function Prompter({ script, onClose }: { script: string; onClose: () => void }) {
  const lines = useMemo(() => splitScriptLines(script), [script]);
  const [at, setAt] = useState(0);
  const [size, setSize] = useState(28);
  const currentRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'Enter') {
        e.preventDefault();
        setAt((i) => Math.min(lines.length - 1, i + 1));
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        setAt((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lines.length]);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [at]);

  return (
    <FloatingPanel title="Prompter" onClose={onClose} defaultSize={{ w: 560, h: 360 }}>
      <div className="flex h-full flex-col gap-2">
        <div className="flex items-center gap-2 text-meta text-chalk-faint">
          <span>
            Line {Math.min(at + 1, lines.length)} of {lines.length} · ↓ / Enter next, ↑ back
          </span>
          <label className="ml-auto flex items-center gap-1">
            Size
            <input type="range" min={18} max={48} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto rounded-ctl bg-ink p-3" dir="auto">
          {lines.map((line, i) => (
            <p
              key={i}
              ref={i === at ? currentRef : undefined}
              onClick={() => setAt(i)}
              className={`cursor-pointer py-1 leading-snug ${i === at ? 'text-chalk' : i < at ? 'text-chalk-faint/50' : 'text-chalk-faint'}`}
              style={{ fontSize: `${size}px` }}
            >
              {line}
            </p>
          ))}
        </div>
      </div>
    </FloatingPanel>
  );
}
