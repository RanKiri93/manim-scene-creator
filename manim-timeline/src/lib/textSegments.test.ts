import { describe, expect, it } from 'vitest';
import fixtureJson from './__fixtures__/segmentParse.json?raw';
import { isRtlSegment, parseSegments, reconstructLine, type RawSegment } from './textSegments';
import type { TextBaseDir } from '@/types/scene';

interface FixtureCase {
  name: string;
  baseDir?: TextBaseDir;
  raw: string;
  segments: RawSegment[];
}

/** Shared with test_parser.py so the editor and Python parsers cannot drift. */
const cases = JSON.parse(fixtureJson) as FixtureCase[];

describe('parseSegments', () => {
  it('has fixture cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(parseSegments(c.raw, c.baseDir ?? 'rtl')).toEqual(c.segments);
  });

  it('returns one empty text segment for an empty source', () => {
    expect(parseSegments('')).toEqual([{ text: '', isMath: false, lang: 'he' }]);
    expect(parseSegments('', 'ltr')).toEqual([{ text: '', isMath: false, lang: 'en' }]);
  });
});

describe('reconstructLine', () => {
  it('puts one wrapper around a split run', () => {
    const raw = String.raw`אם \en{a $f$ b} אז`;
    expect(reconstructLine(parseSegments(raw))).toBe(raw);
  });

  it('keeps escaped dollars', () => {
    const raw = String.raw`עולה \$5 ו $a\$b$`;
    expect(reconstructLine(parseSegments(raw))).toBe(raw);
  });
});

describe('isRtlSegment', () => {
  it('is true only for Hebrew text', () => {
    // Segments: "א ", "b" (English), " ", "c" (math).
    const segs = parseSegments(String.raw`א \en{b} $c$`);
    expect(segs.map(isRtlSegment)).toEqual([true, false, true, false]);
  });
});
