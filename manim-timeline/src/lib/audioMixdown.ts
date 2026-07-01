import type {
  AudioBed,
  AudioTrackItem,
  SceneDefaults,
  SceneItem,
} from '@/types/scene';
import {
  deriveAudioBedAssetRelPath,
  measureServerRelativeAudioPath,
  measureServerRelativeAudioBedPath,
} from '@/lib/audioAssetPath';
import { computeSceneDurationSec } from '@/codegen/manimExporter';
import type { FrameDef, ItemId } from '@/types/scene';

export interface EffectiveClipFades {
  fadeInMs: number;
  fadeOutMs: number;
}

export function effectiveClipFadeMs(
  clip: AudioTrackItem,
  defaults: SceneDefaults,
): EffectiveClipFades {
  const fallback = defaults.audioCutFadeMs ?? 0;
  return {
    fadeInMs: clip.fadeInMs ?? fallback,
    fadeOutMs: clip.fadeOutMs ?? fallback,
  };
}

export function needsAudioMixdown(
  bed: AudioBed | null | undefined,
  clips: readonly AudioTrackItem[],
  defaults: SceneDefaults,
): boolean {
  if (bed) return true;
  if (clips.length === 0) return false;
  const fallback = defaults.audioCutFadeMs ?? 0;
  if (fallback > 0) return true;
  return clips.some(
    (c) => (c.fadeInMs ?? 0) > 0 || (c.fadeOutMs ?? 0) > 0,
  );
}

export interface AudioMixdownClipSpec {
  rel_path: string;
  start_sec: number;
  fade_in_ms: number;
  fade_out_ms: number;
  gain_db?: number;
}

export interface AudioMixdownBedSpec {
  rel_path: string;
  gain_db: number;
}

export interface AudioMixdownSpec {
  total_duration_sec: number;
  clips: AudioMixdownClipSpec[];
  bed?: AudioMixdownBedSpec;
}

export function buildAudioMixdownSpec(
  items: SceneItem[],
  audioItems: AudioTrackItem[],
  defaults: SceneDefaults,
  options: {
    audioBed?: AudioBed | null;
    frames?: FrameDef[];
    startFrameId?: ItemId;
  },
): AudioMixdownSpec {
  const total = computeSceneDurationSec(items, {
    audioItems,
    frames: options.frames,
    startFrameId: options.startFrameId,
  });

  const clips: AudioMixdownClipSpec[] = [];
  for (const track of audioItems) {
    const rel = measureServerRelativeAudioPath(track);
    if (!rel) {
      throw new Error(
        `Audio clip "${track.text.trim() || track.id}" has no server asset path for mixdown. Re-add or sync the clip.`,
      );
    }
    const fades = effectiveClipFadeMs(track, defaults);
    clips.push({
      rel_path: rel,
      start_sec: track.startTime,
      fade_in_ms: fades.fadeInMs,
      fade_out_ms: fades.fadeOutMs,
    });
  }

  let bed: AudioMixdownBedSpec | undefined;
  const audioBed = options.audioBed;
  if (audioBed) {
    const rel =
      measureServerRelativeAudioBedPath(audioBed) ??
      deriveAudioBedAssetRelPath(audioBed);
    bed = {
      rel_path: rel,
      gain_db: audioBed.gainDb,
    };
  }

  return {
    total_duration_sec: Math.max(0.01, total),
    clips,
    bed,
  };
}
