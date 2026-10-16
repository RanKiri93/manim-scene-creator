import type { LoopConversation, LoopConversationInput, LoopProvider, LoopStep, LoopToolResult } from '../loop/types';
import { historyAsPlainTurns, loopUserMessage } from '../loop/history';
import { AgentProviderError } from './types';

/** Tokens from the ChatGPT sign-in, kept in browser localStorage like API keys. */
export interface ChatgptAuth {
  access: string;
  refresh: string;
  /** Epoch milliseconds. */
  expires: number;
  accountId: string;
  email?: string | null;
  plan?: string | null;
}

export const DEFAULT_CHATGPT_MODEL = 'gpt-5.2';
/** Refresh this long before the access token expires. */
const REFRESH_MARGIN_MS = 120_000;

export interface ChatgptLoopOptions {
  model: string;
  /** Measure server base URL; it signs in and forwards requests (the browser cannot reach chatgpt.com). */
  measureUrl: string;
  getAuth: () => ChatgptAuth | null;
  saveAuth: (auth: ChatgptAuth) => void;
}

const base = (url: string) => url.replace(/\/$/, '');

async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text) as { detail?: unknown };
    if (typeof j.detail === 'string') return j.detail;
  } catch {
    /* raw text */
  }
  return text || `HTTP ${res.status}`;
}

