import type { ItemId, SceneItem } from '@/types/scene';
import { resolveAngleMark } from '@/lib/shapeAnchors';
import type { DraftSession } from '../loop/draft';
import { inspectDraft } from '../loop/inspect';
import { reviewScene } from '../loop/review';
import type { LoopOutcome } from '../loop/runAgentLoop';
import { REVIEW_PROMPT } from '../reviewPrompt';
import { axes, lissajous, movingPoint, parabola, shaded, textLine, widePoint } from './scenes';

/** What a check sees after a run: the draft scene, the session and the loop's outcome. */
export interface PracticeContext {
  scene: Map<ItemId, SceneItem>;
  session: DraftSession;
  outcome: LoopOutcome;
}

/** A check passes with `true`; anything else (a string) is why it failed. */
export interface PracticeCheck {
  name: string;
  test: (ctx: PracticeContext) => true | string;
}

export interface PracticeCase {
  id: string;
  prompt: string;
  /** Scene the request starts from (ids fixed so the prompt can name them). */
  base: () => SceneItem[];
  checks: PracticeCheck[];
  /** A known-good answer (actions, and optionally a style note) that must pass every check. */
  golden?: { actions: unknown[]; styleNote?: string };
}

// ── Helpers ───────────────────────────────────────────────────────────────

type Kind = SceneItem['kind'];
type OfKind<K extends Kind> = Extract<SceneItem, { kind: K }>;

export function ofKind<K extends Kind>(ctx: PracticeContext, kind: K): OfKind<K>[] {
  return [...ctx.scene.values()].filter((it): it is OfKind<K> => it.kind === kind);
}

const near = (a: number | undefined, b: number, tol: number) => a != null && Math.abs(a - b) <= tol;

function check(name: string, test: (ctx: PracticeContext) => boolean | string): PracticeCheck {
  return {
    name,
    test: (ctx) => {
      try {
        const r = test(ctx);
        return r === true ? true : r === false ? 'not met' : r;
      } catch (e) {
        return `check threw: ${(e as Error).message}`;
      }
    },
  };
}

/** Hue of a hex colour in degrees, with its saturation, for "is it yellow / red". */
function hue(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}
export const isYellow = (c: string) => {
  const x = hue(c);
  return !!x && x.s > 0.4 && x.h >= 40 && x.h <= 70;
};
export const isRed = (c: string) => {
  const x = hue(c);
  return !!x && x.s > 0.4 && (x.h <= 15 || x.h >= 345);
};

/** Evaluate a JS expression in x (and y) the way the editor does. */
function evalExpr(expr: string, x: number, y = 0): number {
  return (new Function('x', 'y', `"use strict"; return (${expr});`) as (x: number, y: number) => number)(x, y);
}

const exportOk = check('the export has no errors', (ctx) => {
  const f = reviewScene(ctx.session).findings.find((x) => x.kind === 'exportError');
  return f ? f.message : true;
});
const nothingOffscreen = check('nothing is off camera or overlapping', (ctx) => {
  const f = reviewScene(ctx.session).findings.filter((x) => x.kind === 'offscreen' || x.kind === 'textOverlap');
  return f.length ? f.map((x) => x.message).join(' | ') : true;
});

/** Dot graph x at a time, from inspect. */
function dotX(ctx: PracticeContext, dotId: string, time: number): number | undefined {
  const facts = inspectDraft(ctx.session, { times: [time], itemIds: [dotId] });
  const row = (facts.items as { at?: { graph?: [number, number] }[] }[])[0]?.at?.[0];
  return row?.graph?.[0];
}

const sceneEnd = (ctx: PracticeContext) => Number(inspectDraft(ctx.session, { times: [0], itemIds: [] }).sceneDurationSec);

// ── The set ───────────────────────────────────────────────────────────────

