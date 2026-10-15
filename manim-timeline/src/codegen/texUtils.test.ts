import { describe, expect, it } from 'vitest';
import fixtureJson from './__fixtures__/segmentParse.json?raw';
import { buildExportParts, parseSegments, reconstructLine } from './texUtils';
import type { SegmentStyle } from '@/types/scene';

interface FixtureCase {
  name: string;
  raw: string;
  segments: { text: string; isMath: boolean }[];
}

/** Shared with test_parser.py so the editor and Python parsers cannot drift. */
const cases = JSON.parse(fixtureJson) as FixtureCase[];

function plainStyles(raw: string): SegmentStyle[] {
  return parseSegments(raw).map((p) => ({
    text: p.text,
    isMath: p.isMath,
    color: '#ffffff',
    bold: false,
    italic: false,
  }));
}

describe('parseSegments', () => {
  it('has fixture cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(parseSegments(c.raw)).toEqual(c.segments);
  });

  it('returns one empty text segment for an empty source', () => {
    expect(parseSegments('')).toEqual([{ text: '', isMath: false }]);
  });
});

describe('escaped dollar', () => {
  it('reaches the HebrewMathLine part still escaped', () => {
    const raw = String.raw`המחיר הוא \$5 ולא $x$`;
    expect(buildExportParts(raw, plainStyles(raw))).toEqual([
      String.raw`המחיר הוא \$5 ולא `,
      '$x$',
    ]);
  });

  it('round-trips through reconstructLine', () => {
    const raw = String.raw`עולה \$5 ו $a\$b$`;
    expect(reconstructLine(parseSegments(raw))).toBe(raw);
  });
});
