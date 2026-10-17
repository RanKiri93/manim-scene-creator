import { describe, expect, it } from 'vitest';
import { exportManimCode } from './manimExporter';
import { audioClipHelperSource, pySoundCall } from './audioClipCodegen';
import { createTextLine, defaultSceneDefaults, createFrame } from '@/store/factories';
import { splitClip } from '@/lib/audioEdit';
import type { AudioTrackItem } from '@/types/scene';

const voice = (over: Partial<AudioTrackItem> = {}): AudioTrackItem => ({
  id: 'v',
  text: 'voice',
  audioUrl: '/assets/audio/voice.wav',
  assetRelPath: 'assets/audio/voice.wav',
  startTime: 0,
  duration: 4,
  ...over,
});

describe('pySoundCall', () => {
  it('keeps plain add_sound for a whole file', () => {
    expect(pySoundCall(voice())).toBe('self.add_sound("assets/audio/voice.wav")');
    expect(pySoundCall(voice(), 1.5)).toBe('self.add_sound("assets/audio/voice.wav", time_offset=1.5000)');
  });

  it('plays an edited piece through _mt_clip with its slice, gain and own fades', () => {
    const piece = voice({ sourceIn: 1.25, duration: 2, sourceDuration: 4, gainDb: -3, fadeOutMs: 80 });
    expect(pySoundCall(piece, 0.5)).toBe(
      '_mt_clip(self, "assets/audio/voice.wav", 1.2500, 2.0000, gain_db=-3.00, fade_out_ms=80, time_offset=0.5000)',
    );
  });

  it('helper uses the scene cut fade as its default', () => {
    expect(audioClipHelperSource(40)).toContain('fade_in_ms=40, fade_out_ms=40, time_offset=0.0):');
  });
});

describe('export with edited narration', () => {
  it('emits the helper once and one call per piece of a split clip', () => {
    const defaults = defaultSceneDefaults();
    const frame = createFrame(0, 0, 'Home');
    const [left, right] = splitClip(voice(), 1.5, 'v2')!;
    const moved = { ...right, startTime: 3 };
    const line = createTextLine(defaults, 0);
    line.raw = 'x';
    line.duration = 6;
    const code = exportManimCode([line], {
      fullFile: true,
      defaults,
      frames: [frame],
      startFrameId: frame.id,
      audioItems: [left, moved],
    });
    expect(code.match(/^def _mt_clip\(/gm)).toHaveLength(1);
    expect(code).toContain('"assets/audio/voice.wav", 0.0000, 1.5000');
    expect(code).toContain('"assets/audio/voice.wav", 1.5000, 2.5000');
    expect(code).not.toContain('self.add_sound(');
  });

  it('leaves untouched narration exports unchanged (no helper)', () => {
    const defaults = defaultSceneDefaults();
    const frame = createFrame(0, 0, 'Home');
    const line = createTextLine(defaults, 0);
    line.raw = 'x';
    const code = exportManimCode([line], {
      fullFile: true,
      defaults,
      frames: [frame],
      startFrameId: frame.id,
      audioItems: [voice()],
    });
    expect(code).not.toContain('_mt_clip');
    expect(code).toContain('self.add_sound("assets/audio/voice.wav")');
  });
});
