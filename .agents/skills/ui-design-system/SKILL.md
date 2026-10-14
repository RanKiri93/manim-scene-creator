---
name: ui-design-system
description: The Chalkboard visual system for the manim-timeline editor (colors, type, surfaces, focus, layout targets) and how to migrate legacy slate/blue Tailwind classes to it. Load before adding or restyling any UI in src/panels, src/timeline, src/components, src/agent/AgentPanel.tsx, App.tsx, or canvas chrome, and when reviewing such a diff.
---

# UI design system: Chalkboard

Warm graphite panels around Manim's pure-black stage. Chalk-colored text, a Hebrew-capable serif
for titles, one accent (Manim's yellow) and one color per item kind taken from Manim's own
constants. Tokens live in the `@theme` block of `manim-timeline/src/index.css`; the same values
are exported for Konva/SVG from `src/lib/theme.ts`. `src/lib/theme.test.ts` fails if the two
drift or if a text token drops below 4.5:1 contrast.

## Colors

| Token (Tailwind utility suffix) | Use for |
|---|---|
| `ink` | App ground, gaps between panels, segmented-control track |
| `panel` | Side panels, header, timeline, inspector |
| `raised` | Inputs, selects, hovered rows, selected row, active segment |
| `rule` | Every border and hairline (`border-rule`) |
| `chalk` | Primary text, values in fields |
| `chalk-dim` | Field labels, inactive tabs, secondary text |
| `chalk-faint` | Times, units, hints, disabled text. Smallest text only in this or brighter |
| `stage` | The Manim frame background only. Never tint it |
| `highlight` / `highlight-ink` | Selection ring, active-tab underline, playhead, scrubber fill, the single primary button per view (`bg-highlight text-highlight-ink`), focus ring |
| `danger` | Delete actions and error text |
| `warn` | Attention without error: the unsaved dot, preview-only modes (free view, fit preview), missing references |
| `kind-text`, `kind-axes`, `kind-graph`, `kind-shape`, `kind-camera`, `kind-audio`, `kind-image`, `kind-effect` | Identifying an item kind: list swatch, lane header swatch, timeline clip fill. Get the color with `itemKindColor(item.kind)` from `@/lib/theme`, never by hand |

Rules:
- `highlight` is the only accent. Do not introduce blue, emerald, fuchsia or indigo for state.
  Save is a `line` button; Export is the primary.
- Kind colors carry meaning (which kind of object) and nothing else. Do not use them for buttons.
- Unsaved state is a 7px `warn` dot next to the project name, with a `title`.
- New code never uses `slate-*`, `gray-*`, `blue-*`, raw hex in `className`, or `bg-black`.
  Konva and inline SVG use `THEME` / `KIND_COLORS` from `@/lib/theme`.

## Type

- `font-sans` (IBM Plex Sans + Plex Sans Hebrew) is the default for everything. Already set on
  `body`; do not set it again.
- `font-display` (Frank Ruhl Libre 500) for panel titles (`text-title`), the inspector item
  title (`text-section`) and empty-state headings. Not for labels, buttons or values.
- `font-mono` (Plex Mono) only for LaTeX source and math-expression fields. Pure math and
  expression fields (plot `fn`, Python/JS expressions, class names) are `dir="ltr"`; the Text line
  LaTeX source, which is Hebrew with `$math$` segments, is `dir="auto"`. Times and numbers use `tabular-nums` in the sans, never mono.
- Sizes: `text-meta` 11px (times, hints, clip labels), `text-ctl` 12px (controls, labels),
  `text-body` 13px (lists, Copilot messages), `text-title` 16px, `text-section` 21px.
  Nothing below 11px. No `text-[10px]` or `text-[11px]`.
- Sentence case everywhere. No `uppercase tracking-wide` section labels; a section label is
  `text-meta text-chalk-faint`.
- Use the real ellipsis character "…" in labels and placeholders.

## Surfaces and shape

- Controls: `rounded-ctl` (3px). Popovers, dialogs, segmented tracks: `rounded-pop` (6px).
  Nothing larger.
- Borders: `border-rule`, 1px. Prefer a surface step (`panel` → `raised`) over a border when
  either would do.
- Shadows only on the stage and on floating popovers or dialogs.
- Selected row: `bg-raised` plus an inset ring of `highlight` at about 45% opacity. Selected
  clip: 2px `highlight` ring with a `panel`-colored gap.

## Controls: use `@/components/ui`

Never hand-roll a button, input, select, tab row or section header in a migrated component.
Import from `@/components/ui` (all named exports). To see every primitive live, run
`npm run dev` and open http://localhost:5173/#ui-gallery (dev only; reload after changing the
hash). Source of the gallery: `src/components/ui/UiGallery.tsx`; add new primitives to it.

