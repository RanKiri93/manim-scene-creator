import { useAddSceneItems } from '@/hooks/useAddSceneItems';
import { useSceneStore } from '@/store/useSceneStore';
import {
  canBeBlinkTarget,
  canBeExitTarget,
  canBeSurroundTarget,
  canBeTargetAnimationTarget,
} from '@/lib/time';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { resolveGraphFollowSelection } from '@/lib/graphMotion';
import type { SceneItem, TargetAnimationMode } from '@/types/scene';
import type { InsertActionDef, InsertActionId, InsertGroupId } from './insertActions';

export type InsertActionState = {
  title: string;
  /** The current selection can use this action. */
  active?: boolean;
  dimmed?: boolean;
  disabled?: boolean;
};

const TARGET_ANIMATION_MODES: readonly TargetAnimationMode[] = [
  'scale',
  'color',
  'move',
  'path',
  'rotate',
  'graphFollow',
];

export function truncLabel(s: string, max: number): string {
  const t = s.trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * What each insert action does and whether the current selection can take it. Shared by the
 * Insert rail, the selection animate bar on the canvas, and insert search, so all three agree.
 */
export function useInsertActionState() {
  const actions = useAddSceneItems();
  const itemsMap = useSceneStore((s) => s.items);
  const selectedIds = useSceneStore((s) => s.selectedIds);

  const selectedItems: SceneItem[] = [];
  for (const id of selectedIds) {
    const it = itemsMap.get(id);
    if (it) selectedItems.push(it);
  }
  const hasSelection = selectedItems.length > 0;
  const hasCameraFitTarget = selectedItems.length === 1 && ['axes', 'shape', 'image', 'textLine'].includes(selectedItems[0]!.kind);
  const hasExitTarget = selectedItems.some((it) => canBeExitTarget(it));
  const hasBlinkTarget = selectedItems.some((it) => canBeBlinkTarget(it));
  const hasSurroundTarget = selectedItems.some((it) => canBeSurroundTarget(it));
  const compatibleModes = new Set<TargetAnimationMode>();
  for (const mode of TARGET_ANIMATION_MODES) {
    if (selectedItems.some((it) => canBeTargetAnimationTarget(it, mode))) {
      compatibleModes.add(mode);
    }
  }
  const hasAnyAnimationTarget =
    hasExitTarget || hasBlinkTarget || hasSurroundTarget || compatibleModes.size > 0;
  const animationHint = !hasSelection
    ? 'Nothing selected: the first eligible object is used.'
    : !hasAnyAnimationTarget
      ? 'The selection cannot take these; the first eligible object is used.'
      : selectedItems.length === 1
        ? `Uses ${truncLabel(itemClipDisplayName(selectedItems[0]!), 24)}.`
        : 'Uses your selection.';
  const graphFollowSelection = resolveGraphFollowSelection(itemsMap, selectedIds);
  const canFollowGraph = graphFollowSelection.error == null;

  const axesItems = [...itemsMap.values()].filter((i) => i.kind === 'axes');
  const selectedAxes = selectedItems.find((i) => i.kind === 'axes');
  const graphHelper =
    selectedAxes != null
      ? `Uses selected axes (${truncLabel(itemClipDisplayName(selectedAxes), 22)}).`
      : axesItems.length === 1
        ? 'Uses existing axes.'
        : axesItems.length > 1
          ? 'Uses the earliest axes. Select axes to choose.'
          : 'Will create axes automatically.';

  const groupHints: Partial<Record<InsertGroupId, string>> = {
    graph: graphHelper,
    animate: animationHint,
    camera: 'Moves the view, not the objects.',
  };

  const run: Record<InsertActionId, () => void> = {
    textLine: actions.addTextLine,
    shape: actions.addShape,
    image: actions.addImageViaPicker,
    axes: actions.addAxes,
    graphPlot: actions.addGraphPlot,
    graphCurve: actions.addGraphCurve,
    graphDot: actions.addGraphDot,
    graphArea: actions.addGraphArea,
    graphField: actions.addGraphField,
    graphFunctionSeries: actions.addGraphFunctionSeries,
    graphPointSequence: actions.addGraphPointSequence,
    move: () => actions.addTargetAnimationClip('move'),
    path: () => actions.addTargetAnimationClip('path'),
    graphFollow: () => actions.addTargetAnimationClip('graphFollow'),
    scale: () => actions.addTargetAnimationClip('scale'),
    rotate: () => actions.addTargetAnimationClip('rotate'),
    color: () => actions.addTargetAnimationClip('color'),
    blink: actions.addBlinkAnimationClip,
    surroundingRect: actions.addSurroundingRectClip,
    exit: actions.addExitAnimationClip,
    cameraPan: actions.addCameraMoveClip,
    zoomRegion: actions.beginCameraRegionSelection,
    fitObject: actions.fitSelectedCameraObject,
    fullFrame: actions.addCameraFrameReturn,
    recordAudio: actions.openAudioRecording,
    uploadAudio: actions.openAudioUpload,
    textToSpeech: actions.openAudioTts,
  };

  const fitsSelection = (can: boolean) => ({ active: can, dimmed: hasSelection && !can });

  const stateFor = (def: InsertActionDef): InsertActionState => {
    switch (def.id) {
      case 'graphPlot':
      case 'graphCurve':
      case 'graphDot':
      case 'graphArea':
      case 'graphField':
      case 'graphFunctionSeries':
      case 'graphPointSequence':
        return { title: `${def.title}. ${graphHelper}` };
      case 'graphFollow':
        return {
          title: graphFollowSelection.error ?? def.title,
          active: canFollowGraph,
          dimmed: !canFollowGraph,
          disabled: !canFollowGraph,
        };
      case 'move':
      case 'path':
      case 'scale':
      case 'rotate':
      case 'color':
        return { title: def.title, ...fitsSelection(compatibleModes.has(def.id)) };
      case 'blink':
        return { title: def.title, ...fitsSelection(hasBlinkTarget) };
      case 'surroundingRect':
        return { title: def.title, ...fitsSelection(hasSurroundTarget) };
      case 'exit':
        return { title: def.title, ...fitsSelection(hasExitTarget) };
      case 'fitObject':
        return { title: def.title, ...fitsSelection(hasCameraFitTarget) };
      default:
        return { title: def.title };
    }
  };

  return { run, stateFor, groupHints, hasAnyAnimationTarget, selectedItems };
}
