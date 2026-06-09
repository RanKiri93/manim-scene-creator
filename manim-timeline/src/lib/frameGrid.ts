import { FRAME_W, FRAME_H } from '@/lib/constants';
import { newId } from '@/lib/ids';
import type { FrameDef, ItemId, SceneItem } from '@/types/scene';

export const DEFAULT_FRAME_LABEL = 'Frame 1';

export function createDefaultFrame(): FrameDef {
  return {
    id: newId(),
    col: 0,
    row: 0,
    label: DEFAULT_FRAME_LABEL,
  };
}

export function frameCenter(frame: FrameDef): { x: number; y: number } {
  return {
    x: frame.col * FRAME_W,
    y: -frame.row * FRAME_H,
  };
}

export function frameCenterById(
  frames: readonly FrameDef[],
  frameId: ItemId | null | undefined,
): { x: number; y: number } {
  const frame = frames.find((f) => f.id === frameId) ?? frames[0];
  return frame ? frameCenter(frame) : { x: 0, y: 0 };
}

export function frameAtCell(
  frames: readonly FrameDef[],
  col: number,
  row: number,
): FrameDef | null {
  return frames.find((f) => f.col === col && f.row === row) ?? null;
}

export function frameDisplayName(
  frame: FrameDef | undefined,
  frames: readonly FrameDef[],
): string {
  if (!frame) return 'Frame';
  const trimmed = frame.label?.trim();
  if (trimmed) return trimmed;
  const sorted = readingOrderFrames(frames);
  const idx = sorted.findIndex((f) => f.id === frame.id);
  return idx >= 0 ? `Frame ${idx + 1}` : `Frame (${frame.col}, ${frame.row})`;
}

/** RTL reading order: top-to-bottom by row, right-to-left within each row. */
export function readingOrderFrames(frames: readonly FrameDef[]): FrameDef[] {
  return [...frames].sort((a, b) => a.row - b.row || b.col - a.col || a.id.localeCompare(b.id));
}

/**
 * Frame an item belongs to for filtering/targeting purposes.
 * Drawables carry `frameId`; camera moves use their target frame; effect clips
 * follow their first target. `fallbackFrameId` preserves legacy home-frame items.
 */
export function associatedFrameId(
  item: SceneItem,
  items: ReadonlyMap<ItemId, SceneItem>,
  fallbackFrameId: ItemId | null | undefined,
  depth = 0,
): ItemId | null {
  if ('frameId' in item && item.frameId) return item.frameId;
  if (item.kind === 'camera_move') return item.targetFrameId ?? fallbackFrameId ?? null;
  if (depth > 4) return fallbackFrameId ?? null;
  const targetId =
    item.kind === 'exit_animation' ||
    item.kind === 'blink_animation' ||
    item.kind === 'target_animation'
      ? item.targets[0]?.targetId
      : item.kind === 'surroundingRect'
        ? item.targetIds[0]
        : undefined;
  if (targetId) {
    const target = items.get(targetId);
    if (target) return associatedFrameId(target, items, fallbackFrameId, depth + 1);
  }
  return fallbackFrameId ?? null;
}

export function ensureFrameConfig(
  framesIn: readonly FrameDef[] | null | undefined,
  startFrameIdIn: ItemId | null | undefined,
): { frames: FrameDef[]; startFrameId: ItemId } {
  const seen = new Set<ItemId>();
  const frames: FrameDef[] = [];
  for (const raw of framesIn ?? []) {
    if (!raw || typeof raw.id !== 'string' || raw.id.trim() === '') continue;
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    frames.push({
      id: raw.id,
      col: Number.isFinite(raw.col) ? Math.trunc(raw.col) : 0,
      row: Number.isFinite(raw.row) ? Math.trunc(raw.row) : 0,
      label: typeof raw.label === 'string' ? raw.label : undefined,
    });
  }
  if (frames.length === 0) {
    const home = createDefaultFrame();
    return { frames: [home], startFrameId: home.id };
  }
  const startFrameId = frames.some((f) => f.id === startFrameIdIn)
    ? startFrameIdIn!
    : frames[0]!.id;
  return { frames, startFrameId };
}

export function normalizeItemFrameIdsInPlace(
  items: SceneItem[],
  frames: readonly FrameDef[],
  fallbackFrameId: ItemId,
): void {
  const valid = new Set(frames.map((f) => f.id));
  for (const item of items) {
    if (
      item.kind === 'exit_animation' ||
      item.kind === 'blink_animation' ||
      item.kind === 'target_animation' ||
      item.kind === 'camera_move' ||
      item.kind === 'surroundingRect'
    ) {
      continue;
    }
    if (!('frameId' in item) || !item.frameId || !valid.has(item.frameId)) {
      item.frameId = fallbackFrameId;
    }
  }
}

export function cameraTargetPoint(
  frames: readonly FrameDef[],
  targetFrameId: ItemId,
  offsetX = 0,
  offsetY = 0,
): { x: number; y: number } {
  const c = frameCenterById(frames, targetFrameId);
  return { x: c.x + offsetX, y: c.y + offsetY };
}
