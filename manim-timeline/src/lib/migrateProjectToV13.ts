import type {
  AxesItem,
  GraphDot,
  GraphDotItem,
  GraphFieldItem,
  GraphFunction,
  GraphPlotItem,
  GraphSeriesVizItem,
  SceneItem,
  SegmentStyle,
  ShapeItem,
  TextLineItem,
} from '@/types/scene';

type LegacyVoice = {
  audioTrackId?: string | null;
};

function stripVoiceAudioId(item: Record<string, unknown>): string | null {
  const voice = item.voice as LegacyVoice | undefined;
  const id =
    (item.audioTrackId as string | null | undefined) ??
    voice?.audioTrackId ??
    null;
  delete item.voice;
  if (id != null && id !== '') return id;
  return null;
}

function migrateSegment(seg: Record<string, unknown>): SegmentStyle {
  const {
    voiceText: _vt,
    waitAfterEnabled: _wae,
    waitAfterSec: _was,
    ...rest
  } = seg;
  return rest as unknown as SegmentStyle;
}

function migrateTextLine(item: TextLineItem): TextLineItem {
  const rec = { ...item } as unknown as Record<string, unknown>;
  const audioTrackId = stripVoiceAudioId(rec);
  const segments = (rec.segments as Record<string, unknown>[] | undefined) ?? [];
  return {
    ...(rec as unknown as TextLineItem),
    audioTrackId,
    segments: segments.map(migrateSegment),
  };
}

function migrateAxes(item: AxesItem): AxesItem {
  const rec = { ...item } as unknown as Record<string, unknown>;
  const audioTrackId = stripVoiceAudioId(rec);
  delete rec.perPartVoice;
  delete rec.voiceAxesScript;
  delete rec.voiceLabelsScript;
  return { ...(rec as unknown as AxesItem), audioTrackId };
}

function migrateGraphFn(fn: Record<string, unknown>): GraphFunction {
  const { voiceText: _v, ...rest } = fn;
  return rest as unknown as GraphFunction;
}

function migrateGraphDot(dot: Record<string, unknown>): GraphDot {
  const { voiceText: _v, ...rest } = dot;
  return rest as unknown as GraphDot;
}

function migrateGraphPlot(item: GraphPlotItem): GraphPlotItem {
  const rec = { ...item } as unknown as Record<string, unknown>;
  const audioTrackId = stripVoiceAudioId(rec);
  const fn = migrateGraphFn((rec.fn as Record<string, unknown>) ?? {});
  return { ...(rec as unknown as GraphPlotItem), audioTrackId, fn };
}

function migrateGraphDotItem(item: GraphDotItem): GraphDotItem {
  const rec = { ...item } as unknown as Record<string, unknown>;
  const audioTrackId = stripVoiceAudioId(rec);
  const dot = migrateGraphDot((rec.dot as Record<string, unknown>) ?? {});
  return { ...(rec as unknown as GraphDotItem), audioTrackId, dot };
}

function migrateGraphField(item: GraphFieldItem): GraphFieldItem {
  const rec = { ...item } as unknown as Record<string, unknown>;
  const audioTrackId = stripVoiceAudioId(rec);
  return { ...(rec as unknown as GraphFieldItem), audioTrackId };
}

function migrateGraphSeriesViz(item: GraphSeriesVizItem): GraphSeriesVizItem {
  const rec = { ...item } as unknown as Record<string, unknown>;
  const audioTrackId = stripVoiceAudioId(rec);
  delete rec.voiceText;
  return { ...(rec as unknown as GraphSeriesVizItem), audioTrackId };
}

function migrateShape(item: ShapeItem): ShapeItem {
  const rec = { ...item } as unknown as Record<string, unknown>;
  const audioTrackId = stripVoiceAudioId(rec);
  return { ...(rec as unknown as ShapeItem), audioTrackId };
}

/**
 * v13: Remove `voice` / VoiceoverConfig; optional `audioTrackId` on scene objects.
 * Strip narration-only fields from segments and graphs.
 */
export function migrateItemsToV13(items: SceneItem[]): SceneItem[] {
  return items.map((item) => {
    switch (item.kind) {
      case 'textLine':
        return migrateTextLine(item);
      case 'axes':
        return migrateAxes(item);
      case 'graphPlot':
        return migrateGraphPlot(item);
      case 'graphDot':
        return migrateGraphDotItem(item);
      case 'graphField':
        return migrateGraphField(item);
      case 'graphSeriesViz':
        return migrateGraphSeriesViz(item);
      case 'shape':
        return migrateShape(item);
      default:
        return item;
    }
  });
}
