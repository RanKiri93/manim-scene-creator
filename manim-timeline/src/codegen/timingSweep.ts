/**
 * Timing sweep: fixture scenes covering every clip kind (sequential, overlapping, with bound
 * narration), exported with the real exporter, plus the window each clip should animate in
 * (`clipAnimationWindow`). `scripts/timing-sweep/run_sweep.py` runs the exported Python in
 * Manim and compares the real animation windows with these. Verifier tooling: not imported by
 * the app.
 */
import type { AudioTrackItem, FrameDef, ItemId, SceneItem } from '@/types/scene';
import {
  createAxes, createBlinkAnimation, createCameraMove, createExitAnimation, createFrame,
  createGraphArea, createGraphCurve, createGraphDotItem, createGraphFieldItem,
  createGraphFunctionSeries, createGraphPlot, createGraphPointSequence, createGraphStreamPoint,
  createImageItem, createSegmentStyle, createShape, createSurroundingRect, createTargetAnimation,
  createTextLine, defaultSceneDefaults,
} from '@/store/factories';
import { clipAnimationWindow } from '@/lib/clipWindows';
import { exportManimCode } from './manimExporter';
import { flattenExportLeaves } from './flattenExport';
import { overlayAreaVar, overlayCurveVar, overlayDotVar, overlayPlotVar, pythonOverlaySuffix } from './graphCodegen';

export interface TimingSweepScene {
  name: string;
  items: SceneItem[];
  audioItems: AudioTrackItem[];
  frames: FrameDef[];
  startFrameId: ItemId;
}

/** What a clip's animation is, for matching Manim animations back to it. */
export type TimingSweepRole = 'intro' | 'exit' | 'blink' | 'target' | 'camera' | 'sound';

export interface TimingSweepExpectation {
  id: ItemId;
  kind: SceneItem['kind'] | 'audio';
  role: TimingSweepRole;
  /**
   * Python variable names (prefixes) whose animations belong to this clip: its own for intros,
   * its targets' for exit/blink/target clips, the asset path for a narration file.
   */
  vars: string[];
  start: number;
  end: number;
}

export interface TimingSweepCase {
  scene: string;
  code: string;
  expectations: TimingSweepExpectation[];
  /** Every item's Python variable prefixes, to attribute animations by longest matching prefix. */
  vars: Record<ItemId, string[]>;
}

const defaults = defaultSceneDefaults();

function line(id: string, start: number, dur: number, y: number, waitAfter?: number) {
  const l = createTextLine(defaults, start);
  l.id = id; l.duration = dur; l.y = y;
  l.raw = `שלום $x_${id.length}$`;
  const s0 = createSegmentStyle('שלום', false, defaults);
  if (waitAfter) s0.waitAfterSec = waitAfter;
  l.segments = [s0, createSegmentStyle(`x_${id.length}`, true, defaults)];
  return l;
}

function image(id: string, start: number, dur: number) {
  const img = createImageItem({ srcUrl: 'blob:sweep', fileName: 'sweep.png', mimeType: 'image/png', width: 1.5, height: 1, startTime: start });
  img.id = id; img.duration = dur; img.x = 4; img.y = -2;
  img.assetRelPath = 'assets/textures/sweep.png';
  return img;
}

function graphSet(prefix: string) {
  const axes = createAxes(defaults, 0); axes.id = `${prefix}ax`; axes.duration = 1.1; axes.x = -3;
  const plot = createGraphPlot(axes.id, 0); plot.id = `${prefix}plot`;
  plot.fn = { ...plot.fn, jsExpr: 'x*x/4', pyExpr: 'x**2/4' };
  return { axes, plot };
}

