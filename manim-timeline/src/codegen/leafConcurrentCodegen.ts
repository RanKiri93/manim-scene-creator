import type {
  AudioTrackItem,
  ExitAnimationItem,
  ExitAnimStyle,
  GraphSeriesVizItem,
  ItemId,
  SceneItem,
  SurroundingRectItem,
  TextLineItem,
} from '@/types/scene';
import type { ExportLeaf } from './flattenExport';
import { effectiveStart, holdEnd } from '@/lib/time';
import { sequentialAnimSecondsForSurroundingRect } from './groupPlaybackSpan';
import {
  type BoundAudioTailOpts,
  audioTailWaitAfterLeafPlayback,
  audioTailWaitSec,
  boundSoundEmittedAtTrackStart,
  collectTransformPlayAnims,
  resolveRecordedPlayback,
  textLineConcurrentWriteFadeExpr,
} from './lineCodegen';
import { segmentWaitTotal } from '@/lib/time';
import {
  buildGraphSeriesVizAddLine,
  exitAnimationExpr,
  overlayDotVar,
  overlayPlotVar,
  pythonOverlaySuffix,
  resolveExitTargetsForExport,
  seriesRateFuncArg,
} from './graphCodegen';

const MANIM_DEFAULT_PLAY_SEC = 1;

/** Require real overlap (not edge-touching / float noise) before merging into one AnimationGroup. */
const MIN_INTERVAL_OVERLAP_SEC = 1e-4;

function intervalsOverlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): boolean {
  const overlap = Math.min(a1, b1) - Math.max(a0, b0);
  return overlap > MIN_INTERVAL_OVERLAP_SEC;
}

function leafInterval(
  leaf: ExportLeaf,
  itemsMap: Map<ItemId, SceneItem>,
): { start: number; end: number } {
  const start = effectiveStart(leaf, itemsMap);
  const end = holdEnd(leaf, itemsMap);
  return { start, end };
}

function surroundingRectIntroInterval(
  sr: SurroundingRectItem,
  itemsMap: Map<ItemId, SceneItem>,
): { start: number; end: number } {
  const start = effectiveStart(sr, itemsMap);
  const end = start + sequentialAnimSecondsForSurroundingRect(sr);
  return { start, end };
}

function exitClipInterval(ex: ExitAnimationItem): { start: number; end: number } {
  return { start: ex.startTime, end: ex.startTime + ex.duration };
}

export type VisualPlaybackCluster = {
  leaves: ExportLeaf[];
  surroundingRects: SurroundingRectItem[];
  exitClips: ExitAnimationItem[];
};

type VisualNode =
  | { kind: 'leaf'; leaf: ExportLeaf }
  | { kind: 'sr'; sr: SurroundingRectItem }
  | { kind: 'exit'; exit: ExitAnimationItem };

function nodePlaybackInterval(
  node: VisualNode,
  itemsMap: Map<ItemId, SceneItem>,
): { start: number; end: number } {
  if (node.kind === 'leaf') return leafInterval(node.leaf, itemsMap);
  if (node.kind === 'sr') return surroundingRectIntroInterval(node.sr, itemsMap);
  return exitClipInterval(node.exit);
}

class UnionFind {
  private p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    if (this.p[i] !== i) this.p[i] = this.find(this.p[i]!);
    return this.p[i]!;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p[rb] = ra;
  }
}

function exitClipHasActiveTargets(ex: ExitAnimationItem): boolean {
  return ex.targets.some((x) => x.animStyle !== 'none');
}

/**
 * All non-audio timeline visuals that can share one concurrent Manim `play`.
 * Overlap uses leaf hold, surrounding-rect intro, and exit clip duration.
 */
