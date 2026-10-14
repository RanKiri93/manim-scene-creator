import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { focusRing, type ControlSize } from './styles';

export type ButtonVariant = 'primary' | 'line' | 'ghost' | 'link';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` is the one main action per view; `line` for secondary; `ghost` in toolbars; `link` inline in text. */
  variant?: ButtonVariant;
  size?: ControlSize;
  /** Destructive action: red text, red ring on `line`. */
  danger?: boolean;
  /** Optional leading icon, 16px (14px at `sm`). */
  icon?: ReactNode;
}

const base =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl font-sans ' +
  'transition-colors select-none disabled:cursor-not-allowed disabled:opacity-50 ' +
  '[&>svg]:shrink-0 ' +
  focusRing;

const sizes: Record<ControlSize, string> = {
  sm: 'h-6 px-2 text-meta [&>svg]:size-3.5',
  md: 'h-7 px-2.5 text-ctl [&>svg]:size-4',
};

function variantClass(variant: ButtonVariant, danger: boolean): string {
  switch (variant) {
    case 'primary':
      return danger
        ? 'bg-danger font-semibold text-highlight-ink enabled:hover:bg-danger/90'
        : 'bg-highlight font-semibold text-highlight-ink enabled:hover:bg-highlight/90';
    case 'line':
      return danger
        ? 'text-danger ring-1 ring-inset ring-danger/45 enabled:hover:bg-danger/10'
        : 'text-chalk ring-1 ring-inset ring-rule enabled:hover:bg-raised';
    case 'ghost':
      return danger
        ? 'text-danger enabled:hover:bg-danger/10'
        : 'text-chalk enabled:hover:bg-raised';
    case 'link':
      return cx(
        'h-auto! px-0! underline decoration-1 underline-offset-2',
        danger ? 'text-danger enabled:hover:text-danger/80' : 'text-chalk-dim enabled:hover:text-chalk',
      );
  }
}

export function Button({
  variant = 'line',
  size = 'md',
  danger = false,
  icon,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(base, sizes[size], variantClass(variant, danger), className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Accessible name and tooltip. Required: icon-only buttons are unlabeled otherwise. */
  label: string;
  children: ReactNode;
  size?: ControlSize;
  danger?: boolean;
  /** Set for toggle buttons; renders `aria-pressed` and a pressed surface. */
  pressed?: boolean;
}

const iconSizes: Record<ControlSize, string> = {
  sm: 'size-6 [&>svg]:size-3.5',
  md: 'size-7 [&>svg]:size-4',
};

export function IconButton({
  label,
  size = 'md',
  danger = false,
  pressed,
  type = 'button',
  title,
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      className={cx(
        base,
        iconSizes[size],
        pressed ? 'bg-raised text-chalk' : 'text-chalk-dim',
        danger ? 'enabled:hover:bg-danger/10 enabled:hover:text-danger' : 'enabled:hover:bg-raised enabled:hover:text-chalk',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
