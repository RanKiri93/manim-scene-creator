import { describe, expect, it } from 'vitest';
import { buildScriptToTimelinePrompt } from './scriptToTimelinePrompt';

describe('buildScriptToTimelinePrompt', () => {
  it('returns an empty string for blank scripts', () => {
    expect(buildScriptToTimelinePrompt({ script: '' })).toBe('');
    expect(buildScriptToTimelinePrompt({ script: ' \n\t ' })).toBe('');
  });

  it('includes the trimmed script verbatim', () => {
    const script = `
כותרת: משפט ערך הביניים

נאמר ש־$f$ רציפה בקטע $[a,b]$.
`;

    const prompt = buildScriptToTimelinePrompt({ script });

    expect(prompt).toContain('SCRIPT:\nכותרת: משפט ערך הביניים');
    expect(prompt).toContain('נאמר ש־$f$ רציפה בקטע $[a,b]$.');
    expect(prompt.endsWith('נאמר ש־$f$ רציפה בקטע $[a,b]$.')).toBe(true);
  });

  it('includes critical scene-generation constraints', () => {
    const prompt = buildScriptToTimelinePrompt({
      script: 'צייר מערכת צירים וכתוב $f(x)=x-2$',
    });

    expect(prompt).toContain('textLine.raw');
    expect(prompt).toContain('$...$');
    expect(prompt).toContain('xRange');
    expect(prompt).toContain('yRange');
    expect(prompt).toContain('actions: []');
    expect(prompt).toContain('graphArea');
    expect(prompt).toContain('graphField');
    expect(prompt).toContain('Approve');
  });

  it('preserves Hebrew input unchanged', () => {
    const hebrew = 'אם פונקציה רציפה עוברת משלילי לחיובי, היא חייבת לעבור דרך אפס.';

    const prompt = buildScriptToTimelinePrompt({ script: hebrew });

    expect(prompt).toContain(hebrew);
  });
});
