import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { WritableDraft } from 'immer';
import { temporal } from 'zundo';
import type {
  ItemId,
  SceneItem,
  TextLineItem,
  AxesItem,
  SceneDefaults,
  FrameDef,
  MeasureConfig,
  MeasureResult,
  ProjectFile,
  ProjectFragmentFile,
  TransformMapping,
  AudioTrackItem,
  GraphFunctionSeriesItem,
  GraphPointSequenceItem,
} from '@/types/scene';
import { functionSeriesTotalDuration, pointSequenceTotalDuration } from '@/types/scene';
import { validateFunctionSeries } from '@/lib/functionSeriesValidation';
import { validatePointSequence } from '@/lib/pointSequenceValidation';
import { generateAudio, normalizeAudio, uploadRecordedAudio } from '@/services/measureClient';
import {
  isTopLevelItem,
  isActiveAtTime,
  isTransformSourceHiddenInPreview,
  segmentWaitTotal,
  timelineSpanEnd,
  minExitStartTimeForClip,
  effectiveStart,
  minBlinkStartTimeForClip,
  minTargetAnimationStartTimeForClip,
} from '@/lib/time';
import { scaleSegmentAnimForLineDuration } from '@/lib/segmentAnimDurations';
import { isAudioBindingNone, explicitVisualOwnerForAudioTrack } from '@/lib/audioBinding';
import {
  deriveAudioAssetRelPath,
  measureServerRelativeAudioPath,
} from '@/lib/audioAssetPath';
import {
  computeChainedStartsForSortedUnlinked,
  computeStartAfterPrevious,
} from '@/lib/audioGapPresets';

function clampAllExitStarts(items: Map<ItemId, SceneItem>): void {
  for (const it of items.values()) {
    if (it.kind !== 'exit_animation') continue;
    const minT = minExitStartTimeForClip(it, items);
    if (minT != null && it.startTime < minT) it.startTime = minT;
  }
}

function clampAllBlinkStarts(items: Map<ItemId, SceneItem>): void {
  for (const it of items.values()) {
    if (it.kind !== 'blink_animation') continue;
    const minT = minBlinkStartTimeForClip(it, items);
    if (minT != null && it.startTime < minT) it.startTime = minT;
  }
}

function clampAllTargetAnimationStarts(items: Map<ItemId, SceneItem>): void {
  for (const it of items.values()) {
    if (it.kind !== 'target_animation') continue;
    const minT = minTargetAnimationStartTimeForClip(it, items);
    if (minT != null && it.startTime < minT) it.startTime = minT;
  }
}

