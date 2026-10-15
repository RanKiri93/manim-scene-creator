import { useSceneStore } from '@/store/useSceneStore';
import type { ManimDirection, SceneItem, ShapeAnchor, ShapeEndpoints, ShapeItem } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import {
  OBJECT_ANCHOR_KINDS,
  connectorStaticGeometry,
  isConnectorShape,
  resolveConnectorEndpoints,
} from '@/lib/shapeAnchors';

type AnchorKind = 'point' | 'graphPoint' | 'graphDot' | 'graphDotFootX' | 'graphDotFootY' | 'object';

const ANCHOR_KINDS: { value: AnchorKind; label: string }[] = [
  { value: 'point', label: 'Fixed point' },
  { value: 'graphDot', label: 'Graph dot' },
  { value: 'graphDotFootX', label: 'Dot’s foot on x-axis' },
  { value: 'graphDotFootY', label: 'Dot’s foot on y-axis' },
  { value: 'graphPoint', label: 'Point on axes' },
  { value: 'object', label: 'Object' },
];

const EDGES: { value: ManimDirection | 'center'; label: string }[] = [
  { value: 'center', label: 'Centre' },
  { value: 'UP', label: 'Top' },
  { value: 'DOWN', label: 'Bottom' },
  { value: 'LEFT', label: 'Left' },
  { value: 'RIGHT', label: 'Right' },
  { value: 'UL', label: 'Top left' },
  { value: 'UR', label: 'Top right' },
  { value: 'DL', label: 'Bottom left' },
  { value: 'DR', label: 'Bottom right' },
];

const selectClass = 'mt-1 w-full max-w-xs bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk';

function anchorKindOf(anchor: ShapeAnchor): AnchorKind {
  if (anchor.kind === 'graphDotFoot') return anchor.axis === 'y' ? 'graphDotFootY' : 'graphDotFootX';
  return anchor.kind;
}

/**
 * Line / arrow ends that follow other things ("connector"): a graph dot, the dot's foot on an
 * axis, a point on axes, an object's centre or edge, or a fixed point. Redrawn every frame.
 */
