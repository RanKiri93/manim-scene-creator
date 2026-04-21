import { useMemo } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type {
  PosStep,
  PosStepNextTo,
  PosStepToEdge,
  PosStepShift,
  ManimDirection,
  ItemId,
  SceneItem,
  NextToBoundsMode,
} from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import { itemClipDisplayName } from '@/lib/itemDisplayName';

const DIRECTIONS: ManimDirection[] = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'UL', 'UR', 'DL', 'DR'];
const EDGE_DIRECTIONS: ManimDirection[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

const STEP_KINDS = [
  { value: 'absolute', label: 'Absolute (x, y)' },
  { value: 'next_to', label: 'next_to (relative)' },
  { value: 'to_edge', label: 'to_edge (frame edge)' },
  { value: 'shift', label: 'shift (offset)' },
  { value: 'set_x', label: 'set_x (pin X axis)' },
  { value: 'set_y', label: 'set_y (pin Y axis)' },
] as const;

function makeDefaultStep(kind: string): PosStep {
  switch (kind) {
    case 'next_to':
      return {
        kind: 'next_to',
        refKind: 'line',
        refId: null,
        dir: 'DOWN',
        buff: 0.3,
        alignedEdge: null,
        refSegmentIndex: null,
        selfSegmentIndex: null,
        bounds: null,
      };
    case 'to_edge': return { kind: 'to_edge', edge: 'UP', buff: 0.3 };
    case 'shift':   return { kind: 'shift', dx: 0, dy: 0 };
    case 'set_x':   return { kind: 'set_x', x: 0 };
    case 'set_y':   return { kind: 'set_y', y: 0 };
    default:        return { kind: 'absolute' };
  }
}

interface PositionStepsEditorProps {
  steps: PosStep[];
  onChange: (steps: PosStep[]) => void;
  currentItemId: ItemId;
}

export default function PositionStepsEditor({ steps, onChange, currentItemId }: PositionStepsEditorProps) {
  const itemsMap = useSceneStore((s) => s.items);

  const otherItems = useMemo(() => {
    const result: { id: ItemId; label: string; kind: SceneItem['kind'] }[] = [];
    for (const [id, item] of itemsMap) {
      if (id === currentItemId) continue;
      if (
        item.kind !== 'textLine' &&
        item.kind !== 'axes' &&
        item.kind !== 'shape'
      ) {
        continue;
      }
      const label = itemClipDisplayName(item);
      result.push({ id, label, kind: item.kind });
    }
    return result.sort((a, b) => a.label.localeCompare(b.label));
  }, [itemsMap, currentItemId]);

  const update = (index: number, newStep: PosStep) => {
    onChange(steps.map((s, i) => (i === index ? newStep : s)));
  };

  const remove = (index: number) => {
    const next = steps.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [{ kind: 'absolute' }]);
  };

  const add = () => {
    onChange([
      ...steps,
      {
        kind: 'next_to',
        refKind: 'line',
        refId: null,
        dir: 'DOWN',
        buff: 0.3,
        alignedEdge: null,
        refSegmentIndex: null,
        selfSegmentIndex: null,
        bounds: null,
      },
    ]);
  };

  const changeKind = (index: number, newKind: string) => {
    update(index, makeDefaultStep(newKind));
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const next = [...steps];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  };

  const moveDown = (index: number) => {
    if (index >= steps.length - 1) return;
    const next = [...steps];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      {steps.map((step, i) => (
        <div key={i} className="flex flex-col gap-1.5 p-2 rounded bg-slate-800/60 border border-slate-700">
          {/* Header: kind selector + controls */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-500 w-4">{i + 1}</span>
            <select
              value={step.kind}
              onChange={(e) => changeKind(i, e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-300"
            >
              {STEP_KINDS.map((sk) => (
                <option key={sk.value} value={sk.value}>{sk.label}</option>
              ))}
            </select>
            <button onClick={() => moveUp(i)} disabled={i === 0} className="text-slate-500 hover:text-slate-300 disabled:opacity-30 text-xs px-1" title="Move up">^</button>
            <button onClick={() => moveDown(i)} disabled={i >= steps.length - 1} className="text-slate-500 hover:text-slate-300 disabled:opacity-30 text-xs px-1" title="Move down">v</button>
            <button onClick={() => remove(i)} className="text-slate-500 hover:text-red-400 text-xs px-1" title="Remove">x</button>
          </div>

          {/* Step-specific fields */}
          {step.kind === 'absolute' && (
            <p className="text-[10px] text-slate-500 italic">Uses the item's absolute X, Y position.</p>
          )}

          {step.kind === 'next_to' && (
            <NextToFields
              step={step}
              otherItems={otherItems}
              currentItemId={currentItemId}
              onChange={(s) => update(i, s)}
            />
          )}

          {step.kind === 'to_edge' && (
            <ToEdgeFields step={step} onChange={(s) => update(i, s)} />
          )}

          {step.kind === 'shift' && (
            <ShiftFields step={step} onChange={(s) => update(i, s)} />
          )}

          {step.kind === 'set_x' && (
            <div className="flex items-center gap-2">
              <NumberInput label="X" value={step.x} onChange={(v) => update(i, { ...step, x: v })} step={0.1} />
            </div>
          )}

          {step.kind === 'set_y' && (
            <div className="flex items-center gap-2">
              <NumberInput label="Y" value={step.y} onChange={(v) => update(i, { ...step, y: v })} step={0.1} />
            </div>
          )}
        </div>
      ))}

      <button
        onClick={add}
        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
      >
        + Add positioning step
      </button>
    </div>
  );
}

// ── Step-specific sub-forms ──

function NextToFields({
  step,
  otherItems,
  currentItemId,
  onChange,
}: {
  step: PosStepNextTo;
  otherItems: { id: ItemId; label: string; kind: SceneItem['kind'] }[];
  currentItemId: ItemId;
  onChange: (s: PosStepNextTo) => void;
}) {
  const itemsMap = useSceneStore((s) => s.items);
  const refItem = step.refId ? itemsMap.get(step.refId) : undefined;
  const selfItem = itemsMap.get(currentItemId);
  const refSegCount =
    refItem?.kind === 'textLine' ? refItem.segments.length : 0;
  const selfSegCount =
    selfItem?.kind === 'textLine' ? selfItem.segments.length : 0;
  const dirIsDiagonal = ['UL', 'UR', 'DL', 'DR'].includes(step.dir);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[10px] text-slate-400">
          Ref
          <select
            value={step.refId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null;
              const match = otherItems.find((it) => it.id === id);
              const refKind =
                match?.kind === 'axes'
                  ? ('axes' as const)
                  : match?.kind === 'shape'
                    ? ('shape' as const)
                    : ('line' as const);
              onChange({
                ...step,
                refId: id,
                refKind,
                refSegmentIndex: null,
              });
            }}
            className="ml-1 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-slate-300 max-w-[140px]"
          >
            <option value="">-- select item --</option>
            {otherItems.map((it) => (
              <option key={it.id} value={it.id}>
                {it.kind === 'textLine'
                  ? '[T]'
                  : it.kind === 'axes'
                    ? '[A]'
                    : it.kind === 'shape'
                      ? '[S]'
                      : '[?]'}{' '}
                {it.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-[10px] text-slate-400">
          Dir
          <select
            value={step.dir}
            onChange={(e) =>
              onChange({ ...step, dir: e.target.value as ManimDirection })}
            className="ml-1 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-slate-300"
          >
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="text-[10px] text-slate-400 flex items-center gap-1 flex-wrap">
        Align edge
        <select
          value={step.alignedEdge ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange({
              ...step,
              alignedEdge: v ? (v as ManimDirection) : null,
            });
          }}
          disabled={dirIsDiagonal}
          className="ml-1 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-slate-300 disabled:opacity-40"
        >
          <option value="">Center (default)</option>
          {EDGE_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {dirIsDiagonal && (
          <span className="text-slate-500 italic">Diagonal dir: use center only</span>
        )}
      </label>

      {refSegCount > 0 && (
        <label className="text-[10px] text-slate-400 flex items-center gap-1">
          Ref segment
          <select
            value={step.refSegmentIndex ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                ...step,
                refSegmentIndex: v === '' ? null : Number(v),
              });
            }}
            className="ml-1 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-slate-300"
          >
            <option value="">Whole line</option>
            {Array.from({ length: refSegCount }, (_, j) => (
              <option key={j} value={j}>
                #{j}
              </option>
            ))}
          </select>
        </label>
      )}

      {selfSegCount > 0 && (
        <label className="text-[10px] text-slate-400 flex items-center gap-1">
          Self segment
          <select
            value={step.selfSegmentIndex ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                ...step,
                selfSegmentIndex: v === '' ? null : Number(v),
              });
            }}
            className="ml-1 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-slate-300"
          >
            <option value="">Whole line</option>
            {Array.from({ length: selfSegCount }, (_, j) => (
              <option key={j} value={j}>
                #{j}
              </option>
            ))}
          </select>
        </label>
      )}

      {selfItem?.kind === 'textLine' && (
        <label className="text-[10px] text-slate-400 flex items-center gap-1 flex-wrap">
          Bounds
          <select
            value={step.bounds ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                ...step,
                bounds: v === '' ? null : (v as NextToBoundsMode),
              });
            }}
            className="ml-1 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-slate-300"
          >
            <option value="">Legacy (preview hybrid)</option>
            <option value="mobject">VGroup bbox (matches Manim)</option>
            <option value="ink">Tight ink + corrective shift</option>
          </select>
        </label>
      )}

      <NumberInput
        label="Buff"
        value={step.buff}
        onChange={(v) => onChange({ ...step, buff: v })}
        min={0}
        step={0.05}
      />
    </div>
  );
}

function ToEdgeFields({
  step,
  onChange,
}: {
  step: PosStepToEdge;
  onChange: (s: PosStepToEdge) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="text-[10px] text-slate-400">
        Edge
        <select
          value={step.edge}
          onChange={(e) => onChange({ ...step, edge: e.target.value as ManimDirection })}
          className="ml-1 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-slate-300"
        >
          {EDGE_DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>
      <NumberInput label="Buff" value={step.buff} onChange={(v) => onChange({ ...step, buff: v })} min={0} step={0.05} />
    </div>
  );
}

function ShiftFields({
  step,
  onChange,
}: {
  step: PosStepShift;
  onChange: (s: PosStepShift) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <NumberInput label="dx" value={step.dx} onChange={(v) => onChange({ ...step, dx: v })} step={0.1} />
      <NumberInput label="dy" value={step.dy} onChange={(v) => onChange({ ...step, dy: v })} step={0.1} />
    </div>
  );
}
