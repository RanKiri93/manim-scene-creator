import type { AudioTrackItem, ItemId, SceneItem } from '@/types/scene';
import {
  functionSeriesTotalDuration,
  isVisibleAtSceneStartItem,
  pointSequenceTotalDuration,
} from '@/types/scene';
import { effectiveStart, segmentWaitTotal, textLineAnimOnlyDuration } from '@/lib/time';
import { resolveRecordedPlayback } from '@/codegen/lineCodegen';

/** Scene-clock seconds during which a clip's own animation runs. */
export interface ClipWindow {
  start: number;
  end: number;
}

/**
 * When a clip's own animation runs, as the exported scene plays it: the shared timing contract
 * between Manim export and the canvas preview.
 *
 * - Intro leaves run for their bound-narration run time (Whisper word boundaries) when one
 *   resolves, otherwise their clip duration; text adds its segment pauses.
 * - Function series and point sequences run their per-n schedule (`item.duration` is synced to it).
 * - Surrounding rects use `runTime`; exit, blink, target and camera clips use `duration`.
 * - Narration tails (waiting for the audio file to end) are not animation and are excluded.
 *
 * Returns `null` for items with no animation of their own (scene-start items, audio, frames).
 * `scripts/timing-sweep` checks a real Manim run against this function.
 */
export function clipAnimationWindow(
  item: SceneItem,
  items: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
): ClipWindow | null {
  if (isVisibleAtSceneStartItem(item)) return null;
  const start = effectiveStart(item, items);
  const span = (sec: number): ClipWindow => ({ start, end: start + sec });
  switch (item.kind) {
    case 'textLine': {
      const recorded = resolveRecordedPlayback(item, items, audioItems);
      const anim = recorded?.runTime ?? textLineAnimOnlyDuration(item, items);
      return span(anim + segmentWaitTotal(item.segments));
    }
    case 'graphFunctionSeries':
      return span(functionSeriesTotalDuration(item));
    case 'graphPointSequence':
      return span(pointSequenceTotalDuration(item));
    case 'axes':
    case 'graphPlot':
    case 'graphCurve':
    case 'graphDot':
    case 'graphField':
    case 'graphArea':
      return span(resolveRecordedPlayback(item, items, audioItems)?.runTime ?? item.duration);
    case 'shape':
    case 'image':
      return span(resolveRecordedPlayback(item, items, audioItems)?.runTime ?? Math.max(0.05, item.duration));
    case 'surroundingRect':
      return span(Math.max(0.05, item.runTime));
    case 'exit_animation':
    case 'blink_animation':
    case 'target_animation':
      return span(Math.max(0.01, item.duration));
    case 'camera_move':
      return span(item.duration);
    default:
      return null;
  }
}
