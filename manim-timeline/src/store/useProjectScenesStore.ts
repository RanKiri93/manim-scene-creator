import { create } from 'zustand';
import { newId } from '@/lib/ids';
import { PROJECT_VERSION } from '@/lib/constants';
import type {
  MultiSceneProjectFile,
  ProjectSceneFile,
  SceneItem,
  AudioTrackItem,
  AudioBed,
  ProjectFile,
} from '@/types/scene';
import { MULTISCENE_PROJECT_KIND } from '@/types/scene';
import {
  normalizeAnyDiskProjectToMulti,
  legacyProjectFileToMultiScene,
} from '@/lib/multisceneNormalize';
import { defaultFrames, defaultSceneDefaults, createTextLine } from '@/store/factories';
import { useSceneStore, type SceneDiskPayload } from '@/store/useSceneStore';
import {
  collectCodegenIdsFromItems,
  remapFragmentItemsInPlace,
} from '@/lib/projectFragment';
import { fingerprintSceneDiskPayload } from '@/lib/sceneFingerprint';

export interface SceneRenderMeta {
  fingerprint: string;
  quality: string;
  blobUrl?: string;
  renderedAt?: string;
  error?: string | null;
}

function payloadFromDiskScene(sf: ProjectSceneFile): SceneDiskPayload {
  const aud = sf.audioItems;
  return {
    defaults: { ...sf.defaults },
    frames: sf.frames.map((f) => ({ ...f })),
    startFrameId: sf.startFrameId,
    items: sf.items.map((it) =>
      structuredClone(it) as SceneItem),
    audioItems:
      aud && aud.length > 0
        ? aud.map((a) => structuredClone(a) as AudioTrackItem)
        : undefined,
    audioBed: sf.audioBed
      ? (structuredClone(sf.audioBed) as AudioBed)
      : undefined,
  };
}

export function snapshotEditorToDiskPayload(): SceneDiskPayload {
  return useSceneStore.getState().toSceneDiskPayload();
}

interface ProjectScenesStore {
  /** False until explicit bootstrap / project load */
  hydrated: boolean;
  sceneIds: string[];
  sceneTabNames: Record<string, string>;
  /** Serialized scenes that are not the active editor — active lives in useSceneStore */
  idleScenes: Record<string, SceneDiskPayload>;
  activeSceneId: string | null;
  sceneRenderMeta: Record<string, SceneRenderMeta>;

  /** First visit: associate current editor buffer with Scene 1 */
  bootstrapIfNeeded: () => void;
  /** Load already-normalized multi project (migrate items beforehand). */
  loadFromNormalizedMulti: (multi: MultiSceneProjectFile) => void;
  loadFromLegacyProjectFile: (file: ProjectFile) => void;
  /** Persist any disk open into multi-store (handles legacy wrapper). */
  loadFromAnyDiskProject: (file: ProjectFile | MultiSceneProjectFile) => void;

  persistActiveIntoIdle: () => void;
  switchToScene: (id: string) => void;
  addScene: () => void;
  duplicateScene: (sourceId: string) => void;
  removeScene: (id: string) => void;
  renameSceneTab: (id: string, name: string) => void;
  moveScene: (id: string, dir: -1 | 1) => void;

  toMultiSceneProjectFile: () => MultiSceneProjectFile;
  updateRenderMeta: (sceneId: string, meta: Partial<SceneRenderMeta>) => void;
}

function collectReservedAcrossProject(
  st: Pick<ProjectScenesStore, 'sceneIds' | 'activeSceneId' | 'idleScenes'>,
): Set<string> {
  const reserved = new Set<string>();
  for (const sid of st.sceneIds) {
    const p =
      sid === st.activeSceneId
        ? snapshotEditorToDiskPayload()
        : st.idleScenes[sid];
    if (!p) continue;
    for (const id of collectCodegenIdsFromItems(p.items)) {
      reserved.add(id);
    }
    for (const a of p.audioItems ?? []) {
      reserved.add(a.id);
    }
  }
  return reserved;
}

