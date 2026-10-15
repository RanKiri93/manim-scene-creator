import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AddObjectToolbar from './AddObjectToolbar';
import { INSERT_ACTIONS, INSERT_GROUPS, insertActionsInGroup, searchInsertActions } from './insertActions';
import { isInsertSearchShortcut, isTypingTarget } from './insertSearchKeys';
import { InsertActionIcon, InsertGroupIcon } from './insertIcons';

const noop = () => {};
const ariaLabels = (html: string) => [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);

describe('insert action list', () => {
  it('has unique ids and labels', () => {
    const ids = INSERT_ACTIONS.map((a) => a.id);
    const labels = INSERT_ACTIONS.map((a) => a.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('puts every action in a known group, and only Animate actions in a subgroup', () => {
    const groups = new Set(INSERT_GROUPS.map((g) => g.id));
    for (const a of INSERT_ACTIONS) {
      expect(groups.has(a.group)).toBe(true);
      expect(a.subgroup != null).toBe(a.group === 'animate');
    }
    for (const g of INSERT_GROUPS) expect(insertActionsInGroup(g.id).length).toBeGreaterThan(0);
  });

  it('only Create sits directly on the rail', () => {
    expect(INSERT_GROUPS.filter((g) => !g.flyout).map((g) => g.id)).toEqual(['create']);
  });
});

describe('insert icons', () => {
  it('draws every action and flyout group on the shared 20px, 1.5px-stroke grid', () => {
    for (const a of INSERT_ACTIONS) {
      const html = renderToStaticMarkup(<InsertActionIcon id={a.id} />);
      expect(html, a.id).toContain('viewBox="0 0 20 20"');
      expect(html, a.id).toContain('stroke-width="1.5"');
      expect(html, a.id).toMatch(/<(path|rect|circle)/);
    }
    for (const g of INSERT_GROUPS) {
      if (g.id === 'create') continue;
      expect(renderToStaticMarkup(<InsertGroupIcon id={g.id} />)).toMatch(/<(path|rect|circle)/);
    }
  });
});

describe('AddObjectToolbar', () => {
  it('collapsed rail: Create actions inline, other groups as flyout buttons, no scroll-length list', () => {
    const html = renderToStaticMarkup(<AddObjectToolbar collapsed onToggleCollapsed={noop} />);
    expect(ariaLabels(html)).toEqual([
      'Show insert labels',
      'Search',
      'Text line',
      'Shape',
      'Image',
      'Graph',
      'Animate',
      'Camera',
      'Audio',
    ]);
    expect(html.match(/aria-expanded="false"/g)?.length).toBe(4 + 1); // 4 flyouts + label toggle
  });

  it('expanded sidebar lists every action with its label', () => {
    const html = renderToStaticMarkup(<AddObjectToolbar collapsed={false} onToggleCollapsed={noop} />);
    const labels = ariaLabels(html);
    for (const a of INSERT_ACTIONS) expect(labels).toContain(a.label);
    for (const sub of ['Change', 'Emphasize', 'Leave']) expect(html).toContain(sub);
  });
});

describe('insert search', () => {
  const ids = (q: string) => searchInsertActions(q).map((a) => a.id);

  it('returns every action for an empty query', () => {
    expect(ids('  ')).toHaveLength(INSERT_ACTIONS.length);
  });

  it('ranks name matches before keyword matches', () => {
    const zoom = ids('zoom');
    expect(zoom[0]).toBe('zoomRegion');
    expect(zoom).toEqual(expect.arrayContaining(['fitObject', 'fullFrame']));
    expect(ids('move')[0]).toBe('move');
    expect(ids('move')).toContain('graphFollow');
  });

  it('finds actions by everyday words', () => {
    expect(ids('fade')).toEqual(['exit']);
    expect(ids('voice')).toEqual(expect.arrayContaining(['recordAudio', 'textToSpeech']));
    expect(ids('highlight')).toEqual(['blink', 'surroundingRect']);
    expect(ids('HEBREW')).toEqual(['textLine']);
  });

  it('returns nothing for an unknown word', () => {
    expect(ids('zzzz')).toEqual([]);
  });
});

describe('insert search shortcut', () => {
  const key = (k: string, code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) => ({
    key: k,
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
  });

  it('opens on "/" and on the physical slash key under a Hebrew layout', () => {
    expect(isInsertSearchShortcut(key('/', 'Slash'))).toBe(true);
    expect(isInsertSearchShortcut(key('.', 'Slash'))).toBe(true); // Hebrew layout
    expect(isInsertSearchShortcut(key('/', 'KeyQ'))).toBe(true); // Hebrew layout
    expect(isInsertSearchShortcut(key('/', 'Slash', { ctrlKey: true }))).toBe(false);
    expect(isInsertSearchShortcut(key('a', 'KeyA'))).toBe(false);
  });

  it('never fires while typing in a field', () => {
    expect(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
