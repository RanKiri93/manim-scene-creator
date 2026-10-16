import { useSceneStore } from '@/store/useSceneStore';
import type { ShapeAngleMark, ShapeItem } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import { angleMarkStaticGeometry, resolveAngleMark } from '@/lib/shapeAnchors';
import { AnchorPicker } from './ConnectorEndsEditor';

const selectClass = 'mt-1 w-full max-w-xs bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk';

/**
 * Polyline as an angle mark: the angle at a vertex between two other points, drawn as an arc (or
 * a square for a right angle) that follows the points every frame.
 */
export default function AngleMarkEditor({ item }: { item: ShapeItem }) {
  const items = useSceneStore((s) => s.items);
  const frames = useSceneStore((s) => s.frames);
  const startFrameId = useSceneStore((s) => s.startFrameId);
  const currentTime = useSceneStore((s) => s.currentTime);
  const updateItem = useSceneStore((s) => s.updateItem);
  const ctx = { items, frames, startFrameId };

  const commit = (angle: ShapeAngleMark | null) => {
    if (!angle) {
      const geometry = angleMarkStaticGeometry(item, { ...ctx, time: currentTime });
      updateItem(item.id, { ...(geometry ?? {}), angle: null });
      return;
    }
    const geometry = angleMarkStaticGeometry({ ...item, angle }, { ...ctx, time: item.startTime });
    updateItem(item.id, { ...(geometry ?? {}), angle, headArrow: false, tailArrow: false });
  };

  if (!item.angle) {
    return (
      <button
        type="button"
        className="self-start text-ctl px-2 py-1 rounded-ctl bg-raised text-chalk hover:bg-rule"
        onClick={() =>
          commit({ vertex: { kind: 'point', x: 0, y: 0 }, from: { kind: 'point', x: 1, y: 0 }, to: { kind: 'point', x: 0, y: 1 }, radius: 0.4, mark: 'auto' })
        }
        title="Mark the angle between two points as seen from a third (arc or right-angle square)"
      >
        Make an angle mark…
      </button>
    );
  }
  const angle = item.angle;
  const status = resolveAngleMark(item, { ...ctx, time: currentTime });
  return (
    <div className="flex flex-col gap-3 border border-rule rounded-ctl p-3 bg-ink/40">
      <div className="text-ctl font-medium text-chalk-dim">Angle mark</div>
      <AnchorPicker label="Vertex (where the angle is)" anchor={angle.vertex} ownerId={item.id} onChange={(vertex) => commit({ ...angle, vertex })} />
      <AnchorPicker label="One arm towards" anchor={angle.from} ownerId={item.id} onChange={(from) => commit({ ...angle, from })} />
      <AnchorPicker label="Other arm towards" anchor={angle.to} ownerId={item.id} onChange={(to) => commit({ ...angle, to })} />
      <div className="flex flex-wrap gap-3 items-end">
        <NumberInput label="Radius" value={angle.radius} min={0.05} step={0.05} onChange={(radius) => commit({ ...angle, radius: Math.max(0.05, radius) })} />
        <label className="text-ctl text-chalk-dim block">
          Mark
          <select value={angle.mark ?? 'auto'} onChange={(e) => commit({ ...angle, mark: e.target.value as ShapeAngleMark['mark'] })} className={selectClass}>
            <option value="auto">Arc, square at 90°</option>
            <option value="arc">Always an arc</option>
            <option value="right">Right-angle square</option>
          </select>
        </label>
      </div>
      {status.error == null ? (
        <p className="text-meta text-chalk-faint">Angle here: {status.degrees.toFixed(1)}°</p>
      ) : (
        <p className="text-meta text-warn">{status.error}</p>
      )}
      <button
        type="button"
        className="self-start text-ctl px-2 py-1 rounded-ctl bg-raised text-chalk hover:bg-rule"
        onClick={() => commit(null)}
        title="Keep the mark where it is now as a plain polyline"
      >
        Unbind
      </button>
    </div>
  );
}
