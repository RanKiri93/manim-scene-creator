import type { AudioBed, AudioTrackItem, SceneDefaults } from '@/types/scene';
import { effectiveClipFadeMs } from '@/lib/audioMixdown';

/*
 * What the timeline preview plays, mirroring the export mixdown (`audio_mixdown.py`): every
 * narration clip at its timeline start with its cut fades (linear, like ffmpeg `afade`), plus the
 * background bed looped under the whole scene. Pure, so it is testable without Web Audio.
 */

export interface AudioPlaySegment {
  id: string;
  url: string;
  /** Scene seconds where the clip starts. */
  timelineStart: number;
  /** Seconds into the file where the clip starts. */
  sourceIn: number;
  /** Clip length in seconds. */
  duration: number;
  fadeIn: number;
  fadeOut: number;
  /** Linear gain. */
  gain: number;
}

export interface AudioBedPlay {
  url: string;
  gain: number;
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);

/** Fades scaled down together when they are longer than the clip (as the mixdown does). */
function fitFades(fadeIn: number, fadeOut: number, duration: number): [number, number] {
  const total = fadeIn + fadeOut;
  if (total <= duration || total <= 0) return [fadeIn, fadeOut];
  const k = duration / total;
  return [fadeIn * k, fadeOut * k];
}

export function audioPlaySegments(
  audioItems: readonly AudioTrackItem[],
  defaults: SceneDefaults,
): AudioPlaySegment[] {
  const out: AudioPlaySegment[] = [];
  for (const a of audioItems) {
    if (!a.audioUrl || !(a.duration > 0)) continue;
    const fades = effectiveClipFadeMs(a, defaults);
    const [fadeIn, fadeOut] = fitFades(fades.fadeInMs / 1000, fades.fadeOutMs / 1000, a.duration);
    out.push({
      id: a.id,
      url: a.audioUrl,
      timelineStart: a.startTime,
      sourceIn: Math.max(0, a.sourceIn ?? 0),
      duration: a.duration,
      fadeIn,
      fadeOut,
      gain: dbToGain(a.gainDb ?? 0),
    });
  }
  return out;
}

export function audioBedPlay(bed: AudioBed | null | undefined): AudioBedPlay | null {
  if (!bed?.audioUrl) return null;
  return { url: bed.audioUrl, gain: dbToGain(bed.gainDb) };
}

/** Fade envelope (0..1, before clip gain) at clip-local time `u`. */
export function fadeEnvelopeAt(seg: AudioPlaySegment, u: number): number {
  if (u <= 0 || u >= seg.duration) return 0;
  let g = 1;
  if (seg.fadeIn > 0 && u < seg.fadeIn) g = Math.min(g, u / seg.fadeIn);
  const outStart = seg.duration - seg.fadeOut;
  if (seg.fadeOut > 0 && u > outStart) g = Math.min(g, (seg.duration - u) / seg.fadeOut);
  return g;
}

export interface ScheduledPlay {
  seg: AudioPlaySegment;
  /** Seconds from "now" (playback starting at scene time `t`) until the clip starts sounding. */
  delay: number;
  /** Clip-local time where sound starts (> 0 when starting inside the clip). */
  clipOffset: number;
  /** Seconds to play. */
  length: number;
}

/** Clips still to be heard when playback starts at scene time `t`, in start order. */
export function scheduleFrom(segments: readonly AudioPlaySegment[], t: number): ScheduledPlay[] {
  const out: ScheduledPlay[] = [];
  for (const seg of segments) {
    const end = seg.timelineStart + seg.duration;
    if (end <= t + 1e-6) continue;
    const clipOffset = Math.max(0, t - seg.timelineStart);
    out.push({
      seg,
      delay: Math.max(0, seg.timelineStart - t),
      clipOffset,
      length: seg.duration - clipOffset,
    });
  }
  return out.sort((a, b) => a.delay - b.delay || a.seg.id.localeCompare(b.seg.id));
}

/**
 * Gain automation for one scheduled clip, as [secondsFromSoundStart, envelope] points between
 * which the gain ramps linearly. Starts at the envelope value at `clipOffset`.
 */
export function fadeRampPoints(play: ScheduledPlay): [number, number][] {
  const { seg, clipOffset, length } = play;
  const pts: [number, number][] = [[0, fadeEnvelopeAt(seg, Math.max(clipOffset, 1e-9))]];
  const add = (u: number) => {
    const rel = u - clipOffset;
    if (rel > 1e-6 && rel < length - 1e-6) pts.push([rel, fadeEnvelopeAt(seg, u)]);
  };
  if (seg.fadeIn > 0) add(seg.fadeIn);
  if (seg.fadeOut > 0) add(seg.duration - seg.fadeOut);
  pts.push([length, seg.fadeOut > 0 ? 0 : 1]);
  return pts.sort((a, b) => a[0] - b[0]);
}
