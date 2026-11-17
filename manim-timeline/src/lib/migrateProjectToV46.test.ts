import { afterEach, describe, expect, it } from 'vitest';
import { defaultSceneDefaults, createCameraMove, defaultFrames, createShape } from '@/store/factories';
import { DEFAULT_FRAME_W, FRAME_W, frameWidthFor, setActiveVideoFormat } from './constants';
import { migrateSceneDefaultsToV46 } from './migrateProjectToV46';
import { useSceneStore } from '@/store/useSceneStore';
import { useProjectScenesStore } from '@/store/useProjectScenesStore';
import { videoFormatConfigSource, exportManimCode } from '@/codegen/manimExporter';
import { buildContextPayload } from '@/agent/serialize';

afterEach(() => setActiveVideoFormat('16:9'));

describe('v46 video format', () => {
  it('backfills 16:9 and keeps a valid format', () => {
    const legacy = { ...defaultSceneDefaults() };
    delete legacy.videoFormat;
    expect(migrateSceneDefaultsToV46(legacy).videoFormat).toBe('16:9');
    const vertical = migrateSceneDefaultsToV46({ ...legacy, videoFormat: '9:16' });
    expect(vertical.videoFormat).toBe('9:16');
    expect(migrateSceneDefaultsToV46(vertical)).toEqual(vertical);
    expect(migrateSceneDefaultsToV46({ ...legacy, videoFormat: 'bogus' as never }).videoFormat).toBe('16:9');
  });

  it('keeps the frame 8 units tall and sizes its width by the ratio', () => {
    expect(frameWidthFor('16:9')).toBeCloseTo(DEFAULT_FRAME_W);
    expect(frameWidthFor('9:16')).toBeCloseTo(4.5);
    expect(frameWidthFor('1:1')).toBe(8);
    expect(frameWidthFor('4:5')).toBeCloseTo(6.4);
  });
});

function loadScene(cameraWidth: number) {
  const config = defaultFrames();
  const cam = createCameraMove(config.startFrameId, 1, 1);
  cam.id = 'cam';
  cam.targetWidth = cameraWidth;
  useSceneStore.getState().loadSceneDocument(
    { defaults: defaultSceneDefaults(), frames: config.frames, startFrameId: config.startFrameId, items: [cam], audioItems: undefined },
    46,
  );
  useSceneStore.temporal.getState().clear();
}

describe('changing the format', () => {
  it('updates the frame width, keeps camera framing, and undo restores both', () => {
    loadScene(DEFAULT_FRAME_W / 2);
    useSceneStore.getState().setVideoFormat('9:16');
    expect(FRAME_W).toBeCloseTo(4.5);
    const cam = useSceneStore.getState().items.get('cam');
    expect(cam?.kind === 'camera_move' && cam.targetWidth).toBeCloseTo(2.25);
    useSceneStore.temporal.getState().undo();
    expect(FRAME_W).toBeCloseTo(DEFAULT_FRAME_W);
    const back = useSceneStore.getState().items.get('cam');
    expect(back?.kind === 'camera_move' && back.targetWidth).toBeCloseTo(DEFAULT_FRAME_W / 2);
  });

  it('applies to the other scenes of the project, and loading a scene sets its width', () => {
    loadScene(DEFAULT_FRAME_W);
    const config = defaultFrames();
    const cam = createCameraMove(config.startFrameId, 0, 1);
    useProjectScenesStore.setState({
      idleScenes: { other: { defaults: defaultSceneDefaults(), frames: config.frames, startFrameId: config.startFrameId, items: [cam], audioItems: undefined } },
    });
    useProjectScenesStore.getState().setProjectVideoFormat('1:1');
    const other = useProjectScenesStore.getState().idleScenes.other!;
    expect(other.defaults.videoFormat).toBe('1:1');
    const otherCam = other.items[0]!;
    expect(otherCam.kind === 'camera_move' && otherCam.targetWidth).toBeCloseTo((cam.targetWidth * 8) / DEFAULT_FRAME_W);
    setActiveVideoFormat('16:9');
    useSceneStore.getState().loadSceneDocument(other, 46);
    expect(FRAME_W).toBe(8);
  });
});

describe('export and Copilot', () => {
  it('sets Manim pixel and frame size for non-16:9 formats only', () => {
    expect(videoFormatConfigSource('16:9')).toBe('');
    const v = videoFormatConfigSource('9:16');
    expect(v).toContain('config.pixel_width = int(round(_mt_short * 9 / 9 / 2)) * 2');
    expect(v).toContain('config.pixel_height = int(round(_mt_short * 16 / 9 / 2)) * 2');
    expect(v).toContain('config.frame_width = 4.500000');
    const s = createShape(0);
    const code = exportManimCode([s], { fullFile: true, defaults: { ...defaultSceneDefaults(), videoFormat: '4:5' } });
    expect(code).toContain('config.frame_width = 6.400000');
    expect(code.indexOf('config.frame_height')).toBeLessThan(code.indexOf('class '));
  });

  it('tells the Copilot the camera frame size', () => {
    const payload = buildContextPayload({ defaults: { ...defaultSceneDefaults(), videoFormat: '9:16' }, currentTime: 0, items: [] });
    expect(payload.cameraFrame).toEqual({ width: 4.5, height: 8, format: '9:16' });
  });
});
