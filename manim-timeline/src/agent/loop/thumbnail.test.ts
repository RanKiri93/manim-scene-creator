import { describe, expect, it } from 'vitest';
import { fullImageFor, rememberFullImage } from './thumbnail';

describe('full-size Copilot pictures', () => {
  it('keeps the newest 40 behind their thumbnails', () => {
    for (let i = 0; i < 45; i++) rememberFullImage(`thumb${i}`, { mediaType: 'image/png', base64: `B${i}` });
    expect(fullImageFor('thumb44')).toBe('data:image/png;base64,B44');
    expect(fullImageFor('thumb5')).toBe('data:image/png;base64,B5');
    expect(fullImageFor('thumb4')).toBeNull();
    expect(fullImageFor('never')).toBeNull();
  });
});
