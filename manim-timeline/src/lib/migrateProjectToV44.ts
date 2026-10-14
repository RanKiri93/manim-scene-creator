import type { GraphDot, ManimDirection, SceneItem } from '@/types/scene';

function oppositeDirection(direction: ManimDirection): ManimDirection {
  const opposite: Record<ManimDirection, ManimDirection> = {
    UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT',
    UL: 'DR', UR: 'DL', DL: 'UR', DR: 'UL',
  };
  return opposite[direction];
}

/** Add graph-dot attachment and independent annotation defaults without changing V43 rows. */
export function migrateItemsToV44(items: readonly SceneItem[]): SceneItem[] {
  return items.map((item) => {
    if (item.kind !== 'graphDot') return { ...item };
    const dot: GraphDot = item.dot;
    return {
      ...item,
      dot: {
        ...dot,
        attachment: dot.attachment ?? { kind: 'free' },
        showCoordinates: dot.showCoordinates ?? false,
        showProjectionGuides: dot.showProjectionGuides ?? false,
        labelFontSize: dot.labelFontSize ?? 18,
        labelColor: dot.labelColor ?? '#ffffff',
        labelSpacing: dot.labelSpacing ?? 0.15,
        coordinateFontSize: dot.coordinateFontSize ?? 18,
        coordinateColor: dot.coordinateColor ?? '#e2e8f0',
        coordinateDir: dot.coordinateDir ?? oppositeDirection(dot.labelDir),
        coordinateSpacing: dot.coordinateSpacing ?? 0.15,
        coordinatePrecision: Number.isFinite(dot.coordinatePrecision)
          ? Math.max(0, Math.min(6, Math.trunc(dot.coordinatePrecision!)))
          : 2,
      },
    };
  });
}
