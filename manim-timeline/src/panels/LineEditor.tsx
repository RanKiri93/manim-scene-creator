import { useCallback, useMemo, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { useMeasureLine } from '@/services/measureHooks';
import { parseSegments } from '@/lib/textSegments';
import { findUnwrappedForeignRuns, foreignLangOf, wrapForeignRuns } from '@/lib/textDirectionLint';
import { createSegmentStyle } from '@/store/factories';
import { effectiveStart } from '@/lib/time';
import { scaleSegmentAnimForLineDuration } from '@/lib/segmentAnimDurations';
import {
  LATEX_DEFAULT_ENGLISH_FONT,
  type AnimStyle,
  type TextBaseDir,
  type TextLineItem,
  type SegmentStyle,
  type TransformMapping,
} from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import SegmentEditor from './SegmentEditor';
import SegmentMapperModal from './SegmentMapperModal';
import PositionStepsEditor from './PositionStepsEditor';
import AudioBindingSelect from './AudioBindingSelect';
import PropertyTabs from './PropertyTabs';
import { appendCenterXStep, inkEdgeSteps, updateAxisStep, type ToEdgeCardinal } from '@/lib/quickLayout';
import VisibleAtSceneStartRow from './VisibleAtSceneStartRow';
import TargetAnimationEffectsNote from './TargetAnimationEffectsNote';
import { Button, IconButton, Segmented } from '@/components/ui';

const BASE_DIR_OPTIONS = [
  { value: 'rtl', label: 'Hebrew base (RTL)' },
  { value: 'ltr', label: 'English base (LTR)' },
] as const;

/** Remembered per browser: whether the LaTeX source box is forced left-to-right while editing. */
const SOURCE_LTR_KEY = 'manim-timeline.lineEditor.sourceLtr';

function readSourceLtr(): boolean {
  try {
    return localStorage.getItem(SOURCE_LTR_KEY) === '1';
  } catch {
    return false;
  }
}

function defaultTransformMapping(sourceLineId: string): TransformMapping {
  return {
    sourceLineId,
    sourceLineIds: [sourceLineId],
    mode: 'segments',
    segmentPairs: {},
    unmappedSourceBehavior: 'fade_out',
    unmappedTargetBehavior: 'fade_in',
  };
}

function lineLabel(line: TextLineItem): string {
  const label = (line.label || line.raw || '(empty)').trim();
  return label.length > 48 ? `${label.slice(0, 47)}…` : label;
}

interface LineEditorProps {
  item: TextLineItem;
}

export default function LineEditor({ item }: LineEditorProps) {
  // Display-only: the stored source is identical either way.
  const [sourceLtr, setSourceLtr] = useState(readSourceLtr);
  const toggleSourceLtr = () => {
    setSourceLtr((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SOURCE_LTR_KEY, next ? '1' : '0');
      } catch {
        /* storage unavailable: keep the in-memory choice */
      }
      return next;
    });
  };
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

  const baseDir: TextBaseDir = item.baseDir ?? 'rtl';

  const onRawChange = (raw: string, dir: TextBaseDir = baseDir) => {
    const parsed = parseSegments(raw, dir);
    const segs: SegmentStyle[] = parsed.map((p, i) => {
      const existing = item.segments[i];
      if (existing && existing.text === p.text && existing.isMath === p.isMath) {
        return existing;
      }
      return createSegmentStyle(p.text, p.isMath, defaults);
    });
    set({ raw, segments: segs, baseDir: dir === 'rtl' ? undefined : dir });
  };

  const segmentLangs = useMemo(
    () => parseSegments(item.raw, baseDir).map((s) => (s.isMath ? 'math' : s.lang)),
    [item.raw, baseDir],
  );
  const foreignRuns = useMemo(
    () => findUnwrappedForeignRuns(item.raw, baseDir),
    [item.raw, baseDir],
  );
  const foreignWrapper = foreignLangOf(baseDir) === 'en' ? '\\en{…}' : '\\he{…}';

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
          sourceLineIds: prev?.sourceLineIds?.length
            ? prev.sourceLineIds.filter((id) =>
                earlierTextLines.some((l) => l.id === id) || id === sourceLineId,
              )
            : [sourceLineId],
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
      <h3 className="text-body font-semibold text-chalk">Text Line</h3>

      <label className="text-ctl text-chalk-dim block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Title, Step 2 — optional; helps exit targets & item list"
          className="mt-1 w-full max-w-md bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk"
        />
      </label>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label htmlFor={`latex-src-${item.id}`} className="text-ctl text-chalk-dim">LaTeX source</label>
          <IconButton
            size="sm"
            pressed={sourceLtr}
            label={sourceLtr ? 'Show the source in reading direction' : 'Show the source left-to-right'}
            title={
              sourceLtr
                ? 'Showing left-to-right so $math$ appears exactly as typed. Click to return to reading direction.'
                : 'Show left-to-right so $math$ appears exactly as typed (display only; the text is unchanged)'
            }
            onClick={toggleSourceLtr}
          >
            <span aria-hidden="true" className="text-ctl leading-none">⇄</span>
          </IconButton>
        </div>
        <textarea
          id={`latex-src-${item.id}`}
          value={item.raw}
          onChange={(e) => onRawChange(e.target.value)}
          rows={3}
          // Hebrew sentences with $math$: by default the first strong letter picks the direction,
          // so a Hebrew line reads right-to-left and a line starting with LaTeX stays left-to-right.
          // The toggle above forces left-to-right so $…$ delimiters show exactly as typed.
          // An English-base line is always shown left-to-right.
          dir={sourceLtr || baseDir === 'ltr' ? 'ltr' : 'auto'}
          className="w-full bg-raised border border-rule rounded-ctl px-2 py-1.5 text-body text-chalk font-mono resize-y"
          placeholder={
            baseDir === 'ltr'
              ? 'English text with $math$ and \\he{עברית}…'
              : 'Hebrew text with $math$ and \\en{English}…'
          }
        />
        {foreignRuns.length > 0 && (
          <div className="mt-1 flex items-start gap-2">
            <p className="flex-1 text-meta text-warn" dir="auto">
              {baseDir === 'ltr' ? 'Hebrew' : 'English'} outside {foreignWrapper} comes out in
              reverse word order and writes the wrong way: {foreignRuns.map((r) => `“${r.text}”`).join(', ')}
            </p>
            <Button size="sm" onClick={() => onRawChange(wrapForeignRuns(item.raw, baseDir))}>
              Wrap in {foreignWrapper}
            </Button>
          </div>
        )}
      </div>

      <Segmented
        aria-label="Line direction"
        size="sm"
        options={BASE_DIR_OPTIONS}
        value={baseDir}
        onChange={(dir) => onRawChange(item.raw, dir)}
      />

      <div className="flex items-end gap-3 flex-wrap">
        <label className="text-ctl text-chalk-dim">
          Hebrew font
          <input
            type="text"
            value={item.font}
            onChange={(e) => set({ font: e.target.value })}
            className="ml-1 w-24 bg-raised border border-rule rounded-ctl px-1.5 py-0.5 text-ctl text-chalk"
          />
        </label>
        <label
          className="text-ctl text-chalk-dim"
          title={`Empty = same as the Hebrew font. "${LATEX_DEFAULT_ENGLISH_FONT}" = the LaTeX default, which matches the math.`}
        >
          English font
          <input
            type="text"
            list={`english-fonts-${item.id}`}
            value={item.englishFont ?? ''}
            onChange={(e) => set({ englishFont: e.target.value.trim() ? e.target.value : undefined })}
            placeholder={item.font || 'Hebrew font'}
            dir="ltr"
            className="ml-1 w-28 bg-raised border border-rule rounded-ctl px-1.5 py-0.5 text-ctl text-chalk placeholder:text-chalk-faint"
          />
          <datalist id={`english-fonts-${item.id}`}>
            <option value={LATEX_DEFAULT_ENGLISH_FONT} />
          </datalist>
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
        <p className="text-meta text-danger bg-danger/10 rounded-ctl px-2 py-1">
          Measure error: {item.measureError}
        </p>
      )}
      {item.measure && (
        <p className="text-meta text-chalk-faint">
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
        <label className="text-ctl text-chalk-dim mb-1 block">Anim style</label>
        <select
          value={animStyle}
          onChange={(e) => onAnimStyleChange(e.target.value as AnimStyle)}
          className="w-full max-w-xs bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk"
        >
          <option value="write">Write</option>
          <option value="fade_in">Fade in</option>
          <option value="transform">Transform</option>
        </select>
      </div>

      {animStyle === 'transform' && (
        <div className="flex flex-col gap-2 rounded-ctl border border-rule bg-ink/40 p-2">
          <div className="text-meta text-chalk-faint">Transform mapping</div>
          {earlierTextLines.length === 0 ? (
            <p className="text-meta text-warn">No earlier text lines in the scene to use as source.</p>
          ) : (item.transformConfig?.mode ?? 'segments') === 'whole' ? (
            <div className="flex flex-col gap-1 text-ctl text-chalk-dim">
              Source lines
              <div className="flex flex-col gap-1 rounded-ctl border border-rule bg-ink/40 p-2 max-h-40 overflow-y-auto">
                {earlierTextLines.map((line) => {
                  const selectedIds =
                    item.transformConfig?.sourceLineIds?.length
                      ? item.transformConfig.sourceLineIds
                      : item.transformConfig?.sourceLineId
                        ? [item.transformConfig.sourceLineId]
                        : [];
                  const checked = selectedIds.includes(line.id);
                  return (
                    <label
                      key={line.id}
                      className="flex items-center gap-2 text-chalk cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const base =
                            item.transformConfig ??
                            defaultTransformMapping(line.id);
                          const prevIds =
                            base.sourceLineIds?.length
                              ? base.sourceLineIds
                              : [base.sourceLineId];
                          let nextIds: string[];
                          if (e.target.checked) {
                            nextIds = prevIds.includes(line.id)
                              ? prevIds
                              : [...prevIds, line.id];
                          } else {
                            nextIds = prevIds.filter((id) => id !== line.id);
                            if (nextIds.length === 0) {
                              nextIds = [earlierTextLines[0]?.id ?? line.id];
                            }
                          }
                          setLineTransformConfig(item.id, {
                            ...base,
                            sourceLineIds: nextIds,
                            sourceLineId: nextIds[0]!,
                          });
                        }}
                        className="rounded-ctl border-rule"
                      />
                      <span className="truncate">{lineLabel(line)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <label className="flex flex-col gap-1 text-ctl text-chalk-dim">
              Source line
              <select
                value={item.transformConfig?.sourceLineId ?? ''}
                onChange={(e) => {
                  const id = e.target.value;
                  const base = item.transformConfig ?? defaultTransformMapping(id);
                  setLineTransformConfig(item.id, {
                    ...base,
                    sourceLineId: id,
                    sourceLineIds: [id],
                  });
                }}
                className="bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk"
              >
                {earlierTextLines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {lineLabel(line)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-ctl text-chalk-dim">
            Transform type
            <select
              value={item.transformConfig?.mode ?? 'segments'}
              onChange={(e) => {
                const mode = e.target.value as TransformMapping['mode'];
                const base = item.transformConfig ?? defaultTransformMapping(sourceLineItem?.id ?? '');
                const primary = base.sourceLineId || earlierTextLines[0]?.id || '';
                setLineTransformConfig(item.id, {
                  ...base,
                  mode,
                  sourceLineId: primary,
                  sourceLineIds:
                    mode === 'whole'
                      ? base.sourceLineIds?.length
                        ? base.sourceLineIds
                        : [primary]
                      : [primary],
                });
              }}
              className="bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk"
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
                className="self-start rounded-ctl border border-rule px-2 py-1 text-ctl text-chalk hover:bg-rule disabled:cursor-not-allowed disabled:opacity-40"
              >
                Map segments…
              </button>
              {sourceLineItem && (
                <SegmentMapperModal
                  open={mapperOpen}
                  onClose={() => setMapperOpen(false)}
                  sourceRaw={sourceLineItem.raw}
                  targetRaw={item.raw}
                  sourceBaseDir={sourceLineItem.baseDir}
                  targetBaseDir={baseDir}
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

      <div className="rounded-ctl border border-rule bg-ink/40 p-2">
        <div className="text-ctl font-medium text-chalk-dim mb-1.5">Quick layout</div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setInkEdge('RIGHT', 0.3)}
            className="rounded-ctl border border-rule px-2 py-0.5 text-ctl text-chalk hover:bg-rule"
          >
            Ink right
          </button>
          <button
            type="button"
            onClick={() => setInkEdge('LEFT', 0.3)}
            className="rounded-ctl border border-rule px-2 py-0.5 text-ctl text-chalk hover:bg-rule"
          >
            Ink left
          </button>
          <button
            type="button"
            onClick={() => setInkEdge('UP', 0.5)}
            className="rounded-ctl border border-rule px-2 py-0.5 text-ctl text-chalk hover:bg-rule"
          >
            Ink top
          </button>
          <button
            type="button"
            onClick={() => setInkEdge('DOWN', 0.5)}
            className="rounded-ctl border border-rule px-2 py-0.5 text-ctl text-chalk hover:bg-rule"
          >
            Ink bottom
          </button>
          <button
            type="button"
            onClick={centerX}
            className="rounded-ctl border border-rule px-2 py-0.5 text-ctl text-chalk hover:bg-rule"
          >
            Center X
          </button>
        </div>
        {!item.measure && (
          <p className="mt-1.5 text-meta text-chalk-faint">
            Ink alignment is most accurate after measurement completes.
          </p>
        )}
      </div>

      <div>
        <div className="text-ctl text-chalk-dim mb-1">Positioning steps ({item.posSteps.length})</div>
        <PositionStepsEditor
          steps={item.posSteps}
          onChange={(s) => set({ posSteps: s })}
          currentItemId={item.id}
          snapBuffer={item.snapBuffer ?? 0.3}
          onSnapBufferChange={(snapBuffer) => set({ snapBuffer: Math.max(0, snapBuffer) })}
        />
      </div>
    </div>
  );

  const segmentsContent = (
    <div className="flex flex-col gap-3">
      <SegmentEditor
        segments={item.segments}
        kinds={segmentLangs}
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
