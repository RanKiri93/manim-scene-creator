import { useMemo } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { ItemId, TargetAnimationItem } from '@/types/scene';
import { itemClipDisplayName } from '@/lib/itemDisplayName';

function summarizeRow(cl: TargetAnimationItem): string {
  const row = cl.targets[0];
  if (!row) return '(no targets)';
  switch (cl.mode) {
    case 'scale':
      return typeof row.scaleFactor === 'number'
        ? `×${row.scaleFactor.toFixed(2)}`
        : 'scale';
    case 'color':
      return row.color?.trim() || 'color';
    case 'move':
      return `dx=${(row.dx ?? 0).toFixed(2)} dy=${(row.dy ?? 0).toFixed(2)}`;
    case 'path': {
      if (row.pathKind === 'parametric') {
        const p = row.parametricPath;
        return p ? `parametric t=${p.tMin.toFixed(2)}..${p.tMax.toFixed(2)}` : 'parametric';
      }
      const pts = row.pathPoints;
      if (!pts?.length) return 'path';
      const a = pts[0];
      const b = pts[pts.length - 1];
      return `Δ ${(b!.x - a!.x).toFixed(2)}, ${(b!.y - a!.y).toFixed(2)}`;
    }
    case 'rotate':
      return `${typeof row.angleDeg === 'number' ? row.angleDeg : 0}°`;
    default:
      return cl.mode;
  }
}

interface TargetAnimationEffectsNoteProps {
  targetId: ItemId;
}

/** Read-only: lists `target_animation` clips that mention this scene object. */
export default function TargetAnimationEffectsNote({
  targetId,
}: TargetAnimationEffectsNoteProps) {
  const items = useSceneStore((s) => s.items);

  const clips = useMemo(() => {
    const out = [...items.values()].filter(
      (it): it is TargetAnimationItem =>
        it.kind === 'target_animation' &&
        it.targets.some((r) => r.targetId === targetId),
    );
    out.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
    return out;
  }, [items, targetId]);

  if (clips.length === 0) return null;

  return (
    <div className="rounded border border-slate-700 bg-slate-800/35 px-2 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
        Persistent target animations
      </div>
      <ul className="flex flex-col gap-1">
        {clips.map((c) => (
          <li key={c.id} className="text-[11px] text-slate-400 leading-snug">
            <span className="text-slate-300 font-medium">{itemClipDisplayName(c)}</span>
            {' · '}
            <span className="text-sky-400/95">{c.mode}</span>
            {' @ '}
            {c.startTime.toFixed(2)}s ({c.duration.toFixed(2)}s) — {summarizeRow(c)}
          </li>
        ))}
      </ul>
    </div>
  );
}