/** Exchange the refresh token for new tokens (through the measure server). */
export async function refreshChatgptAuth(measureUrl: string, auth: ChatgptAuth): Promise<ChatgptAuth> {
  const res = await fetch(`${base(measureUrl)}/api/chatgpt/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: auth.refresh }),
  });
  if (!res.ok) throw new AgentProviderError(`ChatGPT sign-in expired; sign in again. (${await errorText(res)})`, res.status);
  return (await res.json()) as ChatgptAuth;
}

/**
 * OpenAI through a ChatGPT subscription: the Responses API format, sent via the measure server to
 * the ChatGPT Codex backend. Our system prompt is a developer message (the server adds the Codex
 * instructions the backend expects). Reasoning items come back with encrypted content and are
 * replayed (without ids, since nothing is stored server side).
 */
export function createChatgptLoopProvider(opts: ChatgptLoopOptions): LoopProvider {
  return {
    startConversation(input: LoopConversationInput): LoopConversation {
      if (!opts.getAuth()) throw new AgentProviderError('Sign in with ChatGPT in Copilot settings first.');
      return new ChatgptLoopConversation(opts, input);
    },
  };
}

type ResponseItem = Record<string, unknown> & { type?: string };

export class ChatgptLoopConversation implements LoopConversation {
  readonly input: ResponseItem[];
  private readonly opts: ChatgptLoopOptions;
  private readonly tools: unknown[];
  private readonly includeThinking: boolean;

  constructor(opts: ChatgptLoopOptions, input: LoopConversationInput) {
    this.opts = opts;
    this.includeThinking = input.includeThinking;
    this.input = [
      { role: 'developer', content: input.systemPrompt },
      ...historyAsPlainTurns(input.history).map((t) => ({ role: t.role, content: t.text })),
      { role: 'user', content: loopUserMessage(input.payload, input.userPrompt) },
    ];
    this.tools = input.tools.map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
      strict: false,
    }));
  }

  /** Request body for the current input (exposed for tests). */
  body(): Record<string, unknown> {
    return {
      model: this.opts.model || DEFAULT_CHATGPT_MODEL,
      input: this.input,
      tools: this.tools,
      tool_choice: 'auto',
      parallel_tool_calls: true,
      reasoning: this.includeThinking ? { effort: 'medium', summary: 'auto' } : { effort: 'medium' },
    };
  }

  private async freshAuth(force = false): Promise<ChatgptAuth> {
    const auth = this.opts.getAuth();
    if (!auth) throw new AgentProviderError('Sign in with ChatGPT in Copilot settings first.');
    if (!force && auth.expires - Date.now() > REFRESH_MARGIN_MS) return auth;
    const next = await refreshChatgptAuth(this.opts.measureUrl, auth);
    this.opts.saveAuth(next);
    return next;
  }

  private send(auth: ChatgptAuth, signal?: AbortSignal): Promise<Response> {
    return fetch(`${base(this.opts.measureUrl)}/api/chatgpt/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.access}`,
        'chatgpt-account-id': auth.accountId,
      },
      signal,
      body: JSON.stringify(this.body()),
    });
  }

  async next(signal?: AbortSignal): Promise<LoopStep> {
    let res = await this.send(await this.freshAuth(), signal);
    if (res.status === 401) res = await this.send(await this.freshAuth(true), signal);
    if (!res.ok) throw new AgentProviderError(`ChatGPT request failed (${res.status}): ${await errorText(res)}`, res.status);
    const data = (await res.json()) as { output?: ResponseItem[] };
    const output = data.output ?? [];
    for (const item of output) {
      // Nothing is stored server side (store: false), so item ids cannot be referenced.
      const replay = { ...item };
      delete replay.id;
      this.input.push(replay);
    }
    const texts: string[] = [];
    const thinking: string[] = [];
    const toolCalls: LoopStep['toolCalls'] = [];
    for (const item of output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content as { type?: string; text?: string }[]) {
          if (part.type === 'output_text' && part.text) texts.push(part.text);
        }
      } else if (item.type === 'reasoning' && Array.isArray(item.summary)) {
        for (const part of item.summary as { text?: string }[]) if (part.text) thinking.push(part.text);
      } else if (item.type === 'function_call') {
        let parsed: unknown = {};
        try {
          parsed = typeof item.arguments === 'string' && item.arguments ? JSON.parse(item.arguments) : {};
        } catch {
          parsed = { __invalidJson: item.arguments };
        }
        toolCalls.push({ id: String(item.call_id), name: String(item.name), input: parsed });
      }
    }
    return { text: texts.join('\n'), thinking: thinking.join('\n\n') || undefined, toolCalls };
  }

  pushToolResults(results: LoopToolResult[]): void {
    for (const r of results) {
      this.input.push({ type: 'function_call_output', call_id: r.callId, output: r.isError ? `ERROR: ${r.text}` : r.text });
    }
    const images = results.flatMap((r) => r.images ?? []);
    if (images.length) {
      this.input.push({
        role: 'user',
        content: [
          { type: 'input_text', text: 'Images returned by the tool calls above, in order.' },
          ...images.map((img) => ({ type: 'input_image', image_url: `data:${img.mediaType};base64,${img.base64}` })),
        ],
      });
    }
  }
}

/**
 * Start a ChatGPT sign-in: opens the OpenAI page and waits for the measure server's callback.
 * With `openOnServer` the measure server opens the page in the default browser (the desktop app's
 * window cannot open other pages); `onUrl` always gets the URL so the UI can offer it as a link.
 */
export async function signInWithChatgpt(
  measureUrl: string,
  onUrl: (url: string, openedByServer: boolean) => void,
  signal?: AbortSignal,
  opts: { openOnServer?: boolean } = {},
): Promise<ChatgptAuth> {
  const query = opts.openOnServer ? '?open_browser=true' : '';
  const start = await fetch(`${base(measureUrl)}/api/chatgpt/login/start${query}`, { method: 'POST', signal });
  if (!start.ok) throw new AgentProviderError(await errorText(start), start.status);
  const { authorize_url: authorizeUrl, state, browser_opened: browserOpened } = (await start.json()) as {
    authorize_url: string;
    state: string;
    browser_opened?: boolean;
  };
  onUrl(authorizeUrl, browserOpened === true);
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const res = await fetch(`${base(measureUrl)}/api/chatgpt/login/status?state=${encodeURIComponent(state)}`, { signal });
    if (!res.ok) throw new AgentProviderError(await errorText(res), res.status);
    const status = (await res.json()) as { status: string; tokens?: ChatgptAuth; error?: string };
    if (status.status === 'done' && status.tokens) return status.tokens;
    if (status.status === 'error') throw new AgentProviderError(status.error || 'Sign-in failed.');
  }
  throw new AgentProviderError('Sign-in timed out.');
}
