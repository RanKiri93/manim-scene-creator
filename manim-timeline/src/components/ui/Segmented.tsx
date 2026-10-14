import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { focusRing, type ControlSize } from './styles';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group for screen readers, e.g. "Item list order". */
  'aria-label': string;
  size?: ControlSize;
  className?: string;
}

/** Two to four mutually exclusive views, e.g. "By time / By object" or "Properties / Copilot". */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className,
  ...aria
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      className={cx('grid auto-cols-fr grid-flow-col gap-0.5 rounded-pop bg-ink p-0.5', className)}
      {...aria}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              'rounded-[4px] px-2 whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              size === 'sm' ? 'h-5 text-meta' : 'h-6 text-ctl',
              on ? 'bg-raised text-chalk' : 'text-chalk-dim enabled:hover:text-chalk',
              focusRing,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
