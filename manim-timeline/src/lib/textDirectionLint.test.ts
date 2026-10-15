import { describe, expect, it } from 'vitest';
import { findUnwrappedForeignRuns, wrapForeignRuns } from './textDirectionLint';
import { parseSegments } from './textSegments';

const texts = (raw: string, dir: 'rtl' | 'ltr' = 'rtl') =>
  findUnwrappedForeignRuns(raw, dir).map((r) => r.text);

describe('findUnwrappedForeignRuns', () => {
  it('finds English words in a Hebrew line as one run', () => {
    expect(texts('אם the function, 2 times אז')).toEqual(['the function, 2 times']);
  });

  it('ignores math, wrapped runs and command names', () => {
    expect(texts(String.raw`\textbf{אם} $\sin x$ \en{done} אז`)).toEqual([]);
  });

  it('keeps a run across || so it stays one wrapper', () => {
    expect(texts('אם the || function אז')).toEqual(['the || function']);
  });

  it('finds Hebrew in a left-to-right line', () => {
    expect(texts('The function is רציפה בקטע on $[a,b]$', 'ltr')).toEqual(['רציפה בקטע']);
  });

  it('flags English inside a brace group', () => {
    expect(texts(String.raw`\textbf{word} אם`)).toEqual(['word']);
  });
});

describe('wrapForeignRuns', () => {
  it('wraps each run and leaves the rest alone', () => {
    expect(wrapForeignRuns('אם the function אז $x$ and y')).toBe(
      String.raw`אם \en{the function} אז $x$ \en{and y}`,
    );
  });

  it('wraps Hebrew in a left-to-right line', () => {
    expect(wrapForeignRuns('is רציפה on', 'ltr')).toBe(String.raw`is \he{רציפה} on`);
  });

  it('turns a run split by || into English segments of one run', () => {
    const fixed = wrapForeignRuns('אם the || function אז');
    expect(parseSegments(fixed).map((s) => [s.text, s.lang])).toEqual([
      ['אם ', 'he'],
      ['the ', 'en'],
      [' function', 'en'],
      [' אז', 'he'],
    ]);
  });

  it('is a no-op when nothing is unwrapped', () => {
    const raw = String.raw`אם \en{x} אז`;
    expect(wrapForeignRuns(raw)).toBe(raw);
  });
});
