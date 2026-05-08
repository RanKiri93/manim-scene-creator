type VisibleAtSceneStartRowProps = {
  checked: boolean;
  disabled?: boolean;
  disabledReason?: string;
  note?: string;
  onChange: (next: boolean) => void;
};

/** Checkbox: object is on screen from t=0; export uses `self.add` (no intro animation). */
export default function VisibleAtSceneStartRow({
  checked,
  disabled = false,
  disabledReason,
  note,
  onChange,
}: VisibleAtSceneStartRowProps) {
  return (
    <div className="flex flex-col gap-1 text-xs text-slate-300">
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          className="rounded border-slate-600"
          checked={checked}
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>Already visible at scene start</span>
      </label>
      {disabled && disabledReason ? (
        <p className="text-slate-500 pl-6">{disabledReason}</p>
      ) : null}
      {checked && note ? <p className="text-slate-500 pl-6">{note}</p> : null}
    </div>
  );
}
