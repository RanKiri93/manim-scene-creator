import { describe, expect, it } from 'vitest';
import type { BlinkAnimationItem, ItemId, SceneItem } from '@/types/scene';
import {
  createAxes,
  createExitAnimation,
  createGraphPlot,
  createTargetAnimation,
  defaultSceneDefaults,
} from '@/store/factories';
import {
  effectColor,
  effectColorOverride,
  effectScale,
  exitPreviewForTarget,
  uncreateAsUndraw,
} from './visualPlaybackPreview';

const mapOf = (...items: SceneItem[]) => new Map<ItemId, SceneItem>(items.map((it) => [it.id, it]));

function plotScene() {
  const axes = createAxes(defaultSceneDefaults(), 0);
  const plot = createGraphPlot(axes.id, 0);
  plot.id = 'p';
  plot.fn.color = '#ffffff';
  return { axes, plot };
}

describe('blink and target effects on graph children (export: set_color / scale on the object)', () => {
  it('tints a plot during a colour blink and leaves it alone outside it', () => {
    const { axes, plot } = plotScene();
    const blink: BlinkAnimationItem = {
      kind: 'blink_animation', id: 'b', label: '', layer: 0, startTime: 2, duration: 1, repetitions: 1,
      targets: [{ targetId: 'p', mode: 'color', blinkColor: '#ff0000' }],
    };
    const items = mapOf(axes, plot, blink);
    expect(effectColorOverride('p', '#ffffff', 1, items)).toBeUndefined();
    expect(effectColor('p', '#ffffff', 1, items)).toBe('#ffffff');
    // Halfway through the single blink the envelope is at its peak: full blink colour.
    expect(effectColor('p', '#ffffff', 2.5, items).toLowerCase()).toBe('#ff0000');
  });

  it('scales a plot with a scale target clip and keeps a finished colour clip', () => {
    const { axes, plot } = plotScene();
    const scale = createTargetAnimation('scale', ['p'], 1, 1);
    Object.assign(scale.targets[0]!, { scaleFactor: 2 });
    const colour = createTargetAnimation('color', ['p'], 3, 1);
    Object.assign(colour.targets[0]!, { color: '#00ff00' });
    const items = mapOf(axes, plot, scale, colour);
    expect(effectScale('p', 0.5, items)).toBe(1);
    expect(effectScale('p', 1.5, items)).toBeCloseTo(1.5, 5);
    expect(effectScale('p', 5, items)).toBeCloseTo(2, 5);
    expect(effectColor('p', '#ffffff', 5, items).toLowerCase()).toBe('#00ff00');
  });
});

describe('uncreateAsUndraw', () => {
  it('turns an Uncreate into an un-draw without fade or shrink', () => {
    const { axes, plot } = plotScene();
    const exit = createExitAnimation(['p'], 4, 1);
    exit.targets[0]!.animStyle = 'uncreate';
    const items = mapOf(axes, plot, exit);
    const out = uncreateAsUndraw(exitPreviewForTarget('p', 4.25, items));
    expect(out.drawn).toBeCloseTo(0.75, 5);
    expect(out.exit).toMatchObject({ opacity: 1, scale: 1 });
  });

  it('leaves other exits as they are', () => {
    const { axes, plot } = plotScene();
    const exit = createExitAnimation(['p'], 4, 1);
    exit.targets[0]!.animStyle = 'fade_out';
    const items = mapOf(axes, plot, exit);
    const state = exitPreviewForTarget('p', 4.5, items);
    expect(uncreateAsUndraw(state)).toEqual({ exit: state, drawn: undefined });
  });
});
