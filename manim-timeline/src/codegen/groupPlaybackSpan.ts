import type {
  AudioTrackItem,
  ExitAnimationItem,
  ItemId,
  SceneItem,
} from '@/types/scene';
import type { ExportLeaf } from './flattenExport';
import { resolveRecordedPlayback } from './lineCodegen';
import { runDuration } from '@/lib/time';

/** Manim default `run_time` when omitted on `Animation` / `self.play`. */
const MANIM_DEFAULT_PLAY_SEC = 1;

function textLinePlaySeconds(
  item: Extract<ExportLeaf, { kind: 'textLine' }>,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[] | undefined,
): number {
  const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
  if (recorded) return recorded.runTime;
  if (item.voice.animMode === 'voiceover' && item.voice.script) {
    return runDuration(item, itemsMap);
  }
  return item.parentId ? (item.localDuration ?? item.duration) : item.duration;
}

/**
 * Seconds of scene time consumed by the `self.play` calls emitted for one export leaf
 * (not counting `add_sound`, which does not advance Manim's clock).
 */
export function sequentialAnimSecondsForLeaf(
  leaf: ExportLeaf,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[] | undefined,
): number {
  switch (leaf.kind) {
    case 'textLine':
      return textLinePlaySeconds(leaf, itemsMap, audioItems);
    case 'axes': {
      const recorded = resolveRecordedPlayback(leaf, itemsMap, audioItems);
      return recorded ? recorded.runTime : leaf.duration;
    }
    case 'graphPlot': {
      const recorded = resolveRecordedPlayback(leaf, itemsMap, audioItems);
      return recorded ? recorded.runTime : leaf.duration;
    }
    case 'graphDot': {
      const recorded = resolveRecordedPlayback(leaf, itemsMap, audioItems);
      const label = leaf.dot.label.trim();
      if (recorded) {
        return recorded.runTime + (label ? MANIM_DEFAULT_PLAY_SEC : 0);
      }
      return MANIM_DEFAULT_PLAY_SEC + (label ? MANIM_DEFAULT_PLAY_SEC : 0);
    }
    case 'graphField': {
      const recorded = resolveRecordedPlayback(leaf, itemsMap, audioItems);
      const seeds = leaf.streamPoints ?? [];
      const extra = seeds.length > 0 ? MANIM_DEFAULT_PLAY_SEC : 0;
      return (recorded ? recorded.runTime : leaf.duration) + extra;
    }
    case 'graphSeriesViz': {
      const recorded = resolveRecordedPlayback(leaf, itemsMap, audioItems);
      return recorded ? recorded.runTime : leaf.duration;
    }
    default:
      return 0;
  }
}

export function sequentialAnimSecondsForExit(ex: ExitAnimationItem): number {
  return Math.max(0.01, ex.duration);
}
