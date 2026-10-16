import { normalizeTransformMapping, transformSourceIds } from '@/lib/transformMapping';
import { exitVisualEndExclusive } from '@/lib/time';
import type { AnimStyle, ItemId, SceneItem, TextLineItem, TransformMapping } from '@/types/scene';

/*
 * Copilot support for equation steps: a text line that enters by morphing an earlier line
 * (`animStyle: "transform"` + `transformConfig`). Pairs map a segment of this (target) line to a
 * segment of the source line; unpaired source pieces fade out or stay, unpaired target pieces
 * fade or write in.
 */

const ANIM_STYLES: readonly AnimStyle[] = ['write', 'fade_in', 'transform'];

export function normalizeAnimStyle(v: unknown, path: string, errors: string[]): AnimStyle | undefined {
  if (v == null) return undefined;
  if (ANIM_STYLES.includes(v as AnimStyle)) return v as AnimStyle;
  errors.push(`${path} must be "write", "fade_in" or "transform".`);
  return undefined;
}

const index = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
};

/**
 * `transformConfig` from the model. Pairs come as `pairs: [{ from: <source index>, to: <this
 * line's index> }]` (preferred) or as the stored `segmentPairs: { "<to>": <from> }`.
 */
export function normalizeTransformConfig(raw: unknown, path: string, errors: string[]): TransformMapping | null {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`${path} must be an object { sourceLineId, mode, pairs, ... }.`);
    return null;
  }
  const tc = raw as Record<string, unknown>;
  const sourceLineId = typeof tc.sourceLineId === 'string' ? tc.sourceLineId.trim() : '';
  if (!sourceLineId) {
    errors.push(`${path}.sourceLineId is required (the line this one morphs from).`);
    return null;
  }
  const segmentPairs: Record<number, number> = {};
  if (Array.isArray(tc.pairs)) {
    tc.pairs.forEach((p, i) => {
      const row = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
      const from = index(row.from);
      const to = index(row.to);
      if (from == null || to == null) errors.push(`${path}.pairs[${i}] must be { from: <source segment index>, to: <this line's segment index> }.`);
      else if (to in segmentPairs) errors.push(`${path}.pairs: segment ${to} of this line is paired twice.`);
      else segmentPairs[to] = from;
    });
  } else if (tc.segmentPairs && typeof tc.segmentPairs === 'object') {
    for (const [key, value] of Object.entries(tc.segmentPairs as Record<string, unknown>)) {
      const to = index(key);
      const from = index(value);
      if (to == null || from == null) errors.push(`${path}.segmentPairs must map this line's segment index to a source segment index.`);
      else segmentPairs[to] = from;
    }
  }
  const sourceLineIds = Array.isArray(tc.sourceLineIds)
    ? tc.sourceLineIds.filter((id): id is string => typeof id === 'string' && !!id)
    : undefined;
  return normalizeTransformMapping({
    sourceLineId,
    sourceLineIds,
    mode: tc.mode === 'whole' ? 'whole' : 'segments',
    segmentPairs,
    unmappedSourceBehavior: tc.unmappedSourceBehavior === 'leave' ? 'leave' : 'fade_out',
    unmappedTargetBehavior: tc.unmappedTargetBehavior === 'write' ? 'write' : 'fade_in',
  });
}

const quote = (line: TextLineItem, i: number) => JSON.stringify(line.segments[i]?.text ?? '');
const segList = (line: TextLineItem) => line.segments.map((seg, i) => `${i}: ${JSON.stringify(seg.text)}`).join(', ');

