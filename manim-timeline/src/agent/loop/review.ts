import type { ItemId, SceneItem } from '@/types/scene';
import { exportManimCode } from '@/codegen/manimExporter';
import { findUnwrappedForeignRuns } from '@/lib/textDirectionLint';
import { effectiveEnd, effectiveStart } from '@/lib/time';
import type { DraftSession } from './draft';
import { inspectDraft } from './inspect';

/** One thing that does not look right, with where and when. */
export interface ReviewFinding {
  kind: 'offscreen' | 'textOverlap' | 'lowContrast' | 'unwrappedText' | 'idleGap' | 'exportError';
  /** Items involved (one, or two for an overlap). */
  itemIds?: ItemId[];
  /** Scene time it was seen at, or the [from, to] of a gap. */
  time?: number;
  range?: [number, number];
  message: string;
}

/** Contrast against the black Manim background below which a colour is hard to read (WCAG: 3:1 for text and graphics alike at video sizes). */
export const MIN_TEXT_CONTRAST = 3;
export const MIN_LINE_CONTRAST = 3;
/** A stretch this long with nothing animating and no narration reads as a stall. */
export const IDLE_GAP_SEC = 4;
const MAX_FINDINGS = 30;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** WCAG contrast ratio of a hex colour against black (1 = invisible, 21 = white). */
export function contrastOnBlack(hex: string): number | null {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return (l + 0.05) / 0.05;
}

/** Colours an item draws its lines or text with, and the contrast each needs. */
function itemColours(item: SceneItem): { colour: string; what: string; min: number }[] {
  switch (item.kind) {
    case 'textLine':
      return item.segments.filter((s) => s.text.trim() && s.color).map((s) => ({ colour: s.color, what: `text "${s.text.trim().slice(0, 20)}"`, min: MIN_TEXT_CONTRAST }));
    case 'shape':
      return item.strokeWidth > 0 ? [{ colour: item.strokeColor, what: 'outline', min: MIN_LINE_CONTRAST }] : [];
    case 'graphPlot':
      return [{ colour: item.fn.color, what: 'curve', min: MIN_LINE_CONTRAST }];
    case 'graphDot':
      return [{ colour: item.dot.color, what: 'dot', min: MIN_LINE_CONTRAST }];
    default:
      return [];
  }
}

/** Times worth looking at: when each clip has finished entering, and just before it leaves. */
function reviewTimes(scene: Map<ItemId, SceneItem>, sceneEnd: number): number[] {
  const times = new Set<number>();
  for (const item of scene.values()) {
    if (!('posSteps' in item)) continue;
    const start = effectiveStart(item, scene);
    const entered = start + ('duration' in item ? item.duration : 0);
    const end = Math.min(effectiveEnd(item, scene), sceneEnd);
    if (entered <= sceneEnd) times.add(r3(entered));
    if (Number.isFinite(end) && end - 0.05 > entered) times.add(r3(end - 0.05));
  }
  return [...times].sort((a, b) => a - b);
}

/** Stretches of at least `IDLE_GAP_SEC` where no clip animates and no narration plays. */
function idleGaps(scene: Map<ItemId, SceneItem>, session: DraftSession, sceneEnd: number): [number, number][] {
  const busy: [number, number][] = [];
  for (const item of scene.values()) {
    if (!('startTime' in item) || !('duration' in item)) continue;
    const s = effectiveStart(item, scene);
    busy.push([s, s + Math.max(0, item.duration)]);
  }
  for (const a of session.audio()) busy.push([a.startTime, a.startTime + Math.max(0, a.duration)]);
  busy.sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const [s, e] of busy) {
    if (s - cursor >= IDLE_GAP_SEC) gaps.push([r3(cursor), r3(s)]);
    cursor = Math.max(cursor, e);
  }
  if (sceneEnd - cursor >= IDLE_GAP_SEC) gaps.push([r3(cursor), r3(sceneEnd)]);
  return gaps;
}