export default function ConnectorEndsEditor({ item }: { item: ShapeItem }) {
  const items = useSceneStore((s) => s.items);
  const frames = useSceneStore((s) => s.frames);
  const startFrameId = useSceneStore((s) => s.startFrameId);
  const currentTime = useSceneStore((s) => s.currentTime);
  const updateItem = useSceneStore((s) => s.updateItem);

  const dots = [...items.values()].filter((it) => it.kind === 'graphDot');
  const axes = [...items.values()].filter((it) => it.kind === 'axes');
  const objects = [...items.values()].filter(
    (it) => it.id !== item.id && OBJECT_ANCHOR_KINDS.has(it.kind) && !isConnectorShape(it),
  );

  const ctx = { items, frames, startFrameId };
  const commit = (endpoints: ShapeEndpoints | null) => {
    if (!endpoints) {
      const geometry = connectorStaticGeometry(item, { ...ctx, time: currentTime });
      updateItem(item.id, { ...(geometry ?? {}), endpoints: null });
      return;
    }
    const next = { ...item, endpoints };
    const geometry = connectorStaticGeometry(next, { ...ctx, time: item.startTime });
    updateItem(item.id, { ...(geometry ?? {}), endpoints });
  };

  if (!item.endpoints) {
    return (
      <button
        type="button"
        className="self-start text-ctl px-2 py-1 rounded-ctl bg-raised text-chalk hover:bg-rule"
        onClick={() => {
          const hx = (item.endX * item.scale) / 2;
          const hy = (item.endY * item.scale) / 2;
          commit({
            start: { kind: 'point', x: item.x - hx, y: item.y - hy },
            end: { kind: 'point', x: item.x + hx, y: item.y + hy },
          });
        }}
        title="Make the ends follow a graph dot, an axis, or another object"
      >
        Bind ends to objects…
      </button>
    );
  }

  const endpoints = item.endpoints;
  const status = resolveConnectorEndpoints(item, { ...ctx, time: currentTime });

  const defaultAnchor = (kind: AnchorKind, previous: ShapeAnchor): ShapeAnchor => {
    const dot = dots[0];
    switch (kind) {
      case 'graphDot':
        return { kind: 'graphDot', dotId: dot?.id ?? '' };
      case 'graphDotFootX':
        return { kind: 'graphDotFoot', dotId: dot?.id ?? '', axis: 'x' };
      case 'graphDotFootY':
        return { kind: 'graphDotFoot', dotId: dot?.id ?? '', axis: 'y' };
      case 'graphPoint':
        return { kind: 'graphPoint', axesId: axes[0]?.id ?? '', x: 0, y: 0 };
      case 'object':
        return { kind: 'object', itemId: objects[0]?.id ?? '', edge: 'center' };
      default:
        return previous.kind === 'point' ? previous : { kind: 'point', x: 0, y: 0 };
    }
  };

  const endEditor = (which: 'start' | 'end') => {
    const anchor = endpoints[which];
    const setAnchor = (next: ShapeAnchor) => commit({ ...endpoints, [which]: next });
    const option = (it: SceneItem) => (
      <option key={it.id} value={it.id}>
        {itemClipDisplayName(it)}
      </option>
    );
    return (
      <div className="flex flex-col gap-2">
        <label className="text-ctl text-chalk-dim block">
          {which === 'start' ? 'Start follows' : 'End follows'}
          <select
            value={anchorKindOf(anchor)}
            onChange={(e) => setAnchor(defaultAnchor(e.target.value as AnchorKind, anchor))}
            className={selectClass}
          >
            {ANCHOR_KINDS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {(anchor.kind === 'graphDot' || anchor.kind === 'graphDotFoot') && (
          <select
            aria-label={`${which} graph dot`}
            value={anchor.dotId}
            onChange={(e) => setAnchor({ ...anchor, dotId: e.target.value })}
            className={selectClass}
          >
            {!anchor.dotId && <option value="">Choose a graph dot</option>}
            {dots.map(option)}
          </select>
        )}
        {anchor.kind === 'graphPoint' && (
          <>
            <select
              aria-label={`${which} axes`}
              value={anchor.axesId}
              onChange={(e) => setAnchor({ ...anchor, axesId: e.target.value })}
              className={selectClass}
            >
              {!anchor.axesId && <option value="">Choose axes</option>}
              {axes.map(option)}
            </select>
            <div className="flex flex-wrap gap-3">
              <NumberInput label="Graph x" value={anchor.x} onChange={(x) => setAnchor({ ...anchor, x })} step={0.1} />
              <NumberInput label="Graph y" value={anchor.y} onChange={(y) => setAnchor({ ...anchor, y })} step={0.1} />
            </div>
          </>
        )}
        {anchor.kind === 'object' && (
          <div className="flex flex-wrap gap-3">
            <select
              aria-label={`${which} object`}
              value={anchor.itemId}
              onChange={(e) => setAnchor({ ...anchor, itemId: e.target.value })}
              className={selectClass}
            >
              {!anchor.itemId && <option value="">Choose an object</option>}
              {objects.map(option)}
            </select>
            <select
              aria-label={`${which} edge`}
              value={anchor.edge ?? 'center'}
              onChange={(e) => setAnchor({ ...anchor, edge: e.target.value as ManimDirection | 'center' })}
              className={selectClass}
            >
              {EDGES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {anchor.kind === 'point' && (
          <div className="flex flex-wrap gap-3">
            <NumberInput label="X" value={anchor.x} onChange={(x) => setAnchor({ ...anchor, x })} step={0.1} />
            <NumberInput label="Y" value={anchor.y} onChange={(y) => setAnchor({ ...anchor, y })} step={0.1} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3 border border-rule rounded-ctl p-3 bg-ink/40">
      <div className="text-ctl font-medium text-chalk-dim">Connector ends</div>
      <p className="text-meta text-chalk-faint leading-snug">
        The ends are redrawn every frame, so the line moves with what it follows (for example a dot
        moving along a graph).
      </p>
      {endEditor('start')}
      {endEditor('end')}
      {status.error != null && <p className="text-meta text-warn">{status.error}</p>}
      <button
        type="button"
        className="self-start text-ctl px-2 py-1 rounded-ctl bg-raised text-chalk hover:bg-rule"
        onClick={() => commit(null)}
        title="Keep the line where it is now and stop following"
      >
        Unbind ends
      </button>
    </div>
  );
}
