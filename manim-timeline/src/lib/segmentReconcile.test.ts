import { describe, expect, it } from 'vitest';
import type { SegmentStyle } from '@/types/scene';
import { matchSegments, reconcileSegmentStyles } from './segmentReconcile';
import { parseSegments } from './textSegments';

const keys = (raw: string) => parseSegments(raw).map(({ text, isMath }) => ({ text, isMath }));
/** Old index → new indices. */
const match = (oldRaw: string, newRaw: string) => matchSegments(keys(oldRaw), keys(newRaw)).oldToNew;

function styled(raw: string, patch: Record<number, Partial<SegmentStyle>> = {}): SegmentStyle[] {
  return parseSegments(raw).map((p, i) => ({
    text: p.text,
    isMath: p.isMath,
    color: '#ffffff',
    bold: false,
    italic: false,
    ...patch[i],
  }));
}

const makeDefault = (p: { text: string; isMath: boolean }): SegmentStyle => ({
  text: p.text,
  isMath: p.isMath,
  color: 'default',
  bold: false,
  italic: false,
});

const reconcile = (old: SegmentStyle[], newRaw: string) =>
  reconcileSegmentStyles('l1', old, parseSegments(newRaw), makeDefault);

describe('matchSegments', () => {
  it('keeps a retyped segment in place (typo fix)', () => {
    expect(match('אם || פונקציה || רציפה', 'אם || פונקצייה || רציפה')).toEqual([[0], [1], [2]]);
  });

  it('shifts segments after an inserted one', () => {
    expect(match('א||$x$||ב', 'חדש||א||$x$||ב')).toEqual([[1], [2], [3]]);
  });

  it('drops a deleted segment', () => {
    expect(match('א || ב || ג', 'א || ג')).toEqual([[0], [], [1]]);
  });

  it('maps a split segment to all of its pieces', () => {
    expect(match('סדרות פונקציות והתכנסות', 'סדרות|| פונקציות והתכנסות')).toEqual([[0, 1]]);
  });

  it('maps merged segments to the merged one', () => {
    expect(match('סדרות|| פונקציות', 'סדרות פונקציות')).toEqual([[0], [0]]);
  });

  it('follows a moved boundary by character position', () => {
    expect(match('אחת שתיים|| שלוש', 'אחת|| שתיים שלוש')).toEqual([[0, 1], [1]]);
  });

  it('keeps settings when a word is wrapped in \\en{}', () => {
    expect(match('אם||word||אז', String.raw`אם||\en{word}||אז`)).toEqual([[0], [1], [2]]);
  });

  it('pairs an edited math segment with the new math, not with text', () => {
    expect(match('אם $x$ אז', 'אם $x^2$ אז')).toEqual([[0], [1], [2]]);
  });

  it('does not pair unrelated text when counts differ', () => {
    expect(match('א || ב', 'שלום עולם || חדש || אחר')).toEqual([[], []]);
  });
});

describe('reconcileSegmentStyles', () => {
  it('carries colour and timing to the retyped segment and defaults the new one', () => {
    const old = styled('אם || פונקציה', { 1: { color: '#ff0000', waitAfterSec: 0.5, animSec: 1 } });
    const { segments, remap } = reconcile(old, 'חדש || אם || פונקצייה');
    expect(segments.map((s) => [s.text, s.color, s.waitAfterSec])).toEqual([
      ['חדש ', 'default', undefined],
      [' אם ', '#ffffff', undefined],
      [' פונקצייה', '#ff0000', 0.5],
    ]);
    expect(remap?.map).toEqual([[1], [2]]);
  });

  it('gives both pieces of a split the colour, the wait to the last, anim time by length', () => {
    const old = styled('אבגד', { 0: { color: '#ff0000', waitAfterSec: 1, animSec: 2 } });
    const { segments } = reconcile(old, 'א||בגד');
    expect(segments.map((s) => [s.text, s.color, s.animSec, s.waitAfterSec])).toEqual([
      ['א', '#ff0000', 0.5, undefined],
      ['בגד', '#ff0000', 1.5, 1],
    ]);
  });

  it('leaves anim time implicit after a split when it was implicit', () => {
    const { segments } = reconcile(styled('אבגד'), 'א||בגד');
    expect(segments.map((s) => s.animSec)).toEqual([undefined, undefined]);
  });

  it('returns no remap when nothing moved or changed', () => {
    expect(reconcile(styled('אם $x$'), 'אם $x$').remap).toBeNull();
  });

  it('flags math segments whose text changed', () => {
    const { remap } = reconcile(styled('אם $x$ || $y$'), 'אם $x^2$ || $y$');
    expect([...(remap?.mathChanged ?? [])]).toEqual([1]);
  });
});
