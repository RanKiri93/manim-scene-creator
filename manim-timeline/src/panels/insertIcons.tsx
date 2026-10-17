import type { ReactNode } from 'react';
import type { InsertActionId, InsertGroupId } from './insertActions';

/**
 * Insert rail icons on a 20px grid, 1.5px round strokes (set once on the <svg>).
 * Grammar, so new icons read without a tooltip:
 * - Animations draw the start state dashed and the end state solid.
 * - Graph parts sit on a faint axis baseline instead of full axes.
 * - Camera tools are framed by viewfinder corners.
 * - Fill only means something: the object or dot itself, or an area at 30%.
 */

const ghost = { strokeDasharray: '1.6 1.9', opacity: 0.55 } as const;
const baseline = <path d="M2.5 17.5h15" opacity={0.35} />;
const corners = <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />;

function FieldArrow({ x, y, deg }: { x: number; y: number; deg: number }) {
  return (
    <path
      transform={`translate(${x} ${y}) rotate(${deg})`}
      d="M-2.1 0h4.2M.9-1.3L2.1 0 .9 1.3"
      strokeWidth={1.3}
    />
  );
}

const ACTION_ICONS: Record<InsertActionId, ReactNode> = {
  textLine: <path d="M4.5 4.5h11M10 4.5V16M7.5 16h5" />,
  matrix: (
    <>
      <path d="M5.5 3.5h-2v13h2M14.5 3.5h2v13h-2" />
      <circle cx="7.75" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.25" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="7.75" cy="12.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.25" cy="12.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  shape: (
    <>
      <rect x="2.5" y="8.5" width="8.5" height="8.5" rx="1" />
      <circle cx="12.75" cy="7.25" r="4.5" />
    </>
  ),
  image: (
    <>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <circle cx="7" cy="8" r="1.6" fill="currentColor" stroke="none" />
      <path d="M3 14.5l4-4 3 3 2.5-2.5 4.5 4.5" />
    </>
  ),
  axes: (
    <>
      <path d="M4 3.5v13h13.5" />
      <path d="M2.5 5L4 3.5 5.5 5M16 15l1.5 1.5L16 18" />
      <path d="M8.5 15.5v2M13 15.5v2M3 12h2M3 7.5h2" strokeWidth={1.2} />
    </>
  ),
  graphPlot: (
    <>
      {baseline}
      <path d="M2.5 10C4.5 3.5 7.5 3.5 10 10s5.5 6.5 7.5 0" />
    </>
  ),
  graphCurve: (
    <>
      {baseline}
      <path d="M2.5 15C7 15 13.5 12 13.5 7.5a3.25 3.25 0 0 0-6.5 0C7 12 13 14.5 17.5 13" />
    </>
  ),
  graphDot: (
    <>
      {baseline}
      <path d="M2.5 13C6 6 14 6 17.5 11" opacity={0.45} />
      <path d="M10 10.5V17" strokeDasharray="1.3 1.8" opacity={0.55} strokeWidth={1.2} />
      <circle cx="10" cy="7.6" r="2.9" fill="currentColor" stroke="none" />
    </>
  ),
  graphArea: (
    <>
      {baseline}
      <path
        d="M3 17.5V11C5.5 6 8.5 6 10.5 9s4.5 4 7-2v10.5z"
        fill="currentColor"
        fillOpacity={0.3}
        stroke="none"
      />
      <path d="M3 11C5.5 6 8.5 6 10.5 9s4.5 4 7-2" />
    </>
  ),
  graphField: (
    <>
      {baseline}
      <FieldArrow x={4.5} y={3.5} deg={-48} />
      <FieldArrow x={10} y={3.5} deg={0} />
      <FieldArrow x={15.5} y={3.5} deg={48} />
      <FieldArrow x={4.5} y={8.5} deg={-90} />
      <circle cx="10" cy="8.5" r="1" fill="currentColor" stroke="none" />
      <FieldArrow x={15.5} y={8.5} deg={90} />
      <FieldArrow x={4.5} y={13.5} deg={-132} />
      <FieldArrow x={10} y={13.5} deg={180} />
      <FieldArrow x={15.5} y={13.5} deg={132} />
    </>
  ),
  graphFunctionSeries: (
    <>
      {baseline}
      <path d="M2.5 13C6.5 3 13.5 3 17.5 13" />
      <path d="M2.5 14C6.5 7 13.5 7 17.5 14" opacity={0.6} />
      <path d="M2.5 15C6.5 11 13.5 11 17.5 15" opacity={0.35} />
    </>
  ),
  graphPointSequence: (
    <>
      {baseline}
      <g fill="currentColor" stroke="none">
        <circle cx="3.75" cy="4" r="1.6" />
        <circle cx="7.25" cy="9" r="1.6" />
        <circle cx="10.5" cy="11.75" r="1.6" />
        <circle cx="13.5" cy="13.1" r="1.6" />
        <circle cx="16.4" cy="13.8" r="1.6" />
      </g>
    </>
  ),
  move: (
    <>
      <rect x="2.5" y="5" width="6" height="6" rx="1" {...ghost} />
      <rect x="11.5" y="5" width="6" height="6" rx="1" />
      <path d="M4 15.5h11.5M13.5 13.5l2 2-2 2" />
    </>
  ),
  path: (
    <>
      <rect x="2.5" y="12.5" width="5" height="5" rx="1" {...ghost} />
      <rect x="12.5" y="2.5" width="5" height="5" rx="1" />
      <path d="M5 12.5C5 5.5 11.5 14.5 15 7.5" strokeDasharray=".1 2.6" strokeWidth={1.7} />
    </>
  ),
  graphFollow: (
    <>
      {baseline}
      <path d="M2.5 14.5C6 14.5 8 5 12.5 5s4 2.5 5 4" opacity={0.45} />
      <circle cx="4" cy="14.4" r="2" {...ghost} />
      <circle cx="12.5" cy="5" r="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  scale: (
    <>
      <rect x="2.5" y="11.5" width="6" height="6" rx="1" {...ghost} />
      <rect x="2.5" y="2.5" width="15" height="15" rx="1.5" />
      <path d="M9.5 10.5l4-4M10.5 6.5h3v3" />
    </>
  ),
  rotate: (
    <>
      <rect x="5" y="6" width="9" height="9" rx="1" {...ghost} />
      <rect x="5" y="6" width="9" height="9" rx="1" transform="rotate(25 9.5 10.5)" />
      <path d="M10.9 2.6A8 8 0 0 1 17 7.8" />
      <path d="M17.6 5.5L17 7.8l-2-1.4" />
    </>
  ),
  color: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="1.5" />
      <path d="M17 4.5V15.5A1.5 1.5 0 0 1 15.5 17H4.5z" fill="currentColor" stroke="none" />
    </>
  ),
  matrixStep: (
    <>
      <path d="M4.5 3.5h-2v13h2M15.5 3.5h2v13h-2" />
      <path d="M6.5 6.5h7M6.5 13.5h7" />
      <path d="M11.8 8.6l1.7-2.1-1.7-2.1M8.2 15.6l-1.7-2.1 1.7-2.1" />
    </>
  ),
  blink: (
    <>
      <rect x="7" y="7" width="6" height="6" rx="1" fill="currentColor" stroke="none" />
      <rect x="4.5" y="4.5" width="11" height="11" rx="2" opacity={0.6} />
      <rect x="2" y="2" width="16" height="16" rx="3.5" opacity={0.28} />
    </>
  ),
  surroundingRect: (
    <>
      <rect x="2.5" y="4" width="15" height="12" rx="2.5" />
      <path d="M6.5 8.5h7M9 11.5h4.5" opacity={0.6} />
    </>
  ),
  exit: (
    <>
      <path d="M8.5 3.5H5A1.5 1.5 0 0 0 3.5 5v10A1.5 1.5 0 0 0 5 16.5h3.5" />
      <path d="M8 10h9M14 7l3 3-3 3" />
    </>
  ),
  cameraPan: (
    <>
      {corners}
      <path d="M6.5 10h7M11 7.5l2.5 2.5-2.5 2.5" />
    </>
  ),
  zoomRegion: (
    <>
      {corners}
      <circle cx="9.25" cy="9.25" r="3.5" />
      <path d="M11.8 11.8l2.7 2.7M9.25 7.75v3M7.75 9.25h3" strokeWidth={1.3} />
    </>
  ),
  fitObject: (
    <>
      {corners}
      <rect x="7" y="7" width="6" height="6" rx="1" fill="currentColor" fillOpacity={0.3} />
    </>
  ),
  fullFrame: (
    <>
      {corners}
      <path d="M7.5 12.5l5-5M9.5 7.5h3v3M10.5 12.5h-3v-3" />
    </>
  ),
  recordAudio: (
    <>
      <rect x="7.25" y="2.5" width="5.5" height="9.5" rx="2.75" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M7.5 17.5h5" />
    </>
  ),
  uploadAudio: (
    <>
      <path d="M3 8.5v3M6 6v8M9 8v4" />
      <path d="M14.5 16.5V4.5M11.5 7.5l3-3 3 3" />
    </>
  ),
  textToSpeech: (
    <>
      <path d="M3 4.5h7M6.5 4.5v11" />
      <path d="M12.5 7.5a3.5 3.5 0 0 1 0 5M15 5a7 7 0 0 1 0 10" />
    </>
  ),
};

