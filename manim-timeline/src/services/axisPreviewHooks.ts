import { useEffect, useRef } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { previewAxes } from '@/services/measureClient';
import { MEASURE_DEBOUNCE_MS } from '@/lib/constants';
import { axesPreviewVisualKey } from '@/lib/axesPreviewRequest';
import type { AxesItem } from '@/types/scene';

/**
 * Debounced sync: for every axes item, request `/api/preview_axes` when visual fields change.
 * Mounted once at app root (see App.tsx).
 */
export function useAxesPreviewSync() {
  const url = useSceneStore((s) => s.measureConfig.url);
  const enabled = useSceneStore((s) => s.measureConfig.enabled);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const flush = () => {
      const { items, measureConfig } = useSceneStore.getState();
      if (!measureConfig.enabled) return;

      const promises: Promise<void>[] = [];
      for (const it of items.values()) {
        if (it.kind !== 'axes') continue;
        const ax = it as AxesItem;
        const key = axesPreviewVisualKey(ax);
        if (ax.axisPreviewHash === key && ax.axisPreviewDataUrl) continue;

        promises.push(
          (async () => {
            try {
              const r = await previewAxes(measureConfig.url, ax);
              const cur = useSceneStore.getState().items.get(ax.id);
              if (!cur || cur.kind !== 'axes') return;
              const latestKey = axesPreviewVisualKey(cur as AxesItem);
              if (latestKey !== key) return;

              if (r.error) {
                useSceneStore.getState().updateItem(ax.id, {
                  axisPreviewError: r.error,
                  axisPreviewDataUrl: null,
                  axisPreviewBounds: null,
                  axisPreviewHash: key,
                });
              } else {
                useSceneStore.getState().updateItem(ax.id, {
                  axisPreviewDataUrl: r.dataUrl,
                  axisPreviewError: null,
                  axisPreviewBounds: r.bounds,
                  axisPreviewHash: key,
                });
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              useSceneStore.getState().updateItem(ax.id, {
                axisPreviewError: msg,
                axisPreviewDataUrl: null,
                axisPreviewBounds: null,
                axisPreviewHash: key,
              });
            }
          })(),
        );
      }
      void Promise.all(promises);
    };

    const schedule = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, MEASURE_DEBOUNCE_MS);
    };

    const unsub = useSceneStore.subscribe(schedule);
    schedule();
    return () => {
      unsub();
      clearTimeout(timerRef.current);
    };
  }, [url, enabled]);
}
