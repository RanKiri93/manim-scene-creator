import { useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import {
  createTargetAnimation,
  createTextLine,
  createAxes,
  createGraphPlot,
  createGraphCurve,
  createGraphDotItem,
  createGraphFieldItem,
  createGraphFunctionSeries,
  createGraphPointSequence,
  createGraphArea,
  createExitAnimation,
  createBlinkAnimation,
  createSurroundingRect,
  createShape,
} from '@/store/factories';
import type { ItemId, SceneItem, TargetAnimationMode } from '@/types/scene';
import {
  canBeExitTarget,
  canBeBlinkTarget,
  canBeSurroundTarget,
  holdEnd,
  effectiveStart,
  canBeTargetAnimationTarget,
} from '@/lib/time';

function pickDefaultAxesId(
  itemsMap: Map<ItemId, SceneItem>,
  selectedIds: Set<ItemId>,
): string | null {
  for (const id of selectedIds) {
    const it = itemsMap.get(id);
    if (it?.kind === 'axes') return id;
  }
  const axes = [...itemsMap.values()].filter((i) => i.kind === 'axes');
  if (axes.length === 0) return null;
  if (axes.length === 1) return axes[0]!.id;
  return [...axes].sort((a, b) => a.startTime - b.startTime)[0]!.id;
}

export function useAddSceneItems() {
  const itemsMap = useSceneStore((s) => s.items);
  const currentTime = useSceneStore((s) => s.currentTime);
  const selectedIds = useSceneStore((s) => s.selectedIds);
  const select = useSceneStore((s) => s.select);
  const removeItem = useSceneStore((s) => s.removeItem);
  const addItem = useSceneStore((s) => s.addItem);
  const defaults = useSceneStore((s) => s.defaults);
  const setAudioMode = useSceneStore((s) => s.setAudioMode);

  const ensureAxesId = useCallback((): string => {
    let axId = pickDefaultAxesId(itemsMap, selectedIds);
    if (!axId) {
      const ax = createAxes(defaults, currentTime);
      addItem(ax);
      axId = ax.id;
    }
    return axId;
  }, [itemsMap, selectedIds, defaults, currentTime, addItem]);

  const addTextLine = useCallback(() => {
    const item = createTextLine(defaults, currentTime);
    addItem(item);
    select(item.id);
  }, [defaults, currentTime, addItem, select]);

  const addAxes = useCallback(() => {
    const item = createAxes(defaults, currentTime);
    addItem(item);
    select(item.id);
  }, [defaults, currentTime, addItem, select]);

  const addShape = useCallback(() => {
    const item = createShape(currentTime);
    addItem(item);
    select(item.id);
  }, [currentTime, addItem, select]);

  const addGraphPlot = useCallback(() => {
    const axId = ensureAxesId();
    const item = createGraphPlot(axId, currentTime);
    addItem(item);
    select(item.id);
  }, [ensureAxesId, currentTime, addItem, select]);

  const addGraphCurve = useCallback(() => {
    const axId = ensureAxesId();
    const item = createGraphCurve(axId, currentTime);
    addItem(item);
    select(item.id);
  }, [ensureAxesId, currentTime, addItem, select]);

  const addGraphDot = useCallback(() => {
    const axId = ensureAxesId();
    const item = createGraphDotItem(axId, currentTime);
    addItem(item);
    select(item.id);
  }, [ensureAxesId, currentTime, addItem, select]);

  const addGraphField = useCallback(() => {
    const axId = ensureAxesId();
    const item = createGraphFieldItem(axId, currentTime);
    addItem(item);
    select(item.id);
  }, [ensureAxesId, currentTime, addItem, select]);

  const addGraphFunctionSeries = useCallback(() => {
    const axId = ensureAxesId();
    const item = createGraphFunctionSeries(axId, currentTime);
    addItem(item);
    select(item.id);
  }, [ensureAxesId, currentTime, addItem, select]);

  const addGraphPointSequence = useCallback(() => {
    const axId = ensureAxesId();
    const item = createGraphPointSequence(axId, currentTime);
    addItem(item);
    select(item.id);
  }, [ensureAxesId, currentTime, addItem, select]);

  const addGraphArea = useCallback(() => {
    const axId = ensureAxesId();
    const item = createGraphArea(axId, currentTime);
    addItem(item);
    select(item.id);
  }, [ensureAxesId, currentTime, addItem, select]);

  const addExitAnimationClip = useCallback(() => {
    const map = useSceneStore.getState().items;
    const selectedTargets = [...selectedIds]
      .map((id) => map.get(id))
      .filter((it): it is SceneItem => !!it && canBeExitTarget(it));
    const seen = new Set<ItemId>();
    const targetIds: ItemId[] = [];
    for (const it of selectedTargets) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      targetIds.push(it.id);
    }
    if (targetIds.length === 0) {
      const candidates = [...map.values()].filter(canBeExitTarget);
      if (candidates.length === 0) return;
      candidates.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
      targetIds.push(candidates[0]!.id);
    }
    const holdEnds = targetIds.map((id) => {
      const t = map.get(id);
      return t && canBeExitTarget(t) ? holdEnd(t, map) : 0;
    });
    const start = Math.max(currentTime, ...holdEnds);
    const toRemove = [...map.entries()]
      .filter(
        ([, it]) =>
          it.kind === 'exit_animation' &&
          it.targets.some((row) => targetIds.includes(row.targetId)),
      )
      .map(([id]) => id);
    for (const id of toRemove) {
      removeItem(id);
    }
    const ex = createExitAnimation(targetIds, start, 1);
    addItem(ex);
    select(ex.id);
  }, [selectedIds, currentTime, removeItem, addItem, select]);

  const addBlinkAnimationClip = useCallback(() => {
    const map = useSceneStore.getState().items;
    const selectedTargets = [...selectedIds]
      .map((id) => map.get(id))
      .filter((it): it is SceneItem => !!it && canBeBlinkTarget(it));
    const seen = new Set<ItemId>();
    const targetIds: ItemId[] = [];
    for (const it of selectedTargets) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      targetIds.push(it.id);
    }
    if (targetIds.length === 0) {
      const candidates = [...map.values()].filter(canBeBlinkTarget);
      if (candidates.length === 0) return;
      candidates.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
      targetIds.push(candidates[0]!.id);
    }
    const starts = targetIds.map((id) => {
      const t = map.get(id);
      return t && canBeBlinkTarget(t) ? effectiveStart(t, map) : 0;
    });
    const start = Math.max(currentTime, ...starts);
    const blink = createBlinkAnimation(targetIds, start, 0.6);
    addItem(blink);
    select(blink.id);
  }, [selectedIds, currentTime, addItem, select]);

  const addTargetAnimationClip = useCallback(
    (mode: TargetAnimationMode) => {
      const map = useSceneStore.getState().items;
      const selectedTargets = [...selectedIds]
        .map((id) => map.get(id))
        .filter(
          (it): it is SceneItem =>
            !!it && canBeTargetAnimationTarget(it, mode),
        );
      const seen = new Set<ItemId>();
      const targetIds: ItemId[] = [];
      for (const it of selectedTargets) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        targetIds.push(it.id);
      }
      if (targetIds.length === 0) {
        const candidates = [...map.values()].filter((it) =>
          canBeTargetAnimationTarget(it, mode),
        );
        if (candidates.length === 0) return;
        candidates.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
        targetIds.push(candidates[0]!.id);
      }
      const starts = targetIds.map((id) => {
        const t = map.get(id);
        return t && canBeTargetAnimationTarget(t, mode)
          ? effectiveStart(t, map)
          : 0;
      });
      const start = Math.max(currentTime, ...starts);
      const clip = createTargetAnimation(mode, targetIds, start, 1);
      addItem(clip);
      select(clip.id);
    },
    [selectedIds, currentTime, addItem, select],
  );

  const addSurroundingRectClip = useCallback(() => {
    const map = useSceneStore.getState().items;
    const selectedTargets = [...selectedIds]
      .map((id) => map.get(id))
      .filter((it): it is SceneItem => !!it && canBeSurroundTarget(it));
    const seen = new Set<ItemId>();
    const surroundTargetIds: ItemId[] = [];
    for (const it of selectedTargets) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      surroundTargetIds.push(it.id);
    }
    if (surroundTargetIds.length === 0) {
      const candidates = [...map.values()].filter(canBeSurroundTarget);
      if (candidates.length === 0) return;
      candidates.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
      surroundTargetIds.push(candidates[0]!.id);
    }
    const starts = surroundTargetIds.map((id) => {
      const t = map.get(id);
      return t && canBeSurroundTarget(t) ? effectiveStart(t, map) : 0;
    });
    const start = Math.max(currentTime, ...starts);
    const item = createSurroundingRect(surroundTargetIds, start);
    addItem(item);
    select(item.id);
  }, [selectedIds, currentTime, addItem, select]);

  const openAudioRecording = useCallback(() => {
    setAudioMode('record');
  }, [setAudioMode]);

  const openAudioUpload = useCallback(() => {
    setAudioMode('upload');
  }, [setAudioMode]);

  const openAudioTts = useCallback(() => {
    setAudioMode('tts');
  }, [setAudioMode]);

  return {
    addTextLine,
    addAxes,
    addShape,
    addGraphPlot,
    addGraphCurve,
    addGraphDot,
    addGraphField,
    addGraphFunctionSeries,
    addGraphPointSequence,
    addGraphArea,
    addExitAnimationClip,
    addBlinkAnimationClip,
    addTargetAnimationClip,
    addSurroundingRectClip,
    openAudioRecording,
    openAudioUpload,
    openAudioTts,
  };
}
