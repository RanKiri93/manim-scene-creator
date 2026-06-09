import { exportManimCode } from '@/codegen/manimExporter';
import type { SceneDefaults, SceneItem, AudioTrackItem, FrameDef, ItemId } from '@/types/scene';

export interface SceneExportInput {
  items: SceneItem[];
  defaults: SceneDefaults;
  frames?: FrameDef[];
  startFrameId?: ItemId;
  audioItems?: AudioTrackItem[];
}

/**
 * Concatenate multiple full-file `exportManimCode` snippets into one module:
 * merges import-style headers incrementally then appends each `class …(Scene):` body.
 */
export function combineMultiScenePythonExports(snips: string[]): string {
  if (snips.length === 0) {
    return 'from manim import *\n\nclass EmptyProject(Scene):\n    def construct(self):\n        pass\n';
  }
  const splits = snips.map((code) => {
    const idx = code.search(/\nclass\s+\w+/);
    if (idx <= 0) {
      return { head: code.trimEnd(), body: '' };
    }
    return {
      head: code.slice(0, idx).trimEnd(),
      body: code.slice(idx).trim(),
    };
  });

  let mergedHead = splits[0]!.head;
  for (let i = 1; i < splits.length; i++) {
    const add = splits[i]!.head;
    for (const line of add.split('\n')) {
      const t = line.trim();
      if (t === '') continue;
      const baseLines = mergedHead.split('\n');
      const exists = baseLines.some((L) => L === line || L.trim() === t);
      if (!exists) {
        mergedHead += `\n${line}`;
      }
    }
  }

  const bodies = splits.map((s) => s.body).filter(Boolean).join('\n\n');
  return `${mergedHead}\n\n${bodies}\n`;
}

export function exportMultiSceneCombinedPython(scenes: SceneExportInput[]): string {
  const parts = scenes.map((sc) =>
    exportManimCode(sc.items, {
      fullFile: true,
      defaults: sc.defaults,
      frames: sc.frames,
      startFrameId: sc.startFrameId,
      audioItems: sc.audioItems,
    }));
  return combineMultiScenePythonExports(parts);
}
