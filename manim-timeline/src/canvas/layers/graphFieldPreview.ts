import type { GraphFieldColormap, GraphFieldItem } from '@/types/scene';
import { FIELD_COLORMAP_HEX } from '@/codegen/fieldColormap';

export function evalGraphField(
  item: Pick<
    GraphFieldItem,
    | 'fieldMode'
    | 'jsExprSlope'
    | 'slopeArrowLength'
    | 'jsExprP'
    | 'jsExprQ'
  >,
  x: number,
  y: number,
): [number, number] | null {
  const mode = item.fieldMode ?? 'none';
  if (mode === 'none') return null;
  try {
    if (mode === 'slope') {
      const js = (item.jsExprSlope ?? '0').trim() || '0';
      const f = new Function('x', 'y', `return (${js})`)(x, y) as number;
      if (!isFinite(f)) return null;
      const L = item.slopeArrowLength ?? 0.5;
      const den = Math.sqrt(1 + f * f);
      return [L / den, (L * f) / den];
    }
    const pEx = (item.jsExprP ?? '1').trim() || '0';
    const qEx = (item.jsExprQ ?? '0').trim() || '0';
    const px = new Function('x', 'y', `return (${pEx})`)(x, y) as number;
    const py = new Function('x', 'y', `return (${qEx})`)(x, y) as number;
    if (!isFinite(px) || !isFinite(py)) return null;
    return [px, py];
  } catch {
    return null;
  }
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/** Map scalar to hex color along named colormap stops. */
export function colorForMagnitude(
  mag: number,
  cmap: GraphFieldColormap | undefined,
  minV: number,
  maxV: number,
): string {
  const stops = FIELD_COLORMAP_HEX[cmap ?? 'viridis'] ?? FIELD_COLORMAP_HEX.viridis;
  if (maxV <= minV) return stops[0] ?? '#888888';
  const t = clamp01((mag - minV) / (maxV - minV));
  const n = stops.length - 1;
  const f = t * n;
  const i = Math.min(n - 1, Math.floor(f));
  const u = f - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  const ha = parseInt(a.slice(1), 16);
  const hb = parseInt(b.slice(1), 16);
  const ra = (ha >> 16) & 255;
  const ga = (ha >> 8) & 255;
  const ba = ha & 255;
  const rb = (hb >> 16) & 255;
  const gb = (hb >> 8) & 255;
  const bb = hb & 255;
  const r = Math.round(ra + u * (rb - ra));
  const g = Math.round(ga + u * (gb - ga));
  const bl = Math.round(ba + u * (bb - ba));
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}

export function rk4Step2d(
  fx: (x: number, y: number) => [number, number] | null,
  x: number,
  y: number,
  dt: number,
): [number, number] | null {
  const k1 = fx(x, y);
  if (!k1) return null;
  const k2 = fx(x + (dt / 2) * k1[0], y + (dt / 2) * k1[1]);
  if (!k2) return null;
  const k3 = fx(x + (dt / 2) * k2[0], y + (dt / 2) * k2[1]);
  if (!k3) return null;
  const k4 = fx(x + dt * k3[0], y + dt * k3[1]);
  if (!k4) return null;
  return [
    x + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    y + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
  ];
}
