import { describe, expect, it } from 'vitest';
import { FRAME_W } from '@/lib/constants';
import type { CameraMoveItem } from '@/types/scene';
import { summarizeCameraProposal } from './cameraProposalSummary';

const camera = (id: string, startTime: number, targetWidth: number, label: string): CameraMoveItem => ({
  id, kind: 'camera_move', label, layer: 0, startTime, duration: 1,
  targetFrameId: 'frame-he', targetWidth,
});

describe('summarizeCameraProposal', () => {
  it('uses the shared schedule for override and return timing and resolves frame labels', () => {
    const proposed = { ...camera('proposed', 5, 4, 'זום'), duration: 5 };
    const existingReturn = camera('return', 9, FRAME_W, 'חזרה');
    const existingOverride = camera('later', 7, 3, 'המשך');
    const result = summarizeCameraProposal(
      [{ action: 'CREATE', item: proposed }],
      new Map([[existingReturn.id, existingReturn], [existingOverride.id, existingOverride]]),
      [{ id: 'frame-he', col: 0, row: 0, label: 'מסגרת א' }],
      'frame-he',
    );
    expect(result).toEqual([expect.objectContaining({
      clip: proposed,
      frameLabel: 'מסגרת א',
      overrideLabel: 'המשך',
      overrideTime: 7,
      returnStart: 9,
      returnEnd: 10,
      targetWidth: 4,
    })]);
  });

  it('summarizes camera UPDATEs as virtual replacements, not duplicate schedule items', () => {
    const original = camera('cam', 2, 4, 'Before');
    const [summary] = summarizeCameraProposal(
      [{ action: 'UPDATE', itemId: 'cam', updates: { label: 'After', duration: 2 } }],
      new Map([[original.id, original]]),
      [{ id: 'frame-he', col: 0, row: 0 }],
      'frame-he',
    );
    expect(summary?.clip).toMatchObject({ id: 'cam', label: 'After', duration: 2 });
    expect(summary?.overrideLabel).toBeNull();
  });

  it('includes same-response zoom and full-frame return CREATEs in one virtual schedule', () => {
    const zoom = { ...camera('zoom', 5, 4, 'Zoom'), duration: 1 };
    const back = camera('back', 9, FRAME_W, 'Return');
    const summaries = summarizeCameraProposal(
      [{ action: 'CREATE', item: zoom }, { action: 'CREATE', item: back }],
      new Map(),
      [{ id: 'frame-he', col: 0, row: 0, label: 'מסגרת א' }],
      'frame-he',
    );
    expect(summaries.find((summary) => summary.clip.id === 'zoom')).toMatchObject({ returnStart: 9, returnEnd: 10 });
  });

  it('applies sibling schedule UPDATEs and DELETEs before deriving an override', () => {
    const zoom = { ...camera('zoom', 5, 4, 'Zoom'), duration: 5 };
    const later = camera('later', 7, 3, 'Later zoom');
    const frames = [{ id: 'frame-he', col: 0, row: 0 }];

    const updated = summarizeCameraProposal(
      [
        { action: 'CREATE', item: zoom },
        { action: 'UPDATE', itemId: 'later', updates: { startTime: 8 } },
      ],
      new Map([[later.id, later]]),
      frames,
      'frame-he',
    );
    expect(updated.find((summary) => summary.clip.id === 'zoom')).toMatchObject({ overrideLabel: 'Later zoom', overrideTime: 8 });

    const deleted = summarizeCameraProposal(
      [
        { action: 'CREATE', item: zoom },
        { action: 'DELETE', itemId: 'later' },
      ],
      new Map([[later.id, later]]),
      frames,
      'frame-he',
    );
    expect(deleted.find((summary) => summary.clip.id === 'zoom')).toMatchObject({ overrideLabel: null, overrideTime: null });
  });

  it('uses shared camera display-name fallbacks for unlabeled region, frame, and override clips', () => {
    const proposed = { ...camera('region', 5, 4, ''), duration: 5 };
    const fullFrameOverride = camera('frame', 7, FRAME_W, '');
    const [summary] = summarizeCameraProposal(
      [{ action: 'CREATE', item: proposed }],
      new Map([[fullFrameOverride.id, fullFrameOverride]]),
      [{ id: 'frame-he', col: 0, row: 0 }],
      'frame-he',
    );
    expect(summary).toMatchObject({
      displayName: 'Zoom to region',
      frameLabel: 'frame-he',
      overrideLabel: 'Zoom to frame',
      overrideTime: 7,
    });
  });
});
