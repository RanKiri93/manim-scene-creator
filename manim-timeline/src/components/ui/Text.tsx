import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { ITEM_COLOR_GROUP, type KindColorGroup } from '@/lib/theme';
import type { SceneItem } from '@/types/scene';
import { kindBg } from './styles';

interface TitleProps {
  children: ReactNode;
  as?: 'h2' | 'h3' | 'h4';
  className?: string;
}

/** Serif title for a panel or dock section ("Items", "Frames", "Properties"). */
export function PanelTitle({ children, as: Tag = 'h2', className }: TitleProps) {
  return (
    <Tag className={cx('m-0 font-display text-title font-medium text-chalk', className)}>{children}</Tag>
  );
}

/** Larger serif title for the selected item in the inspector ("Text line", "Graph plot"). */
export function ItemTitle({ children, as: Tag = 'h3', className }: TitleProps) {
  return (
    <Tag className={cx('m-0 flex items-center gap-2 font-display text-section font-medium text-chalk', className)}>
      {children}
    </Tag>
  );
}

/** Small sentence-case group label. Replaces the `uppercase tracking-wide text-[10px]` headers. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('text-meta text-chalk-faint', className)}>{children}</div>;
}

type KindSwatchProps = ({ kind: SceneItem['kind']; group?: never } | { group: KindColorGroup; kind?: never }) & {
  size?: 'sm' | 'md';
  className?: string;
};

/** The square that ties an item to its kind color in lists, lane headers and the inspector. */
export function KindSwatch({ kind, group, size = 'md', className }: KindSwatchProps) {
  const g = group ?? ITEM_COLOR_GROUP[kind!];
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-block shrink-0 rounded-[2px]',
        size === 'sm' ? 'size-2' : 'size-2.5',
        kindBg[g],
        className,
      )}
    />
  );
}
