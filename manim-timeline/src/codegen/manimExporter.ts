import type {
  SceneItem,
  SceneDefaults,
  ItemId,
  AudioTrackItem,
  AxesItem,
  ExitAnimationItem,
  BlinkAnimationItem,
  TargetAnimationItem,
  GraphPlotItem,
  GraphCurveItem,
  GraphDotItem,
  GraphFieldItem,
  GraphFunctionSeriesItem,
  GraphPointSequenceItem,
  GraphAreaItem,
  SurroundingRectItem,
  ExitAnimStyle,
} from '@/types/scene';
import { functionSeriesHasErrors, isVisibleAtSceneStartItem, pointSequenceHasErrors } from '@/types/scene';
import { safeSceneClassName } from '@/lib/pythonIdent';
import { compareGraphStackOverlays } from '@/lib/graphPreview';
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
  generateGraphCurveDef,
  generateGraphCurvePlay,
  generateGraphPlotDef,
  generateGraphPlotPlay,
  generateGraphDotDef,
  generateGraphDotSnapToAxes,
  generateGraphDotPlay,
  generateGraphOverlayZIndexLines,
  generateGraphFieldDef,
  generateGraphFieldPlay,
  generateGraphAreaDef,
  generateGraphAreaPlay,
  validateAxesExit,
  formatExitGroupPlayLine,
  resolveExitTargetsForExport,
} from './graphCodegen';
import {
  generateSurroundingRectPosBlock,
  generateSurroundingRectPlay,
  resolveSurroundRectTargetExpr,
  surroundPlacementLeafId,
} from './surroundCodegen';
import {
  generateShapeDef,
  generateShapePos,
  generateShapePlay,
} from './shapeCodegen';
import { flattenExportLeaves, type ExportLeaf } from './flattenExport';
import {
  sequentialAnimSecondsForExit,
  sequentialAnimSecondsForBlink,
  sequentialAnimSecondsForTargetAnimation,
  sequentialAnimSecondsForLeaf,
  sequentialAnimSecondsForSurroundingRect,
} from './groupPlaybackSpan';
import {
  buildConcurrentVisualClusterPlay,
  clusterConcurrentVisualPlayback,
  visualClusterWallSeconds,
} from './leafConcurrentCodegen';
import {
  anyReplacementFunctionSeries,
  functionSeriesRevealTransformSource,
  generateGraphFunctionSeriesDef,
  generateGraphFunctionSeriesPlay,
} from './functionSeriesCodegen';
import {
  generateGraphPointSequenceDef,
  generateGraphPointSequencePlay,
} from './pointSequenceCodegen';
import { formatBlinkClipPlay } from './blinkCodegen';
import { formatTargetAnimationClipPlay } from './targetAnimationCodegen';
import { generateSceneStartStaticAdds } from './staticAddCodegen';
import { canBeSurroundTarget, effectiveStart, holdEnd } from '@/lib/time';

type PlaybackEvent =
  | { t: number; kind: 'audio'; track: AudioTrackItem }
  | { t: number; kind: 'leaf'; leaf: ExportLeaf }
  | {
      t: number;
      kind: 'visual_cluster';
      leaves: ExportLeaf[];
      surroundingRects: SurroundingRectItem[];
      exitClips: ExitAnimationItem[];
      blinkClips: BlinkAnimationItem[];
      targetAnimationClips: TargetAnimationItem[];
    }
  | { t: number; kind: 'surrounding_rect'; sr: SurroundingRectItem }
  | { t: number; kind: 'exit'; exit: ExitAnimationItem }
  | { t: number; kind: 'blink'; blink: BlinkAnimationItem }
  | { t: number; kind: 'target_animation'; ta: TargetAnimationItem };

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
    blinkClips: BlinkAnimationItem[];
    targetAnimationClips: TargetAnimationItem[];
  },
  itemsMap: Map<ItemId, SceneItem>,
): number {
  let m = -Infinity;
  for (const L of vc.leaves) {
    m = Math.max(m, holdEnd(L, itemsMap));
  }
  for (const sr of vc.surroundingRects) {
    m = Math.max(m, holdEnd(sr, itemsMap));
  }
  for (const ex of vc.exitClips) {
    m = Math.max(m, ex.startTime + ex.duration);
  }
  for (const bl of vc.blinkClips) {
    m = Math.max(m, bl.startTime + bl.duration);
  }
  for (const ta of vc.targetAnimationClips) {
    m = Math.max(m, ta.startTime + ta.duration);
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
    it.kind === 'graphCurve' ||
    it.kind === 'graphField' ||
    it.kind === 'graphFunctionSeries' ||
    it.kind === 'graphPointSequence' ||
    it.kind === 'graphArea'
  );
}

