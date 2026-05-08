import type { SceneItem, ShapeItem, ShapePoint } from '@/types/scene';
import { DEFAULT_SHAPE_POLYLINE_POINTS } from '@/types/scene';

function isPoint(v: unknown): v is ShapePoint {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as ShapePoint).x === 'number' &&
    Number.isFinite((v as ShapePoint).x) &&
    typeof (v as ShapePoint).y === 'number' &&
    Number.isFinite((v as ShapePoint).y)
  );
}

/**
 * v28: `ShapeItem` gains `points`, `tailArrow`, `headArrow` for polyline support.
 */
export function migrateItemsToV28(items: readonly SceneItem[]): SceneItem[] {
  return items.map((item) => {
    if (item.kind !== 'shape') return { ...item };
    const raw = item as ShapeItem & Record<string, unknown>;
    const points = Array.isArray(raw.points) && raw.points.every(isPoint)
      ? (raw.points as ShapePoint[])
      : DEFAULT_SHAPE_POLYLINE_POINTS;
    return {
      ...item,
      points: points.map((p) => ({ ...p })),
      tailArrow: typeof raw.tailArrow === 'boolean' ? raw.tailArrow : false,
      headArrow: typeof raw.headArrow === 'boolean' ? raw.headArrow : false,
    };
  });
}
