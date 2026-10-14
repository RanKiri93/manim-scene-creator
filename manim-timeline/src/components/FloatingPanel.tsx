import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CloseIcon, IconButton } from '@/components/ui';

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
      role="dialog"
      aria-label={title}
      className="fixed z-50 flex flex-col overflow-hidden rounded-pop border border-rule bg-panel shadow-[0_18px_48px_rgb(0_0_0/0.55)]"
      style={{ left: pos.x, top: pos.y, width: w, height: h }}
    >
      <div
        className="flex shrink-0 cursor-grab touch-none items-center gap-2 border-b border-rule py-2 pr-2 pl-4 select-none active:cursor-grabbing"
        onPointerDown={onDragHandlePointerDown}
        role="presentation"
      >
        <span className="flex-1 truncate font-display text-title font-medium text-chalk">{title}</span>
        <IconButton
          label={`Close ${title}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <CloseIcon />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 text-ctl text-chalk">{children}</div>
    </div>
  );
}
