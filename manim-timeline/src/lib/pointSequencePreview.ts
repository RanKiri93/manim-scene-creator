import type { GraphPointSequenceItem, ItemId, SceneItem } from '@/types/scene';
import {
  pointSequenceChildStartOffset,
  pointSequenceIndices,
  resolvePointSequenceN,
} from '@/types/scene';
import { isVisibleAtSceneStartItem } from '@/types/scene';
import { effectiveStart } from '@/lib/time';
import { pointSequenceHasErrors } from '@/types/scene';

export interface PointSequenceDotSpec {
  key: string;
  lx: number;
  ly: number;
  color: string;
  radiusPx: number;
  opacity: number;
}

function compileN(js: string): ((n: number) => number) | null {
  try {
    return new Function(
      'n',
      `"use strict"; return (${js});`,
    ) as (n: number) => number;
  } catch {
    return null;
  }
}

function evalPoint(
  fx: (n: number) => number,
  fy: (n: number) => number,
  n: number,
  toLocal: (gx: number, gy: number) => { lx: number; ly: number },
): { lx: number; ly: number } | null {
  let gx: number;
  let gy: number;
  try {
    gx = fx(n);
    gy = fy(n);
  } catch {
    return null;
  }
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return null;
  return toLocal(gx, gy);
}

/**
 * Konva preview for graphPointSequence at absolute scene time.
 */
export function buildPointSequenceDrawSpec(
  item: GraphPointSequenceItem,
  time: number,
  itemsMap: Map<ItemId, SceneItem>,
  toLocal: (gx: number, gy: number) => { lx: number; ly: number },
  scenePxPerUnit: number,
): { dots: PointSequenceDotSpec[] } | null {
  if (pointSequenceHasErrors(item)) return null;
  const t0 = effectiveStart(item, itemsMap);
  const localT = time - t0;
  if (localT < 0) return null;

  const fx = compileN(item.jsXExpr);
  const fy = compileN(item.jsYExpr);
  if (!fx || !fy) return null;

  const indices = pointSequenceIndices(item);
  if (indices.length === 0) return { dots: [] };

  const forceAcc =
    isVisibleAtSceneStartItem(item) && item.mode === 'accumulation';
  const forceRep =
    isVisibleAtSceneStartItem(item) && item.mode === 'replacement';

  if (item.mode === 'accumulation') {
    const dots: PointSequenceDotSpec[] = [];
    for (const n of indices) {
      const r = resolvePointSequenceN(item, n);
      const p = evalPoint(fx, fy, n, toLocal);
      if (!p) continue;
      const radPx = Math.max(1, r.pointRadius * scenePxPerUnit);
      if (forceAcc) {
        dots.push({
          key: `${item.id}-${n}`,
          ...p,
          color: r.color,
          radiusPx: radPx,
          opacity: 1,
        });
        continue;
      }
      const start = pointSequenceChildStartOffset(item, n);
      const anim = Math.max(0.01, r.animDuration);
      let op = 0;
      if (localT >= start + anim) op = 1;
      else if (localT > start) op = (localT - start) / anim;
      if (op <= 0) continue;
      dots.push({
        key: `${item.id}-${n}`,
        ...p,
        color: r.color,
        radiusPx: radPx,
        opacity: op,
      });
    }
    return { dots };
  }

  if (forceRep) {
    const lastN = indices[indices.length - 1]!;
    const r = resolvePointSequenceN(item, lastN);
    const p = evalPoint(fx, fy, lastN, toLocal);
    if (!p) return { dots: [] };
    const radPx = Math.max(1, r.pointRadius * scenePxPerUnit);
    return {
      dots: [
        {
          key: `${item.id}-${lastN}`,
          ...p,
          color: r.color,
          radiusPx: radPx,
          opacity: 1,
        },
      ],
    };
  }

  for (let i = 0; i < indices.length; i++) {
    const n = indices[i]!;
    const start = pointSequenceChildStartOffset(item, n);
    const r = resolvePointSequenceN(item, n);
    const anim = Math.max(0.01, r.animDuration);
    const end = start + anim;

    if (localT < start) {
      if (i === 0) return { dots: [] };
      const nPrev = indices[i - 1]!;
      const rp = resolvePointSequenceN(item, nPrev);
      const pp = evalPoint(fx, fy, nPrev, toLocal);
      if (!pp) return { dots: [] };
      return {
        dots: [
          {
            key: `${item.id}-${nPrev}-hold`,
            ...pp,
            color: rp.color,
            radiusPx: Math.max(1, rp.pointRadius * scenePxPerUnit),
            opacity: 1,
          },
        ],
      };
    }

    if (localT < end) {
      const u = (localT - start) / anim;
      if (i === 0) {
        const p = evalPoint(fx, fy, n, toLocal);
        if (!p) return { dots: [] };
        return {
          dots: [
            {
              key: `${item.id}-${n}-in`,
              ...p,
              color: r.color,
              radiusPx: Math.max(1, r.pointRadius * scenePxPerUnit),
              opacity: u,
            },
          ],
        };
      }
      const nPrev = indices[i - 1]!;
      const rp = resolvePointSequenceN(item, nPrev);
      const pp = evalPoint(fx, fy, nPrev, toLocal);
      const pc = evalPoint(fx, fy, n, toLocal);
      if (!pp || !pc) return { dots: [] };
      return {
        dots: [
          {
            key: `${item.id}-${nPrev}-out`,
            ...pp,
            color: rp.color,
            radiusPx: Math.max(1, rp.pointRadius * scenePxPerUnit),
            opacity: 1 - u,
          },
          {
            key: `${item.id}-${n}-in`,
            ...pc,
            color: r.color,
            radiusPx: Math.max(1, r.pointRadius * scenePxPerUnit),
            opacity: u,
          },
        ],
      };
    }
  }

  const lastN = indices[indices.length - 1]!;
  const r = resolvePointSequenceN(item, lastN);
  const p = evalPoint(fx, fy, lastN, toLocal);
  if (!p) return { dots: [] };
  return {
    dots: [
      {
        key: `${item.id}-${lastN}-done`,
        ...p,
        color: r.color,
        radiusPx: Math.max(1, r.pointRadius * scenePxPerUnit),
        opacity: 1,
      },
    ],
  };
}
