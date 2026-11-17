import { describe, expect, it } from 'vitest';
import { partialJsonStringField } from './sse';
import { readAnthropicStream } from './anthropicLoop';
import { readOpenAIStream } from './openaiLoop';
import type { LoopPartial } from '../loop/types';

/** A Response whose body arrives in the given chunks (split mid-line on purpose). */
function streamed(chunks: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const s of chunks) c.enqueue(enc.encode(s));
        c.close();
      },
    }),
  );
}

function sse(events: [string, unknown][]): string {
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
}

describe('partialJsonStringField', () => {
  it('reads a string field while its JSON is still arriving', () => {
    expect(partialJsonStringField('{"reply": "Added the ti', 'reply')).toBe('Added the ti');
    expect(partialJsonStringField('{"reply":"a\\nb \\"q\\" \\u05e9', 'reply')).toBe('a\nb "q" ש');
    expect(partialJsonStringField('{"reply":"done","styleNote":"x"}', 'reply')).toBe('done');
    expect(partialJsonStringField('{"repl', 'reply')).toBeUndefined();
    expect(partialJsonStringField('{"reply":"ends with \\', 'reply')).toBe('ends with ');
  });
});

describe('Anthropic stream', () => {
  it('rebuilds thinking, text and tool_use blocks and reports the finish reply as it is written', async () => {
    const block = (index: number, content_block: unknown) => ['content_block_start', { type: 'content_block_start', index, content_block }] as [string, unknown];
    const delta = (index: number, d: unknown) => ['content_block_delta', { type: 'content_block_delta', index, delta: d }] as [string, unknown];
    const stop = (index: number) => ['content_block_stop', { type: 'content_block_stop', index }] as [string, unknown];
    const body = sse([
      ['message_start', { type: 'message_start', message: { content: [] } }],
      block(0, { type: 'thinking', thinking: '', signature: '' }),
      delta(0, { type: 'thinking_delta', thinking: 'Plan.' }),
      delta(0, { type: 'signature_delta', signature: 'SIG' }),
      stop(0),
      block(1, { type: 'text', text: '' }),
      delta(1, { type: 'text_delta', text: 'Let me ' }),
      delta(1, { type: 'text_delta', text: 'finish.' }),
      stop(1),
      block(2, { type: 'tool_use', id: 'tu1', name: 'finish', input: {} }),
      delta(2, { type: 'input_json_delta', partial_json: '{"reply": "Added ' }),
      delta(2, { type: 'input_json_delta', partial_json: 'the title."}' }),
      stop(2),
      ['message_stop', { type: 'message_stop' }],
    ]);
    const partials: LoopPartial[] = [];
    const cut = Math.floor(body.length / 3);
    const blocks = await readAnthropicStream(
      streamed([body.slice(0, cut), body.slice(cut, cut + 7), body.slice(cut + 7)]),
      (p) => partials.push(p),
    );
    expect(blocks).toEqual([
      { type: 'thinking', thinking: 'Plan.', signature: 'SIG' },
      { type: 'text', text: 'Let me finish.' },
      { type: 'tool_use', id: 'tu1', name: 'finish', input: { reply: 'Added the title.' } },
    ]);
    expect(partials.map((p) => p.reply ?? p.text)).toEqual(['Let me ', 'Let me finish.', 'Added ', 'Added the title.']);
  });

  it('throws on a stream error event', async () => {
    const body = sse([['error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]]);
    await expect(readAnthropicStream(streamed([body]), () => {})).rejects.toThrow(/Overloaded/);
  });
});

describe('OpenAI stream', () => {
  it('joins content and tool-call deltas by index', async () => {
    const chunks = [
      { choices: [{ delta: { content: 'Checking' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'inspect_scene', arguments: '{}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', type: 'function', function: { name: 'finish', arguments: '{"reply":"Do' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: 'ne."}' } }] } }] },
    ];
    const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
    const partials: LoopPartial[] = [];
    const message = await readOpenAIStream(streamed([body]), (p) => partials.push(p));
    expect(message).toEqual({
      content: 'Checking',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'inspect_scene', arguments: '{}' } },
        { id: 'c2', type: 'function', function: { name: 'finish', arguments: '{"reply":"Done."}' } },
      ],
    });
    expect(partials.at(-1)).toEqual({ text: 'Checking', reply: 'Done.' });
  });
});
