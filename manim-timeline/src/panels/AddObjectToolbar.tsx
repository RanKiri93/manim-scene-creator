import type { ReactNode } from 'react';
import { useAddSceneItems } from '@/hooks/useAddSceneItems';
import { useSceneStore } from '@/store/useSceneStore';
import {
  canBeBlinkTarget,
  canBeExitTarget,
  canBeTargetAnimationTarget,
} from '@/lib/time';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import type { SceneItem, TargetAnimationMode } from '@/types/scene';

function truncLabel(s: string, max: number): string {
  const t = s.trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

const TARGET_ANIMATION_MODES: readonly TargetAnimationMode[] = [
  'scale',
  'color',
  'move',
  'path',
  'rotate',
];

function ToolButton({
  title,
  onClick,
  children,
  label,
  collapsed,
  active,
  dimmed,
  'aria-label': ariaLabel,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  label?: string;
  collapsed: boolean;
  active?: boolean;
  dimmed?: boolean;
  'aria-label'?: string;
}) {
  const emphasize = active
    ? 'border-blue-400/80 bg-blue-500/15 text-blue-100'
    : 'bg-slate-800/80 border-slate-600/80 text-slate-200';
  const fade = dimmed && !active ? 'opacity-50' : '';
  if (collapsed) {
    return (
      <button
        type="button"
        title={title}
        aria-label={ariaLabel ?? title}
        onClick={onClick}
        className={`flex items-center justify-center w-9 h-9 rounded-md border hover:bg-slate-700 hover:border-slate-500 transition-colors shrink-0 ${emphasize} ${fade}`}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel ?? title}
      onClick={onClick}
      className={`flex items-center gap-2 w-full px-2 h-9 rounded-md border text-xs hover:bg-slate-700 hover:border-slate-500 transition-colors ${emphasize} ${fade}`}
    >
      <span className="shrink-0 flex items-center justify-center">{children}</span>
      {label != null && (
        <span className="flex-1 min-w-0 truncate text-left">{label}</span>
      )}
    </button>
  );
}

function CategoryLabel({
  children,
  collapsed,
}: {
  children: ReactNode;
  collapsed: boolean;
}) {
  return (
    <div
      className={`text-[10px] font-semibold uppercase tracking-wide text-slate-500 px-1 mt-3 first:mt-0 mb-1 w-full ${
        collapsed ? 'text-center px-0.5' : 'text-left'
      }`}
    >
      {children}
    </div>
  );
}

function InsertSidebarHeader({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <div
      className={`flex items-center shrink-0 pt-1 pb-1 ${
        collapsed ? 'justify-center px-0' : 'justify-between px-2'
      }`}
    >
      {!collapsed && (
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Insert
        </span>
      )}
      <button
        type="button"
        onClick={onToggleCollapsed}
        title={
          collapsed
            ? 'Expand insert sidebar (show labels)'
            : 'Collapse insert sidebar (icons only)'
        }
        aria-label={collapsed ? 'Expand insert sidebar' : 'Collapse insert sidebar'}
        aria-expanded={!collapsed}
        className="flex items-center justify-center w-7 h-7 rounded-md bg-slate-800/80 border border-slate-600/80 text-slate-300 hover:bg-slate-700 hover:border-slate-500 transition-colors shrink-0 text-xs"
      >
        <span aria-hidden>{collapsed ? '»' : '«'}</span>
      </button>
    </div>
  );
}

/** Icons: simple 20×20 inline SVGs for the add toolbar */
function IconTextLine() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M5 5h10M5 9h8M5 13h10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconAxes() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M4 16V4M4 16h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4 16l3-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M8 16l2-6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M12 15l2-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconShape() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="5" y="5" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function IconImage() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="7" cy="8" r="1.3" fill="currentColor" />
      <path d="M4 13.5l3.2-3.2 2.4 2.4 2-2 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconGraphPlot() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M4 16V4M4 16h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M5 14c2-4 4-2 6-6 2.2 1.2 3-3 5-1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function IconGraphCurve() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M4 16V4M4 16h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M5 12c2-6 5-8 8-2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function IconGraphDot() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M4 16V4M4 16h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="11" cy="9" r="2.2" fill="currentColor" />
    </svg>
  );
}