/** Every kind in its own time slot. */
function sequentialScene(): TimingSweepScene {
  const home = createFrame(0, 0, 'Home');
  const { axes, plot } = graphSet('s');
  let t = 1.8;
  const next = (dur: number, gap = 0.7) => { const s = t; t += dur + gap; return s; };
  plot.startTime = next(1.3); plot.duration = 1.3;
  const curve = createGraphCurve(axes.id, next(0.9)); curve.id = 'scurve'; curve.duration = 0.9;
  const dot = createGraphDotItem(axes.id, next(0.7)); dot.id = 'sdot'; dot.duration = 0.7;
  dot.dot.label = 'P'; dot.dot.showCoordinates = true; dot.dot.attachment = { kind: 'function', graphPlotId: plot.id, x: 1 };
  const field = createGraphFieldItem(axes.id, next(1.2)); field.id = 'sfield'; field.duration = 1.2;
  field.streamPoints = [createGraphStreamPoint(), { ...createGraphStreamPoint(), x: 1, y: 1 }];
  const series = createGraphFunctionSeries(axes.id, t); series.id = 'sseries'; next(series.duration);
  const pseq = createGraphPointSequence(axes.id, t); pseq.id = 'spseq'; next(pseq.duration);
  const area = createGraphArea(axes.id, next(1.0)); area.id = 'sarea'; area.duration = 1.0;
  const text = line('stext', next(1.4 + 0.3), 1.4, 2.5, 0.3);
  const shapeC = createShape(next(0.8)); shapeC.id = 'sshapec'; shapeC.duration = 0.8; shapeC.x = 4; shapeC.y = 2;
  const shapeF = createShape(next(0.6)); shapeF.id = 'sshapef'; shapeF.duration = 0.6; shapeF.introStyle = 'fade_in'; shapeF.x = 5; shapeF.y = 0;
  const img = image('simg', next(0.9), 0.9);
  const sr = createSurroundingRect([text.id], next(0.45)); sr.id = 'ssr';
  const srL = createSurroundingRect([shapeC.id], next(0.45)); srL.id = 'ssrl'; srL.labelText = 'A';
  const blink = createBlinkAnimation([text.id], next(0.6), 0.6); blink.id = 'sblink';
  const move = createTargetAnimation('move', [shapeC.id], next(0.8), 0.8); move.id = 'smove';
  const scale = createTargetAnimation('scale', [shapeF.id], next(0.7), 0.7); scale.id = 'sscale';
  const rot = createTargetAnimation('rotate', [img.id], next(0.5), 0.5); rot.id = 'srot';
  const color = createTargetAnimation('color', [shapeF.id], next(0.6), 0.6); color.id = 'scolor';
  const path = createTargetAnimation('path', [shapeC.id], next(0.9), 0.9); path.id = 'spath';
  const follow = createTargetAnimation('graphFollow', [dot.id], next(1.0), 1.0); follow.id = 'sfollow';
  follow.targets[0]!.targetX = 2;
  const cam = createCameraMove(home.id, next(1.0), 1.0); cam.id = 'scam'; cam.offsetX = 1; cam.targetWidth = 10;
  const exitFade = createExitAnimation([shapeC.id], next(0.5), 0.5); exitFade.id = 'sexitfade';
  const exitUn = createExitAnimation([shapeF.id], next(0.55), 0.55); exitUn.id = 'sexitun'; exitUn.targets[0]!.animStyle = 'uncreate';
  const exitShrink = createExitAnimation([img.id], next(0.6), 0.6); exitShrink.id = 'sexitshrink'; exitShrink.targets[0]!.animStyle = 'shrink_to_center';
  const exitText = createExitAnimation([text.id], next(0.5), 0.5); exitText.id = 'sexittext';
  return {
    name: 'SweepSeq',
    items: [axes, plot, curve, dot, field, series, pseq, area, text, shapeC, shapeF, img, sr, srL, blink, move, scale, rot, color, path, follow, cam, exitFade, exitUn, exitShrink, exitText],
    audioItems: [], frames: [home], startFrameId: home.id,
  };
}

