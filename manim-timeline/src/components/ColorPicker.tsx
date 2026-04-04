interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
}

export default function ColorPicker({ value, onChange, label }: ColorPickerProps) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-300">
      {label && <span>{label}</span>}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-6 h-6 rounded border border-slate-600 cursor-pointer bg-transparent"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-300 font-mono"
      />
    </label>
  );
}
