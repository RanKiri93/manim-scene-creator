import type { AudioTrackItem, FrameDef, ItemId, MeasureResult, SceneDefaults, SceneItem, TextLineItem } from '@/types/scene';
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

/** Measures one text line with the measure server (null when it could not be measured). */
export type MeasureText = (item: TextLineItem) => Promise<MeasureResult | null>;

/** What a text line's measure depends on. */
function measureKey(item: TextLineItem): string {
  return JSON.stringify([
    item.raw,
    item.font,
    item.fontSize,
    item.baseDir ?? 'rtl',
    item.englishFont ?? '',
    item.segments.map((s) => [s.bold, s.italic]),
  ]);
}

/**
 * The Copilot's working draft for one turn: an ordered action list that always validates as a
 * whole against the base scene. A failed proposal leaves the draft unchanged.
 */
export class DraftSession {
  readonly base: DraftBase;
  private raw: unknown[] = [];
  private normalized: AgentAction[] = [];
  private lastWarnings: string[] = [];
  /** Measures of draft text lines, by `measureKey`. Kept across proposals and resets. */
  private measures = new Map<string, MeasureResult | null>();

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
    const scene = virtualSceneAfter(this.base.items, this.normalized, this.base.defaults);
    for (const [id, item] of scene) {
      if (item.kind !== 'textLine' || item.measure) continue;
      const measure = this.measures.get(measureKey(item));
      if (measure) scene.set(id, { ...item, measure, segmentMeasures: measure.segmentMeasures, mathChildMeasures: measure.mathChildMeasures });
    }
    return scene;
  }

  /**
   * Measure the draft's text lines that have no measure yet (new lines, changed source), so
   * positions and sizes are real. Returns how many still have none.
   */
  async measureText(measure: MeasureText): Promise<number> {
    const pending = new Map<string, TextLineItem>();
    for (const item of this.scene().values()) {
      if (item.kind !== 'textLine' || item.measure || !item.raw.trim()) continue;
      const key = measureKey(item);
      if (!this.measures.has(key)) pending.set(key, item);
    }
    await Promise.all(
      [...pending].map(async ([key, item]) => {
        let result: MeasureResult | null = null;
        try {
          result = await measure(item);
        } catch {
          result = null;
        }
        this.measures.set(key, result);
      }),
    );
    let unmeasured = 0;
    for (const item of this.scene().values()) if (item.kind === 'textLine' && !item.measure) unmeasured += 1;
    return unmeasured;
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
    }, { allowStyleAfterCreate: true });
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
