import { describe, expect, it } from 'vitest';
import {
  clampImageOpacity,
  deriveImageAssetRelPath,
  fitImageToManimSize,
  guessImageMime,
  isBundledVirtualImageUrl,
  isSupportedImageFile,
  supportedImageExtension,
} from '@/lib/imageAssetPath';

describe('supportedImageExtension', () => {
  it('accepts png/jpg/jpeg/gif case-insensitively', () => {
    expect(supportedImageExtension('a.PNG')).toBe('.png');
    expect(supportedImageExtension('a.jpg')).toBe('.jpg');
    expect(supportedImageExtension('a.JPEG')).toBe('.jpeg');
    expect(supportedImageExtension('anim.gif')).toBe('.gif');
  });

  it('rejects unknown extensions', () => {
    expect(supportedImageExtension('a.webp')).toBeNull();
    expect(supportedImageExtension('a.svg')).toBeNull();
    expect(supportedImageExtension('noext')).toBeNull();
  });
});

describe('isSupportedImageFile', () => {
  it('accepts supported names with matching mime', () => {
    expect(isSupportedImageFile({ name: 'p.png', type: 'image/png' })).toBe(true);
    expect(isSupportedImageFile({ name: 'p.JPG', type: 'image/jpeg' })).toBe(true);
    expect(isSupportedImageFile({ name: 'a.gif', type: 'image/gif' })).toBe(true);
  });

  it('rejects mismatched names', () => {
    expect(isSupportedImageFile({ name: 'p.webp', type: 'image/webp' })).toBe(false);
    expect(isSupportedImageFile({ name: 'p.png', type: 'image/webp' })).toBe(false);
  });
});

describe('deriveImageAssetRelPath', () => {
  it('honors a pinned assetRelPath', () => {
    expect(
      deriveImageAssetRelPath({
        assetRelPath: '/assets/textures/keep.png',
        srcUrl: 'blob:x',
        fileName: 'other.png',
      }),
    ).toBe('assets/textures/keep.png');
  });

  it('derives a sanitized textures path from the file name', () => {
    expect(
      deriveImageAssetRelPath({
        srcUrl: 'blob:x',
        fileName: 'my photo.JPG',
      }),
    ).toBe('assets/textures/my_photo.JPG');
  });

  it('normalizes unknown extensions to .png', () => {
    expect(
      deriveImageAssetRelPath({ srcUrl: 'blob:x', fileName: 'pic.webp' }),
    ).toBe('assets/textures/pic.png');
  });
});

describe('isBundledVirtualImageUrl', () => {
  it('detects textures paths only', () => {
    expect(isBundledVirtualImageUrl('assets/textures/a.png')).toBe(true);
    expect(isBundledVirtualImageUrl('assets/audio/a.webm')).toBe(false);
    expect(isBundledVirtualImageUrl('blob:http://x')).toBe(false);
  });
});

describe('guessImageMime', () => {
  it('maps jpg/jpeg/gif/png', () => {
    expect(guessImageMime('a.jpg')).toBe('image/jpeg');
    expect(guessImageMime('a.JPEG')).toBe('image/jpeg');
    expect(guessImageMime('a.gif')).toBe('image/gif');
    expect(guessImageMime('a.png')).toBe('image/png');
  });
});

describe('fitImageToManimSize', () => {
  it('fits the longest side to 3 units preserving aspect', () => {
    const s = fitImageToManimSize(1600, 900);
    expect(s.width).toBeCloseTo(3);
    expect(s.height).toBeCloseTo(900 * (3 / 1600));
  });

  it('falls back for degenerate dimensions', () => {
    const s = fitImageToManimSize(0, -1);
    expect(s.width).toBeGreaterThan(0);
    expect(s.height).toBeGreaterThan(0);
  });
});

describe('clampImageOpacity', () => {
  it('clamps to [0, 1] and defaults non-finite to 1', () => {
    expect(clampImageOpacity(1.4)).toBe(1);
    expect(clampImageOpacity(-0.2)).toBe(0);
    expect(clampImageOpacity(NaN)).toBe(1);
    expect(clampImageOpacity(0.35)).toBeCloseTo(0.35);
  });
});