/** Rail buttons for the groups that open a flyout. */
const GROUP_ICONS: Record<Exclude<InsertGroupId, 'create'>, ReactNode> = {
  graph: (
    <>
      <path d="M4 3.5v13h13.5" />
      <path d="M5.5 14C8.5 7 11 6.5 16.5 5" />
    </>
  ),
  animate: (
    <>
      <circle cx="12.5" cy="10" r="4.75" />
      <path d="M2.5 7h3.5M2.5 10h4.5M2.5 13h3.5" opacity={0.6} />
    </>
  ),
  camera: (
    <>
      {corners}
      <circle cx="10" cy="10" r="2.75" />
    </>
  ),
  audio: <path d="M3 8.5v3M6 6v8M9 3.5v13M12 6.5v7M15 8v4" />,
};

function IconSvg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function InsertActionIcon({ id }: { id: InsertActionId }) {
  return <IconSvg>{ACTION_ICONS[id]}</IconSvg>;
}

export function InsertSearchIcon() {
  return (
    <IconSvg>
      <circle cx="8.75" cy="8.75" r="5.25" />
      <path d="M12.6 12.6l4.4 4.4" />
    </IconSvg>
  );
}

export function InsertGroupIcon({ id }: { id: Exclude<InsertGroupId, 'create'> }) {
  return <IconSvg>{GROUP_ICONS[id]}</IconSvg>;
}
