import { describe, expect, it } from 'vitest';
import type { PosStep } from '@/types/scene';
import { appendCenterXStep, inkEdgeSteps, updateAxisStep } from './quickLayout';

describe('inkEdgeSteps', () => {
  it('returns a single to_edge step with ink bounds', () => {
    expect(inkEdgeSteps('RIGHT', 0.3)).toEqual([
      { kind: 'to_edge', edge: 'RIGHT', buff: 0.3, bounds: 'ink' },
    ]);
  });
});

describe('appendCenterXStep', () => {
  it('removes prior set_x and appends one centered set_x', () => {
    const steps: PosStep[] = [
      { kind: 'to_edge', edge: 'UP', buff: 0.5, bounds: 'ink' },
      { kind: 'set_x', x: 2 },
    ];
    expect(appendCenterXStep(steps)).toEqual([
      { kind: 'to_edge', edge: 'UP', buff: 0.5, bounds: 'ink' },
      { kind: 'set_x', x: 0 },
    ]);
  });

  it('returns only set_x when steps were empty', () => {
    expect(appendCenterXStep([])).toEqual([{ kind: 'set_x', x: 0 }]);
  });
});

describe('updateAxisStep', () => {
  it('updates the last set_x and keeps other steps', () => {
    const steps: PosStep[] = [
      { kind: 'to_edge', edge: 'UP', buff: 0.5, bounds: 'ink' },
      { kind: 'set_x', x: 0 },
    ];
    expect(updateAxisStep(steps, 'x', 1.5)).toEqual([
      { kind: 'to_edge', edge: 'UP', buff: 0.5, bounds: 'ink' },
      { kind: 'set_x', x: 1.5 },
    ]);
  });

  it('collapses duplicate set_x to one with the new value', () => {
    const mid: PosStep = {
      kind: 'next_to',
      refKind: 'shape',
      refId: 'a',
      dir: 'DOWN',
      buff: 0.2,
      alignedEdge: null,
      refSegmentIndex: null,
      selfSegmentIndex: null,
      bounds: null,
    };
    const steps: PosStep[] = [{ kind: 'set_x', x: 0 }, mid, { kind: 'set_x', x: 2 }];
    expect(updateAxisStep(steps, 'x', -3)).toEqual([mid, { kind: 'set_x', x: -3 }]);
  });

  it('returns null when no set_x so callers can update item.x only', () => {
    const steps: PosStep[] = [{ kind: 'to_edge', edge: 'RIGHT', buff: 0.3, bounds: 'ink' }];
    expect(updateAxisStep(steps, 'x', 1)).toBeNull();
  });

  it('updates set_y similarly', () => {
    const steps: PosStep[] = [
      { kind: 'set_x', x: 0 },
      { kind: 'set_y', y: 1 },
    ];
    expect(updateAxisStep(steps, 'y', -0.5)).toEqual([
      { kind: 'set_x', x: 0 },
      { kind: 'set_y', y: -0.5 },
    ]);
  });
});
