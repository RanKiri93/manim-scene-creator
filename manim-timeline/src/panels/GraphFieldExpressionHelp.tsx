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
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-rule text-meta font-semibold leading-none text-chalk-dim hover:border-rule hover:text-chalk"
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
