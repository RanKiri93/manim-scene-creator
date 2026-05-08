import { describe, expect, it } from 'vitest';
import {
  AUDIO_BINDING_NONE,
  audioTrackLabel,
  isAudioBindingNone,
  explicitAudioBindingsForTrack,
  explicitAudioBindingLabel,
  explicitVisualOwnerForAudioTrack,
  boundAudioPlaybackStart,
  listBoundAudioPlaybackMarkers,
} from './audioBinding';
import type { AudioTrackItem, ExitAnimationItem, SceneItem, TextLineItem } from '@/types/scene';

function minimalLine(
  id: string,
  label: string,
  audioTrackId: string | null,
): TextLineItem {
  return {
    kind: 'textLine',
    id,
    label,
    layer: 0,
    startTime: 0,
    duration: 1,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    audioTrackId,
    raw: '',
    font: 'Alef',
    fontSize: 36,
    segments: [],
    measure: null,
    measureError: null,
    previewDataUrl: null,
    segmentMeasures: null,
  };
}

function minimalExit(id: string, targetId: string): ExitAnimationItem {
  return {
    kind: 'exit_animation',
    id,
    label: '',
    layer: 0,
    startTime: 2,
    duration: 1,
    targets: [{ targetId, animStyle: 'fade_out' }],
  };
}

function track(partial: Partial<AudioTrackItem> & Pick<AudioTrackItem, 'id'>): AudioTrackItem {
  return {
    text: '',
    audioUrl: '',
    startTime: 0,
    duration: 1,
    ...partial,
  };
}

describe('audioBinding', () => {
  it('isAudioBindingNone is true only for sentinel', () => {
    expect(isAudioBindingNone(AUDIO_BINDING_NONE)).toBe(true);
    expect(isAudioBindingNone(null)).toBe(false);
    expect(isAudioBindingNone(undefined)).toBe(false);
    expect(isAudioBindingNone('real-id')).toBe(false);
  });

  it('audioTrackLabel includes text preview and timing', () => {
    const t = track({
      id: 'abc123def',
      text: '  Hello world  ',
      startTime: 1.25,
      duration: 3.5,
    });
    expect(audioTrackLabel(t)).toContain('Hello world');
    expect(audioTrackLabel(t)).toContain('1.3s');
    expect(audioTrackLabel(t)).toContain('3.5s');
  });

  it('audioTrackLabel trims long text and uses fallback when empty', () => {
    const longText = 'a'.repeat(50);
    const tLong = track({ id: 'z', text: longText, startTime: 0, duration: 2 });
    expect(audioTrackLabel(tLong)).toContain('...');
    expect(audioTrackLabel(tLong).length).toBeLessThan(longText.length + 30);

    const tEmpty = track({ id: 'fullidhere', text: '   ', startTime: 0.5, duration: 1 });
    expect(audioTrackLabel(tEmpty)).toContain('Audio ');
    expect(audioTrackLabel(tEmpty)).toContain('fullid');
  });
});

describe('explicitAudioBindingsForTrack', () => {
  it('returns only visuals explicitly bound to the track id', () => {
    const items = new Map<string, SceneItem>([
      ['l1', minimalLine('l1', 'Line One', 'a1')],
      ['l2', minimalLine('l2', 'Line Two', null)],
      ['l3', minimalLine('l3', 'Line Three', AUDIO_BINDING_NONE)],
      ['ex', minimalExit('ex', 'l1')],
    ]);
    const bound = explicitAudioBindingsForTrack(items, 'a1');
    expect(bound.map((x) => x.id).sort()).toEqual(['l1']);
  });

  it('explicitAudioBindingLabel lists display names comma-separated', () => {
    const items = new Map<string, SceneItem>([
      ['l1', minimalLine('l1', 'Narr hook', 'tid')],
      ['l2', minimalLine('l2', '', 'tid')],
    ]);
    expect(explicitAudioBindingLabel(items, 'tid')).toBe('Narr hook, Empty line');
    expect(explicitAudioBindingLabel(items, 'unused')).toBe(
      'No explicit visual bindings',
    );
  });
});

