import { describe, expect, it } from 'vitest';
import { buildPreviewState } from './previewSelectors';
import type { CameraMoveItem } from '@/types/scene';

const cam: CameraMoveItem = { id: 'c1', kind: 'camera_move', label: 'Zoom', layer: 0, startTime: 5, duration: 1, targetFrameId: 'f1', targetWidth: 4 };

describe('camera proposal preview', () => {
  it('keeps CREATE/UPDATE/DELETE virtual and marks camera operations', () => {
    const created = buildPreviewState(new Map(), [{ action: 'CREATE', item: cam }]);
    expect(created.mergedItems.get('c1')).toEqual(cam);
    expect(created.ops.get('c1')).toBe('create');
    expect(buildPreviewState(new Map([['c1', cam]]), [{ action: 'UPDATE', itemId: 'c1', updates: { targetWidth: 3 } }]).mergedItems.get('c1')).toMatchObject({ targetWidth: 3 });
    const deleted = buildPreviewState(new Map([['c1', cam]]), [{ action: 'DELETE', itemId: 'c1' }]);
    expect(deleted.mergedItems.has('c1')).toBe(true);
    expect(deleted.ops.get('c1')).toBe('delete');
  });
});
