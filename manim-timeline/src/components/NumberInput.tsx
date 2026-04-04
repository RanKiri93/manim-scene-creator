import { useState, useEffect, useCallback } from 'react';

interface NumberInputProps {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}

export default function NumberInput({
  value,
  onChange,
  label,
  min,
  max,
  step = 0.1,
  className = '',
}: NumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  const [isFocused, setIsFocused] = useState(false);

  // Sync from prop when not editing
  useEffect(() => {
    if (!isFocused) setDraft(String(value));
  }, [value, isFocused]);

  const commit = useCallback(() => {
    let v = parseFloat(draft);
    if (isNaN(v)) v = value;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    setDraft(String(v));
    onChange(v);
  }, [draft, value, min, max, onChange]);

  return (
    <label className={`flex items-center gap-2 text-xs text-slate-300 ${className}`}>
      {label && <span className="min-w-[60px]">{label}</span>}
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => { setIsFocused(false); commit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        className="w-20 bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-300"
      />
    </label>
  );
}
