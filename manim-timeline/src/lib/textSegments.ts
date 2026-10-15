import type { TextBaseDir, TextLang } from '@/types/scene';

/*
 * Text-line segment parsing, shared by the canvas preview, the editor and the exporter.
 * Kept in step with hebrew_math_parser.py by `__fixtures__/segmentParse.json`.
 */

export interface RawSegment {
  text: string;
  isMath: boolean;
  /** Language run the segment belongs to (math too). Hebrew text writes right to left. */
  lang: TextLang;
}

/** Language of plain text in a line with this base direction. */
export function baseLangOf(baseDir: TextBaseDir | null | undefined): TextLang {
  return baseDir === 'ltr' ? 'en' : 'he';
}

/** Whether a segment's glyphs read right to left (Hebrew text only; math and English are LTR). */
export function isRtlSegment(seg: { isMath: boolean; lang: TextLang }): boolean {
  return !seg.isMath && seg.lang === 'he';
}

/** Source markup that opens a run in each language. */
export const LANG_WRAPPER: Record<TextLang, string> = { en: '\\en{', he: '\\he{' };

/** Index of the `}` closing the `{` at `openIdx`, or -1. Skips `\{` / `\}`. */
function matchingBrace(s: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      i += 2;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Split `raw` into language runs on top-level `\en{…}` / `\he{…}`. A wrapper counts only outside
 * math and at brace depth 0; an unclosed wrapper stays plain text.
 */
function splitLanguageRuns(raw: string, baseLang: TextLang): [TextLang, string][] {
  const runs: [TextLang, string][] = [];
  let buf = '';
  let inMath = false;
  let depth = 0;
  let i = 0;
  while (i < raw.length) {
    const c = raw[i]!;
    if (c === '\\' && i + 1 < raw.length && '${}'.includes(raw[i + 1]!)) {
      buf += raw.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '$') {
      inMath = !inMath;
    } else if (!inMath && depth === 0 && c === '\\') {
      const lang = (Object.keys(LANG_WRAPPER) as TextLang[]).find((l) =>
        raw.startsWith(LANG_WRAPPER[l], i),
      );
      if (lang) {
        const openIdx = i + LANG_WRAPPER[lang].length - 1;
        const close = matchingBrace(raw, openIdx);
        if (close >= 0) {
          if (buf) runs.push([baseLang, buf]);
          buf = '';
          runs.push([lang, raw.slice(openIdx + 1, close)]);
          i = close + 1;
          continue;
        }
      }
    } else if (!inMath && c === '{') {
      depth++;
    } else if (!inMath && c === '}' && depth > 0) {
      depth--;
    }
    buf += c;
    i++;
  }
  if (buf) runs.push([baseLang, buf]);
  return runs;
}

/** Split one language run on `$…$` and `||`; every segment gets `lang`. */
function parseChunk(raw: string, lang: TextLang): RawSegment[] {
  const parts: string[] = [];
  let i = 0;
  while (i < raw.length) {
    let chunk = '';
    while (i < raw.length) {
      if (raw[i] === '\\' && i + 1 < raw.length && raw[i + 1] === '$') {
        chunk += '\\$';
        i += 2;
        continue;
      }
      if (raw[i] === '$') break;
      chunk += raw[i++];
    }
    parts.push(chunk);
    if (i >= raw.length) break;
    i++;
    chunk = '';
    while (i < raw.length) {
      if (raw[i] === '\\' && i + 1 < raw.length && raw[i + 1] === '$') {
        chunk += '\\$';
        i += 2;
        continue;
      }
      if (raw[i] === '$') break;
      chunk += raw[i++];
    }
    parts.push(chunk);
    if (i < raw.length) i++;
  }

  const segments: RawSegment[] = [];
  for (let j = 0; j < parts.length; j++) {
    const text = parts[j];
    if (!text) continue;
    if (j % 2 === 1) {
      segments.push({ text, isMath: true, lang });
    } else if (text.includes('||')) {
      for (const bit of text.split('||')) {
        if (bit) segments.push({ text: bit, isMath: false, lang });
      }
    } else {
      segments.push({ text, isMath: false, lang });
    }
  }
  return segments;
}

/**
 * Parse a raw LaTeX string (Hebrew + $math$ segments, || splits)
 * into an ordered list of segments. Segment `i` is `line[i]` in export and measure.
 * `\$` stays escaped so LaTeX prints a literal dollar.
 * `\en{…}` / `\he{…}` mark a run in that language; plain text is in the line's base language
 * (`he` for RTL, `en` for LTR). Wrapper content is stored without the wrapper.
 * Kept in step with hebrew_math_parser.parse_segments (still used for labels) by
 * `__fixtures__/segmentParse.json`, which both test suites read.
 */
export function parseSegments(raw: string, baseDir: TextBaseDir = 'rtl'): RawSegment[] {
  const baseLang = baseLangOf(baseDir);
  const segments = splitLanguageRuns(raw, baseLang).flatMap(([lang, chunk]) =>
    parseChunk(chunk, lang),
  );
  return segments.length ? segments : [{ text: raw || '', isMath: false, lang: baseLang }];
}

/** Rebuild source markup: math in `$…$`, runs in another language re-wrapped as one `\en{…}`. */
export function reconstructLine(segments: RawSegment[], baseDir: TextBaseDir = 'rtl'): string {
  const baseLang = baseLangOf(baseDir);
  let out = '';
  let open: TextLang | null = null;
  for (const s of segments) {
    const foreign = s.lang !== baseLang ? s.lang : null;
    if (foreign !== open) {
      if (open) out += '}';
      if (foreign) out += LANG_WRAPPER[foreign];
      open = foreign;
    }
    out += s.isMath ? `$${s.text}$` : s.text;
  }
  if (open) out += '}';
  return out;
}
