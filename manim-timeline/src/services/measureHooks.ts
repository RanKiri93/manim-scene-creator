import { useEffect, useRef } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { measureLine, measureMatrix } from './measureClient';
import { MEASURE_DEBOUNCE_MS } from '@/lib/constants';
import { matrixMeasureKey } from '@/lib/matrix';
import { matrixStates } from '@/lib/matrixSteps';
import type { ItemId, MatrixItem, MeasureResult, SceneItem, TextLineItem } from '@/types/scene';

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

/** Lines measured at once: a Copilot batch can add dozens and each is a TeX compile on the server. */
const TEXT_LINE_MEASURE_CONCURRENCY = 3;
/** `seen` value for a line whose request could not reach the server. */
const RETRY = 'retry';

/**
 * What a text line's measure and preview PNG depend on (segment colours too: the preview is
 * rendered in them), plus whether a preview was asked for.
 */
export function textLineMeasureKey(item: TextLineItem, includePreview: boolean): string {
  return JSON.stringify([
    item.raw,
    item.font ?? null,
    item.fontSize,
    item.baseDir ?? 'rtl',
    item.englishFont ?? null,
    item.segments.map((seg) => [seg.color, seg.bold, seg.italic]),
    includePreview,
  ]);
}

/**
 * Text lines that need a (new) measure. `seen` maps a line id to the key it was last measured
 * (or is being measured) under; it is updated in place. A line met for the first time that already
 * has a measure or an error (a loaded project, an earlier session) is trusted as is.
 */
export function staleTextLines(
  items: ReadonlyMap<ItemId, SceneItem>,
  seen: Map<ItemId, string>,
  includePreview: boolean,
): { item: TextLineItem; key: string }[] {
  const stale: { item: TextLineItem; key: string }[] = [];
  for (const item of items.values()) {
    if (item.kind !== 'textLine' || !item.raw.trim()) continue;
    const key = textLineMeasureKey(item, includePreview);
    const last = seen.get(item.id);
    if (last === key) continue;
    if (last === undefined && (item.measure || item.measureError)) {
      seen.set(item.id, key);
      continue;
    }
    stale.push({ item, key });
  }
  for (const id of seen.keys()) if (items.get(id)?.kind !== 'textLine') seen.delete(id);
  return stale;
}

/**
 * Keep every text line in the scene measured: when a line is created or its typeset fields change
 * (by the user, the Copilot, a paste or an undo), wait for edits to settle, then ask the measure
 * server for its geometry and preview. Runs for all lines, not just the inspected one, so a batch
 * of Copilot lines gets previews without clicking each. Mount once (the scene canvas does).
 */
export function useMeasureTextLines() {
  const items = useSceneStore((s) => s.items);
  const enabled = useSceneStore((s) => s.measureConfig.enabled);
  const url = useSceneStore((s) => s.measureConfig.url);
  const includePreview = useSceneStore((s) => s.measureConfig.includePreview);
  const seen = useRef(new Map<ItemId, string>());

  useEffect(() => {
    if (!enabled) return;
    const stale = staleTextLines(items, seen.current, includePreview);
    if (stale.length === 0) return;
    const timer = setTimeout(() => {
      for (const { item, key } of stale) seen.current.set(item.id, key);
      const queue = [...stale];
      const save = (id: ItemId, key: string, result: MeasureResult | null, error: string | null) => {
        const current = useSceneStore.getState().items.get(id);
        // Changed since the request: its new key is already queued by a later run.
        if (current?.kind !== 'textLine' || textLineMeasureKey(current, includePreview) !== key) return;
        useSceneStore.getState().setMeasureResult(id, result, error);
      };
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const { item, key } = next;
          try {
            const { result, error } = await measureLine(url, item, includePreview);
            save(item.id, key, result, error);
          } catch (e) {
            // Server unreachable: a marker no key equals, so the next scene change tries again
            // (a TeX error from the server, above, waits for the line itself to change).
            if (seen.current.get(item.id) === key) seen.current.set(item.id, RETRY);
            save(item.id, key, null, String(e));
          }
        }
      };
      for (let i = 0; i < Math.min(TEXT_LINE_MEASURE_CONCURRENCY, queue.length); i += 1) void worker();
    }, MEASURE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [items, enabled, url, includePreview]);
}
