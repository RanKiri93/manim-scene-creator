import type { ShapeItem, ShapePoint } from '@/types/scene';
import type { Segment2 } from '@/lib/matrix';
import { isBoundShape, tickSegments } from '@/lib/shapeAnchors';
import {
  arcAngles,
  arcBetweenPoints,
  arrowTipLength,
  BRACE_BUFF,
  braceGeometry,
  bracePath,
  clampedCornerRadius,
  curvedArrowAngle,
  curvedArrowGeometry,
  DASH_PATTERNS,
  innerRadiusOf,
  POLYLINE_TIP_LENGTH,
  regularPolygonVertices,
} from '@/lib/shapeGeometry';
import { manimSmoothProgress } from '@/lib/visualPlaybackPreview';
import { texPreviewText } from '@/lib/texPreviewText';

/**
 * Canvas preview of a shape's `Create` (export: `Create(shape)`, `generateShapePlay`).
 *
 * Manim's `Create` draws the members of the shape's family one after another (lag ratio 1, each
 * eased with `smooth`), and draws each member curve by curve: a member with n Bézier curves spends
 * 1/n of its time on each curve, whatever its length, and fills the part drawn so far. The parts
 * below follow the order, start points and curve counts Manim 0.20 builds for each shape (an
 * arrow is its shaft, then its tip; a rectangle starts at its top-right corner; a circle has 8
 * curves starting at angle 0; a brace is 25 curves starting at its first end).
 */

/** One family member (or a run of them) that `Create` draws in turn. */
export interface CreatePart {
  /** Curves in drawing order (local scene units, y up), each sampled from its start to its end. */
  curves: ShapePoint[][];
  /** Filled with the shape's fill, with its stroke colour (arrow tips, braces), or not at all. */
  fill: 'shape' | 'stroke' | 'none';
  stroke: boolean;
  /** Family members it stands for: a dashed outline is many dashes, drawn one after another. */
  slots: number;
  /** Drawn evenly along its length (a run of dashes) rather than curve by curve. */
  byLength?: boolean;
  /** Arrow shaft: drawn with the arrow's capped stroke width. */
  shaft?: boolean;
}

export interface ShapeCreatePlan {
  parts: CreatePart[];
  /** Family members after the parts: a brace label's glyphs, drawn last. */
  labelSlots: number;
}

export interface ShapeCreateFrame {
  /** Parts drawn so far, each as the subpaths drawn (local scene units, y up). */
  parts: { part: CreatePart; subpaths: ShapePoint[][] }[];
  /** How far the brace label has been drawn, 0–1. */
  labelProgress: number;
}

const ARC_CURVES = 8;
const SAMPLES_PER_ARC_CURVE = 6;
const SAMPLES_PER_CUBIC = 8;

const deg = (d: number) => (d * Math.PI) / 180;

/** Manim's 8-curve arc of an ellipse around (cx, cy), from `startDeg` turning `sweepDeg`. */
function arcCurves(cx: number, cy: number, rx: number, ry: number, startDeg: number, sweepDeg: number): ShapePoint[][] {
  return Array.from({ length: ARC_CURVES }, (_, i) =>
    Array.from({ length: SAMPLES_PER_ARC_CURVE + 1 }, (_, j) => {
      const a = deg(startDeg + (sweepDeg * (i + j / SAMPLES_PER_ARC_CURVE)) / ARC_CURVES);
      return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
    }),
  );
}

/** One straight curve per edge through `points` (and back to the first when closed). */
function cornerCurves(points: readonly ShapePoint[], closed: boolean): ShapePoint[][] {
  const out: ShapePoint[][] = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i]!, points[i + 1]!]);
  if (closed && points.length > 2) out.push([points[points.length - 1]!, points[0]!]);
  return out;
}

