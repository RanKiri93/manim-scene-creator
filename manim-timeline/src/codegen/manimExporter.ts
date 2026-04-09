import type {
  SceneItem,
  SceneDefaults,
  ItemId,
  AudioTrackItem,
  AxesItem,
  ExitAnimationItem,
  GraphPlotItem,
  GraphDotItem,
  GraphFieldItem,
  GraphSeriesVizItem,
  SurroundingRectItem,
  ExitAnimStyle,
} from '@/types/scene';
import { safeSceneClassName } from '@/lib/pythonIdent';
import {
  type BoundAudioTailOpts,
  generateLineDef,
  generateLinePos,
  generateLinePlay,
  listUnboundAudioTracksForExport,
  generateUnboundAudioAddSoundLine,
} from './lineCodegen';
import {
  generateAxesDef,
  generateAxesPos,
  generateAxesPlay,
  generateGraphPlotDef,
  generateGraphPlotPlay,
  generateGraphDotDef,
  generateGraphDotPlay,
  generateGraphFieldDef,
  generateGraphFieldPlay,
  generateGraphSeriesVizDef,
  generateGraphSeriesVizPlay,
  validateAxesExit,
  formatExitGroupPlayLine,
  resolveExitTargetsForExport,
} from './graphCodegen';
import {
  generateSurroundingRectPosBlock,
  generateSurroundingRectPlay,
  resolveSurroundTargetExpr,
  surroundPosAnchorId,
} from './surroundCodegen';
import {
  generateShapeDef,
  generateShapePos,
  generateShapePlay,
} from './shapeCodegen';
import { flattenExportLeaves, type ExportLeaf } from './flattenExport';
import {
  sequentialAnimSecondsForExit,
  sequentialAnimSecondsForLeaf,
  sequentialAnimSecondsForSurroundingRect,
} from './groupPlaybackSpan';
import {
  buildConcurrentVisualClusterPlay,
  clusterConcurrentVisualPlayback,
  visualClusterWallSeconds,
} from './leafConcurrentCodegen';

type PlaybackEvent =
  | { t: number; kind: 'audio'; track: AudioTrackItem }
  | { t: number; kind: 'leaf'; leaf: ExportLeaf }
  | {
      t: number;
      kind: 'visual_cluster';
      leaves: ExportLeaf[];
      surroundingRects: SurroundingRectItem[];
      exitClips: ExitAnimationItem[];
    }
  | { t: number; kind: 'surrounding_rect'; sr: SurroundingRectItem }
  | { t: number; kind: 'exit'; exit: ExitAnimationItem };

import { canBeSurroundTarget, effectiveStart, holdEnd } from '@/lib/time';

const TIMELINE_GAP_EPS = 0.001;

/** Smallest `playEvents[].t` strictly after `t` (timeline ordering). */
function nextTimelineEventAfter(
  t: number,
  playEvents: PlaybackEvent[],
): number | null {
  let best: number | null = null;
  for (const e of playEvents) {
    if (e.t > t + TIMELINE_GAP_EPS) {
      if (best === null || e.t < best) best = e.t;
    }
  }
  return best;
}

function concurrentClusterWallTimelineEnd(
  vc: {
    leaves: ExportLeaf[];
    surroundingRects: SurroundingRectItem[];
    exitClips: ExitAnimationItem[];
  },
  itemsMap: Map<ItemId, SceneItem>,
): number {
  let m = -Infinity;
  for (const L of vc.leaves) {
    m = Math.max(m, holdEnd(L, itemsMap));
  }
  for (const sr of vc.surroundingRects) {
    m = Math.max(
      m,
      effectiveStart(sr, itemsMap) + sequentialAnimSecondsForSurroundingRect(sr),
    );
  }
  for (const ex of vc.exitClips) {
    m = Math.max(m, ex.startTime + ex.duration);
  }
  return m;
}