export function clusterConcurrentVisualPlayback(
  flat: ExportLeaf[],
  items: SceneItem[],
  itemsMap: Map<ItemId, SceneItem>,
  _audioItems: AudioTrackItem[] | undefined,
): VisualPlaybackCluster[] {
  const nodes: VisualNode[] = [];
  for (const leaf of flat) {
    nodes.push({ kind: 'leaf', leaf });
  }
  for (const it of items) {
    if (it.kind === 'surroundingRect') {
      nodes.push({ kind: 'sr', sr: it });
    }
    if (it.kind === 'exit_animation' && exitClipHasActiveTargets(it)) {
      nodes.push({ kind: 'exit', exit: it });
    }
  }
  const n = nodes.length;
  if (n < 2) return [];

  const uf = new UnionFind(n);
  const iv = nodes.map((node) => nodePlaybackInterval(node, itemsMap));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (intervalsOverlap(iv[i]!.start, iv[i]!.end, iv[j]!.start, iv[j]!.end)) {
        uf.union(i, j);
      }
    }
  }
  const buckets = new Map<number, VisualNode[]>();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    const list = buckets.get(r) ?? [];
    list.push(nodes[i]!);
    buckets.set(r, list);
  }

  const out: VisualPlaybackCluster[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const leaves: ExportLeaf[] = [];
    const surroundingRects: SurroundingRectItem[] = [];
    const exitClips: ExitAnimationItem[] = [];
    for (const node of bucket) {
      if (node.kind === 'leaf') leaves.push(node.leaf);
      else if (node.kind === 'sr') surroundingRects.push(node.sr);
      else exitClips.push(node.exit);
    }
    out.push({ leaves, surroundingRects, exitClips });
  }
  return out;
}

export function visualClusterWallSeconds(
  leaves: ExportLeaf[],
  surroundingRects: SurroundingRectItem[],
  exitClips: ExitAnimationItem[],
  itemsMap: Map<ItemId, SceneItem>,
): number {
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const leaf of leaves) {
    const { start, end } = leafInterval(leaf, itemsMap);
    tMin = Math.min(tMin, start);
    tMax = Math.max(tMax, end);
  }
  for (const sr of surroundingRects) {
    const { start, end } = surroundingRectIntroInterval(sr, itemsMap);
    tMin = Math.min(tMin, start);
    tMax = Math.max(tMax, end);
  }
  for (const ex of exitClips) {
    const { start, end } = exitClipInterval(ex);
    tMin = Math.min(tMin, start);
    tMax = Math.max(tMax, end);
  }
  return Math.max(0, tMax - tMin);
}

function fmtRt(sec: number): string {
  const x = !Number.isFinite(sec) || sec <= 0 ? 0.01 : sec;
  return x.toFixed(6);
}

function concurrentAudioTailArg(
  recorded: ReturnType<typeof resolveRecordedPlayback>,
  leaf: ExportLeaf,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[] | undefined,
  tailOpts?: BoundAudioTailOpts,
): string {
  if (!recorded) return '';
  const t = audioItems?.length
    ? audioTailWaitAfterLeafPlayback(
        recorded,
        leaf,
        itemsMap,
        audioItems,
        tailOpts,
      )
    : audioTailWaitSec(recorded);
  if (t <= 1e-9) return '';
  return `, Wait(${fmtRt(t)})`;
}

