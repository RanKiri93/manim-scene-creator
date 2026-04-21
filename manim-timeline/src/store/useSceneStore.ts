import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { temporal } from 'zundo';
import type {
  ItemId,
  SceneItem,
  TextLineItem,
  SceneDefaults,
  MeasureConfig,
  MeasureResult,
  ProjectFile,
  ProjectFragmentFile,
  TransformMapping,
  AudioTrackItem,
  GraphFunctionSeriesItem,
} from '@/types/scene';
import { functionSeriesTotalDuration } from '@/types/scene';
import { validateFunctionSeries } from '@/lib/functionSeriesValidation';
import { generateAudio, uploadRecordedAudio } from '@/services/measureClient';
import {
  isTopLevelItem,
  isActiveAtTime,
  isTransformSourceHiddenInPreview,
  segmentWaitTotal,
  timelineSpanEnd,
  minExitStartTimeForClip,
} from '@/lib/time';
import { scaleSegmentAnimForLineDuration } from '@/lib/segmentAnimDurations';

function clampAllExitStarts(items: Map<ItemId, SceneItem>): void {
  for (const it of items.values()) {
    if (it.kind !== 'exit_animation') continue;
    const minT = minExitStartTimeForClip(it, items);
    if (minT != null && it.startTime < minT) it.startTime = minT;
  }
}

/**
 * Recompute derived fields on a function series (total duration + validation).
 * Called after any mutation that affects range / timings / expression / xDomain.
 */
function syncFunctionSeriesDerived(
  item: GraphFunctionSeriesItem,
  itemsMap: Map<ItemId, SceneItem>,
): void {
  item.duration = Math.max(0.01, functionSeriesTotalDuration(item));
  const v = validateFunctionSeries(item, itemsMap);
  item.topLevelError = v.topLevelError;
  item.perNErrors = v.perNErrors;
}
import {
  MEASURE_SERVER_DEFAULT_URL,
  PROJECT_VERSION,
} from '@/lib/constants';
import { defaultSceneDefaults } from './factories';
import { migrateItemsToCurrentVersion } from '@/lib/migrateLoadedItems';
import {
  applyTimeShiftToFragment,
  collectReservedIdsFromMap,
  fragmentEarliestStart,
  remapFragmentItemsInPlace,
  type FragmentTimeMode,
} from '@/lib/projectFragment';

enableMapSet();

function revokeAudioBlobUrls(tracks: AudioTrackItem[]) {
  for (const a of tracks) {
    const u = a.audioUrl;
    if (typeof u === 'string' && u.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* ignore */
      }
    }
  }
}

// ── Playback slice ──

interface PlaybackSlice {
  currentTime: number;
  isPlaying: boolean;
  togglePlayback: () => void;
  setCurrentTime: (time: number) => void;
  viewRange: [number, number];
}

// ── Selection slice ──

interface SelectionSlice {
  selectedIds: Set<ItemId>;
  inspectedId: ItemId | null;
}

export type AudioPanelMode = 'tts' | 'record' | 'upload';

interface UiSlice {
  exportOpen: boolean;
  audioMode: AudioPanelMode | null;
  setExportOpen: (open: boolean) => void;
  setAudioMode: (mode: AudioPanelMode | null) => void;
}

// ── Scene data slice ──

interface SceneDataSlice {
  items: Map<ItemId, SceneItem>;
  defaults: SceneDefaults;
  measureConfig: MeasureConfig;
  audioItems: AudioTrackItem[];
}

// ── Combined store ──

export interface SceneStore extends SceneDataSlice, PlaybackSlice, SelectionSlice, UiSlice {
  // Playhead
  play: () => void;
  pause: () => void;
  setViewRange: (range: [number, number]) => void;

  // Selection
  select: (id: ItemId, additive?: boolean) => void;
  deselect: (id: ItemId) => void;
  clearSelection: () => void;
  inspect: (id: ItemId | null) => void;

