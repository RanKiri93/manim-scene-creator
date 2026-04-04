import {
  getAudioBoundaries,
  type TextLineItem,
  type ItemId,
  type SceneItem,
  type TransformMapping,
  type AudioTrackItem,
  type GraphItem,
} from '@/types/scene';
import { compoundHorizontalShiftX } from '@/lib/compoundLayout';
import { effectiveDuration, effectiveStart } from '@/lib/time';
import { buildExportParts, pythonStringLiteral } from './texUtils';

const BOUNDARY_SNAP_SEC = 0.15;

function audioAssetRelPath(track: AudioTrackItem): string {
  const u = track.audioUrl.split('?')[0];
  const parts = u.split('/').filter(Boolean);
  let base = parts.length ? parts[parts.length - 1]! : `${track.id}.webm`;
  base = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!base.toLowerCase().endsWith('.webm')) base = `${base}.webm`;
  return `assets/audio/${base}`;
}

function pickAudioTrack(
  voice: { voiceKind: string; audioTrackId?: string | null },
  absStart: number,
  audioItems: AudioTrackItem[],
): AudioTrackItem | undefined {
  if (voice.audioTrackId) {
    return audioItems.find((a) => a.id === voice.audioTrackId);
  }
  const inRange = audioItems.filter(
    (a) =>
      absStart >= a.startTime - BOUNDARY_SNAP_SEC &&
      absStart <= a.startTime + a.duration + BOUNDARY_SNAP_SEC,
  );
  if (inRange.length === 1) return inRange[0];
  if (inRange.length > 1) {
    return [...inRange].sort((a, b) => a.startTime - b.startTime)[0];
  }
  let best: AudioTrackItem | undefined;
  let bestD = Infinity;
  for (const a of audioItems) {
    const d = Math.abs(absStart - a.startTime);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

function runTimeFromBoundaries(
  track: AudioTrackItem,
  absStart: number,
  absEnd: number,
  timelineFallback: number,
): number {
  const boundaries = getAudioBoundaries(track);
  const { startTime: a0 } = track;
  if (!boundaries.length) return Math.max(0.01, timelineFallback);

  let bestI = 0;
  let bestIErr = Infinity;
  for (let i = 0; i < boundaries.length; i++) {
    const e = Math.abs(absStart - (a0 + boundaries[i].start));
    if (e < bestIErr) {
      bestIErr = e;
      bestI = i;
    }
  }
  let bestJ = 0;
  let bestJErr = Infinity;
  for (let j = 0; j < boundaries.length; j++) {
    const e = Math.abs(absEnd - (a0 + boundaries[j].end));
    if (e < bestJErr) {
      bestJErr = e;
      bestJ = j;
    }
  }
  if (
    bestIErr < BOUNDARY_SNAP_SEC &&
    bestJErr < BOUNDARY_SNAP_SEC &&
    bestJ >= bestI
  ) {
    const sec = boundaries[bestJ].end - boundaries[bestI].start;
    if (sec > 0) return sec;
  }
  return Math.max(0.01, timelineFallback);
}

export type ExportLeafWithVoice = TextLineItem | GraphItem;

/**
 * Native Manim audio export: path + run_time from Whisper boundaries when applicable.
 */
export function resolveRecordedPlayback(
  item: ExportLeafWithVoice,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[] | undefined,
): { runTime: number; soundPath: string } | null {
  if (!audioItems?.length) return null;
  const v = item.voice;
  if (v.voiceKind !== 'recorder' && !v.audioTrackId) return null;

  const absStart = effectiveStart(item, itemsMap);
  const timelineDur =
    item.kind === 'textLine'
      ? effectiveDuration(item, itemsMap)
      : item.duration;
  const absEnd = absStart + timelineDur;

  const track = pickAudioTrack(v, absStart, audioItems);
  if (!track) return null;

  const runTime = runTimeFromBoundaries(
    track,
    absStart,
    absEnd,
    timelineDur,
  );
  return { runTime, soundPath: audioAssetRelPath(track) };
}

/**
 * Generate the Manim definition string for a TextLineItem.
 * Returns: HebrewMathLine(...) constructor code.
 */
export function generateLineDef(
  item: TextLineItem,
  varName: string,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const parts = buildExportParts(item.raw, item.segments);
  const fontLit = pythonStringLiteral(item.font ?? '');

  if (parts.length === 1) {
    return `${pad}${varName} = HebrewMathLine(\n` +
      `${pad}    ${pythonStringLiteral(parts[0]!)},\n` +
      `${pad}    font_size=${item.fontSize}, hebrew_font=${fontLit},\n` +
      `${pad})\n`;
  }

  let s = `${pad}${varName} = HebrewMathLine(\n`;
  for (const part of parts) {
    s += `${pad}    ${pythonStringLiteral(part)},\n`;
  }
  s += `${pad}    font_size=${item.fontSize}, hebrew_font=${fontLit},\n`;
  s += `${pad})\n`;
  return s;
}

/**
 * Generate positioning statements for a TextLineItem.
 * idToVarName maps each ItemId to its Python variable name (e.g. "line_1", "axes_2").
 */
export function generateLinePos(
  item: TextLineItem,
  varName: string,
  indent: number,
  idToVarName: Map<ItemId, string>,
  itemsMap?: Map<ItemId, SceneItem>,
): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];

  for (const step of item.posSteps) {
    switch (step.kind) {
      case 'absolute':
        lines.push(
          `${pad}${varName}.move_to([${item.x.toFixed(6)}, ${item.y.toFixed(6)}, 0])`,
        );
        break;
      case 'next_to': {
        if (!step.refId) break;
        const refVar = idToVarName.get(step.refId);
        if (!refVar) break;
        lines.push(`${pad}${varName}.next_to(${refVar}, ${step.dir}, buff=${step.buff})`);
        break;
      }
      case 'to_edge':
        lines.push(`${pad}${varName}.to_edge(${step.edge}, buff=${step.buff})`);
        break;
      case 'shift':
        lines.push(`${pad}${varName}.shift(${step.dx}*RIGHT + ${step.dy}*UP)`);
        break;
      case 'set_x':
        lines.push(`${pad}${varName}.set_x(${step.x.toFixed(6)})`);
        break;
      case 'set_y':
        lines.push(`${pad}${varName}.set_y(${step.y.toFixed(6)})`);
        break;
    }
  }

  // Segment colors
  item.segments.forEach((seg, i) => {
    if (seg.color && seg.color !== '#ffffff') {
      lines.push(`${pad}${varName}[${i}].set_color(ManimColor("${seg.color}"))`);
    }
  });

  if (itemsMap && item.parentId) {
    const dx = compoundHorizontalShiftX(item.parentId, itemsMap);
    if (Math.abs(dx) > 1e-9) {
      lines.push(`${pad}${varName}.shift(${dx.toFixed(6)} * RIGHT)`);
    }
  }

  return lines.join('\n') + (lines.length ? '\n' : '');
}