function validateOverlayAxes(
  item:
    | GraphPlotItem
    | GraphCurveItem
    | GraphDotItem
    | GraphFieldItem
    | GraphFunctionSeriesItem
    | GraphPointSequenceItem
    | GraphAreaItem,
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

function validateGraphCurveExport(
  item: GraphCurveItem,
  itemsMap: Map<ItemId, SceneItem>,
): string | null {
  const axErr = validateOverlayAxes(item, itemsMap);
  if (axErr) return axErr;
  const dom = item.tDomain;
  if (!Array.isArray(dom) || dom.length !== 2) {
    return `Graph curve "${item.label || item.id}": tDomain must be two numbers [t_min, t_max].`;
  }
  const lo = Math.min(dom[0]!, dom[1]!);
  const hi = Math.max(dom[0]!, dom[1]!);
  if (!(hi > lo)) {
    return `Graph curve "${item.label || item.id}": t domain must have min < max.`;
  }
  return null;
}

function validateGraphPlotExport(
  item: GraphPlotItem,
  itemsMap: Map<ItemId, SceneItem>,
): string | null {
  const axErr = validateOverlayAxes(item, itemsMap);
  if (axErr) return axErr;
  if (item.xDomain == null) return null;
  const ax = itemsMap.get(item.axesId)! as AxesItem;
  const xLo = ax.xRange[0];
  const xHi = ax.xRange[1];
  const lo = Math.min(item.xDomain[0], item.xDomain[1]);
  const hi = Math.max(item.xDomain[0], item.xDomain[1]);
  if (!(hi > lo)) {
    return `Graph plot "${item.label || item.id}": x domain must have min < max.`;
  }
  if (hi < xLo || lo > xHi) {
    return `Graph plot "${item.label || item.id}": x domain [${lo}, ${hi}] is outside axes domain [${xLo}, ${xHi}].`;
  }
  return null;
}

function validateGraphAreaExport(
  item: GraphAreaItem,
  itemsMap: Map<ItemId, SceneItem>,
): string | null {
  const axErr = validateOverlayAxes(item, itemsMap);
  if (axErr) return axErr;
  const ax = itemsMap.get(item.axesId)! as AxesItem;
  const xLo = ax.xRange[0];
  const xHi = ax.xRange[1];
  const checkX = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi < xLo || lo > xHi) {
      return `x range [${lo}, ${hi}] is outside axes domain [${xLo}, ${xHi}].`;
    }
    return null;
  };
  const checkPlot = (plotId: ItemId) => {
    const p = itemsMap.get(plotId);
    if (!p || p.kind !== 'graphPlot' || p.axesId !== item.axesId) {
      return `invalid plot reference "${plotId}".`;
    }
    return null;
  };
  const m = item.mode;
  if (m.areaKind === 'underCurve') {
    const xE = checkX(m.xMin, m.xMax);
    if (xE) return `Graph area "${item.label || item.id}": ${xE}`;
    if (m.curve.sourceKind === 'plot') {
      const pe = checkPlot(m.curve.plotId);
      if (pe) return `Graph area "${item.label || item.id}": ${pe}`;
    }
  } else if (m.areaKind === 'betweenCurves') {
    const xE = checkX(m.xMin, m.xMax);
    if (xE) return `Graph area "${item.label || item.id}": ${xE}`;
    if (m.lower.sourceKind === 'plot') {
      const pe = checkPlot(m.lower.plotId);
      if (pe) return `Graph area "${item.label || item.id}": ${pe}`;
    }
    if (m.upper.sourceKind === 'plot') {
      const pe = checkPlot(m.upper.plotId);
      if (pe) return `Graph area "${item.label || item.id}": ${pe}`;
    }
  }
  return null;
}

