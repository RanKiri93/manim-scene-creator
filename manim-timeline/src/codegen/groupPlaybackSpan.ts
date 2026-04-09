import type {
  AudioTrackItem,
  ExitAnimationItem,
  ItemId,
  SceneItem,
  SurroundingRectItem,
} from '@/types/scene';
import type { ExportLeaf } from './flattenExport';
import { effectiveDuration } from '@/lib/time';
import {
  type BoundAudioTailOpts,
  sceneClockSecForLeafBoundPlayback,
} from './lineCodegen';

/** Manim default `run_time` when omitted on `Animation` / `self.play`. */
const MANIM_DEFAULT_PLAY_SEC = 1;

function textLinePlaySeconds(
  item: Extract<ExportLeaf, { kind: 'textLine' }>,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[] | undefined,
  tailOpts?: BoundAudioTailOpts,
): number {
  const clock = sceneClockSecForLeafBoundPlayback(
    item,
    itemsMap,
    audioItems,
    tailOpts,
  );
  if (clock != null) return clock;
  return effectiveDuration(item, itemsMap);
}

/**
 * Seconds of scene time consumed for one export leaf (`self.play` / `Succession`, plus
 * trailing `self.wait` when bound audio is longer than the boundary-derived `run_time`).
 */
export function sequentialAnimSecondsForLeaf(
  leaf: ExportLeaf,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[] | undefined,
  tailOpts?: BoundAudioTailOpts,
): number {
  switch (leaf.kind) {
    case 'textLine':
      return textLinePlaySeconds(leaf, itemsMap, audioItems, tailOpts);
    case 'axes': {
      const clock = sceneClockSecForLeafBoundPlayback(
        leaf,
        itemsMap,
        audioItems,
        tailOpts,
      );
      return clock ?? leaf.duration;
    }
    case 'graphPlot': {
      const clock = sceneClockSecForLeafBoundPlayback(
        leaf,
        itemsMap,
        audioItems,
        tailOpts,
      );
      return clock ?? leaf.duration;
    }
    case 'graphDot': {
      const label = leaf.dot.label.trim();
      const clock = sceneClockSecForLeafBoundPlayback(
        leaf,
        itemsMap,
        audioItems,
        tailOpts,
      );
      // When audio is bound, sceneClockSecForLeafBoundPlayback already accounts for the
      // label Write() extra second via sceneAnimEndForBoundAudioTail — do not add it again.
      if (clock != null) return clock;
      return leaf.duration + (label ? MANIM_DEFAULT_PLAY_SEC : 0);
    }
    case 'graphField': {
      const seeds = leaf.streamPoints ?? [];
      const extra = seeds.length > 0 ? MANIM_DEFAULT_PLAY_SEC : 0;
      const clock = sceneClockSecForLeafBoundPlayback(
        leaf,
        itemsMap,
        audioItems,
        tailOpts,
      );
      // When audio is bound, sceneClockSecForLeafBoundPlayback already accounts for the
      // streams Create() extra second via sceneAnimEndForBoundAudioTail — do not add it again.
      if (clock != null) return clock;
      return leaf.duration + extra;
    }
    case 'graphSeriesViz': {
      const clock = sceneClockSecForLeafBoundPlayback(
        leaf,
        itemsMap,
        audioItems,
        tailOpts,
      );
      return clock ?? leaf.duration;
    }
    case 'shape': {
      const clock = sceneClockSecForLeafBoundPlayback(
        leaf,
        itemsMap,
        audioItems,
        tailOpts,
      );
      return clock ?? Math.max(0.05, leaf.duration);
    }
    default:
      return 0;
  }
}

export function sequentialAnimSecondsForExit(ex: ExitAnimationItem): number {
  return Math.max(0.01, ex.duration);
}

export function sequentialAnimSecondsForSurroundingRect(
  sr: SurroundingRectItem,
): number {
  return Math.max(0.05, sr.introRunTime);
}
