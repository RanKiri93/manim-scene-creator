import { exportManimCode } from '@/codegen/manimExporter';
import { AGENT_CHAT_RESPONSE_JSON_SCHEMA, type AgentAction } from '../types';
import type { DraftSession, MeasureText } from './draft';
import { inspectDraft } from './inspect';
import { findWords } from '../narration';
import { describeTimelineEdit } from '../timelineEdits';
import { normalizeStyleNote } from '../validate';
import { STYLE_NOTE_SCHEMA } from '../schemaFragments';
import type { LoopImage, LoopToolCall, LoopToolResult, LoopToolSpec } from './types';

/** Optional capabilities the host can add (e.g. preview snapshots). */
export interface LoopToolEnv {
  /** Picture of the draft on the canvas at `time` (camera view). */
  snapshot?: (time: number) => Promise<LoopImage>;
  /** One Manim frame of the draft at `time`, rendered by the measure server. */
  renderFrame?: (time: number, session: DraftSession) => Promise<LoopImage>;
  /** Measure a draft text line with the measure server, so inspect uses its real size. */
  measureText?: MeasureText;
  /** Shrink a picture the Copilot looked at for its Steps list (data URL), or null. */
  thumbnail?: (image: LoopImage) => Promise<string | null>;
}

export interface ToolOutcome {
  result: LoopToolResult;
  /** Set by `finish`: the turn is over. */
  finished?: { reply: string; styleNote?: string };
  /** One-line summary for the visible work log. */
  summary: string;
  /** A picture tool: which time it showed and from where (for the Steps thumbnail). */
  seen?: { time: number; source: 'preview' | 'manim' };
}

const ACTIONS_SCHEMA = AGENT_CHAT_RESPONSE_JSON_SCHEMA.properties.actions;

export function loopToolSpecs(env: LoopToolEnv): LoopToolSpec[] {
  const specs: LoopToolSpec[] = [
    {
      name: 'propose_changes',
      description:
        'Add CREATE / UPDATE / DELETE / TIMELINE actions to the draft (same action shapes as in the rules). The whole draft is validated; if anything is invalid nothing is added and you get the errors to fix. On success you get the touched ids and any warnings. The user sees the draft live on the canvas.',
      inputSchema: {
        type: 'object',
        properties: { actions: ACTIONS_SCHEMA },
        required: ['actions'],
      },
    },
    {
      name: 'reset_draft',
      description: 'Discard every action in the draft and start over.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'inspect_scene',
      description:
        'Exact facts about the scene with the draft applied: scene length, camera view, and per item its visible window and resolved position at the given times (world units; graph dots also in graph coordinates; connectors as both ends; inCamera / outside for things that leave the camera view). Text lines list their segments with the index blink, surround and styling use; function series list when each curve draws and which one shows; camera clips where they end. textOverlaps lists text lines that overlap. New text is measured first when the measure server is on. Defaults: the items the draft touches, at the start / middle / end of each.',
      inputSchema: {
        type: 'object',
        properties: {
          times: { type: 'array', items: { type: 'number' }, description: 'Up to 8 scene times in seconds.' },
          itemIds: { type: 'array', items: { type: 'string' }, description: 'Up to 30 item ids; omit for the items the draft touches.' },
        },
      },
    },
    {
      name: 'find_words',
      description:
        'Find where words are spoken in the narration: each match with its scene start and end (seconds), the words as spoken and a little context. Hebrew prefixes are matched (נקודה finds בנקודה). Use it to start clips on spoken words.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'One word or a short phrase as it is spoken.' } },
        required: ['text'],
      },
    },
    {
      name: 'check_export',
      description: 'Generate the Manim code for the scene with the draft applied and report export errors (no rendering).',
      inputSchema: { type: 'object', properties: {} },
    },
  ];
  if (env.snapshot) {
    specs.push({
      name: 'snapshot_preview',
      description:
        "Picture of the editor preview of the draft at a scene time, as the camera sees it. Use it to check layout (overlaps, things off screen, size). Text lines that are not measured yet show as placeholders. Costs time: check the key moments only.",
      inputSchema: {
        type: 'object',
        properties: { time: { type: 'number', description: 'Scene time in seconds.' } },
        required: ['time'],
      },
    });
  }
  if (env.renderFrame) {
    specs.push({
      name: 'render_manim_frame',
      description:
        'Render one real Manim frame of the draft at a scene time with the measure server (slow: tens of seconds). Use at most once or twice, for a final check of what the export will look like.',
      inputSchema: {
        type: 'object',
        properties: { time: { type: 'number', description: 'Scene time in seconds.' } },
        required: ['time'],
      },
    });
  }
  specs.push({
    name: 'finish',
    description:
      'End your turn. `reply` is the chat message to the user: what you did and anything they should check, or a clarifying question (then leave the draft empty).',
    inputSchema: {
      type: 'object',
      properties: { reply: { type: 'string' }, styleNote: STYLE_NOTE_SCHEMA },
      required: ['reply'],
    },
  });
  return specs;
}

