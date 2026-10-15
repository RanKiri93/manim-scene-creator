import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '@/lib/cx';
import { focusRing } from '@/components/ui';
import { itemClipDisplayName } from '@/lib/itemDisplayName';
import { INSERT_ACTIONS, type InsertActionDef, type InsertSubgroupId } from '@/panels/insertActions';
import { InsertActionIcon } from '@/panels/insertIcons';
import { truncLabel, useInsertActionState } from '@/panels/useInsertActionState';
import { placeAboveAnchor, type AnchorRect } from './selectionAnchor';

const SECTIONS: readonly (InsertSubgroupId | 'camera')[] = ['change', 'emphasize', 'leave', 'camera'];

/**
 * Animate bar over the selection on the stage: only the animations the selected objects accept,
 * plus fitting the camera to them. Same actions and checks as the Insert rail's Animate group.
 */
export default function SelectionAnimateBar({
  anchor,
  containerWidth,
  containerHeight,
}: {
  /** Selection bounds in the canvas container's coordinates. */
  anchor: AnchorRect;
  containerWidth: number;
  containerHeight: number;
}) {
  const { run, stateFor, selectedItems } = useInsertActionState();
  const barRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const usable = (def: InsertActionDef) => {
    const st = stateFor(def);
    return st.active && !st.disabled;
  };
  const sections = SECTIONS.map((section) =>
    INSERT_ACTIONS.filter((def) =>
      section === 'camera'
        ? def.id === 'fitObject' && usable(def)
        : def.subgroup === section && usable(def),
    ),
  ).filter((defs) => defs.length > 0);

  const count = sections.reduce((n, s) => n + s.length, 0);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const next = placeAboveAnchor(
      anchor,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: containerWidth, height: containerHeight },
    );
    setPos((p) => (p && p.left === next.left && p.top === next.top ? p : next));
  }, [anchor, containerWidth, containerHeight, count]);

  if (!count) return null;

  const target =
    selectedItems.length === 1
      ? truncLabel(itemClipDisplayName(selectedItems[0]!), 28)
      : `${selectedItems.length} objects`;

  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label={`Animate ${target}`}
      className="absolute z-10 flex items-center gap-0.5 rounded-pop border border-rule bg-panel p-0.5 shadow-lg"
      style={pos ?? { left: 0, top: 0, visibility: 'hidden' }}
    >
      <span className="px-1.5 text-meta text-chalk-faint">Animate</span>
      {sections.map((defs, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-rule" />}
          {defs.map((def) => (
            <button
              key={def.id}
              type="button"
              aria-label={def.id === 'fitObject' ? 'Fit camera to this' : def.label}
              title={stateFor(def).title}
              onClick={run[def.id]}
              className={cx(
                'flex size-8 items-center justify-center rounded-ctl text-chalk-dim transition-colors hover:bg-raised hover:text-chalk [&_svg]:size-[18px]',
                focusRing,
              )}
            >
              <InsertActionIcon id={def.id} />
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
