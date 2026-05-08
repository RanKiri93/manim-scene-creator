import type { AxesItem, SceneItem } from '@/types/scene';

function optionalPositiveNumber(v: unknown, min: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : undefined;
}

function optionalTrimmedString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * v29: `AxesItem` gains tick and number styling fields.
 */
export function migrateItemsToV29(items: readonly SceneItem[]): SceneItem[] {
  return items.map((item) => {
    if (item.kind !== 'axes') return { ...item };
    const raw = item as AxesItem & Record<string, unknown>;
    return {
      ...item,
      tickLength: optionalPositiveNumber(raw.tickLength, 0.01),
      tickColor: optionalTrimmedString(raw.tickColor),
      tickStrokeWidth: optionalPositiveNumber(raw.tickStrokeWidth, 0.5),
      numberColor: optionalTrimmedString(raw.numberColor),
      numberFontSize: optionalPositiveNumber(raw.numberFontSize, 1),
    };
  });
}
