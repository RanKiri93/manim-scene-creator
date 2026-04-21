import { computeInkCorrectiveShift } from '@/lib/nextToGeometry';
import { resolvePosition, resolvePositionBeforeStep } from '@/lib/resolvePosition';
import type { ItemId, PosStepNextTo, SceneItem, TextLineItem } from '@/types/scene';

/**
 * Python `next_to` line(s): optional `aligned_edge`, segment target/self, ink corrective `shift`.
 */
export function emitNextToPython(params: {
  varName: string;
  step: PosStepNextTo;
  refVar: string;
  item: SceneItem;
  refItem: SceneItem;
  itemsMap: Map<ItemId, SceneItem>;
  /** Index of `step` inside `item.posSteps` (for partial position). */
  stepIndex: number;
  indent: string;
}): string {
  const { varName, step, refVar, item, refItem, itemsMap, stepIndex, indent } = params;

  let target = refVar;
  if (step.refSegmentIndex != null && refItem.kind === 'textLine') {
    target = `${refVar}[${step.refSegmentIndex}]`;
  }

  const kwParts: string[] = [`buff=${step.buff}`];
  if (step.alignedEdge) {
    kwParts.push(`aligned_edge=${step.alignedEdge}`);
  }
  if (step.selfSegmentIndex != null && item.kind === 'textLine') {
    kwParts.push(`submobject_to_align=${varName}[${step.selfSegmentIndex}]`);
  }
  const kw = kwParts.join(', ');
  const lines: string[] = [`${indent}${varName}.next_to(${target}, ${step.dir}, ${kw})`];

  if (step.bounds === 'ink' && item.kind === 'textLine') {
    const selfBefore = resolvePositionBeforeStep(item, itemsMap, stepIndex);
    const refResolved = resolvePosition(refItem, itemsMap);
    const { dx, dy } = computeInkCorrectiveShift({
      selfMobBefore: selfBefore,
      selfItem: item as TextLineItem,
      refMobX: refResolved.x,
      refMobY: refResolved.y,
      refItem,
      step,
    });
    if (Math.abs(dx) > 1e-8 || Math.abs(dy) > 1e-8) {
      lines.push(`${indent}${varName}.shift(${dx}*RIGHT + ${dy}*UP)`);
    }
  }

  return lines.join('\n');
}
