import { frameDisplayName } from '@/lib/frameGrid';
import type { FrameDef, ItemId } from '@/types/scene';

/** Where a new frame goes, relative to an existing one (screen directions: up = row − 1). */
export const FRAME_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export type FrameDirection = (typeof FRAME_DIRECTIONS)[number];

/**
 * `FRAME` action after validation: add a camera-grid frame at a concrete cell, or rename one.
 * The model may give a new frame as a direction from another frame; that is resolved to a cell.
 */
export type AgentFrameEdit =
  | { op: 'add'; id: ItemId; col: number; row: number; label?: string }
  | { op: 'rename'; frameId: ItemId; label: string };

const STEP: Record<FrameDirection, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

export interface FramePlanContext {
  activeFrameId: ItemId | null;
  /** Ids already used by scene items (a new frame may not reuse one). */
  isItemId?: (id: string) => boolean;
}

/**
 * Normalize one raw FRAME edit against the frames as they are at that point of the proposal.
 * Returns the edit or a message the model can act on.
 */
export function normalizeFrameEdit(
  raw: unknown,
  frames: readonly FrameDef[],
  ctx: FramePlanContext,
): { edit: AgentFrameEdit } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'FRAME needs an `edit` object.' };
  const e = raw as Record<string, unknown>;
  const label = typeof e.label === 'string' ? e.label.trim() : undefined;
  if (e.op === 'rename') {
    const frameId = typeof e.frameId === 'string' ? e.frameId : '';
    if (!frames.some((f) => f.id === frameId)) return { error: `FRAME rename: "${frameId}" is not a frame (known: ${frames.map((f) => f.id).join(', ') || 'none'}).` };
    if (!label) return { error: 'FRAME rename needs a non-empty `label`.' };
    return { edit: { op: 'rename', frameId, label } };
  }
  if (e.op !== 'add') return { error: `FRAME edit op must be "add" or "rename", got "${String(e.op)}".` };

  const id = typeof e.id === 'string' ? e.id.trim() : '';
  if (!id) return { error: 'FRAME add needs a new `id`.' };
  if (frames.some((f) => f.id === id) || ctx.isItemId?.(id)) return { error: `FRAME add: id "${id}" is already used; pick a new one.` };

  let col: number;
  let row: number;
  if (typeof e.direction === 'string') {
    if (!(FRAME_DIRECTIONS as readonly string[]).includes(e.direction)) return { error: `FRAME add: direction must be one of ${FRAME_DIRECTIONS.join(', ')}.` };
    const fromId = typeof e.fromFrameId === 'string' && e.fromFrameId ? e.fromFrameId : ctx.activeFrameId;
    const from = frames.find((f) => f.id === fromId);
    if (!from) return { error: `FRAME add: fromFrameId "${String(fromId)}" is not a frame (known: ${frames.map((f) => f.id).join(', ') || 'none'}).` };
    const [dc, dr] = STEP[e.direction as FrameDirection];
    col = from.col + dc;
    row = from.row + dr;
  } else if (Number.isInteger(e.col) && Number.isInteger(e.row)) {
    col = e.col as number;
    row = e.row as number;
  } else {
    return { error: 'FRAME add needs `direction` (left / right / up / down, from `fromFrameId` or the active frame) or integer `col` and `row`.' };
  }
  const taken = frames.find((f) => f.col === col && f.row === row);
  if (taken) return { error: `FRAME add: cell (${col}, ${row}) already holds frame "${taken.id}" (${frameDisplayName(taken, frames)}). Use that frame instead of adding one.` };
  return { edit: { op: 'add', id, col, row, ...(label ? { label } : {}) } };
}

/** Frames after applying validated edits in order (pure; unknown renames are ignored). */
export function applyFrameEdits(frames: readonly FrameDef[], edits: readonly AgentFrameEdit[]): FrameDef[] {
  const out = frames.map((f) => ({ ...f }));
  for (const edit of edits) {
    if (edit.op === 'add') out.push({ id: edit.id, col: edit.col, row: edit.row, ...(edit.label ? { label: edit.label } : {}) });
    else {
      const frame = out.find((f) => f.id === edit.frameId);
      if (frame) frame.label = edit.label;
    }
  }
  return out;
}

/**
 * Walk a raw action list and plan every FRAME action in order. `edits` maps the action index to
 * its normalized edit, `errors` holds messages for the ones that failed, and `frames` is the frame
 * catalog with all valid edits applied (what later actions in the proposal may reference: the
 * commit adds frames before anything else).
 */
export function planFrameEdits(
  rawActions: readonly unknown[],
  frames: readonly FrameDef[],
  ctx: FramePlanContext,
): { edits: Map<number, AgentFrameEdit>; errors: Map<number, string>; frames: FrameDef[] } {
  const edits = new Map<number, AgentFrameEdit>();
  const errors = new Map<number, string>();
  let running = frames.map((f) => ({ ...f }));
  rawActions.forEach((action, i) => {
    if (!action || typeof action !== 'object' || (action as Record<string, unknown>).action !== 'FRAME') return;
    const result = normalizeFrameEdit((action as Record<string, unknown>).edit, running, ctx);
    if ('error' in result) {
      errors.set(i, result.error);
      return;
    }
    edits.set(i, result.edit);
    running = applyFrameEdits(running, [result.edit]);
  });
  return { edits, errors, frames: running };
}

/** Frames as a validated action list leaves them. */
export function framesAfterActions(
  frames: readonly FrameDef[],
  actions: readonly { action: string; edit?: unknown }[] | null | undefined,
): FrameDef[] {
  const edits = (actions ?? []).filter((a) => a.action === 'FRAME').map((a) => a.edit as AgentFrameEdit);
  return edits.length ? applyFrameEdits(frames, edits) : [...frames];
}

/** One-line description for the chat bubble and the loop history. */
export function describeFrameEdit(edit: AgentFrameEdit): string {
  if (edit.op === 'rename') return `rename ${edit.frameId} → "${edit.label}"`;
  return `add ${edit.label ? `"${edit.label}" ` : ''}(${edit.id}) at cell (${edit.col}, ${edit.row})`;
}
