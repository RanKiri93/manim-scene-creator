import { describe, expect, it } from 'vitest';
import type { AudioTrackItem, SceneItem, TextLineItem } from '@/types/scene';
import { createTextLine, defaultSceneDefaults } from '@/store/factories';
import { buildAudioScriptMarkdown } from './scriptExport';

function mapOf(...items: SceneItem[]): Map<string, SceneItem> {
  return new Map(items.map((it) => [it.id, it]));
}

function line(id: string, start: number, raw: string): TextLineItem {
  const defaults = defaultSceneDefaults();
  const item = createTextLine(defaults, start);
  item.id = id;
  item.raw = raw;
  item.segments = [
    {
      text: raw,
      isMath: false,
      color: '#fff',
      bold: false,
      italic: false,
    },
  ];
  return item;
}

function audio(
  id: string,
  start: number,
  duration: number,
  text: string,
): AudioTrackItem {
  return {
    id,
    text,
    audioUrl: '',
    startTime: start,
    duration,
  };
}

describe('buildAudioScriptMarkdown', () => {
  it('sorts audio-only tracks by start time', () => {
    const md = buildAudioScriptMarkdown(
      new Map(),
      [
        audio('t2', 2, 1, 'second'),
        audio('t0', 0, 1, 'first'),
      ],
    );
    const i0 = md.indexOf('first');
    const i2 = md.indexOf('second');
    expect(i0).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(-1);
    expect(i0).toBeLessThan(i2);
    expect(md).toMatch(/## Audio 1/);
    expect(md).toMatch(/## Audio 2/);
  });

  it('interleaves text lines and audio by timeline start', () => {
    const L = line('L1', 0, 'שלום');
    const A = audio('A1', 1, 0.5, 'narration');
    const md = buildAudioScriptMarkdown(mapOf(L), [A]);
    expect(md.indexOf('## Text line 1')).toBeLessThan(md.indexOf('## Audio 1'));
    expect(md).toContain('שלום');
    expect(md).toContain('narration');
  });

  it('places audio before text line when start times tie (then id)', () => {
    const L = line('lineZ', 0, 'zzz');
    const A = audio('trkB', 0, 1, 'aaa');
    const md = buildAudioScriptMarkdown(mapOf(L), [A]);
    expect(md.indexOf('## Audio 1')).toBeLessThan(md.indexOf('## Text line 1'));

    const L2 = line('lineA', 0, 'first line');
    const A2 = audio('trkA', 0, 1, 'first audio');
    const md2 = buildAudioScriptMarkdown(mapOf(L2), [A2]);
    expect(md2.indexOf('## Audio 1')).toBeLessThan(md2.indexOf('## Text line 1'));
  });

  it('flags generic upload / mic placeholder text for review', () => {
    const md = buildAudioScriptMarkdown(new Map(), [
      audio('x', 0, 1, 'Uploaded audio'),
    ]);
    expect(md).toContain('Review: replace generic');
    expect(md).toContain('Uploaded audio');
  });

  it('handles empty audio and no text lines', () => {
    const md = buildAudioScriptMarkdown(new Map(), []);
    expect(md).toContain('No audio tracks and no text lines');
  });
});
