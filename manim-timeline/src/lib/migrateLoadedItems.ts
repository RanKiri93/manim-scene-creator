import { migrateSceneItems } from '@/lib/migrateSceneItems';
import { migrateItemsFromPreV10 } from '@/lib/migrateProjectToV10';
import { migrateItemsToV11 } from '@/lib/migrateProjectToV11';
import { migrateItemsToV13 } from '@/lib/migrateProjectToV13';
import { migrateItemsToV14 } from '@/lib/migrateProjectToV14';
import {
  migrateItemsToV16,
  type PreV16SceneItem,
} from '@/lib/migrateProjectToV16';
import { migrateItemsToV17 } from '@/lib/migrateProjectToV17';
import { migrateItemsToV18 } from '@/lib/migrateProjectToV18';
import { migrateItemsToV19 } from '@/lib/migrateProjectToV19';
import { migrateItemsToV20 } from '@/lib/migrateProjectToV20';
import { migrateItemsToV21 } from '@/lib/migrateProjectToV21';
import { migrateItemsToV22 } from '@/lib/migrateProjectToV22';
import { migrateItemsToV23 } from '@/lib/migrateProjectToV23';
import { migrateItemsToV24 } from '@/lib/migrateProjectToV24';
import { migrateItemsToV25 } from '@/lib/migrateProjectToV25';
import { migrateItemsToV26 } from '@/lib/migrateProjectToV26';
import type { SceneItem } from '@/types/scene';

/** Run the same item migrations as full project load, up to current schema. */
export function migrateItemsToCurrentVersion(
  items: SceneItem[],
  fileVersion: number,
): SceneItem[] {
  let migrated = migrateSceneItems(items as SceneItem[]);
  if (fileVersion < 10) {
    migrated = migrateItemsFromPreV10(migrated);
  }
  if (fileVersion < 11) {
    migrated = migrateItemsToV11(migrated);
  }
  if (fileVersion < 13) {
    migrated = migrateItemsToV13(migrated);
  }
  if (fileVersion < 14) {
    migrated = migrateItemsToV14(migrated);
  }
  if (fileVersion < 16) {
    migrated = migrateItemsToV16(migrated as PreV16SceneItem[]);
  }
  if (fileVersion < 17) {
    migrated = migrateItemsToV17(migrated);
  }
  if (fileVersion < 18) {
    migrated = migrateItemsToV18(migrated);
  }
  if (fileVersion < 19) {
    migrated = migrateItemsToV19(migrated);
  }
  if (fileVersion < 20) {
    migrated = migrateItemsToV20(migrated);
  }
  if (fileVersion < 21) {
    migrated = migrateItemsToV21(migrated);
  }
  if (fileVersion < 22) {
    migrated = migrateItemsToV22(migrated);
  }
  if (fileVersion < 23) {
    migrated = migrateItemsToV23(migrated);
  }
  if (fileVersion < 24) {
    migrated = migrateItemsToV24(migrated);
  }
  if (fileVersion < 25) {
    migrated = migrateItemsToV25(migrated);
  }
  if (fileVersion < 26) {
    migrated = migrateItemsToV26(migrated);
  }
  return migrated;
}
