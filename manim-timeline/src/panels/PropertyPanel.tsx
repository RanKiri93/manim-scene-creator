import { useSceneStore } from '@/store/useSceneStore';
import LineEditor from './LineEditor';
import GraphEditor from './GraphEditor';
import CompoundEditor from './CompoundEditor';

export default function PropertyPanel() {
  const inspectedId = useSceneStore((s) => s.inspectedId);
  const itemsMap = useSceneStore((s) => s.items);

  const item = inspectedId ? itemsMap.get(inspectedId) : undefined;

  if (!item) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-slate-500 p-4">
        Select an item to edit its properties.
      </div>
    );
  }

  switch (item.kind) {
    case 'textLine':
      return <LineEditor item={item} />;
    case 'graph':
      return <GraphEditor item={item} />;
    case 'compound':
      return <CompoundEditor item={item} />;
    default:
      return <p className="text-xs text-slate-500 p-4">Unknown item kind.</p>;
  }
}
