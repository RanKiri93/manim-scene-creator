import { TextInput } from '@/components/ui';

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
}

/** Native color swatch plus an editable hex field. */
export default function ColorPicker({ value, onChange, label }: ColorPickerProps) {
  return (
    <div className="flex items-center gap-2 text-ctl text-chalk-dim">
      {label && <span>{label}</span>}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label ? `${label} swatch` : 'Color swatch'}
        className="size-6 shrink-0 cursor-pointer rounded-ctl border border-rule bg-transparent p-0.5"
      />
      <TextInput
        code
        size="sm"
        className="w-24"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label ? `${label} hex value` : 'Hex color'}
      />
    </div>
  );
}
