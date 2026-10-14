import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { focusRing } from './styles';

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
}

interface TabsProps<T extends string> {
  /** Shared with the matching `TabPanel`s to wire `aria-controls` / `aria-labelledby`. Use `useId()`. */
  idBase: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  'aria-label'?: string;
  className?: string;
}

const tabId = (idBase: string, id: string) => `${idBase}-tab-${id}`;
const panelId = (idBase: string, id: string) => `${idBase}-panel-${id}`;

/** Underlined tab row. Arrow keys, Home and End move between tabs (roving tabindex). */
export function Tabs<T extends string>({ idBase, items, value, onChange, className, ...aria }: TabsProps<T>) {
  const index = Math.max(0, items.findIndex((t) => t.id === value));

  const move = (next: number) => {
    const item = items[Math.min(items.length - 1, Math.max(0, next))];
    if (!item) return;
    onChange(item.id);
    requestAnimationFrame(() => document.getElementById(tabId(idBase, item.id))?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: items.length - 1,
    };
    if (e.key in keys) {
      e.preventDefault();
      move(keys[e.key]!);
    }
  };

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cx('flex flex-wrap gap-x-4 border-b border-rule', className)}
      {...aria}
    >
      {items.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            id={tabId(idBase, t.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(idBase, t.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cx(
              '-mb-px border-b-2 pt-1 pb-2 text-ctl whitespace-nowrap transition-colors',
              selected ? 'border-highlight text-chalk' : 'border-transparent text-chalk-dim hover:text-chalk',
              focusRing,
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

interface TabPanelProps {
  idBase: string;
  id: string;
  active: boolean;
  children: ReactNode;
  className?: string;
}

/** Renders its children only while active, matching today's PropertyTabs behaviour. */
export function TabPanel({ idBase, id, active, children, className }: TabPanelProps) {
  return (
    <div
      id={panelId(idBase, id)}
      role="tabpanel"
      aria-labelledby={tabId(idBase, id)}
      hidden={!active}
      className={className}
    >
      {active ? children : null}
    </div>
  );
}
