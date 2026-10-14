import {
  type AriaAttributes,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from '@/lib/cx';
import { useFieldIds } from './fieldContext';
import { fieldHeight, fieldSurface, focusRing, type ControlSize } from './styles';

/** id / aria-describedby / aria-invalid from an enclosing Field, unless the caller set them. */
function useFieldAttrs(props: { id?: string } & Pick<AriaAttributes, 'aria-describedby' | 'aria-invalid'>) {
  const field = useFieldIds();
  return {
    id: props.id ?? field?.id,
    'aria-describedby': props['aria-describedby'] ?? field?.describedBy,
    'aria-invalid': props['aria-invalid'] ?? (field?.invalid || undefined),
  };
}

/** Unit suffix (`s`, `pt`, `°`) drawn inside the right edge of a field. */
function WithUnit({ unit, children }: { unit?: string; children: ReactNode }) {
  if (!unit) return <>{children}</>;
  return (
    <div className="relative">
      {children}
      <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-ctl text-chalk-faint">
        {unit}
      </span>
    </div>
  );
}

interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: ControlSize;
  unit?: string;
}

/** Single-line text. Hebrew-capable: defaults to `dir="auto"`. */
export function TextInput({ size = 'md', unit, className, dir = 'auto', type = 'text', ...rest }: TextInputProps) {
  const attrs = useFieldAttrs(rest);
  return (
    <WithUnit unit={unit}>
      <input
        type={type}
        dir={dir}
        {...rest}
        {...attrs}
        className={cx(fieldSurface, fieldHeight[size], 'px-2', unit && 'pr-7', className)}
      />
    </WithUnit>
  );
}

interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'value' | 'onChange' | 'type' | 'min' | 'max' | 'step'> {
  value: number;
  /** Called on blur or Enter with the parsed, clamped value. Invalid text reverts to `value`. */
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  size?: ControlSize;
  unit?: string;
}

/**
 * Number field that commits on blur or Enter, so undo records one step per edit rather than one
 * per keystroke. Replaces `components/NumberInput.tsx` as panels migrate.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 0.1,
  size = 'md',
  unit,
  className,
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: NumberInputProps) {
  const attrs = useFieldAttrs(rest);
  // While focused the field shows the user's draft; otherwise it always shows the prop.
  const [draft, setDraft] = useState<string | null>(null);
  // Escape blurs without committing; blur fires before React re-renders, so flag it.
  const cancelled = useRef(false);

  const commit = (text: string) => {
    let v = parseFloat(text);
    if (Number.isNaN(v)) v = value;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    setDraft(String(v));
    if (v !== value) onChange(v);
  };

  return (
    <WithUnit unit={unit}>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        {...rest}
        {...attrs}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setDraft(String(value));
          onFocus?.(e);
        }}
        onBlur={(e) => {
          if (!cancelled.current) commit(e.target.value);
          cancelled.current = false;
          setDraft(null);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value);
          if (e.key === 'Escape') {
            cancelled.current = true;
            e.currentTarget.blur();
          }
          onKeyDown?.(e);
        }}
        className={cx(
          fieldSurface,
          fieldHeight[size],
          'px-2 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          unit && 'pr-7',
          className,
        )}
      />
    </WithUnit>
  );
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: ControlSize;
}

export function Select({ size = 'md', className, children, ...rest }: SelectProps) {
  const attrs = useFieldAttrs(rest);
  return (
    <div className={cx('relative', className)}>
      <select
        {...rest}
        {...attrs}
        className={cx(fieldSurface, fieldHeight[size], 'appearance-none pr-7 pl-2')}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 10 6"
        className="pointer-events-none absolute top-1/2 right-2.5 h-1.5 w-2.5 -translate-y-1/2 text-chalk-dim"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M1 1l4 4 4-4" />
      </svg>
    </div>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** LaTeX or math source: monospace, always left-to-right, no spellcheck. */
  code?: boolean;
}

export function TextArea({ code = false, className, rows = 3, dir = 'auto', spellCheck, ...rest }: TextAreaProps) {
  const attrs = useFieldAttrs(rest);
  return (
    <textarea
      rows={rows}
      {...rest}
      {...attrs}
      dir={code ? 'ltr' : dir}
      spellCheck={code ? false : spellCheck}
      className={cx(
        fieldSurface,
        'resize-y px-2 py-1.5 leading-relaxed',
        code && 'font-mono',
        className,
      )}
    />
  );
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'size'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}

/** Checkbox with its label. The whole row is the hit target. */
export function Checkbox({ checked, onChange, children, className, disabled, ...rest }: CheckboxProps) {
  return (
    <label
      className={cx(
        'inline-flex items-center gap-2 text-ctl select-none',
        disabled ? 'cursor-not-allowed text-chalk-faint' : 'cursor-pointer text-chalk',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={cx('size-3.5 shrink-0 accent-highlight', focusRing)}
        {...rest}
      />
      {children}
    </label>
  );
}
