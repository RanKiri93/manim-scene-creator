import { DEFAULT_AUDIO_CUT_FADE_MS } from '@/lib/constants';
import type { SceneDefaults } from '@/types/scene';

/**
 * v39: Scene-level background bed + narration cut fades (`audioCutFadeMs` default).
 */
export function migrateSceneDefaultsToV39(defaults: SceneDefaults): SceneDefaults {
  return {
    ...defaults,
    audioCutFadeMs: defaults.audioCutFadeMs ?? DEFAULT_AUDIO_CUT_FADE_MS,
  };
}
