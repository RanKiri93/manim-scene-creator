import type { SceneDefaults } from '@/types/scene';
import { normalizeTimelineMarkers } from '@/lib/timelineMarkers';

/**
 * v45: free timeline markers (`defaults.timelineMarkers`), an empty list for older scenes.
 * Idempotent: valid markers pass through, sorted.
 */
export function migrateSceneDefaultsToV45(defaults: SceneDefaults): SceneDefaults {
  return { ...defaults, timelineMarkers: normalizeTimelineMarkers(defaults.timelineMarkers) };
}
