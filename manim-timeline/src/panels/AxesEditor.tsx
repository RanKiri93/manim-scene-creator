import { useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { AxesItem, AxesTipShape } from '@/types/scene';
import { syncAxesLegacyScale } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import PositionStepsEditor from './PositionStepsEditor';
import AudioBindingSelect from './AudioBindingSelect';
import PropertyTabs from './PropertyTabs';
import VisibleAtSceneStartRow from './VisibleAtSceneStartRow';
import TargetAnimationEffectsNote from './TargetAnimationEffectsNote';

interface AxesEditorProps {
  item: AxesItem;
}

const AXES_TIP_SHAPE_OPTIONS: { value: AxesTipShape; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'ArrowTriangleTip', label: 'ArrowTriangleTip' },
  { value: 'StealthTip', label: 'StealthTip' },
  { value: 'ArrowSquareTip', label: 'ArrowSquareTip' },
];

type OptionalAxesNumberKey =
  | 'axisStrokeWidth'
  | 'tickLength'
  | 'tickStrokeWidth'
  | 'numberFontSize'
  | 'tipHeight'
  | 'tipWidth'
  | 'tipStrokeWidth';

export default function AxesEditor({ item }: AxesEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const setItemAudioBinding = useSceneStore((s) => s.setItemAudioBinding);

  const set = useCallback(
    (patch: Partial<AxesItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const setOptionalNumber = useCallback(
    (key: OptionalAxesNumberKey, raw: string, min: number) => {
      const value = raw.trim();
      if (value === '') {
        set({ [key]: undefined } as Partial<AxesItem>);
        return;
      }
      const n = parseFloat(value);
      if (Number.isNaN(n)) return;
      set({ [key]: Math.max(min, n) } as Partial<AxesItem>);
    },
    [set],
  );

  const baseContent = (
    <div className="flex flex-col gap-3">
      <h3 className="text-body font-semibold text-chalk">Axes</h3>

      <label className="text-ctl text-chalk-dim block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Main axes, Inset B"
          className="mt-1 w-full max-w-xs bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk"
        />
        <span className="mt-1 block text-meta text-chalk-faint leading-snug">
          Used in the item list, exit-animation target picker, and overlay &quot;Target axes&quot; menus. Plots and fields still link by the internal id below (unchangeable).
        </span>
      </label>

      <details className="text-meta text-chalk-faint">
        <summary className="cursor-pointer text-chalk-dim select-none">Internal axes id</summary>
        <code className="mt-1 block break-all rounded-ctl bg-ink px-2 py-1 text-meta text-chalk-dim">
          {item.id}
        </code>
      </details>

      <div className="grid grid-cols-3 gap-2">
        <NumberInput label="xMin" value={item.xRange[0]} onChange={(v) => set({ xRange: [v, item.xRange[1], item.xRange[2]] })} />
        <NumberInput label="xMax" value={item.xRange[1]} onChange={(v) => set({ xRange: [item.xRange[0], v, item.xRange[2]] })} />
        <NumberInput label="xStep" value={item.xRange[2]} onChange={(v) => set({ xRange: [item.xRange[0], item.xRange[1], v] })} min={0.1} />
        <NumberInput label="yMin" value={item.yRange[0]} onChange={(v) => set({ yRange: [v, item.yRange[1], item.yRange[2]] })} />
        <NumberInput label="yMax" value={item.yRange[1]} onChange={(v) => set({ yRange: [item.yRange[0], v, item.yRange[2]] })} />
        <NumberInput label="yStep" value={item.yRange[2]} onChange={(v) => set({ yRange: [item.yRange[0], item.yRange[1], v] })} min={0.1} />
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <label className="text-ctl text-chalk-dim">
          X label
          <input
            type="text"
            value={item.xLabel}
            onChange={(e) => set({ xLabel: e.target.value })}
            className="ml-1 w-16 bg-raised border border-rule rounded-ctl px-1.5 py-0.5 text-ctl text-chalk"
          />
        </label>
        <label className="text-ctl text-chalk-dim">
          Y label
          <input
            type="text"
            value={item.yLabel}
            onChange={(e) => set({ yLabel: e.target.value })}
            className="ml-1 w-16 bg-raised border border-rule rounded-ctl px-1.5 py-0.5 text-ctl text-chalk"
          />
        </label>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput
          label="Scale X"
          value={item.scaleX}
          onChange={(v) => {
            const scaleX = Math.max(0.01, v);
            const scaleY = Math.max(0.01, item.scaleY);
            set({ scaleX, scale: syncAxesLegacyScale(scaleX, scaleY) });
          }}
          min={0.01}
          step={0.05}
        />
        <NumberInput
          label="Scale Y"
          value={item.scaleY}
          onChange={(v) => {
            const scaleY = Math.max(0.01, v);
            const scaleX = Math.max(0.01, item.scaleX);
            set({ scaleY, scale: syncAxesLegacyScale(scaleX, scaleY) });
          }}
          min={0.01}
          step={0.05}
        />
      </div>

      <TargetAnimationEffectsNote targetId={item.id} />
    </div>
  );

  const stylingContent = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h4 className="text-ctl font-medium text-chalk-dim">Axis line</h4>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ColorPicker
              label="Axis color"
              value={item.axisColor ?? '#94a3b8'}
              onChange={(c) => set({ axisColor: c.trim() || undefined })}
            />
            {item.axisColor ? (
              <button
                type="button"
                onClick={() => set({ axisColor: undefined })}
                className="rounded-ctl border border-rule px-2 py-0.5 text-ctl text-chalk-dim hover:text-chalk"
              >
                Default
              </button>
            ) : null}
          </div>
          <label className="text-ctl text-chalk-dim">
            Stroke width
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={item.axisStrokeWidth === undefined ? '' : item.axisStrokeWidth}
              placeholder="default"
              onChange={(e) => setOptionalNumber('axisStrokeWidth', e.target.value, 0.5)}
              className="ml-1 w-24 bg-raised border border-rule rounded-ctl px-1.5 py-0.5 text-ctl text-chalk placeholder:text-chalk-faint"
            />
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-1 border-t border-rule">
        <h4 className="text-ctl font-medium text-chalk-dim">Ticks and numbers</h4>
        <div className="flex items-end gap-3 flex-wrap">
          <label className="flex items-center gap-1 text-ctl text-chalk-dim cursor-pointer">
            <input type="checkbox" checked={item.includeNumbers} onChange={(e) => set({ includeNumbers: e.target.checked })} className="accent-highlight" />
            Numbers
          </label>
          <label className="text-ctl text-chalk-dim">
            Tick length
            <input
              type="number"
              min={0.01}
              step={0.05}
              value={item.tickLength === undefined ? '' : item.tickLength}
              placeholder="default"
              onChange={(e) => setOptionalNumber('tickLength', e.target.value, 0.01)}
              className="ml-1 w-24 bg-raised border border-rule rounded-ctl px-1.5 py-0.5 text-ctl text-chalk placeholder:text-chalk-faint"
            />
          </label>
          <label className="text-ctl text-chalk-dim">
            Tick color
            <input
              type="text"
              value={item.tickColor ?? ''}
              onChange={(e) => set({ tickColor: e.target.value.trim() || undefined })}
              placeholder="axis/default"
              className="ml-1 w-32 bg-raised border border-rule rounded-ctl px-1.5 py-0.5 text-ctl text-chalk"
            />
          </label>
          <label className="text-ctl text-chalk-dim">
            Tick stroke
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={item.tickStrokeWidth === undefined ? '' : item.tickStrokeWidth}
              placeholder="default"
              onChange={(e) => setOptionalNumber('tickStrokeWidth', e.target.value, 0.5)}
              className="ml-1 w-24 bg-raised border border-rule rounded-ctl px-1.5 py-0.5 text-ctl text-chalk placeholder:text-chalk-faint"
            />
          </label>
          <label className="text-ctl text-chalk-dim">
            Number color
            <input
              type="text"
              value={item.numberColor ?? ''}
              onChange={(e) => set({ numberColor: e.target.value.trim() || undefined })}
              placeholder="default"
              className="ml-1 w-32 bg-raised border border-rule rounded-ctl px-1.5 py-0.5 text-ctl text-chalk"
            />
          </label>
          <label className="text-ctl text-chalk-dim">
            Number size
            <input
              type="number"
              min={1}
              step={1}
              value={item.numberFontSize === undefined ? '' : item.numberFontSize}
              placeholder="default"
              onChange={(e) => setOptionalNumber('numberFontSize', e.target.value, 1)}
              className="ml-1 w-24 bg-raised border border-rule rounded-ctl px-1.5 py-0.5 text-ctl text-chalk placeholder:text-chalk-faint"
            />
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-1 border-t border-rule">
        <h4 className="text-ctl font-medium text-chalk-dim">Tips</h4>
        <div className="flex items-end gap-3 flex-wrap">
          <label className="flex items-center gap-1 text-ctl text-chalk-dim cursor-pointer">
            <input type="checkbox" checked={item.includeTip} onChange={(e) => set({ includeTip: e.target.checked })} className="accent-highlight" />
            Tips
          </label>
          {item.includeTip ? (
            <>
              <label className="text-ctl text-chalk-dim flex flex-col gap-1">
                Tip shape
                <select
                  value={item.tipShape ?? 'default'}
                  onChange={(e) => {
                    const v = e.target.value as AxesTipShape;
                    set({ tipShape: v === 'default' ? undefined : v });
                  }}
                  className="w-52 bg-raised border border-rule rounded-ctl px-1.5 py-0.5 text-ctl text-chalk"
                >
                  {AXES_TIP_SHAPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-ctl text-chalk-dim">
                Tip height
                <input
                  type="number"
                  min={0.05}
                  step={0.05}
                  value={item.tipHeight === undefined ? '' : item.tipHeight}
                  placeholder="default"
                  onChange={(e) => setOptionalNumber('tipHeight', e.target.value, 0.05)}
                  className="ml-1 w-24 bg-raised border border-rule rounded-ctl px-1.5 py-0.5 text-ctl text-chalk placeholder:text-chalk-faint"
                />
              </label>
              <label className="text-ctl text-chalk-dim">
                Tip width
                <input
                  type="number"
                  min={0.05}
                  step={0.05}
                  value={item.tipWidth === undefined ? '' : item.tipWidth}
                  placeholder="default"
                  onChange={(e) => setOptionalNumber('tipWidth', e.target.value, 0.05)}
                  className="ml-1 w-24 bg-raised border border-rule rounded-ctl px-1.5 py-0.5 text-ctl text-chalk placeholder:text-chalk-faint"
                />
              </label>
              <label className="text-ctl text-chalk-dim">
                Tip stroke
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={item.tipStrokeWidth === undefined ? '' : item.tipStrokeWidth}
                  placeholder="default"
                  onChange={(e) => setOptionalNumber('tipStrokeWidth', e.target.value, 0)}
                  className="ml-1 w-24 bg-raised border border-rule rounded-ctl px-1.5 py-0.5 text-ctl text-chalk placeholder:text-chalk-faint"
                />
              </label>
              <label className="text-ctl text-chalk-dim">
                Tip fill opacity
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={item.tipFillOpacity === undefined ? '' : item.tipFillOpacity}
                  placeholder="default"
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (v === '') {
                      set({ tipFillOpacity: undefined });
                      return;
                    }
                    const n = parseFloat(v);
                    if (Number.isNaN(n)) return;
                    set({ tipFillOpacity: Math.max(0, Math.min(1, n)) });
                  }}
                  className="ml-1 w-24 bg-raised border border-rule rounded-ctl px-1.5 py-0.5 text-ctl text-chalk placeholder:text-chalk-faint"
                />
              </label>
            </>
          ) : null}
        </div>
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

      <AudioBindingSelect
        value={item.audioTrackId}
        currentItemId={item.id}
        onChange={(audioTrackId) => setItemAudioBinding(item.id, audioTrackId)}
      />
    </div>
  );

  const positionContent = (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput label="X" value={item.x} onChange={(v) => set({ x: v })} />
        <NumberInput label="Y" value={item.y} onChange={(v) => set({ y: v })} />
      </div>

      <div>
        <div className="text-ctl text-chalk-dim mb-1">Positioning steps ({item.posSteps.length})</div>
        <PositionStepsEditor
          steps={item.posSteps}
          onChange={(s) => set({ posSteps: s })}
          currentItemId={item.id}
        />
      </div>
    </div>
  );

  return (
    <PropertyTabs
      key={item.id}
      defaultTabId="base"
      tabs={[
        { id: 'base', label: 'Base', content: baseContent },
        { id: 'styling', label: 'Styling', content: stylingContent },
        { id: 'animation', label: 'Animation / Audio', content: animationContent },
        { id: 'position', label: 'Positioning', content: positionContent },
      ]}
    />
  );
}
