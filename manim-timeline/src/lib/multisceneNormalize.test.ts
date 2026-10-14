import { describe, expect, it } from 'vitest';
import { FRAME_W, PROJECT_VERSION } from '@/lib/constants';
import type { MultiSceneProjectFile, ProjectFile } from '@/types/scene';
import { MULTISCENE_PROJECT_KIND, isMultiSceneProjectFile } from '@/types/scene';
import {
  legacyProjectFileToMultiScene,
  migrateMultiSceneProjectsInPlace,
  normalizeAnyDiskProjectToMulti,
} from '@/lib/multisceneNormalize';
import type { SceneItem } from '@/types/scene';
import { createCameraMove, defaultFrames } from '@/store/factories';

function legacySingleScene(overrides: Partial<ProjectFile> = {}): ProjectFile {
  const frameConfig = defaultFrames();
  return {
    version: PROJECT_VERSION,
    savedAt: '2020-01-01T00:00:00.000Z',
    defaults: {
      font: '',
      fontSize: 48,
      mathColor: '#ffffff',
      exportNamePrefix: '',
      sceneName: 'LessonIntro',
    },
    frames: frameConfig.frames,
    startFrameId: frameConfig.startFrameId,
    items: [] as SceneItem[],
    audioItems: [
      {
        id: 'audio-1',
        text: 'narration',
        audioUrl: 'https://example.com/a.webm',
        startTime: 0,
        duration: 2,
      },
    ],
    measureConfig: {
      url: 'http://127.0.0.1:8765',
      enabled: true,
      includePreview: false,
    },
    ...overrides,
  };
}

describe('multisceneNormalize', () => {
  it('retains graph-follow references and optional annotation fields across scenes', () => {
    const item = { kind: 'target_animation', id: 'move-graph', label: '', layer: 0, startTime: 1, duration: 2, mode: 'graphFollow', targets: [{ targetId: 'dot', graphPlotId: 'plot', targetX: 2, easing: 'linear' }] } as unknown as SceneItem;
    const dot = { kind: 'graphDot', id: 'dot', axesId: 'axes', label: '', layer: 0, startTime: 0, duration: 1, x: 0, y: 0, scale: 1, posSteps: [{ kind: 'absolute' }], dot: { id: 'data-dot', dx: 0, dy: 0, color: '#fff', radius: .1, label: '', labelDir: 'UP', showCoordinates: true, showProjectionGuides: true, attachment: { kind: 'function', graphPlotId: 'plot', x: 2 }, coordinatePrecision: 3 } } as unknown as SceneItem;
    const normalized = normalizeAnyDiskProjectToMulti(legacySingleScene({ items: [item, dot] }));
    expect(normalized.scenes[0]!.items).toEqual(expect.arrayContaining([item, expect.objectContaining({ kind: 'graphDot', dot: expect.objectContaining({ showCoordinates: true, showProjectionGuides: true, attachment: { kind: 'function', graphPlotId: 'plot', x: 2 }, coordinatePrecision: 3 }) })]));
  });
  it('wraps legacy ProjectFile into MultiSceneProjectFile with one scene', () => {
    const legacy = legacySingleScene();
    const multi = legacyProjectFileToMultiScene(legacy);
    expect(multi.kind).toBe(MULTISCENE_PROJECT_KIND);
    expect(multi.scenes).toHaveLength(1);
    expect(multi.activeSceneId).toBe(multi.scenes[0]!.id);
    expect(multi.scenes[0]!.defaults.sceneName).toBe('LessonIntro');
    expect(multi.scenes[0]!.audioItems).toHaveLength(1);
    expect(multi.measureConfig.url).toBe('http://127.0.0.1:8765');
  });

  it('normalizeAnyDiskProjectToMulti preserves multi-scene shape and repairs active id', () => {
    const frameConfig = defaultFrames();
    const badMulti: MultiSceneProjectFile = {
      kind: MULTISCENE_PROJECT_KIND,
      version: PROJECT_VERSION,
      savedAt: '2020-01-01',
      measureConfig: { url: 'x', enabled: false, includePreview: false },
      activeSceneId: '__missing__',
      scenes: [
        {
          id: 'real-1',
          name: 'A',
          defaults: legacySingleScene().defaults,
          frames: frameConfig.frames,
          startFrameId: frameConfig.startFrameId,
          items: [],
          audioItems: undefined,
        },
      ],
    };
    const out = normalizeAnyDiskProjectToMulti(badMulti);
    expect(isMultiSceneProjectFile(out)).toBe(true);
    expect(out.activeSceneId).toBe('real-1');
    expect(out.scenes).toHaveLength(1);
  });

  it('normalizeAnyDiskProjectToMulti delegates legacy wrap', () => {
    const wrapped = normalizeAnyDiskProjectToMulti(
      legacySingleScene({
        defaults: { ...legacySingleScene().defaults, sceneName: '  OnlyScene  ' },
      }),
    );
    expect(wrapped.kind).toBe(MULTISCENE_PROJECT_KIND);
    expect(wrapped.scenes[0]!.name).toBe('OnlyScene');
  });

  it('migrateMultiSceneProjectsInPlace runs item migrations for every scene', () => {
    const frameConfig = defaultFrames();
    const legacyCamera = { ...createCameraMove(frameConfig.startFrameId, 4, 2), id: 'legacy-camera' } as SceneItem & { targetWidth?: number };
    delete legacyCamera.targetWidth;
    const multi: MultiSceneProjectFile = {
      kind: MULTISCENE_PROJECT_KIND,
      version: PROJECT_VERSION - 10,
      savedAt: '2020-01-01',
      measureConfig: legacySingleScene().measureConfig,
      activeSceneId: 'old',
      scenes: [
        {
          id: 'old',
          name: '',
          defaults: legacySingleScene().defaults,
          frames: frameConfig.frames,
          startFrameId: frameConfig.startFrameId,
          items: [legacyCamera] as SceneItem[],
        },
      ],
    };
    migrateMultiSceneProjectsInPlace(multi);
    const migrated = multi.scenes[0]!.items[0]!;
    expect(migrated.kind).toBe('camera_move');
    if (migrated.kind === 'camera_move') expect(migrated.targetWidth).toBe(FRAME_W);
  });
});
