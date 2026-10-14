import { useCallback, useEffect, useRef, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { resolveGraphDotPosition } from '@/lib/graphMotion';
import type { GraphDotAttachment, GraphDotItem } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import ColorPicker from '@/components/ColorPicker';
import DirectionPicker from '@/components/DirectionPicker';
import FloatingPanel from '@/components/FloatingPanel';
import AxesIdSelect from './AxesIdSelect';
import AudioBindingSelect from './AudioBindingSelect';
import PropertyTabs from './PropertyTabs';
import VisibleAtSceneStartRow from './VisibleAtSceneStartRow';

interface GraphDotEditorProps {
  item: GraphDotItem;
}

export default function GraphDotEditor({ item }: GraphDotEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const setItemAudioBinding = useSceneStore((s) => s.setItemAudioBinding);
  const graphMotionDiagnostics = useSceneStore((s) => s.graphMotionDiagnostics);
  const itemsMap = useSceneStore((s) => s.items);
  const currentTime = useSceneStore((s) => s.currentTime);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const labelsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const labelsScopeRef = useRef<HTMLDivElement | null>(null);
  const popoverPointerEventsRef = useRef(new WeakSet<Event>());

  const set = useCallback(
    (patch: Partial<GraphDotItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const dot = item.dot;
  const patchDot = (p: Partial<typeof dot>) => set({ dot: { ...dot, ...p } });
  const attachment = dot.attachment ?? { kind: 'free' as const };
  const graphPlots = [...itemsMap.values()].filter((candidate) => candidate.kind === 'graphPlot' && candidate.axesId === item.axesId);
  const graphCurves = [...itemsMap.values()].filter((candidate) => candidate.kind === 'graphCurve' && candidate.axesId === item.axesId);
  const sourceDiagnostics = graphMotionDiagnostics(item.id);
  const closeLabels = useCallback((restoreFocus = true) => {
    setLabelsOpen(false);
    if (restoreFocus) requestAnimationFrame(() => labelsTriggerRef.current?.focus());
  }, []);
  useEffect(() => {
    if (!labelsOpen) return;
    const focusFrame = requestAnimationFrame(() => {
      const scope = labelsScopeRef.current;
      (scope?.querySelector<HTMLElement>('input:not([type="hidden"]), select') ?? scope?.querySelector<HTMLElement>('button'))?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeLabels();
        return;
      }
      if (event.key !== 'Tab') return;
      const scope = labelsScopeRef.current;
      if (!scope) return;
      const focusable = [...scope.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target;
      const path = event.composedPath();
      const insideByReactPortal = popoverPointerEventsRef.current.has(event);
      const insideByDom = target instanceof Node && (labelsScopeRef.current?.contains(target) || labelsTriggerRef.current?.contains(target));
      if (insideByReactPortal || insideByDom || path.some((entry) => entry instanceof Element && entry.hasAttribute('data-graph-dot-label-popover-portal'))) return;
      closeLabels(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onDocumentPointerDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onDocumentPointerDown);
    };
  }, [labelsOpen, closeLabels]);
  const setAttachment = (value: GraphDotAttachment) => patchDot({ attachment: value });

  const baseContent = (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Graph dot</h3>
      <label className="text-xs text-slate-400 block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Fixed point A — optional; exit target menu prefers this over dot label"
          className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>
      <AxesIdSelect value={item.axesId} onChange={(axesId) => set({ axesId })} />
      <label className="text-xs text-slate-400 block" dir="rtl">
        חיבור הנקודה
        <select value={attachment.kind} onChange={(event) => {
          if (event.target.value === 'free') {
            const resolved = resolveGraphDotPosition({ dot: item, items: [...itemsMap.values()], time: currentTime });
            set({ dot: { ...dot, attachment: { kind: 'free' }, dx: resolved.point.x, dy: resolved.point.y } });
          }
          else if (event.target.value === 'function') {
            const plot = graphPlots.length === 1 ? graphPlots[0] : null;
            setAttachment({ kind: 'function', graphPlotId: plot?.kind === 'graphPlot' ? plot.id : '', x: dot.dx });
          } else {
            const curve = graphCurves.length === 1 ? graphCurves[0] : null;
            setAttachment({ kind: 'parametric', graphCurveId: curve?.kind === 'graphCurve' ? curve.id : '', t: curve?.kind === 'graphCurve' ? curve.tDomain[0] : 0 });
          }
        }} className="mt-1 block w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200">
          <option value="free">נקודה חופשית</option><option value="function">מחוברת לפונקציה y=f(x)</option><option value="parametric">מחוברת לעקומה פרמטרית</option>
        </select>
      </label>
      {attachment.kind === 'free' ? <div className="flex items-center gap-2 flex-wrap"><NumberInput label="x" value={dot.dx} onChange={(v) => patchDot({ dx: v })} /><NumberInput label="y" value={dot.dy} onChange={(v) => patchDot({ dy: v })} /></div> : null}
      {attachment.kind === 'function' ? <div className="flex flex-wrap items-end gap-2" dir="rtl">
        <label className="text-xs text-slate-400">פונקציה<select value={attachment.graphPlotId} onChange={(event) => setAttachment({ ...attachment, graphPlotId: event.target.value })} className="block bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"><option value="">בחרו פונקציה</option>{graphPlots.map((plot) => plot.kind === 'graphPlot' ? <option key={plot.id} value={plot.id}>{plot.fn.label || plot.fn.jsExpr}</option> : null)}</select></label>
        <NumberInput label="x" value={attachment.x} onChange={(x) => setAttachment({ ...attachment, x })} />
      </div> : null}
      {attachment.kind === 'parametric' ? <div className="flex flex-wrap items-end gap-2" dir="rtl">
        <label className="text-xs text-slate-400">עקומה<select value={attachment.graphCurveId} onChange={(event) => setAttachment({ ...attachment, graphCurveId: event.target.value })} className="block bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"><option value="">בחרו עקומה</option>{graphCurves.map((curve) => curve.kind === 'graphCurve' ? <option key={curve.id} value={curve.id}>{curve.curve.label || `(${curve.curve.jsXExpr}, ${curve.curve.jsYExpr})`}</option> : null)}</select></label>
        <NumberInput label="t" value={attachment.t} onChange={(t) => setAttachment({ ...attachment, t })} />
      </div> : null}
      {sourceDiagnostics.map((diagnostic) => <p key={diagnostic} className="text-xs text-amber-300">{diagnostic}</p>)}
      <button ref={labelsTriggerRef} type="button" aria-haspopup="dialog" aria-expanded={labelsOpen} onClick={() => setLabelsOpen(true)} className="self-start rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700">Labels &amp; coordinates…</button>
    </div>
  );

  const styleContent = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400">Dot color</span>
        <ColorPicker value={dot.color} onChange={(c) => patchDot({ color: c })} />
        <NumberInput label="Radius" value={dot.radius} onChange={(v) => patchDot({ radius: v })} min={0.01} step={0.01} />
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
        <p className="text-[10px] text-slate-500 leading-snug max-w-md">
          Raise Layer above the plot&apos;s Layer to draw this dot on top (preview + Manim export). Same Layer: dots
          render above curves by default.
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
    <>
      <PropertyTabs
        key={item.id}
        defaultTabId="base"
        tabs={[
          { id: 'base', label: 'Base', content: baseContent },
          { id: 'style', label: 'Style', content: styleContent },
          { id: 'animation', label: 'Animation / Audio', content: animationContent },
        ]}
      />
      {labelsOpen ? <div ref={labelsScopeRef} data-graph-dot-label-popover-scope onPointerDownCapture={(event) => popoverPointerEventsRef.current.add(event.nativeEvent)}>
        <FloatingPanel title="Labels & coordinates" onClose={() => closeLabels()} defaultSize={{ w: 390, h: 490 }}>
        <div className="flex flex-col gap-4" dir="rtl">
          <label className="text-xs text-slate-300 flex items-center gap-2"><input type="checkbox" checked={dot.showCoordinates === true} onChange={(event) => patchDot({ showCoordinates: event.target.checked })} />הצגת קואורדינטות</label>
          <label className="text-xs text-slate-300 flex items-center gap-2"><input type="checkbox" checked={dot.showProjectionGuides === true} onChange={(event) => patchDot({ showProjectionGuides: event.target.checked })} />הצגת קווי הקרנה</label>
          <label className="text-xs text-slate-300">תווית קבועה<input type="text" value={dot.label} onChange={(event) => patchDot({ label: event.target.value })} className="mt-1 block w-full rounded border border-slate-600 bg-slate-800 px-2 py-1" /></label>
          <div className="flex flex-wrap items-center gap-3"><NumberInput label="גודל תווית" value={dot.labelFontSize ?? 18} onChange={(labelFontSize) => patchDot({ labelFontSize })} min={6} max={72} /><ColorPicker value={dot.labelColor ?? '#ffffff'} onChange={(labelColor) => patchDot({ labelColor })} /><DirectionPicker label="כיוון תווית" value={dot.labelDir} onChange={(labelDir) => patchDot({ labelDir })} /><NumberInput label="מרווח" value={dot.labelSpacing ?? 0.15} onChange={(labelSpacing) => patchDot({ labelSpacing })} min={0} step={0.01} /></div>
          <div className="flex flex-wrap items-center gap-3"><NumberInput label="גודל קואורדינטות" value={dot.coordinateFontSize ?? 18} onChange={(coordinateFontSize) => patchDot({ coordinateFontSize })} min={6} max={72} /><ColorPicker value={dot.coordinateColor ?? '#e2e8f0'} onChange={(coordinateColor) => patchDot({ coordinateColor })} /><DirectionPicker label="כיוון קואורדינטות" value={dot.coordinateDir ?? 'DOWN'} onChange={(coordinateDir) => patchDot({ coordinateDir })} /><NumberInput label="מרווח" value={dot.coordinateSpacing ?? 0.15} onChange={(coordinateSpacing) => patchDot({ coordinateSpacing })} min={0} step={0.01} /><NumberInput label="דיוק עשרוני" value={dot.coordinatePrecision ?? 2} onChange={(coordinatePrecision) => patchDot({ coordinatePrecision: Math.max(0, Math.min(6, Math.trunc(coordinatePrecision))) })} min={0} max={6} step={1} /></div>
        </div>
        </FloatingPanel>
      </div> : null}
    </>
  );
}
