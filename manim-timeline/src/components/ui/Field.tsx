import { useId, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { FieldContext, type FieldIds } from './fieldContext';

interface FieldProps {
  label: ReactNode;
  children: ReactNode;
  /** One short sentence under the control. */
  hint?: ReactNode;
  /** Replaces the hint and marks the control invalid. Say what is wrong and how to fix it. */
  error?: ReactNode;
  /** `stack`: label above (inspector default). `inline`: label left, for short numeric rows. */
  layout?: 'stack' | 'inline';
  /** Pass when the control is not one of the ui primitives and needs a known id. */
  id?: string;
  className?: string;
}

export function Field({ label, children, hint, error, layout = 'stack', id, className }: FieldProps) {
  const auto = useId();
  const controlId = id ?? `${auto}-control`;
  const noteId = `${auto}-note`;
  const note = error ?? hint;
  const ids: FieldIds = {
    id: controlId,
    describedBy: note ? noteId : undefined,
    invalid: Boolean(error),
  };

  return (
    <FieldContext.Provider value={ids}>
      <div
        className={cx(
          layout === 'stack' ? 'grid gap-1' : 'grid grid-cols-[minmax(64px,auto)_1fr] items-center gap-x-2.5 gap-y-1',
          className,
        )}
      >
        <label htmlFor={controlId} className="text-ctl text-chalk-dim">
          {label}
        </label>
        {children}
        {note && (
          <p
            id={noteId}
            className={cx(
              'm-0 text-meta',
              error ? 'text-danger' : 'text-chalk-faint',
              layout === 'inline' && 'col-start-2',
            )}
          >
            {note}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
