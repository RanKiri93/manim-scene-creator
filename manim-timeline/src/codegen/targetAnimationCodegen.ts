import type {
  BlinkTargetSpec,
  GraphDotItem,
  ItemId,
  SceneItem,
  ShapePoint,
  TargetAnimationParametricPath,
  TargetAnimationItem,
  TargetAnimationTargetSpec,
} from '@/types/scene';
import { permanentBlinkStyleParts } from './blinkCodegen';
import { canBeTargetAnimationTarget } from '@/lib/time';
import {
  overlayDotVar,
  pythonOverlaySuffix,
  resolveExitTargetsForExport,
} from './graphCodegen';

export function targetAnimationClipHasActiveTargets(clip: TargetAnimationItem): boolean {
  return clip.targets.length > 0;
}

function toBlinkSpec(
  row: TargetAnimationTargetSpec,
  mode: 'scale' | 'color',
): BlinkTargetSpec {
  const b: BlinkTargetSpec = {
    targetId: row.targetId,
    mode,
  };
  if (typeof row.scaleFactor === 'number' && Number.isFinite(row.scaleFactor)) {
    b.scaleFactor = row.scaleFactor;
  }
  const c = typeof row.color === 'string' ? row.color.trim() : '';
  if (c) b.blinkColor = c;
  if (row.segmentIndices != null && row.segmentIndices.length > 0) {
    b.segmentIndices = row.segmentIndices;
  }
  if (row.mathSubtargets != null && row.mathSubtargets.length > 0) {
    b.mathSubtargets = row.mathSubtargets;
  }
  return b;
}

function shiftVecExpr(dx: number, dy: number): string {
  const parts: string[] = [];
  if (Math.abs(dx) > 1e-9) parts.push(`${dx.toFixed(6)} * RIGHT`);
  if (Math.abs(dy) > 1e-9) parts.push(`${dy.toFixed(6)} * UP`);
  if (parts.length === 0) return 'ORIGIN';
  return parts.join(' + ');
}

function pathCornersExpr(points: ShapePoint[] | undefined): string | null {
  if (!points || points.length < 2) return null;
  return points
    .map((p) => `${p.x.toFixed(6)} * RIGHT + ${p.y.toFixed(6)} * UP`)
    .join(', ');
}

function absolutePathCornersExpr(
  points: ShapePoint[] | undefined,
  anchorMobExpr: string,
): string | null {
  if (!points || points.length < 2) return null;
  return points
    .map(
      (p) =>
        `${anchorMobExpr}.get_center() + ${p.x.toFixed(6)} * RIGHT + ${p.y.toFixed(6)} * UP`,
    )
    .join(', ');
}

function oneLinePyExpr(expr: string | undefined, fallback: string): string {
  const s = (expr ?? '').trim();
  return (s || fallback).replace(/\s+/g, ' ');
}

function parametricPathSetupLines(
  pathVar: string,
  spec: TargetAnimationParametricPath | null | undefined,
  anchorMobExpr: string,
  pad: string,
): string[] | null {
  if (!spec) return null;
  const px = oneLinePyExpr(spec.pyXExpr, '0');
  const py = oneLinePyExpr(spec.pyYExpr, '0');
  const t0 = Number.isFinite(spec.tMin) ? spec.tMin : 0;
  const t1 = Number.isFinite(spec.tMax) ? spec.tMax : 1;
  if (Math.abs(t1 - t0) < 1e-9) return null;
  const t0Var = `${pathVar}_t0`;
  const x0Var = `${pathVar}_x0`;
  const y0Var = `${pathVar}_y0`;
  return [
    `${pad}${t0Var} = ${t0.toFixed(6)}\n`,
    `${pad}${x0Var} = (lambda t: ${px})(${t0Var})\n`,
    `${pad}${y0Var} = (lambda t: ${py})(${t0Var})\n`,
    `${pad}${pathVar} = ParametricFunction(\n` +
      `${pad}    lambda t: ${anchorMobExpr}.get_center() + ((${px}) - ${x0Var}) * RIGHT + ((${py}) - ${y0Var}) * UP,\n` +
      `${pad}    t_range=[${t0.toFixed(6)}, ${t1.toFixed(6)}],\n` +
      `${pad})\n`,
  ];
}

