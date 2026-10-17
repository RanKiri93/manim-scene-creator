import { describe, expect, it } from 'vitest';
import { texPreviewText } from './texPreviewText';

describe('texPreviewText', () => {
  it('shows common commands as characters and drops the rest', () => {
    expect(texPreviewText('$\\Delta x$')).toBe('Δx');
    expect(texPreviewText('$2\\pi r$')).toBe('2πr');
    expect(texPreviewText('$\\frac{a}{b}$')).toBe('ab');
    expect(texPreviewText('אורך $L$')).toBe('אורך L');
  });
});
