import { applyTimelineEdit, type TimelineEdit } from '@/lib/timelineSurgery';
import { applyAudioEdit, describeAudioEdit } from './audioEdits';
import type { AudioTrackItem, ItemId, SceneItem } from '@/types/scene';
import type { AgentAction } from './types';

/*
 * Copilot `TIMELINE` actions: insert empty time, remove an empty range, or scale a range. They run
 * the editor's own planners (`lib/timelineSurgery.ts`), so the same edits are allowed and blocked.
 */

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const s2 = (n: number) => `${+n.toFixed(2)}s`;

/** The edit from a TIMELINE action (`edit`, or the fields on the action itself). */
export function normalizeTimelineEdit(raw: Record<string, unknown>, path: string, errors: string[]): TimelineEdit | null {
  const e = raw.edit && typeof raw.edit === 'object' ? (raw.edit as Record<string, unknown>) : raw;
  switch (e.op) {
    case 'insert': {
      const at = num(e.at);
      const seconds = num(e.seconds ?? e.duration);
      if (Number.isNaN(at) || Number.isNaN(seconds)) {
        errors.push(`${path}: insert needs numbers at (scene time) and seconds (how much to add).`);
        return null;
      }
      return { op: 'insert', at, seconds };
    }
    case 'remove': {
      const from = num(e.from);
      const to = num(e.to);
      if (Number.isNaN(from) || Number.isNaN(to)) {
        errors.push(`${path}: remove needs numbers from and to.`);
        return null;
      }
      return { op: 'remove', from, to };
    }
    case 'scale': {
      const from = num(e.from);
      const to = num(e.to);
      const factor = num(e.factor);
      if ([from, to, factor].some(Number.isNaN)) {
        errors.push(`${path}: scale needs numbers from, to and factor.`);
        return null;
      }
      return { op: 'scale', from, to, factor };
    }
    default:
      errors.push(`${path}.edit.op must be "insert", "remove" or "scale".`);
      return null;
  }
}

/** One line for logs, history and the proposal list. */
export function describeTimelineEdit(edit: TimelineEdit): string {
  if (edit.op === 'insert') return `insert ${s2(edit.seconds)} at ${s2(edit.at)}`;
  if (edit.op === 'remove') return `remove ${s2(edit.from)}–${s2(edit.to)}`;
  const pct = Math.round((edit.factor - 1) * 100);
  return `scale ${s2(edit.from)}–${s2(edit.to)} ×${edit.factor} (${pct >= 0 ? `${pct}% slower` : `${-pct}% faster`})`;
}

/**
 * Run the actions in order on copies of the scene and its audio and report each TIMELINE edit the
 * editor would refuse, naming the clips in the way.
 */
export function checkTimelineEdits(
  currentItems: ReadonlyMap<ItemId, SceneItem>,
  audioItems: readonly AudioTrackItem[],
  actions: readonly AgentAction[],
  errors: string[],
): void {
  if (!actions.some((a) => a.action === 'TIMELINE' || a.action === 'AUDIO')) return;
  let items = new Map(currentItems);
  let audio = [...audioItems];
  actions.forEach((action, i) => {
    if (action.action === 'CREATE') items.set(action.item.id, action.item);
    else if (action.action === 'UPDATE') {
      const previous = items.get(action.itemId);
      if (previous) items.set(action.itemId, { ...previous, ...action.updates } as SceneItem);
    } else if (action.action === 'DELETE') items.delete(action.itemId);
    else if (action.action === 'AUDIO') {
      const result = applyAudioEdit(items, audio, action.edit);
      if (!result.ok) {
        errors.push(`actions[${i}] AUDIO ${describeAudioEdit(action.edit)}: ${result.error}`);
        return;
      }
      items = result.items;
      audio = result.audioItems;
    } else {
      const result = applyTimelineEdit(items, audio, action.edit);
      if (!result.ok) {
        const blockers = result.blockers.map((b) => `${b.kind === 'audio' ? 'narration' : 'clip'} "${b.label}" (${b.id}) ${s2(b.start)}–${s2(b.end)}`);
        errors.push(`actions[${i}] TIMELINE ${describeTimelineEdit(action.edit)}: ${result.error}${blockers.length ? ` In the way: ${blockers.join('; ')}.` : ''}`);
        return;
      }
      items = result.items;
      audio = result.audioItems;
    }
  });
}
