import {
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

export interface PropertyTab {
  id: string;
  label: string;
  content: ReactNode;
}

interface PropertyTabsProps {
  tabs: PropertyTab[];
  /** When omitted, first tab id is selected on mount */
  defaultTabId?: string;
}

function resolveDefaultTabId(tabs: PropertyTab[], defaultTabId?: string): string {
  if (defaultTabId && tabs.some((t) => t.id === defaultTabId)) {
    return defaultTabId;
  }
  return tabs[0]?.id ?? '';
}

export default function PropertyTabs({ tabs, defaultTabId }: PropertyTabsProps) {
  const reactId = useId();

  const fallbackId = useMemo(
    () => resolveDefaultTabId(tabs, defaultTabId),
    [tabs, defaultTabId],
  );

  const [activeTabId, setActiveTabId] = useState<string>(() =>
    resolveDefaultTabId(tabs, defaultTabId),
  );

  const selectedId =
    fallbackId && tabs.some((t) => t.id === activeTabId) ? activeTabId : fallbackId;

  const resolvedIdx = tabs.findIndex((t) => t.id === selectedId);
  const clampedIdx = resolvedIdx >= 0 ? resolvedIdx : 0;

  const focusTabIndex = (i: number) => {
    if (tabs.length === 0 || i < 0 || i >= tabs.length) return;
    const id = tabs[i]!.id;
    setActiveTabId(id);
    requestAnimationFrame(() => {
      document.getElementById(`${reactId}-tab-${id}`)?.focus();
    });
  };

  const onTabListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (tabs.length === 0) return;
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusTabIndex(Math.min(tabs.length - 1, clampedIdx + 1));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusTabIndex(Math.max(0, clampedIdx - 1));
        break;
      case 'Home':
        e.preventDefault();
        focusTabIndex(0);
        break;
      case 'End':
        e.preventDefault();
        focusTabIndex(tabs.length - 1);
        break;
      default:
        break;
    }
  };

  if (!tabs.length) {
    return null;
  }

  return (
    <div className="flex flex-col">
      <div
        role="tablist"
        aria-orientation="horizontal"
        className="flex flex-wrap gap-1 border-b border-slate-700 pb-2 mb-3"
        onKeyDown={onTabListKeyDown}
      >
        {tabs.map((tab) => {
          const sel = tab.id === selectedId;
          const panelDomId = `${reactId}-panel-${tab.id}`;
          const btnId = `${reactId}-tab-${tab.id}`;
          return (
            <button
              key={tab.id}
              id={btnId}
              type="button"
              role="tab"
              aria-selected={sel}
              aria-controls={panelDomId}
              tabIndex={sel ? 0 : -1}
              className={
                'rounded px-2 py-1 text-xs font-medium shrink-0 ' +
                (sel
                  ? 'bg-slate-200 text-slate-900'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700')
              }
              onClick={() => setActiveTabId(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => {
        const sel = tab.id === selectedId;
        const panelDomId = `${reactId}-panel-${tab.id}`;
        return (
          <div
            key={tab.id}
            id={panelDomId}
            role="tabpanel"
            aria-labelledby={`${reactId}-tab-${tab.id}`}
            hidden={!sel}
            className={sel ? '' : 'hidden'}
          >
            {sel ? tab.content : null}
          </div>
        );
      })}
    </div>
  );
}
