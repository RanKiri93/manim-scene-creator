import { useSceneStore } from '@/store/useSceneStore';
import type { ManimDirection, SceneItem, ShapeAnchor, ShapeEndpoints, ShapeItem } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { frameCenterById } from '@/lib/frameGrid';
import {
  OBJECT_ANCHOR_KINDS,
  connectorStaticGeometry,
  isConnectorShape,
  resolveConnectorEndpoints,
} from '@/lib/shapeAnchors';

type AnchorKind = 'point' | 'graphPoint' | 'graphDot' | 'graphDotFootX' | 'graphDotFootY' | 'object';

type LineMode = 'segment' | 'through' | 'tangent';

const LINE_MODES: { value: LineMode; label: string }[] = [
  { value: 'segment', label: 'Segment between the ends' },
  { value: 'through', label: 'Line through both ends' },
  { value: 'tangent', label: 'Tangent at a graph dot' },
];

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
  const lineMode: LineMode = endpoints.tangent ? 'tangent' : (endpoints.extend ?? 0) > 0 ? 'through' : 'segment';

  const setLineMode = (mode: LineMode) => {
    if (mode === lineMode) return;
    const { tangent: _tangent, extend: _extend, ...plain } = endpoints;
    void _tangent;
    void _extend;
    if (mode === 'tangent') {
      const start: ShapeAnchor =
        endpoints.start.kind === 'graphDot' ? endpoints.start : { kind: 'graphDot', dotId: dots[0]?.id ?? '' };
      commit({ ...plain, start, end: start, tangent: { length: 2 } });
      return;
    }
    // Leaving a tangent: its end was the dot itself, so pin the end where the tangent ends now.
    let end = plain.end;
    if (endpoints.tangent && status.error == null) {
      const fc = frameCenterById(frames, item.frameId ?? startFrameId);
      end = { kind: 'point', x: status.end.x - fc.x, y: status.end.y - fc.y };
    }
    commit({ ...plain, end, ...(mode === 'through' ? { extend: 1 } : {}) });
  };

  const tangentEditor = () => {
    const tangent = endpoints.tangent!;
    const start = endpoints.start;
    const dotId = start.kind === 'graphDot' ? start.dotId : '';
    const dot = items.get(dotId);
    const plots = [...items.values()].filter(
      (it) => it.kind === 'graphPlot' && dot?.kind === 'graphDot' && it.axesId === dot.axesId,
    );
    return (
      <div className="flex flex-col gap-2">
        <label className="text-ctl text-chalk-dim block">
          Touches the graph at
          <select
            aria-label="Tangent graph dot"
            value={dotId}
            onChange={(e) => {
              const next: ShapeAnchor = { kind: 'graphDot', dotId: e.target.value };
              commit({ ...endpoints, start: next, end: next, tangent: { length: tangent.length } });
            }}
            className={selectClass}
          >
            {!dotId && <option value="">Choose a graph dot</option>}
            {dots.map((it) => (
              <option key={it.id} value={it.id}>
                {itemClipDisplayName(it)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-ctl text-chalk-dim block">
          Slope from
          <select
            aria-label="Tangent plot"
            value={tangent.plotId ?? ''}
            onChange={(e) => {
              const { plotId: _old, ...rest } = tangent;
              void _old;
              commit({ ...endpoints, tangent: e.target.value ? { ...rest, plotId: e.target.value } : rest });
            }}
            className={selectClass}
          >
            <option value="">The plot the dot is on</option>
            {plots.map((it) => (
              <option key={it.id} value={it.id}>
                {itemClipDisplayName(it)}
              </option>
            ))}
          </select>
        </label>
        <NumberInput
          label="Length"
          value={tangent.length}
          min={0.1}
          step={0.1}
          onChange={(length) => commit({ ...endpoints, tangent: { ...tangent, length: Math.max(0.1, length) } })}
        />
        {status.error == null && status.slope != null && (
          <p className="text-meta text-chalk-faint">Slope here: {status.slope.toFixed(3)}</p>
        )}
      </div>
    );
  };

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
        The line is redrawn every frame, so it moves with what it follows (for example a dot moving
        along a graph).
      </p>
      <label className="text-ctl text-chalk-dim block">
        Line
        <select value={lineMode} onChange={(e) => setLineMode(e.target.value as LineMode)} className={selectClass}>
          {LINE_MODES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {lineMode === 'tangent' ? (
        tangentEditor()
      ) : (
        <>
          {endEditor('start')}
          {endEditor('end')}
          {lineMode === 'through' && (
            <NumberInput
              label="Past each end"
              value={endpoints.extend ?? 0}
              min={0}
              step={0.1}
              onChange={(extend) => commit({ ...endpoints, extend: Math.max(0, extend) })}
            />
          )}
        </>
      )}
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
