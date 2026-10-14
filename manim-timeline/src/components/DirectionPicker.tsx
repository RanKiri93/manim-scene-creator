import type { ManimDirection } from '@/types/scene';
import { cx } from '@/lib/cx';
import { focusRing } from '@/components/ui';

const GRID: ManimDirection[][] = [
  ['UL', 'UP', 'UR'],
  ['LEFT', 'DOWN', 'RIGHT'],
  ['DL', 'DOWN', 'DR'],
];

const ARROW: Partial<Record<ManimDirection, string>> = {
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

/** 3×3 Manim direction grid; arrows on screen, Manim constant names for screen readers. */
export default function DirectionPicker({ value, onChange, label }: DirectionPickerProps) {
  return (
    <div className="flex items-start gap-2">
      {label && <span className="mt-1 text-ctl text-chalk-dim">{label}</span>}
      <div role="group" aria-label={label ?? 'Direction'} className="grid grid-cols-3 gap-0.5">
        {GRID.flat().map((dir, i) => (
          <button
            key={`${dir}-${i}`}
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
            {ARROW[dir] ?? dir}
          </button>
        ))}
      </div>
    </div>
  );
}
