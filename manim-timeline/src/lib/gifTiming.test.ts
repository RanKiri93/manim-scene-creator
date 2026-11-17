import { describe, expect, it } from 'vitest';
import { gifFrameIndexAt, isGifImage, normalizeGifDelayMs, parseGifFrameDelaysMs } from './gifTiming';

/** 40×30 GIF, red / green / blue frames of 100 / 200 / 300 ms (written by Pillow). */
const TEST_GIF_BASE64 =
  'R0lGODlhKAAeAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAKAAeAAAIOgABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzAxBgQAIfkEARQAAQAsAAAAACgAHgCBAP8AAAAAAAAAAAAACDoAAQgcSLCgwYMIEypcyLChw4cQI0qcSLGixYsYM2rcyLGjx48gQ4ocSbKkyZMoU6pcybKly5cwMQYEACH5BAEeAAEALAAAAAAoAB4AgQAA/wAAAAAAAAAAAAg6AAEIHEiwoMGDCBMqXMiwocOHECNKnEixosWLGDNq3Mixo8ePIEOKHEmypMmTKFOqXMmypcuXMDEGBAA7';

describe('gif timing', () => {
  it('reads one delay per frame from the file', () => {
    expect(parseGifFrameDelaysMs(Uint8Array.from(atob(TEST_GIF_BASE64), (c) => c.charCodeAt(0)))).toEqual([100, 200, 300]);
    expect(parseGifFrameDelaysMs(new Uint8Array([1, 2, 3]))).toEqual([]);
  });

  it('plays tiny or missing delays as 100 ms, like browsers', () => {
    expect(normalizeGifDelayMs(0)).toBe(100);
    expect(normalizeGifDelayMs(10)).toBe(100);
    expect(normalizeGifDelayMs(20)).toBe(20);
  });

  it('loops from the moment the image appears', () => {
    const d = [100, 200, 300];
    expect(gifFrameIndexAt(-1, d)).toBe(0);
    expect(gifFrameIndexAt(0.05, d)).toBe(0);
    expect(gifFrameIndexAt(0.15, d)).toBe(1);
    expect(gifFrameIndexAt(0.35, d)).toBe(2);
    expect(gifFrameIndexAt(0.65, d)).toBe(0);
    expect(gifFrameIndexAt(0.75, d)).toBe(1);
    expect(gifFrameIndexAt(5, [100])).toBe(0);
  });

  it('recognises GIF images by type, name or data URL', () => {
    expect(isGifImage({ mimeType: 'image/gif' })).toBe(true);
    expect(isGifImage({ mimeType: '', fileName: 'a.GIF' })).toBe(true);
    expect(isGifImage({ srcUrl: 'data:image/gif;base64,AAAA' })).toBe(true);
    expect(isGifImage({ mimeType: 'image/png', fileName: 'a.png' })).toBe(false);
  });
});
