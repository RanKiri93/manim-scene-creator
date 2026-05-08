import { useEffect, useRef, useState } from 'react';
import type { AgentAction, AgentChatMessage } from './types';
import { useAgentStore } from './useAgentStore';
import type { ProviderId } from './providers';
import { buildScriptToTimelinePrompt } from './scriptToTimelinePrompt';

const PROVIDER_OPTIONS: { id: ProviderId; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'customOpenAI', label: 'Custom (OpenAI-compatible)' },
];

export default function AgentPanel() {
  const status = useAgentStore((s) => s.status);
  const messages = useAgentStore((s) => s.messages);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const cancelRequest = useAgentStore((s) => s.cancelRequest);
  const approveMessage = useAgentStore((s) => s.approveMessage);
  const rejectMessage = useAgentStore((s) => s.rejectMessage);
  const regenerateLast = useAgentStore((s) => s.regenerateLast);
  const newChat = useAgentStore((s) => s.newChat);
  const provider = useAgentStore((s) => s.provider);
  const apiKey = useAgentStore((s) => s.apiKey);
  const baseUrl = useAgentStore((s) => s.baseUrl);
  const model = useAgentStore((s) => s.model);
  const customRules = useAgentStore((s) => s.customRules);
  const showThinking = useAgentStore((s) => s.showThinking);
  const updateSettings = useAgentStore((s) => s.updateSettings);
  const setProvider = useAgentStore((s) => s.setProvider);

  const [prompt, setPrompt] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [scriptDraft, setScriptDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const loading = status === 'loading';

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const onSubmit = () => {
    if (loading) return;
    const p = prompt.trim();
    if (!p) return;
    setPrompt('');
    void sendMessage(p);
  };

  const onSubmitScript = () => {
    if (loading) return;
    const generatedPrompt = buildScriptToTimelinePrompt({ script: scriptDraft });
    if (!generatedPrompt) return;
    void sendMessage(generatedPrompt);
  };

  const empty = messages.length === 0;

  return (
    <div className="flex flex-col h-full text-xs text-slate-200">
      <div className="flex items-center gap-2 pb-2 mb-2 border-b border-slate-700 shrink-0">
        <span className="text-[11px] uppercase tracking-wide text-slate-400 truncate">
          {provider} · <span className="font-mono">{model || 'default'}</span>
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setScriptOpen((v) => !v)}
          className="px-2 py-1 text-[11px] rounded bg-slate-700 hover:bg-slate-600 transition-colors"
        >
          {scriptOpen ? 'Hide script' : 'Script'}
        </button>
        <button
          type="button"
          onClick={newChat}
          disabled={empty && status !== 'error'}
          className="px-2 py-1 text-[11px] rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Start a new conversation"
        >
          New chat
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          className="px-2 py-1 text-[11px] rounded bg-slate-700 hover:bg-slate-600 transition-colors"
        >
          {settingsOpen ? 'Hide' : 'Settings'}
        </button>
      </div>

      {settingsOpen && (
        <SettingsBlock
          provider={provider}
          apiKey={apiKey}
          baseUrl={baseUrl}
          model={model}
          customRules={customRules}
          showThinking={showThinking}
          onProvider={setProvider}
          onUpdate={updateSettings}
        />
      )}

      {scriptOpen && (
        <ScriptToTimelineBlock
          value={scriptDraft}
          loading={loading}
          onChange={setScriptDraft}
          onSubmit={onSubmitScript}
          onClear={() => setScriptDraft('')}
        />
      )}

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-3 pr-1"
      >
        {empty && (
          <div className="text-slate-400 text-[11px] italic px-1 py-4 leading-relaxed">
            Start a conversation with the Copilot, request scene edits, or open
            Script to Timeline to paste a lesson script. Proposals only change
            the scene after you click <b>Approve</b>.
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <UserBubble key={m.id} message={m} />
          ) : (
            <AssistantBubble
              key={m.id}
              message={m}
              showThinking={showThinking}
              onApprove={() => approveMessage(m.id)}
              onReject={() => rejectMessage(m.id)}
              onRetry={
                i === messages.length - 1 && m.error ? regenerateLast : undefined
              }
            />
          ),
        )}
        {loading && (
          <div className="flex items-center gap-2 px-1 py-1 text-slate-400">
            <span className="inline-block w-2 h-2 rounded-full bg-fuchsia-400 animate-pulse" />
            Thinking…
          </div>
        )}
      </div>

      <div className="pt-2 mt-2 border-t border-slate-700 shrink-0 flex flex-col gap-1">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            // Standard chat UX: Enter sends, Shift+Enter inserts a newline.
            // Ctrl/Cmd+Enter is also accepted for muscle memory. Ignore the
            // submit shortcut while an IME composition is active so Asian
            // language input doesn't get committed as a chat turn.
            if (e.key !== 'Enter') return;
            if (e.nativeEvent.isComposing) return;
            if (e.shiftKey) return;
            e.preventDefault();
            onSubmit();
          }}
          placeholder="Ask a question or describe a change…  (Enter to send, Shift+Enter for newline)"
          rows={3}
          spellCheck={false}
          disabled={loading}
          className="w-full resize-none bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-slate-100 focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={loading || !prompt.trim()}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors"
          >
            {loading ? 'Sending…' : 'Send'}
          </button>
          {loading && (
            <button
              type="button"
              onClick={cancelRequest}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface ScriptToTimelineBlockProps {
  value: string;
  loading: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}

function ScriptToTimelineBlock({
  value,
  loading,
  onChange,
  onSubmit,
  onClear,
}: ScriptToTimelineBlockProps) {
  return (
    <div className="flex flex-col gap-2 p-2 mb-2 rounded border border-fuchsia-900/60 bg-fuchsia-950/20 shrink-0">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-fuchsia-200">
          Script to Timeline
        </div>
        <p className="mt-0.5 text-[11px] text-slate-400 leading-relaxed">
          Paste a Hebrew lesson script. The Copilot will propose timeline items;
          nothing changes until you approve.
        </p>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        spellCheck={false}
        disabled={loading}
        className="w-full resize-none bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-slate-100 focus:outline-none focus:border-fuchsia-500 disabled:opacity-50"
        placeholder={'כותרת: משפט ערך הביניים\n\nנאמר ש־$f$ רציפה בקטע $[a,b]$...'}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading || !value.trim()}
          className="px-3 py-1.5 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors"
        >
          {loading ? 'Sending...' : 'Propose timeline'}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={loading || !value}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function UserBubble({ message }: { message: AgentChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] px-3 py-2 rounded-lg bg-blue-600/80 text-white whitespace-pre-wrap break-words">
        {message.content}
      </div>
    </div>
  );
}

interface AssistantBubbleProps {
  message: AgentChatMessage;
  showThinking: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRetry?: () => void;
}

function AssistantBubble({
  message,
  showThinking,
  onApprove,
  onReject,
  onRetry,
}: AssistantBubbleProps) {
  const hasErr = message.error && message.error.length > 0;
  const hasActions = !!message.actions && message.actions.length > 0;
  const pending = hasActions && message.actionsStatus === 'pending';
  const approved = hasActions && message.actionsStatus === 'approved';
  const rejected = hasActions && message.actionsStatus === 'rejected';
  const superseded = hasActions && message.actionsStatus === 'superseded';

  const borderClass = hasErr
    ? 'border-red-700 bg-red-950/50'
    : pending
      ? 'border-fuchsia-500/60 bg-fuchsia-950/20'
      : approved
        ? 'border-emerald-700/60 bg-emerald-950/20'
        : rejected || superseded
          ? 'border-slate-700 bg-slate-800/40'
          : 'border-slate-700 bg-slate-800/60';

  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[92%] w-full px-3 py-2 rounded-lg border ${borderClass} flex flex-col gap-2`}
      >
        {showThinking && message.thinking && (
          <details className="text-[11px] text-slate-400">
            <summary className="cursor-pointer select-none hover:text-slate-200">
              Thinking…
            </summary>
            <div className="mt-1 pl-2 border-l border-slate-700 whitespace-pre-wrap text-slate-400 leading-relaxed">
              {message.thinking}
            </div>
          </details>
        )}

        <div className="whitespace-pre-wrap break-words text-slate-100 leading-relaxed">
          {message.content}
        </div>

        {hasErr && (
          <ul className="list-disc pl-4 space-y-0.5 text-red-200 text-[11px]">
            {message.error!.map((e, i) => (
              <li key={i} className="break-words">
                {e}
              </li>
            ))}
          </ul>
        )}

        {hasActions && (
          <div className="flex flex-col gap-1">
            <ul className="flex flex-col gap-0.5 font-mono text-[11px] text-slate-200 max-h-40 overflow-y-auto pr-1">
              {message.actions!.map((a, i) => (
                <ActionRow key={i} action={a} dim={!pending} />
              ))}
            </ul>
            {pending && (
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={onApprove}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded transition-colors"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={onReject}
                  className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >
                  Reject
                </button>
              </div>
            )}
            {approved && (
              <StatusPill tone="emerald" label="Applied" />
            )}
            {rejected && (
              <StatusPill tone="slate" label="Rejected" />
            )}
            {superseded && (
              <StatusPill
                tone="amber"
                label="Superseded by a newer reply"
              />
            )}
          </div>
        )}

        {hasErr && onRetry && (
          <div>
            <button
              type="button"
              onClick={onRetry}
              className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({
  tone,
  label,
}: {
  tone: 'emerald' | 'slate' | 'amber';
  label: string;
}) {
  const toneClass =
    tone === 'emerald'
      ? 'bg-emerald-900/60 text-emerald-200 border-emerald-700'
      : tone === 'amber'
        ? 'bg-amber-900/40 text-amber-200 border-amber-700/60'
        : 'bg-slate-800 text-slate-300 border-slate-600';
  return (
    <span
      className={`self-start mt-1 inline-block px-2 py-0.5 text-[10px] rounded border ${toneClass}`}
    >
      {label}
    </span>
  );
}

function ActionRow({ action, dim }: { action: AgentAction; dim: boolean }) {
  const dimClass = dim ? 'opacity-50' : '';
  if (action.action === 'CREATE') {
    const it = action.item as { id: string; kind: string; label?: string };
    return (
      <li className={`text-fuchsia-200 ${dimClass}`}>
        <span className="text-fuchsia-400">CREATE</span> {it.kind}{' '}
        <code className="text-slate-300">{it.id}</code>
        {it.label ? ` "${it.label}"` : ''}
      </li>
    );
  }
  if (action.action === 'UPDATE') {
    const keys = Object.keys(action.updates ?? {}).slice(0, 6).join(', ');
    const detail = summarizeUpdateDetails(action.updates);
    return (
      <li className={`text-amber-200 ${dimClass} flex flex-col gap-0.5`}>
        <div>
          <span className="text-amber-400">UPDATE</span>{' '}
          <code className="text-slate-300">{action.itemId}</code>{' '}
          <span className="text-slate-400">{`{${keys}}`}</span>
        </div>
        {detail.length > 0 && (
          <div className="text-[10px] text-amber-100/90">
            {detail.join(' | ')}
          </div>
        )}
      </li>
    );
  }
  return (
    <li className={`text-red-200 ${dimClass}`}>
      <span className="text-red-400">DELETE</span>{' '}
      <code className="text-slate-300">{action.itemId}</code>
    </li>
  );
}

function summarizeUpdateDetails(
  updates: Extract<AgentAction, { action: 'UPDATE' }>['updates'],
): string[] {
  if (!updates || typeof updates !== 'object') return [];
  const patch = updates as Record<string, unknown>;
  const out: string[] = [];
  if (typeof patch.raw === 'string') out.push(`text="${truncate(patch.raw, 36)}"`);
  if (typeof patch.color === 'string') out.push(`color=${patch.color}`);
  if (typeof patch.fontSize === 'number') out.push(`fontSize=${patch.fontSize}`);
  if (typeof patch.bold === 'boolean') out.push(`bold=${String(patch.bold)}`);
  if (typeof patch.italic === 'boolean') out.push(`italic=${String(patch.italic)}`);
  if (Array.isArray(patch.segments)) {
    const segmentInfo = summarizeSegmentsPatch(patch.segments);
    if (segmentInfo) out.push(segmentInfo);
  }
  return out.slice(0, 3);
}

function summarizeSegmentsPatch(segmentsRaw: unknown[]): string | null {
  let boldCount = 0;
  let italicCount = 0;
  let colorCount = 0;
  let textCount = 0;
  for (const seg of segmentsRaw) {
    if (!seg || typeof seg !== 'object') continue;
    const r = seg as Record<string, unknown>;
    if (typeof r.bold === 'boolean') boldCount++;
    if (typeof r.italic === 'boolean') italicCount++;
    if (typeof r.color === 'string') colorCount++;
    if (typeof r.text === 'string') textCount++;
  }
  const parts: string[] = [`segments=${segmentsRaw.length}`];
  if (textCount > 0) parts.push(`text:${textCount}`);
  if (colorCount > 0) parts.push(`color:${colorCount}`);
  if (boldCount > 0) parts.push(`bold:${boldCount}`);
  if (italicCount > 0) parts.push(`italic:${italicCount}`);
  return parts.join(', ');
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

interface SettingsBlockProps {
  provider: ProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  customRules: string;
  showThinking: boolean;
  onProvider: (p: ProviderId) => void;
  onUpdate: (patch: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    customRules?: string;
    showThinking?: boolean;
  }) => void;
}

function SettingsBlock({
  provider,
  apiKey,
  baseUrl,
  model,
  customRules,
  showThinking,
  onProvider,
  onUpdate,
}: SettingsBlockProps) {
  return (
    <div className="flex flex-col gap-2 p-2 mb-2 rounded border border-slate-700 bg-slate-850 shrink-0">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">
        Settings
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-slate-400">Provider</span>
        <select
          value={provider}
          onChange={(e) => onProvider(e.target.value as ProviderId)}
          className="bg-slate-800 border border-slate-600 rounded px-2 py-1"
        >
          {PROVIDER_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-slate-400">Model</span>
        <input
          type="text"
          value={model}
          onChange={(e) => onUpdate({ model: e.target.value })}
          spellCheck={false}
          className="bg-slate-800 border border-slate-600 rounded px-2 py-1 font-mono"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-slate-400">API key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => onUpdate({ apiKey: e.target.value })}
          spellCheck={false}
          autoComplete="off"
          className="bg-slate-800 border border-slate-600 rounded px-2 py-1 font-mono"
          placeholder={
            provider === 'anthropic'
              ? 'sk-ant-…'
              : provider === 'gemini'
                ? 'AIza…'
                : 'sk-…'
          }
        />
        <span className="text-[10px] text-slate-500">
          Stored in browser localStorage. Never leaves your machine except to
          the provider you selected.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-slate-400">
          Base URL {provider === 'anthropic' ? '(ignored)' : '(optional)'}
        </span>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => onUpdate({ baseUrl: e.target.value })}
          spellCheck={false}
          className="bg-slate-800 border border-slate-600 rounded px-2 py-1 font-mono"
          placeholder={
            provider === 'openai'
              ? 'https://api.openai.com/v1 (default)'
              : provider === 'customOpenAI'
                ? 'https://… (OpenAI-compatible endpoint)'
                : provider === 'gemini'
                  ? 'https://generativelanguage.googleapis.com/v1beta (default)'
                  : ''
          }
          disabled={provider === 'anthropic'}
        />
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={showThinking}
          onChange={(e) => onUpdate({ showThinking: e.target.checked })}
          className="accent-fuchsia-500"
        />
        <span className="text-slate-300">
          Show agent thinking{' '}
          <span className="text-slate-500">
            (when the provider supports it)
          </span>
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-slate-400">
          Custom rules (appended to system prompt)
        </span>
        <textarea
          value={customRules}
          onChange={(e) => onUpdate({ customRules: e.target.value })}
          rows={3}
          spellCheck={false}
          className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[11px]"
          placeholder="e.g. Always add a 0.3s wait after Hebrew text lines."
        />
      </label>
    </div>
  );
}
