import type { ManimDirection, PosStep } from '@/types/scene';

export type ToEdgeCardinal = Extract<ManimDirection, 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'>;

export function inkEdgeSteps(edge: ToEdgeCardinal, buff: number): PosStep[] {
  return [{ kind: 'to_edge', edge, buff, bounds: 'ink' }];
}

export function appendCenterXStep(steps: PosStep[]): PosStep[] {
  const withoutSetX = steps.filter((step) => step.kind !== 'set_x');
  return [...withoutSetX, { kind: 'set_x', x: 0 }];
}

/** When manual X/Y edits should match an existing set_x/set_y step, or null if none. */
export function updateAxisStep(
  steps: PosStep[],
  axis: 'x' | 'y',
  value: number,
): PosStep[] | null {
  const kind = axis === 'x' ? 'set_x' : 'set_y';
  const lastIndex = steps.findLastIndex((step) => step.kind === kind);
  if (lastIndex < 0) return null;
  const filtered = steps.filter((step, i) => step.kind !== kind || i === lastIndex);
  return filtered.map((step) =>
    step.kind === kind
      ? axis === 'x'
        ? { kind: 'set_x', x: value }
        : { kind: 'set_y', y: value }
      : step,
  );
}