/** Clips that start partway through other clips (one AnimationGroup per cluster). */
function overlappingScene(): TimingSweepScene {
  const home = createFrame(0, 0, 'Home');
  const { axes, plot } = graphSet('c');
  plot.startTime = 0.4; plot.duration = 1.3;
  const a = line('ctexta', 1.2, 1.5, 2.5, 0.25);
  const shape = createShape(1.6); shape.id = 'cshape'; shape.duration = 0.9; shape.x = 4; shape.y = 2;
  const img = image('cimg', 2.0, 1.0);
  const dot = createGraphDotItem(axes.id, 3.5); dot.id = 'cdot'; dot.duration = 0.8; dot.dot.label = 'Q';
  dot.dot.attachment = { kind: 'function', graphPlotId: plot.id, x: 0 };
  const follow = createTargetAnimation('graphFollow', [dot.id], 3.9, 1.2); follow.id = 'cfollow'; follow.targets[0]!.targetX = 1.5;
  const blink = createBlinkAnimation([a.id], 4.2, 0.6); blink.id = 'cblink';
  const cam = createCameraMove(home.id, 4.5, 1.5); cam.id = 'ccam'; cam.offsetX = -1; cam.targetWidth = 11;
  const b = line('ctextb', 5.0, 1.0, 1.0);
  const exitA = createExitAnimation([a.id], 5.4, 0.7); exitA.id = 'cexita';
  const sr = createSurroundingRect([b.id], 5.6); sr.id = 'csr';
  const move = createTargetAnimation('move', [shape.id], 5.8, 0.5); move.id = 'cmove';
  const exitShape = createExitAnimation([shape.id, img.id], 6.6, 0.6); exitShape.id = 'cexitshape';
  return {
    name: 'SweepConc',
    items: [axes, plot, a, shape, img, dot, follow, blink, cam, b, exitA, sr, move, exitShape],
    audioItems: [], frames: [home], startFrameId: home.id,
  };
}

/** Bound, early and shared narration. Audio files: s1..s4.wav of 2.0, 2.6, 1.4, 4.0 s. */
function narrationScene(): TimingSweepScene {
  const home = createFrame(0, 0, 'Home');
  const { axes, plot } = graphSet('a');
  plot.startTime = 1.6; plot.duration = 1.5;
  const wb = (pairs: [number, number][]) => pairs.map(([start, end], i) => ({ word: `w${i}`, start, end }));
  const text = line('atext', 3.8, 1.6, 2.5, 0.3);
  const dot = createGraphDotItem(axes.id, 6.4); dot.id = 'adot'; dot.duration = 0.8; dot.dot.label = 'R';
  const shape = createShape(8.0); shape.id = 'ashape'; shape.duration = 1.0; shape.x = 4;
  const text2 = line('atext2', 10.0, 1.2, 1.0);
  const audioItems: AudioTrackItem[] = [
    { id: 'tplot', text: 'p', audioUrl: '/assets/audio/s1.wav', assetRelPath: 'assets/audio/s1.wav', startTime: 1.6, duration: 2.0, boundaries: wb([[0.2, 0.6], [0.7, 1.1]]) },
    { id: 'ttext', text: 't', audioUrl: '/assets/audio/s2.wav', assetRelPath: 'assets/audio/s2.wav', startTime: 3.3, duration: 2.6, boundaries: wb([[0.6, 1.2], [1.3, 2.0]]) },
    { id: 'tdot', text: 'd', audioUrl: '/assets/audio/s3.wav', assetRelPath: 'assets/audio/s3.wav', startTime: 6.4, duration: 1.4 },
    { id: 'tlong', text: 'l', audioUrl: '/assets/audio/s4.wav', assetRelPath: 'assets/audio/s4.wav', startTime: 8.0, duration: 4.0, boundaries: wb([[0.1, 0.8], [2.1, 3.0]]) },
  ];
  text.audioTrackId = 'ttext';
  return {
    name: 'SweepAudio',
    items: [axes, plot, text, dot, shape, text2],
    audioItems, frames: [home], startFrameId: home.id,
  };
}