function itemsToMap(items: SceneItem[]): Map<ItemId, SceneItem> {
  return new Map(items.map((it) => [it.id, it]));
}

interface ExportOptions {
  fullFile: boolean;
  defaults: SceneDefaults;
  audioItems?: AudioTrackItem[];
}

function leafNeedsNumpy(it: ExportLeaf): boolean {
  return (
    it.kind === 'axes' ||
    it.kind === 'graphPlot' ||
    it.kind === 'graphField' ||
    it.kind === 'graphSeriesViz'
  );
}

function leafNeedsRateFuncs(it: ExportLeaf): boolean {
  return it.kind === 'graphSeriesViz' && it.nEasing !== 'linear';
}

function validateOverlayAxes(
  item: GraphPlotItem | GraphDotItem | GraphFieldItem | GraphSeriesVizItem,
  itemsMap: Map<ItemId, SceneItem>,
): string | null {
  const ax = itemsMap.get(item.axesId);
  if (!ax || ax.kind !== 'axes') {
    return (
      `Clip "${item.label || item.id}" (${item.kind}) references missing axes id "${item.axesId}".`
    );
  }
  return null;
}

function exportManimCodeInner(
  items: SceneItem[],
  options: ExportOptions,
): string {
  const flat = flattenExportLeaves(items);
  const itemsMap = itemsToMap(items);

  for (const a of options.audioItems ?? []) {
    if (a.assetRelPath?.trim()) continue;
    if (a.audioUrl.trim().toLowerCase().startsWith('blob:')) {
      throw new Error(
        'An audio clip uses a temporary blob URL (older TTS). Remove it and add the line again with TTS so the file is stored on the measure server under assets/audio.',
      );
    }
  }

  for (const it of flat) {
    if (it.kind === 'axes') {
      const err = validateAxesExit(it, items);
      if (err) throw new Error(err);
    }
    if (
      it.kind === 'graphPlot' ||
      it.kind === 'graphDot' ||
      it.kind === 'graphField' ||
      it.kind === 'graphSeriesViz'
    ) {
      const err = validateOverlayAxes(it, itemsMap);
      if (err) throw new Error(err);
    }
  }

  const needsNumpy = flat.some(leafNeedsNumpy);
  const needsRateFuncs = flat.some(leafNeedsRateFuncs);

  const base = options.fullFile ? 8 : 4;
  const prefix = options.defaults.exportNamePrefix;
  const pf = (name: string) => (prefix ? `${prefix}${name}` : name);

  const idToVarName = new Map<ItemId, string>();
  let lineNum = 0;
  let axesNum = 0;
  let shapeNum = 0;
  for (const it of flat) {
    if (it.kind === 'textLine') {
      lineNum += 1;
      idToVarName.set(it.id, pf(`line_${lineNum}`));
    } else if (it.kind === 'axes') {
      axesNum += 1;
      idToVarName.set(it.id, pf(`axes_${axesNum}`));
    } else if (it.kind === 'shape') {
      shapeNum += 1;
      idToVarName.set(it.id, pf(`shape_${shapeNum}`));
    }
  }

  const srSorted = items
    .filter((i): i is SurroundingRectItem => i.kind === 'surroundingRect')
    .sort((a, b) => a.id.localeCompare(b.id));
  let srNum = 0;
  for (const sr of srSorted) {
    srNum += 1;
    idToVarName.set(sr.id, pf(`sr_${srNum}`));
  }

  const surroundByAnchor = new Map<ItemId, SurroundingRectItem[]>();
  for (const raw of items) {
    if (raw.kind !== 'surroundingRect') continue;
    const tgt = itemsMap.get(raw.targetId);
    if (!tgt || !canBeSurroundTarget(tgt)) continue;
    const aid = surroundPosAnchorId(tgt);
    if (!aid) continue;
    const list = surroundByAnchor.get(aid) ?? [];
    list.push(raw);
    surroundByAnchor.set(aid, list);
  }
  for (const list of surroundByAnchor.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }

  for (const it of items) {
    if (it.kind !== 'surroundingRect') continue;
    const tgt = itemsMap.get(it.targetId);
    if (!tgt || !canBeSurroundTarget(tgt)) {
      throw new Error(
        `Surrounding rectangle "${it.label || it.id}" has a missing or invalid target.`,
      );
    }
    if (!resolveSurroundTargetExpr(tgt, idToVarName, it.segmentIndices)) {
      throw new Error(
        `Surrounding rectangle "${it.label || it.id}" could not resolve a Manim target for export.`,
      );
    }
  }

  let defStr = '';
  let posStr = '';
  let playStr = '';

  const axesLeaves = flat.filter((it): it is AxesItem => it.kind === 'axes');
  for (const it of axesLeaves) {
    const axVar = idToVarName.get(it.id)!;
    defStr += generateAxesDef(it, axVar, base);
  }

  const overlays = flat.filter(
    (it): it is GraphPlotItem | GraphDotItem | GraphFieldItem | GraphSeriesVizItem =>
      it.kind === 'graphPlot' ||
      it.kind === 'graphDot' ||
      it.kind === 'graphField' ||
      it.kind === 'graphSeriesViz',
  );
  overlays.sort((a, b) => a.id.localeCompare(b.id));

  for (const ov of overlays) {
    const axVar = idToVarName.get(ov.axesId);
    if (!axVar) continue;
    const axItem = itemsMap.get(ov.axesId);
    if (!axItem || axItem.kind !== 'axes') continue;

    if (ov.kind === 'graphPlot') {
      defStr += generateGraphPlotDef(ov, axVar, base);
    } else if (ov.kind === 'graphDot') {
      defStr += generateGraphDotDef(ov, axVar, base);
    } else if (ov.kind === 'graphField') {
      defStr += generateGraphFieldDef(ov, axVar, axItem, base);
    } else {
      defStr += generateGraphSeriesVizDef(ov, axVar, axItem, base);
    }
  }

  for (const it of flat) {
    if (it.kind === 'textLine') {
      const varName = idToVarName.get(it.id)!;
      defStr += generateLineDef(it, varName, base);
    } else if (it.kind === 'shape') {
      const varName = idToVarName.get(it.id)!;
      defStr += generateShapeDef(it, varName, base);
    }
  }

  for (const it of flat) {
    if (it.kind === 'axes') {
      const axVar = idToVarName.get(it.id)!;
      posStr += generateAxesPos(it, axVar, base, idToVarName);
      const srs = surroundByAnchor.get(it.id);
      if (srs) {
        for (const sr of srs) {
          const sv = idToVarName.get(sr.id);
          if (!sv) continue;
          posStr += generateSurroundingRectPosBlock(
            sr,
            sv,
            idToVarName,
            itemsMap,
            base,
          );
        }
      }
    } else if (it.kind === 'textLine') {
      const varName = idToVarName.get(it.id)!;
      posStr += generateLinePos(it, varName, base, idToVarName, itemsMap);
      const srs = surroundByAnchor.get(it.id);
      if (srs) {
        for (const sr of srs) {
          const sv = idToVarName.get(sr.id);
          if (!sv) continue;
          posStr += generateSurroundingRectPosBlock(
            sr,
            sv,
            idToVarName,
            itemsMap,
            base,
          );
        }
      }
    } else if (it.kind === 'shape') {
      const varName = idToVarName.get(it.id)!;
      posStr += generateShapePos(it, varName, base, idToVarName);
      const srs = surroundByAnchor.get(it.id);
      if (srs) {
        for (const sr of srs) {
          const sv = idToVarName.get(sr.id);
          if (!sv) continue;
          posStr += generateSurroundingRectPosBlock(
            sr,
            sv,
            idToVarName,
            itemsMap,
            base,
          );
        }
      }
    }
  }

  const playPad = ' '.repeat(base);
  let timelineCursor = 0;

  const audioList = options.audioItems ?? [];
  const unboundAudio = listUnboundAudioTracksForExport(audioList, flat, itemsMap);

  const visualClusters = clusterConcurrentVisualPlayback(
    flat,
    items,
    itemsMap,
    options.audioItems,
  );
  const inVisualCluster = new Set<ItemId>();
  for (const c of visualClusters) {
    const n =
      c.leaves.length + c.surroundingRects.length + c.exitClips.length;
    if (n >= 2) {
      for (const L of c.leaves) inVisualCluster.add(L.id);
      for (const sr of c.surroundingRects) inVisualCluster.add(sr.id);
      for (const ex of c.exitClips) inVisualCluster.add(ex.id);
    }
  }

  const playEvents: PlaybackEvent[] = [];
  for (const it of flat) {
    if (inVisualCluster.has(it.id)) continue;
    playEvents.push({ t: effectiveStart(it, itemsMap), kind: 'leaf', leaf: it });
  }
  for (const c of visualClusters) {
    if (
      c.leaves.length + c.surroundingRects.length + c.exitClips.length <
      2
    ) {
      continue;
    }
    const clusterTimes = [
      ...c.leaves.map((L) => effectiveStart(L, itemsMap)),
      ...c.surroundingRects.map((sr) => effectiveStart(sr, itemsMap)),
      ...c.exitClips.map((ex) => ex.startTime),
    ];
    const t = Math.min(...clusterTimes);
    const sortedLeaves = [...c.leaves].sort(
      (a, b) =>
        effectiveStart(a, itemsMap) - effectiveStart(b, itemsMap) ||
        a.id.localeCompare(b.id),
    );
    const sortedSrs = [...c.surroundingRects].sort(
      (a, b) =>
        effectiveStart(a, itemsMap) - effectiveStart(b, itemsMap) ||
        a.id.localeCompare(b.id),
    );
    const sortedExits = [...c.exitClips].sort(
      (a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id),
    );
    playEvents.push({
      t,
      kind: 'visual_cluster',
      leaves: sortedLeaves,
      surroundingRects: sortedSrs,
      exitClips: sortedExits,
    });
  }
  for (const tr of unboundAudio) {
    playEvents.push({ t: tr.startTime, kind: 'audio', track: tr });
  }
  for (const it of items) {
    if (it.kind === 'surroundingRect' && !inVisualCluster.has(it.id)) {
      playEvents.push({
        t: effectiveStart(it, itemsMap),
        kind: 'surrounding_rect',
        sr: it,
      });
    }
  }
  for (const it of items) {
    if (
      it.kind === 'exit_animation' &&
      it.targets.some((x) => x.animStyle !== 'none') &&
      !inVisualCluster.has(it.id)
    ) {
      playEvents.push({ t: it.startTime, kind: 'exit', exit: it });
    }
  }
  const eventKindOrder = (k: PlaybackEvent['kind']) => {
    if (k === 'audio') return 0;
    if (k === 'leaf' || k === 'visual_cluster') return 1;
    if (k === 'surrounding_rect') return 2;
    return 3;
  };
  const leafEventSortKey = (e: PlaybackEvent): string => {
    if (e.kind === 'leaf') return e.leaf.id;
    if (e.kind === 'visual_cluster') {
      return [
        ...e.leaves.map((L) => L.id),
        ...e.surroundingRects.map((s) => s.id),
        ...e.exitClips.map((x) => x.id),
      ]
        .sort()
        .join(',');
    }
    return '';
  };
  playEvents.sort((a, b) => {
    const d = a.t - b.t;
    if (Math.abs(d) > TIMELINE_GAP_EPS) return d;
    const ko = eventKindOrder(a.kind) - eventKindOrder(b.kind);
    if (ko !== 0) return ko;
    if (a.kind === 'audio' && b.kind === 'audio') {
      return a.track.id.localeCompare(b.track.id);
    }
    if (
      (a.kind === 'leaf' || a.kind === 'visual_cluster') &&
      (b.kind === 'leaf' || b.kind === 'visual_cluster')
    ) {
      return leafEventSortKey(a).localeCompare(leafEventSortKey(b));
    }
    if (a.kind === 'surrounding_rect' && b.kind === 'surrounding_rect') {
      return a.sr.id.localeCompare(b.sr.id);
    }
    if (a.kind === 'exit' && b.kind === 'exit') {
      return a.exit.id.localeCompare(b.exit.id);
    }
    return 0;
  });

  const emitLeafPlay = (
    it: ExportLeaf,
    tailOpts?: BoundAudioTailOpts,
  ): string => {
    if (it.kind === 'textLine') {
      const varName = idToVarName.get(it.id)!;
      return generateLinePlay(
        it,
        varName,
        base,
        idToVarName,
        itemsMap,
        options.audioItems,
        tailOpts,
      );
    }
    if (it.kind === 'axes') {
      const axVar = idToVarName.get(it.id)!;
      return generateAxesPlay(
        it,
        axVar,
        base,
        itemsMap,
        options.audioItems,
        tailOpts,
      );
    }
    if (it.kind === 'graphPlot') {
      const axVar = idToVarName.get(it.axesId);
      if (!axVar) return '';
      return generateGraphPlotPlay(
        it,
        axVar,
        base,
        itemsMap,
        options.audioItems,
        tailOpts,
      );
    }
    if (it.kind === 'graphDot') {
      const axVar = idToVarName.get(it.axesId);
      if (!axVar) return '';
      return generateGraphDotPlay(
        it,
        axVar,
        base,
        itemsMap,
        options.audioItems,
        tailOpts,
      );
    }
    if (it.kind === 'graphField') {
      const axVar = idToVarName.get(it.axesId);
      if (!axVar) return '';
      return generateGraphFieldPlay(
        it,
        axVar,
        base,
        itemsMap,
        options.audioItems,
        tailOpts,
      );
    }
    if (it.kind === 'graphSeriesViz') {
      const axVar = idToVarName.get(it.axesId);
      if (!axVar) return '';
      return generateGraphSeriesVizPlay(
        it,
        axVar,
        base,
        itemsMap,
        options.audioItems,
        tailOpts,
      );
    }
    if (it.kind === 'shape') {
      const varName = idToVarName.get(it.id)!;
      return generateShapePlay(
        it,
        varName,
        base,
        itemsMap,
        options.audioItems,
        tailOpts,
      );
    }
    return '';
  };

  for (let i = 0; i < playEvents.length; ) {
    const t0 = playEvents[i]!.t;
    const group: PlaybackEvent[] = [];
    while (
      i < playEvents.length &&
      Math.abs(playEvents[i]!.t - t0) <= TIMELINE_GAP_EPS
    ) {
      group.push(playEvents[i]!);
      i++;
    }

    if (t0 > timelineCursor + TIMELINE_GAP_EPS) {
      playStr += `${playPad}self.wait(${(t0 - timelineCursor).toFixed(4)})\n`;
      timelineCursor = t0;
    }

    const audios = group.filter((e): e is Extract<PlaybackEvent, { kind: 'audio' }> => e.kind === 'audio');
    const leaves = group.filter((e): e is Extract<PlaybackEvent, { kind: 'leaf' }> => e.kind === 'leaf');
    const visualClustersInGroup = group.filter(
      (e): e is Extract<PlaybackEvent, { kind: 'visual_cluster' }> =>
        e.kind === 'visual_cluster',
    );
    const surrounds = group.filter(
      (e): e is Extract<PlaybackEvent, { kind: 'surrounding_rect' }> =>
        e.kind === 'surrounding_rect',
    );
    const exits = group.filter((e): e is Extract<PlaybackEvent, { kind: 'exit' }> => e.kind === 'exit');

    if (audios.length && t0 + TIMELINE_GAP_EPS < timelineCursor) {
      playStr += `${playPad}# Note: audio below overlaps earlier playback in export order (Manim runs sequentially).\n`;
    }

    for (const a of audios) {
      playStr += generateUnboundAudioAddSoundLine(a.track, base);
    }
    for (const vc of visualClustersInGroup) {
      const wallT = concurrentClusterWallTimelineEnd(vc, itemsMap);
      const clusterTailCeil = nextTimelineEventAfter(wallT, playEvents);
      playStr += buildConcurrentVisualClusterPlay(
        vc.leaves,
        vc.surroundingRects,
        vc.exitClips,
        playPad,
        base,
        idToVarName,
        itemsMap,
        options.audioItems,
        clusterTailCeil != null
          ? { tailCeilingAbs: clusterTailCeil }
          : undefined,
      );
    }
    if (visualClustersInGroup.length && leaves.length) {
      playStr += `${playPad}# Note: mergeable concurrent cluster(s) above run with non-mergeable clip(s) below in one time group — verify timing if they overlap.\n`;
    }
    for (const e of leaves) {
      const he = holdEnd(e.leaf, itemsMap);
      const tailCeil = nextTimelineEventAfter(he, playEvents);
      playStr += emitLeafPlay(
        e.leaf,
        tailCeil != null ? { tailCeilingAbs: tailCeil } : undefined,
      );
    }
    for (const su of surrounds) {
      const sv = idToVarName.get(su.sr.id);
      if (sv) {
        playStr += generateSurroundingRectPlay(su.sr, sv, base);
      }
    }
    for (const ex of exits) {
      const parts: { targetsStr: string; animStyle: ExitAnimStyle }[] = [];
      for (const spec of ex.exit.targets) {
        if (spec.animStyle === 'none') continue;
        const tgt = itemsMap.get(spec.targetId);
        if (!tgt) continue;
        const targetsStr = resolveExitTargetsForExport(tgt, idToVarName);
        if (!targetsStr) continue;
        parts.push({ targetsStr, animStyle: spec.animStyle });
      }
      playStr += formatExitGroupPlayLine(parts, ex.exit.duration, playPad);
    }

    let groupEnd = t0;
    for (const a of audios) {
      groupEnd = Math.max(groupEnd, t0 + a.track.duration);
    }
    for (const vc of visualClustersInGroup) {
      for (const L of vc.leaves) {
        groupEnd = Math.max(groupEnd, holdEnd(L, itemsMap));
      }
      for (const sr of vc.surroundingRects) {
        groupEnd = Math.max(groupEnd, holdEnd(sr, itemsMap));
      }
      for (const ex of vc.exitClips) {
        groupEnd = Math.max(groupEnd, ex.startTime + ex.duration);
      }
    }
    for (const e of leaves) {
      groupEnd = Math.max(groupEnd, holdEnd(e.leaf, itemsMap));
    }
    for (const su of surrounds) {
      groupEnd = Math.max(
        groupEnd,
        su.sr.startTime + sequentialAnimSecondsForSurroundingRect(su.sr),
      );
    }
    for (const ex of exits) {
      groupEnd = Math.max(groupEnd, ex.exit.startTime + ex.exit.duration);
    }

    // Manim's `add_sound` does not advance scene time. Pad with wait() so the scene clock
    // catches up — but do not wait past the *next* timeline event, or overlapping clips
    // (e.g. text at 0.8s while audio runs 0–4s) would run only after the full audio wait.
    const nextT =
      i < playEvents.length ? playEvents[i]!.t : Number.POSITIVE_INFINITY;
    const capEnd = Math.min(groupEnd, nextT);
    const groupSpanCapped = capEnd - t0;

    let animSec = 0;
    for (const vc of visualClustersInGroup) {
      animSec += visualClusterWallSeconds(
        vc.leaves,
        vc.surroundingRects,
        vc.exitClips,
        itemsMap,
      );
    }
    for (const e of leaves) {
      const he = holdEnd(e.leaf, itemsMap);
      const tailCeil = nextTimelineEventAfter(he, playEvents);
      animSec += sequentialAnimSecondsForLeaf(
        e.leaf,
        itemsMap,
        options.audioItems,
        tailCeil != null ? { tailCeilingAbs: tailCeil } : undefined,
      );
    }
    for (const su of surrounds) {
      animSec += sequentialAnimSecondsForSurroundingRect(su.sr);
    }
    for (const ex of exits) {
      animSec += sequentialAnimSecondsForExit(ex.exit);
    }
    const padAfter = Math.max(0, groupSpanCapped - animSec);
    if (padAfter > TIMELINE_GAP_EPS) {
      playStr += `${playPad}self.wait(${padAfter.toFixed(4)})\n`;
    }

    const advanced = t0 + animSec + padAfter;
    if (Number.isFinite(nextT) && advanced > nextT + TIMELINE_GAP_EPS) {
      playStr += `${playPad}# Note: scene clock after this group (${advanced.toFixed(4)}s) exceeds next timeline event at ${nextT.toFixed(4)}s — verify timing.\n`;
    }

    timelineCursor = Math.max(timelineCursor, t0 + animSec + padAfter);
  }

  let fullSceneEnd = timelineCursor;
  for (const tr of audioList) {
    fullSceneEnd = Math.max(fullSceneEnd, tr.startTime + tr.duration);
  }
  for (const leaf of flat) {
    fullSceneEnd = Math.max(fullSceneEnd, holdEnd(leaf, itemsMap));
  }
  for (const it of items) {
    if (
      it.kind === 'exit_animation' &&
      it.targets.some((x) => x.animStyle !== 'none')
    ) {
      fullSceneEnd = Math.max(fullSceneEnd, it.startTime + it.duration);
    }
    if (it.kind === 'surroundingRect') {
      fullSceneEnd = Math.max(fullSceneEnd, holdEnd(it, itemsMap));
    }
  }
  if (fullSceneEnd > timelineCursor + TIMELINE_GAP_EPS) {
    playStr += `${playPad}self.wait(${(fullSceneEnd - timelineCursor).toFixed(4)})\n`;
    timelineCursor = fullSceneEnd;
  }

  if (!options.fullFile) {
    return `${defStr}\n${posStr}\n${playStr}`;
  }

  let header = 'from manim import *\n';
  header += 'from manim.utils.color import ManimColor\n';
  if (needsNumpy) {
    header += 'import numpy as np\n';
  }
  if (needsRateFuncs) {
    header += 'from manim.utils.rate_functions import smooth, ease_out_sine\n';
  }
  header += 'from hebrew_math_line import HebrewMathLine\n';

  const className = safeSceneClassName(options.defaults.sceneName ?? '');
  let body = `\nclass ${className}(Scene):\n`;
  body += '    def construct(self):\n';

  body += `        # ========== 1. Definitions ==========\n`;
  body += defStr;
  body += `\n        # ========== 2. Positioning ==========\n`;
  body += posStr;
  body += `\n        # ========== 3. Playback ==========\n`;
  body += playStr;

  return header + body;
}

/**
 * Generate the complete Manim Python source from a list of SceneItems.
 * Compound clips are flattened to their child text lines in timeline order.
 */
export function exportManimCode(
  items: SceneItem[],
  options: ExportOptions,
): string {
  try {
    return exportManimCodeInner(items, options);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!options.fullFile) {
      return `# EXPORT ERROR: ${msg}\n`;
    }
    return (
      'from manim import *\n\n' +
      `# EXPORT ERROR: ${msg}\n` +
      'class ExportErrorScene(Scene):\n' +
      '    def construct(self):\n' +
      '        pass\n'
    );
  }
}
