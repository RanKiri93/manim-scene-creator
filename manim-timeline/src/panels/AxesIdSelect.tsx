import { useMemo } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { ItemId } from '@/types/scene';

interface AxesIdSelectProps {
  value: ItemId;
  onChange: (axesId: ItemId) => void;
}

export default function AxesIdSelect({ value, onChange }: AxesIdSelectProps) {
  const itemsMap = useSceneStore((s) => s.items);

  const axesList = useMemo(() => {
    return Array.from(itemsMap.values())
      .filter((it) => it.kind === 'axes')
      .sort((a, b) => a.startTime - b.startTime);
  }, [itemsMap]);

  if (axesList.length === 0) {
    return (
      <p className="text-meta text-warn">
        Add an Axes clip first, then link this overlay.
      </p>
    );
  }

  const validRef = axesList.some((a) => a.id === value);
  const selectValue = validRef ? value : axesList[0]!.id;

  return (
    <label className="text-ctl text-chalk-dim block">
      Target axes
      {!validRef && (
        <span className="block text-meta text-warn mt-0.5">
          Previous axes id missing; choose a valid axes below.
        </span>
      )}
      <select
        value={selectValue}
        onChange={(e) => onChange(e.target.value)}
        className="ml-2 mt-1 w-full max-w-xs bg-raised border border-rule rounded-ctl px-2 py-1 text-ctl text-chalk"
      >
        {axesList.map((ax) => (
          <option key={ax.id} value={ax.id}>
            {ax.label.trim()
              ? `${ax.label.trim()} [${ax.id.slice(0, 8)}]`
              : ax.id.slice(0, 12)}
          </option>
        ))}
      </select>
    </label>
  );
}