function concurrentBranchForLeaf(
  leaf: ExportLeaf,
  relWait: number,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[] | undefined,
  tailOpts?: BoundAudioTailOpts,
): string {
  const wStr = Math.max(0, relWait).toFixed(4);

  if (leaf.kind === 'textLine') {
    const item = leaf;
    const varName = idToVarName.get(item.id)!;
    const runDur = item.parentId
      ? (item.localDuration ?? item.duration)
      : item.duration;
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

    const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
    const transformAnims =
      useTransform && tc && sourceVar
        ? collectTransformPlayAnims(
            item,
            varName,
            sourceVar,
            tc,
            sourceSegCount,
          ).join(', ')
        : null;

    const effRt = recorded ? recorded.runTime : runDur;
    if (transformAnims) {
      const segW = segmentWaitTotal(item.segments);
      const segArg = segW > 1e-9 ? `, Wait(${fmtRt(segW)})` : '';
      // Positional args must come before any keyword args (run_time); never append Wait after run_time=.
      return `Succession(Wait(${wStr}), AnimationGroup(${transformAnims}, lag_ratio=0)${segArg}${concurrentAudioTailArg(recorded, item, itemsMap, audioItems, tailOpts)}, run_time=${fmtRt(effRt)})`;
    }
    return textLineConcurrentWriteFadeExpr(
      varName,
      item,
      relWait,
      runDur,
      recorded ? recorded.runTime : null,
      recorded ?? null,
      itemsMap,
      audioItems,
      tailOpts,
    );
  }

  if (leaf.kind === 'axes') {
    const axVar = idToVarName.get(leaf.id)!;
    const recorded = resolveRecordedPlayback(leaf, itemsMap, audioItems);
    const rt = recorded ? recorded.runTime : leaf.duration;
    return `Succession(Wait(${wStr}), Create(${axVar}, run_time=${fmtRt(rt)})${concurrentAudioTailArg(recorded, leaf, itemsMap, audioItems, tailOpts)})`;
  }

  if (leaf.kind === 'graphPlot') {
    const axVar = idToVarName.get(leaf.axesId)!;
    const pVar = overlayPlotVar(axVar, leaf.id);
    const recorded = resolveRecordedPlayback(leaf, itemsMap, audioItems);
    const rt = recorded ? recorded.runTime : leaf.duration;
    return `Succession(Wait(${wStr}), Create(${pVar}, run_time=${fmtRt(rt)})${concurrentAudioTailArg(recorded, leaf, itemsMap, audioItems, tailOpts)})`;
  }

  if (leaf.kind === 'graphDot') {
    const axVar = idToVarName.get(leaf.axesId)!;
    const dVar = overlayDotVar(axVar, leaf.id);
    const dot = leaf.dot;
    const recorded = resolveRecordedPlayback(leaf, itemsMap, audioItems);
    const lbl = dot.label.trim();
    const rt = recorded ? recorded.runTime : leaf.duration;
    if (lbl) {
      return `Succession(Wait(${wStr}), FadeIn(${dVar}, run_time=${fmtRt(rt)}), Write(${dVar}_lbl, run_time=${MANIM_DEFAULT_PLAY_SEC})${concurrentAudioTailArg(recorded, leaf, itemsMap, audioItems, tailOpts)})`;
    }
    return `Succession(Wait(${wStr}), FadeIn(${dVar}, run_time=${fmtRt(rt)})${concurrentAudioTailArg(recorded, leaf, itemsMap, audioItems, tailOpts)})`;
  }

  if (leaf.kind === 'graphField') {
    const axVar = idToVarName.get(leaf.axesId)!;
    const suf = pythonOverlaySuffix(leaf.id);
    const vf = `${axVar}_vf_${suf}`;
    const streamsVar = `${axVar}_streams_${suf}`;
    const seeds = leaf.streamPoints ?? [];
    const recorded = resolveRecordedPlayback(leaf, itemsMap, audioItems);
    const baseRt = recorded ? recorded.runTime : leaf.duration;
    if (seeds.length > 0) {
      return `Succession(Wait(${wStr}), Create(${vf}, run_time=${fmtRt(baseRt)}), Create(${streamsVar}, run_time=${MANIM_DEFAULT_PLAY_SEC})${concurrentAudioTailArg(recorded, leaf, itemsMap, audioItems, tailOpts)})`;
    }
    return `Succession(Wait(${wStr}), Create(${vf}, run_time=${fmtRt(baseRt)})${concurrentAudioTailArg(recorded, leaf, itemsMap, audioItems, tailOpts)})`;
  }

  if (leaf.kind === 'graphSeriesViz') {
    const item: GraphSeriesVizItem = leaf;
    const suf = pythonOverlaySuffix(item.id);
    const hi = Math.max(Math.round(item.nMin), Math.round(item.nMax));
    const rateArg = seriesRateFuncArg(item.nEasing);
    const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
    const rtStr = recorded ? recorded.runTime.toFixed(6) : item.duration.toFixed(6);
    return `Succession(Wait(${wStr}), sv_nt_${suf}.animate.set_value(${hi})${concurrentAudioTailArg(recorded, item, itemsMap, audioItems, tailOpts)}, run_time=${rtStr}${rateArg})`;
  }

  if (leaf.kind === 'shape') {
    const varName = idToVarName.get(leaf.id)!;
    const recorded = resolveRecordedPlayback(leaf, itemsMap, audioItems);
    const rtStr = recorded
      ? recorded.runTime.toFixed(6)
      : Math.max(0.05, leaf.duration).toFixed(6);
    if (recorded) {
      const intro =
        leaf.introStyle === 'fade_in'
          ? `FadeIn(${varName}, run_time=${rtStr})`
          : `Create(${varName}, run_time=${rtStr})`;
      return `Succession(Wait(${wStr}), ${intro}${concurrentAudioTailArg(recorded, leaf, itemsMap, audioItems, tailOpts)})`;
    }
    const intro =
      leaf.introStyle === 'fade_in' ? `FadeIn(${varName})` : `Create(${varName})`;
    return `Succession(Wait(${wStr}), ${intro}, run_time=${rtStr})`;
  }

  return `Succession(Wait(${wStr}), Wait(0.01), run_time=0.01)`;
}

