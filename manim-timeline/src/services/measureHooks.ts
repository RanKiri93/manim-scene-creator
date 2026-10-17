import { useEffect, useRef } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { measureLine, measureMatrix } from './measureClient';
import { MEASURE_DEBOUNCE_MS } from '@/lib/constants';
import { matrixMeasureKey } from '@/lib/matrix';
import { matrixStates } from '@/lib/matrixSteps';
import type { ItemId, MatrixItem, TextLineItem } from '@/types/scene';

/**
 * Keep every matrix in the scene measured, and the result of each of its matrix steps: whenever
 * their typeset fields change (see `matrixMeasureKey`), wait for edits to settle, then ask the
 * measure server for the geometry and preview. Unlike text lines this runs for all matrices, not just the inspected one, so a matrix
 * the Copilot or a paste changed is previewed too. Mount once (the scene canvas does).
 */
export function useMeasureMatrices() {
  const items = useSceneStore((s) => s.items);
  const measureConfig = useSceneStore((s) => s.measureConfig);
  const setMatrixMeasure = useSceneStore((s) => s.setMatrixMeasure);
  const setMatrixStepMeasure = useSceneStore((s) => s.setMatrixStepMeasure);
  const inFlight = useRef(new Map<ItemId, string>());

  useEffect(() => {
    if (!measureConfig.enabled) return;
    // Every matrix, and the result of each of its steps (`id` = the matrix or the step clip).
    const stale: { id: ItemId; view: MatrixItem; key: string; save: typeof setMatrixMeasure }[] = [];
    for (const item of items.values()) {
      if (item.kind !== 'matrix') continue;
      for (const state of matrixStates(item, items)) {
        const id = state.clip?.id ?? item.id;
        const key = matrixMeasureKey(state.view);
        if (state.view.measureKey === key || inFlight.current.get(id) === key) continue;
        stale.push({ id, view: state.view, key, save: state.clip ? setMatrixStepMeasure : setMatrixMeasure });
      }
    }
    if (stale.length === 0) return;
    const timer = setTimeout(() => {
      for (const { id, view, key, save } of stale) {
        inFlight.current.set(id, key);
        measureMatrix(measureConfig.url, view, measureConfig.includePreview)
          .then((r) => save(id, key, r.measure ? { measure: r.measure, previewDataUrl: r.previewDataUrl } : null, r.error))
          .catch((e: unknown) => save(id, key, null, String(e)))
          .finally(() => {
            if (inFlight.current.get(id) === key) inFlight.current.delete(id);
          });
      }
    }, MEASURE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [items, measureConfig.enabled, measureConfig.url, measureConfig.includePreview, setMatrixMeasure, setMatrixStepMeasure]);
}

/**
 * Debounced measurement hook. Attach to the property panel:
 * whenever the inspected TextLineItem's raw/font/fontSize/baseDir/englishFont/segments change,
 * fire a measure request and write the result into the store.
 */
export function useMeasureLine(item: TextLineItem | null) {
  const measureConfig = useSceneStore((s) => s.measureConfig);
  const setMeasureResult = useSceneStore((s) => s.setMeasureResult);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const raw = item?.raw;
  const font = item?.font;
  const fontSize = item?.fontSize;
  const baseDir = item?.baseDir;
  const englishFont = item?.englishFont;
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
  }, [raw, font, fontSize, baseDir, englishFont, segJson, itemId, measureConfig.enabled, measureConfig.url, measureConfig.includePreview]);
}