/** A sampled path cut into `n` curves of equal parameter span (Manim's arcs between points). */
function splitIntoCurves(points: readonly ShapePoint[], n: number): ShapePoint[][] {
  if (points.length < 2) return [];
  const at = (s: number): ShapePoint => {
    const k = s * (points.length - 1);
    const i = Math.min(points.length - 2, Math.floor(k));
    return lerp(points[i]!, points[i + 1]!, k - i);
  };
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: SAMPLES_PER_ARC_CURVE + 1 }, (_, j) => at((i + j / SAMPLES_PER_ARC_CURVE) / n)),
  );
}

/** Manim's filled triangle tip: apex, left corner, right corner (3 curves), `length` long and wide. */
function tipCurves(apex: ShapePoint, from: ShapePoint, length: number): ShapePoint[][] {
  const d = Math.hypot(apex.x - from.x, apex.y - from.y) || 1;
  const ux = (apex.x - from.x) / d;
  const uy = (apex.y - from.y) / d;
  const base = { x: apex.x - ux * length, y: apex.y - uy * length };
  const h = length / 2;
  const left = { x: base.x - uy * h, y: base.y + ux * h };
  const right = { x: base.x + uy * h, y: base.y - ux * h };
  return cornerCurves([apex, left, right], true);
}

function lerp(a: ShapePoint, b: ShapePoint, t: number): ShapePoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function cubicSamples(p0: ShapePoint, c1: ShapePoint, c2: ShapePoint, p1: ShapePoint): ShapePoint[] {
  return Array.from({ length: SAMPLES_PER_CUBIC + 1 }, (_, i) => {
    const t = i / SAMPLES_PER_CUBIC;
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    };
  });
}

/**
 * Curves of an SVG path using m, l, h, v, c and z (absolute or relative), one per segment like
 * Manim's SVG import, in the path's own coordinates (y down).
 */
export function svgPathCurves(d: string): ShapePoint[][] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: ShapePoint[][] = [];
  let i = 0;
  let cmd = '';
  let cur: ShapePoint = { x: 0, y: 0 };
  let start = cur;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i]!)) cmd = tokens[i++]!;
    else if (cmd === 'z' || cmd === 'Z' || cmd === '') {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const pt = (x: number, y: number): ShapePoint => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
    switch (cmd.toLowerCase()) {
      case 'm': {
        cur = pt(num(), num());
        start = cur;
        // Further pairs after a move are lines.
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'l': {
        const p = pt(num(), num());
        out.push([cur, p]);
        cur = p;
        break;
      }
      case 'h': {
        const v = num();
        const p = { x: rel ? cur.x + v : v, y: cur.y };
        out.push([cur, p]);
        cur = p;
        break;
      }
      case 'v': {
        const v = num();
        const p = { x: cur.x, y: rel ? cur.y + v : v };
        out.push([cur, p]);
        cur = p;
        break;
      }
      case 'c': {
        const c1 = pt(num(), num());
        const c2 = pt(num(), num());
        const p = pt(num(), num());
        out.push(cubicSamples(cur, c1, c2, p));
        cur = p;
        break;
      }
      case 'z':
        out.push([cur, start]);
        cur = start;
        break;
      default:
        i++;
    }
  }
  return out;
}

/** `BraceBetweenPoints(a, b)`'s curves in local units: the brace path laid along a → b on its right. */
function braceCurves(a: ShapePoint, b: ShapePoint): ShapePoint[][] {
  const w = Math.hypot(b.x - a.x, b.y - a.y);
  if (w < 1e-9) return [];
  const { data, naturalWidth } = bracePath(w);
  const ux = (b.x - a.x) / w;
  const uy = (b.y - a.y) / w;
  const { normal } = braceGeometry(a, b);
  const sx = w / naturalWidth;
  return svgPathCurves(data).map((c) =>
    c.map((p) => ({
      x: a.x + ux * p.x * sx + normal.x * (p.y + BRACE_BUFF),
      y: a.y + uy * p.x * sx + normal.y * (p.y + BRACE_BUFF),
    })),
  );
}

