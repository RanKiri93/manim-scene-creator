import { useCallback, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type {
  GraphFunctionSeriesItem,
  FunctionLineStyle,
  FunctionSeriesMode,
  FunctionSeriesDefaults,
  FunctionSeriesDisplayMode,
} from '@/types/scene';
import {
  functionSeriesIndices,
  functionSeriesHasErrors,
  resolveFunctionSeriesDisplayMode,
} from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import AxesIdSelect from './AxesIdSelect';
import AudioBindingSelect from './AudioBindingSelect';
import FunctionSeriesIndividualPanel from './FunctionSeriesIndividualPanel';
import PropertyTabs from './PropertyTabs';
import VisibleAtSceneStartRow from './VisibleAtSceneStartRow';

interface FunctionSeriesEditorProps {
  item: GraphFunctionSeriesItem;
}

const LINE_STYLES: FunctionLineStyle[] = ['solid', 'dashed', 'dotted'];

export default function FunctionSeriesEditor({
  item,
}: FunctionSeriesEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const setItemAudioBinding = useSceneStore((s) => s.setItemAudioBinding);
  const axesForSeries = useSceneStore((s) => s.items.get(item.axesId));

  const [individualOpen, setIndividualOpen] = useState(false);
  const [focusedN, setFocusedN] = useState<number | null>(null);

  const set = useCallback(
    (patch: Partial<GraphFunctionSeriesItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const patchDefaults = useCallback(
    (patch: Partial<FunctionSeriesDefaults>) =>
      set({ defaults: { ...item.defaults, ...patch } }),
    [item.defaults, set],
  );

  const customXDomain = item.xDomain != null;
  const [dxLo, dxHi] = item.xDomain ?? [0, 1];

  const enableCustomXDomain = () => {
    if (axesForSeries?.kind === 'axes') {
      const [a, b] = axesForSeries.xRange;
      set({ xDomain: [Math.min(a, b), Math.max(a, b)] });
    } else {
      set({ xDomain: [-1, 1] });
    }
  };

  const indices = functionSeriesIndices(item);
  const hasErrors = functionSeriesHasErrors(item);
  const displayMode = resolveFunctionSeriesDisplayMode(item);

  const setDisplayMode = (next: FunctionSeriesDisplayMode) => {
    if (next === displayMode) return;
    if (next === 'partialSum' && item.mode === 'accumulation') {
      set({
        displayMode: next,
        mode: 'replacement',
        visibleAtSceneStart: undefined,
      });
    } else {
      set({ displayMode: next });
    }
  };
  const perNErrorEntries = item.perNErrors
    ? Object.entries(item.perNErrors).filter(([, v]) => v)
    : [];

  const openIndividualFor = (n: number | null) => {
    setFocusedN(n);
    setIndividualOpen(true);
  };

  const baseContent = (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Function series</h3>

      <label className="text-xs text-slate-400 block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. sin family"
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
              {perNErrorEntries.length === 1 ? '' : 's'} — open the Graph tab to review and fix.
            </div>
          )}
        </div>
      )}
    </div>
  );

  const graphContent = (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-slate-600 bg-slate-800/30 px-2 py-2">
        <div className="text-xs text-slate-400 mb-1">Formula (variables: n, x)</div>
        <p className="mt-2 text-[11px] leading-snug text-slate-500">
          JavaScript drives canvas preview; Python (NumPy) drives export. One
          curve per integer <code className="text-slate-400">n</code> in
          [n_min, n_max].
        </p>
        <div className="mt-2 text-xs text-slate-400">Preview (JavaScript)</div>
        <input
          type="text"
          value={item.jsExpr}
          onChange={(e) => set({ jsExpr: e.target.value })}
          placeholder="JS: Math.sin(n * x)"
          className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
        />
        <div className="mt-2 text-xs text-slate-400">Export (Python)</div>
        <input
          type="text"
          value={item.pyExpr}
          onChange={(e) => set({ pyExpr: e.target.value })}
          placeholder="Python: np.sin(n * x)"
          className="mt-0.5 w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 font-mono"
        />
      </div>

      <div className="rounded border border-slate-600 bg-slate-800/40 px-2 py-2 space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">
          Curve
        </div>
        <div
          role="radiogroup"
          aria-label="Curve geometry"
          className="inline-flex rounded border border-slate-600 overflow-hidden text-xs"
        >
          <button
            type="button"
            role="radio"
            aria-checked={displayMode === 'individual'}
            onClick={() => setDisplayMode('individual')}
            className={
              'px-2 py-1 font-mono transition-colors ' +
              (displayMode === 'individual'
                ? 'bg-slate-200 text-slate-900'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700')
            }
            title="Each curve is the single term f(n, x)"
          >
            f_n(x)
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={displayMode === 'partialSum'}
            onClick={() => setDisplayMode('partialSum')}
            className={
              'px-2 py-1 font-mono transition-colors ' +
              (displayMode === 'partialSum'
                ? 'bg-slate-200 text-slate-900'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700')
            }
            title="Each curve is the partial sum S_k(x) = Σ_{n=n_min}^{k} f(n, x)"
          >
            Σ f_n(x)
          </button>
        </div>
        <p className="text-[10px] text-slate-500 leading-snug">
          {displayMode === 'partialSum'
            ? 'Each step draws the partial sum S_k(x) = Σ f_n(x). Pair with Replacement mode for a Taylor / Fourier–style morph between successive partial sums.'
            : 'Each step draws a single term f(n, x).'}
        </p>
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
            {indices.length} {indices.length === 1 ? 'curve' : 'curves'}
          </span>
        </div>
        <p className="text-[10px] text-slate-500 leading-snug">
          Negative integers allowed; must satisfy n_min &lt; n_max. Per-n style
          settings are retained when the range shrinks and restored on expand.
        </p>
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
          Accumulation (each f_n is drawn and stays on screen)
        </label>
        <p className="text-[10px] text-slate-500 leading-snug pl-5">
          When off (Replacement): the first curve is Created; each subsequent
          curve is ReplacementTransform&apos;d from the previous one, which
          hides it automatically at end of transform.
        </p>
      </div>

      <div className="rounded border border-slate-600 bg-slate-800/40 px-2 py-2 space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">
          Apply to all (defaults)
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <ColorPicker
            value={item.defaults.color}
            onChange={(c) => patchDefaults({ color: c })}
          />
          <NumberInput
            label="Stroke"
            value={item.defaults.strokeWidth}
            onChange={(v) => patchDefaults({ strokeWidth: Math.max(0, v) })}
            min={0}
            step={0.25}
          />
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <span>Line style</span>
            <select
              value={item.defaults.lineStyle}
              onChange={(e) =>
                patchDefaults({
                  lineStyle: e.target.value as FunctionLineStyle,
                })
              }
              className="bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-200"
            >
              {LINE_STYLES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
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
          title="Edit each curve's color / stroke / style / wait individually"
        >
          Individual curve editing…
        </button>
      </div>

      <div className="rounded border border-slate-600 bg-slate-800/40 px-2 py-2 space-y-2">
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={customXDomain}
            onChange={(e) => {
              if (e.target.checked) enableCustomXDomain();
              else set({ xDomain: null });
            }}
            className="rounded border-slate-500"
          />
          Custom x domain (sample curves only on this interval)
        </label>
        {customXDomain && (
          <div className="flex items-end gap-3 flex-wrap pl-5">
            <NumberInput
              label="x min"
              value={dxLo}
              onChange={(v) => set({ xDomain: [v, dxHi] })}
            />
            <NumberInput
              label="x max"
              value={dxHi}
              onChange={(v) => set({ xDomain: [dxLo, v] })}
            />
          </div>
        )}
      </div>

      {hasErrors && (
        <div className="rounded border border-red-700 bg-red-900/30 px-2 py-2 text-xs text-red-200 space-y-1">
          <div className="font-semibold">
            Playback of this object is disabled until errors are resolved.
          </div>
          {item.topLevelError && (
            <div className="text-red-300">• {item.topLevelError}</div>
          )}
          {perNErrorEntries.length > 0 && (
            <div className="space-y-0.5">
              {perNErrorEntries.slice(0, 6).map(([n, msg]) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => openIndividualFor(Number(n))}
                  className="block text-left text-red-300 hover:text-red-100"
                  title="Open in Individual panel"
                >
                  • n = {n}: {msg}
                </button>
              ))}
              {perNErrorEntries.length > 6 && (
                <div className="text-red-400">
                  …and {perNErrorEntries.length - 6} more.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const animationContent = (
    <div className="flex flex-col gap-3">
      <VisibleAtSceneStartRow
        checked={item.visibleAtSceneStart === true}
        disabled={item.mode !== 'accumulation'}
        disabledReason="Only accumulation mode supports scene-start visibility (replacement uses animated morphs)."
        note="Shows every curve from t=0. Intro audio is not synchronized."
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
          { id: 'animation', label: 'Animation / Audio', content: animationContent },
        ]}
      />
      {individualOpen && (
        <FunctionSeriesIndividualPanel
          item={item}
          focusedN={focusedN}
          onClose={() => setIndividualOpen(false)}
        />
      )}
    </>
  );
}
