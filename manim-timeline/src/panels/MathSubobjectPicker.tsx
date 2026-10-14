import { useEffect, useMemo, useState } from 'react';
import type { MathChildLocalBox, MeasureResult } from '@/types/scene';

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Map Manim child box (line-local, ink-aligned) to % coords over the cropped preview PNG. */
export function mathChildBoxToPercentStyle(
  box: Pick<MathChildLocalBox, 'cx' | 'cy' | 'w' | 'h'>,
  m: MeasureResult,
): { left: string; top: string; width: string; height: string } {
  const left = box.cx - box.w / 2;
  const right = box.cx + box.w / 2;
  const top = box.cy + box.h / 2;
  const bottom = box.cy - box.h / 2;
  const iw = Math.max(1e-9, m.widthInk);
  const ih = Math.max(1e-9, m.heightInk);
  const fx0 = clamp01((left - m.inkLeftX) / iw);
  const fx1 = clamp01((right - m.inkLeftX) / iw);
  const fy0 = clamp01((m.inkTopY - top) / ih);
  const fy1 = clamp01((m.inkTopY - bottom) / ih);
  return {
    left: `${fx0 * 100}%`,
    top: `${fy0 * 100}%`,
    width: `${Math.max(0.2, (fx1 - fx0) * 100)}%`,
    height: `${Math.max(0.2, (fy1 - fy0) * 100)}%`,
  };
}

export interface MathSubobjectPickerProps {
  open: boolean;
  onClose: () => void;
  measure: MeasureResult | null;
  previewDataUrl: string | null;
  segmentIndex: number;
  mathChildMeasures: MathChildLocalBox[] | null;
  initialSelected: number[];
  onApply: (childIndices: number[]) => void;
}

export default function MathSubobjectPicker({
  open,
  onClose,
  measure,
  previewDataUrl,
  segmentIndex,
  mathChildMeasures,
  initialSelected,
  onApply,
}: MathSubobjectPickerProps) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  const initKey = initialSelected.join(',');

  useEffect(() => {
    if (open) setSelected(new Set(initialSelected));
  }, [open, segmentIndex, initKey]);

  const boxes = useMemo(
    () =>
      (mathChildMeasures ?? []).filter((b) => b.segmentIndex === segmentIndex),
    [mathChildMeasures, segmentIndex],
  );

  if (!open) return null;

  const canPick = Boolean(measure && previewDataUrl && boxes.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div className="bg-ink border border-rule rounded-pop max-w-2xl w-full max-h-[90vh] overflow-auto p-4 shadow-xl">
        <h4 className="text-body font-semibold text-chalk mb-1">
          Pick Manim-rendered math pieces
        </h4>
        <p className="text-meta text-chalk-dim mb-3 leading-snug">
          These boxes are <strong className="text-chalk-dim">Manim subobjects</strong>, not LaTeX
          structure. Indices match export{' '}
          <code className="text-chalk-dim">line[{segmentIndex}][n]</code>.
        </p>
        {!canPick ? (
          <p className="text-ctl text-warn leading-snug">
            No clickable boxes for this segment. Ensure the measure server is running and
            remeasure this line (preview PNG + measurement).
          </p>
        ) : (
          <>
            <div className="relative inline-block max-w-full border border-rule bg-ink rounded-ctl">
              <img
                src={previewDataUrl!}
                alt="Line preview"
                className="block max-w-full h-auto"
                draggable={false}
              />
              {boxes.map((b) => {
                const st = mathChildBoxToPercentStyle(b, measure!);
                const on = selected.has(b.childIndex);
                return (
                  <button
                    key={b.childIndex}
                    type="button"
                    onClick={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(b.childIndex)) next.delete(b.childIndex);
                        else next.add(b.childIndex);
                        return next;
                      })
                    }
                    title={`Manim subobject #${b.childIndex}`}
                    className={`absolute box-border rounded-sm border-2 transition-colors cursor-pointer ${
                      on
                        ? 'border-highlight/60 bg-raised'
                        : 'border-chalk/50 bg-transparent hover:bg-rule'
                    }`}
                    style={st}
                  >
                    <span className="absolute left-0.5 top-0 text-meta leading-none text-chalk drop-shadow px-0.5 rounded-ctl bg-ink/40 pointer-events-none">
                      #{b.childIndex}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-3 mt-3 text-meta">
              <button
                type="button"
                className="text-chalk hover:text-chalk underline"
                onClick={() => setSelected(new Set(boxes.map((x) => x.childIndex)))}
              >
                Select all pieces
              </button>
              <button
                type="button"
                className="text-chalk-dim hover:text-chalk-dim underline"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            className="text-ctl px-3 py-1.5 rounded-ctl bg-raised text-chalk hover:bg-rule"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="text-ctl px-3 py-1.5 rounded-ctl bg-raised text-chalk hover:bg-rule disabled:opacity-40"
            disabled={!canPick}
            onClick={() => {
              onApply([...selected].sort((a, b) => a - b));
              onClose();
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
