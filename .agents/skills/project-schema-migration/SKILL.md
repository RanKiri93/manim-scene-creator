---
name: project-schema-migration
description: How to change the persisted project schema (types/scene.ts) safely — bump PROJECT_VERSION, write migrateProjectToVxx, wire it, test it. Load whenever a field is added, renamed, removed, or re-typed on a SceneItem, AudioTrackItem, SceneDefaults, FrameDef, or the project file.
---

# Project schema migration

Projects are saved as JSON (`.json`) or ZIP bundles (`.mtproj` with `state.json`). Both
carry `version` (currently `PROJECT_VERSION` in `src/lib/constants.ts`). On load,
`migrateItemsToCurrentVersion(items, fileVersion)` in `src/lib/migrateLoadedItems.ts` runs
every step whose threshold is above the file's version.

## When a migration is required

- New required field on a persisted type → yes (backfill a default).
- New optional field → no bump needed if every reader tolerates `undefined`; still add a
  factory default in `src/store/factories.ts` and a normalizer default in
  `src/agent/validate.ts`.
- Rename / remove / re-type → yes.
- Change only to UI-only fields (`measure`, `previewDataUrl`, `segmentMeasures`,
  `axisPreview*`, `topLevelError`, …) → no.
- Change to `SceneDefaults` → yes; see `migrateProjectToV39.ts` (`migrateSceneDefaultsToV39`)
  for the pattern that runs at store load rather than in the items chain.

## Procedure

1. Edit `src/types/scene.ts`. Keep the doc comment on the field explaining units and default.
2. Bump `PROJECT_VERSION` in `src/lib/constants.ts` to N.
3. Create `src/lib/migrateProjectToVN.ts` exporting `migrateItemsToVN(items: readonly SceneItem[]): SceneItem[]`.
   Pattern (from `migrateProjectToV40.ts`): map over items, return shallow copies, touch only
   the affected `kind`, be idempotent (running it twice must be a no-op).
4. Wire it at the end of `migrateItemsToCurrentVersion` in `migrateLoadedItems.ts`:
   ```ts
   if (fileVersion < N) {
     migrated = migrateItemsToVN(migrated);
   }
   ```
5. Add `src/lib/migrateProjectToVN.test.ts` with at least: legacy input is backfilled;
   already-migrated input is unchanged. Use `createTextLine(defaultSceneDefaults(), …)` or the
   relevant factory to build fixtures.
6. Update factories (`src/store/factories.ts`) and agent normalizers (`src/agent/validate.ts`)
   so new items are born valid.
7. If the Copilot may emit the field, add it to the Gemini flat schema
   (`src/agent/providers/gemini.ts`) with a `description` (skill `copilot-add-kind`, §Schema skew).
8. Multi-scene files: `src/lib/multisceneNormalize.ts` routes each scene through the same
   item chain; nothing extra unless you changed the wrapper (`MultiSceneProjectFile`).
9. `.mtproj`: only if you added a new asset-carrying field. Then extend
   `src/lib/mtprojBundle.ts` (pack + unpack + manifest MD5) and its test.
10. README "Project file format" section: add a `**Version N**` line describing the change.

## Do not

- Do not mutate items in place inside a migration; return new objects.
- Do not skip a version number to "reserve" it; the chain is `if (fileVersion < N)` and gaps
  confuse readers (v37/v38 already exist as gaps for historical reasons — do not add more).
- Do not put migration logic in `useSceneStore.loadProjectFile`; it belongs in the chain.
