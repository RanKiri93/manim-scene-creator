import { createContext, useContext, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { useAddSceneItems } from '@/hooks/useAddSceneItems';
import { useSceneStore } from '@/store/useSceneStore';
import {
  canBeBlinkTarget,
  canBeExitTarget,
  canBeTargetAnimationTarget,
} from '@/lib/time';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import type { SceneItem, TargetAnimationMode } from '@/types/scene';
import { resolveGraphFollowSelection } from '@/lib/graphMotion';
import { cx } from '@/lib/cx';
import { ChevronRightIcon, IconButton, PanelTitle, SectionLabel, focusRing } from '@/components/ui';

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
  'graphFollow',
];

type RailTip = { label: string; detail?: string; top: number; left: number } | null;

/** Collapsed-rail labels render in a fixed layer so the scrolling rail cannot clip them. */
const RailTipContext = createContext<(tip: RailTip) => void>(() => {});

function RailTipLayer({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [tip, setTip] = useState<RailTip>(null);
  return (
    <RailTipContext.Provider value={setTip}>
      {/* A scrolled rail would leave the label floating beside the wrong icon. */}
      <div className="contents" onScrollCapture={() => setTip(null)}>
        {children}
      </div>
      {enabled && tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-64 -translate-y-1/2 rounded-ctl bg-chalk px-2 py-1 text-ctl text-ink shadow-lg"
          style={{ top: tip.top, left: tip.left }}
        >
          <div className="font-medium">{tip.label}</div>
          {tip.detail && <div className="text-meta text-ink/70">{tip.detail}</div>}
        </div>
      )}
    </RailTipContext.Provider>
  );
}

function ToolButton({
  title,
  onClick,
  children,
  label,
  collapsed,
  active,
  dimmed,
  disabled,
}: {
  /** Longer description: native tooltip when expanded, second line of the rail label when collapsed. */
  title: string;
  onClick: () => void;
  children: ReactNode;
  label?: string;
  collapsed: boolean;
  /** The current selection can use this action. */
  active?: boolean;
  dimmed?: boolean;
  /** Kept focusable and hoverable (aria-disabled) so the reason in `title` stays readable. */
  disabled?: boolean;
}) {
  const setTip = useContext(RailTipContext);
  const name = label ?? title;
  const detail = title !== name ? title : undefined;
  const showTip = (e: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label: name, detail, top: r.top + r.height / 2, left: r.right + 8 });
  };
  const hideTip = () => setTip(null);

  return (
    <button
      type="button"
      aria-label={name}
      aria-disabled={disabled || undefined}
      title={collapsed ? undefined : title}
      onClick={() => {
        hideTip();
        if (!disabled) onClick();
      }}
      onMouseEnter={collapsed ? showTip : undefined}
      onFocus={collapsed ? showTip : undefined}
      onMouseLeave={collapsed ? hideTip : undefined}
      onBlur={collapsed ? hideTip : undefined}
      className={cx(
        'flex shrink-0 items-center rounded-ctl transition-colors [&_svg]:size-[18px]',
        collapsed ? 'size-9 justify-center' : 'h-8 w-full gap-2.5 px-2 text-ctl',
        active ? 'text-chalk ring-1 ring-highlight/40 ring-inset' : 'text-chalk-dim',
        disabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-raised hover:text-chalk',
        dimmed && !active && !disabled && 'opacity-45',
        focusRing,
      )}
    >
      <span className="flex shrink-0 items-center justify-center">{children}</span>
      {!collapsed && label != null && (
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      )}
    </button>
  );
}

