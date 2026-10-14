/**
 * Stroke icons for the Chalkboard primitives: 16px grid, `currentColor`, sized by the parent
 * (`Button` / `IconButton` set svg size). Decorative; the button carries the accessible name.
 */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export const UndoIcon = () => (
  <svg viewBox="0 0 16 16" {...stroke}>
    <path d="M5 4 2.5 6.5 5 9" />
    <path d="M2.8 6.5H10a3.5 3.5 0 0 1 0 7H7" />
  </svg>
);

export const RedoIcon = () => (
  <svg viewBox="0 0 16 16" {...stroke}>
    <path d="M11 4l2.5 2.5L11 9" />
    <path d="M13.2 6.5H6a3.5 3.5 0 0 0 0 7h3" />
  </svg>
);

export const DuplicateIcon = () => (
  <svg viewBox="0 0 16 16" {...stroke}>
    <rect x="4.5" y="4.5" width="9" height="9" rx="1.5" />
    <path d="M2.5 11V3.5a1 1 0 0 1 1-1H11" />
  </svg>
);

export const CloseIcon = () => (
  <svg viewBox="0 0 16 16" {...stroke}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const PlusIcon = () => (
  <svg viewBox="0 0 16 16" {...stroke}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const PencilIcon = () => (
  <svg viewBox="0 0 16 16" {...stroke}>
    <path d="M10.5 2.5l3 3L6 13H3v-3z" />
    <path d="M9 4l3 3" />
  </svg>
);

export const ChevronRightIcon = () => (
  <svg viewBox="0 0 16 16" {...stroke}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
);

export const GridIcon = () => (
  <svg viewBox="0 0 16 16" {...stroke} strokeWidth={1.3}>
    <path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12" />
  </svg>
);