function concurrentBranchForSurroundingRect(
  sr: SurroundingRectItem,
  relWait: number,
  idToVarName: Map<ItemId, string>,
): string {
  const sv = idToVarName.get(sr.id)!;
  const rt = Math.max(0.05, sr.introRunTime);
  const rtStr = rt.toFixed(4);
  const wStr = Math.max(0, relWait).toFixed(4);
  const intro =
    sr.introStyle === 'fade_in' ? `FadeIn(${sv})` : `Create(${sv})`;
  if (sr.labelText.trim()) {
    return `Succession(Wait(${wStr}), AnimationGroup(${intro}, Write(${sv}_lbl), lag_ratio=0), run_time=${rtStr})`;
  }
  return `Succession(Wait(${wStr}), ${intro}, run_time=${rtStr})`;
}

function concurrentBranchForExitClip(
  ex: ExitAnimationItem,
  relWait: number,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
): string {
  const wStr = Math.max(0, relWait).toFixed(4);
  const parts: { targetsStr: string; animStyle: ExitAnimStyle }[] = [];
  for (const spec of ex.targets) {
    if (spec.animStyle === 'none') continue;
    const tgt = itemsMap.get(spec.targetId);
    if (!tgt) continue;
    const targetsStr = resolveExitTargetsForExport(tgt, idToVarName);
    if (!targetsStr) continue;
    parts.push({ targetsStr, animStyle: spec.animStyle });
  }
  const rt = Math.max(0.01, ex.duration).toFixed(4);
  if (parts.length === 0) {
    return `Succession(Wait(${wStr}), Wait(0.01), run_time=0.01)`;
  }
  if (parts.length === 1) {
    const p = parts[0]!;
    const inner = exitAnimationExpr(p.targetsStr, p.animStyle);
    if (!inner) return `Succession(Wait(${wStr}), Wait(0.01), run_time=0.01)`;
    return `Succession(Wait(${wStr}), ${inner}, run_time=${rt})`;
  }
  const anims = parts
    .map((p) => exitAnimationExpr(p.targetsStr, p.animStyle))
    .filter(Boolean);
  return `Succession(Wait(${wStr}), AnimationGroup(${anims.join(', ')}, lag_ratio=0), run_time=${rt})`;
}

