import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/lib/ids';
import { PROJECT_VERSION } from '@/lib/constants';
import type { MultiSceneProjectFile, ProjectSceneFile } from '@/types/scene';
import { MULTISCENE_PROJECT_KIND } from '@/types/scene';
import { defaultFrames, defaultSceneDefaults, createTextLine } from '@/store/factories';
import { useSceneStore } from '@/store/useSceneStore';
import { useProjectScenesStore } from '@/store/useProjectScenesStore';
import { legacyProjectFileToMultiScene } from '@/lib/multisceneNormalize';
import type { ProjectFile } from '@/types/scene';

function resetProjectScenesStore() {
  useProjectScenesStore.setState({
    hydrated: false,
    sceneIds: [],
    sceneTabNames: {},
    idleScenes: {},
    activeSceneId: null,
    sceneRenderMeta: {},
  });
}

function resetSceneStoreMinimal() {
  const def = defaultSceneDefaults();
  const frameConfig = defaultFrames();
  const line = createTextLine(def, 0);
  line.frameId = frameConfig.startFrameId;
  useSceneStore.getState().loadSceneDocument(
    {
      defaults: def,
      frames: frameConfig.frames,
      startFrameId: frameConfig.startFrameId,
      items: [line],
      audioItems: undefined,
    },
    PROJECT_VERSION,
  );
}

function buildTwoSceneProject(): MultiSceneProjectFile {
  const sid1 = newId();
  const sid2 = newId();
  const d1 = { ...defaultSceneDefaults(), sceneName: 'First' };
  const d2 = { ...defaultSceneDefaults(), sceneName: 'Second' };
  const f1 = defaultFrames();
  const f2 = defaultFrames();
  const l1 = createTextLine(d1, 0);
  l1.frameId = f1.startFrameId;
  l1.raw = 'alpha-marker';
  const l2 = createTextLine(d2, 0);
  l2.frameId = f2.startFrameId;
  l2.raw = 'beta-marker';
  const sc1: ProjectSceneFile = {
    id: sid1,
    name: 'Tab1',
    defaults: d1,
    frames: f1.frames,
    startFrameId: f1.startFrameId,
    items: [l1],
    audioItems: undefined,
  };
  const sc2: ProjectSceneFile = {
    id: sid2,
    name: 'Tab2',
    defaults: d2,
    frames: f2.frames,
    startFrameId: f2.startFrameId,
    items: [l2],
    audioItems: undefined,
  };
  return {
    kind: MULTISCENE_PROJECT_KIND,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    measureConfig: {
      url: 'http://127.0.0.1:8765',
      enabled: true,
      includePreview: false,
    },
    activeSceneId: sid1,
    scenes: [sc1, sc2],
  };
}

describe('useProjectScenesStore', () => {
  beforeEach(() => {
    resetProjectScenesStore();
    resetSceneStoreMinimal();
  });

  it('bootstrapIfNeeded ties the current editor to one tab', () => {
    useProjectScenesStore.getState().bootstrapIfNeeded();
    const st = useProjectScenesStore.getState();
    expect(st.hydrated).toBe(true);
    expect(st.sceneIds).toHaveLength(1);
    expect(st.activeSceneId).toBe(st.sceneIds[0]);
  });

  it('switchToScene snapshots the prior scene and loads the next document', () => {
    const multi = buildTwoSceneProject();
    const [sid1, sid2] = multi.scenes.map((s) => s.id);
    useProjectScenesStore.getState().loadFromNormalizedMulti(multi);
    const firstLine = useSceneStore.getState().items.values().next().value as { raw: string };
    expect(firstLine.raw).toBe('alpha-marker');

    useProjectScenesStore.getState().switchToScene(sid2);
    const secondLine = useSceneStore.getState().items.values().next().value as { raw: string };
    expect(secondLine.raw).toBe('beta-marker');

    useProjectScenesStore.getState().switchToScene(sid1);
    const back = useSceneStore.getState().items.values().next().value as { raw: string };
    expect(back.raw).toBe('alpha-marker');
    expect(useProjectScenesStore.getState().idleScenes[sid2]).toBeDefined();
  });

  it('toMultiSceneProjectFile round-trips both idle and active scene payloads', () => {
    const multi = buildTwoSceneProject();
    useProjectScenesStore.getState().loadFromNormalizedMulti(multi);
    const sid2 = multi.scenes[1]!.id;
    useProjectScenesStore.getState().switchToScene(sid2);
    useSceneStore.getState().setDefaults({ sceneName: 'EditedSecond' });

    const disk = useProjectScenesStore.getState().toMultiSceneProjectFile();
    expect(disk.scenes).toHaveLength(2);
    const active = disk.scenes.find((s) => s.id === disk.activeSceneId);
    expect(active?.defaults.sceneName).toBe('EditedSecond');
  });

  it('loadFromLegacyProjectFile wraps into a single-scene project', () => {
    resetProjectScenesStore();
    const legacy: ProjectFile = {
      ...defaultFrames(),
      version: PROJECT_VERSION,
      savedAt: '2020-01-01',
      defaults: { ...defaultSceneDefaults(), sceneName: 'Legacy' },
      items: [createTextLine({ ...defaultSceneDefaults(), sceneName: 'Legacy' })],
      measureConfig: { url: 'http://x', enabled: false, includePreview: false },
    };
    useProjectScenesStore.getState().loadFromLegacyProjectFile(legacy);
    expect(useProjectScenesStore.getState().sceneIds).toHaveLength(1);
    expect(useSceneStore.getState().defaults.sceneName).toBe('Legacy');
  });

  it('legacyProjectFileToMultiScene used by load matches store scene count', () => {
    const legacy: ProjectFile = {
      ...defaultFrames(),
      version: PROJECT_VERSION,
      savedAt: '2020-01-01',
      defaults: defaultSceneDefaults(),
      items: [],
      measureConfig: { url: 'http://x', enabled: false, includePreview: false },
    };
    const wrapped = legacyProjectFileToMultiScene(legacy);
    expect(wrapped.scenes).toHaveLength(1);
  });
});