| Primitive | Use |
|---|---|
| `Button` | `variant`: `primary` (one per view), `line` (default, secondary), `ghost` (toolbars), `link` (inline). `danger` for destructive. `pressed` for toggles. `size`: `md` (28px) or `sm` (24px, dense rows). `icon` for a leading 16px svg. Defaults to `type="button"`. |
| `IconButton` | Icon-only. `label` is required and becomes `aria-label` and the tooltip. `pressed` makes it a toggle. |
| `Field` | Label + one control + optional `hint` or `error`. Wires `id`, `aria-describedby` and `aria-invalid` into a ui control inside it. `layout="inline"` for short numeric rows. Errors say what is wrong and how to fix it. |
| `TextInput` | Text; `dir="auto"` by default for Hebrew. `unit` draws a suffix inside the field. `code` for identifiers (monospace, LTR, no spellcheck). |
| `NumberInput` | Commits on blur or Enter (one undo step per edit), Escape cancels, clamps to `min`/`max`, `unit` suffix, tabular figures. Replaces the legacy default export `components/NumberInput.tsx`; do not use that one in migrated code. |
| `Select` | Native `<select>` with the Chalkboard surface and chevron. |
| `TextArea` | `code` for pure math and expressions: monospace, always `dir="ltr"`, no spellcheck. Not for Hebrew-plus-math text, which needs `dir="auto"`. |
| `Checkbox` | Checkbox with its label as one hit target; `onChange` receives a boolean. |
| `Tabs` + `TabPanel` | Underlined tabs with arrow-key navigation. Share one `useId()` as `idBase`. Replaces `panels/PropertyTabs.tsx` as editors migrate. |
| `Segmented` | Two to four exclusive views ("By time / By object", "Properties / Copilot"). Needs `aria-label`. |
| `PanelTitle`, `ItemTitle` | Serif titles for panels (16px) and the selected item in the inspector (21px). |
| `SectionLabel` | Sentence-case group label; replaces every `uppercase tracking-wide` header. |
| `KindSwatch` | Kind color square: `kind={item.kind}` or `group="audio"`. |
| Icons | `UndoIcon`, `RedoIcon`, `DuplicateIcon`, `CloseIcon`, `PlusIcon`, `PencilIcon`, `ChevronRightIcon`, `GridIcon` from `@/components/ui`. Add new ones to `icons.tsx` in the same 16px stroke style. |

`className` on a primitive is for layout only (margin, width, grid placement). There is no
class merging, so do not pass colors or sizes through it; add a prop to the primitive instead.

Legacy shared controls still in the old style: `components/NumberInput.tsx`, `ColorPicker.tsx`,
`DirectionPicker.tsx`, `FloatingPanel.tsx`, `SceneTabsBar.tsx` and `panels/PropertyTabs.tsx`.
They appear in many panels at once, so each is replaced in the same batch as the panels that use
it (for the inspector: `PropertyPanel` and every `*Editor.tsx` together), then deleted.

## Focus and accessibility

- Every interactive element shows `focus-visible:outline-2 focus-visible:outline-highlight
  focus-visible:outline-offset-1`. Never add `focus:outline-none` without that replacement.
- Icon-only buttons get `aria-label` (a `title` alone is not enough).
- Clickable rows and clips are `<button>`s, or carry `role`, `tabIndex={0}` and an Enter/Space
  handler.
- Hebrew text inputs and labels: `dir="auto"`, including the Hebrew-plus-math LaTeX source of a
  text line. Pure math and expression fields: `dir="ltr"`.

## Layout targets

Migration toward these is in progress; do not regress them once a panel has moved.

- Header: one row containing the wordmark, the project name with the unsaved dot, scene tabs,
  undo/redo, Open, Save, and Export as the primary. The Manim class name lives in Export.
- Insert: a 52px icon rail (the default) between the item list and the stage, grouped
  Objects / Graph / Animations / Audio with hairline dividers. Labels appear on hover and focus
  in a fixed layer (`RailTipLayer` in `AddObjectToolbar.tsx`) so the scrolling rail cannot clip
  them. The labelled, resizable sidebar remains available from the chevron.
