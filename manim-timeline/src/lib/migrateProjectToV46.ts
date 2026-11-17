import type { SceneDefaults, VideoFormat } from '@/types/scene';
import { VIDEO_FORMAT_RATIOS } from '@/lib/constants';

/** v46: project video format (`defaults.videoFormat`); older scenes are 16:9. Idempotent. */
export function migrateSceneDefaultsToV46(defaults: SceneDefaults): SceneDefaults {
  const f = defaults.videoFormat;
  const videoFormat: VideoFormat = f && f in VIDEO_FORMAT_RATIOS ? f : '16:9';
  return { ...defaults, videoFormat };
}