export const PRACTICE_CASES: PracticeCase[] = [
  {
    id: 'drop-line',
    prompt: 'On these axes, put a point on the graph of f that moves from x = 0 to x = 2, with a vertical segment down to the x-axis that moves with it.',
    base: parabola,
    checks: [
      check('a dot attached to the plot', (ctx) => ofKind(ctx, 'graphDot').some((d) => d.dot.attachment?.kind === 'function' && d.dot.attachment.graphPlotId === 'p')),
      check('the dot ends at x = 2', (ctx) => {
        const d = ofKind(ctx, 'graphDot')[0];
        return d ? near(dotX(ctx, d.id, sceneEnd(ctx)), 2, 0.05) || `ends at x = ${dotX(ctx, d.id, sceneEnd(ctx))}` : 'no dot';
      }),
      check('a segment from the dot to its foot on the x-axis', (ctx) =>
        ofKind(ctx, 'shape').some((s) => !!s.endpoints && [s.endpoints.start, s.endpoints.end].some((a) => a.kind === 'graphDotFoot' && a.axis === 'x'))),
      exportOk,
    ],
    golden: {
      actions: [
        { action: 'CREATE', item: { id: 'd1', kind: 'graphDot', axesId: 'ax', label: 'P', startTime: 2, duration: 0.5, dot: { attachment: { kind: 'function', graphPlotId: 'p', x: 0 } } } },
        { action: 'CREATE', item: { id: 's1', kind: 'shape', shapeType: 'line', label: 'drop', startTime: 2, duration: 0.5, endpoints: { start: { kind: 'graphDot', dotId: 'd1' }, end: { kind: 'graphDotFoot', dotId: 'd1', axis: 'x' } } } },
        { action: 'CREATE', item: { id: 'm1', kind: 'target_animation', label: 'move', mode: 'graphFollow', startTime: 3, duration: 2, targets: [{ targetId: 'd1', targetX: 2, easing: 'linear' }] } },
      ],
    },
  },
  {
    id: 'live-value',
    prompt: 'Next to the moving point P show "f(x) = " with its current value, two decimals.',
    base: movingPoint,
    checks: [
      check('P shows a live label with {y}', (ctx) => {
        const d = ctx.scene.get('d');
        return d?.kind === 'graphDot' && d.dot.showCoordinates === true && /\{\s*y\s*\}/.test(d.dot.valueTemplate ?? '') ? true : `template: ${d?.kind === 'graphDot' ? d.dot.valueTemplate : '-'}`;
      }),
      check('two decimals', (ctx) => {
        const d = ctx.scene.get('d');
        return d?.kind === 'graphDot' && (d.dot.coordinatePrecision ?? 2) === 2;
      }),
      exportOk,
    ],
    golden: { actions: [{ action: 'UPDATE', itemId: 'd', updates: { dot: { showCoordinates: true, coordinatePrecision: 2, valueTemplate: 'f(x) = {y}' } } }] },
  },
  {
    id: 'tangent',
    prompt: 'Add the tangent line at the moving point P, about 2 units long, so we see the slope change as it moves.',
    base: movingPoint,
    checks: [
      check('a tangent connector on P, 1.5–2.5 long', (ctx) =>
        ofKind(ctx, 'shape').some((s) => !!s.endpoints?.tangent && s.endpoints.start.kind === 'graphDot' && s.endpoints.start.dotId === 'd' && s.endpoints.tangent.length >= 1.5 && s.endpoints.tangent.length <= 2.5)),
      exportOk,
    ],
    golden: { actions: [{ action: 'CREATE', item: { id: 't1', kind: 'shape', shapeType: 'line', label: 'tangent', startTime: 2, duration: 0.5, endpoints: { start: { kind: 'graphDot', dotId: 'd' }, tangent: { length: 2 } } } }] },
  },
  {
    id: 'secant',
    prompt: 'Show the secant of f through P at x = 0.5 and Q at x = 2, then slide Q towards P until the secant is almost the tangent.',
    base: parabola,
    checks: [
      check('two dots on the plot', (ctx) => ofKind(ctx, 'graphDot').filter((d) => d.dot.attachment?.kind === 'function').length >= 2),
      check('a line through both dots, lengthened past them', (ctx) =>
        ofKind(ctx, 'shape').some((s) => s.endpoints?.start.kind === 'graphDot' && s.endpoints.end.kind === 'graphDot' && (s.endpoints.extend ?? 0) > 0)),
      check('Q slides close to, not onto, x = 0.5', (ctx) =>
        ofKind(ctx, 'target_animation').some((m) => m.mode === 'graphFollow' && m.targets.some((t) => t.targetX != null && t.targetX > 0.5 && t.targetX <= 0.8))),
      exportOk,
    ],
    golden: {
      actions: [
        { action: 'CREATE', item: { id: 'P', kind: 'graphDot', axesId: 'ax', label: 'P', startTime: 2, duration: 0.5, dot: { attachment: { kind: 'function', graphPlotId: 'p', x: 0.5 } } } },
        { action: 'CREATE', item: { id: 'Q', kind: 'graphDot', axesId: 'ax', label: 'Q', startTime: 2, duration: 0.5, dot: { attachment: { kind: 'function', graphPlotId: 'p', x: 2 } } } },
        { action: 'CREATE', item: { id: 'sec', kind: 'shape', shapeType: 'line', label: 'secant', startTime: 2.5, duration: 0.5, endpoints: { start: { kind: 'graphDot', dotId: 'P' }, end: { kind: 'graphDot', dotId: 'Q' }, extend: 1 } } },
        { action: 'CREATE', item: { id: 'slide', kind: 'target_animation', label: 'Q to P', mode: 'graphFollow', startTime: 3.5, duration: 3, targets: [{ targetId: 'Q', targetX: 0.6, easing: 'smooth' }] } },
      ],
    },
  },
  {
    id: 'area-label',
    prompt: 'Shade the area under f between x = 0.5 and x = 1.5 and label it as the integral.',
    base: parabola,
    checks: [
      check('an area under plot p on [0.5, 1.5]', (ctx) =>
        ofKind(ctx, 'graphArea').some((a) => a.mode.areaKind === 'underCurve' && a.mode.curve.sourceKind === 'plot' && a.mode.curve.plotId === 'p' && near(a.mode.xMin, 0.5, 1e-6) && near(a.mode.xMax, 1.5, 1e-6))),
      check('an integral label', (ctx) => ofKind(ctx, 'textLine').some((t) => t.raw.includes('\\int'))),
      exportOk,
    ],
    golden: {
      actions: [
        { action: 'CREATE', item: { id: 'a1', kind: 'graphArea', axesId: 'ax', label: 'area', startTime: 2, duration: 1, area: { areaKind: 'underCurve', xMin: 0.5, xMax: 1.5, curve: { plotId: 'p' } } } },
        { action: 'CREATE', item: { id: 'l1', kind: 'textLine', label: 'integral', startTime: 2, duration: 1, raw: '$\\int_{0.5}^{1.5} f(x)\\,dx$', x: 2, y: 2 } },
      ],
    },
  },
  {
    id: 'riemann',
    prompt: 'Show left Riemann sums for f on [0, 2] with n = 4, 8 and 16, each replacing the last.',
    base: parabola,
    checks: [
      check('one Riemann area, left, counts 4, 8, 16', (ctx) =>
        ofKind(ctx, 'graphArea').some((a) => a.mode.areaKind === 'riemann' && a.mode.rule === 'left' && a.mode.counts.join(',') === '4,8,16' && near(a.mode.xMin, 0, 1e-6) && near(a.mode.xMax, 2, 1e-6))),
      check('no rectangles faked with shapes', (ctx) => ofKind(ctx, 'shape').filter((s) => s.shapeType === 'rectangle').length === 0),
      exportOk,
    ],
    golden: { actions: [{ action: 'CREATE', item: { id: 'r1', kind: 'graphArea', axesId: 'ax', label: 'left sums', startTime: 2, duration: 3, strokeWidth: 1, area: { areaKind: 'riemann', xMin: 0, xMax: 2, curve: { plotId: 'p' }, rule: 'left', counts: [4, 8, 16] } } }] },
  },
  {
    id: 'slope-field',
    prompt: "Draw the slope field of y' = x − y and the solution through (−1, 0.8).",
    base: () => [axes([-3, 3], [-2, 2])],
    checks: [
      check('a slope field of x − y', (ctx) =>
        ofKind(ctx, 'graphField').some((f) => f.fieldMode === 'slope' && near(evalExpr(f.jsExprSlope, 1.3, -0.4), 1.7, 1e-6))),
      check('a stream line through (−1, 0.8)', (ctx) =>
        ofKind(ctx, 'graphField').some((f) => f.streamPoints.some((p) => near(p.x, -1, 1e-6) && near(p.y, 0.8, 1e-6)))),
      exportOk,
    ],
    golden: {
      actions: [
        { action: 'CREATE', item: { id: 'f1', kind: 'graphField', axesId: 'ax', label: 'slope field', startTime: 1, duration: 2, fieldMode: 'slope', jsExprSlope: 'x - y', pyExprSlope: 'x - y', streamPoints: [{ x: -1, y: 0.8 }] } },
      ],
    },
  },
  {
    id: 'slide',
    prompt: 'כותרת: משפט ערך הביניים, ומתחתיה שלוש שורות של הניסוח, כל שורה אחרי שהקודמת נכתבה.',
    base: () => [],
    checks: [
      check('a title and three lines', (ctx) => ofKind(ctx, 'textLine').length >= 4 || `${ofKind(ctx, 'textLine').length} text lines`),
      check('each line starts after the previous one is written', (ctx) => {
        const lines = ofKind(ctx, 'textLine').sort((a, b) => a.startTime - b.startTime);
        return lines.every((l, i) => i === 0 || l.startTime >= lines[i - 1]!.startTime + lines[i - 1]!.duration - 1e-6);
      }),
      exportOk,
    ],
    golden: {
      actions: [
        { action: 'CREATE', item: { id: 'title', kind: 'textLine', label: 'title', startTime: 0, duration: 1, raw: 'משפט ערך הביניים', x: 0, y: 3 } },
        { action: 'CREATE', item: { id: 'l1', kind: 'textLine', label: 'l1', startTime: 1, duration: 1, raw: 'תהי f רציפה בקטע סגור', x: 0, y: 1.5 } },
        { action: 'CREATE', item: { id: 'l2', kind: 'textLine', label: 'l2', startTime: 2, duration: 1, raw: 'ויהי c בין f(a) ל-f(b)', x: 0, y: 0.5 } },
        { action: 'CREATE', item: { id: 'l3', kind: 'textLine', label: 'l3', startTime: 3, duration: 1, raw: 'אז קיימת נקודה שבה f שווה ל-c', x: 0, y: -0.5 } },
      ],
    },
  },
  {
    id: 'highlight-term',
    prompt: 'In the expansion, colour the 2x term yellow.',
    base: () => [textLine('e', '$(x+1)^2 = x^2 + 2x + 1$', 0, 0, 0)],
    checks: [
      check('a yellow segment that is the 2x term', (ctx) => {
        const e = ctx.scene.get('e');
        return e?.kind === 'textLine' && e.segments.some((s) => s.text.replace(/\s/g, '').includes('2x') && !s.text.includes('x^2') && isYellow(s.color));
      }),
      exportOk,
    ],
  },
  {
    id: 'equation-steps',
    prompt: 'Solve 2x + 3 = 7 step by step, each line turning into the next.',
    base: () => [],
    checks: [
      check('at least three steps', (ctx) => ofKind(ctx, 'textLine').length >= 3),
      check('later steps morph from earlier ones', (ctx) => ofKind(ctx, 'textLine').filter((t) => t.animStyle === 'transform' && !!t.transformConfig?.sourceLineId).length >= 2),
      check('it ends at x = 2', (ctx) => ofKind(ctx, 'textLine').some((t) => /x\s*=\s*2(?!\d)/.test(t.raw.replace(/\$/g, '')))),
      exportOk,
    ],
  },
  {
    id: 'camera-beat',
    prompt: 'When P reaches x = 1, zoom in on it for two seconds, then go back to the full view.',
    base: movingPoint,
    checks: [
      check('a zoom starting when P is at x = 1 (about 4 s)', (ctx) => ofKind(ctx, 'camera_move').some((c) => c.targetWidth < 12 && Math.abs(c.startTime - 4) <= 0.6)),
      check('a return to the full width later', (ctx) => {
        const zoom = ofKind(ctx, 'camera_move').find((c) => c.targetWidth < 12);
        return !!zoom && ofKind(ctx, 'camera_move').some((c) => c.startTime > zoom.startTime && near(c.targetWidth, 14.222, 0.05));
      }),
      exportOk,
    ],
    golden: {
      actions: [
        { action: 'CREATE', item: { id: 'z1', kind: 'camera_move', label: 'zoom', startTime: 4, duration: 0.6, targetMode: 'region', region: { left: -1, right: 2, bottom: -1, top: 1 } } },
        { action: 'CREATE', item: { id: 'z2', kind: 'camera_move', label: 'back', startTime: 6.6, duration: 0.6, targetMode: 'frame', targetFrameId: 'home' } },
      ],
    },
  },
  {
    id: 'camera-follow',
    prompt: 'The graph is wide. Keep the camera on the point while it travels.',
    base: widePoint,
    checks: [
      check('a camera clip following the dot', (ctx) => ofKind(ctx, 'camera_move').some((c) => c.follow?.targetId === 'd')),
      check('it covers the motion (2–7 s)', (ctx) => ofKind(ctx, 'camera_move').some((c) => c.follow?.targetId === 'd' && c.startTime <= 2.3 && c.startTime + c.duration >= 6.7)),
      exportOk,
    ],
    golden: {
      actions: [{ action: 'CREATE', item: { id: 'c1', kind: 'camera_move', label: 'follow', startTime: 2, duration: 5, targetMode: 'follow', targetId: 'd', targetWidth: 6 } }],
    },
  },
  {
    id: 'trail',
    prompt: 'Let the point leave a fading trail as it goes around the curve.',
    base: lissajous,
    checks: [
      check('the dot has a fading trail', (ctx) => {
        const d = ctx.scene.get('d');
        return d?.kind === 'graphDot' && !!d.dot.trace && (d.dot.trace.fadeSeconds ?? 0) > 0;
      }),
      check('no extra moving dots or shapes faking it', (ctx) => ofKind(ctx, 'graphDot').length === 1),
      exportOk,
    ],
    golden: { actions: [{ action: 'UPDATE', itemId: 'd', updates: { dot: { trace: { fadeSeconds: 1.5 } } } }] },
  },
  {
    id: 'triangle',
    prompt: 'Draw a right triangle ABC with the right angle at B, mark the angle α at A, and mark AB and BC as equal.',
    base: () => [],
    checks: [
      check('three sides as connectors', (ctx) => ofKind(ctx, 'shape').filter((s) => !!s.endpoints).length >= 3),
      check('a right-angle mark', (ctx) => ofKind(ctx, 'shape').some((s) => {
        if (!s.angle) return false;
        const r = resolveAngleMark(s, { items: ctx.scene, time: 99, frames: ctx.session.base.frames, startFrameId: ctx.session.base.startFrameId });
        return r.error == null && r.right;
      })),
      check('an arc mark that is not the right angle', (ctx) => ofKind(ctx, 'shape').some((s) => {
        if (!s.angle) return false;
        const r = resolveAngleMark(s, { items: ctx.scene, time: 99, frames: ctx.session.base.frames, startFrameId: ctx.session.base.startFrameId });
        return r.error == null && !r.right;
      })),
      check('two sides with the same ticks', (ctx) => {
        const ticks = ofKind(ctx, 'shape').map((s) => s.endpoints?.ticks ?? 0).filter((n) => n > 0);
        return ticks.length >= 2 && ticks.some((n, i) => ticks.indexOf(n) !== i);
      }),
      check('α is written', (ctx) => ofKind(ctx, 'textLine').some((t) => t.raw.includes('\\alpha') || t.raw.includes('α'))),
      exportOk,
    ],
    golden: {
      actions: [
        { action: 'CREATE', item: { id: 'A', kind: 'shape', shapeType: 'circle', label: 'A', startTime: 0, duration: 0.3, x: -2, y: 2, radius: 0.06 } },
        { action: 'CREATE', item: { id: 'B', kind: 'shape', shapeType: 'circle', label: 'B', startTime: 0, duration: 0.3, x: -2, y: -1, radius: 0.06 } },
        { action: 'CREATE', item: { id: 'C', kind: 'shape', shapeType: 'circle', label: 'C', startTime: 0, duration: 0.3, x: 1, y: -1, radius: 0.06 } },
        { action: 'CREATE', item: { id: 'ab', kind: 'shape', shapeType: 'line', label: 'AB', startTime: 0.5, duration: 0.5, endpoints: { start: { kind: 'object', itemId: 'A' }, end: { kind: 'object', itemId: 'B' }, ticks: 1 } } },
        { action: 'CREATE', item: { id: 'bc', kind: 'shape', shapeType: 'line', label: 'BC', startTime: 0.5, duration: 0.5, endpoints: { start: { kind: 'object', itemId: 'B' }, end: { kind: 'object', itemId: 'C' }, ticks: 1 } } },
        { action: 'CREATE', item: { id: 'ca', kind: 'shape', shapeType: 'line', label: 'CA', startTime: 0.5, duration: 0.5, endpoints: { start: { kind: 'object', itemId: 'C' }, end: { kind: 'object', itemId: 'A' } } } },
        { action: 'CREATE', item: { id: 'rb', kind: 'shape', label: 'right angle', startTime: 1, duration: 0.5, angle: { vertex: { kind: 'object', itemId: 'B' }, from: { kind: 'object', itemId: 'A' }, to: { kind: 'object', itemId: 'C' }, radius: 0.3 } } },
        { action: 'CREATE', item: { id: 'ra', kind: 'shape', label: 'alpha', startTime: 1, duration: 0.5, angle: { vertex: { kind: 'object', itemId: 'A' }, from: { kind: 'object', itemId: 'B' }, to: { kind: 'object', itemId: 'C' } } } },
        { action: 'CREATE', item: { id: 'al', kind: 'textLine', label: 'alpha', startTime: 1.5, duration: 0.5, raw: '$\\alpha$', x: -1.6, y: 1.2 } },
      ],
    },
  },
  {
    id: 'taylor',
    prompt: 'Show the Taylor polynomials of sin x up to degree 9, each one replacing the previous.',
    base: () => [axes([-7, 7], [-3, 3], 0.7, 1)],
    checks: [
      check('a function series in replacement mode', (ctx) => ofKind(ctx, 'graphFunctionSeries').some((s) => s.mode === 'replacement')),
      exportOk,
    ],
  },
  {
    id: 'area-sweep',
    prompt: 'Shade the area under f from 0 to 2 so it builds up from left to right.',
    base: parabola,
    checks: [
      check('one area that sweeps right', (ctx) => ofKind(ctx, 'graphArea').length === 1 && ofKind(ctx, 'graphArea')[0]!.introStyle === 'sweep_right'),
      exportOk,
    ],
    golden: {
      actions: [{ action: 'CREATE', item: { id: 'a1', kind: 'graphArea', axesId: 'ax', label: 'area', startTime: 2, duration: 2, introStyle: 'sweep_right', area: { areaKind: 'underCurve', xMin: 0, xMax: 2, curve: { plotId: 'p' } } } }],
    },
  },
  {
    id: 'insert-pause',
    prompt: 'Add a 2 second pause before the point starts moving.',
    base: movingPoint,
    checks: [
      check('the move starts at 5 s', (ctx) => {
        const m = ctx.scene.get('m');
        return m ? near(m.startTime, 5, 0.05) || `starts at ${m.startTime}` : 'move clip gone';
      }),
      check('the dot still appears at 2 s', (ctx) => near(ctx.scene.get('d')?.startTime, 2, 0.05)),
      exportOk,
    ],
    golden: { actions: [{ action: 'TIMELINE', edit: { op: 'insert', at: 3, seconds: 2 } }] },
  },
  {
    id: 'review',
    prompt: REVIEW_PROMPT,
    base: () => {
      const t = textLine('far', 'כותרת רחוקה', 8, 0, 0);
      t.measure = { widthInk: 3, heightInk: 0.5 } as never;
      return [t];
    },
    checks: [nothingOffscreen, exportOk],
    golden: { actions: [{ action: 'UPDATE', itemId: 'far', updates: { x: 0 } }] },
  },
  {
    id: 'style-note',
    prompt: 'From now on all dots should be yellow. Make P yellow too.',
    base: movingPoint,
    checks: [
      check('P is yellow', (ctx) => {
        const d = ctx.scene.get('d');
        return d?.kind === 'graphDot' && (isYellow(d.dot.color) || `colour ${d.dot.color}`);
      }),
      check('it suggests a style note about yellow dots', (ctx) => /yellow|#f[a-f0-9]c/i.test(ctx.outcome.styleNote ?? '') || `note: ${ctx.outcome.styleNote ?? 'none'}`),
    ],
    golden: { actions: [{ action: 'UPDATE', itemId: 'd', updates: { dot: { color: '#facc15' } } }], styleNote: 'Dots are yellow (#facc15).' },
  },
  {
    id: 'delete',
    prompt: 'Remove the shaded area.',
    base: shaded,
    checks: [
      check('no area left', (ctx) => ofKind(ctx, 'graphArea').length === 0),
      check('the plot stays', (ctx) => ctx.scene.has('p')),
    ],
    golden: { actions: [{ action: 'DELETE', itemId: 'a' }] },
  },
  {
    id: 'arrow-to-dot',
    prompt: "Add the label 'הנקודה P' above the graph and an arrow from it to the moving point.",
    base: movingPoint,
    checks: [
      check('a new text line', (ctx) => ofKind(ctx, 'textLine').length >= 1),
      check('an arrow from the text to P', (ctx) =>
        ofKind(ctx, 'shape').some((s) => s.shapeType === 'arrow' && s.endpoints?.start.kind === 'object' && s.endpoints.end.kind === 'graphDot' && s.endpoints.end.dotId === 'd')),
      exportOk,
    ],
    golden: {
      actions: [
        { action: 'CREATE', item: { id: 'lbl', kind: 'textLine', label: 'label', startTime: 2.5, duration: 0.5, raw: 'הנקודה P', x: 2, y: 3 } },
        { action: 'CREATE', item: { id: 'arr', kind: 'shape', shapeType: 'arrow', label: 'arrow', startTime: 3, duration: 0.5, endpoints: { start: { kind: 'object', itemId: 'lbl', edge: 'DOWN' }, end: { kind: 'graphDot', dotId: 'd' } } } },
      ],
    },
  },
  {
    id: 'fade-out',
    prompt: 'At the end, fade out the graph and the point.',
    base: movingPoint,
    checks: [
      check('an exit for the plot and the dot', (ctx) =>
        ofKind(ctx, 'exit_animation').some((x) => x.targets.some((t) => t.targetId === 'p')) && ofKind(ctx, 'exit_animation').some((x) => x.targets.some((t) => t.targetId === 'd'))),
      check('after the motion ends (5 s)', (ctx) => ofKind(ctx, 'exit_animation').every((x) => x.startTime >= 5 - 1e-6)),
      exportOk,
    ],
    golden: {
      actions: [{ action: 'CREATE', item: { id: 'x1', kind: 'exit_animation', label: 'fade out', startTime: 5.5, duration: 1, targets: [{ targetId: 'p', animStyle: 'fade_out' }, { targetId: 'd', animStyle: 'fade_out' }] } }],
    },
  },
  {
    id: 'pulse',
    prompt: 'Make the point pulse when it starts moving.',
    base: movingPoint,
    checks: [
      check('a blink on P at about 3 s', (ctx) => ofKind(ctx, 'blink_animation').some((b) => b.targets.some((t) => t.targetId === 'd') && Math.abs(b.startTime - 3) <= 0.5)),
      exportOk,
    ],
    golden: {
      actions: [{ action: 'CREATE', item: { id: 'b1', kind: 'blink_animation', label: 'pulse', startTime: 3, duration: 0.6, targets: [{ targetId: 'd', mode: 'scale', scaleFactor: 1.6 }] } }],
    },
  },
  {
    id: 'recolor',
    prompt: 'Make the curve red.',
    base: parabola,
    checks: [
      check('the plot is red', (ctx) => {
        const p = ctx.scene.get('p');
        return p?.kind === 'graphPlot' && (isRed(p.fn.color) || `colour ${p.fn.color}`);
      }),
      check('nothing else was added', (ctx) => ctx.scene.size === 2),
    ],
    golden: { actions: [{ action: 'UPDATE', itemId: 'p', updates: { fn: { color: '#ef4444' } } }] },
  },
  {
    id: 'sine-axes',
    prompt: 'Draw y = sin(x) on [0, 2π] with axes that fit the frame.',
    base: () => [],
    checks: [
      check('axes covering x 0..2π and y −1..1', (ctx) =>
        ofKind(ctx, 'axes').some((a) => a.xRange[0] <= 0 && a.xRange[1] >= 6.2 && a.yRange[0] <= -1 && a.yRange[1] >= 1)),
      check('the axes fit the frame width', (ctx) => ofKind(ctx, 'axes').every((a) => (a.xRange[1] - a.xRange[0]) * a.scaleX * a.scale <= 13.5)),
      check('a plot of sin x', (ctx) => ofKind(ctx, 'graphPlot').some((p) => near(evalExpr(p.fn.jsExpr, 1.1), Math.sin(1.1), 1e-6))),
      exportOk,
    ],
    golden: {
      actions: [
        { action: 'CREATE', item: { id: 'ax2', kind: 'axes', label: 'axes', startTime: 0, duration: 1, xRange: [0, 6.5, 1], yRange: [-1.5, 1.5, 0.5], scaleX: 1.5, scaleY: 1.5 } },
        { action: 'CREATE', item: { id: 'sin', kind: 'graphPlot', axesId: 'ax2', label: 'sin', startTime: 1, duration: 1, fn: { jsExpr: 'Math.sin(x)', pyExpr: 'np.sin(x)' }, xDomain: [0, 6.283] } },
      ],
    },
  },
];

