import { useEffect, useRef } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { measureLine } from './measureClient';
import { MEASURE_DEBOUNCE_MS } from '@/lib/constants';
import type { TextLineItem } from '@/types/scene';

/**
 * Debounced measurement hook. Attach to the property panel:
 * whenever the inspected TextLineItem's raw/font/fontSize/segments change,
 * fire a measure request and write the result into the store.
 */
export function useMeasureLine(item: TextLineItem | null) {
  const measureConfig = useSceneStore((s) => s.measureConfig);
  const setMeasureResult = useSceneStore((s) => s.setMeasureResult);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const raw = item?.raw;
  const font = item?.font;
  const fontSize = item?.fontSize;
  const segJson = item ? JSON.stringify(item.segments.map((s) => [s.color, s.bold, s.italic])) : '';
  const itemId = item?.id;

  useEffect(() => {
    if (!item || !itemId || !measureConfig.enabled || !raw) return;

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const { result, error } = await measureLine(
          measureConfig.url,
          item,
          measureConfig.includePreview,
        );
        setMeasureResult(itemId, result, error);
      } catch (e) {
        setMeasureResult(itemId, null, String(e));
      }
    }, MEASURE_DEBOUNCE_MS);

    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, font, fontSize, segJson, itemId, measureConfig.enabled, measureConfig.url, measureConfig.includePreview]);
}
