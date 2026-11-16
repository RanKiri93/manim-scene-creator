import type {
  AudioTrackItem,
  BlinkAnimationItem,
  CameraMoveItem,
  TargetAnimationItem,
  ExitAnimationItem,
  ItemId,
  SceneItem,
  SurroundingRectItem,
} from '@/types/scene';
import type { ExportLeaf } from './flattenExport';
import { effectiveDuration } from '@/lib/time';
import { isVisibleAtSceneStartItem } from '@/types/scene';
import { MIN_CAMERA_DURATION } from '@/lib/camera';
import {
  type BoundAudioTailOpts,
  sceneClockSecForLeafBoundPlayback,
} from './lineCodegen';

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
  if (isVisibleAtSceneStartItem(leaf)) return 0;
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
    case 'graphCurve': {
      const clock = sceneClockSecForLeafBoundPlayback(
        leaf,
        itemsMap,
        audioItems,
        tailOpts,
      );
      return clock ?? leaf.duration;
    }
    case 'graphDot': {
      // The label is written inside the intro group, so a dot takes exactly its clip run time.
      const clock = sceneClockSecForLeafBoundPlayback(
        leaf,
        itemsMap,
        audioItems,
        tailOpts,
      );
      return clock ?? leaf.duration;
    }
    case 'graphField': {
      // Stream lines are created together with the field, inside the clip run time.
      const clock = sceneClockSecForLeafBoundPlayback(
        leaf,
        itemsMap,
        audioItems,
        tailOpts,
      );
      return clock ?? leaf.duration;
    }
    case 'graphFunctionSeries': {
      const clock = sceneClockSecForLeafBoundPlayback(
        leaf,
        itemsMap,
        audioItems,
        tailOpts,
      );
      return clock ?? leaf.duration;
    }
    case 'graphPointSequence': {
      const clock = sceneClockSecForLeafBoundPlayback(
        leaf,
        itemsMap,
        audioItems,
        tailOpts,
      );
      return clock ?? leaf.duration;
    }
    case 'graphArea': {
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
    case 'image':
    case 'matrix': {
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

export function sequentialAnimSecondsForBlink(bl: BlinkAnimationItem): number {
  return Math.max(0.01, bl.duration);
}

export function sequentialAnimSecondsForTargetAnimation(
  ta: TargetAnimationItem,
): number {
  return Math.max(0.01, ta.duration);
}

export function sequentialAnimSecondsForCameraMove(cam: CameraMoveItem): number {
  return Math.max(MIN_CAMERA_DURATION, cam.duration);
}

export function sequentialAnimSecondsForSurroundingRect(
  sr: SurroundingRectItem,
): number {
  if (sr.visibleAtSceneStart) return 0;
  return Math.max(0.05, sr.runTime);
}
