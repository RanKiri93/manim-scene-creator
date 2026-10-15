import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { cx } from '@/lib/cx';
import {
  Button,
  ChevronRightIcon,
  IconButton,
  KindSwatch,
  PanelTitle,
  SectionLabel,
  focusRing,
} from '@/components/ui';
import {
  INSERT_GROUPS,
  INSERT_SUBGROUP_LABELS,
  insertActionsInGroup,
  type InsertActionDef,
  type InsertActionId,
  type InsertGroupDef,
  type InsertGroupId,
  type InsertSubgroupId,
} from './insertActions';
import { InsertActionIcon, InsertGroupIcon, InsertSearchIcon } from './insertIcons';
import InsertSearch from './InsertSearch';
import { isInsertSearchShortcut, isTypingTarget } from './insertSearchKeys';
import { useInsertActionState } from './useInsertActionState';

type FlyoutGroupId = Exclude<InsertGroupId, 'create'>;

/** Rail sections, separated by hairlines. Create actions sit on the rail; the rest open flyouts. */
const RAIL_SECTIONS: readonly (readonly InsertGroupId[])[] = [
  ['create'],
  ['graph'],
  ['animate', 'camera'],
  ['audio'],
];

const SUBGROUP_ORDER: readonly InsertSubgroupId[] = ['change', 'emphasize', 'leave'];

const groupDef = (id: InsertGroupId): InsertGroupDef => INSERT_GROUPS.find((g) => g.id === id)!;

type RailTip = { label: string; detail?: string; top: number; left: number } | null;

/** Collapsed-rail labels render in a fixed layer so the scrolling rail cannot clip them. */
const RailTipContext = createContext<(tip: RailTip) => void>(() => {});

function RailTipLayer({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [tip, setTip] = useState<RailTip>(null);
  return (
    <RailTipContext.Provider value={setTip}>
      {/* A scrolled rail would leave the label floating beside the wrong icon. */}
      <div className="contents" onScrollCapture={() => setTip(null)}>
        {children}
      </div>
      {enabled && tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-64 -translate-y-1/2 rounded-ctl bg-chalk px-2 py-1 text-ctl text-ink shadow-lg"
          style={{ top: tip.top, left: tip.left }}
        >
          <div className="font-medium">{tip.label}</div>
          {tip.detail && <div className="text-meta text-ink/70">{tip.detail}</div>}
        </div>
      )}
    </RailTipContext.Provider>
  );
}

function ToolButton({
  title,
  onClick,
  children,
  label,
  collapsed,
  active,
  dimmed,
  disabled,
  buttonRef,
  flyoutId,
  open,
}: {
  /** Longer description: native tooltip when expanded, second line of the rail label when collapsed. */
  title: string;
  onClick: () => void;
  children: ReactNode;
  label?: string;
  collapsed: boolean;
  /** The current selection can use this action. */
  active?: boolean;
  dimmed?: boolean;
  /** Kept focusable and hoverable (aria-disabled) so the reason in `title` stays readable. */
  disabled?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  /** Set on a rail button that opens a flyout: the flyout's element id. */
  flyoutId?: string;
  /** That flyout is showing. */
  open?: boolean;
}) {
  const setTip = useContext(RailTipContext);
  const name = label ?? title;
  const detail = title !== name ? title : undefined;
  const showTip = (e: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>) => {
    // The open flyout already names everything; a label on top of it would cover the tiles.
    if (open) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label: name, detail, top: r.top + r.height / 2, left: r.right + 8 });
  };
  const hideTip = () => setTip(null);

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={name}
      aria-disabled={disabled || undefined}
      aria-expanded={flyoutId ? !!open : undefined}
      aria-controls={flyoutId && open ? flyoutId : undefined}
      title={collapsed ? undefined : title}
      onClick={() => {
        hideTip();
        if (!disabled) onClick();
      }}
      onMouseEnter={collapsed ? showTip : undefined}
      onFocus={collapsed ? showTip : undefined}
      onMouseLeave={collapsed ? hideTip : undefined}
      onBlur={collapsed ? hideTip : undefined}
      className={cx(
        'relative flex shrink-0 items-center rounded-ctl transition-colors [&_svg]:size-[18px]',
        collapsed ? 'size-9 justify-center' : 'h-8 w-full gap-2.5 px-2 text-ctl',
        open
          ? 'bg-raised text-chalk ring-1 ring-highlight/45 ring-inset'
          : active
            ? 'text-chalk ring-1 ring-highlight/40 ring-inset'
            : 'text-chalk-dim',
        disabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-raised hover:text-chalk',
        dimmed && !active && !disabled && 'opacity-45',
        focusRing,
      )}
    >
      <span className="flex shrink-0 items-center justify-center">{children}</span>
      {!collapsed && label != null && (
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      )}
      {flyoutId && (
        <span
          aria-hidden="true"
          className="absolute right-[3px] bottom-[3px] size-0 border-[3px] border-transparent border-r-chalk-faint border-b-chalk-faint"
        />
      )}
    </button>
  );
}

