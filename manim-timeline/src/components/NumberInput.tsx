import { cx } from '@/lib/cx';
import { NumberInput as FieldNumberInput } from '@/components/ui';

interface NumberInputProps {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
}

/**
 * Inline "label + number" row used across the editors. The input itself is the Chalkboard
 * `NumberInput` primitive (commits on blur/Enter, Escape cancels); new code can use that directly
 * inside a `Field`.
 */
export default function NumberInput({
  value,
  onChange,
  label,
  min,
  max,
  step = 0.1,
  className = '',
  disabled = false,
}: NumberInputProps) {
  return (
    <label className={cx('flex items-center gap-2 text-ctl text-chalk-dim', className)}>
      {label && <span className="min-w-[60px]">{label}</span>}
      <FieldNumberInput
        size="sm"
        className="w-20"
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
      />
    </label>
  );
}