export const useProjectScenesStore = create<ProjectScenesStore>((set, get) => ({
  hydrated: false,
  sceneIds: [],
  sceneTabNames: {},
  idleScenes: {},
  activeSceneId: null,
  sceneRenderMeta: {},

  bootstrapIfNeeded: () => {
    if (get().hydrated) return;
    const id = newId();
    const label =
      useSceneStore.getState().defaults.sceneName?.trim() || 'Scene 1';
    set({
      hydrated: true,
      sceneIds: [id],
      sceneTabNames: { [id]: label },
      idleScenes: {},
      activeSceneId: id,
      sceneRenderMeta: {
        [id]: {
          fingerprint: fingerprintSceneDiskPayload(snapshotEditorToDiskPayload()),
          quality: '',
          error: null,
        },
      },
    });
  },

  loadFromNormalizedMulti: (multi) => {
    const idle: Record<string, SceneDiskPayload> = {};
    const tabs: Record<string, string> = {};
    const meta: Record<string, SceneRenderMeta> = {};
    let activeId = multi.activeSceneId;
    const fv = multi.version ?? 0;

    const ids = multi.scenes.map((sc) => {
      tabs[sc.id] = sc.name;
      const disk = payloadFromDiskScene(sc);
      const fp = fingerprintSceneDiskPayload(disk);
      meta[sc.id] = {
        fingerprint: fp,
        quality: '',
        error: null,
      };
      return sc.id;
    });

    for (const sc of multi.scenes) {
      if (sc.id !== activeId) {
        idle[sc.id] = payloadFromDiskScene(sc);
      }
    }

    if (!ids.includes(activeId) && ids[0]) {
      activeId = ids[0];
    }

    useSceneStore.getState().setMeasureConfig(multi.measureConfig);
    const activeScene = multi.scenes.find((s) => s.id === activeId);
    if (!activeScene) return;

    useSceneStore
      .getState()
      .loadSceneDocument(payloadFromDiskScene(activeScene), fv);

    set({
      hydrated: true,
      sceneIds: ids.length > 0 ? ids : [],
      sceneTabNames: tabs,
      idleScenes: idle,
      activeSceneId: activeId,
      sceneRenderMeta: meta,
    });
  },

  loadFromLegacyProjectFile: (file) => {
    get().loadFromNormalizedMulti(legacyProjectFileToMultiScene(file));
  },

  loadFromAnyDiskProject: (file) => {
    get().loadFromNormalizedMulti(normalizeAnyDiskProjectToMulti(file));
  },

  persistActiveIntoIdle: () => {
    const aid = get().activeSceneId;
    if (!aid || !get().hydrated) return;
    const snap = snapshotEditorToDiskPayload();
    set({
      idleScenes: {
        ...get().idleScenes,
        [aid]: snap,
      },
    });
  },

  switchToScene: (id) => {
    const st = get();
    if (!st.hydrated || !st.sceneIds.includes(id)) return;
    if (st.activeSceneId === id) return;

    const snap = snapshotEditorToDiskPayload();
    const idle = { ...st.idleScenes };
    const cur = st.activeSceneId;
    if (cur) {
      idle[cur] = snap;
    }
    const nextPayload = idle[id];
    if (!nextPayload) {
      console.warn('[project] missing idle payload for scene', id);
      return;
    }
    delete idle[id];

    useSceneStore.getState().loadSceneDocument(nextPayload, PROJECT_VERSION);

    const fp = fingerprintSceneDiskPayload(nextPayload);
    set({
      idleScenes: idle,
      activeSceneId: id,
      sceneRenderMeta: {
        ...st.sceneRenderMeta,
        [id]: {
          fingerprint: fp,
          quality: st.sceneRenderMeta[id]?.quality ?? '',
          error: null,
          blobUrl: st.sceneRenderMeta[id]?.blobUrl,
          renderedAt: st.sceneRenderMeta[id]?.renderedAt,
        },
      },
      sceneTabNames: {
        ...st.sceneTabNames,
        ...(cur ? { [cur]: st.sceneTabNames[cur] ?? 'Scene' } : {}),
      },
    });
  },

  addScene: () => {
    get().bootstrapIfNeeded();
    get().persistActiveIntoIdle();

    const st = get();
    const newSceneId = newId();
    const def = defaultSceneDefaults();
    def.sceneName = `Scene${st.sceneIds.length + 1}`;
    const line = createTextLine(def, 0);
    const frameConfig = defaultFrames();
    line.frameId = frameConfig.startFrameId;
    const payload: SceneDiskPayload = {
      defaults: { ...def },
      frames: frameConfig.frames,
      startFrameId: frameConfig.startFrameId,
      items: [line],
      audioItems: undefined,
    };

    useSceneStore.getState().loadSceneDocument(payload, PROJECT_VERSION);

    const fp = fingerprintSceneDiskPayload(payload);
    set({
      sceneIds: [...st.sceneIds, newSceneId],
      sceneTabNames: {
        ...st.sceneTabNames,
        [newSceneId]: def.sceneName ?? `Scene ${st.sceneIds.length + 1}`,
      },
      activeSceneId: newSceneId,
      idleScenes: { ...get().idleScenes },
      sceneRenderMeta: {
        ...st.sceneRenderMeta,
        [newSceneId]: { fingerprint: fp, quality: '', error: null },
      },
    });
  },

  duplicateScene: (sourceId) => {
    get().persistActiveIntoIdle();

    const st2 = get();
    const reserved = collectReservedAcrossProject(st2);

    let basePayload: SceneDiskPayload | undefined =
      sourceId === st2.activeSceneId
        ? snapshotEditorToDiskPayload()
        : st2.idleScenes[sourceId];
    if (!basePayload) return;

    const items = structuredClone(basePayload.items) as SceneItem[];
    const audioItems = structuredClone(
      basePayload.audioItems ?? [],
    ) as AudioTrackItem[];
    remapFragmentItemsInPlace(items, audioItems, reserved);

    const newSceneId = newId();
    const dupDefaults = {
      ...structuredClone(basePayload.defaults),
      sceneName:
        `${basePayload.defaults.sceneName || 'Scene'}Copy`.slice(0, 120),
    };
    const payload: SceneDiskPayload = {
      defaults: dupDefaults,
      frames: structuredClone(basePayload.frames),
      startFrameId: basePayload.startFrameId,
      items,
      audioItems: audioItems.length ? audioItems : undefined,
    };

    useSceneStore.getState().loadSceneDocument(payload, PROJECT_VERSION);

    const insertAt = st2.sceneIds.indexOf(sourceId);
    const ids = [...st2.sceneIds];
    const at = insertAt >= 0 ? insertAt + 1 : ids.length;
    ids.splice(at, 0, newSceneId);

    const tabName =
      `${st2.sceneTabNames[sourceId] ?? dupDefaults.sceneName} copy`;

    const fp = fingerprintSceneDiskPayload(payload);
    set({
      sceneIds: ids,
      sceneTabNames: { ...st2.sceneTabNames, [newSceneId]: tabName },
      activeSceneId: newSceneId,
      idleScenes: get().idleScenes,
      sceneRenderMeta: {
        ...st2.sceneRenderMeta,
        [newSceneId]: { fingerprint: fp, quality: '', error: null },
      },
    });
  },

  removeScene: (id) => {
    let st = get();
    if (st.sceneIds.length <= 1) return;

    get().persistActiveIntoIdle();
    st = get();

    const filtered = st.sceneIds.filter((x) => x !== id);
    if (filtered.length === 0) return;

    let idle = { ...st.idleScenes };
    delete idle[id];

    let nextTabs = { ...st.sceneTabNames };
    delete nextTabs[id];

    let nextMeta = { ...st.sceneRenderMeta };
    delete nextMeta[id];

    if (st.activeSceneId === id) {
      const cand = filtered[0]!;
      const payload = idle[cand];
      if (!payload) return;

      delete idle[cand];

      useSceneStore.getState().loadSceneDocument(payload, PROJECT_VERSION);
      const fp = fingerprintSceneDiskPayload(payload);

      set({
        sceneIds: filtered,
        idleScenes: idle,
        activeSceneId: cand,
        sceneTabNames: nextTabs,
        sceneRenderMeta: {
          ...nextMeta,
          [cand]: {
            fingerprint: fp,
            quality: nextMeta[cand]?.quality ?? '',
            error: null,
            blobUrl: nextMeta[cand]?.blobUrl,
            renderedAt: nextMeta[cand]?.renderedAt,
          },
        },
      });
    } else {
      set({
        sceneIds: filtered,
        idleScenes: idle,
        sceneTabNames: nextTabs,
        sceneRenderMeta: nextMeta,
        activeSceneId: st.activeSceneId,
      });
    }
  },

  renameSceneTab: (id, name) => {
    const t = name.trim();
    if (!t) return;
    const st = get();
    set({ sceneTabNames: { ...st.sceneTabNames, [id]: t } });
  },

  moveScene: (id, dir) => {
    const st = get();
    const ix = st.sceneIds.indexOf(id);
    if (ix < 0) return;
    const j = ix + dir;
    if (j < 0 || j >= st.sceneIds.length) return;
    const next = [...st.sceneIds];
    [next[ix], next[j]] = [next[j]!, next[ix]!];
    set({ sceneIds: next });
  },

  toMultiSceneProjectFile: () => {
    get().persistActiveIntoIdle();
    const st = get();
    const aid = st.activeSceneId ?? st.sceneIds[0];

    const scenes: ProjectSceneFile[] = [];

    const idle = { ...st.idleScenes };
    const live = aid ? snapshotEditorToDiskPayload() : null;

    for (const sid of st.sceneIds) {
      const docRaw =
        sid === aid ? live : idle[sid];
      if (!docRaw) continue;
      const doc: SceneDiskPayload =
        sid === aid
          ? docRaw
          : {
              defaults: structuredClone(docRaw.defaults),
              frames: docRaw.frames.map((f) => structuredClone(f)),
              startFrameId: docRaw.startFrameId,
              items: docRaw.items.map((it) => structuredClone(it) as SceneItem),
              audioItems: docRaw.audioItems?.length
                ? docRaw.audioItems.map(
                    (a) => structuredClone(a) as AudioTrackItem,
                  )
                : undefined,
              audioBed: docRaw.audioBed
                ? (structuredClone(docRaw.audioBed) as AudioBed)
                : undefined,
            };

      scenes.push({
        id: sid,
        name: st.sceneTabNames[sid] ?? doc.defaults.sceneName ?? 'Scene',
        defaults: structuredClone(doc.defaults),
        frames: doc.frames.map((f) => structuredClone(f)),
        startFrameId: doc.startFrameId,
        items: doc.items.map((it) => structuredClone(it) as SceneItem),
        audioItems:
          doc.audioItems && doc.audioItems.length > 0
            ? doc.audioItems.map((a) => structuredClone(a) as AudioTrackItem)
            : undefined,
        audioBed: doc.audioBed
          ? (structuredClone(doc.audioBed) as AudioBed)
          : undefined,
      });
    }

    const activeFallback = aid && st.sceneIds.includes(aid)
      ? aid
      : st.sceneIds[0] ?? '';

    return {
      kind: MULTISCENE_PROJECT_KIND,
      version: PROJECT_VERSION,
      savedAt: new Date().toISOString(),
      measureConfig: { ...useSceneStore.getState().measureConfig },
      activeSceneId: activeFallback,
      scenes,
    };
  },

  updateRenderMeta: (sceneId, meta) =>
    set((prev) => ({
      sceneRenderMeta: {
        ...prev.sceneRenderMeta,
        [sceneId]: {
          fingerprint:
            meta.fingerprint ??
            prev.sceneRenderMeta[sceneId]?.fingerprint ??
            '',
          quality:
            meta.quality ?? prev.sceneRenderMeta[sceneId]?.quality ?? '',
          blobUrl: meta.blobUrl ?? prev.sceneRenderMeta[sceneId]?.blobUrl,
          renderedAt:
            meta.renderedAt ?? prev.sceneRenderMeta[sceneId]?.renderedAt,
          error: meta.error ?? prev.sceneRenderMeta[sceneId]?.error ?? null,
        },
      },
    })),
}));