/** Group heading when expanded; a hairline divider in the icon rail. */
function CategoryLabel({
  children,
  collapsed,
}: {
  children: ReactNode;
  collapsed: boolean;
}) {
  if (collapsed) {
    return <hr aria-hidden="true" className="mx-auto my-2 w-6 border-0 border-t border-rule first:hidden" />;
  }
  return <SectionLabel className="mt-3 mb-1 px-1 first:mt-0">{children}</SectionLabel>;
}

const SEARCH_TITLE = 'Find any insert action by name. Shortcut: /';

function InsertSidebarHeader({
  collapsed,
  onToggleCollapsed,
  onSearch,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSearch: () => void;
}) {
  return (
    <div
      className={cx(
        'flex shrink-0 items-center pb-1',
        collapsed ? 'justify-center' : 'justify-between pl-1',
      )}
    >
      {!collapsed && <PanelTitle className="mr-auto">Insert</PanelTitle>}
      {!collapsed && (
        <IconButton label="Search insert actions" title={SEARCH_TITLE} onClick={onSearch}>
          <InsertSearchIcon />
        </IconButton>
      )}
      <IconButton
        label={collapsed ? 'Show insert labels' : 'Collapse insert to icons'}
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
      >
        <span className={cx('inline-flex [&>svg]:size-4', !collapsed && 'rotate-180')}>
          <ChevronRightIcon />
        </span>
      </IconButton>
    </div>
  );
}

/**
 * Insert surface. Collapsed (default): a short icon rail; Text, Shape and Image insert directly
 * and Graph, Animate, Camera and Audio open a labelled flyout beside the rail. Expanded: every
 * action listed with labels, in the same groups.
 */
