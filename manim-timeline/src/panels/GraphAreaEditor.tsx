import { useCallback, useMemo } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type {
  GraphAreaCurveSource,
  GraphAreaItem,
  GraphAreaMode,
  GraphPoint2,
  ItemId,
  SceneItem,
} from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import AxesIdSelect from './AxesIdSelect';

interface GraphAreaEditorProps {
  item: GraphAreaItem;
}

function defaultCorner(i: number): GraphPoint2 {
  const pts: GraphPoint2[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1.5, y: 1 },
    { x: 0.5, y: 1 },
  ];
  return pts[i] ?? { x: 0, y: 0 };
}

export default function GraphAreaEditor({ item }: GraphAreaEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const itemsMap = useSceneStore((s) => s.items);

  const set = useCallback(
    (patch: Partial<GraphAreaItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const plotOptions = useMemo(() => {
    return Array.from(itemsMap.values())
      .filter(
        (it): it is Extract<SceneItem, { kind: 'graphPlot' }> =>
          it.kind === 'graphPlot' && it.axesId === item.axesId,
      )
      .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  }, [itemsMap, item.axesId]);

  const setMode = (next: GraphAreaMode) => set({ mode: next });

  const onKindChange = (k: GraphAreaMode['areaKind']) => {
    switch (k) {
      case 'underCurve':
        setMode({
          areaKind: 'underCurve',
          xMin: -1,
          xMax: 1,
          curve: { sourceKind: 'expr', jsExpr: '0', pyExpr: '0' },
          showBoundaryPlot: false,
        });
        break;
      case 'betweenCurves':
        setMode({
          areaKind: 'betweenCurves',
          xMin: -1,
          xMax: 1,
          lower: { sourceKind: 'expr', jsExpr: '0', pyExpr: '0' },
          upper: { sourceKind: 'expr', jsExpr: 'x', pyExpr: 'x' },
          showBoundaryPlot: false,
        });
        break;
      case 'parallelogramFour':
        setMode({
          areaKind: 'parallelogramFour',
          corners: [
            defaultCorner(0),
            defaultCorner(1),
            defaultCorner(2),
            defaultCorner(3),
          ],
        });
        break;
      case 'parallelogramVec':
        setMode({
          areaKind: 'parallelogramVec',
          ox: 0,
          oy: 0,
          ux: 1,
          uy: 0,
          vx: 0,
          vy: 1,
        });
        break;
      case 'disk':
        setMode({ areaKind: 'disk', cx: 0, cy: 0, radius: 1 });
        break;
      default:
        break;
    }
  };

  const curveSourceEditor = (
    label: string,
    src: GraphAreaCurveSource,
    onChange: (c: GraphAreaCurveSource) => void,
  ) => (
    <div className="flex flex-col gap-1 border border-slate-700 rounded p-2 bg-slate-800/40">
      <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
      <select
        value={src.sourceKind}
        onChange={(e) => {
          const sk = e.target.value as GraphAreaCurveSource['sourceKind'];
          if (sk === 'plot') {
            const pid = plotOptions[0]?.id ?? '';
            onChange({ sourceKind: 'plot', plotId: pid });
          } else {
            onChange({ sourceKind: 'expr', jsExpr: '0', pyExpr: '0' });
          }
        }}
        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
      >
        <option value="expr">Expression</option>
        <option value="plot" disabled={plotOptions.length === 0}>
          Existing plot clip
        </option>
      </select>
      {src.sourceKind === 'plot' ? (
        <select
          value={src.plotId}
          onChange={(e) => onChange({ sourceKind: 'plot', plotId: e.target.value as ItemId })}
          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          {plotOptions.length === 0 ? (
            <option value="">No plots on this axes</option>
          ) : (
            plotOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {(p.label || p.fn.pyExpr).slice(0, 40)}
              </option>
            ))
          )}
        </select>
      ) : (
        <>
          <input
            type="text"
            value={src.jsExpr}
            onChange={(e) => onChange({ ...src, jsExpr: e.target.value })}
            placeholder="JS y(x)"
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs font-mono text-slate-300"
          />
          <input
            type="text"
            value={src.pyExpr}
            onChange={(e) => onChange({ ...src, pyExpr: e.target.value })}
            placeholder="Python y(x)"
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs font-mono text-slate-300"
          />
        </>
      )}
    </div>
  );

  const m = item.mode;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Graph area</h3>
      <label className="text-xs text-slate-400 block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>
      <AxesIdSelect value={item.axesId} onChange={(axesId) => set({ axesId })} />

      <label className="text-xs text-slate-400 block">
        Area type
        <select
          value={m.areaKind}
          onChange={(e) => onKindChange(e.target.value as GraphAreaMode['areaKind'])}
          className="mt-1 w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          <option value="underCurve">Under one curve (to x-axis)</option>
          <option value="betweenCurves">Between two curves</option>
          <option value="parallelogramFour">Parallelogram (4 corners)</option>
          <option value="parallelogramVec">Parallelogram (origin + 2 vectors)</option>
          <option value="disk">Disk (ellipse in preview)</option>
        </select>
      </label>

      {m.areaKind === 'underCurve' && (
        <>
          <div className="flex flex-wrap gap-2">
            <NumberInput label="x min" value={m.xMin} onChange={(v) => setMode({ ...m, xMin: v })} />
            <NumberInput label="x max" value={m.xMax} onChange={(v) => setMode({ ...m, xMax: v })} />
          </div>
          {curveSourceEditor('Curve', m.curve, (curve) => setMode({ ...m, curve }))}
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={m.showBoundaryPlot}
              onChange={(e) => setMode({ ...m, showBoundaryPlot: e.target.checked })}
            />
            Animate boundary plot (expr only)
          </label>
        </>
      )}

      {m.areaKind === 'betweenCurves' && (
        <>
          <div className="flex flex-wrap gap-2">
            <NumberInput label="x min" value={m.xMin} onChange={(v) => setMode({ ...m, xMin: v })} />
            <NumberInput label="x max" value={m.xMax} onChange={(v) => setMode({ ...m, xMax: v })} />
          </div>
          {curveSourceEditor('Lower curve', m.lower, (lower) => setMode({ ...m, lower }))}
          {curveSourceEditor('Upper curve', m.upper, (upper) => setMode({ ...m, upper }))}
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={m.showBoundaryPlot}
              onChange={(e) => setMode({ ...m, showBoundaryPlot: e.target.checked })}
            />
            Animate expr boundary plots
          </label>
        </>
      )}

      {m.areaKind === 'parallelogramFour' && (
        <div className="grid grid-cols-2 gap-2">
          {m.corners.map((c, i) => (
            <div key={i} className="flex flex-col gap-1 border border-slate-700 rounded p-2">
              <span className="text-[10px] text-slate-500">Corner {i + 1}</span>
              <NumberInput
                label="x"
                value={c.x}
                onChange={(v) => {
                  const corners = [...m.corners] as [GraphPoint2, GraphPoint2, GraphPoint2, GraphPoint2];
                  corners[i] = { ...corners[i]!, x: v };
                  setMode({ areaKind: 'parallelogramFour', corners });
                }}
              />
              <NumberInput
                label="y"
                value={c.y}
                onChange={(v) => {
                  const corners = [...m.corners] as [GraphPoint2, GraphPoint2, GraphPoint2, GraphPoint2];
                  corners[i] = { ...corners[i]!, y: v };
                  setMode({ areaKind: 'parallelogramFour', corners });
                }}
              />
            </div>
          ))}
        </div>
      )}

      {m.areaKind === 'parallelogramVec' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <NumberInput label="Origin x" value={m.ox} onChange={(v) => setMode({ ...m, ox: v })} />
            <NumberInput label="Origin y" value={m.oy} onChange={(v) => setMode({ ...m, oy: v })} />
          </div>
          <div className="flex flex-wrap gap-2">
            <NumberInput label="u_x" value={m.ux} onChange={(v) => setMode({ ...m, ux: v })} />
            <NumberInput label="u_y" value={m.uy} onChange={(v) => setMode({ ...m, uy: v })} />
          </div>
          <div className="flex flex-wrap gap-2">
            <NumberInput label="v_x" value={m.vx} onChange={(v) => setMode({ ...m, vx: v })} />
            <NumberInput label="v_y" value={m.vy} onChange={(v) => setMode({ ...m, vy: v })} />
          </div>
        </div>
      )}

      {m.areaKind === 'disk' && (
        <div className="flex flex-wrap gap-2">
          <NumberInput label="Center x" value={m.cx} onChange={(v) => setMode({ ...m, cx: v })} />
          <NumberInput label="Center y" value={m.cy} onChange={(v) => setMode({ ...m, cy: v })} />
          <NumberInput label="Radius (x-units)" value={m.radius} onChange={(v) => setMode({ ...m, radius: v })} min={0.01} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <ColorPicker value={item.fillColor} onChange={(c) => set({ fillColor: c })} />
        <NumberInput
          label="Fill opacity"
          value={item.fillOpacity}
          onChange={(v) => set({ fillOpacity: Math.max(0, Math.min(1, v)) })}
          min={0}
          max={1}
          step={0.05}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ColorPicker value={item.strokeColor} onChange={(c) => set({ strokeColor: c })} />
        <NumberInput label="Stroke width" value={item.strokeWidth} onChange={(v) => set({ strokeWidth: Math.max(0, v) })} min={0} step={0.5} />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-end gap-3 flex-wrap">
          <NumberInput label="Start (s)" value={item.startTime} onChange={(v) => set({ startTime: v })} min={0} />
          <NumberInput label="Duration" value={item.duration} onChange={(v) => set({ duration: v })} min={0.01} />
          <NumberInput label="Layer" value={item.layer} onChange={(v) => set({ layer: Math.round(v) })} min={0} step={1} />
        </div>
        <p className="text-[10px] text-slate-500 leading-snug max-w-md">
          Areas use a lower stack rank than curves by default so fills stay behind plots.
        </p>
      </div>
    </div>
  );
}
