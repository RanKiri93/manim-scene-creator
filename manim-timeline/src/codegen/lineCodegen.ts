import {
  getAudioBoundaries,
  type TextLineItem,
  type ItemId,
  type SceneItem,
  type TransformMapping,
  type AudioTrackItem,
  type AxesItem,
  type GraphPlotItem,
  type GraphDotItem,
  type GraphFieldItem,
  type GraphSeriesVizItem,
  type ShapeItem,
} from '@/types/scene';
import { deriveAudioAssetRelPath } from '@/lib/audioAssetPath';
import { compoundHorizontalShiftX } from '@/lib/compoundLayout';
import {
  effectiveDuration,
  effectiveStart,
  segmentWaitTotal,
  textLineAnimOnlyDuration,
} from '@/lib/time';
import type { ExportLeaf } from './flattenExport';
import { buildExportParts, pythonStringLiteral } from './texUtils';

const BOUNDARY_SNAP_SEC = 0.15;
const OVERLAP_EPS = 1e-6;

function audioAssetRelPath(track: AudioTrackItem): string {
  return deriveAudioAssetRelPath(track);
}

/**
 * Pick a timeline audio track for a clip: explicit `audioTrackId`, or any track whose
 * time range overlaps the clip window (no “closest” fallback when there is no overlap).
 */
export function pickAudioTrackForClip(
  audioTrackId: string | null | undefined,
  absStart: number,
  absEnd: number,
  audioItems: AudioTrackItem[],
): AudioTrackItem | undefined {
  if (audioTrackId) {
    return audioItems.find((a) => a.id === audioTrackId);
  }
  const overlapping = audioItems.filter((a) => {
    const t0 = a.startTime - BOUNDARY_SNAP_SEC;
    const t1 = a.startTime + a.duration + BOUNDARY_SNAP_SEC;
    return absStart < t1 - OVERLAP_EPS && absEnd > t0 + OVERLAP_EPS;
  });
  if (overlapping.length === 0) return undefined;
  if (overlapping.length === 1) return overlapping[0];
  return [...overlapping].sort((a, b) => a.startTime - b.startTime)[0];
}