function describeAction(a: AgentAction): string {
  if (a.action === 'CREATE') return `CREATE ${a.item.kind} ${a.item.id}`;
  if (a.action === 'UPDATE') return `UPDATE ${a.itemId} (${Object.keys(a.updates).join(', ')})`;
  if (a.action === 'TIMELINE') return `TIMELINE ${describeTimelineEdit(a.edit)}`;
  return `DELETE ${a.itemId}`;
}

const json = (value: unknown) => JSON.stringify(value);

function timeArg(input: unknown): number | null {
  const t = (input as { time?: unknown } | null)?.time;
  return typeof t === 'number' && Number.isFinite(t) ? Math.max(0, t) : null;
}

/** Run one tool call against the draft. Never throws: failures come back as error results. */
export async function runLoopTool(call: LoopToolCall, session: DraftSession, env: LoopToolEnv): Promise<ToolOutcome> {
  const ok = (text: string, summary: string, images?: LoopImage[]): ToolOutcome => ({ result: { callId: call.id, text, images }, summary });
  const fail = (text: string, summary: string): ToolOutcome => ({ result: { callId: call.id, text, isError: true }, summary });
  const input = (call.input ?? {}) as Record<string, unknown>;
  try {
    switch (call.name) {
      case 'propose_changes': {
        const actions = Array.isArray(input.actions) ? input.actions : null;
        if (!actions) return fail('`actions` must be an array.', 'Proposal without actions');
        const r = session.propose(actions);
        if (!r.ok) return fail(json({ errors: r.errors }), `Proposal rejected (${r.errors.length} error${r.errors.length === 1 ? '' : 's'})`);
        return ok(
          json({ added: r.added.map(describeAction), draftActions: session.actions.length, warnings: r.warnings }),
          `Draft: +${r.added.length} change${r.added.length === 1 ? '' : 's'} (${session.actions.length} total)`,
        );
      }
      case 'reset_draft':
        session.reset();
        return ok(json({ draftActions: 0 }), 'Draft cleared');
      case 'inspect_scene': {
        const unmeasured = env.measureText ? await session.measureText(env.measureText) : null;
        const facts = inspectDraft(session, input);
        if (unmeasured) facts.measureNote = `${unmeasured} text line(s) could not be measured; their sizes are placeholders.`;
        return ok(json(facts), 'Inspected the scene');
      }
      case 'find_words': {
        const text = typeof input.text === 'string' ? input.text.trim() : '';
        if (!text) return fail('find_words needs `text`.', 'Word search without text');
        const audio = session.audio();
        if (!audio.some((a) => (a.boundaries ?? a.word_boundaries ?? []).length)) {
          return ok(json({ matches: [], note: 'The scene has no narration with word timings.' }), `No narration to search for "${text}"`);
        }
        const matches = findWords(audio, text);
        return ok(json({ matches }), `Found "${text}" ${matches.length} time${matches.length === 1 ? '' : 's'} in the narration`);
      }
      case 'check_export': {
        const scene = session.scene();
        const code = exportManimCode([...scene.values()], {
          fullFile: false,
          defaults: session.base.defaults,
          audioItems: session.audio(),
          frames: session.base.frames,
          startFrameId: session.base.startFrameId ?? undefined,
        });
        const error = /# EXPORT ERROR: (.*)/.exec(code)?.[1];
        return error
          ? fail(json({ ok: false, error }), 'Export check failed')
          : ok(json({ ok: true, lines: code.split('\n').length, plays: (code.match(/self\.play\(/g) ?? []).length }), 'Export check passed');
      }
      case 'snapshot_preview': {
        const time = timeArg(input);
        if (time == null || !env.snapshot) return fail('snapshot_preview needs a numeric `time`.', 'Snapshot failed');
        const image = await env.snapshot(time);
        return { ...ok(json({ time, note: 'Editor preview at that time, camera view.' }), `Looked at the preview at ${time.toFixed(2)}s`, [image]), seen: { time, source: 'preview' } };
      }
      case 'render_manim_frame': {
        const time = timeArg(input);
        if (time == null || !env.renderFrame) return fail('render_manim_frame needs a numeric `time`.', 'Manim frame failed');
        const image = await env.renderFrame(time, session);
        return { ...ok(json({ time, note: 'Real Manim render of the draft at that time.' }), `Rendered a Manim frame at ${time.toFixed(2)}s`, [image]), seen: { time, source: 'manim' } };
      }
      case 'finish': {
        const reply = typeof input.reply === 'string' && input.reply.trim() ? input.reply.trim() : '';
        if (!reply) return fail('`reply` must be a non-empty string.', 'Finish without a reply');
        const styleNote = normalizeStyleNote(input.styleNote);
        return { result: { callId: call.id, text: 'ok' }, finished: { reply, ...(styleNote ? { styleNote } : {}) }, summary: 'Finished' };
      }
      default:
        return fail(`Unknown tool "${call.name}".`, `Unknown tool ${call.name}`);
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') throw e;
    const message = e instanceof Error ? e.message : String(e);
    return fail(json({ error: message }), `${call.name} failed: ${message}`);
  }
}
