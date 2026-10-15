import { describe, expect, it } from 'vitest';
import { buildExportParts, parseSegments } from './texUtils';
import type { SegmentStyle, TextBaseDir } from '@/types/scene';

function plainStyles(raw: string, baseDir: TextBaseDir = 'rtl'): SegmentStyle[] {
  return parseSegments(raw, baseDir).map((p) => ({
    text: p.text,
    isMath: p.isMath,
    color: '#ffffff',
    bold: false,
    italic: false,
  }));
}

describe('buildExportParts language runs', () => {
  it('wraps each English segment of a Hebrew line as its own part', () => {
    const raw = String.raw`אם \en{the function $f$ || is continuous} אז`;
    expect(buildExportParts(raw, plainStyles(raw))).toEqual([
      'אם ',
      String.raw`\en{the function }`,
      String.raw`\en{$f$}`,
      String.raw`\en{ }`,
      String.raw`\en{ is continuous}`,
      ' אז',
    ]);
  });

  it('wraps Hebrew, not English, in a left-to-right line', () => {
    const raw = String.raw`on \he{רציפה} $x$`;
    expect(buildExportParts(raw, plainStyles(raw, 'ltr'), 'ltr')).toEqual([
      'on ',
      String.raw`\he{רציפה}`,
      ' ',
      '$x$',
    ]);
  });

  it('keeps bold inside the language wrapper', () => {
    const raw = String.raw`\en{word}`;
    const styles = plainStyles(raw).map((s) => ({ ...s, bold: true }));
    expect(buildExportParts(raw, styles)).toEqual([String.raw`\en{\textbf{word}}`]);
  });
});

describe('buildExportParts escaped dollar', () => {
  it('reaches the HebrewMathLine part still escaped', () => {
    const raw = String.raw`המחיר הוא \$5 ולא $x$`;
    expect(buildExportParts(raw, plainStyles(raw))).toEqual([
      String.raw`המחיר הוא \$5 ולא `,
      '$x$',
    ]);
  });
});