export function timingSweepScenes(): TimingSweepScene[] {
  return [sequentialScene(), overlappingScene(), narrationScene()];
}

/** Python variable names per item, mirroring the exporter's naming. */
function varsByItem(items: SceneItem[]): Map<ItemId, string[]> {
  const out = new Map<ItemId, string[]>();
  const counters: Record<string, number> = {};
  const stems: Partial<Record<SceneItem['kind'], string>> = { textLine: 'line', axes: 'axes', shape: 'shape', image: 'image' };
  for (const it of flattenExportLeaves(items)) {
    const stem = stems[it.kind];
    if (!stem) continue;
    counters[stem] = (counters[stem] ?? 0) + 1;
    out.set(it.id, [`${stem}_${counters[stem]}`]);
  }
  items.filter((i) => i.kind === 'surroundingRect').map((i) => i.id).sort((a, b) => a.localeCompare(b))
    .forEach((id, i) => out.set(id, [`sr_${i + 1}`]));
  for (const it of items) {
    if (!('axesId' in it)) continue;
    const ax = out.get(it.axesId)?.[0];
    if (!ax) continue;
    const suf = pythonOverlaySuffix(it.id);
    if (it.kind === 'graphPlot') out.set(it.id, [overlayPlotVar(ax, it.id)]);
    else if (it.kind === 'graphCurve') out.set(it.id, [overlayCurveVar(ax, it.id)]);
    else if (it.kind === 'graphDot') out.set(it.id, [overlayDotVar(ax, it.id)]);
    else if (it.kind === 'graphField') out.set(it.id, [`${ax}_vf_${suf}`, `${ax}_streams_${suf}`]);
    else if (it.kind === 'graphFunctionSeries') out.set(it.id, [`${ax}_fs_${suf}`]);
    else if (it.kind === 'graphPointSequence') out.set(it.id, [`${ax}_ps_${suf}`]);
    else if (it.kind === 'graphArea') out.set(it.id, [overlayAreaVar(ax, it.id), `${ax}_areaplot_${suf}`]);
  }
  return out;
}

function roleOf(item: SceneItem): TimingSweepRole {
  switch (item.kind) {
    case 'exit_animation': return 'exit';
    case 'blink_animation': return 'blink';
    case 'target_animation': return 'target';
    case 'camera_move': return 'camera';
    default: return 'intro';
  }
}

export function buildTimingSweepCase(scene: TimingSweepScene): TimingSweepCase {
  const code = exportManimCode(scene.items, {
    fullFile: true,
    defaults: { ...defaults, sceneName: scene.name },
    frames: scene.frames,
    startFrameId: scene.startFrameId,
    audioItems: scene.audioItems,
  });
  const map = new Map(scene.items.map((i) => [i.id, i] as const));
  const vars = varsByItem(scene.items);
  const expectations: TimingSweepExpectation[] = [];
  for (const item of scene.items) {
    const w = clipAnimationWindow(item, map, scene.audioItems);
    if (!w) continue;
    const role = roleOf(item);
    const targetIds = 'targets' in item ? item.targets.map((t) => t.targetId) : [];
    const itemVars = role === 'intro' ? vars.get(item.id) ?? [] : targetIds.flatMap((id) => vars.get(id) ?? []);
    expectations.push({ id: item.id, kind: item.kind, role, vars: itemVars, start: w.start, end: w.end });
  }
  // Each narration file is added once, at its own timeline start.
  for (const track of scene.audioItems) {
    const path = track.assetRelPath ?? '';
    expectations.push({ id: track.id, kind: 'audio', role: 'sound', vars: [path], start: track.startTime, end: track.startTime });
  }
  return { scene: scene.name, code, expectations, vars: Object.fromEntries(vars) };
}
