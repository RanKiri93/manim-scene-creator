import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentContextPayload } from '../types';
import { loopToolSpecs } from '../loop/tools';
import { ChatgptLoopConversation, listChatgptModels, signInWithChatgpt, type ChatgptAuth } from './chatgptLoop';

const payload = { projectDefaults: {}, currentTimeSec: 0, existingItems: [], frames: [], startFrameId: null, activeFrameId: null } as unknown as AgentContextPayload;
const input = { systemPrompt: 'SYS', history: [], payload, userPrompt: 'make a dot', tools: loopToolSpecs({}), includeThinking: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function conversation(auth: ChatgptAuth) {
  let current: ChatgptAuth | null = auth;
  const saved: ChatgptAuth[] = [];
  const c = new ChatgptLoopConversation(
    {
      model: 'gpt-5.2',
      measureUrl: 'http://127.0.0.1:8765/',
      getAuth: () => current,
      saveAuth: (a) => {
        current = a;
        saved.push(a);
      },
    },
    input,
  );
  return { c, saved };
}

const fresh: ChatgptAuth = { access: 'acc', refresh: 'ref', expires: Date.now() + 3_600_000, accountId: 'acct' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ChatGPT subscription loop conversation', () => {
  it('sends the system prompt as a developer message and tools in Responses form', () => {
    const body = conversation(fresh).c.body();
    expect((body.input as { role: string }[]).map((m) => m.role)).toEqual(['developer', 'user']);
    expect((body.tools as { type: string; name: string }[])[0]).toMatchObject({ type: 'function', name: 'propose_changes' });
    expect(body.reasoning).toEqual({ effort: 'medium', summary: 'auto' });
  });

  it('goes through the measure server, parses calls and reasoning, and replays output without ids', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        output: [
          { id: 'rs_1', type: 'reasoning', summary: [{ type: 'summary_text', text: 'plan' }], encrypted_content: 'enc' },
          { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'inspect_scene', arguments: '{"times":[1]}' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { c } = conversation(fresh);
    const step = await c.next();
    expect(step).toEqual({ text: '', thinking: 'plan', toolCalls: [{ id: 'call_1', name: 'inspect_scene', input: { times: [1] } }] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8765/api/chatgpt/responses');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer acc', 'chatgpt-account-id': 'acct' });
    c.pushToolResults([{ callId: 'call_1', text: '{}', images: [{ mediaType: 'image/png', base64: 'AAAA' }] }]);
    const replay = c.body().input as Record<string, unknown>[];
    expect(replay[2]).toEqual({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'plan' }], encrypted_content: 'enc' });
    expect(replay[3]).not.toHaveProperty('id');
    expect(replay[4]).toEqual({ type: 'function_call_output', call_id: 'call_1', output: '{}' });
    expect(replay[5]).toMatchObject({ role: 'user', content: [{ type: 'input_text' }, { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] });
  });

  it('refreshes an expiring token first, and retries once after a 401', async () => {
    const renewed = { ...fresh, access: 'acc2', expires: Date.now() + 3_600_000 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(renewed)) // refresh (token about to expire)
      .mockResolvedValueOnce(json({ detail: 'expired' }, 401))
      .mockResolvedValueOnce(json({ ...renewed, access: 'acc3' })) // forced refresh
      .mockResolvedValueOnce(json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { c, saved } = conversation({ ...fresh, expires: Date.now() + 1000 });
    expect((await c.next()).text).toBe('hi');
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'http://127.0.0.1:8765/api/chatgpt/refresh',
      'http://127.0.0.1:8765/api/chatgpt/responses',
      'http://127.0.0.1:8765/api/chatgpt/refresh',
      'http://127.0.0.1:8765/api/chatgpt/responses',
    ]);
    expect(saved.map((a) => a.access)).toEqual(['acc2', 'acc3']);
  });
});

describe('ChatGPT sign-in', () => {
  it('opens the authorize page and polls until the tokens arrive', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ authorize_url: 'https://auth.openai.com/oauth/authorize?x', state: 's 1' }))
      .mockResolvedValueOnce(json({ status: 'pending' }))
      .mockResolvedValueOnce(json({ status: 'done', tokens: fresh }));
    vi.stubGlobal('fetch', fetchMock);
    const opened: string[] = [];
    const pending = signInWithChatgpt('http://m', (url) => opened.push(url));
    await vi.advanceTimersByTimeAsync(3100);
    await expect(pending).resolves.toEqual(fresh);
    expect(opened).toEqual(['https://auth.openai.com/oauth/authorize?x']);
    expect(String(fetchMock.mock.calls[1]![0])).toBe('http://m/api/chatgpt/login/status?state=s%201');
  });

  it('asks the measure server to open the browser when told to', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ authorize_url: 'https://auth.openai.com/oauth/authorize?x', state: 's', browser_opened: true }))
      .mockResolvedValueOnce(json({ status: 'done', tokens: fresh }));
    vi.stubGlobal('fetch', fetchMock);
    const opened: [string, boolean][] = [];
    const pending = signInWithChatgpt('http://m', (url, byServer) => opened.push([url, byServer]), undefined, {
      openOnServer: true,
    });
    await vi.advanceTimersByTimeAsync(1600);
    await expect(pending).resolves.toEqual(fresh);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://m/api/chatgpt/login/start?open_browser=true');
    expect(opened).toEqual([['https://auth.openai.com/oauth/authorize?x', true]]);
  });
});

describe('ChatGPT model list', () => {
  it('sends the tokens and returns the models', async () => {
    const models = [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', description: '' }];
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ models }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listChatgptModels('http://m/', () => fresh, () => {})).resolves.toEqual(models);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://m/api/chatgpt/models');
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${fresh.access}`);
    expect(headers['chatgpt-account-id']).toBe(fresh.accountId);
  });

  it('refreshes once after a 401', async () => {
    const renewed = { ...fresh, access: 'renewed' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"detail":"expired"}', { status: 401 }))
      .mockResolvedValueOnce(json(renewed))
      .mockResolvedValueOnce(json({ models: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const saved: ChatgptAuth[] = [];
    await expect(listChatgptModels('http://m', () => fresh, (a) => saved.push(a))).resolves.toEqual([]);
    expect(String(fetchMock.mock.calls[1]![0])).toBe('http://m/api/chatgpt/refresh');
    expect(saved).toEqual([renewed]);
  });
});
