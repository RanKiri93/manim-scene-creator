import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import LineEditor from './LineEditor';
import AxesEditor from './AxesEditor';
import GraphPlotEditor from './GraphPlotEditor';
import GraphDotEditor from './GraphDotEditor';
import GraphFieldEditor from './GraphFieldEditor';
import FunctionSeriesEditor from './FunctionSeriesEditor';
import GraphAreaEditor from './GraphAreaEditor';
import ExitAnimationEditor from './ExitAnimationEditor';
import SurroundingRectEditor from './SurroundingRectEditor';
import ShapeEditor from './ShapeEditor';

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;

function defaultPanelPosition(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 400, y: 16 };
  return { x: Math.max(16, window.innerWidth - MIN_WIDTH - 16), y: 16 };
}

export default function PropertyPanel() {
  const inspectedId = useSceneStore((s) => s.inspectedId);
  const itemsMap = useSceneStore((s) => s.items);
  const clearSelection = useSceneStore((s) => s.clearSelection);

  const [pos, setPos] = useState(defaultPanelPosition);
  const posRef = useRef(pos);
  posRef.current = pos;

  const [size, setSize] = useState({ w: MIN_WIDTH, h: 500 });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const dragRef = useRef<{ active: boolean; offsetX: number; offsetY: number } | null>(null);
  const resizeRef = useRef<{ active: boolean; startW: number; startH: number; startX: number; startY: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragRef.current?.active) {
        const d = dragRef.current;
        const maxX = Math.max(16, window.innerWidth - sizeRef.current.w - 8);
        const maxY = Math.max(16, window.innerHeight - 120);
        setPos({
          x: Math.max(8, Math.min(e.clientX - d.offsetX, maxX)),
          y: Math.max(8, Math.min(e.clientY - d.offsetY, maxY)),
        });
      } else if (resizeRef.current?.active) {
        const r = resizeRef.current;
        const newW = Math.max(MIN_WIDTH, r.startW + (e.clientX - r.startX));
        const newH = Math.max(MIN_HEIGHT, r.startH + (e.clientY - r.startY));
        setSize({
          w: Math.min(newW, window.innerWidth - posRef.current.x - 16),
          h: Math.min(newH, window.innerHeight - posRef.current.y - 16),
        });
      }
    };
    const onUp = () => {
      if (dragRef.current) dragRef.current.active = false;
      if (resizeRef.current) resizeRef.current.active = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const onDragHandlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      active: true,
      offsetX: e.clientX - posRef.current.x,
      offsetY: e.clientY - posRef.current.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onResizeHandlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      active: true,
      startW: sizeRef.current.w,
      startH: sizeRef.current.h,
      startX: e.clientX,
      startY: e.clientY,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const item = inspectedId ? itemsMap.get(inspectedId) : undefined;

  if (!item) {
    return null;
  }

  let body: ReactNode;
  switch (item.kind) {
    case 'textLine':
      body = <LineEditor item={item} />;
      break;
    case 'axes':
      body = <AxesEditor item={item} />;
      break;
    case 'graphPlot':
      body = <GraphPlotEditor item={item} />;
      break;
    case 'graphDot':
      body = <GraphDotEditor item={item} />;
      break;
    case 'graphField':
      body = <GraphFieldEditor item={item} />;
      break;
    case 'graphFunctionSeries':
      body = <FunctionSeriesEditor item={item} />;
      break;
    case 'graphArea':
      body = <GraphAreaEditor item={item} />;
      break;
    case 'exit_animation':
      body = <ExitAnimationEditor item={item} />;
      break;
    case 'surroundingRect':
      body = <SurroundingRectEditor item={item} />;
      break;
    case 'shape':
      body = <ShapeEditor item={item} />;
      break;
    default:
      body = <p className="text-xs text-slate-500 p-4">Unknown item kind.</p>;
  }

  return (
    <div
      className="fixed z-50 flex flex-col bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      <div
        className="flex items-center gap-2 px-2 py-2 border-b border-slate-700 bg-slate-800 shrink-0 cursor-grab active:cursor-grabbing select-none touch-none"
        onPointerDown={onDragHandlePointerDown}
        role="presentation"
      >
        <span className="text-xs font-semibold text-slate-200 flex-1 truncate">Properties</span>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            clearSelection();
          }}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-slate-100 hover:bg-slate-700 text-lg leading-none"
          title="Close"
          aria-label="Close properties"
        >
          ×
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3">{body}</div>
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize touch-none"
        onPointerDown={onResizeHandlePointerDown}
        style={{
          background: 'linear-gradient(135deg, transparent 50%, rgba(148, 163, 184, 0.5) 50%)',
        }}
        aria-hidden="true"
      />
    </div>
  );
}
