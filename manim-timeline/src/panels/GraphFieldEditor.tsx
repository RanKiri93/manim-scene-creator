import { useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { createGraphStreamPoint } from '@/store/factories';
import {
  DEFAULT_FIELD_ARROW_STROKE_WIDTH,
  type GraphFieldItem,
  type GraphFieldMode,
  type GraphFieldColormap,
} from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import AxesIdSelect from './AxesIdSelect';
import AudioBindingSelect from './AudioBindingSelect';
import PropertyTabs from './PropertyTabs';
import VisibleAtSceneStartRow from './VisibleAtSceneStartRow';
import { GraphFieldHelpIcon } from './GraphFieldExpressionHelp';
import MathExpressionEditor from './MathExpressionEditor';
import {
  FIELD_XY_PROFILE,
  VECTOR_XY_PRESETS,
} from './mathExpressionPresets';

interface GraphFieldEditorProps {
  item: GraphFieldItem;
}

export default function GraphFieldEditor({ item }: GraphFieldEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const setItemAudioBinding = useSceneStore((s) => s.setItemAudioBinding);

  const set = useCallback(
    (patch: Partial<GraphFieldItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const updateStream = (index: number, patch: Partial<{ x: number; y: number }>) => {
    const pts = (item.streamPoints ?? []).map((p, i) =>
      i === index ? { ...p, ...patch } : p,
    );
    set({ streamPoints: pts });
  };
  const addStream = () =>
    set({ streamPoints: [...(item.streamPoints ?? []), createGraphStreamPoint()] });
  const removeStream = (index: number) =>
    set({ streamPoints: (item.streamPoints ?? []).filter((_, i) => i !== index) });

  const baseContent = (
    <div className="flex flex-col gap-3">
      <h3 className="text-body font-semibold text-chalk">Vector / slope field</h3>
      <label className="text-ctl text-chalk-dim block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Gradient field — optional; shown in exit target menu"
          className="mt-1 w-full max-w-md bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk"
        />
      </label>
      <AxesIdSelect value={item.axesId} onChange={(axesId) => set({ axesId })} />
    </div>
  );

  const graphContent = (
    <div className="flex flex-col gap-3">
      <div className="text-ctl text-chalk-dim flex items-center gap-1.5">
        <span>Field expressions</span>
        <GraphFieldHelpIcon
          title={FIELD_XY_PROFILE.sectionHelp}
          label="Help: two expression boxes (preview vs export)"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-ctl text-chalk-dim">
          Mode
          <select
            value={item.fieldMode ?? 'vector'}
            onChange={(e) =>
              set({ fieldMode: e.target.value as GraphFieldMode })
            }
            className="ml-2 bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk"
          >
            <option value="none">None</option>
            <option value="vector">Vector field F = ⟨P, Q⟩</option>
            <option value="slope">Slope field dy/dx = f(x,y)</option>
          </select>
        </label>

        {item.fieldMode === 'vector' && (
          <>
            <MathExpressionEditor
              label="P(x, y)"
              jsExpr={item.jsExprP ?? '1'}
              pyExpr={item.pyExprP ?? '1'}
              onChange={(p) => set({ jsExprP: p.jsExpr, pyExprP: p.pyExpr })}
              profile={FIELD_XY_PROFILE}
              dialogTitle="Field P(x, y) — expression helper"
            />
            <MathExpressionEditor
              label="Q(x, y)"
              jsExpr={item.jsExprQ ?? '0'}
              pyExpr={item.pyExprQ ?? '0'}
              onChange={(p) => set({ jsExprQ: p.jsExpr, pyExprQ: p.pyExpr })}
              profile={FIELD_XY_PROFILE}
              dialogTitle="Field Q(x, y) — expression helper"
            />
            <div className="flex flex-col gap-1">
              <span className="text-meta text-chalk-faint">
                Insert both P and Q (JS + Python) for a common field:
              </span>
              <div className="flex flex-wrap gap-1">
                {VECTOR_XY_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    title={`Insert: ${p.label}`}
                    className="rounded-ctl border border-rule bg-raised px-1.5 py-0.5 text-meta text-chalk hover:border-rule hover:bg-rule"
                    onClick={(e) => {
                      e.stopPropagation();
                      set({
                        jsExprP: p.jsP,
                        pyExprP: p.pyP,
                        jsExprQ: p.jsQ,
                        pyExprQ: p.pyQ,
                      });
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {item.fieldMode === 'slope' && (
          <>
            <NumberInput
              label="Arrow length L"
              value={item.slopeArrowLength ?? 0.5}
              onChange={(v) => set({ slopeArrowLength: v })}
              min={0.05}
              step={0.05}
            />
            <MathExpressionEditor
              label="f(x, y) = dy/dx"
              jsExpr={item.jsExprSlope ?? '0'}
              pyExpr={item.pyExprSlope ?? '0'}
              onChange={(p) =>
                set({ jsExprSlope: p.jsExpr, pyExprSlope: p.pyExpr })
              }
              profile={FIELD_XY_PROFILE}
              dialogTitle="Slope f(x, y) — expression helper"
            />
          </>
        )}

        {item.fieldMode !== 'none' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <NumberInput
                label="Grid step"
                value={item.fieldGridStep ?? 0.5}
                onChange={(v) => set({ fieldGridStep: Math.max(0.05, v) })}
                min={0.05}
                step={0.05}
              />
              <label className="text-ctl text-chalk-dim">
                Colormap
                <select
                  value={item.fieldColormap ?? 'viridis'}
                  onChange={(e) =>
                    set({ fieldColormap: e.target.value as GraphFieldColormap })
                  }
                  className="ml-1 w-full bg-raised border border-rule rounded-ctl px-1 py-0.5 text-ctl text-chalk"
                >
                  <option value="viridis">Viridis</option>
                  <option value="plasma">Plasma</option>
                  <option value="inferno">Inferno</option>
                  <option value="magma">Magma</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberInput
                label="Color min"
                value={item.colorSchemeMin ?? 0}
                onChange={(v) => set({ colorSchemeMin: v })}
              />
              <NumberInput
                label="Color max"
                value={item.colorSchemeMax ?? 2}
                onChange={(v) => set({ colorSchemeMax: v })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberInput
                label="Arrow stroke (px)"
                value={
                  item.arrowStrokeWidth ?? DEFAULT_FIELD_ARROW_STROKE_WIDTH
                }
                onChange={(v) => set({ arrowStrokeWidth: Math.max(0, v) })}
                min={0}
                step={0.5}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberInput
                label="Stream dt"
                value={item.streamDt ?? 0.05}
                onChange={(v) => set({ streamDt: Math.max(0.01, v) })}
                min={0.01}
                step={0.01}
              />
              <NumberInput
                label="Stream time"
                value={item.streamVirtualTime ?? 3}
                onChange={(v) => set({ streamVirtualTime: Math.max(0.1, v) })}
                min={0.1}
                step={0.1}
              />
            </div>
          </>
        )}

        <label className="flex items-center gap-2 text-ctl text-chalk-dim cursor-pointer">
          <input
            type="checkbox"
            checked={item.streamPlacementActive ?? false}
            onChange={(e) => set({ streamPlacementActive: e.target.checked })}
            className="accent-highlight"
          />
          Click canvas to add streamline seed (when this clip is selected)
        </label>

        <div className="text-ctl text-chalk-faint">
          Seeds: {(item.streamPoints ?? []).length}
        </div>
        {(item.streamPoints ?? []).map((sp, i) => (
          <div
            key={sp.id}
            className="flex flex-wrap items-center gap-2 p-2 bg-ink/40 border border-rule rounded-ctl"
          >
            <NumberInput label="x0" value={sp.x} onChange={(v) => updateStream(i, { x: v })} />
            <NumberInput label="y0" value={sp.y} onChange={(v) => updateStream(i, { y: v })} />
            <button
              type="button"
              onClick={() => removeStream(i)}
              className="text-danger hover:text-danger text-ctl ml-auto"
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={addStream} className="text-ctl text-chalk hover:text-chalk text-left">
          + Add streamline seed
        </button>
      </div>
    </div>
  );

  const animationContent = (
    <div className="flex flex-col gap-3">
      <VisibleAtSceneStartRow
        checked={item.visibleAtSceneStart === true}
        note="Intro audio is not synchronized (no intro animation)."
        onChange={(next) =>
          set(
            next
              ? { visibleAtSceneStart: true, startTime: 0 }
              : { visibleAtSceneStart: undefined },
          )
        }
      />
      <div className="flex flex-col gap-1">
        <div className="flex items-end gap-3 flex-wrap">
          <NumberInput
            label="Start (s)"
            value={item.startTime}
            onChange={(v) => set({ startTime: v })}
            min={0}
            disabled={item.visibleAtSceneStart === true}
          />
          <NumberInput label="Duration" value={item.duration} onChange={(v) => set({ duration: v })} min={0.01} />
          <NumberInput label="Layer" value={item.layer} onChange={(v) => set({ layer: Math.round(v) })} min={0} step={1} />
        </div>
        <p className="text-meta text-chalk-faint max-w-md">
          Stack vs other overlays on this axes: higher Layer draws on top (same as plot/dot).
        </p>
      </div>

      <AudioBindingSelect
        value={item.audioTrackId}
        currentItemId={item.id}
        onChange={(audioTrackId) => setItemAudioBinding(item.id, audioTrackId)}
      />
    </div>
  );

  return (
    <PropertyTabs
      key={item.id}
      defaultTabId="base"
      tabs={[
        { id: 'base', label: 'Base', content: baseContent },
        { id: 'graph', label: 'Graph', content: graphContent },
        { id: 'animation', label: 'Animation / Audio', content: animationContent },
      ]}
    />
  );
}
