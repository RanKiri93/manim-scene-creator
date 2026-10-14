import type { KindColorGroup } from '@/lib/theme';

/** Shared class strings for the Chalkboard primitives. See .agents/skills/ui-design-system. */

export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-highlight';

/** Text inputs, selects and textareas share one surface. */
export const fieldSurface =
  'w-full rounded-ctl border border-rule bg-raised text-ctl text-chalk placeholder:text-chalk-faint ' +
  'hover:border-chalk-faint/60 focus:border-chalk-faint focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-50 ' +
  focusRing;

export const fieldHeight = { sm: 'h-6', md: 'h-[30px]' } as const;
export type ControlSize = keyof typeof fieldHeight;

/** Static class names so Tailwind can see every kind color utility. */
export const kindBg: Record<KindColorGroup, string> = {
  text: 'bg-kind-text',
  axes: 'bg-kind-axes',
  graph: 'bg-kind-graph',
  shape: 'bg-kind-shape',
  camera: 'bg-kind-camera',
  audio: 'bg-kind-audio',
  image: 'bg-kind-image',
  effect: 'bg-kind-effect',
};
