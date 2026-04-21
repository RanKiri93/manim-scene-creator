import { newId } from '@/lib/ids';
import type {
  AxesItem,
  ExitAnimStyle,
  ExitAnimationItem,
  GraphDot,
  GraphDotItem,
  GraphFieldItem,
  GraphFunction,
  GraphPlotItem,
  PosStep,
  SceneItem,
} from '@/types/scene';
import { normalizeNextToPosStep } from '@/lib/migrateProjectToV20';

/** Legacy monolithic graph from project version < 8. */
interface LegacyGraph {
  kind: 'graph';
  id: string;
  label: string;
  layer: number;
  startTime: number;
  duration: number;
  x: number;
  y: number;
  scale: number;
  waitAfter: number;
  posSteps: PosStep[];
  /** Legacy only; migrated to `audioTrackId` on AxesItem. */
  voice?: { audioTrackId?: string | null };
  exitAnimStyle?: ExitAnimStyle;
  exitRunTime?: number;
  xRange: [number, number, number];
  yRange: [number, number, number];
  xLabel: string;
  yLabel: string;
  includeNumbers: boolean;
  includeTip: boolean;
  functions: GraphFunction[];
  dots: GraphDot[];
  perPartVoice: boolean;
  voiceAxesScript: string;
  voiceLabelsScript: string;
  fieldMode?: GraphFieldItem['fieldMode'];
  pyExprSlope?: string;
  jsExprSlope?: string;
  slopeArrowLength?: number;
  pyExprP?: string;
  pyExprQ?: string;
  jsExprP?: string;
  jsExprQ?: string;
  fieldGridStep?: number;
  fieldColormap?: GraphFieldItem['fieldColormap'];
  colorSchemeMin?: number;
  colorSchemeMax?: number;
  streamPoints?: GraphFieldItem['streamPoints'];
  streamPlacementActive?: boolean;
  streamDt?: number;
  streamVirtualTime?: number;
}

function normalizePosSteps(steps: PosStep[]): PosStep[] {
  return steps.map((step) => {
    if (step.kind !== 'next_to') return step;
    const refKind =
      (step as { refKind?: string }).refKind === 'graph' ? 'axes' : step.refKind;
    const rk = refKind === 'line' || refKind === 'axes' || refKind === 'shape' ? refKind : 'line';
    return normalizeNextToPosStep({ ...step, refKind: rk });
  });
}

function normalizeItem(item: SceneItem): SceneItem {
  if (item.kind === 'exit_animation' || item.kind === 'surroundingRect') {
    return item;
  }
  return { ...item, posSteps: normalizePosSteps(item.posSteps) } as SceneItem;
}

/**
 * Split legacy `graph` items into `axes` + overlay clips. Normalize `next_to` refKind graph → axes.
 * Legacy `graphSeriesViz` items are dropped here (superseded by `graphFunctionSeries` with partial-sum displayMode).
 */
export function migrateSceneItems(items: SceneItem[]): SceneItem[] {
  const out: SceneItem[] = [];
  const step = 1.0;

  for (const raw of items) {
    if ((raw as { kind?: string }).kind === 'graph') {
      const g = raw as unknown as LegacyGraph;
      const axesId = g.id;

      const axes: AxesItem = {
        id: axesId,
        kind: 'axes',
        label: g.label,
        layer: g.layer,
        startTime: g.startTime,
        duration: g.duration,
        x: g.x,
        y: g.y,
        scale: g.scale,
        scaleX: Math.max(0.01, g.scale ?? 1),
        scaleY: Math.max(0.01, g.scale ?? 1),
        posSteps: normalizePosSteps(g.posSteps),
        audioTrackId: g.voice?.audioTrackId ?? null,
        xRange: [...g.xRange] as [number, number, number],
        yRange: [...g.yRange] as [number, number, number],
        xLabel: g.xLabel,
        yLabel: g.yLabel,
        includeNumbers: g.includeNumbers,
        includeTip: g.includeTip,
      };
      out.push(axes);

      const exStyle = g.exitAnimStyle;
      if (exStyle && exStyle !== 'none') {
        const ex: ExitAnimationItem = {
          kind: 'exit_animation',
          id: newId(),
          label: '',
          layer: g.layer,
          startTime: g.startTime + g.duration + g.waitAfter,
          duration: Math.max(0.01, g.exitRunTime ?? 1),
          targets: [{ targetId: axesId, animStyle: exStyle }],
        };
        out.push(ex);
      }

      const layoutGap = 0.3;
      let t = g.startTime + g.duration + g.waitAfter;

      for (const fn of g.functions ?? []) {
        const plot: GraphPlotItem = {
          id: newId(),
          kind: 'graphPlot',
          label: '',
          layer: g.layer,
          startTime: t,
          duration: step,
          x: 0,
          y: 0,
          scale: 1,
          posSteps: [{ kind: 'absolute' }],
          audioTrackId: null,
          axesId,
          fn: { ...fn },
          xDomain: null,
          strokeWidth: 2,
        };
        out.push(plot);
        t += step + layoutGap;
      }

      for (const dot of g.dots ?? []) {
        const di: GraphDotItem = {
          id: newId(),
          kind: 'graphDot',
          label: '',
          layer: g.layer,
          startTime: t,
          duration: step,
          x: 0,
          y: 0,
          scale: 1,
          posSteps: [{ kind: 'absolute' }],
          audioTrackId: null,
          axesId,
          dot: { ...dot },
        };
        out.push(di);
        t += step + layoutGap;
      }

      const fm = g.fieldMode ?? 'none';
      if (fm !== 'none') {
        const field: GraphFieldItem = {
          id: newId(),
          kind: 'graphField',
          label: '',
          layer: g.layer,
          startTime: t,
          duration: step,
          x: 0,
          y: 0,
          scale: 1,
          posSteps: [{ kind: 'absolute' }],
          audioTrackId: null,
          axesId,
          fieldMode: fm,
          pyExprSlope: g.pyExprSlope ?? '0',
          jsExprSlope: g.jsExprSlope ?? '0',
          slopeArrowLength: g.slopeArrowLength ?? 0.5,
          pyExprP: g.pyExprP ?? '1',
          pyExprQ: g.pyExprQ ?? '0',
          jsExprP: g.jsExprP ?? '1',
          jsExprQ: g.jsExprQ ?? '0',
          fieldGridStep: g.fieldGridStep ?? 0.5,
          fieldColormap: g.fieldColormap ?? 'viridis',
          colorSchemeMin: g.colorSchemeMin ?? 0,
          colorSchemeMax: g.colorSchemeMax ?? 2,
          streamPoints: g.streamPoints?.map((sp) => ({ ...sp })) ?? [],
          streamPlacementActive: g.streamPlacementActive ?? false,
          streamDt: g.streamDt ?? 0.05,
          streamVirtualTime: g.streamVirtualTime ?? 3,
        };
        out.push(field);
      }
    } else if ((raw as { kind?: string }).kind === 'graphSeriesViz') {
      // Drop legacy series-viz items (superseded by graphFunctionSeries with partial-sum displayMode).
      continue;
    } else {
      out.push(normalizeItem(raw));
    }
  }

  return out;
}