function IconVectorField() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M4 16V4M4 16h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M7 8l2 1M11 7l2 1M9 12l2 1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconFunctionSeries() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M4 16V4M4 16h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M7 13c0-4 2.5-7 5-5M9 7l-1.2 2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
      <text x="11" y="8" fontSize="6" fill="currentColor" fontFamily="system-ui">
        Σ
      </text>
    </svg>
  );
}

function IconPointSequence() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M4 16V4M4 16h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="7" cy="11" r="1.4" fill="currentColor" />
      <circle cx="10" cy="8" r="1.4" fill="currentColor" />
      <circle cx="13" cy="10" r="1.4" fill="currentColor" />
    </svg>
  );
}

function IconGraphArea() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M4 16V4M4 16h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M5 14 V10c1.5 2 3.5 1 5 3 1.5-1 3 0 4-1v5H5z"
        fill="currentColor"
        fillOpacity="0.35"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSurroundingRect() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="4" y="5" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="6" y="7" width="8" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.5" />
    </svg>
  );
}

function IconExitAnimation() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="5" y="6" width="10" height="8" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M13 4l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 7h6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconBlinkAnimation() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 3v2M10 15v2M17 10h-2M5 10H3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconTaScale() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="5" y="5" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 7V3h4M17 13v4h-4M7 3h4M13 17H9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconTaColor() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="8" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M11 6l4-2v8l-4-2" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function IconTaMove() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M10 4L7 7M10 4l3 3M10 16l-3-3m3 3l3-3M4 10l3-3M4 10l3 3M16 10l-3-3m3 3l-3 3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function IconTaPath() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M4 14L8 6l4 4 4-6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="4" cy="14" r="1.6" fill="currentColor" />
      <circle cx="16" cy="8" r="1.6" fill="currentColor" />
    </svg>
  );
}

