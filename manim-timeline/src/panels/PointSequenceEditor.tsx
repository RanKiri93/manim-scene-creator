import { useCallback, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type {
  GraphPointSequenceItem,
  FunctionSeriesMode,
  PointSequenceDefaults,
} from '@/types/scene';
import {
  pointSequenceHasErrors,
  pointSequenceIndices,
} from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import AxesIdSelect from './AxesIdSelect';
import AudioBindingSelect from './AudioBindingSelect';
import PointSequenceIndividualPanel from './PointSequenceIndividualPanel';
import PropertyTabs from './PropertyTabs';
import VisibleAtSceneStartRow from './VisibleAtSceneStartRow';
import { GraphFieldHelpIcon } from './GraphFieldExpressionHelp';

const CURVE_JS_HELP =
  'JavaScript preview: use variable n (integer index). Use Math.sin/Math.cos; ** for power.';
const CURVE_PY_HELP =
  'Python export: NumPy as np; variable n. Use ** for power (never ^).';

interface PointSequenceEditorProps {
  item: GraphPointSequenceItem;
}

export default function PointSequenceEditor({ item }: PointSequenceEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const setItemAudioBinding = useSceneStore((s) => s.setItemAudioBinding);
  const axesFor = useSceneStore((s) => s.items.get(item.axesId));

  const [individualOpen, setIndividualOpen] = useState(false);
  const [focusedN, setFocusedN] = useState<number | null>(null);

  const set = useCallback(
    (patch: Partial<GraphPointSequenceItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const patchDefaults = useCallback(
    (patch: Partial<PointSequenceDefaults>) =>
      set({ defaults: { ...item.defaults, ...patch } }),
    [item.defaults, set],
  );

  const indices = pointSequenceIndices(item);
  const hasErrors = pointSequenceHasErrors(item);
  const perNErrorEntries = item.perNErrors
    ? Object.entries(item.perNErrors).filter(([, v]) => v)
    : [];

  const openIndividualFor = (n: number | null) => {
    setFocusedN(n);
    setIndividualOpen(true);
  };

  const baseContent = (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Point sequence</h3>

      <label className="text-xs text-slate-400 block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. sequence on unit circle"
          className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>

      <AxesIdSelect value={item.axesId} onChange={(axesId) => set({ axesId })} />

      {hasErrors && (
        <div className="rounded border border-red-700 bg-red-900/30 px-2 py-2 text-xs text-red-200 space-y-1">
          <div className="font-semibold">
            Playback of this object is disabled until errors are resolved.
          </div>
          {item.topLevelError && (
            <div className="text-red-300">• {item.topLevelError}</div>
          )}
          {perNErrorEntries.length > 0 && (
            <div className="text-red-400">
              {perNErrorEntries.length} per-n issue
              {perNErrorEntries.length === 1 ? '' : 's'} — open the Graph tab.
            </div>
          )}
        </div>
      )}
    </div>
  );

  const graphContent = (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-slate-600 bg-slate-800/30 px-2 py-2">
        <div className="text-xs text-slate-400 mb-1">Coordinates (variable: n)</div>
        <p className="mt-2 text-[11px] leading-snug text-slate-500">
          JavaScript drives the canvas preview; Python (NumPy) drives export. One point per
          integer n in [n_min, n_max].
        </p>

        <div className="mt-3 text-xs font-medium text-slate-300">x(n)</div>
        <div className="mt-2 flex items-center gap-1 text-xs text-slate-400">
          <span>Preview (JavaScript)</span>
          <GraphFieldHelpIcon title={CURVE_JS_HELP} label="Help: JS x(n)" />
        </div>
        <input
          type="text"
          value={item.jsXExpr}
          onChange={(e) => set({ jsXExpr: e.target.value })}
          placeholder="JS: n"
          className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
        />
        <div className="mt-2 flex items-center gap-1 text-xs text-slate-400">
          <span>Export (Python)</span>
          <GraphFieldHelpIcon title={CURVE_PY_HELP} label="Help: Py x(n)" />
        </div>
        <input
          type="text"
          value={item.pyXExpr}
          onChange={(e) => set({ pyXExpr: e.target.value })}
          placeholder="Python: n"
          className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
        />

        <div className="mt-3 text-xs font-medium text-slate-300">y(n)</div>
        <div className="mt-2 flex items-center gap-1 text-xs text-slate-400">
          <span>Preview (JavaScript)</span>
          <GraphFieldHelpIcon title={CURVE_JS_HELP} label="Help: JS y(n)" />
        </div>
        <input
          type="text"
          value={item.jsYExpr}
          onChange={(e) => set({ jsYExpr: e.target.value })}
          placeholder="JS: 0"
          className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
        />
        <div className="mt-2 flex items-center gap-1 text-xs text-slate-400">
          <span>Export (Python)</span>
          <GraphFieldHelpIcon title={CURVE_PY_HELP} label="Help: Py y(n)" />
        </div>
        <input
          type="text"
          value={item.pyYExpr}
          onChange={(e) => set({ pyYExpr: e.target.value })}
          placeholder="Python: 0"
          className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
        />
      </div>

      <div className="rounded border border-slate-600 bg-slate-800/40 px-2 py-2 space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">
          Range (integers)
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <NumberInput
            label="n min"
            value={item.nMin}
            onChange={(v) => set({ nMin: Math.trunc(v) })}
            step={1}
          />
          <NumberInput
            label="n max"
            value={item.nMax}
            onChange={(v) => set({ nMax: Math.trunc(v) })}
            step={1}
          />
          <span className="text-[11px] text-slate-500">
            {indices.length} {indices.length === 1 ? 'point' : 'points'}
          </span>
        </div>
      </div>

      <div className="rounded border border-slate-600 bg-slate-800/40 px-2 py-2 space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">
          Playback mode
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={item.mode === 'accumulation'}
            onChange={(e) => {
              const mode = (e.target.checked
                ? 'accumulation'
                : 'replacement') as FunctionSeriesMode;
              set({
                mode,
                ...(mode === 'replacement'
                  ? { visibleAtSceneStart: undefined }
                  : {}),
              });
            }}
            className="rounded border-slate-500"
          />
          Accumulation (each point appears and stays)
        </label>
        <p className="text-[10px] text-slate-500 leading-snug pl-5">
          When off (Replacement): fade out the previous dot and fade in the next at each step.
        </p>
      </div>

      <div className="rounded border border-slate-600 bg-slate-800/40 px-2 py-2 space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">
          Defaults
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <ColorPicker
            value={item.defaults.color}
            onChange={(c) => patchDefaults({ color: c })}
          />
          <NumberInput
            label="Dot radius"
            value={item.defaults.pointRadius}
            onChange={(v) => patchDefaults({ pointRadius: Math.max(0.001, v) })}
            min={0.001}
            step={0.01}
          />
        </div>
        <p className="text-[10px] text-slate-500">
          Radius in Manim scene units (same as graph dot). Preview scales by axes size.
        </p>
        <div className="flex items-end gap-3 flex-wrap">
          <NumberInput
            label="Anim (s)"
            value={item.defaults.animDuration}
            onChange={(v) =>
              patchDefaults({ animDuration: Math.max(0.01, v) })
            }
            min={0.01}
            step={0.1}
          />
          <NumberInput
            label="Wait (s)"
            value={item.defaults.waitAfter}
            onChange={(v) => patchDefaults({ waitAfter: Math.max(0, v) })}
            min={0}
            step={0.1}
          />
        </div>
        <button
          type="button"
          onClick={() => openIndividualFor(null)}
          className="mt-1 px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-100"
          title="Per-index color, radius, timing"
        >
          Individual point editing…
        </button>
      </div>

      {hasErrors && perNErrorEntries.length > 0 && (
        <div className="rounded border border-red-700 bg-red-900/30 px-2 py-2 text-xs text-red-200 space-y-1">
          <div className="space-y-0.5">
            {perNErrorEntries.slice(0, 8).map(([n, msg]) => (
              <button
                key={n}
                type="button"
                onClick={() => openIndividualFor(Number(n))}
                className="block text-left text-red-300 hover:text-red-100"
              >
                • n = {n}: {msg}
              </button>
            ))}
          </div>
        </div>
      )}

      {axesFor?.kind === 'axes' && (
        <p className="text-[10px] text-slate-500">
          Points must lie inside the axes x/y domain for export validation.
        </p>
      )}
    </div>
  );

  const animationContent = (
    <div className="flex flex-col gap-3">
      <VisibleAtSceneStartRow
        checked={item.visibleAtSceneStart === true}
        disabled={item.mode !== 'accumulation'}
        disabledReason="Scene-start visibility is supported for accumulation. For replacement, only the last point is shown when visible at start."
        note="Shows points from t=0. Intro audio is not synchronized when animating."
        onChange={(next) =>
          set(
            next
              ? { visibleAtSceneStart: true, startTime: 0 }
              : { visibleAtSceneStart: undefined },
          )
        }
      />
      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput
          label="Start (s)"
          value={item.startTime}
          onChange={(v) => set({ startTime: v })}
          min={0}
          disabled={item.visibleAtSceneStart === true}
        />
        <div className="flex flex-col text-[11px] text-slate-400">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            Duration (computed)
          </span>
          <span className="font-mono text-slate-300">
            {item.duration.toFixed(2)}s
          </span>
        </div>
        <NumberInput
          label="Layer"
          value={item.layer}
          onChange={(v) => set({ layer: Math.round(v) })}
          min={0}
          step={1}
        />
      </div>

      <AudioBindingSelect
        value={item.audioTrackId}
        currentItemId={item.id}
        onChange={(audioTrackId) => setItemAudioBinding(item.id, audioTrackId)}
      />
    </div>
  );

  return (
    <>
      <PropertyTabs
        key={item.id}
        defaultTabId="base"
        tabs={[
          { id: 'base', label: 'Base', content: baseContent },
          { id: 'graph', label: 'Graph', content: graphContent },
          {
            id: 'animation',
            label: 'Animation / Audio',
            content: animationContent,
          },
        ]}
      />
      {individualOpen && (
        <PointSequenceIndividualPanel
          item={item}
          focusedN={focusedN}
          onClose={() => setIndividualOpen(false)}
        />
      )}
    </>
  );
}
