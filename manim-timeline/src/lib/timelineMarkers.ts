import type { TimelineMarker } from '@/types/scene';

/** A new marker this close to an existing one (seconds) is not added twice. */
export const MARKER_MERGE_SEC = 0.05;

/** Valid markers only (finite time ≥ 0, unique ids), sorted by time. */
export function normalizeTimelineMarkers(raw: unknown): TimelineMarker[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TimelineMarker[] = [];
  for (const m of raw as Partial<TimelineMarker>[]) {
    if (!m || typeof m.id !== 'string' || !m.id || seen.has(m.id)) continue;
    if (typeof m.time !== 'number' || !Number.isFinite(m.time) || m.time < 0) continue;
    seen.add(m.id);
    out.push({ id: m.id, time: m.time, ...(typeof m.label === 'string' && m.label.trim() ? { label: m.label.trim() } : {}) });
  }
  return out.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

/** Markers with one more at `time`, unless one is already within {@link MARKER_MERGE_SEC}. */
export function withMarkerAt(markers: readonly TimelineMarker[], time: number, id: string): TimelineMarker[] | null {
  if (!Number.isFinite(time) || time < 0) return null;
  if (markers.some((m) => Math.abs(m.time - time) < MARKER_MERGE_SEC)) return null;
  return normalizeTimelineMarkers([...markers, { id, time }]);
}

/** Markers after a time edit, moved like the playhead (`mapTime`); markers that land together merge. */
export function remapMarkers(markers: readonly TimelineMarker[], mapTime: (t: number) => number): TimelineMarker[] {
  const out: TimelineMarker[] = [];
  for (const m of normalizeTimelineMarkers(markers.map((m) => ({ ...m, time: mapTime(m.time) })))) {
    if (out.some((o) => Math.abs(o.time - m.time) < MARKER_MERGE_SEC)) continue;
    out.push(m);
  }
  return out;
}

/** Name shown for a marker: its label, or M1, M2… by time order. */
export function markerName(markers: readonly TimelineMarker[], marker: TimelineMarker): string {
  return marker.label || `M${markers.indexOf(marker) + 1}`;
}
