import type {
  AudioTrackItem,
  GraphPointSequenceItem,
  ItemId,
  SceneItem,
} from '@/types/scene';
import {
  pointSequenceIndices,
  resolvePointSequenceN,
} from '@/types/scene';
import {
  manimColor,
  overlayPointSequenceDotVar,
  overlayPointSequenceGroupVar,
  pythonOverlaySuffix,
} from './graphCodegen';
import {
  type BoundAudioTailOpts,
  appendAudioTailAfterLeafPlayback,
  boundSoundEmittedAtTrackStart,
  resolveRecordedPlayback,
} from './lineCodegen';

function pyExprOneLine(s: string): string {
  return (s ?? '').trim().replace(/\n/g, ' ') || '0';
}

export function generateGraphPointSequenceDef(
  item: GraphPointSequenceItem,
  axVar: string,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 4);
  const suf = pythonOverlaySuffix(item.id);
  const px = pyExprOneLine(item.pyXExpr);
  const py = pyExprOneLine(item.pyYExpr);
  const xFn = `${axVar}_ps_${suf}_x`;
  const yFn = `${axVar}_ps_${suf}_y`;
  const grp = overlayPointSequenceGroupVar(axVar, item.id);

  let s = '';
  s += `${pad}def ${xFn}(n):\n`;
  s += `${inner}return (${px})\n`;
  s += `${pad}def ${yFn}(n):\n`;
  s += `${inner}return (${py})\n`;

  const list = pointSequenceIndices(item);
  for (const n of list) {
    const dVar = overlayPointSequenceDotVar(axVar, item.id, n);
    const r = resolvePointSequenceN(item, n);
    const rad = Math.max(0.001, r.pointRadius);
    s += `${pad}${dVar} = Dot(color=${manimColor(r.color)}, radius=${rad})\n`;
    s += `${pad}${dVar}.move_to(${axVar}.coords_to_point(float(${xFn}(${n})), float(${yFn}(${n}))))\n`;
  }

  s += `${pad}${grp} = VGroup()\n`;
  for (const n of list) {
    const dv = overlayPointSequenceDotVar(axVar, item.id, n);
    s += `${pad}${grp}.add(${dv})\n`;
  }

  if (list.length === 0) {
    s += `${pad}_ = ${xFn}\n`;
  }

  if (
    item.visibleAtSceneStart === true &&
    item.mode === 'replacement' &&
    list.length > 1
  ) {
    for (let i = 0; i < list.length - 1; i++) {
      const n = list[i]!;
      const dv = overlayPointSequenceDotVar(axVar, item.id, n);
      s += `${pad}${dv}.set_opacity(0)\n`;
    }
  }

  return s;
}

export function generateGraphPointSequencePlay(
  item: GraphPointSequenceItem,
  axVar: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
  tailOpts?: BoundAudioTailOpts,
): string {
  const pad = ' '.repeat(indent);
  const list = pointSequenceIndices(item);
  if (list.length === 0) return '';
  if (item.visibleAtSceneStart) return '';

  let s = '';
  const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
  if (
    recorded &&
    (!audioItems?.length ||
      !boundSoundEmittedAtTrackStart(item, itemsMap, audioItems))
  ) {
    s += `${pad}self.add_sound("${recorded.soundPath}")\n`;
  }

  if (item.mode === 'accumulation') {
    list.forEach((n, idx) => {
      const r = resolvePointSequenceN(item, n);
      const rt = Math.max(0.01, r.animDuration).toFixed(6);
      const dVar = overlayPointSequenceDotVar(axVar, item.id, n);
      s += `${pad}self.play(FadeIn(${dVar}), run_time=${rt})\n`;
      const isLast = idx === list.length - 1;
      if (!isLast && r.waitAfter > 1e-6) {
        s += `${pad}self.wait(${Math.max(0, r.waitAfter).toFixed(4)})\n`;
      }
    });
  } else {
    list.forEach((n, idx) => {
      const r = resolvePointSequenceN(item, n);
      const rt = Math.max(0.01, r.animDuration).toFixed(6);
      const dVar = overlayPointSequenceDotVar(axVar, item.id, n);
      if (idx === 0) {
        s += `${pad}self.play(FadeIn(${dVar}), run_time=${rt})\n`;
      } else {
        const prev = overlayPointSequenceDotVar(axVar, item.id, list[idx - 1]!);
        s += `${pad}self.play(AnimationGroup(FadeOut(${prev}), FadeIn(${dVar}), lag_ratio=0), run_time=${rt})\n`;
      }
      const isLast = idx === list.length - 1;
      if (!isLast && r.waitAfter > 1e-6) {
        s += `${pad}self.wait(${Math.max(0, r.waitAfter).toFixed(4)})\n`;
      }
    });
  }

  if (recorded) {
    s += appendAudioTailAfterLeafPlayback(
      pad,
      recorded,
      item,
      itemsMap,
      audioItems,
      tailOpts,
    );
  }
  return s;
}

/** Concurrent-cluster branch for graphPointSequence (matches timing of flat play). */
export function pointSequenceConcurrentBranch(
  item: GraphPointSequenceItem,
  axVar: string,
  relWait: number,
): string {
  const list = pointSequenceIndices(item);
  const wStr = Math.max(0, relWait).toFixed(4);
  if (list.length === 0) {
    return `Succession(Wait(${wStr}), Wait(0.01), run_time=0.01)`;
  }
  const parts: string[] = [`Wait(${wStr})`];
  list.forEach((n, idx) => {
    const r = resolvePointSequenceN(item, n);
    const rt = Math.max(0.01, r.animDuration).toFixed(6);
    const dVar = overlayPointSequenceDotVar(axVar, item.id, n);
    if (item.mode === 'accumulation' || idx === 0) {
      parts.push(`FadeIn(${dVar}, run_time=${rt})`);
    } else {
      const prev = overlayPointSequenceDotVar(axVar, item.id, list[idx - 1]!);
      parts.push(
        `AnimationGroup(FadeOut(${prev}), FadeIn(${dVar}), lag_ratio=0, run_time=${rt})`,
      );
    }
    const isLast = idx === list.length - 1;
    if (!isLast && r.waitAfter > 1e-6) {
      parts.push(`Wait(${Math.max(0, r.waitAfter).toFixed(4)})`);
    }
  });
  return `Succession(${parts.join(', ')})`;
}
