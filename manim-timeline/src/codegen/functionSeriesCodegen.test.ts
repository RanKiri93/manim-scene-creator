import { describe, expect, it } from 'vitest';
import type {
  AxesItem,
  GraphFunctionSeriesItem,
  ItemId,
} from '@/types/scene';
import {
  anyReplacementFunctionSeries,
  functionSeriesConcurrentBranch,
  functionSeriesCurveVar,
  functionSeriesRevealTransformSource,
  FS_REVEAL_TRANSFORM_CLASS_NAME,
  generateGraphFunctionSeriesDef,
  generateGraphFunctionSeriesPlay,
} from '@/codegen/functionSeriesCodegen';
import { resolveExitTargetsForExport } from '@/codegen/graphCodegen';

function axes(id: string): AxesItem {
  return {
    kind: 'axes',
    id,
    label: id,
    layer: 0,
    startTime: 0,
    duration: 4,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    xRange: [-5, 5, 1],
    yRange: [-5, 5, 1],
    xLabel: 'x',
    yLabel: 'y',
    includeNumbers: true,
    includeTip: true,
    scaleX: 1,
    scaleY: 1,
  };
}

function fs(
  id: string,
  axesId: ItemId,
  over: Partial<GraphFunctionSeriesItem> = {},
): GraphFunctionSeriesItem {
  return {
    kind: 'graphFunctionSeries',
    id,
    label: id,
    layer: 0,
    startTime: 0,
    duration: 0,
    x: 0,
    y: 0,
    scale: 1,
    posSteps: [{ kind: 'absolute' }],
    axesId,
    jsExpr: 'Math.sin(n * x)',
    pyExpr: 'np.sin(n * x)',
    nMin: 1,
    nMax: 3,
    mode: 'accumulation',
    xDomain: null,
    defaults: {
      color: '#ff0000',
      strokeWidth: 2,
      lineStyle: 'solid',
      animDuration: 1,
      waitAfter: 0.5,
    },
    perN: {},
    ...over,
  };
}