/** Check every transform line the draft touches against the scene it produces. */
export function checkTextTransforms(
  scene: Map<ItemId, SceneItem>,
  ids: Iterable<ItemId>,
  errors: string[],
  warnings: string[],
): void {
  for (const id of ids) {
    const line = scene.get(id);
    if (line?.kind !== 'textLine') continue;
    const tc = line.transformConfig;
    if (line.animStyle !== 'transform') continue;
    const at = `textLine "${id}"`;
    if (!tc) {
      errors.push(`${at} has animStyle "transform" but no transformConfig (which line it morphs from).`);
      continue;
    }
    for (const sourceId of transformSourceIds(tc)) {
      const source = scene.get(sourceId);
      if (source?.kind !== 'textLine') {
        errors.push(`${at}: transform source "${sourceId}" is not a text line in the scene.`);
        continue;
      }
      if (sourceId === id) {
        errors.push(`${at} cannot morph from itself.`);
        continue;
      }
      const ready = source.startTime + source.duration;
      if (line.startTime + 1e-6 < ready) {
        errors.push(`${at} starts at ${line.startTime}s, before its source "${sourceId}" has finished appearing (${+ready.toFixed(3)}s).`);
      }
      const gone = exitVisualEndExclusive(sourceId, scene);
      if (gone != null && gone <= line.startTime + 1e-6) {
        errors.push(`${at}: its source "${sourceId}" has already left the scene (exit ends at ${+gone.toFixed(3)}s).`);
      }
    }
    if ((tc.mode ?? 'segments') !== 'segments') continue;
    const source = scene.get(tc.sourceLineId);
    if (source?.kind !== 'textLine') continue;
    const used = new Map<number, number>();
    for (const [toKey, from] of Object.entries(tc.segmentPairs)) {
      const to = Number(toKey);
      if (to >= line.segments.length) {
        errors.push(`${at}: pair to ${to} — this line has no segment ${to} (segments ${segList(line)}).`);
      }
      if (from >= source.segments.length) {
        errors.push(`${at}: pair from ${from} — source "${source.id}" has no segment ${from} (segments ${segList(source)}).`);
      } else if (used.has(from)) {
        errors.push(`${at}: source segment ${from} ${quote(source, from)} is paired with both ${used.get(from)} and ${to}; each source piece can move to one place.`);
      } else used.set(from, to);
    }
    if (!Object.keys(tc.segmentPairs).length) {
      warnings.push(`${at}: segment transform with no pairs; every piece fades. Pair equal terms, or use mode "whole".`);
    }
  }
}

/** For inspect: what moves where in a transform line, with each piece's text. */
export function transformFacts(line: TextLineItem, scene: Map<ItemId, SceneItem>): Record<string, unknown> | null {
  if (line.animStyle !== 'transform' || !line.transformConfig) return null;
  const tc = line.transformConfig;
  const mode = tc.mode ?? 'segments';
  if (mode === 'whole') return { from: transformSourceIds(tc), mode };
  const source = scene.get(tc.sourceLineId);
  if (source?.kind !== 'textLine') return { from: tc.sourceLineId, mode, error: 'source is not a text line' };
  const norm = (s: string) => s.replace(/\{\}|\\[,;:!]|\s+/g, '');
  const pairs = Object.entries(tc.segmentPairs).map(([to, from]) => {
    const a = source.segments[from]?.text ?? '?';
    const b = line.segments[Number(to)]?.text ?? '?';
    return { from, to: Number(to), text: norm(a) === norm(b) ? a : `${a} → ${b}` };
  });
  const mappedFrom = new Set(Object.values(tc.segmentPairs));
  const mappedTo = new Set(Object.keys(tc.segmentPairs).map(Number));
  return {
    from: source.id,
    mode,
    pairs,
    [tc.unmappedSourceBehavior === 'leave' ? 'sourceStays' : 'sourceFadesOut']: source.segments
      .map((seg, i) => (mappedFrom.has(i) ? null : `${i}: ${seg.text}`))
      .filter(Boolean),
    [tc.unmappedTargetBehavior === 'write' ? 'writtenIn' : 'fadesIn']: line.segments
      .map((seg, i) => (mappedTo.has(i) ? null : `${i}: ${seg.text}`))
      .filter(Boolean),
  };
}
