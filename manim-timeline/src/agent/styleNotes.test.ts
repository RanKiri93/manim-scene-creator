import { describe, expect, it } from 'vitest';
import { normalizeCopilotNotes } from '@/lib/copilotNotes';
import { useProjectScenesStore } from '@/store/useProjectScenesStore';
import { defaultSceneDefaults } from '@/store/factories';
import { MULTISCENE_PROJECT_KIND, type MultiSceneProjectFile } from '@/types/scene';
import { buildContextPayload } from './serialize';
import { validateAgentResponse } from './validate';
import { AGENT_CHAT_RESPONSE_JSON_SCHEMA } from './types';
import { GEMINI_RESPONSE_SCHEMA } from './providers/gemini';
import { buildSystemPrompt } from './systemPrompt';
import { loopToolSpecs, runLoopTool } from './loop/tools';
import { DraftSession } from './loop/draft';
import { useAgentStore } from './useAgentStore';

describe('project style notes', () => {
  it('cleans notes: strings, trimmed, no repeats, capped', () => {
    expect(normalizeCopilotNotes(['  Dots are yellow. ', 3, '', 'dots are yellow.', 'Text 0.3 apart'])).toEqual(['Dots are yellow.', 'Text 0.3 apart']);
    expect(normalizeCopilotNotes('x')).toEqual([]);
    expect(normalizeCopilotNotes(Array.from({ length: 30 }, (_, i) => `n${i}`))).toHaveLength(20);
  });

  it('load from and save to the project file, only when there are notes', () => {
    const multi: MultiSceneProjectFile = {
      kind: MULTISCENE_PROJECT_KIND,
      version: 1,
      savedAt: '',
      measureConfig: { url: 'http://127.0.0.1:8765', enabled: false } as MultiSceneProjectFile['measureConfig'],
      activeSceneId: 's1',
      scenes: [{ id: 's1', name: 'Scene 1', defaults: defaultSceneDefaults(), frames: [{ id: 'home', col: 0, row: 0 }], startFrameId: 'home', items: [] }],
      copilotNotes: ['Dots are yellow (#facc15).'],
    };
    const store = useProjectScenesStore.getState();
    store.loadFromNormalizedMulti(multi);
    expect(useProjectScenesStore.getState().copilotNotes).toEqual(['Dots are yellow (#facc15).']);
    useProjectScenesStore.getState().addCopilotNote('Graphs are blue.');
    expect(useProjectScenesStore.getState().toMultiSceneProjectFile().copilotNotes).toEqual(['Dots are yellow (#facc15).', 'Graphs are blue.']);
    useProjectScenesStore.getState().setCopilotNotes([]);
    expect(useProjectScenesStore.getState().toMultiSceneProjectFile()).not.toHaveProperty('copilotNotes');
    store.loadFromNormalizedMulti({ ...multi, copilotNotes: undefined });
    expect(useProjectScenesStore.getState().copilotNotes).toEqual([]);
  });

  it('go with every request and the model is told how to use and suggest them', () => {
    const payload = buildContextPayload({ defaults: defaultSceneDefaults(), currentTime: 0, items: [], projectNotes: ['Dots are yellow.'] });
    expect(payload.projectNotes).toEqual(['Dots are yellow.']);
    expect(buildContextPayload({ defaults: defaultSceneDefaults(), currentTime: 0, items: [] })).not.toHaveProperty('projectNotes');
    for (const prompt of [buildSystemPrompt(''), buildSystemPrompt('', 'loop')]) {
      expect(prompt).toContain('15. Project style notes');
      expect(prompt).toContain('finish({ reply, styleNote })');
    }
  });
});

describe('suggested style notes', () => {
  it('are read from a reply (single mode) and from finish (tool loop)', async () => {
    const r = validateAgentResponse({ reply: 'Done.', actions: [], styleNote: '  Dots   are yellow (#facc15). ' }, new Map());
    expect(r.ok && r.response.styleNote).toBe('Dots are yellow (#facc15).');
    const none = validateAgentResponse({ reply: 'Done.', actions: [], styleNote: '   ' }, new Map());
    expect(none.ok && none.response).not.toHaveProperty('styleNote');

    const session = new DraftSession({ items: new Map(), frames: [{ id: 'home', col: 0, row: 0 }], startFrameId: 'home', activeFrameId: 'home', defaults: defaultSceneDefaults(), audioItems: [], currentTimeSec: 0 });
    const out = await runLoopTool({ id: 'f', name: 'finish', input: { reply: 'ok', styleNote: 'Graphs are blue.' } }, session, {});
    expect(out.finished).toEqual({ reply: 'ok', styleNote: 'Graphs are blue.' });
    expect(loopToolSpecs({}).find((t) => t.name === 'finish')!.inputSchema).toHaveProperty('properties.styleNote.type', 'string');
  });

  it('are in both response schemas', () => {
    expect(AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties).toHaveProperty('styleNote.type', 'string');
    expect(GEMINI_RESPONSE_SCHEMA.properties).toHaveProperty('styleNote.type', 'string');
  });

  it('saving one adds it to the project and marks the message; dismissing hides it', () => {
    useProjectScenesStore.getState().setCopilotNotes([]);
    useAgentStore.setState({
      messages: [
        { id: 'a1', createdAt: 0, role: 'assistant', content: 'x', styleNote: 'Dots are yellow.', styleNoteStatus: 'pending' },
        { id: 'a2', createdAt: 1, role: 'assistant', content: 'y', styleNote: 'Graphs are blue.', styleNoteStatus: 'pending' },
      ],
    });
    useAgentStore.getState().saveStyleNote('a1', 'Dots are yellow (#facc15).');
    useAgentStore.getState().dismissStyleNote('a2');
    expect(useProjectScenesStore.getState().copilotNotes).toEqual(['Dots are yellow (#facc15).']);
    expect(useAgentStore.getState().messages.map((m) => [m.styleNote, m.styleNoteStatus])).toEqual([
      ['Dots are yellow (#facc15).', 'saved'],
      ['Graphs are blue.', 'dismissed'],
    ]);
  });
});
