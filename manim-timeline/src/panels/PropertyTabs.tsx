import { useId, useMemo, useState, type ReactNode } from 'react';
import { TabPanel, Tabs } from '@/components/ui';

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

/** Editor tab strip; a thin adapter over the Chalkboard `Tabs` / `TabPanel` primitives. */
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

  if (!tabs.length) {
    return null;
  }

  return (
    <div className="flex flex-col">
      <Tabs
        idBase={reactId}
        items={tabs.map((t) => ({ id: t.id, label: t.label }))}
        value={selectedId}
        onChange={setActiveTabId}
        className="mb-3"
      />
      {tabs.map((tab) => (
        <TabPanel key={tab.id} idBase={reactId} id={tab.id} active={tab.id === selectedId}>
          {tab.content}
        </TabPanel>
      ))}
    </div>
  );
}
