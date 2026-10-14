import type { ManimDirection } from '@/types/scene';
import { cx } from '@/lib/cx';
import { focusRing } from '@/components/ui';

/** The eight Manim directions around a point; `null` is the point itself (not selectable). */
const GRID: (ManimDirection | null)[] = [
  'UL', 'UP', 'UR',
  'LEFT', null, 'RIGHT',
  'DL', 'DOWN', 'DR',
];

const ARROW: Record<ManimDirection, string> = {
  UL: '↖',
  UP: '↑',
  UR: '↗',
  LEFT: '←',
  RIGHT: '→',
  DL: '↙',
  DOWN: '↓',
  DR: '↘',
};

interface DirectionPickerProps {
  value: ManimDirection;
  onChange: (dir: ManimDirection) => void;
  label?: string;
}

/**
 * Pick which side of a point something sits on (Manim `next_to` direction). Arrows on screen,
 * Manim constant names for screen readers; the center cell marks the point itself.
 */
export default function DirectionPicker({ value, onChange, label }: DirectionPickerProps) {
  return (
    <div className="flex items-start gap-2">
      {label && <span className="mt-1 text-ctl text-chalk-dim">{label}</span>}
      {/* A physical map of directions: never mirror it, even inside right-to-left (Hebrew) panels. */}
      <div role="group" aria-label={label ?? 'Direction'} dir="ltr" className="grid grid-cols-3 gap-0.5">
        {GRID.map((dir) =>
          dir == null ? (
            <span
              key="center"
              aria-hidden="true"
              className="flex size-6 items-center justify-center"
              title="The point itself"
            >
              <span className="size-1.5 rounded-full bg-chalk-faint" />
            </span>
          ) : (
            <button
              key={dir}
              type="button"
              onClick={() => onChange(dir)}
              aria-label={dir}
              aria-pressed={value === dir}
              title={dir}
              className={cx(
                'size-6 rounded-ctl text-ctl leading-none transition-colors',
                value === dir
                  ? 'bg-highlight text-highlight-ink'
                  : 'bg-raised text-chalk-dim hover:bg-rule hover:text-chalk',
                focusRing,
              )}
            >
              {ARROW[dir]}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
