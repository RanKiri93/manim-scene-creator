import { newId } from '@/lib/ids';
import { migrateItemsToCurrentVersion } from '@/lib/migrateLoadedItems';
import { PROJECT_VERSION } from '@/lib/constants';
import type {
  AnyDiskProjectFile,
  MultiSceneProjectFile,
  ProjectFile,
  ProjectSceneFile,
  SceneItem,
} from '@/types/scene';
import {
  isMultiSceneProjectFile,
  MULTISCENE_PROJECT_KIND,
} from '@/types/scene';

/**
 * Migrate every scene's items array using the file root `version`
 * field (same as legacy single-project load).
 */
export function migrateMultiSceneProjectsInPlace(multi: MultiSceneProjectFile): void {
  const fv = multi.version ?? 0;
  for (const sc of multi.scenes) {
    sc.items = migrateItemsToCurrentVersion(sc.items as SceneItem[], fv);
  }
}

/** Wrap legacy `ProjectFile` into multi-scene (one scene) after item migration. */
export function legacyProjectFileToMultiScene(p: ProjectFile): MultiSceneProjectFile {
  const id = newId();
  const migratedItems = migrateItemsToCurrentVersion(
    p.items as SceneItem[],
    p.version ?? 0,
  );
  const scene: ProjectSceneFile = {
    id,
    name: p.defaults.sceneName?.trim() || 'Scene 1',
    defaults: { ...p.defaults },
    items: migratedItems,
    audioItems: p.audioItems?.length
      ? p.audioItems.map((a) => ({ ...a }))
      : undefined,
  };
  return {
    kind: MULTISCENE_PROJECT_KIND,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    measureConfig: { ...p.measureConfig },
    activeSceneId: id,
    scenes: [scene],
  };
}

/**
 * Produce a canonical multi-scene project from disk payload (migrate items in place).
 */
export function normalizeAnyDiskProjectToMulti(parsed: AnyDiskProjectFile): MultiSceneProjectFile {
  if (isMultiSceneProjectFile(parsed)) {
    migrateMultiSceneProjectsInPlace(parsed);
    if (!parsed.scenes.some((s) => s.id === parsed.activeSceneId) && parsed.scenes[0]) {
      parsed.activeSceneId = parsed.scenes[0].id;
    }
    return parsed;
  }
  return legacyProjectFileToMultiScene(parsed);
}
