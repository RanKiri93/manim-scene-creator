import { describe, expect, it } from 'vitest';
import css from '../index.css?raw';
import { CANVAS_CHROME, KIND_COLORS, THEME, itemKindColor } from './theme';

function cssColor(name: string): string | undefined {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  return m?.[1].toLowerCase();
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('theme tokens', () => {
  it('THEME matches the @theme block in index.css', () => {
    for (const [key, value] of Object.entries(THEME)) {
      expect(cssColor(kebab(key)), `--color-${kebab(key)}`).toBe(value);
    }
  });

  it('KIND_COLORS matches the --color-kind-* tokens', () => {
    for (const [key, value] of Object.entries(KIND_COLORS)) {
      expect(cssColor(`kind-${key}`), `--color-kind-${key}`).toBe(value);
    }
  });

  it('text tokens clear WCAG AA (4.5:1) on every surface', () => {
    for (const surface of [THEME.ink, THEME.panel, THEME.raised]) {
      for (const text of [THEME.chalk, THEME.chalkDim, THEME.chalkFaint]) {
        expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(THEME.highlightInk, THEME.highlight)).toBeGreaterThanOrEqual(4.5);
  });

  it('clip labels (highlight ink) are readable on every kind color', () => {
    for (const color of Object.values(KIND_COLORS)) {
      expect(contrast(THEME.highlightInk, color)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('canvas chrome is built only from theme tokens (optionally with an alpha byte)', () => {
    const tokens = new Set<string>(Object.values(THEME));
    for (const [key, value] of Object.entries(CANVAS_CHROME)) {
      expect(value, key).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
      expect(tokens.has(value.slice(0, 7)), `${key} uses a THEME color`).toBe(true);
    }
  });

  it('maps item kinds to their group color', () => {
    expect(itemKindColor('textLine')).toBe(KIND_COLORS.text);
    expect(itemKindColor('graphArea')).toBe(KIND_COLORS.graph);
    expect(itemKindColor('camera_move')).toBe(KIND_COLORS.camera);
  });
});
