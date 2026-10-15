import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '@/lib/cx';
import { KindSwatch, TextInput } from '@/components/ui';
import {
  INSERT_GROUPS,
  searchInsertActions,
  type InsertActionDef,
  type InsertActionId,
} from './insertActions';
import { InsertActionIcon } from './insertIcons';
import type { InsertActionState } from './useInsertActionState';

const groupLabel = (def: InsertActionDef) => INSERT_GROUPS.find((g) => g.id === def.group)!;

/** Search every insert action by name or by everyday words ("fade" finds Exit). */
export default function InsertSearch({
  onClose,
  onRun,
  stateFor,
}: {
  onClose: () => void;
  onRun: (id: InsertActionId) => void;
  stateFor: (def: InsertActionDef) => InsertActionState;
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(() => searchInsertActions(query), [query]);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const active = Math.min(activeIndex, Math.max(0, results.length - 1));

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose]);

  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    // optionId only depends on listId, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const choose = (def: InsertActionDef | undefined) => {
    if (!def || stateFor(def).disabled) return;
    onRun(def.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((active + step + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const trimmed = query.trim();

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Insert search"
      className="fixed top-16 left-1/2 z-50 flex w-[min(440px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-1 rounded-pop border border-rule bg-panel p-2 shadow-lg"
    >
      <TextInput
        autoFocus
        role="combobox"
        aria-label="Search insert actions"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={results.length ? optionId(active) : undefined}
        placeholder="Insert… (try fade, zoom or voice)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" aria-label="Insert actions" className="m-0 max-h-80 list-none overflow-y-auto p-0">
        {results.map((def, i) => {
          const st = stateFor(def);
          const keywordHit =
            trimmed !== '' && !def.label.toLowerCase().includes(trimmed.toLowerCase());
          const group = groupLabel(def);
          return (
            <li
              key={def.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              aria-disabled={st.disabled || undefined}
              title={st.title}
              onMouseMove={() => setActiveIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(def)}
              className={cx(
                'grid cursor-pointer grid-cols-[18px_1fr_auto] items-center gap-2.5 rounded-ctl px-2 py-1.5 text-body [&_svg]:size-[18px]',
                i === active ? 'bg-raised text-chalk' : 'text-chalk-dim',
                st.disabled && 'cursor-not-allowed',
                (st.disabled || (st.dimmed && !st.active)) && 'opacity-45',
              )}
            >
              <InsertActionIcon id={def.id} />
              <span className="min-w-0 truncate">
                {def.label}
                {keywordHit && <span className="ml-1.5 text-meta text-chalk-faint">matches “{trimmed}”</span>}
              </span>
              <span className="flex items-center gap-1.5 text-meta text-chalk-faint">
                <KindSwatch group={group.kindGroup} size="sm" />
                {group.label}
              </span>
            </li>
          );
        })}
        {results.length === 0 && (
          <li className="px-2 py-2 text-ctl text-chalk-faint">
            Nothing matches “{trimmed}”. Try fade, zoom or voice.
          </li>
        )}
      </ul>
      <p className="m-0 px-2 pt-0.5 text-meta text-chalk-faint">
        ↑ ↓ to choose · Enter to insert · Esc to close
      </p>
    </div>
  );
}
