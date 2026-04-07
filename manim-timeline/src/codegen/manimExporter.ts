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
} from '@/types/scene';
import { safeSceneClassName } from '@/lib/pythonIdent';
import {
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
  formatExitPlayLine,
  resolveExitTargetsForExport,
} from './graphCodegen';
import { generateVoiceoverImports, generateSpeechServiceSetup } from './voiceoverCodegen';
import { flattenExportLeaves, type ExportLeaf } from './flattenExport';

type PlaybackEvent =
  | { t: number; kind: 'audio'; track: AudioTrackItem }
  | { t: number; kind: 'leaf'; leaf: ExportLeaf }
  | { t: number; kind: 'exit'; exit: ExitAnimationItem };

import { effectiveStart, holdEnd } from '@/lib/time';

const TIMELINE_GAP_EPS = 0.001;

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

  const usesRecorder = flat.some((it) => it.voice.voiceKind === 'recorder');
  const usesTts = flat.some(
    (it) => it.voice.animMode === 'voiceover' && it.voice.voiceKind === 'tts',
  );
  const usesVoiceover = usesRecorder || usesTts;
  const needsNumpy = flat.some(leafNeedsNumpy);
  const needsRateFuncs = flat.some(leafNeedsRateFuncs);

  const base = options.fullFile ? 8 : 4;
  const prefix = options.defaults.exportNamePrefix;
  const pf = (name: string) => (prefix ? `${prefix}${name}` : name);

  const idToVarName = new Map<ItemId, string>();
  let lineNum = 0;
  let axesNum = 0;
  for (const it of flat) {
    if (it.kind === 'textLine') {
      lineNum += 1;
      idToVarName.set(it.id, pf(`line_${lineNum}`));
    } else if (it.kind === 'axes') {
      axesNum += 1;
      idToVarName.set(it.id, pf(`axes_${axesNum}`));
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
    }
  }

  for (const it of flat) {
    if (it.kind === 'axes') {
      const axVar = idToVarName.get(it.id)!;
      posStr += generateAxesPos(it, axVar, base, idToVarName);
    } else if (it.kind === 'textLine') {
      const varName = idToVarName.get(it.id)!;
      posStr += generateLinePos(it, varName, base, idToVarName, itemsMap);
    }
  }

  const playPad = ' '.repeat(base);
  let timelineCursor = 0;

  const audioList = options.audioItems ?? [];
  const unboundAudio = listUnboundAudioTracksForExport(audioList, flat, itemsMap);

  const playEvents: PlaybackEvent[] = [];
  for (const it of flat) {
    playEvents.push({ t: effectiveStart(it, itemsMap), kind: 'leaf', leaf: it });
  }
  for (const tr of unboundAudio) {
    playEvents.push({ t: tr.startTime, kind: 'audio', track: tr });
  }
  for (const it of items) {
    if (it.kind === 'exit_animation' && it.animStyle !== 'none') {
      playEvents.push({ t: it.startTime, kind: 'exit', exit: it });
    }
  }
  const eventKindOrder = (k: PlaybackEvent['kind']) =>
    k === 'audio' ? 0 : k === 'leaf' ? 1 : 2;
  playEvents.sort((a, b) => {
    const d = a.t - b.t;
    if (Math.abs(d) > TIMELINE_GAP_EPS) return d;
    const ko = eventKindOrder(a.kind) - eventKindOrder(b.kind);
    if (ko !== 0) return ko;
    if (a.kind === 'audio' && b.kind === 'audio') {
      return a.track.id.localeCompare(b.track.id);
    }
    if (a.kind === 'leaf' && b.kind === 'leaf') {
      return a.leaf.id.localeCompare(b.leaf.id);
    }
    if (a.kind === 'exit' && b.kind === 'exit') {
      return a.exit.id.localeCompare(b.exit.id);
    }
    return 0;
  });

  const emitLeafPlay = (it: ExportLeaf): string => {
    if (it.kind === 'textLine') {
      const varName = idToVarName.get(it.id)!;
      return generateLinePlay(
        it,
        varName,
        base,
        idToVarName,
        itemsMap,
        options.audioItems,
      );
    }
    if (it.kind === 'axes') {
      const axVar = idToVarName.get(it.id)!;
      return generateAxesPlay(it, axVar, base, itemsMap, options.audioItems);
    }
    if (it.kind === 'graphPlot') {
      const axVar = idToVarName.get(it.axesId);
      if (!axVar) return '';
      return generateGraphPlotPlay(it, axVar, base, itemsMap, options.audioItems);
    }
    if (it.kind === 'graphDot') {
      const axVar = idToVarName.get(it.axesId);
      if (!axVar) return '';
      return generateGraphDotPlay(it, axVar, base, itemsMap, options.audioItems);
    }
    if (it.kind === 'graphField') {
      const axVar = idToVarName.get(it.axesId);
      if (!axVar) return '';
      return generateGraphFieldPlay(it, axVar, base, itemsMap, options.audioItems);
    }
    const axVar = idToVarName.get(it.axesId);
    if (!axVar) return '';
    return generateGraphSeriesVizPlay(it, axVar, base, itemsMap, options.audioItems);
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
    }

    const audios = group.filter((e): e is Extract<PlaybackEvent, { kind: 'audio' }> => e.kind === 'audio');
    const leaves = group.filter((e): e is Extract<PlaybackEvent, { kind: 'leaf' }> => e.kind === 'leaf');
    const exits = group.filter((e): e is Extract<PlaybackEvent, { kind: 'exit' }> => e.kind === 'exit');

    if (audios.length && t0 + TIMELINE_GAP_EPS < timelineCursor) {
      playStr += `${playPad}# Note: audio below overlaps earlier playback in export order (Manim runs sequentially).\n`;
    }

    for (const a of audios) {
      playStr += generateUnboundAudioAddSoundLine(a.track, base);
    }
    for (const e of leaves) {
      playStr += emitLeafPlay(e.leaf);
    }
    for (const ex of exits) {
      const tgt = itemsMap.get(ex.exit.targetId);
      if (!tgt) continue;
      const targetsStr = resolveExitTargetsForExport(tgt, idToVarName);
      if (!targetsStr) continue;
      playStr += formatExitPlayLine(
        targetsStr,
        ex.exit.animStyle,
        ex.exit.duration,
        playPad,
      );
    }

    let groupEnd = timelineCursor;
    for (const a of audios) {
      groupEnd = Math.max(groupEnd, t0 + a.track.duration);
    }
    for (const e of leaves) {
      groupEnd = Math.max(groupEnd, holdEnd(e.leaf, itemsMap));
    }
    for (const ex of exits) {
      groupEnd = Math.max(groupEnd, ex.exit.startTime + ex.exit.duration);
    }
    timelineCursor = Math.max(timelineCursor, groupEnd);
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

  if (usesVoiceover) {
    header += generateVoiceoverImports(usesRecorder, usesTts);
  }

  const sceneBase = usesVoiceover ? 'VoiceoverScene' : 'Scene';
  const className = safeSceneClassName(options.defaults.sceneName ?? '');
  let body = `\nclass ${className}(${sceneBase}):\n`;
  body += '    def construct(self):\n';

  if (usesVoiceover) {
    const voices = flat.map((x) => x.voice);
    body += generateSpeechServiceSetup(voices);
  }

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