  // CRUD
  addItem: (item: SceneItem) => void;
  updateItem: <K extends SceneItem['kind']>(
    id: ItemId,
    patch: Partial<Extract<SceneItem, { kind: K }>>,
  ) => void;
  removeItem: (id: ItemId) => void;
  duplicateItem: (id: ItemId) => void;
  // Timeline mutations
  moveItem: (id: ItemId, newStartTime: number) => void;
  moveAudioItem: (id: string, newStartTime: number) => void;
  /** Remove a timeline audio track (revokes blob URL; clears matching `audioTrackId` on clips). */
  removeAudioItem: (id: string) => void;
  /**
   * Remove empty timeline time [gapStart, gapEnd): shift every top-level clip and audio
   * track with startTime >= gapEnd left by (gapEnd - gapStart).
   */
  closeGap: (gapStart: number, gapEnd: number) => void;
  /** Move many scene clips in one undo step; reclamps exit_animation starts. */
  setSceneItemStartTimes: (updates: { id: ItemId; startTime: number }[]) => void;
  /** Move many audio clips in one undo step. */
  setAudioItemStartTimes: (updates: { id: string; startTime: number }[]) => void;
  resizeItem: (id: ItemId, newDuration: number) => void;
  setItemLayer: (id: ItemId, layer: number) => void;

  // Spatial mutations
  setItemPosition: (id: ItemId, x: number, y: number) => void;
  setItemScale: (id: ItemId, scale: number) => void;

  // Measurement
  setMeasureResult: (
    id: ItemId,
    result: MeasureResult | null,
    error?: string | null,
  ) => void;

  /** Set or clear visual segment transform mapping for a text line. */
  setLineTransformConfig: (
    id: ItemId,
    transformConfig: TransformMapping | null,
  ) => void;

  // Defaults
  setDefaults: (patch: Partial<SceneDefaults>) => void;
  setMeasureConfig: (patch: Partial<MeasureConfig>) => void;

  // Queries
  getVisibleItems: (time: number) => SceneItem[];
  getTimelineOrder: () => SceneItem[];
  getSceneDuration: () => number;
  getItem: (id: ItemId) => SceneItem | undefined;

  // Serialization
  toProjectFile: () => ProjectFile;
  loadProjectFile: (file: ProjectFile) => void;
  /** Merge a portable fragment into the current scene (new ids; optional time shift). */
  importFragment: (
    fragment: ProjectFragmentFile,
    opts: { timeMode: FragmentTimeMode },
  ) => void;

  /** TTS + Whisper: append an audio track at the current playhead. */
  addAudioItem: (text: string, lang: string) => Promise<void>;

  /** Upload mic or file recording; optional script label and multipart filename for the server. */
  addRecordedAudioTrack: (
    blob: Blob,
    options?: {
      displayText?: string;
      filename?: string;
      /** Used when displayText is empty after trim (e.g. "Uploaded audio"). */
      emptyLabel?: string;
      /** Whisper / ASR language hint for the measure server (`iw` | `en`). */
      transcriptionLang?: string;
    },
  ) => Promise<void>;
}

