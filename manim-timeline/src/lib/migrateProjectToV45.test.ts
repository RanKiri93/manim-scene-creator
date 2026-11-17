import { describe, expect, it } from 'vitest';
import { defaultSceneDefaults } from '@/store/factories';
import { migrateSceneDefaultsToV45 } from './migrateProjectToV45';
import { markerName, remapMarkers, withMarkerAt } from './timelineMarkers';

describe('v45 timeline markers', () => {
  it('backfills an empty marker list for older scenes', () => {
    const legacy = { ...defaultSceneDefaults() };
    delete legacy.timelineMarkers;
    expect(migrateSceneDefaultsToV45(legacy).timelineMarkers).toEqual([]);
  });

  it('keeps valid markers sorted, drops broken ones, and is idempotent', () => {
    const d = { ...defaultSceneDefaults(), timelineMarkers: [
      { id: 'b', time: 3 },
      { id: 'a', time: 1, label: ' intro ' },
      { id: 'a', time: 9 },
      { id: 'bad', time: -1 },
      { id: 'nan', time: Number.NaN },
    ] };
    const once = migrateSceneDefaultsToV45(d);
    expect(once.timelineMarkers).toEqual([{ id: 'a', time: 1, label: 'intro' }, { id: 'b', time: 3 }]);
    expect(migrateSceneDefaultsToV45(once)).toEqual(once);
  });
});

describe('timeline marker rules', () => {
  const markers = [{ id: 'a', time: 1 }, { id: 'b', time: 4 }];
  it('adds a marker unless one is already there', () => {
    expect(withMarkerAt(markers, 2.5, 'c')?.map((m) => m.id)).toEqual(['a', 'c', 'b']);
    expect(withMarkerAt(markers, 1.02, 'c')).toBeNull();
    expect(withMarkerAt(markers, -1, 'c')).toBeNull();
  });

  it('moves with a time edit and merges markers that land together', () => {
    const closed = remapMarkers([...markers, { id: 'c', time: 2 }], (t) => (t <= 1 ? t : t >= 3 ? t - 2 : 1));
    expect(closed).toEqual([{ id: 'a', time: 1 }, { id: 'b', time: 2 }]);
  });

  it('names unlabeled markers M1, M2… by time', () => {
    expect(markerName(markers, markers[1]!)).toBe('M2');
    expect(markerName([{ id: 'x', time: 0, label: 'Q' }], { id: 'x', time: 0, label: 'Q' })).toBe('Q');
  });
});
