import type { GraphFieldColormap } from '@/types/scene';

/** Few-stop gradients for Manim ArrowVectorField `colors` (Viridis-like, etc.). */
export const FIELD_COLORMAP_HEX: Record<GraphFieldColormap, string[]> = {
  viridis: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'],
  plasma: ['#0d0887', '#6a00a8', '#b12a90', '#e16462', '#fca636', '#f0f921'],
  inferno: ['#000004', '#6b1833', '#932667', '#d3436e', '#f57c15', '#fcffa4'],
  magma: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
};

export function manimColorListHex(hexes: string[]): string {
  return `[${hexes.map((h) => `ManimColor("${h}")`).join(', ')}]`;
}