function firstTargetMobExprForPath(
  target: SceneItem,
  idToVarName: Map<ItemId, string>,
): string | null {
  if (target.kind === 'graphDot') {
    const axVar = idToVarName.get(target.axesId);
    return axVar ? overlayDotVar(axVar, target.id) : null;
  }
  if (target.kind === 'graphField' && target.fieldMode !== 'none') {
    const axVar = idToVarName.get(target.axesId);
    return axVar ? `${axVar}_vf_${pythonOverlaySuffix(target.id)}` : null;
  }
  const expr = resolveExitTargetsForExport(target, idToVarName, 'exit');
  const first = expr?.split(',').map((s: string) => s.trim()).filter(Boolean)[0];
  return first ?? null;
}

function movePartsForTarget(mobExpr: string, dx: number, dy: number): string[] {
  const vec = shiftVecExpr(dx, dy);
  if (vec === 'ORIGIN') return [];
  const parts = mobExpr.split(',').map((s: string) => s.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return [`${parts[0] ?? mobExpr}.animate.shift(${vec})`];
  }
  const anims = parts.map((p) => `${p}.animate.shift(${vec})`);
  return [
    anims.length === 1
      ? anims[0]!
      : `AnimationGroup(${anims.join(', ')}, lag_ratio=0)`,
  ];
}

function rotatePartsForMob(mobExpr: string, angleDeg: number): string[] {
  if (Math.abs(angleDeg) < 1e-9) return [];
  return [`${mobExpr}.animate.rotate(${angleDeg.toFixed(6)} * DEGREES)`];
}

function rotateRowGraphDot(
  item: GraphDotItem,
  angleDeg: number,
  idToVarName: Map<ItemId, string>,
): string[] | null {
  if (Math.abs(angleDeg) < 1e-9) return [];
  const axVar = idToVarName.get(item.axesId);
  if (!axVar) return null;
  const dVar = overlayDotVar(axVar, item.id);
  const lbl = item.dot.label.trim();
  const rDot = `${dVar}.animate.rotate(${angleDeg.toFixed(6)} * DEGREES)`;
  if (!lbl) return [rDot];
  const rLbl = `${dVar}_lbl.animate.rotate(${angleDeg.toFixed(6)} * DEGREES)`;
  return [`AnimationGroup(${rDot}, ${rLbl}, lag_ratio=0)`];
}

function rotateRowGraphField(
  target: Extract<SceneItem, { kind: 'graphField' }>,
  angleDeg: number,
  idToVarName: Map<ItemId, string>,
): string[] | null {
  if (target.fieldMode === 'none' || Math.abs(angleDeg) < 1e-9) return [];
  const axVar = idToVarName.get(target.axesId);
  if (!axVar) return null;
  const suf = pythonOverlaySuffix(target.id);
  const vfVar = `${axVar}_vf_${suf}`;
  const streamsVar = `${axVar}_streams_${suf}`;
  const seeds = target.streamPoints ?? [];
  const rVf = `${vfVar}.animate.rotate(${angleDeg.toFixed(6)} * DEGREES)`;
  if (seeds.length === 0) return [rVf];
  const rSt = `${streamsVar}.animate.rotate(${angleDeg.toFixed(6)} * DEGREES)`;
  return [`AnimationGroup(${rVf}, ${rSt}, lag_ratio=0)`];
}

/**
 * Build one row's animation expressions (each is a single `self.play` arg / MoveAlongPath wrapper).
 */