- Inspector: docked on the right. Properties and Copilot are two segments of the same dock.
- Timeline: tracks are layers (L0, L1, ...), which drive stacking and export order, so they
  are not regrouped by kind. Clips are solid kind colors (`kindBg[ITEM_COLOR_GROUP[kind]]`)
  with `text-meta font-medium text-highlight-ink` labels; overlays on clips (waits, stripes,
  errors, previews) darken with `ink/…` so they read on light and dark kinds alike. The
  playhead and scrubber progress are the only yellow lines.

## Migration status

Done: app shell and header (`App.tsx` header, timeline resize bar, left aside, insert
column), `SceneTabsBar` (inside the header), `ItemList`, `FramesPanel`, the canvas toolbar
and stage frame in `SceneCanvas.tsx`, the insert rail (`AddObjectToolbar.tsx`), the timeline
(`Timeline.tsx`, `PlaybackControls.tsx`, `TimelineTrack.tsx`, `TimelineClip.tsx`,
`AudioClip.tsx`, `BedClip.tsx`, `Playhead.tsx`, `BoundaryLabel.tsx`), the global
scrollbar, range, scrubber and focus-ring styles in `index.css`, and the inspector: the
docked `PropertyPanel` (340px, right of the stage), every editor in `panels/`,
`PropertyTabs` (now an adapter over `Tabs`), `NumberInput` (adapter over the ui primitive),
`ColorPicker` and `DirectionPicker`.

The editors were converted with a token codemod, so many still hand-roll inputs with token
classes (`bg-raised border border-rule rounded-ctl …`). That is acceptable; when you next edit
one of those controls for another reason, replace it with the matching ui primitive.

Also done: the floating-panel frame (`FloatingPanel`), `ExportPanel` (now holds the Manim class
field), `AudioPanel`, `BackgroundBedPopup`, `AudioClipEditPopup`, `TimelineSurgeryDialog`,
`ErrorBoundary`, and `AgentPanel`, which now lives in the dock as the "Copilot" half of the
Properties / Copilot switch (driven by the store's `agentOpen`). Dialog main actions are the
yellow primary; mode toggles mark the active option with a `highlight/50` inset ring.

Also done: Konva editor chrome (selection and locked outlines, transformer handles, grid, frame
outlines, snap guides, region capture, placeholders, the axes grip) via `CANVAS_CHROME` in
`src/lib/theme.ts`. Colors that preview Manim output stay literal (item colors, default shape
and curve strokes, field colormaps, reveal-head rims, projection guides).

The migration is complete. New UI starts from `@/components/ui` and these tokens; new canvas
chrome takes its colors from `CANVAS_CHROME`.

Before starting a batch, check `git status` on its files: do not restyle a file with someone
else's uncommitted work in it.

## Migrating legacy classes

When you touch a component, migrate the whole component, not single lines, so that one panel
never mixes the two systems.

| Legacy | Chalkboard |
|---|---|
| `bg-slate-950`, `bg-slate-900` | `bg-ink` |
| `bg-slate-800`, `bg-slate-850`, `bg-slate-800/40` | `bg-panel` |
| `bg-slate-700`, `bg-slate-600`, `hover:bg-slate-700` | `bg-raised`, `hover:bg-raised` |
| `border-slate-500/600/700` | `border-rule` |
| `text-slate-100`, `text-slate-200` | `text-chalk` |
| `text-slate-300`, `text-slate-400` | `text-chalk-dim` |
| `text-slate-500`, `text-slate-600` | `text-chalk-faint` |
| `bg-blue-600` / `border-blue-500` used for selection | `highlight` ring or underline as above |
| `bg-blue-600` primary button | `bg-highlight text-highlight-ink` (only one per view) |
| `bg-emerald-*` Save, `bg-fuchsia-*` AI | line button; Copilot moves into the dock |
| `text-red-300/400` | `text-danger` |
| `text-[10px]`, `text-[11px]` | `text-meta` |
| `text-xs` | `text-ctl` |
| `font-mono` on times or numbers | `tabular-nums` |
| `uppercase tracking-wide` labels | sentence case, `text-meta text-chalk-faint` |

## Verifying a UI change

1. Gates from skill `verify-frontend` (`npm run build`, `npm run test`, `npm run lint`).
2. `rg -n "slate-|blue-[0-9]|text-\[1[01]px\]|uppercase" <touched files>` returns nothing.
3. Look at it running (`npm run dev`, http://localhost:5173/) with at least one text line,
   axes and a plot on the stage, and the inspector open.