/**
 * Look over the whole draft scene the way a viewer would: things off camera or overlapping when
 * they are on screen, colours too dark on the black background, English or Hebrew not wrapped
 * for the line's direction, long stalls, and export errors. Uses the same resolvers as
 * `inspect_scene` and `check_export`.
 */
export function reviewScene(session: DraftSession, input: { times?: unknown } = {}): { findings: ReviewFinding[]; checkedTimes: number[]; sceneDurationSec: number } {
  const scene = session.scene();
  const first = inspectDraft(session, { times: [0], itemIds: [] });
  const sceneEnd = Number(first.sceneDurationSec) || 0;
  const times = Array.isArray(input.times)
    ? input.times.filter((t): t is number => typeof t === 'number' && Number.isFinite(t)).map(r3)
    : reviewTimes(scene, sceneEnd);
  const findings: ReviewFinding[] = [];
  const push = (f: ReviewFinding) => {
    if (findings.length < MAX_FINDINGS) findings.push(f);
  };

  // Off camera / overlapping, in batches of 8 times (inspect's limit), first time seen per item.
  const offSeen = new Set<ItemId>();
  const overlapSeen = new Set<string>();
  const ids = [...scene.keys()];
  for (let i = 0; i < times.length; i += 8) {
    const batch = times.slice(i, i + 8);
    for (let j = 0; j < ids.length; j += 30) {
      const facts = inspectDraft(session, { times: batch, itemIds: ids.slice(j, j + 30) });
      for (const item of facts.items as { id: string; label?: string; at?: Record<string, unknown>[] }[]) {
        for (const row of item.at ?? []) {
          if (!row.onScreen || row.inCamera !== false || offSeen.has(item.id)) continue;
          offSeen.add(item.id);
          push({ kind: 'offscreen', itemIds: [item.id], time: row.t as number, message: `"${item.label || item.id}" is partly outside the camera (${(row.outside as string[]).join(', ')}) at ${row.t}s.` });
        }
      }
      if (j === 0) {
        for (const o of facts.textOverlaps as { t: number; ids: [string, string] }[]) {
          const key = [...o.ids].sort().join('|');
          if (overlapSeen.has(key)) continue;
          overlapSeen.add(key);
          push({ kind: 'textOverlap', itemIds: o.ids, time: o.t, message: `Text "${o.ids[0]}" and "${o.ids[1]}" overlap at ${o.t}s.` });
        }
      }
    }
  }

  for (const item of scene.values()) {
    for (const c of itemColours(item)) {
      const ratio = contrastOnBlack(c.colour);
      if (ratio != null && ratio < c.min) {
        push({ kind: 'lowContrast', itemIds: [item.id], message: `"${item.label || item.id}": ${c.what} in ${c.colour} is hard to see on black (contrast ${ratio.toFixed(1)}, want ${c.min}+).` });
        break;
      }
    }
    if (item.kind === 'textLine') {
      const runs = findUnwrappedForeignRuns(item.raw, item.baseDir ?? 'rtl');
      if (runs.length) {
        const wrap = item.baseDir === 'ltr' ? '\\he{…}' : '\\en{…}';
        push({ kind: 'unwrappedText', itemIds: [item.id], message: `"${item.label || item.id}": "${runs[0]!.text}" is in the other script and not wrapped in ${wrap}, so it may come out in the wrong order.` });
      }
    }
  }

  for (const [from, to] of idleGaps(scene, session, sceneEnd)) {
    push({ kind: 'idleGap', range: [from, to], message: `Nothing moves and nothing is said from ${from}s to ${to}s.` });
  }

  const code = exportManimCode([...scene.values()], {
    fullFile: false,
    defaults: session.base.defaults,
    audioItems: session.audio(),
    frames: [...session.base.frames],
    startFrameId: session.base.startFrameId ?? undefined,
  });
  for (const m of code.matchAll(/# EXPORT ERROR: (.*)/g)) push({ kind: 'exportError', message: m[1]!.trim() });

  return { findings, checkedTimes: times, sceneDurationSec: sceneEnd };
}
