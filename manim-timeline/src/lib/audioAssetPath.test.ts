import { describe, it, expect } from 'vitest';
import type { AudioTrackItem } from '@/types/scene';
import { deriveAudioAssetRelPath, isBundledVirtualAudioUrl } from '@/lib/audioAssetPath';

function track(partial: Partial<AudioTrackItem> & Pick<AudioTrackItem, 'id' | 'audioUrl'>): AudioTrackItem {
  return {
    text: '',
    startTime: 0,
    duration: 1,
    ...partial,
  };
}

describe('deriveAudioAssetRelPath', () => {
  it('uses assetRelPath when set', () => {
    expect(
      deriveAudioAssetRelPath(
        track({
          id: 'a',
          audioUrl: 'blob:x',
          assetRelPath: 'assets/audio/pinned.mp3',
        }),
      ),
    ).toBe('assets/audio/pinned.mp3');
  });

  it('strips leading slashes from assetRelPath', () => {
    expect(
      deriveAudioAssetRelPath(
        track({
          id: 'a',
          audioUrl: 'blob:x',
          assetRelPath: '/assets/audio/pinned.mp3',
        }),
      ),
    ).toBe('assets/audio/pinned.mp3');
  });

  it('derives filename from http URL last segment', () => {
    expect(
      deriveAudioAssetRelPath(
        track({
          id: 'a',
          audioUrl: 'http://localhost:8765/static/foo.webm',
        }),
      ),
    ).toBe('assets/audio/foo.webm');
  });
});

describe('isBundledVirtualAudioUrl', () => {
  it('detects assets/audio paths', () => {
    expect(isBundledVirtualAudioUrl('assets/audio/x.mp3')).toBe(true);
  });

  it('detects reserved textures prefix', () => {
    expect(isBundledVirtualAudioUrl('assets/textures/t.png')).toBe(true);
  });

  it('rejects blob and http', () => {
    expect(isBundledVirtualAudioUrl('blob:http://x')).toBe(false);
    expect(isBundledVirtualAudioUrl('https://a/b.webm')).toBe(false);
  });
});