function collectTransformPlayAnims(
  item: TextLineItem,
  targetVar: string,
  sourceVar: string,
  tc: TransformMapping,
  sourceSegCount: number,
): string[] {
  const anims: string[] = [];
  const pairs = tc.segmentPairs;
  const mappedSources = new Set(
    Object.values(pairs).map((v) => Number(v)),
  );

  item.segments.forEach((_, tgtIdx) => {
    const srcIdx = pairs[tgtIdx as keyof typeof pairs];
    if (srcIdx !== undefined) {
      anims.push(
        `ReplacementTransform(${sourceVar}[${srcIdx}], ${targetVar}[${tgtIdx}])`,
      );
    } else if (tc.unmappedTargetBehavior === 'fade_in') {
      anims.push(`FadeIn(${targetVar}[${tgtIdx}])`);
    } else {
      anims.push(`Write(${targetVar}[${tgtIdx}])`);
    }
  });

  for (let s = 0; s < sourceSegCount; s++) {
    if (mappedSources.has(s)) continue;
    if (tc.unmappedSourceBehavior === 'fade_out') {
      anims.push(`FadeOut(${sourceVar}[${s}])`);
    }
  }

  return anims;
}

function lineExitAnimTarget(varName: string, item: TextLineItem): string {
  const multi =
    item.segments.length > 1 || item.voice.perSegmentNarration;
  return multi ? `*${varName}` : varName;
}