describe('function series codegen', () => {
  it('emits a builder and one VMobject per n in the def block', () => {
    const ax = axes('ax');
    const item = fs('s1', ax.id);
    const code = generateGraphFunctionSeriesDef(item, 'axes_1', 4);
    expect(code).toContain('def axes_1_fs_s1_build(');
    for (const n of [1, 2, 3]) {
      const v = functionSeriesCurveVar('axes_1', item.id, n);
      expect(code).toContain(`${v} = axes_1_fs_s1_build(${n}`);
    }
    expect(code).toContain('axes_1_fs_s1 = VGroup()');
  });

  it('accumulation def does NOT hide any curves (every n is an introducer via Create)', () => {
    const ax = axes('ax');
    const item = fs('s1', ax.id, { mode: 'accumulation' });
    const code = generateGraphFunctionSeriesDef(item, 'axes_1', 4);
    expect(code).not.toMatch(/\.set_stroke\(opacity=0\)/);
    expect(code).not.toMatch(/\.set_opacity\(0\)/);
  });

  it('replacement def hides non-first curves with set_stroke(opacity=0)', () => {
    // Ghost-at-start fix: `ReplacementTransform` is NOT an introducer, so the
    // outer concurrent `AnimationGroup.begin()` pre-registers every curve on
    // the scene. Hiding n2..nK in the def keeps them out of sight until their
    // transform runs. Only stroke opacity is touched — `set_opacity` would
    // also lift the default `fill_opacity=0` to 1 and render a filled area.
    const ax = axes('ax');
    const item = fs('s1', ax.id, { mode: 'replacement', nMin: 1, nMax: 3 });
    const code = generateGraphFunctionSeriesDef(item, 'axes_1', 4);
    expect(code).not.toContain('axes_1_fs_s1_n1.set_stroke(opacity=0)');
    expect(code).toContain('axes_1_fs_s1_n2.set_stroke(opacity=0)');
    expect(code).toContain('axes_1_fs_s1_n3.set_stroke(opacity=0)');
    // Must never emit whole-mobject set_opacity (would fill the curve).
    expect(code).not.toMatch(/\.set_opacity\(0\)/);
  });

  it('accumulation play emits Create + wait per n (no wait after last)', () => {
    const ax = axes('ax');
    const item = fs('s1', ax.id, { mode: 'accumulation' });
    const code = generateGraphFunctionSeriesPlay(item, 'axes_1', 4, new Map());
    const creates = code.match(/Create\(axes_1_fs_s1_n/g) ?? [];
    expect(creates).toHaveLength(3);
    const waits = code.match(/self\.wait\(/g) ?? [];
    expect(waits).toHaveLength(2);
  });

  it('replacement play emits Create then _FSRevealTransform for subsequent n', () => {
    const ax = axes('ax');
    const item = fs('s1', ax.id, { mode: 'replacement' });
    const code = generateGraphFunctionSeriesPlay(item, 'axes_1', 4, new Map());
    const creates = code.match(/Create\(axes_1_fs_s1_n/g) ?? [];
    expect(creates).toHaveLength(1);
    const replacements = code.match(/_FSRevealTransform\(/g) ?? [];
    expect(replacements).toHaveLength(2);
  });

  it('replacement play sources every transform from the FIRST curve (no chain of predecessors)', () => {
    // Design note. A chain of `_FSRevealTransform(n_{k-1}, n_k)` would leave
    // every predecessor on the scene until `clean_up_from_scene` fires,
    // which inside a concurrent `Succession` only happens at the very end of
    // the outer `self.play(AnimationGroup(...))`. That lingering source
    // mobject is what made earlier curves stay visible behind later morphs.
    // The current design keeps a single on-scene mobject (n_1) and morphs it
    // in place toward every subsequent shape via `Transform`.
    const ax = axes('ax');
    const item = fs('s1', ax.id, { mode: 'replacement', nMin: 1, nMax: 3 });
    const code = generateGraphFunctionSeriesPlay(item, 'axes_1', 0, new Map());
    expect(code).toContain(
      'self.play(_FSRevealTransform(axes_1_fs_s1_n1, axes_1_fs_s1_n2)',
    );
    expect(code).toContain(
      'self.play(_FSRevealTransform(axes_1_fs_s1_n1, axes_1_fs_s1_n3)',
    );
    // The predecessor-chain form must never reappear.
    expect(code).not.toContain(
      '_FSRevealTransform(axes_1_fs_s1_n2, axes_1_fs_s1_n3',
    );
    // The older pre-play restore/reveal attempts must not resurface.
    expect(code).not.toMatch(/\.set_stroke\(opacity=1\)/);
    expect(code).not.toMatch(/\.set_opacity\(1\)/);
    // Plain `ReplacementTransform(` would leave the source on-scene until
    // cleanup (the bug the helper avoids). Helper must be used.
    expect(code).not.toMatch(/self\.play\(ReplacementTransform\(/);
  });

  it('concurrent branch returns a Succession containing all n', () => {
    const ax = axes('ax');
    const item = fs('s1', ax.id, { mode: 'accumulation' });
    const branch = functionSeriesConcurrentBranch(item, 'axes_1', 0);
    expect(branch).toMatch(/^Succession\(/);
    expect(
      (branch.match(/Create\(axes_1_fs_s1_n/g) ?? []).length,
    ).toBe(3);
  });

  it('replacement concurrent branch sources every transform from the first curve (single on-scene mobject)', () => {
    const ax = axes('ax');
    const item = fs('s1', ax.id, { mode: 'replacement', nMin: 1, nMax: 3 });
    const branch = functionSeriesConcurrentBranch(item, 'axes_1', 0);
    expect(branch).toContain(
      '_FSRevealTransform(axes_1_fs_s1_n1, axes_1_fs_s1_n2',
    );
    expect(branch).toContain(
      '_FSRevealTransform(axes_1_fs_s1_n1, axes_1_fs_s1_n3',
    );
    // The predecessor-chain form would cause intermediate sources to linger
    // on the scene throughout the cluster (cleanup only fires at end of
    // outer `self.play`). Must not appear.
    expect(branch).not.toContain(
      '_FSRevealTransform(axes_1_fs_s1_n2, axes_1_fs_s1_n3',
    );
    // A previous attempt used `cvar.animate(...).set_stroke(opacity=1)` as an
    // in-Succession reveal; that also added cvar as a *source* of the outer
    // AnimationGroup.group and pre-flashed the curve. Must not reappear.
    expect(branch).not.toMatch(/\.animate\([^)]*\)\.set_stroke\(/);
    expect(branch).not.toMatch(/\.animate\([^)]*\)\.set_opacity\(/);
    // Only `Create` and `_FSRevealTransform` are valid primitives here.
    expect(branch).not.toMatch(/\bReplacementTransform\(/);
  });

  it('accumulation concurrent branch emits no opacity reveals and no helper class (no ghosting risk)', () => {
    const ax = axes('ax');
    const item = fs('s1', ax.id, { mode: 'accumulation', nMin: 1, nMax: 3 });
    const branch = functionSeriesConcurrentBranch(item, 'axes_1', 0);
    expect(branch).not.toMatch(/\.animate\([^)]*\)\.set_stroke\(/);
    expect(branch).not.toMatch(/\.animate\([^)]*\)\.set_opacity\(/);
    expect(branch).not.toContain('_FSRevealTransform');
  });

  it('emits empty play for invalid range', () => {
    const ax = axes('ax');
    const item = fs('s1', ax.id, { nMin: 3, nMax: 1 });
    const code = generateGraphFunctionSeriesPlay(item, 'axes_1', 4, new Map());
    expect(code).toBe('');
  });
});

describe('_FSRevealTransform helper + detection', () => {
  it('helper class subclasses Transform (not ReplacementTransform) and only toggles stroke opacity', () => {
    // Design note. With predecessor-chain `ReplacementTransform`s, each
    // transform's `scene.replace(self.mobject, self.target_mobject)` runs
    // only at `clean_up_from_scene`, which inside a concurrent
    // `Succession` is deferred to the end of the outer `self.play(...)`.
    // That left every intermediate source curve on the scene behind
    // subsequent morphs. The current design sources every transform from
    // the series' first curve `n_1` and morphs it in place via `Transform`
    // — so there is only ever one on-scene mobject and no `scene.replace`
    // is needed.
    const src = functionSeriesRevealTransformSource(0);
    expect(src).toContain(
      `class ${FS_REVEAL_TRANSFORM_CLASS_NAME}(Transform):`,
    );
    // Reveals the snapshot, re-hides the on-scene target. No clean_up
    // override is required (Transform leaves the source on-scene, which is
    // exactly what we want).
    expect(src).toMatch(
      /def begin\(self\):[\s\S]*self\.target_mobject\.set_stroke\(opacity=1\)[\s\S]*super\(\)\.begin\(\)[\s\S]*self\.target_mobject\.set_stroke\(opacity=0\)/,
    );
    // Must NOT subclass ReplacementTransform — `scene.replace(...)` cleanup
    // is the very thing we are avoiding.
    expect(src).not.toContain('(ReplacementTransform)');
    // Must NOT override clean_up_from_scene — Transform's default is
    // correct (no scene.replace, source stays on scene looking like target).
    expect(src).not.toContain('def clean_up_from_scene');
    // Critical: never touches fill opacity via set_opacity (would lift the
    // `ParametricFunction` default `fill_opacity=0` and render a filled
    // area beneath the curve).
    expect(src).not.toMatch(/\.set_opacity\(/);
  });

  it('helper source respects the requested indent', () => {
    const src = functionSeriesRevealTransformSource(4);
    expect(src.startsWith('    class ')).toBe(true);
  });

  it('anyReplacementFunctionSeries detects replacement-mode series with >=2 curves', () => {
    const ax = axes('ax');
    expect(
      anyReplacementFunctionSeries([
        fs('s', ax.id, { mode: 'replacement', nMin: 1, nMax: 3 }),
      ]),
    ).toBe(true);
    expect(
      anyReplacementFunctionSeries([
        fs('s', ax.id, { mode: 'accumulation', nMin: 1, nMax: 3 }),
      ]),
    ).toBe(false);
    // Single-curve replacement has nothing to transform — no helper needed.
    expect(
      anyReplacementFunctionSeries([
        fs('s', ax.id, { mode: 'replacement', nMin: 1, nMax: 1 }),
      ]),
    ).toBe(false);
    // Empty range.
    expect(
      anyReplacementFunctionSeries([
        fs('s', ax.id, { mode: 'replacement', nMin: 3, nMax: 1 }),
      ]),
    ).toBe(false);
    // Ignores non-function-series items entirely.
    expect(anyReplacementFunctionSeries([ax])).toBe(false);
  });
});

describe('function series exit_animation target resolution', () => {
  const idToVarName = new Map<ItemId, string>([['ax', 'axes_1']]);

  it('accumulation mode: exit targets the parent VGroup', () => {
    const item = fs('s1', 'ax', { mode: 'accumulation', nMin: 1, nMax: 3 });
    const expr = resolveExitTargetsForExport(item, idToVarName, 'exit');
    expect(expr).toBe('axes_1_fs_s1');
  });

  it('replacement mode: exit targets ONLY the FIRST curve VMobject (single on-scene mobject invariant)', () => {
    // Replacement-mode playback morphs the first curve `n_1` in place
    // through every subsequent shape (see `_FSRevealTransform`). `n_1` is
    // the only mobject that ever sits on the scene; `n_2`..`n_last` exist
    // only as transform targets (pre-hidden with `set_stroke(opacity=0)`
    // in the def). At exit time `n_1` has `n_last`'s shape and is the only
    // visible curve — targeting the parent VGroup would flash every other
    // `n_k` onto the screen for the duration of the FadeOut.
    const item = fs('s1', 'ax', { mode: 'replacement', nMin: 1, nMax: 3 });
    const expr = resolveExitTargetsForExport(item, idToVarName, 'exit');
    expect(expr).toBe(functionSeriesCurveVar('axes_1', 's1', 1));
    expect(expr).toBe('axes_1_fs_s1_n1');
  });

  it('replacement mode with negative nMin uses the mN naming suffix for the first curve', () => {
    const item = fs('s1', 'ax', { mode: 'replacement', nMin: -3, nMax: -1 });
    const expr = resolveExitTargetsForExport(item, idToVarName, 'exit');
    expect(expr).toBe('axes_1_fs_s1_nm3');
  });

  it('replacement mode with empty range resolves to null (nothing to exit)', () => {
    const item = fs('s1', 'ax', { mode: 'replacement', nMin: 3, nMax: 1 });
    const expr = resolveExitTargetsForExport(item, idToVarName, 'exit');
    expect(expr).toBeNull();
  });

  it('surround purpose keeps the parent VGroup even for replacement mode', () => {
    // A SurroundingRectangle around the whole series should span every curve
    // — the replacement-mode special-case is exit-only.
    const item = fs('s1', 'ax', { mode: 'replacement', nMin: 1, nMax: 3 });
    const expr = resolveExitTargetsForExport(item, idToVarName, 'surround');
    expect(expr).toBe('axes_1_fs_s1');
  });

  it('default purpose (no arg) preserves legacy surround behavior', () => {
    const item = fs('s1', 'ax', { mode: 'replacement', nMin: 1, nMax: 3 });
    const expr = resolveExitTargetsForExport(item, idToVarName);
    expect(expr).toBe('axes_1_fs_s1');
  });
});

describe('GraphFunctionSeriesItem totals', () => {
  it('functionSeriesIndices excludes boundary when nMin >= nMax', async () => {
    const { functionSeriesIndices } = await import('@/types/scene');
    expect(functionSeriesIndices(fs('s', 'ax', { nMin: 3, nMax: 3 }))).toEqual(
      [],
    );
    expect(functionSeriesIndices(fs('s', 'ax', { nMin: -2, nMax: 1 }))).toEqual(
      [-2, -1, 0, 1],
    );
  });

  it('functionSeriesTotalDuration sums anim and wait but skips last wait', async () => {
    const { functionSeriesTotalDuration } = await import('@/types/scene');
    const item = fs('s', 'ax', {
      nMin: 0,
      nMax: 2,
      defaults: {
        color: '#000',
        strokeWidth: 2,
        lineStyle: 'solid',
        animDuration: 1,
        waitAfter: 0.5,
      },
    });
    // 3 curves: 1 + 0.5 + 1 + 0.5 + 1 = 4
    expect(functionSeriesTotalDuration(item)).toBeCloseTo(4, 6);
  });
});