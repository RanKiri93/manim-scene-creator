import type {
  SceneItem,
  SceneDefaults,
  ItemId,
  AudioTrackItem,
} from '@/types/scene';
import { safeSceneClassName } from '@/lib/pythonIdent';
import { generateLineDef, generateLinePos, generateLinePlay } from './lineCodegen';
import { generateGraphDef, generateGraphPlay, generateGraphPos } from './graphCodegen';
import { generateVoiceoverImports, generateSpeechServiceSetup } from './voiceoverCodegen';
import { flattenExportLeaves } from './flattenExport';

function itemsToMap(items: SceneItem[]): Map<ItemId, SceneItem> {
  return new Map(items.map((it) => [it.id, it]));
}

interface ExportOptions {
  fullFile: boolean;
  defaults: SceneDefaults;
  audioItems?: AudioTrackItem[];
}

/**
 * Generate the complete Manim Python source from a list of SceneItems.
 * Compound clips are flattened to their child text lines in timeline order.
 */
export function exportManimCode(
  items: SceneItem[],
  options: ExportOptions,
): string {
  const flat = flattenExportLeaves(items);
  const itemsMap = itemsToMap(items);

  const usesRecorder = flat.some((it) => it.voice.voiceKind === 'recorder');
  const usesTts = flat.some(
    (it) => it.voice.animMode === 'voiceover' && it.voice.voiceKind === 'tts',
  );
  const usesVoiceover = usesRecorder || usesTts;

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
    } else if (it.kind === 'graph') {
      axesNum += 1;
      idToVarName.set(it.id, pf(`axes_${axesNum}`));
    }
  }

  let defStr = '';
  let posStr = '';
  let playStr = '';

  for (const it of flat) {
    if (it.kind === 'textLine') {
      const varName = idToVarName.get(it.id)!;
      defStr += generateLineDef(it, varName, base);
      posStr += generateLinePos(it, varName, base, idToVarName, itemsMap);
      playStr += generateLinePlay(
        it,
        varName,
        base,
        idToVarName,
        itemsMap,
        options.audioItems,
      );
    } else if (it.kind === 'graph') {
      const axVar = idToVarName.get(it.id)!;
      defStr += generateGraphDef(it, axVar, base);
      posStr += generateGraphPos(it, axVar, base, idToVarName);
      playStr += generateGraphPlay(
        it,
        axVar,
        base,
        itemsMap,
        options.audioItems,
      );
    }
  }

  if (!options.fullFile) {
    return `${defStr}\n${posStr}\n${playStr}`;
  }

  let header = 'from manim import *\n';
  header += 'from manim.utils.color import ManimColor\n';
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