function IconTaRotate() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M5 12a6 6 0 119-4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M14 5v3h-3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function IconCameraMove() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="4" y="5" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10 3v3M10 14v3M3 10h3M14 10h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M13 7l2-2M7 13l-2 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function IconMic() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M8 4a2 2 0 012 2v4a2 2 0 11-4 0V6a2 2 0 012-2z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M6 12v1a4 4 0 008 0v-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M10 15v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconUploadAudio() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M5 14h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M10 6v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M7 9l3-3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconTts() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M6 7h3v5H6l-2 2V5l2 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
      <path d="M11 8c1 1 2 3 0 4M13 6c2 2 3 6 0 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export default function AddObjectToolbar({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
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
  const compatibleModes = new Set<TargetAnimationMode>();
  for (const mode of TARGET_ANIMATION_MODES) {
    if (selectedItems.some((it) => canBeTargetAnimationTarget(it, mode))) {
      compatibleModes.add(mode);
    }
  }
  const hasAnyAnimationTarget =
    hasExitTarget || hasBlinkTarget || compatibleModes.size > 0;
  const animationTitle = !hasAnyAnimationTarget
    ? 'Animations'
    : selectedItems.length === 1
      ? `Animations · ${truncLabel(itemClipDisplayName(selectedItems[0]!), 20)}`
      : 'Animations · for selection';
  const animationHint = !hasSelection
    ? 'No selection — uses first eligible.'
    : hasAnyAnimationTarget
      ? 'Uses your selection.'
      : 'Selection is not animatable — uses first eligible.';

  const axesItems = [...itemsMap.values()].filter((i) => i.kind === 'axes');
  const selectedAxes = selectedItems.find((i) => i.kind === 'axes');
  const graphHelper =
    selectedAxes != null
      ? `Uses selected axes (${truncLabel(itemClipDisplayName(selectedAxes), 22)}).`
      : axesItems.length === 1
        ? 'Uses existing axes.'
        : axesItems.length > 1
          ? 'Uses earliest axes — select axes to choose.'
          : 'Will create axes automatically.';

  const groupClass = collapsed
    ? 'flex flex-wrap gap-1 justify-center'
    : 'flex flex-col gap-1';

  return (
    <div
      className="min-h-0 flex-1 w-full flex flex-col py-2 px-2 overflow-y-auto overflow-x-hidden"
      role="toolbar"
      aria-label="Insert objects and animations"
    >
      <InsertSidebarHeader
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />

      <CategoryLabel collapsed={collapsed}>Objects</CategoryLabel>
      <div className={groupClass}>
        <ToolButton
          collapsed={collapsed}
          label="Text line"
          title="Text line"
          onClick={actions.addTextLine}
        >
          <IconTextLine />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Axes"
          title="Axes"
          onClick={actions.addAxes}
        >
          <IconAxes />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Shape"
          title="Shape (circle, rectangle, arrow, line)"
          onClick={actions.addShape}
        >
          <IconShape />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Image"
          title="Image (PNG, JPG, GIF as still picture)"
          onClick={actions.addImageViaPicker}
        >
          <IconImage />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Surrounding rect"
          title="Surrounding rectangle (select targets or uses first eligible)"
          onClick={actions.addSurroundingRectClip}
        >
          <IconSurroundingRect />
        </ToolButton>
      </div>

      <CategoryLabel collapsed={collapsed}>Graph (uses axes)</CategoryLabel>
      <div className={groupClass}>
        <ToolButton
          collapsed={collapsed}
          label="Plot"
          title={`Graph plot (function y = f(x)) — ${graphHelper}`}
          onClick={actions.addGraphPlot}
        >
          <IconGraphPlot />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Curve"
          title={`Graph curve (parametric x(t), y(t)) — ${graphHelper}`}
          onClick={actions.addGraphCurve}
        >
          <IconGraphCurve />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Dot"
          title={`Graph dot — ${graphHelper}`}
          onClick={actions.addGraphDot}
        >
          <IconGraphDot />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Area"
          title={`Graph area (fill under/between) — ${graphHelper}`}
          onClick={actions.addGraphArea}
        >
          <IconGraphArea />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Vector field"
          title={`Vector / slope field — ${graphHelper}`}
          onClick={actions.addGraphField}
        >
          <IconVectorField />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Function series"
          title={`Function series (partial sums or family f(n,x)) — ${graphHelper}`}
          onClick={actions.addGraphFunctionSeries}
        >
          <IconFunctionSeries />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Point sequence"
          title={`Point sequence (x(n), y(n)) — ${graphHelper}`}
          onClick={actions.addGraphPointSequence}
        >
          <IconPointSequence />
        </ToolButton>
      </div>
      {!collapsed && (
        <p className="px-1 mt-1 text-[10px] leading-snug text-slate-500 text-left">
          {graphHelper}
        </p>
      )}

      <div
        className={
          hasAnyAnimationTarget && !collapsed
            ? 'mt-2 rounded-lg border border-blue-500/40 bg-blue-500/5 px-2 pt-1 pb-2'
            : undefined
        }
      >
        <CategoryLabel collapsed={collapsed}>
          <span className={hasAnyAnimationTarget ? 'text-blue-300' : undefined}>
            {animationTitle}
          </span>
        </CategoryLabel>
        <div className={groupClass}>
          <ToolButton
            collapsed={collapsed}
            label="Exit"
            title="Exit animation (multi-select targets; replaces prior exits on those targets)"
            onClick={actions.addExitAnimationClip}
            active={hasExitTarget}
            dimmed={hasSelection && !hasExitTarget}
          >
            <IconExitAnimation />
          </ToolButton>
          <ToolButton
            collapsed={collapsed}
            label="Blink"
            title="Blink animation (pulse scale/color; does not remove targets)"
            onClick={actions.addBlinkAnimationClip}
            active={hasBlinkTarget}
            dimmed={hasSelection && !hasBlinkTarget}
          >
            <IconBlinkAnimation />
          </ToolButton>
          <ToolButton
            collapsed={collapsed}
            label="Scale"
            title="Target: persistent scale — select compatible objects or picks first eligible"
            onClick={() => actions.addTargetAnimationClip('scale')}
            active={compatibleModes.has('scale')}
            dimmed={hasSelection && !compatibleModes.has('scale')}
          >
            <IconTaScale />
          </ToolButton>
          <ToolButton
            collapsed={collapsed}
            label="Color"
            title="Target: persistent color — same eligible set as blink"
            onClick={() => actions.addTargetAnimationClip('color')}
            active={compatibleModes.has('color')}
            dimmed={hasSelection && !compatibleModes.has('color')}
          >
            <IconTaColor />
          </ToolButton>
          <ToolButton
            collapsed={collapsed}
            label="Move"
            title="Target: persistent move shift (dx/dy)"
            onClick={() => actions.addTargetAnimationClip('move')}
            active={compatibleModes.has('move')}
            dimmed={hasSelection && !compatibleModes.has('move')}
          >
            <IconTaMove />
          </ToolButton>
          <ToolButton
            collapsed={collapsed}
            label="Path"
            title="Target: persistent move along path (relative offsets)"
            onClick={() => actions.addTargetAnimationClip('path')}
            active={compatibleModes.has('path')}
            dimmed={hasSelection && !compatibleModes.has('path')}
          >
            <IconTaPath />
          </ToolButton>
          <ToolButton
            collapsed={collapsed}
            label="Rotate"
            title="Target: persistent rotate — text/shape/highlight first"
            onClick={() => actions.addTargetAnimationClip('rotate')}
            active={compatibleModes.has('rotate')}
            dimmed={hasSelection && !compatibleModes.has('rotate')}
          >
            <IconTaRotate />
          </ToolButton>
          <ToolButton
            collapsed={collapsed}
            label="Camera pan"
            title="Camera pan to frame"
            onClick={actions.addCameraMoveClip}
          >
            <IconCameraMove />
          </ToolButton>
          <ToolButton
            collapsed={collapsed}
            label="Zoom region"
            title="Drag a region on the canvas to create a 1-second zoom"
            onClick={actions.beginCameraRegionSelection}
          >
            <IconCameraMove />
          </ToolButton>
          <ToolButton
            collapsed={collapsed}
            label="Fit object"
            title="Fit one selected measured object"
            onClick={actions.fitSelectedCameraObject}
            active={hasCameraFitTarget}
            dimmed={hasSelection && !hasCameraFitTarget}
          >
            <IconCameraMove />
          </ToolButton>
          <ToolButton
            collapsed={collapsed}
            label="Zoom frame"
            title="Create an independent 1-second return to the full logical frame"
            onClick={actions.addCameraFrameReturn}
          >
            <IconCameraMove />
          </ToolButton>
        </div>
        {!collapsed && (
          <p className="px-1 mt-1 text-[10px] leading-snug text-slate-500 text-left">
            {animationHint}
          </p>
        )}
      </div>
    </div>
  );
}

/** Audio entry points, rendered separately from the object/animation insert surface. */
export function InsertAudioActions({ collapsed }: { collapsed: boolean }) {
  const actions = useAddSceneItems();
  return (
    <div role="toolbar" aria-label="Audio actions">
      {!collapsed && (
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 px-1 mb-1 text-left w-full">
          Audio
        </div>
      )}
      <div
        className={
          collapsed
            ? 'flex flex-wrap gap-1 justify-center'
            : 'flex flex-col gap-1'
        }
      >
        <ToolButton
          collapsed={collapsed}
          label="Record audio"
          title="Record audio"
          onClick={actions.openAudioRecording}
        >
          <IconMic />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Upload audio"
          title="Upload audio file"
          onClick={actions.openAudioUpload}
        >
          <IconUploadAudio />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Text-to-speech"
          title="Text-to-speech"
          onClick={actions.openAudioTts}
        >
          <IconTts />
        </ToolButton>
      </div>
    </div>
  );
}
