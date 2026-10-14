import { useId, useState } from 'react';
import type { SceneItem } from '@/types/scene';
import {
  Button,
  Checkbox,
  Field,
  IconButton,
  ItemTitle,
  KindSwatch,
  NumberInput,
  PanelTitle,
  Segmented,
  SectionLabel,
  Select,
  TabPanel,
  Tabs,
  TextArea,
  TextInput,
} from './index';
import { CloseIcon, DuplicateIcon, GridIcon, UndoIcon } from './icons';

/**
 * Dev-only reference sheet for the Chalkboard primitives, opened at `/#ui-gallery` while
 * `npm run dev` is running. Not part of production builds (see main.tsx).
 */

const KINDS: { kind: SceneItem['kind']; name: string }[] = [
  { kind: 'textLine', name: 'Text line' },
  { kind: 'axes', name: 'Axes' },
  { kind: 'graphPlot', name: 'Plot, curve, dot, area, field' },
  { kind: 'shape', name: 'Shape, surrounding rect' },
  { kind: 'camera_move', name: 'Camera move' },
  { kind: 'image', name: 'Image' },
  { kind: 'exit_animation', name: 'Exit, blink, target animation' },
];

type InspectorTab = 'text' | 'timing' | 'position';

export default function UiGallery() {
  const tabsId = useId();
  const [tab, setTab] = useState<InspectorTab>('text');
  const [order, setOrder] = useState<'time' | 'object'>('time');
  const [dock, setDock] = useState<'properties' | 'copilot'>('properties');
  const [name, setName] = useState('כותרת');
  const [src, setSrc] = useState('הנגזרת של $\\sin x$ היא $\\cos x$');
  const [size, setSize] = useState(36);
  const [start, setStart] = useState(0);
  const [duration, setDuration] = useState(3);
  const [visible, setVisible] = useState(false);
  const [grid, setGrid] = useState(true);
  const [snap, setSnap] = useState(true);

  return (
    <div className="min-h-full bg-ink px-6 py-8 font-sans text-body text-chalk">
      <div className="mx-auto grid max-w-5xl gap-10">
        <header className="grid gap-1">
          <h1 className="m-0 font-display text-[28px] leading-tight font-medium">Chalkboard components</h1>
          <p className="m-0 max-w-[62ch] text-chalk-dim">
            Shared controls from <code className="font-mono text-ctl">src/components/ui</code>. Panels move onto
            these one at a time; until then the editor still shows the old look.
          </p>
        </header>

        <div className="grid items-start gap-10 md:grid-cols-[320px_1fr]">
          {/* A realistic inspector built only from primitives */}
          <aside className="grid gap-4 rounded-pop border border-rule bg-panel p-4">
            <Segmented
              aria-label="Side panel"
              options={[
                { value: 'properties', label: 'Properties' },
                { value: 'copilot', label: 'Copilot' },
              ]}
              value={dock}
              onChange={setDock}
            />
            <div className="flex items-baseline justify-between">
              <ItemTitle>
                <KindSwatch kind="textLine" />
                Text line
              </ItemTitle>
              <span className="text-meta text-chalk-faint">Frame: Full view</span>
            </div>
            <Tabs
              idBase={tabsId}
              aria-label="Text line properties"
              items={[
                { id: 'text', label: 'Text' },
                { id: 'timing', label: 'Timing' },
                { id: 'position', label: 'Position' },
              ]}
              value={tab}
              onChange={setTab}
            />
            <TabPanel idBase={tabsId} id="text" active={tab === 'text'} className="grid gap-3.5">
              <Field label="Clip name" hint="Shown in exit and target menus.">
                <TextInput value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="LaTeX source">
                <TextArea code value={src} onChange={(e) => setSrc(e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Font">
                  <Select defaultValue="Alef">
                    <option>Alef</option>
                    <option>David Libre</option>
                  </Select>
                </Field>
                <Field label="Size">
                  <NumberInput value={size} onChange={setSize} min={4} step={1} unit="pt" />
                </Field>
              </div>
            </TabPanel>
            <TabPanel idBase={tabsId} id="timing" active={tab === 'timing'} className="grid gap-3.5">
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Starts at">
                  <NumberInput value={start} onChange={setStart} min={0} unit="s" />
                </Field>
                <Field
                  label="Writes for"
                  error={duration <= 0 ? 'Enter a duration above 0 s.' : undefined}
                >
                  <NumberInput value={duration} onChange={setDuration} unit="s" />
                </Field>
              </div>
              <Checkbox checked={visible} onChange={setVisible}>
                Already visible at scene start
              </Checkbox>
            </TabPanel>
            <TabPanel idBase={tabsId} id="position" active={tab === 'position'} className="grid gap-2">
              <Field label="X" layout="inline">
                <NumberInput value={0} onChange={() => {}} unit="u" />
              </Field>
              <Field label="Y" layout="inline">
                <NumberInput value={2.5} onChange={() => {}} unit="u" />
              </Field>
            </TabPanel>
            <div className="flex justify-between border-t border-rule pt-3">
              <Button variant="link" danger>
                Delete item
              </Button>
              <Button variant="line" size="sm" icon={<DuplicateIcon />}>
                Duplicate
              </Button>
            </div>
          </aside>

          <div className="grid gap-8">
            <section className="grid gap-3">
              <PanelTitle>Buttons</PanelTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary">Export video</Button>
                <Button>Save</Button>
                <Button variant="ghost">Open</Button>
                <Button variant="line" danger>
                  Remove scene
                </Button>
                <Button variant="link">Edit timing</Button>
                <Button disabled>Redo</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm">Add frame</Button>
                <Button size="sm" variant="ghost">
                  Use as active
                </Button>
                <IconButton label="Undo">
                  <UndoIcon />
                </IconButton>
                <IconButton label="Duplicate item" size="sm">
                  <DuplicateIcon />
                </IconButton>
                <IconButton label="Delete item" size="sm" danger>
                  <CloseIcon />
                </IconButton>
                <IconButton label="Show grid" pressed={grid} onClick={() => setGrid((g) => !g)}>
                  <GridIcon />
                </IconButton>
              </div>
            </section>

            <section className="grid gap-3">
              <PanelTitle>Views and toggles</PanelTitle>
              <Segmented
                className="max-w-60"
                aria-label="Item list order"
                options={[
                  { value: 'time', label: 'By time' },
                  { value: 'object', label: 'By object' },
                ]}
                value={order}
                onChange={setOrder}
              />
              <div className="flex flex-wrap gap-4">
                <Checkbox checked={grid} onChange={setGrid}>
                  Grid
                </Checkbox>
                <Checkbox checked={snap} onChange={setSnap}>
                  Snap text
                </Checkbox>
                <Checkbox checked={false} onChange={() => {}} disabled>
                  Board (needs a frame)
                </Checkbox>
              </div>
            </section>

            <section className="grid gap-3">
              <PanelTitle>Item kinds</PanelTitle>
              <SectionLabel>Each kind keeps one Manim color in the list, lanes and clips.</SectionLabel>
              <ul className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2">
                {KINDS.map((k) => (
                  <li key={k.kind} className="flex items-center gap-2.5">
                    <KindSwatch kind={k.kind} />
                    {k.name}
                  </li>
                ))}
                <li className="flex items-center gap-2.5">
                  <KindSwatch group="audio" />
                  Audio
                </li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
