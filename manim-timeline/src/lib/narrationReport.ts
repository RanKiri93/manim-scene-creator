import { getAudioBoundaries, type AudioTrackItem, type WordBoundary } from '@/types/scene';

/*
 * What could be tightened in the narration, from Whisper word timings alone (no audio analysis):
 * long pauses between words, filler words, and phrases said twice in a row (a retake). Every
 * finding comes with a ready cut in scene seconds that keeps a natural pause. Used by the
 * Copilot's `audio_report` tool.
 */

export interface NarrationCut {
  trackId: string;
  /** Scene seconds. */
  from: number;
  to: number;
}

export interface NarrationPause extends NarrationCut {
  /** Pause length before the cut, seconds. */
  seconds: number;
  /** Word before and after the pause ('' at a clip edge). */
  after: string;
  before: string;
}

export interface NarrationFinding extends NarrationCut {
  text: string;
  /** Scene start of the words. */
  at: number;
}

export interface NarrationReport {
  tracks: {
    id: string;
    start: number;
    end: number;
    words: number;
    gainDb?: number;
    /** Integrated loudness after Clean / Normalize, when measured. */
    lufs?: number;
  }[];
  pauses: NarrationPause[];
  fillers: NarrationFinding[];
  repeats: NarrationFinding[];
  /** Spread of measured loudness between clips (LU), when at least two are measured. */
  loudnessSpread?: number;
}

/** Hebrew and English hesitation sounds, normalised (lower case, no niqqud or punctuation). */
const FILLERS = new Set(['אה', 'אהה', 'אההה', 'אמ', 'אממ', 'אמממ', 'ממ', 'הממ', 'אהם', 'um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'hmm', 'mm']);

const norm = (w: string) =>
  w
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/[^\p{L}\p{N}$]+/gu, '');

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Middle of the pause before word i (clip start for the first word). */
function cutBefore(words: WordBoundary[], i: number): number {
  return i > 0 ? (words[i - 1]!.end + words[i]!.start) / 2 : 0;
}

/** Middle of the pause after word j (clip end for the last word). */
function cutAfter(words: WordBoundary[], j: number, duration: number): number {
  return j + 1 < words.length ? (words[j]!.end + words[j + 1]!.start) / 2 : duration;
}

export function narrationReport(
  audioItems: readonly AudioTrackItem[],
  opts: { minPauseSec?: number; keepPauseSec?: number } = {},
): NarrationReport {
  const minPause = opts.minPauseSec ?? 1.2;
  const keep = opts.keepPauseSec ?? 0.5;
  const report: NarrationReport = { tracks: [], pauses: [], fillers: [], repeats: [] };
  const lufs: number[] = [];

  for (const a of audioItems) {
    const words = getAudioBoundaries(a).filter((w) => w.word.trim());
    const measured = a.audioProcessing?.cleaned?.measuredOutputLufs ?? a.audioProcessing?.normalized?.measuredOutputLufs;
    if (measured != null) lufs.push(measured);
    report.tracks.push({
      id: a.id,
      start: r2(a.startTime),
      end: r2(a.startTime + a.duration),
      words: words.length,
      ...(a.gainDb ? { gainDb: a.gainDb } : {}),
      ...(measured != null ? { lufs: r2(measured) } : {}),
    });
    if (words.length === 0) continue;
    const t0 = a.startTime;

    // Pauses: leading silence, gaps between words, trailing silence. Cut keeps `keep` seconds.
    const gaps: { from: number; to: number; after: string; before: string }[] = [
      { from: 0, to: words[0]!.start, after: '', before: words[0]!.word },
    ];
    for (let i = 1; i < words.length; i++) {
      gaps.push({ from: words[i - 1]!.end, to: words[i]!.start, after: words[i - 1]!.word, before: words[i]!.word });
    }
    gaps.push({ from: words.at(-1)!.end, to: a.duration, after: words.at(-1)!.word, before: '' });
    for (const g of gaps) {
      const len = g.to - g.from;
      if (len < minPause) continue;
      // At a clip edge only the speech side keeps a short pause.
      const keepFrom = g.after ? keep / 2 : 0;
      const keepTo = g.before ? keep / 2 : 0;
      report.pauses.push({
        trackId: a.id,
        seconds: r2(len),
        from: r2(t0 + g.from + keepFrom),
        to: r2(t0 + g.to - keepTo),
        after: g.after,
        before: g.before,
      });
    }

    // Filler words.
    words.forEach((w, i) => {
      if (!FILLERS.has(norm(w.word))) return;
      report.fillers.push({
        trackId: a.id,
        text: w.word,
        at: r2(t0 + w.start),
        from: r2(t0 + cutBefore(words, i)),
        to: r2(t0 + cutAfter(words, i, a.duration)),
      });
    });

    // Retakes: the same 1–5 words said twice in a row; cut the first saying.
    const keys = words.map((w) => norm(w.word));
    for (let i = 0; i < words.length; i++) {
      for (let n = 5; n >= 1; n--) {
        if (i + 2 * n > words.length) continue;
        let same = true;
        for (let k = 0; k < n && same; k++) same = keys[i + k] !== '' && keys[i + k] === keys[i + n + k];
        if (!same || (n === 1 && FILLERS.has(keys[i]!))) continue;
        report.repeats.push({
          trackId: a.id,
          text: words.slice(i, i + n).map((w) => w.word).join(' '),
          at: r2(t0 + words[i]!.start),
          from: r2(t0 + cutBefore(words, i)),
          to: r2(t0 + cutBefore(words, i + n)),
        });
        i += n - 1;
        break;
      }
    }
  }
  if (lufs.length >= 2) report.loudnessSpread = r2(Math.max(...lufs) - Math.min(...lufs));
  return report;
}