/** Rectangle from its top-right corner, counter-clockwise; rounded corners are one curve each. */
function rectangleCurves(w: number, h: number, r: number): ShapePoint[][] {
  const x = w / 2;
  const y = h / 2;
  if (r <= 1e-6) return cornerCurves([{ x, y }, { x: -x, y }, { x: -x, y: -y }, { x, y: -y }], true);
  const corner = (cx: number, cy: number, from: number) =>
    Array.from({ length: SAMPLES_PER_CUBIC + 1 }, (_, j) => {
      const a = deg(from + (90 * j) / SAMPLES_PER_CUBIC);
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
  return [
    corner(x - r, y - r, 0),
    [{ x: x - r, y }, { x: -x + r, y }],
    corner(-x + r, y - r, 90),
    [{ x: -x, y: y - r }, { x: -x, y: -y + r }],
    corner(-x + r, -y + r, 180),
    [{ x: -x + r, y: -y }, { x: x - r, y: -y }],
    corner(x - r, -y + r, 270),
    [{ x, y: -y + r }, { x, y: y - r }],
  ];
}

const part = (curves: ShapePoint[][], fill: CreatePart['fill'], stroke: boolean, extra: Partial<CreatePart> = {}): CreatePart => ({
  curves,
  fill,
  stroke,
  slots: 1,
  ...extra,
});

/** Parts in Manim's drawing order, before dashing. `dashable` marks outlines a dashed style redraws. */
function solidParts(item: ShapeItem): (CreatePart & { dashable?: boolean })[] {
  const a = { x: -item.endX / 2, y: -item.endY / 2 };
  const b = { x: item.endX / 2, y: item.endY / 2 };
  const outline = (curves: ShapePoint[][], filled = true) => ({ ...part(curves, filled ? 'shape' : 'none', true), dashable: true });
  switch (item.shapeType) {
    case 'circle':
      return [outline(arcCurves(0, 0, item.radius, item.radius, 0, 360))];
    case 'ellipse':
      return [outline(arcCurves(0, 0, item.width / 2, item.height / 2, 0, 360))];
    case 'rectangle':
      return [outline(rectangleCurves(item.width, item.height, clampedCornerRadius(item)))];
    case 'regularPolygon':
      return [outline(cornerCurves(regularPolygonVertices(item.sides, item.radius), true))];
    case 'polygon':
      return [outline(cornerCurves(item.points, true))];
    case 'arc': {
      const { start, sweep } = arcAngles(item);
      return [outline(arcCurves(0, 0, item.radius, item.radius, start, sweep), false)];
    }
    case 'sector': {
      // AnnularSector: inner arc, out to the outer arc's end, outer arc back, in to the start.
      const { start, sweep } = arcAngles(item);
      const ri = innerRadiusOf(item);
      const ro = item.radius;
      const inner = arcCurves(0, 0, ri, ri, start, sweep);
      const outer = arcCurves(0, 0, ro, ro, start + sweep, -sweep);
      const end = deg(start + sweep);
      const s = deg(start);
      return [
        outline([
          ...inner,
          [{ x: ri * Math.cos(end), y: ri * Math.sin(end) }, { x: ro * Math.cos(end), y: ro * Math.sin(end) }],
          ...outer,
          [{ x: ro * Math.cos(s), y: ro * Math.sin(s) }, { x: ri * Math.cos(s), y: ri * Math.sin(s) }],
        ]),
      ];
    }
    case 'annulus': {
      // Outer circle counter-clockwise, then the inner one clockwise (both from angle 0).
      const ri = innerRadiusOf(item);
      return [outline([...arcCurves(0, 0, item.radius, item.radius, 0, 360), ...arcCurves(0, 0, ri, ri, 0, -360)])];
    }
    case 'line': {
      const ticks = tickSegments(a, b, Math.max(0, Math.min(3, Math.round(item.endpoints?.ticks ?? 0))));
      return [{ ...part([[a, b]], 'none', true), dashable: true }, ...ticks.map(([p, q]) => part([[p, q]], 'none', true))];
    }
    case 'arrow':
    case 'doubleArrow': {
      const len = Math.hypot(item.endX, item.endY);
      if (len < 1e-9) return [];
      const tip = arrowTipLength(len);
      const ux = item.endX / len;
      const uy = item.endY / len;
      const double = item.shapeType === 'doubleArrow';
      // Same shaft as the full preview: it stops just inside each tip's base.
      const back = Math.min(tip * 0.9, double ? len / 2 : len);
      const from = double ? { x: a.x + ux * back, y: a.y + uy * back } : a;
      const to = { x: b.x - ux * back, y: b.y - uy * back };
      const parts = [{ ...part([[from, to]], 'none', true, { shaft: true }), dashable: true }, part(tipCurves(b, a, tip), 'stroke', false)];
      if (double) parts.push(part(tipCurves(a, b, tip), 'stroke', false));
      return parts;
    }
    case 'curvedArrow': {
      const g = curvedArrowGeometry(a, b, curvedArrowAngle(item));
      return [
        { ...part(splitIntoCurves(arcBetweenPoints(a, g.tipBase, curvedArrowAngle(item)), ARC_CURVES), 'none', true), dashable: true },
        part(tipCurves(b, g.tipBase, g.tipLength), 'stroke', false),
      ];
    }
    case 'brace':
      return [part(braceCurves(a, b), 'stroke', false)];
    case 'polyline': {
      const pts = item.points;
      if (pts.length < 2) return [];
      const parts: (CreatePart & { dashable?: boolean })[] = [{ ...part(cornerCurves(pts, false), 'none', true), dashable: true }];
      // Each end arrow is an `Arrow` with a hidden shaft: the shaft takes its turn, then the tip.
      const end = (from: ShapePoint, to: ShapePoint) => {
        const d = Math.hypot(to.x - from.x, to.y - from.y);
        if (d < 1e-9) return;
        parts.push(part([], 'none', false), part(tipCurves(to, from, Math.min(POLYLINE_TIP_LENGTH, d)), 'stroke', false));
      };
      if (item.headArrow) end(pts[pts.length - 2]!, pts[pts.length - 1]!);
      if (item.tailArrow) end(pts[1]!, pts[0]!);
      return parts;
    }
    default:
      return [];
  }
}

/** Curves split where one does not start at the previous one's end. */
function subpathsOf(curves: readonly ShapePoint[][]): ShapePoint[][] {
  const out: ShapePoint[][] = [];
  for (const c of curves) {
    if (c.length === 0) continue;
    const last = out[out.length - 1];
    const end = last?.[last.length - 1];
    if (last && end && Math.hypot(end.x - c[0]!.x, end.y - c[0]!.y) < 1e-6) last.push(...c.slice(1));
    else out.push([...c]);
  }
  return out;
}

function pathLength(points: readonly ShapePoint[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return l;
}

/** Whether the export redraws this shape's outline as dashes (`_dashed`, `anyDashedShape`). */
function exportsDashed(item: ShapeItem): boolean {
  return item.shapeType !== 'brace' && !!item.lineStyle && item.lineStyle !== 'solid' && !isBoundShape(item);
}

/** Family members `Create` draws for this shape, in order. */
export function shapeCreatePlan(item: ShapeItem): ShapeCreatePlan {
  const solid = solidParts(item);
  let parts: CreatePart[] = solid;
  if (exportsDashed(item)) {
    // `_dashed`: a fill-only copy first (when filled), then every subpath as its run of dashes.
    const { period } = DASH_PATTERNS[item.lineStyle as 'dashed' | 'dotted'];
    const filled = !!item.fillColor?.trim() && item.fillOpacity > 0;
    parts = solid.flatMap((p) => {
      if (!p.dashable) return [p];
      const out: CreatePart[] = [];
      if (p.fill === 'shape' && filled) out.push(part(p.curves, 'shape', false));
      for (const sp of subpathsOf(p.curves)) {
        out.push(part([sp], 'none', true, { slots: Math.max(2, Math.round(pathLength(sp) / period)), byLength: true, shaft: p.shaft }));
      }
      return out;
    });
  }
  const label = item.shapeType === 'brace' ? texPreviewText(item.braceLabel ?? '').replace(/\s+/g, '') : '';
  return { parts, labelSlots: label.length };
}

/** The first `t` (0–1) of a sampled curve, by its parameter. */
function partialCurve(c: readonly ShapePoint[], t: number): ShapePoint[] {
  if (t >= 1) return [...c];
  const k = t * (c.length - 1);
  const i = Math.floor(k);
  return [...c.slice(0, i + 1), lerp(c[i]!, c[Math.min(i + 1, c.length - 1)]!, k - i)];
}

/** The first `t` (0–1) of a path, by length. */
function partialByLength(points: readonly ShapePoint[], t: number): ShapePoint[] {
  if (t >= 1) return [...points];
  let left = pathLength(points) * t;
  const out: ShapePoint[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d >= left) {
      out.push(d > 0 ? lerp(a, b, left / d) : b);
      break;
    }
    out.push(b);
    left -= d;
  }
  return out;
}

/** What `pointwise_become_partial(part, 0, alpha)` keeps: whole curves, then part of the next. */
export function partialCreatePart(p: CreatePart, alpha: number): ShapePoint[][] {
  if (alpha <= 0 || p.curves.length === 0) return [];
  if (p.byLength) return subpathsOf(p.curves).map((sp) => partialByLength(sp, alpha));
  const n = p.curves.length;
  const k = Math.min(1, alpha) * n;
  const whole = Math.min(n, Math.floor(k));
  const curves = p.curves.slice(0, whole);
  if (whole < n && k > whole) curves.push(partialCurve(p.curves[whole]!, k - whole));
  return subpathsOf(curves);
}

/**
 * Progress of a run of `slots` family members starting at member `first`, when `Create` (lag
 * ratio 1, `smooth` per member) is at linear progress `p` over `total` members.
 */
function runProgress(p: number, first: number, slots: number, total: number): number {
  if (slots <= 0) return 1;
  const local = p * total - first;
  if (local <= 0) return 0;
  const whole = Math.min(slots, Math.floor(local));
  if (whole >= slots) return 1;
  return (whole + manimSmoothProgress(local - whole)) / slots;
}

/** What `Create` has drawn at linear progress `p` (0–1) of its run time. */
export function shapeCreateFrame(plan: ShapeCreatePlan, p: number): ShapeCreateFrame {
  const total = plan.parts.reduce((s, q) => s + q.slots, 0) + plan.labelSlots;
  const parts: ShapeCreateFrame['parts'] = [];
  let first = 0;
  for (const q of plan.parts) {
    const alpha = total > 0 ? runProgress(p, first, q.slots, total) : 1;
    first += q.slots;
    if (alpha > 0) parts.push({ part: q, subpaths: partialCreatePart(q, alpha) });
  }
  return { parts, labelProgress: total > 0 ? runProgress(p, first, plan.labelSlots, total) : 1 };
}

/**
 * `Create` of a surrounding rectangle (`SurroundingRectangle`: drawn like `Rectangle`, from its
 * top-right corner) around `box`, or of a matrix strike (`strike_lines`: a group of `Line`s, one
 * after another, in `strike` order). Scene units.
 */
export function surroundCreatePlan(
  box: { left: number; right: number; bottom: number; top: number },
  cornerRadius: number,
  strike?: readonly Segment2[] | null,
): ShapeCreatePlan {
  if (strike) {
    return { parts: strike.map((s) => part([[{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]], 'none', true)), labelSlots: 0 };
  }
  const w = Math.abs(box.right - box.left);
  const h = Math.abs(box.top - box.bottom);
  const cx = (box.left + box.right) / 2;
  const cy = (box.bottom + box.top) / 2;
  const r = Math.min(Math.max(0, cornerRadius), w / 2, h / 2);
  const curves = rectangleCurves(w, h, r).map((c) => c.map((p) => ({ x: p.x + cx, y: p.y + cy })));
  return { parts: [part(curves, 'none', true)], labelSlots: 0 };
}
