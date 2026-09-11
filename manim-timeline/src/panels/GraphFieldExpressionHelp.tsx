/**
 * Shared "?" tooltip control. Expression presets/snippets now live in
 * `mathExpressionPresets.ts` (consumed by `MathExpressionEditor`); this
 * module keeps only the icon used by the editor and dialog chrome.
 */

interface HelpIconProps {
  title: string;
  /** Accessible label when title is long */
  label?: string;
}

/** Small ? control; stops propagation so it does not toggle a parent <details>. */
export function GraphFieldHelpIcon({ title, label = 'Help' }: HelpIconProps) {
  return (
    <button
      type="button"
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-500 text-[10px] font-semibold leading-none text-slate-400 hover:border-slate-400 hover:text-slate-200"
      title={title}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      ?
    </button>
  );
}
