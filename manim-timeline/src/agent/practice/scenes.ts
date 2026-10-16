import {
  createAxes,
  createGraphArea,
  createGraphCurve,
  createGraphDotItem,
  createGraphPlot,
  createTargetAnimation,
  createTextLine,
  defaultSceneDefaults,
} from '@/store/factories';
import type { GraphPlotItem, SceneItem, TextLineItem } from '@/types/scene';

/** Starting scenes for the practice set. Ids are fixed so prompts can name them. */

export function axes(xRange: [number, number], yRange: [number, number], scaleX = 1, scaleY = 1): SceneItem {
  const a = createAxes(defaultSceneDefaults(), 0);
  a.id = 'ax';
  a.label = 'axes';
  a.duration = 1;
  a.xRange = [xRange[0], xRange[1], Math.max(0.5, Math.round((xRange[1] - xRange[0]) / 6))];
  a.yRange = [yRange[0], yRange[1], Math.max(0.5, Math.round((yRange[1] - yRange[0]) / 6))];
  a.scaleX = scaleX;
  a.scaleY = scaleY;
  return a;
}

export function plot(jsExpr: string, pyExpr: string, xDomain: [number, number], id = 'p', color = '#3b82f6'): GraphPlotItem {
  const p = createGraphPlot('ax', 1);
  p.id = id;
  p.label = 'f';
  p.duration = 1;
  p.fn = { ...p.fn, jsExpr, pyExpr, color };
  p.xDomain = xDomain;
  return p;
}

/** Axes [-1, 3] × [-1, 5], f(x) = x² on [0, 2]. */
export function parabola(): SceneItem[] {
  return [axes([-1, 3], [-1, 5]), plot('x*x', 'x**2', [0, 2])];
}

/** The parabola with dot "d" on it at x = 0 from 2 s, moving to x = 2 over 3–5 s (linear). */
export function movingPoint(): SceneItem[] {
  const d = createGraphDotItem('ax', 2);
  d.id = 'd';
  d.label = 'P';
  d.duration = 0.5;
  d.dot = { ...d.dot, label: '$P$', attachment: { kind: 'function', graphPlotId: 'p', x: 0 } };
  const m = createTargetAnimation('graphFollow', ['d'], 3, 2);
  m.id = 'm';
  m.label = 'move P';
  m.targets[0] = { targetId: 'd', targetX: 2, easing: 'linear' };
  return [...parabola(), d, m];
}

/** Wide axes [0, 20] × [-2, 2] with 1.5 sin x and dot "d" travelling x = 0 → 20 over 2–7 s. */
export function widePoint(): SceneItem[] {
  const d = createGraphDotItem('ax', 1.5);
  d.id = 'd';
  d.label = 'P';
  d.duration = 0.5;
  d.dot = { ...d.dot, attachment: { kind: 'function', graphPlotId: 'p', x: 0 } };
  const m = createTargetAnimation('graphFollow', ['d'], 2, 5);
  m.id = 'm';
  m.label = 'travel';
  m.targets[0] = { targetId: 'd', targetX: 20, easing: 'linear' };
  return [axes([0, 20], [-2, 2], 0.6, 1), plot('1.5*Math.sin(x)', '1.5*np.sin(x)', [0, 20]), d, m];
}

/** A Lissajous curve "c" with dot "d" going round it over 2–6 s. */
export function lissajous(): SceneItem[] {
  const c = createGraphCurve('ax', 0.5);
  c.id = 'c';
  c.label = 'Lissajous';
  c.duration = 0.5;
  c.curve = { ...c.curve, jsXExpr: '1.5*Math.sin(3*t)', jsYExpr: '1.5*Math.sin(2*t)', pyXExpr: '1.5*np.sin(3*t)', pyYExpr: '1.5*np.sin(2*t)' };
  c.tDomain = [0, 6.3];
  const d = createGraphDotItem('ax', 1);
  d.id = 'd';
  d.label = 'P';
  d.duration = 0.3;
  d.dot = { ...d.dot, attachment: { kind: 'parametric', graphCurveId: 'c', t: 0 } };
  const m = createTargetAnimation('graphFollow', ['d'], 2, 4);
  m.id = 'm';
  m.label = 'round';
  m.targets[0] = { targetId: 'd', targetT: 6.28, easing: 'linear' };
  return [axes([-2, 2], [-2, 2], 1.6, 1.6), c, d, m];
}

export function textLine(id: string, raw: string, x: number, y: number, startTime = 0): TextLineItem {
  const t = createTextLine(defaultSceneDefaults(), startTime);
  t.id = id;
  t.label = id;
  t.raw = raw;
  t.x = x;
  t.y = y;
  t.duration = 1;
  t.segments = [{ ...t.segments[0]!, text: raw.replace(/^\$|\$$/g, ''), isMath: raw.startsWith('$') }];
  return t;
}

/** The parabola with a shaded area "a" under it on [0.5, 1.5]. */
export function shaded(): SceneItem[] {
  const a = createGraphArea('ax', 2);
  a.id = 'a';
  a.label = 'area';
  a.mode = { areaKind: 'underCurve', xMin: 0.5, xMax: 1.5, curve: { sourceKind: 'plot', plotId: 'p' }, showBoundaryPlot: false };
  return [...parabola(), a];
}