type VisualParticipant =
  | { kind: 'leaf'; leaf: ExportLeaf; t: number; key: string }
  | { kind: 'sr'; sr: SurroundingRectItem; t: number; key: string }
  | { kind: 'exit'; exit: ExitAnimationItem; t: number; key: string };

function sortedVisualParticipants(
  leaves: ExportLeaf[],
  surroundingRects: SurroundingRectItem[],
  exitClips: ExitAnimationItem[],
  itemsMap: Map<ItemId, SceneItem>,
): VisualParticipant[] {
  const out: VisualParticipant[] = [];
  for (const leaf of leaves) {
    out.push({
      kind: 'leaf',
      leaf,
      t: effectiveStart(leaf, itemsMap),
      key: leaf.id,
    });
  }
  for (const sr of surroundingRects) {
    out.push({
      kind: 'sr',
      sr,
      t: effectiveStart(sr, itemsMap),
      key: sr.id,
    });
  }
  for (const ex of exitClips) {
    out.push({
      kind: 'exit',
      exit: ex,
      t: ex.startTime,
      key: ex.id,
    });
  }
  out.sort((a, b) => a.t - b.t || a.key.localeCompare(b.key));
  return out;
}

export function buildConcurrentVisualClusterPlay(
  leaves: ExportLeaf[],
  surroundingRects: SurroundingRectItem[],
  exitClips: ExitAnimationItem[],
  playPad: string,
  baseIndent: number,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[] | undefined,
  tailOpts?: BoundAudioTailOpts,
): string {
  const parts = sortedVisualParticipants(
    leaves,
    surroundingRects,
    exitClips,
    itemsMap,
  );
  if (parts.length === 0) return '';

  const t0 = parts[0]!.t;

  let preamble = '';
  const seenSeries = new Set<ItemId>();
  for (const leaf of leaves) {
    if (leaf.kind !== 'graphSeriesViz') continue;
    if (seenSeries.has(leaf.id)) continue;
    seenSeries.add(leaf.id);
    preamble += buildGraphSeriesVizAddLine(leaf, baseIndent);
  }

  type SoundLine = { rel: number; line: string };
  const soundEntries: SoundLine[] = [];
  for (const p of parts) {
    if (p.kind !== 'leaf') continue;
    const rec = resolveRecordedPlayback(p.leaf, itemsMap, audioItems);
    if (!rec) continue;
    if (
      audioItems?.length &&
      boundSoundEmittedAtTrackStart(p.leaf, itemsMap, audioItems)
    ) {
      continue;
    }
    const rel = Math.max(0, p.t - t0);
    soundEntries.push({
      rel,
      line: `${playPad}self.add_sound("${rec.soundPath}", time_offset=${rel.toFixed(4)})\n`,
    });
  }
  soundEntries.sort((a, b) => a.rel - b.rel || a.line.localeCompare(b.line));
  const soundBlock = soundEntries.map((s) => s.line).join('');

  const innerPad = `${playPad}    `;
  const branches = parts.map((p) => {
    const rel = p.t - t0;
    if (p.kind === 'leaf') {
      return concurrentBranchForLeaf(
        p.leaf,
        rel,
        idToVarName,
        itemsMap,
        audioItems,
        tailOpts,
      );
    }
    if (p.kind === 'sr') {
      return concurrentBranchForSurroundingRect(p.sr, rel, idToVarName);
    }
    return concurrentBranchForExitClip(
      p.exit,
      rel,
      idToVarName,
      itemsMap,
    );
  });

  const wall = Math.max(
    0.01,
    visualClusterWallSeconds(leaves, surroundingRects, exitClips, itemsMap),
  );
  const wallStr = wall.toFixed(4);
  const joined = branches.join(`,\n${innerPad}`);
  return (
    preamble +
    soundBlock +
    `${playPad}self.play(AnimationGroup(\n${innerPad}${joined},\n${innerPad}lag_ratio=0,\n${playPad}), run_time=${wallStr})\n`
  );
}
