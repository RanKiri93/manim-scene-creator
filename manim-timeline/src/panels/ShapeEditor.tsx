import { useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { ShapeItem, ShapeKind } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import PositionStepsEditor from './PositionStepsEditor';

const SHAPE_TYPES: { value: ShapeKind; label: string }[] = [
  { value: 'circle', label: 'Circle' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'line', label: 'Line' },
];

interface ShapeEditorProps {
  item: ShapeItem;
}

export default function ShapeEditor({ item }: ShapeEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const removeItem = useSceneStore((s) => s.removeItem);

  const set = useCallback(
    (patch: Partial<ShapeItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Shape</h3>
      <p className="text-[11px] text-slate-500 leading-snug">
        Primitive Manim shape. Drag on the canvas to move (with absolute positioning). Use the
        yellow handle to rotate. Export uses <code className="text-slate-400">Circle</code>,{' '}
        <code className="text-slate-400">Rectangle</code>, <code className="text-slate-400">Arrow</code>, or{' '}
        <code className="text-slate-400">Line</code>.
      </p>

      <label className="text-xs text-slate-400 block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Highlight ring"
          className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>

      <label className="text-xs text-slate-400 block">
        Shape type
        <select
          value={item.shapeType}
          onChange={(e) => set({ shapeType: e.target.value as ShapeKind })}
          className="mt-1 w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          {SHAPE_TYPES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <NumberInput
          label="X"
          value={item.x}
          onChange={(v) => set({ x: v })}
          step={0.1}
        />
        <NumberInput
          label="Y"
          value={item.y}
          onChange={(v) => set({ y: v })}
          step={0.1}
        />
        <NumberInput
          label="Scale"
          value={item.scale}
          onChange={(v) => set({ scale: Math.max(0.05, v) })}
          min={0.05}
          step={0.05}
        />
        <NumberInput
          label="Rotation °"
          value={item.rotationDeg}
          onChange={(v) => set({ rotationDeg: v })}
          step={1}
        />
      </div>

      {item.shapeType === 'circle' && (
        <NumberInput
          label="Radius"
          value={item.radius}
          onChange={(v) => set({ radius: Math.max(0.02, v) })}
          min={0.02}
          step={0.05}
        />
      )}

      {item.shapeType === 'rectangle' && (
        <div className="flex flex-wrap gap-3">
          <NumberInput
            label="Width"
            value={item.width}
            onChange={(v) => set({ width: Math.max(0.05, v) })}
            min={0.05}
            step={0.1}
          />
          <NumberInput
            label="Height"
            value={item.height}
            onChange={(v) => set({ height: Math.max(0.05, v) })}
            min={0.05}
            step={0.1}
          />
        </div>
      )}

      {(item.shapeType === 'arrow' || item.shapeType === 'line') && (
        <div className="flex flex-wrap gap-3">
          <NumberInput
            label="End ΔX"
            value={item.endX}
            onChange={(v) => set({ endX: v })}
            step={0.1}
          />
          <NumberInput
            label="End ΔY"
            value={item.endY}
            onChange={(v) => set({ endY: v })}
            step={0.1}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">Stroke</span>
        <ColorPicker value={item.strokeColor} onChange={(c) => set({ strokeColor: c })} />
        <NumberInput
          label="Stroke width"
          value={item.strokeWidth}
          onChange={(v) => set({ strokeWidth: Math.max(0.5, v) })}
          min={0.5}
          step={0.5}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs text-slate-400 flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(item.fillColor?.trim())}
            onChange={(e) =>
              set({ fillColor: e.target.checked ? '#3b82f6' : null })
            }
            className="accent-blue-500"
          />
          Fill (circle / rectangle / arrow tip)
        </label>
        {item.fillColor?.trim() ? (
          <div className="flex flex-wrap items-center gap-2">
            <ColorPicker
              value={item.fillColor}
              onChange={(c) => set({ fillColor: c })}
            />
            <NumberInput
              label="Fill opacity"
              value={item.fillOpacity}
              onChange={(v) => set({ fillOpacity: Math.max(0, Math.min(1, v)) })}
              min={0}
              max={1}
              step={0.05}
            />
          </div>
        ) : null}
      </div>

      <div>
        <div className="text-xs text-slate-400 mb-1">Intro</div>
        <select
          value={item.introStyle}
          onChange={(e) =>
            set({ introStyle: e.target.value as ShapeItem['introStyle'] })
          }
          className="w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          <option value="create">Create</option>
          <option value="fade_in">FadeIn</option>
        </select>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput
          label="Start (s)"
          value={item.startTime}
          onChange={(v) => set({ startTime: Math.max(0, v) })}
          min={0}
        />
        <NumberInput
          label="Duration"
          value={item.duration}
          onChange={(v) => set({ duration: Math.max(0.05, v) })}
          min={0.05}
        />
        <NumberInput
          label="Layer"
          value={item.layer}
          onChange={(v) => set({ layer: Math.round(v) })}
          min={0}
          step={1}
        />
      </div>

      <div>
        <div className="text-xs text-slate-400 mb-1">Position steps</div>
        <PositionStepsEditor
          steps={item.posSteps}
          onChange={(posSteps) => set({ posSteps })}
          currentItemId={item.id}
        />
      </div>

      <button
        type="button"
        className="self-start text-xs text-red-300 hover:text-red-200 underline"
        onClick={() => removeItem(item.id)}
      >
        Delete shape
      </button>
    </div>
  );
}
