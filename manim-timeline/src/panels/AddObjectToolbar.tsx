import type { ReactNode } from 'react';
import { useAddSceneItems } from '@/hooks/useAddSceneItems';

function ToolButton({
  title,
  onClick,
  children,
  'aria-label': ariaLabel,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel ?? title}
      onClick={onClick}
      className="flex items-center justify-center w-9 h-9 rounded-md bg-slate-800/80 border border-slate-600/80 text-slate-200 hover:bg-slate-700 hover:border-slate-500 transition-colors shrink-0"
    >
      {children}
    </button>
  );
}

function CategoryLabel({ children }: { children: string }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 px-0.5 mt-2 first:mt-0 mb-1 text-center w-full">
      {children}
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

export default function AddObjectToolbar() {
  const actions = useAddSceneItems();

  return (
    <div
      className="min-h-0 w-full flex flex-col py-2 px-2 overflow-y-auto overflow-x-hidden"
      role="toolbar"
      aria-label="Add objects and audio"
    >
      <CategoryLabel>Independent</CategoryLabel>
      <div className="flex flex-wrap gap-1 justify-center">
        <ToolButton title="Text line" onClick={actions.addTextLine}>
          <IconTextLine />
        </ToolButton>
        <ToolButton title="Axes" onClick={actions.addAxes}>
          <IconAxes />
        </ToolButton>
        <ToolButton title="Shape (circle, rectangle, arrow, line)" onClick={actions.addShape}>
          <IconShape />
        </ToolButton>
      </div>

      <CategoryLabel>Axes</CategoryLabel>
      <div className="flex flex-wrap gap-1 justify-center">
        <ToolButton
          title="Graph plot (function y = f(x))"
          onClick={actions.addGraphPlot}
        >
          <IconGraphPlot />
        </ToolButton>
        <ToolButton title="Graph curve (parametric x(t), y(t))" onClick={actions.addGraphCurve}>
          <IconGraphCurve />
        </ToolButton>
        <ToolButton title="Graph dot" onClick={actions.addGraphDot}>
          <IconGraphDot />
        </ToolButton>
        <ToolButton title="Vector / slope field" onClick={actions.addGraphField}>
          <IconVectorField />
        </ToolButton>
        <ToolButton
          title="Function series (partial sums or family f(n,x))"
          onClick={actions.addGraphFunctionSeries}
        >
          <IconFunctionSeries />
        </ToolButton>
        <ToolButton
          title="Point sequence (x(n), y(n))"
          onClick={actions.addGraphPointSequence}
        >
          <IconPointSequence />
        </ToolButton>
        <ToolButton title="Graph area (fill under/between)" onClick={actions.addGraphArea}>
          <IconGraphArea />
        </ToolButton>
      </div>

      <CategoryLabel>Dependent</CategoryLabel>
      <div className="flex flex-wrap gap-1 justify-center">
        <ToolButton
          title="Surrounding rectangle (select targets or uses first eligible)"
          onClick={actions.addSurroundingRectClip}
        >
          <IconSurroundingRect />
        </ToolButton>
      </div>

      <CategoryLabel>Animations</CategoryLabel>
      <div className="flex flex-wrap gap-1 justify-center">
        <ToolButton
          title="Exit animation (multi-select targets; replaces prior exits on those targets)"
          onClick={actions.addExitAnimationClip}
        >
          <IconExitAnimation />
        </ToolButton>
        <ToolButton
          title="Blink animation (pulse scale/color; does not remove targets)"
          onClick={actions.addBlinkAnimationClip}
        >
          <IconBlinkAnimation />
        </ToolButton>
        <ToolButton
          title="Target: persistent scale — select compatible objects or picks first eligible"
          onClick={() => actions.addTargetAnimationClip('scale')}
        >
          <IconTaScale />
        </ToolButton>
        <ToolButton
          title="Target: persistent color — same eligible set as blink"
          onClick={() => actions.addTargetAnimationClip('color')}
        >
          <IconTaColor />
        </ToolButton>
        <ToolButton
          title="Target: persistent move shift (dx/dy)"
          onClick={() => actions.addTargetAnimationClip('move')}
        >
          <IconTaMove />
        </ToolButton>
        <ToolButton
          title="Target: persistent move along path (relative offsets)"
          onClick={() => actions.addTargetAnimationClip('path')}
        >
          <IconTaPath />
        </ToolButton>
        <ToolButton
          title="Target: persistent rotate — text/shape/highlight first"
          onClick={() => actions.addTargetAnimationClip('rotate')}
        >
          <IconTaRotate />
        </ToolButton>
      </div>

      <CategoryLabel>Audio</CategoryLabel>
      <div className="flex flex-wrap gap-1 justify-center">
        <ToolButton title="Record audio" onClick={actions.openAudioRecording}>
          <IconMic />
        </ToolButton>
        <ToolButton title="Upload audio file" onClick={actions.openAudioUpload}>
          <IconUploadAudio />
        </ToolButton>
        <ToolButton title="Text-to-speech" onClick={actions.openAudioTts}>
          <IconTts />
        </ToolButton>
      </div>
    </div>
  );
}