function emitLineExitAnim(
  item: TextLineItem,
  varName: string,
  pad: string,
): string {
  const style = item.exitAnimStyle;
  if (!style || style === 'none') return '';
  const runTime = item.exitRunTime ?? 1;
  const target = lineExitAnimTarget(varName, item);
  switch (style) {
    case 'fade_out':
      return `${pad}self.play(FadeOut(${target}), run_time=${runTime})\n`;
    case 'uncreate':
      return `${pad}self.play(Uncreate(${target}), run_time=${runTime})\n`;
    case 'shrink_to_center':
      return `${pad}self.play(ShrinkToCenter(${target}), run_time=${runTime})\n`;
    default:
      return '';
  }
}

/**
 * Generate playback / animation code for a TextLineItem.
 */
export function generateLinePlay(
  item: TextLineItem,
  varName: string,
  indent: number,
  idToVarName: Map<ItemId, string>,
  itemsMap?: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
): string {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 4);
  const runDur = item.parentId ? (item.localDuration ?? item.duration) : item.duration;
  let s = '';

  const tc = item.transformConfig;
  const sourceVar =
    item.animStyle === 'transform' && tc
      ? idToVarName.get(tc.sourceLineId)
      : undefined;
  const sourceItem =
    tc && itemsMap
      ? (itemsMap.get(tc.sourceLineId) as TextLineItem | undefined)
      : undefined;
  const sourceSegCount =
    sourceItem?.kind === 'textLine' ? sourceItem.segments.length : 0;

  const useTransform =
    item.animStyle === 'transform' &&
    tc &&
    sourceVar &&
    sourceItem?.kind === 'textLine';

  const transformPlayInner = useTransform
    ? `self.play(${collectTransformPlayAnims(item, varName, sourceVar, tc, sourceSegCount).join(', ')}, run_time=__RUN__)\n`
    : null;

  const recorded =
    itemsMap &&
    resolveRecordedPlayback(item, itemsMap, audioItems);

  if (recorded) {
    const rt = recorded.runTime.toFixed(6);
    s += `${pad}self.add_sound("${recorded.soundPath}")\n`;
    if (transformPlayInner) {
      s += `${pad}${transformPlayInner.replace('__RUN__', rt)}`;
    } else {
      s += `${pad}self.play(Write(${varName}), run_time=${rt})\n`;
    }
  } else if (item.voice.animMode === 'voiceover' && item.voice.script) {
    const combined = (item.voice.preamble ? item.voice.preamble : '') +
      (item.voice.singleTakeBookmarks ? `<bookmark mark='bm0' />` : '') +
      item.voice.script;

    s += `${pad}with self.voiceover(text=${pythonStringLiteral(combined)}) as tracker:\n`;
    if (item.voice.singleTakeBookmarks) {
      s += `${inner}self.wait_until_bookmark("bm0")\n`;
    }
    if (transformPlayInner) {
      s += `${inner}${transformPlayInner.replace('__RUN__', 'max(tracker.get_remaining_duration(), 0.01)')}`;
    } else {
      s += `${inner}self.play(Write(${varName}), run_time=max(tracker.get_remaining_duration(), 0.01))\n`;
    }
  } else {
    if (transformPlayInner) {
      s += `${pad}${transformPlayInner.replace('__RUN__', String(runDur))}`;
    } else {
      s += `${pad}self.play(Write(${varName}), run_time=${runDur})\n`;
    }
  }

  if (item.waitAfter > 0) {
    s += `${pad}self.wait(${item.waitAfter.toFixed(4)})\n`;
  }

  s += emitLineExitAnim(item, varName, pad);

  return s;
}