export function targetAnimationRowAnimParts(
  clip: TargetAnimationItem,
  row: TargetAnimationTargetSpec,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
  pathVarName: string,
): string[] | null {
  const tgt = itemsMap.get(row.targetId);
  if (!tgt || !canBeTargetAnimationTarget(tgt, clip.mode)) return null;

  const mode = clip.mode;

  if (mode === 'scale') {
    return permanentBlinkStyleParts(
      tgt,
      toBlinkSpec(row, 'scale'),
      idToVarName,
      itemsMap,
    );
  }

  if (mode === 'color') {
    return permanentBlinkStyleParts(
      tgt,
      toBlinkSpec(row, 'color'),
      idToVarName,
      itemsMap,
    );
  }

  if (mode === 'move') {
    const dx = typeof row.dx === 'number' && Number.isFinite(row.dx) ? row.dx : 0;
    const dy = typeof row.dy === 'number' && Number.isFinite(row.dy) ? row.dy : 0;
    if (tgt.kind === 'graphDot') {
      const axVar = idToVarName.get(tgt.axesId);
      if (!axVar) return null;
      const dVar = overlayDotVar(axVar, tgt.id);
      const vec = shiftVecExpr(dx, dy);
      if (vec === 'ORIGIN') return null;
      const dotP = `${dVar}.animate.shift(${vec})`;
      if (!tgt.dot.label.trim()) return [dotP];
      const lblP = `${dVar}_lbl.animate.shift(${vec})`;
      return [`AnimationGroup(${dotP}, ${lblP}, lag_ratio=0)`];
    }
    if (tgt.kind === 'graphField' && tgt.fieldMode !== 'none') {
      const axVar = idToVarName.get(tgt.axesId);
      if (!axVar) return null;
      const suf = pythonOverlaySuffix(tgt.id);
      const vfVar = `${axVar}_vf_${suf}`;
      const streamsVar = `${axVar}_streams_${suf}`;
      const vec = shiftVecExpr(dx, dy);
      if (vec === 'ORIGIN') return null;
      const a = `${vfVar}.animate.shift(${vec})`;
      const seeds = tgt.streamPoints ?? [];
      if (seeds.length === 0) return [a];
      const b = `${streamsVar}.animate.shift(${vec})`;
      return [`AnimationGroup(${a}, ${b}, lag_ratio=0)`];
    }
    const expr = resolveExitTargetsForExport(tgt, idToVarName, 'exit');
    if (!expr) return null;
    const parts = movePartsForTarget(expr, dx, dy);
    return parts.length > 0 ? parts : null;
  }

  if (mode === 'path') {
    if (row.pathKind === 'parametric' && !row.parametricPath) return null;
    if (row.pathKind !== 'parametric' && !pathCornersExpr(row.pathPoints)) return null;
    if (tgt.kind === 'graphDot') {
      const axVar = idToVarName.get(tgt.axesId);
      if (!axVar) return null;
      const dVar = overlayDotVar(axVar, tgt.id);
      const dotM = `MoveAlongPath(${dVar}, ${pathVarName})`;
      if (!tgt.dot.label.trim()) return [dotM];
      const lblM = `MoveAlongPath(${dVar}_lbl, ${pathVarName})`;
      return [`AnimationGroup(${dotM}, ${lblM}, lag_ratio=0)`];
    }
    if (tgt.kind === 'graphField' && tgt.fieldMode !== 'none') {
      const axVar = idToVarName.get(tgt.axesId);
      if (!axVar) return null;
      const suf = pythonOverlaySuffix(tgt.id);
      const vfVar = `${axVar}_vf_${suf}`;
      const streamsVar = `${axVar}_streams_${suf}`;
      const vfM = `MoveAlongPath(${vfVar}, ${pathVarName})`;
      const seeds = tgt.streamPoints ?? [];
      if (seeds.length === 0) return [vfM];
      const stM = `MoveAlongPath(${streamsVar}, ${pathVarName})`;
      return [`AnimationGroup(${vfM}, ${stM}, lag_ratio=0)`];
    }
    const expr = resolveExitTargetsForExport(tgt, idToVarName, 'exit');
    if (!expr) return null;
    const ps = expr.split(',').map((s: string) => s.trim()).filter(Boolean);
    if (ps.length === 0) return null;
    if (ps.length === 1) {
      return [`MoveAlongPath(${ps[0]!}, ${pathVarName})`];
    }
    const inners = ps.map((p: string) => `MoveAlongPath(${p}, ${pathVarName})`);
    return [`AnimationGroup(${inners.join(', ')}, lag_ratio=0)`];
  }

  if (mode === 'rotate') {
    const ang =
      typeof row.angleDeg === 'number' && Number.isFinite(row.angleDeg)
        ? row.angleDeg
        : 0;
    if (tgt.kind === 'graphDot') {
      return rotateRowGraphDot(tgt, ang, idToVarName);
    }
    if (tgt.kind === 'graphField') {
      return rotateRowGraphField(tgt, ang, idToVarName);
    }
    const expr = resolveExitTargetsForExport(tgt, idToVarName, 'exit');
    if (!expr) return null;
    const parts = expr.split(',').map((s: string) => s.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.length === 1) {
      return rotatePartsForMob(parts[0]!, ang);
    }
    const rots = parts.flatMap((p: string) => rotatePartsForMob(p, ang));
    if (rots.length === 0) return null;
    return rots.length === 1 ? rots : [`AnimationGroup(${rots.join(', ')}, lag_ratio=0)`];
  }

  return null;
}

