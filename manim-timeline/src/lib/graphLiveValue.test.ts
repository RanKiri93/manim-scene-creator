import { describe, expect, it } from 'vitest';
import {
  formatLiveNumber,
  formatLiveValueText,
  liveTemplateTexSource,
  parseLiveValueTemplate,
  templateUsesSlope,
} from './graphLiveValue';

describe('live value templates', () => {
  it('splits fixed text from values and reports unknown names', () => {
    expect(parseLiveValueTemplate('f(x) = {y}')).toEqual({ parts: [{ kind: 'text', text: 'f(x) = ' }, { kind: 'value', key: 'y' }], unknown: [] });
    expect(parseLiveValueTemplate('({x}, { y })').parts.map((p) => (p.kind === 'value' ? p.key : p.text))).toEqual(['(', 'x', ', ', 'y', ')']);
    expect(parseLiveValueTemplate('A = {area}').unknown).toEqual(['area']);
    expect(templateUsesSlope("f'(x) = {slope}")).toBe(true);
    expect(templateUsesSlope('{x}')).toBe(false);
  });

  it('rounds half away from zero without "-0"', () => {
    expect(formatLiveNumber(1.005, 2)).toBe('1.01');
    expect(formatLiveNumber(-2.5, 0)).toBe('-3');
    expect(formatLiveNumber(-0.001, 2)).toBe('0.00');
    expect(formatLiveNumber(3, 9)).toBe('3.000000');
  });

  it('formats preview text and typesets fixed pieces as math unless they have $ or Hebrew', () => {
    expect(formatLiveValueText('$f(x) = $ {y}', { x: 1, y: 2.345, slope: null }, 2)).toBe('f(x) =  2.35');
    expect(formatLiveValueText('\\text{slope} = {slope}', { x: 1, y: 1, slope: null }, 2)).toBe('slope = ?');
    expect(liveTemplateTexSource(' f(x) = ')).toBe('$f(x) =$');
    expect(liveTemplateTexSource('שיפוע:')).toBe('שיפוע:');
    expect(liveTemplateTexSource('$a$ = ')).toBe('$a$ =');
    expect(liveTemplateTexSource('  ')).toBeNull();
  });
});

describe('TeX braces are not values', () => {
  it('leaves \\text{…}, \\frac{…}{…} and superscripts alone', () => {
    expect(parseLiveValueTemplate('\\text{slope} = {slope}').parts).toEqual([{ kind: 'text', text: '\\text{slope} = ' }, { kind: 'value', key: 'slope' }]);
    expect(parseLiveValueTemplate('\\frac{1}{h} x^{y} = {y}')).toEqual({ parts: [{ kind: 'text', text: '\\frac{1}{h} x^{y} = ' }, { kind: 'value', key: 'y' }], unknown: [] });
  });
});
