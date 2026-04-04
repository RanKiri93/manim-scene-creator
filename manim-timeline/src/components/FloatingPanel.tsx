import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type FloatingPanelSize = { w: number; h: number };

const DEFAULT_SIZE: FloatingPanelSize = { w: 360, h: 420 };

function defaultPosition(size: FloatingPanelSize): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 24, y: 72 };
  return {
    x: Math.max(16, window.innerWidth - size.w - 24),
    y: 72,
  };
}

type FloatingPanelProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  defaultSize?: FloatingPanelSize;
};

export default function FloatingPanel({
  title,
  onClose,
  children,
  defaultSize = DEFAULT_SIZE,
}: FloatingPanelProps) {
  const [pos, setPos] = useState(() => defaultPosition(defaultSize));
  const posRef = useRef(pos);
  posRef.current = pos;

  const sizeRef = useRef(defaultSize);
  sizeRef.current = defaultSize;

  const dragRef = useRef<{ active: boolean; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current?.active) return;
      const d = dragRef.current;
      const { w, h } = sizeRef.current;
      const maxX = Math.max(16, window.innerWidth - w - 8);
      const maxY = Math.max(16, window.innerHeight - h - 16);
      setPos({
        x: Math.max(8, Math.min(e.clientX - d.offsetX, maxX)),
        y: Math.max(8, Math.min(e.clientY - d.offsetY, maxY)),
      });
    };
    const onUp = () => {
      if (dragRef.current) dragRef.current.active = false;
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

  const { w, h } = defaultSize;

  return (
    <div
      className="fixed z-50 flex flex-col bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: w, height: h }}
    >
      <div
        className="flex items-center gap-2 px-2 py-2 border-b border-slate-700 bg-slate-800 shrink-0 cursor-grab active:cursor-grabbing select-none touch-none"
        onPointerDown={onDragHandlePointerDown}
        role="presentation"
      >
        <span className="text-xs font-semibold text-slate-200 flex-1 truncate">{title}</span>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-slate-100 hover:bg-slate-700 text-lg leading-none"
          title="Close"
          aria-label={`Close ${title}`}
        >
          ×
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3">{children}</div>
    </div>
  );
}