let pathVarNonce = 0;

function allocPathVar(clipId: ItemId): string {
  pathVarNonce += 1;
  const slug = clipId.replace(/[^a-zA-Z0-9_]/g, '_');
  return `ta_path_${slug.slice(0, 8)}_${pathVarNonce}`;
}

/**
 * Setup lines + one `self.play(...)` line.
 */
export function buildTargetAnimationPlayBlock(
  clip: TargetAnimationItem,
  pad: string,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
): { setup: string; innerPlayArg: string; runTimeStr: string } {
  const rt = Math.max(0.05, clip.duration).toFixed(4);
  type RowWork = { parts: string[] };
  const rows: RowWork[] = [];
  const setups: string[] = [];

  if (clip.mode === 'path') {
    for (const row of clip.targets) {
      const target = itemsMap.get(row.targetId);
      const anchor = target ? firstTargetMobExprForPath(target, idToVarName) : null;
      const corners =
        anchor && row.pathKind !== 'parametric'
          ? absolutePathCornersExpr(row.pathPoints, anchor)
          : null;
      const canBuildPath =
        anchor != null &&
        (row.pathKind === 'parametric' ? row.parametricPath != null : corners != null);
      const pathVar = canBuildPath ? allocPathVar(clip.id) : undefined;
      let parts: string[] | null = null;
      if (pathVar && anchor) {
        if (row.pathKind === 'parametric') {
          const lines = parametricPathSetupLines(
            pathVar,
            row.parametricPath,
            anchor,
            pad,
          );
          if (lines) {
            setups.push(...lines);
            parts = targetAnimationRowAnimParts(clip, row, idToVarName, itemsMap, pathVar);
          }
        } else if (corners) {
          setups.push(
            `${pad}${pathVar} = VMobject()\n${pad}${pathVar}.set_points_as_corners([${corners}])\n`,
          );
          parts = targetAnimationRowAnimParts(clip, row, idToVarName, itemsMap, pathVar);
        }
      }
      rows.push({ parts: parts ?? [] });
    }
  } else {
    const dummy = 'path_unused';
    for (const row of clip.targets) {
      const parts = targetAnimationRowAnimParts(clip, row, idToVarName, itemsMap, dummy);
      rows.push({ parts: parts ?? [] });
    }
  }

  const flat: string[] = [];
  for (const r of rows) {
    for (const p of r.parts) flat.push(p);
  }
  const setup = setups.join('');
  if (flat.length === 0) {
    return { setup, innerPlayArg: '', runTimeStr: rt };
  }
  const inner =
    flat.length === 1 ? flat[0]! : `AnimationGroup(${flat.join(', ')}, lag_ratio=0)`;
  return { setup, innerPlayArg: inner, runTimeStr: rt };
}

export function formatTargetAnimationClipPlay(
  clip: TargetAnimationItem,
  pad: string,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
): string {
  const { setup, innerPlayArg, runTimeStr } = buildTargetAnimationPlayBlock(
    clip,
    pad,
    idToVarName,
    itemsMap,
  );
  if (!innerPlayArg) return '';
  return `${setup}${pad}self.play(${innerPlayArg}, run_time=${runTimeStr})\n`;
}

/**
 * Inner animation expression for concurrent cluster (blink-style comma child).
 */
export function buildTargetAnimationConcurrentSuccessionInner(
  clip: TargetAnimationItem,
  _relWait: number,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
): string | null {
  if (clip.mode === 'path') return null;
  const { setup, innerPlayArg } = buildTargetAnimationPlayBlock(
    clip,
    '',
    idToVarName,
    itemsMap,
  );
  if (!innerPlayArg) return null;
  if (setup.trim()) return null;
  return innerPlayArg;
}
