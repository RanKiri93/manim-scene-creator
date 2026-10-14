import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Button,
  Checkbox,
  Field,
  IconButton,
  KindSwatch,
  NumberInput,
  Segmented,
  Select,
  TabPanel,
  Tabs,
  TextArea,
  TextInput,
} from './index';

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => {};

describe('Button', () => {
  it('defaults to type="button" so it never submits a form', () => {
    expect(html(<Button>Save</Button>)).toContain('type="button"');
  });

  it('primary uses the highlight accent', () => {
    expect(html(<Button variant="primary">Export video</Button>)).toContain('bg-highlight');
  });

  it('uses no legacy slate or blue classes', () => {
    const out = ['primary', 'line', 'ghost', 'link'].map((v) =>
      html(<Button variant={v as 'line'}>x</Button>),
    );
    expect(out.join('')).not.toMatch(/slate-|blue-\d/);
  });
});

describe('IconButton', () => {
  it('always has an accessible name and tooltip', () => {
    const out = html(
      <IconButton label="Delete item">
        <svg />
      </IconButton>,
    );
    expect(out).toContain('aria-label="Delete item"');
    expect(out).toContain('title="Delete item"');
  });

  it('exposes toggle state only when pressed is set', () => {
    expect(html(<IconButton label="Grid" pressed>i</IconButton>)).toContain('aria-pressed="true"');
    expect(html(<IconButton label="Grid">i</IconButton>)).not.toContain('aria-pressed');
  });
});

describe('Field', () => {
  it('links its label and hint to the control inside', () => {
    const out = html(
      <Field label="Clip name" hint="Shown in exit menus.">
        <TextInput value="" onChange={noop} />
      </Field>,
    );
    const id = out.match(/<label for="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(out).toMatch(new RegExp(`<input [^>]*id="${id}"`));
    expect(out).toContain('dir="auto"');
    const noteId = out.match(/<p id="([^"]+)"/)?.[1];
    expect(out).toContain(`aria-describedby="${noteId}"`);
  });

  it('marks the control invalid and shows the error instead of the hint', () => {
    const out = html(
      <Field label="Duration" hint="Seconds." error="Enter a duration above 0.">
        <NumberInput value={0} onChange={noop} />
      </Field>,
    );
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('Enter a duration above 0.');
    expect(out).not.toContain('Seconds.');
  });
});

describe('inputs', () => {
  it('NumberInput shows the value with tabular figures and a unit', () => {
    const out = html(<NumberInput value={3} onChange={noop} unit="s" />);
    expect(out).toContain('value="3"');
    expect(out).toContain('tabular-nums');
    expect(out).toContain('>s</span>');
  });

  it('TextArea in code mode is always left-to-right monospace, even if dir is passed', () => {
    const out = html(<TextArea code dir="rtl" value="$x$" onChange={noop} />);
    expect(out).toContain('dir="ltr"');
    expect(out).toMatch(/spellcheck="false"/i);
    expect(out).toContain('font-mono');
  });

  it('TextInput in code mode is left-to-right monospace without spellcheck', () => {
    const out = html(<TextInput code dir="rtl" value="Scene1" onChange={noop} />);
    expect(out).toContain('dir="ltr"');
    expect(out).toMatch(/spellcheck="false"/i);
    expect(out).toContain('font-mono');
  });

  it('Button pressed state is exposed and styled', () => {
    const out = html(<Button variant="ghost" pressed>Copilot</Button>);
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('bg-raised');
  });

  it('Select keeps native options', () => {
    const out = html(
      <Select value="a" onChange={noop}>
        <option value="a">Alef</option>
      </Select>,
    );
    expect(out).toContain('<option value="a" selected="">Alef</option>');
  });

  it('Checkbox wraps its label so the whole row is clickable', () => {
    const out = html(<Checkbox checked onChange={noop}>Snap text</Checkbox>);
    expect(out).toMatch(/^<label[^>]*><input type="checkbox"[^>]* checked=""/);
    expect(out).toContain('Snap text</label>');
  });
});

describe('Tabs and Segmented', () => {
  const items = [
    { id: 'text', label: 'Text' },
    { id: 'timing', label: 'Timing' },
  ] as const;

  it('Tabs uses roving tabindex and wires panels', () => {
    const out = html(
      <>
        <Tabs idBase="t" items={items} value="timing" onChange={noop} />
        <TabPanel idBase="t" id="timing" active>
          body
        </TabPanel>
      </>,
    );
    expect(out).toContain('id="t-tab-text" type="button" role="tab" aria-selected="false" aria-controls="t-panel-text" tabindex="-1"');
    expect(out).toContain('id="t-tab-timing" type="button" role="tab" aria-selected="true" aria-controls="t-panel-timing" tabindex="0"');
    expect(out).toContain('id="t-panel-timing" role="tabpanel" aria-labelledby="t-tab-timing"');
  });

  it('inactive TabPanel renders nothing inside', () => {
    expect(html(<TabPanel idBase="t" id="x" active={false}>body</TabPanel>)).not.toContain('body');
  });

  it('Segmented marks exactly one option pressed', () => {
    const out = html(
      <Segmented
        aria-label="Item order"
        options={[
          { value: 'time', label: 'By time' },
          { value: 'object', label: 'By object' },
        ]}
        value="object"
        onChange={noop}
      />,
    );
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(out).toContain('aria-label="Item order"');
  });
});

describe('KindSwatch', () => {
  it('maps item kinds to their Manim color group', () => {
    expect(html(<KindSwatch kind="graphArea" />)).toContain('bg-kind-graph');
    expect(html(<KindSwatch kind="camera_move" />)).toContain('bg-kind-camera');
    expect(html(<KindSwatch group="audio" />)).toContain('bg-kind-audio');
  });
});