function findAudioTrackForLeaf(
  item: ExportLeafWithAudio,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[],
): AudioTrackItem | undefined {
  const absStart = effectiveStart(item, itemsMap);
  const timelineDur =
    item.kind === 'textLine'
      ? effectiveDuration(item, itemsMap)
      : item.duration;
  const absEnd = absStart + timelineDur;
  return pickAudioTrackForClip(
    item.audioTrackId,
    absStart,
    absEnd,
    audioItems,
  );
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

export type ExportLeafWithAudio =
  | TextLineItem
  | AxesItem
  | GraphPlotItem
  | GraphDotItem
  | GraphFieldItem
  | GraphSeriesVizItem
  | ShapeItem;

/**
 * Native Manim audio export: path + run_time from Whisper boundaries when applicable.
 */
/**
 * Timeline audio that gets `add_sound` at `track.startTime` (before leaf playback runs).
 * Includes: tracks not bound to any leaf, and tracks bound to a leaf whose visual starts
 * *after* the audio clip (so sound must not wait until the line/axes plays).
 */
export function listUnboundAudioTracksForExport(
  audioItems: AudioTrackItem[],
  flat: ExportLeaf[],
  itemsMap: Map<ItemId, SceneItem>,
): AudioTrackItem[] {
  if (!audioItems.length) return [];
  const boundIds = new Set<string>();
  const earlyBoundById = new Map<string, AudioTrackItem>();

  for (const leaf of flat) {
    const t = findAudioTrackForLeaf(leaf, itemsMap, audioItems);
    if (!t) continue;
    boundIds.add(t.id);
    const leafT0 = effectiveStart(leaf, itemsMap);
    if (t.startTime < leafT0 - 1e-9) {
      earlyBoundById.set(t.id, t);
    }
  }

  const trulyUnbound = audioItems.filter((a) => !boundIds.has(a.id));
  const merged = new Map<string, AudioTrackItem>();
  for (const t of earlyBoundById.values()) merged.set(t.id, t);
  for (const t of trulyUnbound) merged.set(t.id, t);
  return [...merged.values()].sort(
    (a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id),
  );
}

/** Bound track plays from timeline `startTime` before this leaf's visual `effectiveStart`. */
export function boundSoundEmittedAtTrackStart(
  item: ExportLeafWithAudio,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[] | undefined,
): boolean {
  if (!audioItems?.length) return false;
  const track = findAudioTrackForLeaf(item, itemsMap, audioItems);
  if (!track) return false;
  return track.startTime < effectiveStart(item, itemsMap) - 1e-9;
}

const DEFAULT_PLAY_AFTER_RECORDED = 1;

/** Global scene time when bound-audio-driven animations for this leaf have finished (before tail wait). */
export function sceneAnimEndForBoundAudioTail(
  leaf: ExportLeaf,
  itemsMap: Map<ItemId, SceneItem>,
  rec: ResolvedRecordedPlayback,
): number {
  const t0 = effectiveStart(leaf, itemsMap);
  let extra = 0;
  if (leaf.kind === 'textLine') {
    extra = segmentWaitTotal(leaf.segments);
  } else if (leaf.kind === 'graphDot' && leaf.dot.label.trim()) {
    extra = DEFAULT_PLAY_AFTER_RECORDED;
  } else if (
    leaf.kind === 'graphField' &&
    (leaf.streamPoints?.length ?? 0) > 0
  ) {
    extra = DEFAULT_PLAY_AFTER_RECORDED;
  }
  return t0 + rec.runTime + extra;
}

/** Optional cap for bound-audio tail waits (shared long narration under multiple clips). */
export type BoundAudioTailOpts = {
  /**
   * Absolute timeline time (seconds): do not extend the scene past this moment using
   * post-leaf audio tail `wait`s — the next export event will align the clock.
   */
  tailCeilingAbs?: number | null;
};

/** Trailing `self.wait` so the scene clock reaches end of the audio file after leaf anims. */
export function audioTailWaitAfterLeafPlayback(
  rec: ResolvedRecordedPlayback,
  leaf: ExportLeaf,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[] | undefined,
  opts?: BoundAudioTailOpts,
): number {
  if (!audioItems?.length) return audioTailWaitSec(rec);
  const track = findAudioTrackForLeaf(leaf as ExportLeafWithAudio, itemsMap, audioItems);
  if (!track) return audioTailWaitSec(rec);
  const animEnd = sceneAnimEndForBoundAudioTail(leaf, itemsMap, rec);
  const audioEnd = track.startTime + rec.audioFileDuration;
  const raw = Math.max(0, audioEnd - animEnd);
  const ceil = opts?.tailCeilingAbs;
  if (ceil != null && Number.isFinite(ceil)) {
    const cap = Math.max(0, ceil - animEnd);
    return Math.min(raw, cap);
  }
  return raw;
}

export function appendAudioTailAfterLeafPlayback(
  indentPad: string,
  rec: ResolvedRecordedPlayback,
  leaf: ExportLeaf,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[] | undefined,
  opts?: BoundAudioTailOpts,
): string {
  const w = audioTailWaitAfterLeafPlayback(rec, leaf, itemsMap, audioItems, opts);
  if (w <= 1e-9) return '';
  return `${indentPad}self.wait(${w.toFixed(4)})\n`;
}

/** Scene seconds consumed from the leaf's play block (anim + tail wait). */
export function sceneClockSecForLeafBoundPlayback(
  leaf: ExportLeaf,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[] | undefined,
  opts?: BoundAudioTailOpts,
): number | null {
  const rec = resolveRecordedPlayback(leaf as ExportLeafWithAudio, itemsMap, audioItems);
  if (!rec) return null;
  const t0 = effectiveStart(leaf, itemsMap);
  const animEnd = sceneAnimEndForBoundAudioTail(leaf, itemsMap, rec);
  const tail = audioTailWaitAfterLeafPlayback(rec, leaf, itemsMap, audioItems, opts);
  return animEnd - t0 + tail;
}

/** One `self.add_sound(...)` line for a timeline audio file (path under `assets/audio/`). */
export function generateUnboundAudioAddSoundLine(
  track: AudioTrackItem,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  return `${pad}self.add_sound("${audioAssetRelPath(track)}")\n`;
}

/** Bound TTS/recording: Whisper slice `runTime` vs full file (Manim plays entire file from `add_sound`). */
export type ResolvedRecordedPlayback = {
  runTime: number;
  soundPath: string;
  audioFileDuration: number;
};

export function audioTailWaitSec(rec: ResolvedRecordedPlayback): number {
  return Math.max(0, rec.audioFileDuration - rec.runTime);
}

/** Scene time that must elapse after `add_sound` before the next timeline event (play + tail wait). */
export function sceneClockSecForBoundAudio(rec: ResolvedRecordedPlayback): number {
  return rec.runTime + audioTailWaitSec(rec);
}

export function appendAudioTailWaitPad(
  indentPad: string,
  rec: ResolvedRecordedPlayback,
): string {
  const w = audioTailWaitSec(rec);
  if (w <= 1e-9) return '';
  return `${indentPad}self.wait(${w.toFixed(4)})\n`;
}

export function resolveRecordedPlayback(
  item: ExportLeafWithAudio,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[] | undefined,
): ResolvedRecordedPlayback | null {
  if (!audioItems?.length) return null;

  const absStart = effectiveStart(item, itemsMap);
  // Use the animation-only duration (no segment waitAfterSec) for boundary matching and
  // the fallback run_time.  Segment waits are emitted as separate Wait() nodes in the
  // Succession; including them in absEnd would inflate the boundary snap target and cause
  // runTimeFromBoundaries to fall back to a duration that already includes the waits —
  // which then gets double-counted when textLineWriteFadePlayExpr adds the Wait() nodes.
  const animOnlyDur =
    item.kind === 'textLine'
      ? textLineAnimOnlyDuration(item, itemsMap)
      : item.duration;
  const absEnd = absStart + animOnlyDur;

  const track = findAudioTrackForLeaf(item, itemsMap, audioItems);
  if (!track) return null;

  const runTime = runTimeFromBoundaries(
    track,
    absStart,
    absEnd,
    animOnlyDur,
  );
  return {
    runTime,
    soundPath: audioAssetRelPath(track),
    audioFileDuration: Math.max(0, track.duration),
  };
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

export function collectTransformPlayAnims(
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

/** Python expression target for FadeOut/Uncreate/ShrinkToCenter on a text line. */
export function lineExitAnimTarget(varName: string, item: TextLineItem): string {
  return item.segments.length > 1 ? `*${varName}` : varName;
}

function fmtSegRt(sec: number): string {
  const x = !Number.isFinite(sec) || sec <= 0 ? 0.01 : sec;
  return x.toFixed(6);
}

/**
 * Python expression for write/fade_in: single play target or Succession over segments + segment waits.
 */
export function textLineWriteFadePlayExpr(
  varName: string,
  item: TextLineItem,
  animOnlySec: number,
  recordedRunTime: number | null,
): string {
  const fade = (item.animStyle ?? 'write') === 'fade_in';
  const n = item.segments.length;
  if (n === 0) {
    const rt = recordedRunTime != null ? recordedRunTime : animOnlySec;
    return fade
      ? `FadeIn(${varName}, run_time=${fmtSegRt(rt)})`
      : `Write(${varName}, run_time=${fmtSegRt(rt)})`;
  }
  const onlySeg = n === 1;
  const w0 = item.segments[0]?.waitAfterSec;
  const hasWait = onlySeg && w0 != null && w0 > 0;
  if (onlySeg && !hasWait) {
    const rt = recordedRunTime != null ? recordedRunTime : animOnlySec;
    return fade
      ? `FadeIn(${varName}, run_time=${fmtSegRt(rt)})`
      : `Write(${varName}, run_time=${fmtSegRt(rt)})`;
  }
  const perSeg =
    recordedRunTime != null ? recordedRunTime / n : animOnlySec / n;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(
      fade
        ? `FadeIn(${varName}[${i}], run_time=${fmtSegRt(perSeg)})`
        : `Write(${varName}[${i}], run_time=${fmtSegRt(perSeg)})`,
    );
    const w = item.segments[i]?.waitAfterSec;
    if (w != null && w > 0) {
      parts.push(`Wait(${w.toFixed(4)})`);
    }
  }
  return `Succession(${parts.join(', ')})`;
}

/** Concurrent `AnimationGroup` branch: stagger + segment waits + optional audio tail Wait. */
export function textLineConcurrentWriteFadeExpr(
  varName: string,
  item: TextLineItem,
  relWait: number,
  animOnlySec: number,
  recordedRunTime: number | null,
  recorded: ResolvedRecordedPlayback | null,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[] | undefined,
  tailOpts?: BoundAudioTailOpts,
): string {
  const wStr = Math.max(0, relWait).toFixed(4);
  const fade = (item.animStyle ?? 'write') === 'fade_in';
  const n = item.segments.length;
  const tailSec =
    recorded && audioItems?.length
      ? audioTailWaitAfterLeafPlayback(recorded, item, itemsMap, audioItems, tailOpts)
      : recorded
        ? audioTailWaitSec(recorded)
        : 0;
  const tailArg =
    recorded && tailSec > 1e-9 ? `, Wait(${fmtSegRt(tailSec)})` : '';

  if (n === 0) {
    const effRt = recordedRunTime != null ? recordedRunTime : animOnlySec;
    const intro = fade
      ? `FadeIn(${varName}, run_time=${fmtSegRt(effRt)})`
      : `Write(${varName}, run_time=${fmtSegRt(effRt)})`;
    return `Succession(Wait(${wStr}), ${intro}${tailArg})`;
  }
  const onlySeg = n === 1;
  const w0 = item.segments[0]?.waitAfterSec;
  const hasWait = onlySeg && w0 != null && w0 > 0;
  if (onlySeg && !hasWait) {
    const effRt = recordedRunTime != null ? recordedRunTime : animOnlySec;
    const intro = fade
      ? `FadeIn(${varName}, run_time=${fmtSegRt(effRt)})`
      : `Write(${varName}, run_time=${fmtSegRt(effRt)})`;
    return `Succession(Wait(${wStr}), ${intro}${tailArg})`;
  }
  const perSeg =
    recordedRunTime != null ? recordedRunTime / n : animOnlySec / n;
  const parts: string[] = [`Wait(${wStr})`];
  for (let i = 0; i < n; i++) {
    parts.push(
      fade
        ? `FadeIn(${varName}[${i}], run_time=${fmtSegRt(perSeg)})`
        : `Write(${varName}[${i}], run_time=${fmtSegRt(perSeg)})`,
    );
    const w = item.segments[i]?.waitAfterSec;
    if (w != null && w > 0) {
      parts.push(`Wait(${w.toFixed(4)})`);
    }
  }
  return `Succession(${parts.join(', ')}${tailArg})`;
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
  tailOpts?: BoundAudioTailOpts,
): string {
  const pad = ' '.repeat(indent);
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

  const animOnly =
    itemsMap != null
      ? textLineAnimOnlyDuration(item, itemsMap)
      : runDur;
  const segWaitSum = segmentWaitTotal(item.segments);

  if (recorded) {
    const rt = recorded.runTime.toFixed(6);
    const soundEarly =
      itemsMap &&
      audioItems &&
      boundSoundEmittedAtTrackStart(item, itemsMap, audioItems);
    if (!soundEarly) {
      s += `${pad}self.add_sound("${recorded.soundPath}")\n`;
    }
    if (transformPlayInner) {
      s += `${pad}${transformPlayInner.replace('__RUN__', rt)}`;
      s += appendAudioTailAfterLeafPlayback(
        pad,
        recorded,
        item,
        itemsMap!,
        audioItems,
        tailOpts,
      );
      if (segWaitSum > 1e-9) {
        s += `${pad}self.wait(${segWaitSum.toFixed(4)})\n`;
      }
    } else {
      const expr = textLineWriteFadePlayExpr(
        varName,
        item,
        animOnly,
        recorded.runTime,
      );
      s += `${pad}self.play(${expr})\n`;
      s += appendAudioTailAfterLeafPlayback(
        pad,
        recorded,
        item,
        itemsMap!,
        audioItems,
        tailOpts,
      );
    }
  } else {
    if (transformPlayInner) {
      s += `${pad}${transformPlayInner.replace('__RUN__', String(runDur))}`;
      if (segWaitSum > 1e-9) {
        s += `${pad}self.wait(${segWaitSum.toFixed(4)})\n`;
      }
    } else {
      const expr = textLineWriteFadePlayExpr(varName, item, animOnly, null);
      s += `${pad}self.play(${expr})\n`;
    }
  }

  return s;
}