/** Group heading when expanded; a hairline divider in the icon rail. */
function CategoryLabel({
  children,
  collapsed,
}: {
  children: ReactNode;
  collapsed: boolean;
}) {
  if (collapsed) {
    return <hr aria-hidden="true" className="mx-auto my-2 w-6 border-0 border-t border-rule first:hidden" />;
  }
  return <SectionLabel className="mt-3 mb-1 px-1 first:mt-0">{children}</SectionLabel>;
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
      className={cx(
        'flex shrink-0 items-center pb-1',
        collapsed ? 'justify-center' : 'justify-between pl-1',
      )}
    >
      {!collapsed && <PanelTitle>Insert</PanelTitle>}
      <IconButton
        label={collapsed ? 'Show insert labels' : 'Collapse insert to icons'}
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
      >
        <span className={cx('inline-flex [&>svg]:size-4', !collapsed && 'rotate-180')}>
          <ChevronRightIcon />
        </span>
      </IconButton>
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

function IconZoomRegion() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="3" y="4" width="10" height="8" rx="1" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.6" />
      <circle cx="13" cy="12" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M15.2 14.2L17.5 16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconFitObject() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M3 7V4h3M14 4h3v3M17 13v3h-3M6 16H3v-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="7" y="7.5" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function IconZoomFrame() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="3" y="5" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7.5 8.5L5.5 7M12.5 8.5l2-1.5M7.5 11.5l-2 1.5M12.5 11.5l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconGraphFollow() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M4 16V4M4 16h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5 13c2-5 5-6 10-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="9" cy="9.4" r="1.8" fill="currentColor" />
      <path d="M12 6.2l2 1.6-2.3 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
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
      ? `Animations for ${truncLabel(itemClipDisplayName(selectedItems[0]!), 20)}`
      : 'Animations for the selection';
  const animationHint = !hasSelection
    ? 'Nothing selected: the first eligible object is used.'
    : hasAnyAnimationTarget
      ? 'Uses your selection.'
      : 'The selection cannot take these; the first eligible object is used.';
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

  const groupClass = collapsed
    ? 'flex flex-col items-center gap-0.5'
    : 'flex flex-col gap-0.5';

  return (
    <RailTipLayer enabled={collapsed}>
    <div
      className={cx(
        'flex min-h-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-auto py-2',
        collapsed ? 'px-1' : 'px-2',
      )}
      role="toolbar"
      aria-orientation="vertical"
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
          title={`Graph plot (function y = f(x)). ${graphHelper}`}
          onClick={actions.addGraphPlot}
        >
          <IconGraphPlot />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Curve"
          title={`Graph curve (parametric x(t), y(t)). ${graphHelper}`}
          onClick={actions.addGraphCurve}
        >
          <IconGraphCurve />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Dot"
          title={`Graph dot. ${graphHelper}`}
          onClick={actions.addGraphDot}
        >
          <IconGraphDot />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Area"
          title={`Graph area (fill under/between). ${graphHelper}`}
          onClick={actions.addGraphArea}
        >
          <IconGraphArea />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Vector field"
          title={`Vector or slope field. ${graphHelper}`}
          onClick={actions.addGraphField}
        >
          <IconVectorField />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Function series"
          title={`Function series (partial sums or family f(n,x)). ${graphHelper}`}
          onClick={actions.addGraphFunctionSeries}
        >
          <IconFunctionSeries />
        </ToolButton>
        <ToolButton
          collapsed={collapsed}
          label="Point sequence"
          title={`Point sequence (x(n), y(n)). ${graphHelper}`}
          onClick={actions.addGraphPointSequence}
        >
          <IconPointSequence />
        </ToolButton>
      </div>
      {!collapsed && <p className="m-0 mt-1 px-1 text-meta text-chalk-faint">{graphHelper}</p>}

      <div
        className={cx(
          'mt-3',
          hasAnyAnimationTarget &&
            !collapsed &&
            'rounded-pop bg-highlight/5 px-1 pt-1 pb-2 ring-1 ring-highlight/25 ring-inset',
        )}
      >
        <CategoryLabel collapsed={collapsed}>
          <span className={hasAnyAnimationTarget ? 'text-chalk' : undefined}>
            {animationTitle}
          </span>
        </CategoryLabel>
        <div className={groupClass}>
          <ToolButton
            collapsed={collapsed}
            label="Move along graph"
            title={graphFollowSelection.error ?? 'Move the selected graph dot along its same-axes plot'}
            onClick={() => actions.addTargetAnimationClip('graphFollow')}
            active={canFollowGraph}
            dimmed={!canFollowGraph}
            disabled={!canFollowGraph}
          >
            <IconGraphFollow />
          </ToolButton>
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
            title="Persistent scale. Uses compatible selected objects, or the first eligible one."
            onClick={() => actions.addTargetAnimationClip('scale')}
            active={compatibleModes.has('scale')}
            dimmed={hasSelection && !compatibleModes.has('scale')}
          >
            <IconTaScale />
          </ToolButton>
          <ToolButton
            collapsed={collapsed}
            label="Color"
            title="Persistent color change. Works on the same objects as Blink."
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
            title="Persistent rotation. Prefers text, shapes and highlights."
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
            <IconZoomRegion />
          </ToolButton>
          <ToolButton
            collapsed={collapsed}
            label="Fit object"
            title="Fit one selected measured object"
            onClick={actions.fitSelectedCameraObject}
            active={hasCameraFitTarget}
            dimmed={hasSelection && !hasCameraFitTarget}
          >
            <IconFitObject />
          </ToolButton>
          <ToolButton
            collapsed={collapsed}
            label="Zoom frame"
            title="Create an independent 1-second return to the full logical frame"
            onClick={actions.addCameraFrameReturn}
          >
            <IconZoomFrame />
          </ToolButton>
        </div>
        {!collapsed && (
          <p className="m-0 mt-1 px-1 text-meta text-chalk-faint">{animationHint}</p>
        )}
      </div>
    </div>
    </RailTipLayer>
  );
}

/** Audio entry points, rendered separately from the object/animation insert surface. */
export function InsertAudioActions({ collapsed }: { collapsed: boolean }) {
  const actions = useAddSceneItems();
  return (
    <RailTipLayer enabled={collapsed}>
    <div role="toolbar" aria-orientation="vertical" aria-label="Audio actions">
      {!collapsed && <SectionLabel className="mb-1 px-1">Audio</SectionLabel>}
      <div className={collapsed ? 'flex flex-col items-center gap-0.5' : 'flex flex-col gap-0.5'}>
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
    </RailTipLayer>
  );
}
