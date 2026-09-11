import { describe, expect, it } from 'vitest';
import type { ImageItem, SceneItem } from '@/types/scene';
import { createImageItem, createShape } from '@/store/factories';
import { generateImageDef, generateImagePlay, generateImagePos } from './imageCodegen';

function baseImage(over: Partial<ImageItem> = {}): ImageItem {
  const item = createImageItem({
    srcUrl: 'blob:local-image',
    fileName: 'logo.png',
    mimeType: 'image/png',
    width: 2.5,
    height: 1.25,
    startTime: 0,
  });
  item.id = 'img1';
  item.assetRelPath = 'assets/textures/logo.png';
  return { ...item, ...over };
}

function mapOf(...items: SceneItem[]): Map<string, SceneItem> {
  return new Map(items.map((it) => [it.id, it]));
}

describe('imageCodegen', () => {
  it('emits ImageMobject with stable texture path, dimensions, opacity', () => {
    const item = baseImage({ opacity: 0.42 });
    const code = generateImageDef(item, 'image_1', 0);

    expect(code).toContain('image_1 = ImageMobject("assets/textures/logo.png")');
    expect(code).toContain('image_1.stretch_to_fit_width(2.500000)');
    expect(code).toContain('image_1.stretch_to_fit_height(1.250000)');
    expect(code).toContain('image_1.set_opacity(0.4200)');
  });

  it('emits absolute/to_edge/next_to placement plus scale and rotation', () => {
    const ref = createShape(0);
    ref.id = 'shape-ref';
    ref.x = -1;
    ref.y = 0.25;
    const item = baseImage({
      x: 1.5,
      y: -0.75,
      scale: 1.2,
      rotationDeg: 30,
      posSteps: [
        { kind: 'absolute' },
        { kind: 'to_edge', edge: 'RIGHT', buff: 0.4 },
        {
          kind: 'next_to',
          refKind: 'shape',
          refId: ref.id,
          dir: 'DOWN',
          buff: 0.25,
          alignedEdge: null,
          refSegmentIndex: null,
          selfSegmentIndex: null,
          bounds: null,
        },
      ],
    });
    const code = generateImagePos(
      item,
      'image_1',
      0,
      new Map([[ref.id, 'shape_1']]),
      mapOf(item, ref),
    );

    expect(code).toContain('image_1.scale(1.200000)');
    expect(code).toContain('image_1.move_to([1.500000, -0.750000, 0])');
    expect(code).toContain('image_1.to_edge(RIGHT, buff=0.4)');
    expect(code).toContain('image_1.next_to(shape_1, DOWN, buff=0.25)');
    expect(code).toContain('image_1.rotate(-30.0000 * DEGREES');
  });

  it('emits FadeIn with exact duration for entry playback', () => {
    const item = baseImage({ duration: 1.75 });
    const code = generateImagePlay(item, 'image_1', 0, mapOf(item), []);

    expect(code).toBe('self.play(FadeIn(image_1), run_time=1.750000)\n');
  });

  it('rejects blob URLs that were not bundled for export', () => {
    const item = baseImage({ assetRelPath: undefined, srcUrl: 'blob:not-packaged' });

    expect(() => generateImageDef(item, 'image_1', 0)).toThrow(
      /not bundled for Manim export/,
    );
  });

  it('emits the temp-file fallback for data:image data URLs', () => {
    const tiny = btoa('fake-png-bytes');
    const item = baseImage({
      assetRelPath: undefined,
      srcUrl: `data:image/png;base64,${tiny}`,
    });
    const code = generateImageDef(item, 'image_1', 0);

    expect(code).toContain('base64.b64decode(');
    expect(code).toContain('tempfile.gettempdir()');
    expect(code).toContain('image_1 = ImageMobject(_image_1_path)');
  });
});
