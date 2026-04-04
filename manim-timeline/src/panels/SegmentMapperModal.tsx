import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseSegments } from '@/codegen/texUtils';

export interface SegmentMapperModalProps {
  open: boolean;
  onClose: () => void;
  sourceRaw: string;
  targetRaw: string;
  /** target segment index -> source segment index */
  initialSegmentPairs: Record<number, number>;
  onApply: (segmentPairs: Record<number, number>) => void;
}

function pairsRecordToList(pairs: Record<number, number>): { source: number; target: number }[] {
  return Object.entries(pairs).map(([t, s]) => ({ target: Number(t), source: s }));
}

function listToPairsRecord(list: { source: number; target: number }[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const { source, target } of list) {
    out[target] = source;
  }
  return out;
}

function truncate(s: string, max: number) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export default function SegmentMapperModal({
  open,
  onClose,
  sourceRaw,
  targetRaw,
  initialSegmentPairs,
  onApply,
}: SegmentMapperModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const targetRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [paths, setPaths] = useState<string[]>([]);

  const sourceSegs = parseSegments(sourceRaw);
  const targetSegs = parseSegments(targetRaw);

  const [pairs, setPairs] = useState<{ source: number; target: number }[]>([]);
  const [dragSource, setDragSource] = useState<number | null>(null);

  const resetFromProps = useCallback(() => {
    setPairs(pairsRecordToList(initialSegmentPairs));
    setDragSource(null);
  }, [initialSegmentPairs]);

  useLayoutEffect(() => {
    if (open) resetFromProps();
  }, [open, resetFromProps]);

  useEffect(() => {
    if (!open || dragSource === null) return;
    const end = () => setDragSource(null);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [open, dragSource]);

  const recomputePaths = useCallback(() => {
    const root = containerRef.current;
    if (!root) {
      setPaths([]);
      return;
    }
    const c = root.getBoundingClientRect();
    if (c.width <= 0 || c.height <= 0) {
      setPaths([]);
      return;
    }
    const next: string[] = [];
    for (const { source, target } of pairs) {
      const elS = sourceRefs.current[source];
      const elT = targetRefs.current[target];
      if (!elS || !elT) continue;
      const s = elS.getBoundingClientRect();
      const t = elT.getBoundingClientRect();
      const x1 = s.left + s.width / 2 - c.left;
      const y1 = s.bottom - c.top;
      const x2 = t.left + t.width / 2 - c.left;
      const y2 = t.top - c.top;
      const midY = (y1 + y2) / 2;
      next.push(`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
    }
    setPaths(next);
  }, [pairs]);

  useLayoutEffect(() => {
    if (!open) return;
    recomputePaths();
    const root = containerRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => recomputePaths());
    ro.observe(root);
    return () => ro.disconnect();
  }, [open, recomputePaths, sourceSegs.length, targetSegs.length]);

  useLayoutEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => recomputePaths());
    return () => cancelAnimationFrame(id);
  }, [open, pairs, recomputePaths]);

  const onSourcePointerDown = (sourceIndex: number) => () => {
    setDragSource(sourceIndex);
  };

  const onTargetPointerUp = (targetIndex: number) => () => {
    if (dragSource === null) return;
    setPairs((prev) => [
      ...prev.filter((p) => p.target !== targetIndex),
      { source: dragSource, target: targetIndex },
    ]);
    setDragSource(null);
  };

  const handleApply = () => {
    onApply(listToPairsRecord(pairs));
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded border border-slate-600 bg-slate-900 shadow-xl"
        role="dialog"
        aria-labelledby="segment-mapper-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
          <h2 id="segment-mapper-title" className="text-sm font-medium text-slate-200">
            Segment mapping
          </h2>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div ref={containerRef} className="relative min-h-[200px] flex-1 overflow-auto p-3">
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            aria-hidden
          >
            {paths.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke="rgb(96 165 250)"
                strokeWidth={1.5}
                opacity={0.85}
              />
            ))}
          </svg>

          <div className="relative z-[1] flex flex-col gap-4">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Source</div>
              <div className="flex flex-wrap gap-1.5">
                {sourceSegs.map((seg, i) => {
                  const active = dragSource === i;
                  const mapped = pairs.some((p) => p.source === i);
                  return (
                    <button
                      key={`s-${i}`}
                      type="button"
                      ref={(el) => {
                        sourceRefs.current[i] = el;
                      }}
                      onPointerDown={onSourcePointerDown(i)}
                      className={[
                        'max-w-[140px] rounded border px-2 py-1 text-left text-xs font-mono',
                        active ? 'border-sky-400 bg-sky-950/50 text-sky-100' : 'border-slate-600 bg-slate-800 text-slate-300',
                        mapped && !active ? 'ring-1 ring-sky-700/50' : '',
                      ].join(' ')}
                      title="Drag from here to a target segment"
                    >
                      <span className="text-[10px] text-slate-500">#{i}</span>{' '}
                      {truncate(seg.text, 40)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Target</div>
              <div className="flex flex-wrap gap-1.5">
                {targetSegs.map((seg, i) => {
                  const dropActive = dragSource !== null;
                  const mapped = pairs.some((p) => p.target === i);
                  return (
                    <button
                      key={`t-${i}`}
                      type="button"
                      ref={(el) => {
                        targetRefs.current[i] = el;
                      }}
                      onPointerUp={onTargetPointerUp(i)}
                      className={[
                        'max-w-[140px] rounded border px-2 py-1 text-left text-xs font-mono',
                        dropActive ? 'border-dashed border-amber-600/80 bg-amber-950/20' : 'border-slate-600 bg-slate-800',
                        mapped ? 'ring-1 ring-amber-700/40' : '',
                        'text-slate-300',
                      ].join(' ')}
                      title={dropActive ? 'Release to map' : 'Pick a source first'}
                    >
                      <span className="text-[10px] text-slate-500">#{i}</span>{' '}
                      {truncate(seg.text, 40)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-700 px-3 py-2">
          <button
            type="button"
            className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-500"
            onClick={handleApply}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
