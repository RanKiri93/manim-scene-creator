import type { AudioTrackItem, FrameDef, ItemId, SceneDefaults, SceneItem } from '@/types/scene';
import type { AgentAction } from '../types';
import { validateAgentResponse, virtualSceneAfter } from '../validate';
import { resolveCameraRequests } from '../cameraRequests';

/** Scene snapshot the loop works against (frozen at request time). */
export interface DraftBase {
  items: Map<ItemId, SceneItem>;
  frames: FrameDef[];
  startFrameId: ItemId | null;
  activeFrameId: ItemId | null;
  defaults: SceneDefaults;
  audioItems: AudioTrackItem[];
  currentTimeSec: number;
}

export type ProposeResult =
  | { ok: true; added: AgentAction[]; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * The Copilot's working draft for one turn: an ordered action list that always validates as a
 * whole against the base scene. A failed proposal leaves the draft unchanged.
 */
export class DraftSession {
  readonly base: DraftBase;
  private raw: unknown[] = [];
  private normalized: AgentAction[] = [];
  private lastWarnings: string[] = [];

  constructor(base: DraftBase) {
    this.base = base;
  }

  get actions(): AgentAction[] {
    return this.normalized;
  }

  get warnings(): string[] {
    return this.lastWarnings;
  }

  /** Items as they would be after the draft. */
  scene(): Map<ItemId, SceneItem> {
    return virtualSceneAfter(this.base.items, this.normalized);
  }

  propose(rawActions: unknown[]): ProposeResult {
    const candidate = [...this.raw, ...rawActions];
    const resolved = resolveCameraRequests(
      { reply: 'draft', actions: structuredClone(candidate) },
      {
        currentTimeSec: this.base.currentTimeSec,
        items: this.base.items,
        frames: this.base.frames,
        startFrameId: this.base.startFrameId,
        activeFrameId: this.base.activeFrameId,
      },
    ) as { reply: string; actions: unknown[] };
    if (resolved.reply !== 'draft') return { ok: false, errors: [resolved.reply] };
    const result = validateAgentResponse(resolved, this.base.items, {
      frameIds: this.base.frames.map((f) => f.id),
      frames: this.base.frames,
      activeFrameId: this.base.activeFrameId,
      startFrameId: this.base.startFrameId,
    });
    if (!result.ok) {
      const offset = this.raw.length;
      return {
        ok: false,
        errors: offset
          ? [`The draft already holds ${offset} action(s) (actions[0..${offset - 1}]); your new actions start at actions[${offset}].`, ...result.errors]
          : result.errors,
      };
    }
    const before = this.normalized.length;
    this.raw = candidate;
    this.normalized = result.response.actions;
    this.lastWarnings = result.warnings;
    return { ok: true, added: this.normalized.slice(before), warnings: result.warnings };
  }

  reset(): void {
    this.raw = [];
    this.normalized = [];
    this.lastWarnings = [];
  }
}