export const useSceneStore = create<SceneStore>()(
  temporal(
    immer<SceneStore>((set, get) => ({
      // ── Initial state ──
      items: new Map(),
      defaults: defaultSceneDefaults(),
      measureConfig: {
        url: MEASURE_SERVER_DEFAULT_URL,
        enabled: true,
        includePreview: true,
      },
      audioItems: [],
      currentTime: 0,
      isPlaying: false,
      viewRange: [0, 30],
      selectedIds: new Set(),
      inspectedId: null,
      exportOpen: false,
      audioMode: null,
      setExportOpen: (open) => set((s) => { s.exportOpen = open; }),
      setAudioMode: (mode) => set((s) => { s.audioMode = mode; }),

      // ── Playhead ──
      setCurrentTime: (time) => set((s) => { s.currentTime = Math.max(0, time); }),
      play: () => set((s) => { s.isPlaying = true; }),
      pause: () => set((s) => { s.isPlaying = false; }),
      togglePlayback: () => set((s) => { s.isPlaying = !s.isPlaying; }),
      setViewRange: (range) => set((s) => { s.viewRange = range; }),

      // ── Selection ──
      select: (id, additive = false) => set((s) => {
        if (!additive) s.selectedIds = new Set();
        s.selectedIds.add(id);
        s.inspectedId = id;
      }),
      deselect: (id) => set((s) => {
        s.selectedIds.delete(id);
        if (s.inspectedId === id) s.inspectedId = null;
      }),
      clearSelection: () => set((s) => {
        s.selectedIds = new Set();
        s.inspectedId = null;
      }),
      inspect: (id) => set((s) => { s.inspectedId = id; }),

      // ── CRUD ──
      addItem: (item) => set((s) => {
        s.items.set(item.id, item as SceneItem);
        if (item.kind === 'graphFunctionSeries') {
          const fs = s.items.get(item.id) as GraphFunctionSeriesItem;
          syncFunctionSeriesDerived(fs, s.items);
        }
      }),

      updateItem: (id, patch) => set((s) => {
        const item = s.items.get(id);
        if (item) {
          Object.assign(item, patch);
          if (item.kind === 'graphFunctionSeries') {
            syncFunctionSeriesDerived(item, s.items);
          }
        }
      }),

      removeItem: (id) => set((s) => {
        for (const [eid, ex] of [...s.items.entries()]) {
          if (
            ex.kind === 'exit_animation' &&
            ex.targets.some((t) => t.targetId === id)
          ) {
            s.items.delete(eid);
            s.selectedIds.delete(eid);
            if (s.inspectedId === eid) s.inspectedId = null;
          }
        }
        for (const [rid, sr] of [...s.items.entries()]) {
          if (sr.kind !== 'surroundingRect') continue;
          const tids = sr.targetIds ?? [];
          if (!tids.includes(id)) continue;
          const next = tids.filter((x) => x !== id);
          if (next.length === 0) {
            s.items.delete(rid);
            s.selectedIds.delete(rid);
            if (s.inspectedId === rid) s.inspectedId = null;
          } else {
            sr.targetIds = next;
            const sole = next.length === 1 ? s.items.get(next[0]!) : null;
            if (!sole || sole.kind !== 'textLine') {
              sr.segmentIndices = null;
            }
          }
        }
        s.items.delete(id);
        s.selectedIds.delete(id);
        if (s.inspectedId === id) s.inspectedId = null;
      }),

      duplicateItem: (id) => {
        const src = get().items.get(id);
        if (!src) return;
        if (
          src.kind === 'graphPlot' ||
          src.kind === 'graphDot' ||
          src.kind === 'graphField' ||
          src.kind === 'graphFunctionSeries' ||
          src.kind === 'graphArea' ||
          src.kind === 'shape'
        ) {
          const clone = structuredClone(src) as SceneItem;
          clone.id = crypto.randomUUID().slice(0, 12);
          clone.label = (src.label || '') + ' (copy)';
          clone.startTime = src.startTime + src.duration;
          set((s) => {
            s.items.set(clone.id, clone);
            if (clone.kind === 'graphFunctionSeries') {
              syncFunctionSeriesDerived(clone, s.items);
            }
          });
          return;
        }
        if (src.kind === 'exit_animation') {
          const clone = structuredClone(src) as typeof src;
          clone.id = crypto.randomUUID().slice(0, 12);
          clone.label = (src.label || '') + ' (copy)';
          clone.startTime = src.startTime + src.duration;
          set((s) => { s.items.set(clone.id, clone); });
          return;
        }
        if (src.kind === 'surroundingRect') {
          const clone = structuredClone(src) as typeof src;
          clone.id = crypto.randomUUID().slice(0, 12);
          clone.label = (src.label || '') + ' (copy)';
          clone.startTime = src.startTime + src.runTime;
          set((s) => { s.items.set(clone.id, clone); });
          return;
        }
        const clone = structuredClone(src) as SceneItem;
        clone.id = crypto.randomUUID().slice(0, 12);
        clone.label = src.label + ' (copy)';
        if (clone.kind === 'textLine' || clone.kind === 'axes' || clone.kind === 'shape') {
          clone.startTime = src.startTime + src.duration;
        }
        set((s) => { s.items.set(clone.id, clone); });
      },

      // ── Timeline mutations ──
      moveItem: (id, newStartTime) => set((s) => {
        const item = s.items.get(id);
        if (!item) return;
        let t = Math.max(0, newStartTime);
        if (item.kind === 'exit_animation') {
          const minT = minExitStartTimeForClip(item, s.items);
          if (minT != null) t = Math.max(t, minT);
        }
        item.startTime = t;
      }),
      moveAudioItem: (id, newStartTime) => set((s) => {
        const track = s.audioItems.find((a) => a.id === id);
        if (track) track.startTime = Math.max(0, newStartTime);
      }),

      removeAudioItem: (id) => set((s) => {
        const idx = s.audioItems.findIndex((a) => a.id === id);
        if (idx < 0) return;
        const track = s.audioItems[idx]!;
        const u = track.audioUrl;
        if (typeof u === 'string' && u.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(u);
          } catch {
            /* ignore */
          }
        }
        s.audioItems.splice(idx, 1);
        s.selectedIds.delete(id);
        for (const it of s.items.values()) {
          if (!('audioTrackId' in it)) continue;
          const link = it as { audioTrackId?: string | null };
          if (link.audioTrackId === id) link.audioTrackId = null;
        }
      }),

      closeGap: (gapStart, gapEnd) => set((s) => {
        if (
          !Number.isFinite(gapStart) ||
          !Number.isFinite(gapEnd) ||
          !(gapEnd > gapStart)
        ) {
          return;
        }
        const delta = gapEnd - gapStart;
        for (const it of s.items.values()) {
          if (!isTopLevelItem(it)) continue;
          if (it.startTime >= gapEnd) {
            it.startTime = Math.max(0, it.startTime - delta);
          }
        }
        for (const a of s.audioItems) {
          if (a.startTime >= gapEnd) {
            a.startTime = Math.max(0, a.startTime - delta);
          }
        }
        clampAllExitStarts(s.items);
      }),

      setSceneItemStartTimes: (updates) => set((s) => {
        for (const { id, startTime } of updates) {
          const item = s.items.get(id);
          if (!item || !isTopLevelItem(item)) continue;
          item.startTime = Math.max(0, startTime);
        }
        clampAllExitStarts(s.items);
      }),

      setAudioItemStartTimes: (updates) => set((s) => {
        for (const { id, startTime } of updates) {
          const track = s.audioItems.find((a) => a.id === id);
          if (track) track.startTime = Math.max(0, startTime);
        }
      }),

      resizeItem: (id, newDuration) => set((s) => {
        const item = s.items.get(id);
        if (!item) return;
        if (item.kind === 'textLine') {
          const w = segmentWaitTotal(item.segments);
          const base = Math.max(0.01, newDuration - w);
          const tl = item as TextLineItem;
          tl.segments = scaleSegmentAnimForLineDuration(
            tl.segments,
            tl.duration,
            base,
          );
          tl.duration = base;
          return;
        }
        if (item.kind === 'surroundingRect') {
          item.runTime = Math.max(0.05, newDuration);
          return;
        }
        if (item.kind === 'graphFunctionSeries') {
          // Function series duration is derived from per-n anim+wait; ignore direct resize.
          return;
        }
        item.duration = Math.max(0.01, newDuration);
      }),
      setItemLayer: (id, layer) => set((s) => {
        const item = s.items.get(id);
        if (item) item.layer = Math.max(0, layer);
      }),

      // ── Spatial mutations ──
      setItemPosition: (id, x, y) => set((s) => {
        const item = s.items.get(id);
        if (item?.kind === 'exit_animation' || item?.kind === 'surroundingRect') {
          return;
        }
        if (item) { item.x = x; item.y = y; }
      }),
      setItemScale: (id, scale) => set((s) => {
        const item = s.items.get(id);
        if (item?.kind === 'exit_animation' || item?.kind === 'surroundingRect') {
          return;
        }
        if (!item) return;
        const sc = Math.max(0.01, scale);
        if (item.kind === 'axes') {
          const prev = Math.sqrt(
            Math.max(0.01, item.scaleX) * Math.max(0.01, item.scaleY),
          );
          const ratio = sc / prev;
          item.scaleX = Math.max(0.01, item.scaleX * ratio);
          item.scaleY = Math.max(0.01, item.scaleY * ratio);
          item.scale = sc;
          return;
        }
        item.scale = sc;
      }),

      // ── Measurement ──
      setMeasureResult: (id, result, error = null) => set((s) => {
        const item = s.items.get(id);
        if (item && item.kind === 'textLine') {
          const tl = item as TextLineItem;
          tl.measure = result;
          tl.measureError = error ?? null;
          tl.previewDataUrl = result?.pngBase64
            ? `data:image/png;base64,${result.pngBase64}`
            : null;
          tl.segmentMeasures = result?.segmentMeasures ?? null;
        }
      }),

      setLineTransformConfig: (id, transformConfig) => set((s) => {
        const item = s.items.get(id);
        if (item?.kind !== 'textLine') return;
        item.transformConfig = transformConfig;
      }),

      // ── Defaults ──
      setDefaults: (patch) => set((s) => { Object.assign(s.defaults, patch); }),
      setMeasureConfig: (patch) => set((s) => { Object.assign(s.measureConfig, patch); }),

      // ── Queries ──
      getVisibleItems: (time) => {
        const items = get().items;
        return Array.from(items.values())
          .filter((it) => {
            if (!isActiveAtTime(it, time, items)) return false;
            if (
              it.kind === 'textLine' &&
              isTransformSourceHiddenInPreview(it, time, items)
            ) {
              return false;
            }
            return true;
          })
          .sort((a, b) => a.layer - b.layer);
      },

      getTimelineOrder: () => {
        return Array.from(get().items.values())
          .filter(isTopLevelItem)
          .sort((a, b) => a.startTime - b.startTime || a.layer - b.layer);
      },

      getSceneDuration: () => {
        const items = get().items;
        let max = 0;
        for (const it of items.values()) {
          const end = timelineSpanEnd(it, items);
          if (end > max) max = end;
        }
        for (const a of get().audioItems) {
          max = Math.max(max, a.startTime + a.duration);
        }
        return max;
      },

      getItem: (id) => get().items.get(id),

      // ── Serialization ──
      toProjectFile: () => ({
        version: PROJECT_VERSION,
        savedAt: new Date().toISOString(),
        defaults: { ...get().defaults },
        items: Array.from(get().items.values()),
        measureConfig: { ...get().measureConfig },
        audioItems:
          get().audioItems.length > 0
            ? get().audioItems.map((a) => ({ ...a }))
            : undefined,
      }),

      loadProjectFile: (file) => set((s) => {
        revokeAudioBlobUrls(s.audioItems);
        s.items = new Map();
        const migrated = migrateItemsToCurrentVersion(
          file.items as SceneItem[],
          file.version ?? 0,
        );
        for (const item of migrated) {
          s.items.set(item.id, item);
        }
        for (const it of s.items.values()) {
          if (it.kind === 'graphFunctionSeries') {
            syncFunctionSeriesDerived(it, s.items);
          }
        }
        s.defaults = { ...s.defaults, ...file.defaults };
        if (!s.defaults.sceneName?.trim()) {
          s.defaults.sceneName = 'Scene1';
        }
        s.measureConfig = { ...s.measureConfig, ...file.measureConfig };
        s.audioItems = file.audioItems?.length
          ? file.audioItems.map((a) => ({ ...a }))
          : [];
        s.currentTime = 0;
        s.isPlaying = false;
        s.selectedIds = new Set();
        s.inspectedId = null;
      }),

      importFragment: (fragment, opts) =>
        set((s) => {
          const migrated = migrateItemsToCurrentVersion(
            fragment.items as SceneItem[],
            fragment.version ?? 0,
          );
          const audioIn =
            fragment.audioItems?.map((a) => ({ ...a })) ?? [];

          const reserved = collectReservedIdsFromMap(s.items);
          for (const a of s.audioItems) {
            reserved.add(a.id);
          }
          remapFragmentItemsInPlace(migrated, audioIn, reserved);

          const t0 = fragmentEarliestStart(migrated, audioIn);
          let delta = 0;
          if (opts.timeMode === 'playhead') {
            delta = get().currentTime - t0;
          } else if (opts.timeMode === 'appendEnd') {
            let max = 0;
            for (const it of s.items.values()) {
              const end = timelineSpanEnd(it, s.items);
              if (end > max) max = end;
            }
            for (const a of s.audioItems) {
              max = Math.max(max, a.startTime + a.duration);
            }
            delta = max - t0;
          }
          applyTimeShiftToFragment(migrated, audioIn, delta);

          for (const it of migrated) {
            s.items.set(it.id, it);
          }
          for (const a of audioIn) {
            s.audioItems.push(a);
          }
          for (const it of migrated) {
            if (it.kind === 'graphFunctionSeries') {
              syncFunctionSeriesDerived(it, s.items);
            }
          }
          clampAllExitStarts(s.items);

          s.selectedIds = new Set(migrated.map((it) => it.id));
          s.inspectedId = migrated[0]?.id ?? null;
        }),

      addAudioItem: async (text, lang) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const baseUrl = get().measureConfig.url;
        const { duration, boundaries, filePath } = await generateAudio(
          baseUrl,
          trimmed,
          lang,
        );
        const root = baseUrl.replace(/\/$/, '');
        const audioUrl = `${root}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
        const startTime = get().currentTime ?? 0;
        const track: AudioTrackItem = {
          id: crypto.randomUUID().slice(0, 12),
          text: trimmed,
          audioUrl,
          assetRelPath: filePath,
          boundaries,
          startTime,
          duration,
        };
        set((s) => {
          s.audioItems.push(track);
        });
      },

      addRecordedAudioTrack: async (blob, options) => {
        const baseUrl = get().measureConfig.url;
        const trimmed = options?.displayText?.trim();
        const trackText =
          trimmed || options?.emptyLabel || 'Mic recording';
        const uploadName = options?.filename?.trim() || 'recording.webm';
        const {
          file_path,
          duration: apiDuration,
          word_boundaries,
        } = await uploadRecordedAudio(baseUrl, blob, uploadName, {
          lang: options?.transcriptionLang,
        });
        const root = baseUrl.replace(/\/$/, '');
        const audioUrl =
          file_path.startsWith('http://') || file_path.startsWith('https://')
            ? file_path
            : `${root}${file_path.startsWith('/') ? '' : '/'}${file_path}`;
        let duration = apiDuration;
        if (duration == null || !Number.isFinite(duration) || duration <= 0) {
          const previewUrl = URL.createObjectURL(blob);
          try {
            const audio = document.createElement('audio');
            audio.preload = 'metadata';
            audio.src = previewUrl;
            await new Promise<void>((resolve, reject) => {
              audio.onloadedmetadata = () => resolve();
              audio.onerror = () =>
                reject(new Error('Could not read recording duration'));
            });
            duration = Number.isFinite(audio.duration) ? audio.duration : 1;
          } finally {
            URL.revokeObjectURL(previewUrl);
          }
        }
        duration = Math.max(0.01, duration);
        const startTime = get().currentTime ?? 0;
        const track: AudioTrackItem = {
          id: crypto.randomUUID().slice(0, 12),
          text: trackText,
          audioUrl,
          boundaries: word_boundaries ?? [],
          startTime,
          duration,
        };
        set((s) => {
          s.audioItems.push(track);
        });
      },
    })),
    { limit: 50 },
  ),
);
if (typeof window !== 'undefined') {
  (window as any).useSceneStore = useSceneStore;
}