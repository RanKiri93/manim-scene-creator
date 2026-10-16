import { useCallback, useEffect } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { ShapeItem, ShapeKind, ShapePoint } from '@/types/scene';
import { DEFAULT_SHAPE_POLYLINE_POINTS } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import PositionStepsEditor from './PositionStepsEditor';
import AudioBindingSelect from './AudioBindingSelect';
import PropertyTabs from './PropertyTabs';
import VisibleAtSceneStartRow from './VisibleAtSceneStartRow';
import TargetAnimationEffectsNote from './TargetAnimationEffectsNote';
import ConnectorEndsEditor from './ConnectorEndsEditor';
import AngleMarkEditor from './AngleMarkEditor';

const SHAPE_TYPES: { value: ShapeKind; label: string }[] = [
  { value: 'circle', label: 'Circle' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'line', label: 'Line' },
  { value: 'polyline', label: 'Polyline' },
];

interface ShapeEditorProps {
  item: ShapeItem;
}

export default function ShapeEditor({ item }: ShapeEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const setItemAudioBinding = useSceneStore((s) => s.setItemAudioBinding);
  const removeItem = useSceneStore((s) => s.removeItem);
  const polylinePointCaptureId = useSceneStore((s) => s.polylinePointCaptureId);
  const setPolylinePointCaptureId = useSceneStore(
    (s) => s.setPolylinePointCaptureId,
  );

  const set = useCallback(
    (patch: Partial<ShapeItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const isCapturing = polylinePointCaptureId === item.id;
  const pickBlocked =
    item.shapeType === 'polyline' &&
    (Math.abs(item.rotationDeg) > 1e-6 || Math.abs(item.scale - 1) > 1e-6);

  useEffect(() => {
    if (!isCapturing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPolylinePointCaptureId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCapturing, setPolylinePointCaptureId]);

  const setPoint = (index: number, patch: Partial<ShapePoint>) => {
    set({
      points: item.points.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    });
  };

  const addPoint = () => {
    const last = item.points[item.points.length - 1] ?? { x: 0, y: 0 };
    set({ points: [...item.points, { x: last.x + 0.5, y: last.y }] });
  };

  const deletePoint = (index: number) => {
    set({ points: item.points.filter((_, i) => i !== index) });
  };

  const baseContent = (
    <div className="flex flex-col gap-3">
      <h3 className="text-body font-semibold text-chalk">Shape</h3>
      <p className="text-meta text-chalk-faint leading-snug">
        Drag on the canvas to move it. The box handles resize (Shift keeps proportions, Alt resizes
        from the centre) and the top handle rotates in 15° steps. Lines and arrows: drag either end
        (Shift snaps the angle). Polylines: drag a point, double-click the line to add one, Alt+click
        a point to remove it.
      </p>

      <label className="text-ctl text-chalk-dim block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Highlight ring"
          className="mt-1 w-full max-w-md bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk"
        />
      </label>

      <label className="text-ctl text-chalk-dim block">
        Shape type
        <select
          value={item.shapeType}
          onChange={(e) => {
            const shapeType = e.target.value as ShapeKind;
            set({ shapeType });
            if (shapeType !== 'polyline') setPolylinePointCaptureId(null);
          }}
          className="mt-1 w-full max-w-xs bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk"
        >
          {SHAPE_TYPES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

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

      {(item.shapeType === 'arrow' || item.shapeType === 'line') && <ConnectorEndsEditor item={item} />}

      {(item.shapeType === 'arrow' || item.shapeType === 'line') && !item.endpoints && (
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

      {item.shapeType === 'polyline' && <AngleMarkEditor item={item} />}

      {item.shapeType === 'polyline' && !item.angle && (
        <div className="flex flex-col gap-3 border border-rule rounded-ctl p-3 bg-ink/40">
          <div className="text-ctl font-medium text-chalk-dim">Points</div>
          <p className="text-meta text-chalk-faint leading-snug">
            Click the canvas to append points in order. Tail is the first point; head is the last
            point. Point picking matches the anchor at rotation 0 and scale 1.
          </p>
          {pickBlocked ? (
            <p className="text-meta text-warn">
              Set rotation to 0° and scale to 1 to pick points on the canvas, or edit coordinates
              below.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {isCapturing ? (
              <button
                type="button"
                className="text-ctl px-2 py-1 rounded-ctl bg-raised text-chalk hover:bg-rule"
                onClick={() => setPolylinePointCaptureId(null)}
              >
                Finish picking
              </button>
            ) : (
              <button
                type="button"
                disabled={pickBlocked}
                className="text-ctl px-2 py-1 rounded-ctl bg-raised text-chalk hover:bg-rule disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => setPolylinePointCaptureId(item.id)}
              >
                Start picking points
              </button>
            )}
            <button
              type="button"
              className="text-ctl px-2 py-1 rounded-ctl bg-raised text-chalk border border-rule hover:bg-rule"
              onClick={() => set({ points: [] })}
            >
              Clear points
            </button>
            <button
              type="button"
              className="text-ctl px-2 py-1 rounded-ctl bg-raised text-chalk border border-rule hover:bg-rule"
              onClick={addPoint}
            >
              Add point
            </button>
          </div>

          <label className="text-ctl text-chalk-dim block">
            Arrowheads
            <select
              value={
                item.tailArrow && item.headArrow
                  ? 'both'
                  : item.tailArrow
                    ? 'tail'
                    : item.headArrow
                      ? 'head'
                      : 'none'
              }
              onChange={(e) => {
                const mode = e.target.value;
                set({
                  tailArrow: mode === 'tail' || mode === 'both',
                  headArrow: mode === 'head' || mode === 'both',
                });
              }}
              className="mt-1 w-full max-w-xs bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk"
            >
              <option value="none">None</option>
              <option value="tail">Tail</option>
              <option value="head">Head</option>
              <option value="both">Both</option>
            </select>
          </label>

          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
            {item.points.length === 0 ? (
              <span className="text-meta text-chalk-faint">No points — pick or add below.</span>
            ) : null}
            {item.points.map((p, i) => (
              <div
                key={`${item.id}-pt-${i}`}
                className="flex flex-wrap items-end gap-2 border-b border-rule pb-2"
              >
                <span className="text-meta text-chalk-faint w-full">#{i + 1}</span>
                <NumberInput
                  label="X"
                  value={p.x}
                  onChange={(v) => setPoint(i, { x: v })}
                  step={0.1}
                />
                <NumberInput
                  label="Y"
                  value={p.y}
                  onChange={(v) => setPoint(i, { y: v })}
                  step={0.1}
                />
                <button
                  type="button"
                  className="text-meta text-danger hover:text-danger"
                  onClick={() => deletePoint(i)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="self-start text-meta text-chalk-dim hover:text-chalk-dim underline"
            onClick={() =>
              set({ points: DEFAULT_SHAPE_POLYLINE_POINTS.map((q) => ({ ...q })) })
            }
          >
            Reset to default triangle
          </button>
        </div>
      )}

      <TargetAnimationEffectsNote targetId={item.id} />

      <button
        type="button"
        className="self-start text-ctl text-danger hover:text-danger underline"
        onClick={() => removeItem(item.id)}
      >
        Delete shape
      </button>
    </div>
  );

  const styleContent = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ctl text-chalk-dim">Stroke</span>
        <ColorPicker value={item.strokeColor} onChange={(c) => set({ strokeColor: c })} />
        <NumberInput
          label="Stroke width"
          value={item.strokeWidth}
          onChange={(v) => set({ strokeWidth: Math.max(0.5, v) })}
          min={0.5}
          step={0.5}
        />
      </div>

      {item.shapeType !== 'polyline' ? (
        <div className="flex flex-col gap-2">
          <label className="text-ctl text-chalk-dim flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(item.fillColor?.trim())}
              onChange={(e) =>
                set({ fillColor: e.target.checked ? '#3b82f6' : null })
              }
              className="accent-highlight"
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
      ) : (
        <p className="text-meta text-chalk-faint">
          Polylines are open paths — fill is not used.
        </p>
      )}
    </div>
  );

  const animationContent = (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-ctl text-chalk-dim mb-1">Intro</div>
        <select
          value={item.introStyle}
          onChange={(e) =>
            set({ introStyle: e.target.value as ShapeItem['introStyle'] })
          }
          className="w-full max-w-xs bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk"
        >
          <option value="create">Create</option>
          <option value="fade_in">FadeIn</option>
        </select>
      </div>

      <VisibleAtSceneStartRow
        checked={item.visibleAtSceneStart === true}
        note="Intro choice above is ignored for export (no intro animation)."
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
          onChange={(v) => set({ startTime: Math.max(0, v) })}
          min={0}
          disabled={item.visibleAtSceneStart === true}
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

      <AudioBindingSelect
        value={item.audioTrackId}
        currentItemId={item.id}
        onChange={(audioTrackId) => setItemAudioBinding(item.id, audioTrackId)}
      />
    </div>
  );

  const positionContent = item.endpoints || item.angle ? (
    <p className="text-meta text-chalk-faint leading-snug">
      This shape follows other objects (see Base → {item.angle ? 'Angle mark' : 'Connector ends'}), so it has no
      position of its own.
    </p>
  ) : (
    <div className="flex flex-col gap-3">
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

      <div>
        <div className="text-ctl text-chalk-dim mb-1">Position steps</div>
        <PositionStepsEditor
          steps={item.posSteps}
          onChange={(posSteps) => set({ posSteps })}
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
        { id: 'style', label: 'Style', content: styleContent },
        { id: 'animation', label: 'Animation / Audio', content: animationContent },
        { id: 'position', label: 'Positioning', content: positionContent },
      ]}
    />
  );
}
