import type { ShapePoint } from '@/types/scene';

/** Width / height of the axis-aligned bounding box of polyline points in local shape space. */
export function polylinePointExtents(points: ShapePoint[]): { w: number; h: number } {
  if (points.length === 0) return { w: 0.5, h: 0.5 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    w: Math.max(0.15, Math.max(...xs) - Math.min(...xs)),
    h: Math.max(0.15, Math.max(...ys) - Math.min(...ys)),
  };
}
