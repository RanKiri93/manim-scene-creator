import { useCallback, useMemo, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { useMeasureLine } from '@/services/measureHooks';
import { parseSegments } from '@/codegen/texUtils';
import { createSegmentStyle } from '@/store/factories';
import { effectiveStart } from '@/lib/time';
import { scaleSegmentAnimForLineDuration } from '@/lib/segmentAnimDurations';
import type { AnimStyle, TextLineItem, SegmentStyle, TransformMapping } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import SegmentEditor from './SegmentEditor';
import SegmentMapperModal from './SegmentMapperModal';
import PositionStepsEditor from './PositionStepsEditor';
import AudioBindingSelect from './AudioBindingSelect';
import PropertyTabs from './PropertyTabs';
import { appendCenterXStep, inkEdgeSteps, updateAxisStep, type ToEdgeCardinal } from '@/lib/quickLayout';
import VisibleAtSceneStartRow from './VisibleAtSceneStartRow';
import TargetAnimationEffectsNote from './TargetAnimationEffectsNote';

function defaultTransformMapping(sourceLineId: string): TransformMapping {
  return {
    sourceLineId,
    mode: 'segments',
    segmentPairs: {},
    unmappedSourceBehavior: 'fade_out',
    unmappedTargetBehavior: 'fade_in',
  };
}

interface LineEditorProps {
  item: TextLineItem;
}

export default function LineEditor({ item }: LineEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const setItemAudioBinding = useSceneStore((s) => s.setItemAudioBinding);
  const setLineTransformConfig = useSceneStore((s) => s.setLineTransformConfig);
  const items = useSceneStore((s) => s.items);
  const defaults = useSceneStore((s) => s.defaults);
  const [mapperOpen, setMapperOpen] = useState(false);

  useMeasureLine(item);

  const earlierTextLines = useMemo(() => {
    const list: TextLineItem[] = [];
    const t0 = effectiveStart(item, items);
    for (const it of items.values()) {
      if (it.kind !== 'textLine' || it.id === item.id) continue;
      const t = effectiveStart(it, items);
      if (t < t0 || (t === t0 && it.id.localeCompare(item.id) < 0)) {
        list.push(it);
      }
    }
    list.sort((a, b) => {
      const d = effectiveStart(a, items) - effectiveStart(b, items);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });
    return list;
  }, [item, items]);

  const set = useCallback(
    (patch: Partial<TextLineItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const setInkEdge = useCallback(
    (edge: ToEdgeCardinal, buff: number) => {
      set({ posSteps: inkEdgeSteps(edge, buff) });
    },
    [set],
  );

  const centerX = useCallback(() => {
    set({ posSteps: appendCenterXStep(item.posSteps) });
  }, [item.posSteps, set]);

  const onRawChange = (raw: string) => {
    const parsed = parseSegments(raw);
    const segs: SegmentStyle[] = parsed.map((p, i) => {
      const existing = item.segments[i];
      if (existing && existing.text === p.text && existing.isMath === p.isMath) {
        return existing;
      }
      return createSegmentStyle(p.text, p.isMath, defaults);
    });
    set({ raw, segments: segs });
  };

  const animStyle: AnimStyle = item.animStyle ?? 'write';

  const onAnimStyleChange = (style: AnimStyle) => {
    if (style === 'transform') {
      const firstId = earlierTextLines[0]?.id ?? '';
      const prev = item.transformConfig;
      const sourceLineId =
        prev?.sourceLineId && earlierTextLines.some((l) => l.id === prev.sourceLineId)
          ? prev.sourceLineId
          : firstId;
      set({
        animStyle: 'transform',
        visibleAtSceneStart: undefined,
        transformConfig: {
          mode: prev?.mode ?? 'segments',
          segmentPairs: prev?.segmentPairs ?? {},
          unmappedSourceBehavior: prev?.unmappedSourceBehavior ?? 'fade_out',
          unmappedTargetBehavior: prev?.unmappedTargetBehavior ?? 'fade_in',
          sourceLineId,
        },
      });
      return;
    }
    set({ animStyle: style });
  };

  const sourceLineItem = useMemo(() => {
    const sid = item.transformConfig?.sourceLineId;
    if (!sid) return undefined;
    const it = items.get(sid);
    return it?.kind === 'textLine' ? it : undefined;
  }, [item.transformConfig?.sourceLineId, items]);

  const baseContent = (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Text Line</h3>

      <label className="text-xs text-slate-400 block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Title, Step 2 — optional; helps exit targets & item list"
          className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>

      <div>
        <label className="text-xs text-slate-400 mb-1 block">LaTeX source</label>
        <textarea
          value={item.raw}
          onChange={(e) => onRawChange(e.target.value)}
          rows={3}
          dir="rtl"
          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 font-mono resize-y"
          placeholder="Hebrew text with $math$ segments..."
        />
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <label className="text-xs text-slate-400">
          Font
          <input
            type="text"
            value={item.font}
            onChange={(e) => set({ font: e.target.value })}
            className="ml-1 w-24 bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-300"
          />
        </label>
        <NumberInput
          label="Size"
          value={item.fontSize}
          onChange={(v) => set({ fontSize: v })}
          min={8}
          max={120}
          step={1}
        />
      </div>

      {item.measureError && (
        <p className="text-[10px] text-red-400 bg-red-900/20 rounded px-2 py-1">
          Measure error: {item.measureError}
        </p>
      )}
      {item.measure && (
        <p className="text-[10px] text-slate-500">
          Measured: {item.measure.width.toFixed(2)} x {item.measure.height.toFixed(2)} Manim units
          {item.measure.pngWidth && ` | raster ${item.measure.pngWidth}x${item.measure.pngHeight}px`}
        </p>
      )}
      <TargetAnimationEffectsNote targetId={item.id} />
    </div>
  );

  const animationContent = (
    <div className="flex flex-col gap-3">
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Anim style</label>
        <select
          value={animStyle}
          onChange={(e) => onAnimStyleChange(e.target.value as AnimStyle)}
          className="w-full max-w-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          <option value="write">Write</option>
          <option value="fade_in">Fade in</option>
          <option value="transform">Transform</option>
        </select>
      </div>

      {animStyle === 'transform' && (
        <div className="flex flex-col gap-2 rounded border border-slate-600 bg-slate-800/40 p-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Transform mapping</div>
          {earlierTextLines.length === 0 ? (
            <p className="text-[11px] text-amber-400/90">No earlier text lines in the scene to use as source.</p>
          ) : (
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Source line
              <select
                value={item.transformConfig?.sourceLineId ?? ''}
                onChange={(e) => {
                  const id = e.target.value;
                  const base = item.transformConfig ?? defaultTransformMapping(id);
                  setLineTransformConfig(item.id, { ...base, sourceLineId: id });
                }}
                className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
              >
                {earlierTextLines.map((line) => {
                  const label = (line.label || line.raw || '(empty)').trim();
                  const short = label.length > 48 ? `${label.slice(0, 47)}…` : label;
                  return (
                    <option key={line.id} value={line.id}>
                      {short}
                    </option>
                  );
                })}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Transform type
            <select
              value={item.transformConfig?.mode ?? 'segments'}
              onChange={(e) => {
                const base = item.transformConfig ?? defaultTransformMapping(sourceLineItem?.id ?? '');
                setLineTransformConfig(item.id, {
                  ...base,
                  mode: e.target.value as TransformMapping['mode'],
                });
              }}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
            >
              <option value="segments">Mapped segments</option>
              <option value="whole">Whole line morph</option>
            </select>
          </label>
          {(item.transformConfig?.mode ?? 'segments') === 'segments' && (
            <>
              <button
                type="button"
                disabled={!sourceLineItem}
                onClick={() => setMapperOpen(true)}
                className="self-start rounded border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Map segments…
              </button>
              {sourceLineItem && (
                <SegmentMapperModal
                  open={mapperOpen}
                  onClose={() => setMapperOpen(false)}
                  sourceRaw={sourceLineItem.raw}
                  targetRaw={item.raw}
                  initialSegmentPairs={item.transformConfig?.segmentPairs ?? {}}
                  onApply={(segmentPairs) => {
                    const tc = item.transformConfig ?? defaultTransformMapping(sourceLineItem.id);
                    setLineTransformConfig(item.id, { ...tc, segmentPairs });
                  }}
                />
              )}
            </>
          )}
        </div>
      )}

      <VisibleAtSceneStartRow
        checked={item.visibleAtSceneStart === true}
        disabled={animStyle === 'transform'}
        disabledReason="Not available for transform lines."
        note="Intro audio is not synchronized (no intro animation)."
        onChange={(next) =>
          set(
            next
              ? { visibleAtSceneStart: true, startTime: 0 }
              : { visibleAtSceneStart: undefined },
          )
        }
      />

      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput
          label="Start (s)"
          value={item.startTime}
          onChange={(v) => set({ startTime: v })}
          min={0}
          step={0.1}
          disabled={item.visibleAtSceneStart === true}
        />
        <NumberInput
          label="Duration"
          value={item.duration}
          onChange={(v) => {
            const next = Math.max(0.01, v);
            set({
              duration: next,
              segments: scaleSegmentAnimForLineDuration(
                item.segments,
                item.duration,
                next,
              ),
            });
          }}
          min={0.01}
          step={0.1}
        />
        <NumberInput
          label="Layer"
          value={item.layer}
          onChange={(v) => set({ layer: Math.round(v) })}
          min={0}
          step={1}
        />
      </div>

      <AudioBindingSelect
        value={item.audioTrackId}
        currentItemId={item.id}
        onChange={(audioTrackId) => setItemAudioBinding(item.id, audioTrackId)}
      />
    </div>
  );

  const positionContent = (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput
          label="X"
          value={item.x}
          onChange={(v) => {
            const nextSteps = updateAxisStep(item.posSteps, 'x', v);
            set(nextSteps ? { x: v, posSteps: nextSteps } : { x: v });
          }}
          step={0.1}
        />
        <NumberInput
          label="Y"
          value={item.y}
          onChange={(v) => {
            const nextSteps = updateAxisStep(item.posSteps, 'y', v);
            set(nextSteps ? { y: v, posSteps: nextSteps } : { y: v });
          }}
          step={0.1}
        />
        <NumberInput label="Scale" value={item.scale} onChange={(v) => set({ scale: v })} min={0.01} step={0.05} />
      </div>

      <div className="rounded border border-slate-600 bg-slate-800/40 p-2">
        <div className="text-xs font-medium text-slate-300 mb-1.5">Quick layout</div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setInkEdge('RIGHT', 0.3)}
            className="rounded border border-slate-500 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-700"
          >
            Ink right
          </button>
          <button
            type="button"
            onClick={() => setInkEdge('LEFT', 0.3)}
            className="rounded border border-slate-500 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-700"
          >
            Ink left
          </button>
          <button
            type="button"
            onClick={() => setInkEdge('UP', 0.5)}
            className="rounded border border-slate-500 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-700"
          >
            Ink top
          </button>
          <button
            type="button"
            onClick={() => setInkEdge('DOWN', 0.5)}
            className="rounded border border-slate-500 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-700"
          >
            Ink bottom
          </button>
          <button
            type="button"
            onClick={centerX}
            className="rounded border border-slate-500 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-700"
          >
            Center X
          </button>
        </div>
        {!item.measure && (
          <p className="mt-1.5 text-[10px] text-slate-500">
            Ink alignment is most accurate after measurement completes.
          </p>
        )}
      </div>

      <div>
        <div className="text-xs text-slate-400 mb-1">Positioning steps ({item.posSteps.length})</div>
        <PositionStepsEditor
          steps={item.posSteps}
          onChange={(s) => set({ posSteps: s })}
          currentItemId={item.id}
        />
      </div>
    </div>
  );

  const segmentsContent = (
    <div className="flex flex-col gap-3">
      <SegmentEditor
        segments={item.segments}
        animDuration={item.duration}
        onChange={(s) => set({ segments: s })}
      />
    </div>
  );

  return (
    <PropertyTabs
      key={item.id}
      defaultTabId="base"
      tabs={[
        { id: 'base', label: 'Base', content: baseContent },
        { id: 'animation', label: 'Animation / Audio', content: animationContent },
        { id: 'position', label: 'Positioning', content: positionContent },
        { id: 'segments', label: 'Segments', content: segmentsContent },
      ]}
    />
  );
}
