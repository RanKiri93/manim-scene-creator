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
  TransformMapping,
  AudioTrackItem,
} from '@/types/scene';
import { generateAudio, uploadRecordedAudio } from '@/services/measureClient';
import { isTopLevelItem, isActiveAtTime, effectiveEnd } from '@/lib/time';
import {
  MEASURE_SERVER_DEFAULT_URL,
  PROJECT_VERSION,
} from '@/lib/constants';
import { createTextLineInCompound, defaultSceneDefaults } from './factories';

enableMapSet();

function syncCompoundDuration(
  items: Map<ItemId, SceneItem>,
  compoundId: ItemId,
): void {
  const c = items.get(compoundId);
  if (c?.kind !== 'compound') return;
  let maxEnd = 0;
  for (const cid of c.childIds) {
    const ch = items.get(cid);
    if (ch?.kind === 'textLine') {
      const ls = ch.localStart ?? 0;
      const ld = ch.localDuration ?? ch.duration;
      maxEnd = Math.max(maxEnd, ls + ld);
    }
  }
  c.duration = Math.max(0.5, maxEnd);
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

export type AudioPanelMode = 'tts' | 'record';

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
  /** Append a new text line inside a compound (local timing after existing children). */
  addChildLineToCompound: (compoundId: ItemId) => void;

  // Timeline mutations
  moveItem: (id: ItemId, newStartTime: number) => void;
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

  /** TTS + Whisper: append an audio track at the current playhead. */
  addAudioItem: (text: string, lang: string) => Promise<void>;

  /** Upload mic recording and append an audio track at the current playhead. */
  addRecordedAudioTrack: (blob: Blob) => Promise<void>;
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
      }),

      updateItem: (id, patch) => set((s) => {
        const item = s.items.get(id);
        if (item) Object.assign(item, patch);
        const after = s.items.get(id);
        if (after?.kind === 'textLine' && after.parentId) {
          syncCompoundDuration(s.items, after.parentId);
        }
      }),

      removeItem: (id) => set((s) => {
        const it = s.items.get(id);
        if (it?.kind === 'compound') {
          for (const cid of [...it.childIds]) {
            s.items.delete(cid);
            s.selectedIds.delete(cid);
            if (s.inspectedId === cid) s.inspectedId = null;
          }
        }
        if (it?.kind === 'textLine' && it.parentId) {
          const p = s.items.get(it.parentId);
          if (p?.kind === 'compound') {
            p.childIds = p.childIds.filter((x) => x !== id);
            syncCompoundDuration(s.items, it.parentId);
          }
        }
        s.items.delete(id);
        s.selectedIds.delete(id);
        if (s.inspectedId === id) s.inspectedId = null;
      }),

      duplicateItem: (id) => {
        const src = get().items.get(id);
        if (!src) return;
        if (src.kind === 'textLine' && src.parentId) return;
        if (src.kind === 'compound') {
          const clone = structuredClone(src) as typeof src;
          clone.id = crypto.randomUUID().slice(0, 12);
          clone.label = (src.label || 'Compound') + ' (copy)';
          clone.childIds = [];
          clone.startTime = src.startTime + src.duration + src.waitAfter;
          set((s) => { s.items.set(clone.id, clone); });
          return;
        }
        const clone = structuredClone(src) as SceneItem;
        clone.id = crypto.randomUUID().slice(0, 12);
        clone.label = src.label + ' (copy)';
        if (clone.kind === 'textLine' && !clone.parentId) {
          clone.startTime = src.startTime + src.duration + src.waitAfter;
        }
        set((s) => { s.items.set(clone.id, clone); });
      },

      addChildLineToCompound: (compoundId) => set((s) => {
        const c = s.items.get(compoundId);
        if (c?.kind !== 'compound') return;
        let maxEnd = 0;
        for (const cid of c.childIds) {
          const ch = s.items.get(cid);
          if (ch?.kind === 'textLine') {
            maxEnd = Math.max(maxEnd, (ch.localStart ?? 0) + (ch.localDuration ?? ch.duration));
          }
        }
        const child = createTextLineInCompound(s.defaults, compoundId, maxEnd, 3);
        c.childIds.push(child.id);
        s.items.set(child.id, child);
        syncCompoundDuration(s.items, compoundId);
      }),

      // ── Timeline mutations ──
      moveItem: (id, newStartTime) => set((s) => {
        const item = s.items.get(id);
        if (item) item.startTime = Math.max(0, newStartTime);
      }),
      resizeItem: (id, newDuration) => set((s) => {
        const item = s.items.get(id);
        if (item) item.duration = Math.max(0.01, newDuration);
      }),
      setItemLayer: (id, layer) => set((s) => {
        const item = s.items.get(id);
        if (item) item.layer = Math.max(0, layer);
      }),

      // ── Spatial mutations ──
      setItemPosition: (id, x, y) => set((s) => {
        const item = s.items.get(id);
        if (item?.kind === 'compound') return;
        if (item) { item.x = x; item.y = y; }
      }),
      setItemScale: (id, scale) => set((s) => {
        const item = s.items.get(id);
        if (item?.kind === 'compound') return;
        if (item) item.scale = Math.max(0.01, scale);
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
          .filter((it) => isActiveAtTime(it, time, items))
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
          let end: number;
          if (it.kind === 'compound') {
            end = it.startTime + it.duration + it.waitAfter;
          } else if (it.kind === 'textLine' && it.parentId) {
            end = effectiveEnd(it, items) + it.waitAfter;
          } else {
            end = it.startTime + it.duration + it.waitAfter;
          }
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
        s.items = new Map();
        for (const item of file.items) {
          s.items.set(item.id, item as SceneItem);
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

      addAudioItem: async (text, lang) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const baseUrl = get().measureConfig.url;
        const { audioBase64, duration, boundaries } = await generateAudio(
          baseUrl,
          trimmed,
          lang,
        );
        const binary = atob(audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'audio/mpeg' });
        const audioUrl = URL.createObjectURL(blob);
        const startTime = get().currentTime ?? 0;
        const track: AudioTrackItem = {
          id: crypto.randomUUID().slice(0, 12),
          text: trimmed,
          audioUrl,
          boundaries,
          startTime,
          duration,
        };
        set((s) => {
          s.audioItems.push(track);
        });
      },

      addRecordedAudioTrack: async (blob) => {
        const baseUrl = get().measureConfig.url;
        const {
          file_path,
          duration: apiDuration,
          word_boundaries,
        } = await uploadRecordedAudio(baseUrl, blob);
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
          text: 'Mic recording',
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