describe('explicitVisualOwnerForAudioTrack', () => {
  it('returns the owning scene item when one explicit binding exists', () => {
    const items = new Map<string, SceneItem>([
      ['l1', minimalLine('l1', 'A', 't1')],
      ['l2', minimalLine('l2', 'B', null)],
    ]);
    expect(explicitVisualOwnerForAudioTrack(items, 't1')?.id).toBe('l1');
  });

  it('returns undefined when no explicit binding references the track', () => {
    const items = new Map<string, SceneItem>([
      ['l1', minimalLine('l1', 'A', AUDIO_BINDING_NONE)],
    ]);
    expect(explicitVisualOwnerForAudioTrack(items, 't1')).toBeUndefined();
  });
});

describe('boundAudioPlaybackStart', () => {
  it('uses track.startTime when clip is earlier than visual', () => {
    const visual = minimalLine('l1', 'L', 'a');
    visual.startTime = 5;
    const items = new Map<string, SceneItem>([['l1', visual]]);
    const a = track({ id: 'a', startTime: 1, duration: 12 });
    expect(boundAudioPlaybackStart(visual, a, items)).toBe(1);
  });

  it('uses visual.startTime when track starts after visual', () => {
    const visual = minimalLine('l1', 'L', 'a');
    visual.startTime = 5;
    const items = new Map<string, SceneItem>([['l1', visual]]);
    const a = track({ id: 'a', startTime: 8, duration: 2 });
    expect(boundAudioPlaybackStart(visual, a, items)).toBe(5);
  });

  it('uses shared time when visual and track start match', () => {
    const visual = minimalLine('l1', 'L', 'a');
    visual.startTime = 5;
    const items = new Map<string, SceneItem>([['l1', visual]]);
    const a = track({ id: 'a', startTime: 5, duration: 2 });
    expect(boundAudioPlaybackStart(visual, a, items)).toBe(5);
  });
});

describe('listBoundAudioPlaybackMarkers', () => {
  it('creates a marker when track starts after visual (playback aligns with visual)', () => {
    const visual = minimalLine('line-id', 'My line', 'a1');
    visual.startTime = 6;
    const items = new Map<string, SceneItem>([['line-id', visual]]);
    const audioClip = track({
      id: 'a1',
      text: 'hi',
      startTime: 8,
      duration: 4,
    });
    const list = listBoundAudioPlaybackMarkers(items, [audioClip]);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('line-id__audio_marker__a1');
    expect(list[0]!.visualItemId).toBe('line-id');
    expect(list[0]!.audioTrack.id).toBe('a1');
    expect(list[0]!.playbackStart).toBe(6);
  });

  it('early narration playback uses track timeline start', () => {
    const visual = minimalLine('l', 'Late visual', 'a1');
    visual.startTime = 12;
    const items = new Map<string, SceneItem>([['l', visual]]);
    const audioClip = track({
      id: 'a1',
      text: '',
      startTime: 2,
      duration: 3,
    });
    const list = listBoundAudioPlaybackMarkers(items, [audioClip]);
    expect(list).toHaveLength(1);
    expect(list[0]!.playbackStart).toBe(2);
  });

  it('does not emit markers for auto/null/none/orphan bindings', () => {
    const autoBind = minimalLine('a', '', null);
    const noneBind = minimalLine('b', '', AUDIO_BINDING_NONE);
    const orphan = minimalLine('c', '', 'missing');
    const items = new Map<string, SceneItem>([
      ['a', autoBind],
      ['b', noneBind],
      ['c', orphan],
    ]);
    expect(
      listBoundAudioPlaybackMarkers(items, [
        track({ id: 'x', text: '', startTime: 0, duration: 1 }),
      ]),
    ).toEqual([]);
  });
});