function clampEffectClipStarts(items: Map<ItemId, SceneItem>): void {
  clampAllExitStarts(items);
  clampAllBlinkStarts(items);
  clampAllTargetAnimationStarts(items);
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

function syncPointSequenceDerived(
  item: GraphPointSequenceItem,
  itemsMap: Map<ItemId, SceneItem>,
): void {
  item.duration = Math.max(0.01, pointSequenceTotalDuration(item));
  const v = validatePointSequence(item, itemsMap);
  item.topLevelError = v.topLevelError;
  item.perNErrors = v.perNErrors;
}
import {
  MEASURE_SERVER_DEFAULT_URL,
  PROJECT_VERSION,
} from '@/lib/constants';
import { defaultFrames, defaultSceneDefaults } from './factories';
import {
  ensureFrameConfig,
  normalizeItemFrameIdsInPlace,
} from '@/lib/frameGrid';
import { migrateItemsToCurrentVersion } from '@/lib/migrateLoadedItems';
import {
  applyTimeShiftToFragment,
  collectReservedIdsFromMap,
  fragmentEarliestStart,
  remapFragmentItemsInPlace,
  type FragmentTimeMode,
} from '@/lib/projectFragment';

enableMapSet();

const INITIAL_FRAME_CONFIG = defaultFrames();

function dedupeExclusiveAudioOwner(
  items: Map<ItemId, SceneItem>,
  ownerId: ItemId,
  audioTrackId: string | null | undefined,
): void {
  if (!audioTrackId || isAudioBindingNone(audioTrackId)) return;
  for (const other of items.values()) {
    if (other.id === ownerId) continue;
    if (!('audioTrackId' in other)) continue;
    if (other.audioTrackId === audioTrackId) {
      other.audioTrackId = null;
    }
  }
}

function syncAllExplicitAudioBindingsInDraft(
  items: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[],
): void {
  for (const item of items.values()) {
    if (!('audioTrackId' in item)) continue;
    const aid = item.audioTrackId;
    if (!aid || isAudioBindingNone(aid)) continue;
    const track = audioItems.find((a) => a.id === aid);
    if (!track) continue;
    track.startTime = Math.max(0, effectiveStart(item, items));
  }
}

/** Duplicated scene items drop audio linkage so explicit binding stays exclusive. */
function stripExclusiveAudioClone(c: SceneItem): void {
  if ('audioTrackId' in c) {
    (c as { audioTrackId?: string | null }).audioTrackId = null;
  }
}

function isFrameDrawable(item: SceneItem): boolean {
  return !(
    item.kind === 'exit_animation' ||
    item.kind === 'blink_animation' ||
    item.kind === 'target_animation' ||
    item.kind === 'camera_move' ||
    item.kind === 'surroundingRect'
  );
}

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

/** Serializable scene slice loaded into the editor from disk or sibling scene tabs. */
export interface SceneDiskPayload {
  defaults: SceneDefaults;
  frames: FrameDef[];
  startFrameId: ItemId;
  items: SceneItem[];
  audioItems?: AudioTrackItem[];
}

function runLoadSceneDraft(
  s: WritableDraft<SceneStore>,
  payload: SceneDiskPayload,
  fileVersion: number,
): void {
  revokeAudioBlobUrls(s.audioItems);
  s.items = new Map();
  const migrated = migrateItemsToCurrentVersion(
    payload.items as SceneItem[],
    fileVersion,
  );
  const frameConfig = ensureFrameConfig(payload.frames, payload.startFrameId);
  s.frames = frameConfig.frames;
  s.startFrameId = frameConfig.startFrameId;
  s.activeFrameId = frameConfig.startFrameId;
  normalizeItemFrameIdsInPlace(migrated, s.frames, s.startFrameId);
  for (const item of migrated) {
    s.items.set(item.id, item);
  }
  for (const it of s.items.values()) {
    if (it.kind === 'graphFunctionSeries') {
      syncFunctionSeriesDerived(it as GraphFunctionSeriesItem, s.items);
    }
    if (it.kind === 'graphPointSequence') {
      syncPointSequenceDerived(it as GraphPointSequenceItem, s.items);
    }
  }
  s.defaults = { ...s.defaults, ...payload.defaults };
  if (!s.defaults.sceneName?.trim()) {
    s.defaults.sceneName = 'Scene1';
  }
  s.audioItems = payload.audioItems?.length
    ? payload.audioItems.map((a) => ({ ...a }))
    : [];
  s.currentTime = 0;
  s.isPlaying = false;
  s.selectedIds = new Set();
  s.inspectedId = null;
  s.polylinePointCaptureId = null;
  s.targetAnimationPathCapture = null;
  syncAllExplicitAudioBindingsInDraft(s.items, s.audioItems);
  clampEffectClipStarts(s.items);
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

export interface TargetAnimationPathCapture {
  clipId: ItemId;
  rowIndex: number;
}

interface UiSlice {
  exportOpen: boolean;
  audioMode: AudioPanelMode | null;
  agentOpen: boolean;
  /** Editor-only frame used as the default for newly-created drawable items. */
  activeFrameId: ItemId | null;
  /** When set, the next plain-canvas clicks append local points to that polyline shape. */
  polylinePointCaptureId: ItemId | null;
  /** When set, plain-canvas clicks append relative offsets to a target_animation path row. */
  targetAnimationPathCapture: TargetAnimationPathCapture | null;
  setExportOpen: (open: boolean) => void;
  setAudioMode: (mode: AudioPanelMode | null) => void;
  setAgentOpen: (open: boolean) => void;
  setActiveFrameId: (id: ItemId | null) => void;
  setPolylinePointCaptureId: (id: ItemId | null) => void;
  setTargetAnimationPathCapture: (capture: TargetAnimationPathCapture | null) => void;
}

// ── Scene data slice ──

interface SceneDataSlice {
  items: Map<ItemId, SceneItem>;
  frames: FrameDef[];
  startFrameId: ItemId;
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
  addFrame: (frame: FrameDef) => void;
  updateFrame: (id: ItemId, patch: Partial<Omit<FrameDef, 'id'>>) => void;
  removeFrame: (id: ItemId) => void;
  setStartFrame: (id: ItemId) => void;
  addItem: (item: SceneItem) => void;
  updateItem: <K extends SceneItem['kind']>(
    id: ItemId,
    patch: Partial<Extract<SceneItem, { kind: K }>>,
  ) => void;
  setItemAudioBinding: (itemId: ItemId, audioTrackId: string | null) => void;
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
  /** Snapshot current editor scene (defaults + clips + timeline audio) — no wrapper kind. */
  toSceneDiskPayload: () => SceneDiskPayload;
  loadProjectFile: (file: ProjectFile) => void;
  /** Load only scene-local data from disk; preserves `measureConfig`. Clears undo history. */
  loadSceneDocument: (payload: SceneDiskPayload, fileVersion: number) => void;
  clearUndoHistory: () => void;
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

  /**
   * Loudness-normalize an existing timeline audio clip (server ffmpeg loudnorm).
   * Replaces the audio file URL; keeps timing start, word boundaries, and bindings.
   */
  normalizeAudioTrack: (
    id: string,
    options?: { targetLufs?: number; truePeak?: number; lra?: number },
  ) => Promise<void>;

  /**
   * Move one unlinked audio clip to start `gapSec` after the latest preceding audio ends.
   */
  placeAudioAfterPrevious: (id: string, gapSec: number) => void;

  /**
   * Chain selected unlinked audio clips in timeline order with `gapSec` between end and next start.
   * Requires at least two movable (unlinked) selected audio tracks.
   */
  spaceSelectedAudioItems: (gapSec: number) => void;
}

export const useSceneStore = create<SceneStore>()(
  temporal(
    immer<SceneStore>((set, get) => ({
      // ── Initial state ──
      items: new Map(),
      frames: INITIAL_FRAME_CONFIG.frames,
      startFrameId: INITIAL_FRAME_CONFIG.startFrameId,
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
      agentOpen: false,
      activeFrameId: INITIAL_FRAME_CONFIG.startFrameId,
      polylinePointCaptureId: null,
      targetAnimationPathCapture: null,
      setExportOpen: (open) => set((s) => { s.exportOpen = open; }),
      setAudioMode: (mode) => set((s) => { s.audioMode = mode; }),
      setAgentOpen: (open) => set((s) => { s.agentOpen = open; }),
      setActiveFrameId: (id) =>
        set((s) => {
          s.activeFrameId = id && s.frames.some((f) => f.id === id) ? id : s.startFrameId;
        }),
      setPolylinePointCaptureId: (id) =>
        set((s) => {
          s.polylinePointCaptureId = id;
          if (id != null) s.targetAnimationPathCapture = null;
        }),
      setTargetAnimationPathCapture: (capture) =>
        set((s) => {
          s.targetAnimationPathCapture = capture;
          if (capture != null) s.polylinePointCaptureId = null;
        }),

      // ── Playhead ──
      setCurrentTime: (time) => set((s) => { s.currentTime = Math.max(0, time); }),
      play: () => set((s) => { s.isPlaying = true; }),
      pause: () => set((s) => { s.isPlaying = false; }),
      togglePlayback: () => set((s) => { s.isPlaying = !s.isPlaying; }),
      setViewRange: (range) => set((s) => { s.viewRange = range; }),

      // ── Selection ──
      select: (id, additive = false) => set((s) => {
        if (!additive) {
          if (
            s.polylinePointCaptureId != null &&
            s.polylinePointCaptureId !== id
          ) {
            s.polylinePointCaptureId = null;
          }
          if (
            s.targetAnimationPathCapture != null &&
            s.targetAnimationPathCapture.clipId !== id
          ) {
            s.targetAnimationPathCapture = null;
          }
          s.selectedIds = new Set();
        }
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
        s.polylinePointCaptureId = null;
        s.targetAnimationPathCapture = null;
      }),
      inspect: (id) => set((s) => { s.inspectedId = id; }),

      // ── CRUD ──
      addFrame: (frame) =>
        set((s) => {
          if (s.frames.some((f) => f.id === frame.id)) return;
          s.frames.push({ ...frame });
          s.activeFrameId = frame.id;
        }),

      updateFrame: (id, patch) =>
        set((s) => {
          const frame = s.frames.find((f) => f.id === id);
          if (!frame) return;
          if (typeof patch.col === 'number' && Number.isFinite(patch.col)) {
            frame.col = Math.trunc(patch.col);
          }
          if (typeof patch.row === 'number' && Number.isFinite(patch.row)) {
            frame.row = Math.trunc(patch.row);
          }
          if ('label' in patch) frame.label = patch.label;
        }),

      removeFrame: (id) =>
        set((s) => {
          if (s.frames.length <= 1) return;
          const idx = s.frames.findIndex((f) => f.id === id);
          if (idx < 0) return;
          s.frames.splice(idx, 1);
          const fallback = s.frames[0]!.id;
          if (s.startFrameId === id) s.startFrameId = fallback;
          if (s.activeFrameId === id) s.activeFrameId = s.startFrameId;
          const removedItemIds = new Set<ItemId>();
          for (const [itemId, item] of [...s.items.entries()]) {
            if (item.kind === 'camera_move' && item.targetFrameId === id) {
              s.items.delete(itemId);
              s.selectedIds.delete(itemId);
              if (s.inspectedId === itemId) s.inspectedId = null;
              continue;
            }
            if (isFrameDrawable(item) && 'frameId' in item && item.frameId === id) {
              s.items.delete(itemId);
              removedItemIds.add(itemId);
              s.selectedIds.delete(itemId);
              if (s.inspectedId === itemId) s.inspectedId = null;
            }
          }
          for (const [itemId, item] of [...s.items.entries()]) {
            if (
              item.kind === 'exit_animation' &&
              item.targets.some((t) => removedItemIds.has(t.targetId))
            ) {
              s.items.delete(itemId);
            } else if (
              item.kind === 'blink_animation' &&
              item.targets.some((t) => removedItemIds.has(t.targetId))
            ) {
              s.items.delete(itemId);
            } else if (
              item.kind === 'target_animation' &&
              item.targets.some((t) => removedItemIds.has(t.targetId))
            ) {
              s.items.delete(itemId);
            } else if (item.kind === 'surroundingRect') {
              const next = item.targetIds.filter((tid) => !removedItemIds.has(tid));
              if (next.length === 0) {
                s.items.delete(itemId);
              } else {
                item.targetIds = next;
              }
            }
            if (!s.items.has(itemId)) {
              s.selectedIds.delete(itemId);
              if (s.inspectedId === itemId) s.inspectedId = null;
            }
          }
        }),

      setStartFrame: (id) =>
        set((s) => {
          if (!s.frames.some((f) => f.id === id)) return;
          s.startFrameId = id;
          s.activeFrameId = id;
        }),

      addItem: (item) => set((s) => {
        if (isFrameDrawable(item)) {
          const frameOwned = item as SceneItem & { frameId?: ItemId };
          frameOwned.frameId =
            frameOwned.frameId && s.frames.some((f) => f.id === frameOwned.frameId)
              ? frameOwned.frameId
              : (s.activeFrameId ?? s.startFrameId);
        }
        s.items.set(item.id, item as SceneItem);
        if (item.kind === 'graphFunctionSeries') {
          const fs = s.items.get(item.id) as GraphFunctionSeriesItem;
          syncFunctionSeriesDerived(fs, s.items);
        }
        if (item.kind === 'graphPointSequence') {
          const ps = s.items.get(item.id) as GraphPointSequenceItem;
          syncPointSequenceDerived(ps, s.items);
        }
        clampEffectClipStarts(s.items);
        syncAllExplicitAudioBindingsInDraft(s.items, s.audioItems);
      }),

      updateItem: (id, patch) => set((s) => {
        const item = s.items.get(id);
        if (!item) return;
        if (
          item.kind === 'shape' &&
          patch &&
          typeof patch === 'object' &&
          'shapeType' in patch &&
          patch.shapeType !== 'polyline' &&
          s.polylinePointCaptureId === id
        ) {
          s.polylinePointCaptureId = null;
        }
        const audioPatch =
          patch &&
          typeof patch === 'object' &&
          'audioTrackId' in patch;
        Object.assign(item, patch);
        if (audioPatch && 'audioTrackId' in item) {
          dedupeExclusiveAudioOwner(s.items, id, item.audioTrackId);
        }
        if (item.kind === 'graphFunctionSeries') {
          syncFunctionSeriesDerived(item as GraphFunctionSeriesItem, s.items);
        }
        if (item.kind === 'graphPointSequence') {
          syncPointSequenceDerived(item as GraphPointSequenceItem, s.items);
        }
        clampEffectClipStarts(s.items);
        syncAllExplicitAudioBindingsInDraft(s.items, s.audioItems);
      }),

      setItemAudioBinding: (itemId, audioTrackId) => set((s) => {
        const item = s.items.get(itemId);
        if (!item || !('audioTrackId' in item)) return;
        if (audioTrackId && !isAudioBindingNone(audioTrackId)) {
          dedupeExclusiveAudioOwner(s.items, itemId, audioTrackId);
        }
        (item as { audioTrackId?: string | null }).audioTrackId =
          audioTrackId;
        syncAllExplicitAudioBindingsInDraft(s.items, s.audioItems);
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
        for (const [bid, bl] of [...s.items.entries()]) {
          if (
            bl.kind === 'blink_animation' &&
            bl.targets.some((t) => t.targetId === id)
          ) {
            s.items.delete(bid);
            s.selectedIds.delete(bid);
            if (s.inspectedId === bid) s.inspectedId = null;
          }
        }
        for (const [taid, ta] of [...s.items.entries()]) {
          if (
            ta.kind === 'target_animation' &&
            ta.targets.some((t) => t.targetId === id)
          ) {
            s.items.delete(taid);
            s.selectedIds.delete(taid);
            if (s.inspectedId === taid) s.inspectedId = null;
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
        if (s.polylinePointCaptureId === id) s.polylinePointCaptureId = null;
        if (
          s.targetAnimationPathCapture?.clipId === id ||
          s.targetAnimationPathCapture != null
        ) {
          const cap = s.targetAnimationPathCapture;
          if (cap?.clipId === id || cap == null) {
            s.targetAnimationPathCapture = null;
          } else {
            const clip = s.items.get(cap.clipId);
            if (
              clip?.kind !== 'target_animation' ||
              clip.targets[cap.rowIndex]?.targetId === id
            ) {
              s.targetAnimationPathCapture = null;
            }
          }
        }
      }),

      duplicateItem: (id) => {
        const src = get().items.get(id);
        if (!src) return;
        if (
          src.kind === 'graphPlot' ||
          src.kind === 'graphCurve' ||
          src.kind === 'graphDot' ||
          src.kind === 'graphField' ||
          src.kind === 'graphFunctionSeries' ||
          src.kind === 'graphPointSequence' ||
          src.kind === 'graphArea' ||
          src.kind === 'shape'
        ) {
          const clone = structuredClone(src) as SceneItem;
          clone.id = crypto.randomUUID().slice(0, 12);
          clone.label = (src.label || '') + ' (copy)';
          clone.startTime = src.startTime + src.duration;
          stripExclusiveAudioClone(clone);
          set((s) => {
            s.items.set(clone.id, clone);
            if (clone.kind === 'graphFunctionSeries') {
              syncFunctionSeriesDerived(clone, s.items);
            }
            if (clone.kind === 'graphPointSequence') {
              syncPointSequenceDerived(clone, s.items);
            }
          });
          return;
        }
        if (src.kind === 'exit_animation') {
          const clone = structuredClone(src) as typeof src;
          clone.id = crypto.randomUUID().slice(0, 12);
          clone.label = (src.label || '') + ' (copy)';
          clone.startTime = src.startTime + src.duration;
          stripExclusiveAudioClone(clone);
          set((s) => { s.items.set(clone.id, clone); });
          return;
        }
        if (src.kind === 'blink_animation') {
          const clone = structuredClone(src) as typeof src;
          clone.id = crypto.randomUUID().slice(0, 12);
          clone.label = (src.label || '') + ' (copy)';
          clone.startTime = src.startTime + src.duration;
          stripExclusiveAudioClone(clone);
          set((s) => { s.items.set(clone.id, clone); });
          return;
        }
        if (src.kind === 'target_animation') {
          const clone = structuredClone(src) as typeof src;
          clone.id = crypto.randomUUID().slice(0, 12);
          clone.label = (src.label || '') + ' (copy)';
          clone.startTime = src.startTime + src.duration;
          stripExclusiveAudioClone(clone);
          set((s) => { s.items.set(clone.id, clone); });
          return;
        }
        if (src.kind === 'camera_move') {
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
          stripExclusiveAudioClone(clone);
          set((s) => { s.items.set(clone.id, clone); });
          return;
        }
        const clone = structuredClone(src) as SceneItem;
        clone.id = crypto.randomUUID().slice(0, 12);
        clone.label = src.label + ' (copy)';
        if (clone.kind === 'textLine' || clone.kind === 'axes' || clone.kind === 'shape') {
          clone.startTime = src.startTime + src.duration;
        }
        if (clone.kind === 'axes') {
          const ax = clone as AxesItem;
          ax.axisPreviewDataUrl = null;
          ax.axisPreviewError = null;
          ax.axisPreviewHash = null;
          ax.axisPreviewBounds = null;
        }
        stripExclusiveAudioClone(clone);
        set((s) => { s.items.set(clone.id, clone); });
      },

      // ── Timeline mutations ──
      moveItem: (id, newStartTime) => set((s) => {
        const item = s.items.get(id);
        if (!item) return;
        let t = Math.max(0, newStartTime);
        if (
          item.kind === 'exit_animation' ||
          item.kind === 'blink_animation' ||
          item.kind === 'target_animation' ||
          item.kind === 'camera_move'
        ) {
          const minT =
            item.kind === 'exit_animation'
              ? minExitStartTimeForClip(item, s.items)
              : item.kind === 'blink_animation'
                ? minBlinkStartTimeForClip(item, s.items)
                : item.kind === 'target_animation'
                  ? minTargetAnimationStartTimeForClip(item, s.items)
                  : 0;
          if (minT != null) t = Math.max(t, minT);
        }
        item.startTime = t;
        syncAllExplicitAudioBindingsInDraft(s.items, s.audioItems);
      }),
      moveAudioItem: (id, newStartTime) => set((s) => {
        if (explicitVisualOwnerForAudioTrack(s.items, id)) return;
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
        clampEffectClipStarts(s.items);
        syncAllExplicitAudioBindingsInDraft(s.items, s.audioItems);
      }),

      setSceneItemStartTimes: (updates) => set((s) => {
        for (const { id, startTime } of updates) {
          const item = s.items.get(id);
          if (!item || !isTopLevelItem(item)) continue;
          item.startTime = Math.max(0, startTime);
        }
        clampEffectClipStarts(s.items);
        syncAllExplicitAudioBindingsInDraft(s.items, s.audioItems);
      }),

      setAudioItemStartTimes: (updates) => set((s) => {
        for (const { id, startTime } of updates) {
          if (explicitVisualOwnerForAudioTrack(s.items, id)) continue;
          const track = s.audioItems.find((a) => a.id === id);
          if (track) track.startTime = Math.max(0, startTime);
        }
        syncAllExplicitAudioBindingsInDraft(s.items, s.audioItems);
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
        if (item.kind === 'graphPointSequence') {
          return;
        }
        if (
          item.kind === 'exit_animation' ||
          item.kind === 'blink_animation' ||
          item.kind === 'target_animation' ||
          item.kind === 'camera_move'
        ) {
          item.duration = Math.max(0.05, newDuration);
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
        if (
          item?.kind === 'exit_animation' ||
          item?.kind === 'blink_animation' ||
          item?.kind === 'target_animation' ||
          item?.kind === 'camera_move' ||
          item?.kind === 'surroundingRect'
        ) {
          return;
        }
        if (item) { item.x = x; item.y = y; }
      }),
      setItemScale: (id, scale) => set((s) => {
        const item = s.items.get(id);
        if (
          item?.kind === 'exit_animation' ||
          item?.kind === 'blink_animation' ||
          item?.kind === 'target_animation' ||
          item?.kind === 'camera_move' ||
          item?.kind === 'surroundingRect'
        ) {
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
          tl.mathChildMeasures = result?.mathChildMeasures ?? null;
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
        frames: get().frames.map((f) => ({ ...f })),
        startFrameId: get().startFrameId,
        items: Array.from(get().items.values()),
        measureConfig: { ...get().measureConfig },
        audioItems:
          get().audioItems.length > 0
            ? get().audioItems.map((a) => ({ ...a }))
            : undefined,
      }),

      toSceneDiskPayload: () => ({
        defaults: { ...get().defaults },
        frames: get().frames.map((f) => ({ ...f })),
        startFrameId: get().startFrameId,
        items: Array.from(get().items.values()),
        audioItems:
          get().audioItems.length > 0
            ? get().audioItems.map((a) => ({ ...a }))
            : undefined,
      }),

      loadProjectFile: (file) => {
        useSceneStore.temporal.getState().pause();
        try {
          set((s) => {
            runLoadSceneDraft(
              s,
              {
                defaults: file.defaults,
                frames: file.frames,
                startFrameId: file.startFrameId,
                items: file.items as SceneItem[],
                audioItems: file.audioItems,
              },
              file.version ?? 0,
            );
            s.measureConfig = { ...s.measureConfig, ...file.measureConfig };
          });
        } finally {
          useSceneStore.temporal.getState().resume();
          useSceneStore.temporal.setState({
            pastStates: [],
            futureStates: [],
          });
        }
      },

      loadSceneDocument: (payload, fileVersion) => {
        useSceneStore.temporal.getState().pause();
        try {
          set((s) => {
            runLoadSceneDraft(s, payload, fileVersion);
          });
        } finally {
          useSceneStore.temporal.getState().resume();
          useSceneStore.temporal.setState({
            pastStates: [],
            futureStates: [],
          });
        }
      },

      clearUndoHistory: () => {
        useSceneStore.temporal.setState({ pastStates: [], futureStates: [] });
      },

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
          normalizeItemFrameIdsInPlace(
            migrated,
            s.frames,
            s.activeFrameId ?? s.startFrameId,
          );

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
            if (it.kind === 'graphPointSequence') {
              syncPointSequenceDerived(it, s.items);
            }
          }
          clampEffectClipStarts(s.items);

          s.selectedIds = new Set(migrated.map((it) => it.id));
          s.inspectedId = migrated[0]?.id ?? null;
          s.polylinePointCaptureId = null;
          s.targetAnimationPathCapture = null;
          syncAllExplicitAudioBindingsInDraft(s.items, s.audioItems);
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

      normalizeAudioTrack: async (id, options) => {
        const baseUrl = get().measureConfig.url;
        const track = get().audioItems.find((a) => a.id === id);
        if (!track) return;

        const prevRel = track.assetRelPath?.trim();
        const serverRel = measureServerRelativeAudioPath(track);
        const oldAudioUrl = track.audioUrl;

        let result;
        if (serverRel) {
          result = await normalizeAudio(baseUrl, {
            sourcePath: serverRel,
            targetLufs: options?.targetLufs,
            truePeak: options?.truePeak,
            lra: options?.lra,
          });
        } else {
          const resp = await fetch(track.audioUrl);
          if (!resp.ok) {
            throw new Error(`Could not read audio for normalization (HTTP ${resp.status})`);
          }
          const blob = await resp.blob();
          const filename =
            deriveAudioAssetRelPath(track).split('/').pop() || 'audio.webm';
          result = await normalizeAudio(baseUrl, {
            file: blob,
            filename,
            targetLufs: options?.targetLufs,
            truePeak: options?.truePeak,
            lra: options?.lra,
          });
        }

        const root = baseUrl.replace(/\/$/, '');
        const fp = result.file_path;
        const newAudioUrl = `${root}${fp.startsWith('/') ? '' : '/'}${fp}`;

        const targetLufs = options?.targetLufs ?? -16;

        set((s) => {
          const t = s.audioItems.find((a) => a.id === id);
          if (!t) return;
          if (typeof oldAudioUrl === 'string' && oldAudioUrl.startsWith('blob:')) {
            try {
              URL.revokeObjectURL(oldAudioUrl);
            } catch {
              /* ignore */
            }
          }
          t.audioUrl = newAudioUrl;
          t.assetRelPath = fp;
          t.duration = Math.max(0.01, result.duration);
          t.audioProcessing = {
            ...t.audioProcessing,
            normalized: {
              targetLufs,
              sourceAssetRelPath: prevRel ?? serverRel ?? undefined,
              measuredInputLufs: result.measured_input_lufs ?? undefined,
              measuredOutputLufs: result.measured_output_lufs ?? undefined,
              processedAt: new Date().toISOString(),
            },
          };
        });
      },

      placeAudioAfterPrevious: (id, gapSec) =>
        set((s) => {
          if (explicitVisualOwnerForAudioTrack(s.items, id)) return;
          const nextStart = computeStartAfterPrevious(s.audioItems, id, gapSec);
          if (nextStart == null) return;
          const t = s.audioItems.find((a) => a.id === id);
          if (!t) return;
          t.startTime = nextStart;
        }),

      spaceSelectedAudioItems: (gapSec) =>
        set((s) => {
          const ids = s.selectedIds;
          const unlinked: AudioTrackItem[] = [];
          for (const a of s.audioItems) {
            if (!ids.has(a.id)) continue;
            if (explicitVisualOwnerForAudioTrack(s.items, a.id)) continue;
            unlinked.push(a);
          }
          if (unlinked.length < 2) return;
          unlinked.sort(
            (x, y) =>
              x.startTime - y.startTime || x.id.localeCompare(y.id),
          );
          const updates = computeChainedStartsForSortedUnlinked(unlinked, gapSec);
          for (const u of updates) {
            const t = s.audioItems.find((a) => a.id === u.id);
            if (!t) continue;
            if (explicitVisualOwnerForAudioTrack(s.items, t.id)) continue;
            t.startTime = u.startTime;
          }
        }),
    })),
    { limit: 50 },
  ),
);
if (typeof window !== 'undefined') {
  (window as any).useSceneStore = useSceneStore;
}