function validateNextToExportOrder(
  flat: ExportLeaf[],
  itemsMap: Map<ItemId, SceneItem>,
): void {
  const orderIndex = new Map<ItemId, number>();
  flat.forEach((leaf, i) => orderIndex.set(leaf.id, i));

  for (const it of flat) {
    if (it.kind !== 'textLine' && it.kind !== 'axes' && it.kind !== 'shape') {
      continue;
    }
    const ti = orderIndex.get(it.id);
    if (ti === undefined) continue;

    for (const step of it.posSteps) {
      if (step.kind !== 'next_to' || !step.refId) continue;
      const ri = orderIndex.get(step.refId);
      if (ri === undefined) {
        throw new Error(
          `Positioning: "${it.label || it.id}" next_to references "${step.refId}", which is not exported as a top-level line/axes/shape.`,
        );
      }
      if (ri >= ti) {
        throw new Error(
          `Positioning: "${it.label || it.id}" uses next_to toward "${step.refId}", but that object must be defined earlier in export order (place it before this clip on the timeline or reorder).`,
        );
      }
      const refItem = itemsMap.get(step.refId);
      if (!refItem) continue;
      if (
        step.refSegmentIndex != null &&
        refItem.kind === 'textLine'
      ) {
        const n = refItem.segments.length;
        if (n === 0 || step.refSegmentIndex < 0 || step.refSegmentIndex >= n) {
          throw new Error(
            `Positioning: "${it.label || it.id}" next_to ref segment index ${step.refSegmentIndex} is out of range for line "${refItem.label || refItem.id}" (${n} segments).`,
          );
        }
      }
      if (
        step.selfSegmentIndex != null &&
        it.kind === 'textLine'
      ) {
        const n = it.segments.length;
        if (n === 0 || step.selfSegmentIndex < 0 || step.selfSegmentIndex >= n) {
          throw new Error(
            `Positioning: "${it.label || it.id}" next_to self segment index ${step.selfSegmentIndex} is out of range (${n} segments).`,
          );
        }
      }
    }
  }
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
    if (it.kind === 'graphPlot') {
      const err = validateGraphPlotExport(it, itemsMap);
      if (err) throw new Error(err);
    }
    if (it.kind === 'graphCurve') {
      const err = validateGraphCurveExport(it, itemsMap);
      if (err) throw new Error(err);
    }
    if (
      it.kind === 'graphDot' ||
      it.kind === 'graphField'
    ) {
      const err = validateOverlayAxes(it, itemsMap);
      if (err) throw new Error(err);
    }
    if (it.kind === 'graphFunctionSeries') {
      const err = validateOverlayAxes(it, itemsMap);
      if (err) throw new Error(err);
      if (functionSeriesHasErrors(it)) {
        throw new Error(
          `Function series "${it.label || it.id}" has validation errors — fix the formula / n range before exporting.`,
        );
      }
    }
    if (it.kind === 'graphPointSequence') {
      const err = validateOverlayAxes(it, itemsMap);
      if (err) throw new Error(err);
      if (pointSequenceHasErrors(it)) {
        throw new Error(
          `Point sequence "${it.label || it.id}" has validation errors — fix expressions / n range before exporting.`,
        );
      }
    }
    if (it.kind === 'graphArea') {
      const err = validateGraphAreaExport(it, itemsMap);
      if (err) throw new Error(err);
    }
  }

  validateNextToExportOrder(flat, itemsMap);

  const needsNumpy = flat.some(leafNeedsNumpy);

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
    const placementId = surroundPlacementLeafId(raw, flat, itemsMap);
    if (!placementId) continue;
    const list = surroundByAnchor.get(placementId) ?? [];
    list.push(raw);
    surroundByAnchor.set(placementId, list);
  }
  for (const list of surroundByAnchor.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }

  for (const it of items) {
    if (it.kind !== 'surroundingRect') continue;
    const ids = it.targetIds?.filter(Boolean) ?? [];
    if (ids.length === 0) {
      throw new Error(
        `Surrounding rectangle "${it.label || it.id}" has no targets.`,
      );
    }
    for (const tid of ids) {
      const tgt = itemsMap.get(tid);
      if (!tgt || !canBeSurroundTarget(tgt)) {
        throw new Error(
          `Surrounding rectangle "${it.label || it.id}" has a missing or invalid target.`,
        );
      }
    }
    if (!resolveSurroundRectTargetExpr(it, idToVarName, itemsMap)) {
      throw new Error(
        `Surrounding rectangle "${it.label || it.id}" could not resolve a Manim target for export.`,
      );
    }
  }

  let defStr = '';
  let posStr = '';
  let playStr = '';
  /** Monotonic z_index for graph overlays so curves/dots stack predictably in Manim. */
  let nextGraphOverlayZ = 10;

  const axesLeaves = flat.filter((it): it is AxesItem => it.kind === 'axes');
  for (const it of axesLeaves) {
    const axVar = idToVarName.get(it.id)!;
    defStr += generateAxesDef(it, axVar, base);
  }

  const overlays = flat.filter(
    (
      it,
    ): it is
      | GraphPlotItem
      | GraphCurveItem
      | GraphDotItem
      | GraphFieldItem
      | GraphFunctionSeriesItem
      | GraphPointSequenceItem
      | GraphAreaItem =>
      it.kind === 'graphPlot' ||
      it.kind === 'graphCurve' ||
      it.kind === 'graphDot' ||
      it.kind === 'graphField' ||
      it.kind === 'graphFunctionSeries' ||
      it.kind === 'graphPointSequence' ||
      it.kind === 'graphArea',
  );
  overlays.sort((a, b) => a.id.localeCompare(b.id));

  for (const ov of overlays) {
    const axVar = idToVarName.get(ov.axesId);
    if (!axVar) continue;
    if (itemsMap.get(ov.axesId)?.kind !== 'axes') continue;

    if (ov.kind === 'graphDot') {
      defStr += generateGraphDotDef(ov, axVar, base);
    }
    // graphPlot / graphField / graphFunctionSeries / graphPointSequence: emitted after generateAxesPos — they sample
    // coords_to_point or fit_to the axes while the axes may still be at the default pose.
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
      posStr += generateAxesPos(it, axVar, base, idToVarName, itemsMap);
      for (const ov of overlays) {
        if (ov.kind === 'graphDot' && ov.axesId === it.id) {
          posStr += generateGraphDotSnapToAxes(ov, axVar, base);
        } else if (ov.kind === 'graphPlot' && ov.axesId === it.id) {
          posStr += generateGraphPlotDef(ov, axVar, base);
        } else if (ov.kind === 'graphCurve' && ov.axesId === it.id) {
          posStr += generateGraphCurveDef(ov, axVar, base);
        } else if (ov.kind === 'graphField' && ov.axesId === it.id) {
          posStr += generateGraphFieldDef(ov, axVar, it, base);
        } else if (ov.kind === 'graphFunctionSeries' && ov.axesId === it.id) {
          posStr += generateGraphFunctionSeriesDef(ov, axVar, base);
        } else if (ov.kind === 'graphPointSequence' && ov.axesId === it.id) {
          posStr += generateGraphPointSequenceDef(ov, axVar, base);
        }
      }
      for (const ov of overlays) {
        if (ov.kind === 'graphArea' && ov.axesId === it.id) {
          posStr += generateGraphAreaDef(ov, axVar, base, itemsMap);
        }
      }
      const stack = overlays.filter(
        (o) =>
          o.axesId === it.id &&
          (o.kind === 'graphPlot' ||
            o.kind === 'graphCurve' ||
            o.kind === 'graphDot' ||
            o.kind === 'graphFunctionSeries' ||
            o.kind === 'graphPointSequence' ||
            o.kind === 'graphArea' ||
            (o.kind === 'graphField' && o.fieldMode !== 'none')),
      );
      stack.sort(compareGraphStackOverlays);
      for (const ov of stack) {
        posStr += generateGraphOverlayZIndexLines(
          ov,
          axVar,
          nextGraphOverlayZ++,
          base,
        );
      }
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
      posStr += generateShapePos(it, varName, base, idToVarName, itemsMap);
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

  const flatPlayback = flat.filter((l) => !isVisibleAtSceneStartItem(l));

  const audioList = options.audioItems ?? [];
  const unboundAudio = listUnboundAudioTracksForExport(audioList, flat, itemsMap);

  const visualClusters = clusterConcurrentVisualPlayback(
    flatPlayback,
    items,
    itemsMap,
    options.audioItems,
  );
  const inVisualCluster = new Set<ItemId>();
  for (const c of visualClusters) {
    const n =
      c.leaves.length +
      c.surroundingRects.length +
      c.exitClips.length +
      c.blinkClips.length +
      c.targetAnimationClips.length;
    if (n >= 2) {
      for (const L of c.leaves) inVisualCluster.add(L.id);
      for (const sr of c.surroundingRects) inVisualCluster.add(sr.id);
      for (const ex of c.exitClips) inVisualCluster.add(ex.id);
      for (const bl of c.blinkClips) inVisualCluster.add(bl.id);
      for (const ta of c.targetAnimationClips) inVisualCluster.add(ta.id);
    }
  }

  const playEvents: PlaybackEvent[] = [];
  for (const it of flatPlayback) {
    if (inVisualCluster.has(it.id)) continue;
    playEvents.push({ t: effectiveStart(it, itemsMap), kind: 'leaf', leaf: it });
  }
  for (const c of visualClusters) {
    if (
      c.leaves.length +
        c.surroundingRects.length +
        c.exitClips.length +
        c.blinkClips.length +
        c.targetAnimationClips.length <
      2
    ) {
      continue;
    }
    const clusterTimes = [
      ...c.leaves.map((L) => effectiveStart(L, itemsMap)),
      ...c.surroundingRects.map((sr) => effectiveStart(sr, itemsMap)),
      ...c.exitClips.map((ex) => ex.startTime),
      ...c.blinkClips.map((bl) => bl.startTime),
      ...c.targetAnimationClips.map((ta) => ta.startTime),
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
    const sortedBlinks = [...c.blinkClips].sort(
      (a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id),
    );
    const sortedTas = [...c.targetAnimationClips].sort(
      (a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id),
    );
    playEvents.push({
      t,
      kind: 'visual_cluster',
      leaves: sortedLeaves,
      surroundingRects: sortedSrs,
      exitClips: sortedExits,
      blinkClips: sortedBlinks,
      targetAnimationClips: sortedTas,
    });
  }
  for (const tr of unboundAudio) {
    playEvents.push({ t: tr.startTime, kind: 'audio', track: tr });
  }
  for (const it of items) {
    if (it.kind === 'surroundingRect' && !inVisualCluster.has(it.id)) {
      if (isVisibleAtSceneStartItem(it)) continue;
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
  for (const it of items) {
    if (
      it.kind === 'blink_animation' &&
      it.targets.length > 0 &&
      !inVisualCluster.has(it.id)
    ) {
      playEvents.push({ t: it.startTime, kind: 'blink', blink: it });
    }
  }
  for (const it of items) {
    if (
      it.kind === 'target_animation' &&
      it.targets.length > 0 &&
      !inVisualCluster.has(it.id)
    ) {
      playEvents.push({ t: it.startTime, kind: 'target_animation', ta: it });
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
        ...e.blinkClips.map((x) => x.id),
        ...e.targetAnimationClips.map((x) => x.id),
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
    if (a.kind === 'blink' && b.kind === 'blink') {
      return a.blink.id.localeCompare(b.blink.id);
    }
    if (a.kind === 'target_animation' && b.kind === 'target_animation') {
      return a.ta.id.localeCompare(b.ta.id);
    }
    return 0;
  });

  playStr += generateSceneStartStaticAdds(flat, items, idToVarName, base);

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
    if (it.kind === 'graphCurve') {
      const axVar = idToVarName.get(it.axesId);
      if (!axVar) return '';
      return generateGraphCurvePlay(
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
    if (it.kind === 'graphFunctionSeries') {
      const axVar = idToVarName.get(it.axesId);
      if (!axVar) return '';
      return generateGraphFunctionSeriesPlay(
        it,
        axVar,
        base,
        itemsMap,
        options.audioItems,
        tailOpts,
      );
    }
    if (it.kind === 'graphPointSequence') {
      const axVar = idToVarName.get(it.axesId);
      if (!axVar) return '';
      return generateGraphPointSequencePlay(
        it,
        axVar,
        base,
        itemsMap,
        options.audioItems,
        tailOpts,
      );
    }
    if (it.kind === 'graphArea') {
      const axVar = idToVarName.get(it.axesId);
      if (!axVar) return '';
      return generateGraphAreaPlay(
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
    const blinks = group.filter((e): e is Extract<PlaybackEvent, { kind: 'blink' }> => e.kind === 'blink');
    const targetAnims = group.filter(
      (e): e is Extract<PlaybackEvent, { kind: 'target_animation' }> =>
        e.kind === 'target_animation',
    );

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
        vc.blinkClips,
        vc.targetAnimationClips,
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
        const targetsStr = resolveExitTargetsForExport(tgt, idToVarName, 'exit');
        if (!targetsStr) continue;
        parts.push({ targetsStr, animStyle: spec.animStyle });
      }
      playStr += formatExitGroupPlayLine(parts, ex.exit.duration, playPad);
    }
    for (const bl of blinks) {
      playStr += formatBlinkClipPlay(bl.blink, playPad, idToVarName, itemsMap);
    }
    for (const tac of targetAnims) {
      playStr += formatTargetAnimationClipPlay(
        tac.ta,
        playPad,
        idToVarName,
        itemsMap,
      );
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
      for (const bl of vc.blinkClips) {
        groupEnd = Math.max(groupEnd, bl.startTime + bl.duration);
      }
      for (const ta of vc.targetAnimationClips) {
        groupEnd = Math.max(groupEnd, ta.startTime + ta.duration);
      }
    }
    for (const e of leaves) {
      groupEnd = Math.max(groupEnd, holdEnd(e.leaf, itemsMap));
    }
    for (const su of surrounds) {
      groupEnd = Math.max(groupEnd, holdEnd(su.sr, itemsMap));
    }
    for (const ex of exits) {
      groupEnd = Math.max(groupEnd, ex.exit.startTime + ex.exit.duration);
    }
    for (const bl of blinks) {
      groupEnd = Math.max(groupEnd, bl.blink.startTime + bl.blink.duration);
    }
    for (const tac of targetAnims) {
      groupEnd = Math.max(groupEnd, tac.ta.startTime + tac.ta.duration);
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
        vc.blinkClips,
        vc.targetAnimationClips,
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
    for (const bl of blinks) {
      animSec += sequentialAnimSecondsForBlink(bl.blink);
    }
    for (const tac of targetAnims) {
      animSec += sequentialAnimSecondsForTargetAnimation(tac.ta);
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
    if (it.kind === 'blink_animation' && it.targets.length > 0) {
      fullSceneEnd = Math.max(fullSceneEnd, it.startTime + it.duration);
    }
    if (it.kind === 'target_animation' && it.targets.length > 0) {
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
  header +=
    'try:\n' +
    '    from manim.utils.color import ManimColor\n' +
    'except ImportError:\n' +
    '    def ManimColor(c):\n' +
    '        return c\n';
  if (needsNumpy) {
    header += 'import numpy as np\n';
  }
  header += 'from hebrew_math_line import HebrewMathLine\n';

  // Emit the `_FSRevealTransform` helper (used only by replacement-mode
  // graphFunctionSeries) at module scope so both concurrent-cluster
  // Successions and standalone `self.play(...)` calls can reference it.
  if (anyReplacementFunctionSeries(items)) {
    header += '\n\n' + functionSeriesRevealTransformSource(0);
  }

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