export default function AddObjectToolbar({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { run, stateFor, groupHints, hasAnyAnimationTarget } = useInsertActionState();

  // ---- Flyout (collapsed rail only) ----
  const [openGroup, setOpenGroup] = useState<FlyoutGroupId | null>(null);
  const [pinned, setPinned] = useState(false);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRefs = useRef<Partial<Record<FlyoutGroupId, HTMLButtonElement | null>>>({});
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const focusFirstTile = useRef(false);
  const flyoutId = useId();
  const activeGroup = collapsed ? openGroup : null;

  const closeFlyout = useCallback(
    (refocusTrigger: boolean) => {
      const g = openGroup;
      setOpenGroup(null);
      setPinned(false);
      setFlyoutPos(null);
      if (refocusTrigger && g) triggerRefs.current[g]?.focus({ preventScroll: true });
    },
    [openGroup],
  );

  const toggleGroup = (id: FlyoutGroupId) => {
    if (activeGroup === id) {
      closeFlyout(false);
      return;
    }
    focusFirstTile.current = true;
    setFlyoutPos(null);
    setOpenGroup(id);
  };

  const placeFlyout = useCallback(() => {
    if (!activeGroup) return;
    const trigger = triggerRefs.current[activeGroup];
    const panel = flyoutRef.current;
    if (!trigger || !panel) return;
    const r = trigger.getBoundingClientRect();
    const top = Math.max(8, Math.min(r.top - 8, window.innerHeight - panel.offsetHeight - 8));
    setFlyoutPos({ top, left: r.right + 6 });
  }, [activeGroup]);

  // Measure before paint so the flyout never flashes at the wrong place.
  useLayoutEffect(() => {
    placeFlyout();
  }, [placeFlyout]);

  useEffect(() => {
    if (!activeGroup) return;
    window.addEventListener('resize', placeFlyout);
    return () => window.removeEventListener('resize', placeFlyout);
  }, [activeGroup, placeFlyout]);

  useEffect(() => {
    if (!activeGroup || !flyoutPos || !focusFirstTile.current) return;
    focusFirstTile.current = false;
    flyoutRef.current
      ?.querySelector<HTMLButtonElement>('[data-insert-tiles] button:not([aria-disabled="true"])')
      ?.focus({ preventScroll: true });
  }, [activeGroup, flyoutPos]);

  const isInsideFlyoutOrTrigger = useCallback((node: Node | null) => {
    if (!node) return false;
    if (flyoutRef.current?.contains(node)) return true;
    return Object.values(triggerRefs.current).some((b) => b?.contains(node));
  }, []);

  // An unpinned flyout closes on any press outside it (the canvas, the timeline, another panel).
  useEffect(() => {
    if (!activeGroup || pinned) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!isInsideFlyoutOrTrigger(e.target as Node)) closeFlyout(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [activeGroup, pinned, closeFlyout, isInsideFlyoutOrTrigger]);

  const onFlyoutKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !activeGroup) return;
    e.stopPropagation();
    closeFlyout(true);
  };

  const onFlyoutBlur = (e: FocusEvent<HTMLDivElement>) => {
    // relatedTarget is null when focus leaves the page (file picker) or lands on nothing; the
    // pointerdown listener covers clicks, so only close when focus moves to another control.
    const next = e.relatedTarget as Node | null;
    if (pinned || !next || isInsideFlyoutOrTrigger(next)) return;
    closeFlyout(false);
  };

  const runFromFlyout = (id: InsertActionId) => {
    run[id]();
    if (!pinned) closeFlyout(true);
  };

  // ---- Search ("/" anywhere outside a text field, or the rail button) ----
  const [searchOpen, setSearchOpen] = useState(false);
  const focusBeforeSearch = useRef<HTMLElement | null>(null);
  const openSearch = useCallback(() => {
    focusBeforeSearch.current = document.activeElement as HTMLElement | null;
    setOpenGroup(null);
    setPinned(false);
    setSearchOpen(true);
  }, []);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    const prev = focusBeforeSearch.current;
    if (prev?.isConnected) prev.focus({ preventScroll: true });
  }, []);
  const runFromSearch = (id: InsertActionId) => {
    closeSearch();
    run[id]();
  };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || !isInsertSearchShortcut(e)) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      openSearch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSearch]);

  const renderAction = (def: InsertActionDef, inFlyout: boolean) => {
    const st = stateFor(def);
    return (
      <ToolButton
        key={def.id}
        collapsed={collapsed && !inFlyout}
        label={def.label}
        title={st.title}
        onClick={inFlyout ? () => runFromFlyout(def.id) : run[def.id]}
        active={st.active}
        dimmed={st.dimmed}
        disabled={st.disabled}
      >
        <InsertActionIcon id={def.id} />
      </ToolButton>
    );
  };

  /** Actions of a group; Animate is split into Change / Emphasize / Leave. */
  const renderGroupBody = (group: InsertGroupId, inFlyout: boolean) => {
    const defs = insertActionsInGroup(group);
    const listClass = inFlyout ? 'grid grid-cols-2 gap-0.5' : 'flex flex-col gap-0.5';
    if (group !== 'animate') return <div className={listClass}>{defs.map((d) => renderAction(d, inFlyout))}</div>;
    return SUBGROUP_ORDER.map((sub) => (
      <div key={sub}>
        <SectionLabel className="mt-2 mb-0.5 px-1">{INSERT_SUBGROUP_LABELS[sub]}</SectionLabel>
        <div className={listClass}>
          {defs.filter((d) => d.subgroup === sub).map((d) => renderAction(d, inFlyout))}
        </div>
      </div>
    ));
  };

  const groupColumnClass = collapsed
    ? 'flex flex-col items-center gap-0.5'
    : 'flex flex-col gap-0.5';

  const renderRail = () => [
    <div key="search" className={groupColumnClass}>
      <ToolButton collapsed label="Search" title={SEARCH_TITLE} onClick={openSearch} open={searchOpen}>
        <InsertSearchIcon />
      </ToolButton>
    </div>,
    ...RAIL_SECTIONS.map((section, i) => (
      <Fragment key={i}>
        <CategoryLabel collapsed>{null}</CategoryLabel>
        <div className={groupColumnClass}>
          {section.flatMap((groupId) => {
            if (groupId === 'create') {
              return insertActionsInGroup('create').map((d) => renderAction(d, false));
            }
            const g = groupDef(groupId);
            return [
              <ToolButton
                key={groupId}
                buttonRef={(el) => {
                  triggerRefs.current[groupId] = el;
                }}
                collapsed
                label={g.label}
                title={g.summary}
                onClick={() => toggleGroup(groupId)}
                active={groupId === 'animate' && hasAnyAnimationTarget}
                flyoutId={flyoutId}
                open={activeGroup === groupId}
              >
                <InsertGroupIcon id={groupId} />
              </ToolButton>,
            ];
          })}
        </div>
      </Fragment>
    )),
  ];

  const renderSidebar = () =>
    INSERT_GROUPS.map((g) => {
      const body = (
        <>
          <CategoryLabel collapsed={false}>
            <span className={g.id === 'animate' && hasAnyAnimationTarget ? 'text-chalk' : undefined}>
              {g.label}
            </span>
          </CategoryLabel>
          {renderGroupBody(g.id, false)}
          {groupHints[g.id] && (
            <p className="m-0 mt-1 px-1 text-meta text-chalk-faint">{groupHints[g.id]}</p>
          )}
        </>
      );
      if (g.id !== 'animate') return <Fragment key={g.id}>{body}</Fragment>;
      return (
        <div
          key={g.id}
          className={cx(
            'mt-3',
            hasAnyAnimationTarget && 'rounded-pop bg-highlight/5 px-1 pt-1 pb-2 ring-1 ring-highlight/25 ring-inset',
          )}
        >
          {body}
        </div>
      );
    });

  const openDef = activeGroup ? groupDef(activeGroup) : null;

  return (
    <RailTipLayer enabled={collapsed}>
      <div
        className={cx(
          'flex min-h-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-auto py-2',
          collapsed ? 'px-1' : 'px-2',
        )}
        role="toolbar"
        aria-orientation="vertical"
        aria-label="Insert objects, animations, camera moves and audio"
        onKeyDown={onFlyoutKeyDown}
        onScroll={placeFlyout}
      >
        <InsertSidebarHeader
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          onSearch={openSearch}
        />
        {collapsed ? renderRail() : renderSidebar()}
      </div>

      {openDef && activeGroup && (
        <div
          ref={flyoutRef}
          id={flyoutId}
          role="group"
          aria-label={`${openDef.label} actions`}
          onKeyDown={onFlyoutKeyDown}
          onBlur={onFlyoutBlur}
          className="fixed z-40 flex w-[312px] flex-col gap-1.5 rounded-pop border border-rule bg-panel p-2.5 shadow-lg"
          style={flyoutPos ?? { top: 0, left: 0, visibility: 'hidden' }}
        >
          <div className="flex items-start justify-between gap-2 px-1">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <KindSwatch group={openDef.kindGroup} />
                <PanelTitle as="h3">{openDef.label}</PanelTitle>
              </div>
              {groupHints[activeGroup] && (
                <p className="m-0 mt-0.5 text-meta text-chalk-faint">{groupHints[activeGroup]}</p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              pressed={pinned}
              title="Keep this panel open after inserting"
              onClick={() => setPinned((p) => !p)}
            >
              {pinned ? 'Pinned' : 'Pin'}
            </Button>
          </div>
          <div data-insert-tiles>{renderGroupBody(activeGroup, true)}</div>
        </div>
      )}
      {searchOpen && <InsertSearch onClose={closeSearch} onRun={runFromSearch} stateFor={stateFor} />}
    </RailTipLayer>
  );
}
