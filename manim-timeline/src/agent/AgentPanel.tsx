import { useEffect, useRef, useState } from 'react';
import type { AgentAction, AgentChatMessage } from './types';
import { useAgentStore } from './useAgentStore';
import type { ProviderId } from './providers';
import { buildScriptToTimelinePrompt } from './scriptToTimelinePrompt';
import { useSceneStore } from '@/store/useSceneStore';
import { summarizeCameraProposal } from './cameraProposalSummary';

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
    <div className="flex flex-col h-full text-ctl text-chalk">
      <div className="flex items-center gap-2 pb-2 mb-2 border-b border-rule shrink-0">
        <span className="text-meta text-chalk-dim truncate">
          {provider} · <span className="font-mono">{model || 'default'}</span>
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setScriptOpen((v) => !v)}
          className="px-2 py-1 text-meta rounded-ctl bg-raised hover:bg-rule transition-colors"
        >
          {scriptOpen ? 'Hide script' : 'Script'}
        </button>
        <button
          type="button"
          onClick={newChat}
          disabled={empty && status !== 'error'}
          className="px-2 py-1 text-meta rounded-ctl bg-raised hover:bg-rule disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Start a new conversation"
        >
          New chat
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          className="px-2 py-1 text-meta rounded-ctl bg-raised hover:bg-rule transition-colors"
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
          <div className="text-chalk-dim text-meta italic px-1 py-4 leading-relaxed">
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
          <div className="flex items-center gap-2 px-1 py-1 text-chalk-dim">
            <span className="inline-block w-2 h-2 rounded-full bg-raised animate-pulse" />
            Thinking…
          </div>
        )}
      </div>

      <div className="pt-2 mt-2 border-t border-rule shrink-0 flex flex-col gap-1">
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
          className="w-full resize-none bg-raised border border-rule rounded-ctl px-2 py-1.5 text-chalk focus:border-chalk-faint disabled:opacity-50"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={loading || !prompt.trim()}
            className="bg-highlight font-semibold text-highlight-ink enabled:hover:bg-highlight/90 px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed rounded-ctl transition-colors"
          >
            {loading ? 'Sending…' : 'Send'}
          </button>
          {loading && (
            <button
              type="button"
              onClick={cancelRequest}
              className="px-3 py-1.5 bg-raised hover:bg-rule rounded-ctl transition-colors"
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
    <div className="flex flex-col gap-2 p-2 mb-2 rounded-ctl border border-rule bg-ink/40 shrink-0">
      <div>
        <div className="text-meta text-chalk">
          Script to Timeline
        </div>
        <p className="mt-0.5 text-meta text-chalk-dim leading-relaxed">
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
        className="w-full resize-none bg-ink border border-rule rounded-ctl px-2 py-1.5 text-chalk focus:border-chalk-faint disabled:opacity-50"
        placeholder={'כותרת: משפט ערך הביניים\n\nנאמר ש־$f$ רציפה בקטע $[a,b]$...'}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading || !value.trim()}
          className="bg-highlight font-semibold text-highlight-ink enabled:hover:bg-highlight/90 px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed rounded-ctl transition-colors"
        >
          {loading ? 'Sending...' : 'Propose timeline'}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={loading || !value}
          className="px-3 py-1.5 bg-raised hover:bg-rule disabled:opacity-40 disabled:cursor-not-allowed rounded-ctl transition-colors"
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
      <div className="max-w-[88%] px-3 py-2 rounded-pop bg-raised text-chalk whitespace-pre-wrap break-words">
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
  const items = useSceneStore((s) => s.items);
  const frames = useSceneStore((s) => s.frames);
  const startFrameId = useSceneStore((s) => s.startFrameId);
  const cameraSummaries = summarizeCameraProposal(message.actions, items, frames, startFrameId);
  const hasErr = message.error && message.error.length > 0;
  const hasActions = !!message.actions && message.actions.length > 0;
  const pending = hasActions && message.actionsStatus === 'pending';
  const approved = hasActions && message.actionsStatus === 'approved';
  const rejected = hasActions && message.actionsStatus === 'rejected';
  const superseded = hasActions && message.actionsStatus === 'superseded';

  const borderClass = hasErr
    ? 'border-danger/50 bg-danger/10'
    : pending
      ? 'border-warn/45 bg-warn/5'
      : approved
        ? 'border-kind-axes/50 bg-kind-axes/10'
        : rejected || superseded
          ? 'border-rule bg-ink/40'
          : 'border-rule bg-raised';

  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[92%] w-full px-3 py-2 rounded-pop border ${borderClass} flex flex-col gap-2`}
      >
        {showThinking && message.thinking && (
          <details className="text-meta text-chalk-dim">
            <summary className="cursor-pointer select-none hover:text-chalk">
              Thinking…
            </summary>
            <div className="mt-1 pl-2 border-l border-rule whitespace-pre-wrap text-chalk-dim leading-relaxed">
              {message.thinking}
            </div>
          </details>
        )}

        <div className="whitespace-pre-wrap break-words text-chalk leading-relaxed">
          {message.content}
        </div>

        {hasErr && (
          <ul className="list-disc pl-4 space-y-0.5 text-danger text-meta">
            {message.error!.map((e, i) => (
              <li key={i} className="break-words">
                {e}
              </li>
            ))}
          </ul>
        )}

        {message.warnings && message.warnings.length > 0 && (
          <ul className="list-disc pl-4 space-y-0.5 text-warn text-meta">
            {message.warnings.map((w, i) => (
              <li key={i} className="break-words">
                {w}
              </li>
            ))}
          </ul>
        )}

        {cameraSummaries.length > 0 && <div className="rounded-ctl bg-ink/50 px-2 py-1 text-meta text-chalk">{cameraSummaries.map(({ clip, displayName, frameLabel, overrideLabel, overrideTime, returnStart, returnEnd, targetWidth }) => <div key={clip.id} dir="auto"><bdi dir="auto">{displayName}</bdi> → <bdi dir="auto">{frameLabel}</bdi>: <bdi dir="auto">{clip.startTime.toFixed(2)}–{(clip.startTime + clip.duration).toFixed(2)}s</bdi>, <bdi dir="auto">{clip.duration.toFixed(2)}s transition</bdi>, <bdi dir="auto">width {targetWidth.toFixed(2)} ({(clip.offsetX ?? 0).toFixed(2)}, {(clip.offsetY ?? 0).toFixed(2)})</bdi>{returnStart !== null && returnEnd !== null ? <>; full-frame return <bdi dir="auto">{returnStart.toFixed(2)}–{returnEnd.toFixed(2)}s</bdi></> : null}{overrideLabel ? <>; overridden by <bdi dir="auto">{overrideLabel}</bdi> at <bdi dir="auto">{overrideTime!.toFixed(2)}s</bdi></> : null}</div>)}</div>}

        {hasActions && (
          <div className="flex flex-col gap-1">
            <ul className="flex flex-col gap-0.5 font-mono text-meta text-chalk max-h-40 overflow-y-auto pr-1">
              {message.actions!.map((a, i) => (
                <ActionRow key={i} action={a} dim={!pending} />
              ))}
            </ul>
            {pending && (
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={onApprove}
                  className="bg-highlight font-semibold text-highlight-ink enabled:hover:bg-highlight/90 px-3 py-1 rounded-ctl transition-colors"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={onReject}
                  className="px-3 py-1 bg-raised hover:bg-rule rounded-ctl transition-colors"
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
              className="px-3 py-1 bg-raised hover:bg-rule rounded-ctl transition-colors"
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
      ? 'bg-kind-axes/10 text-kind-axes border-kind-axes/50'
      : tone === 'amber'
        ? 'bg-warn/10 text-warn border-warn/45'
        : 'bg-raised text-chalk-dim border-rule';
  return (
    <span
      className={`self-start mt-1 inline-block px-2 py-0.5 text-meta rounded-ctl border ${toneClass}`}
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
      <li className={`text-chalk ${dimClass}`}>
        <span className="text-chalk">CREATE</span> {it.kind}{' '}
        <code className="text-chalk-dim"><bdi dir="auto">{it.id}</bdi></code>
        {it.label ? <> “<bdi dir="auto">{it.label}</bdi>”</> : ''}
      </li>
    );
  }
  if (action.action === 'UPDATE') {
    const keys = Object.keys(action.updates ?? {}).slice(0, 6).join(', ');
    const detail = summarizeUpdateDetails(action.updates);
    return (
      <li className={`text-warn ${dimClass} flex flex-col gap-0.5`}>
        <div>
          <span className="text-warn">UPDATE</span>{' '}
          <code className="text-chalk-dim"><bdi dir="auto">{action.itemId}</bdi></code>{' '}
          <span className="text-chalk-dim">{`{${keys}}`}</span>
        </div>
        {detail.length > 0 && (
          <div className="text-meta text-warn">
            {detail.join(' | ')}
          </div>
        )}
      </li>
    );
  }
  return (
    <li className={`text-danger ${dimClass}`}>
      <span className="text-danger">DELETE</span>{' '}
      <code className="text-chalk-dim"><bdi dir="auto">{action.itemId}</bdi></code>
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
    <div className="flex flex-col gap-2 p-2 mb-2 rounded-ctl border border-rule bg-raised shrink-0">
      <div className="text-meta text-chalk-dim">
        Settings
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-chalk-dim">Provider</span>
        <select
          value={provider}
          onChange={(e) => onProvider(e.target.value as ProviderId)}
          className="bg-raised border border-rule rounded-ctl px-2 py-1"
        >
          {PROVIDER_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-chalk-dim">Model</span>
        <input
          type="text"
          value={model}
          onChange={(e) => onUpdate({ model: e.target.value })}
          spellCheck={false}
          className="bg-raised border border-rule rounded-ctl px-2 py-1 font-mono"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-chalk-dim">API key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => onUpdate({ apiKey: e.target.value })}
          spellCheck={false}
          autoComplete="off"
          className="bg-raised border border-rule rounded-ctl px-2 py-1 font-mono"
          placeholder={
            provider === 'anthropic'
              ? 'sk-ant-…'
              : provider === 'gemini'
                ? 'AIza…'
                : 'sk-…'
          }
        />
        <span className="text-meta text-chalk-faint">
          Stored in browser localStorage. Never leaves your machine except to
          the provider you selected.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-chalk-dim">
          Base URL {provider === 'anthropic' ? '(ignored)' : '(optional)'}
        </span>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => onUpdate({ baseUrl: e.target.value })}
          spellCheck={false}
          className="bg-raised border border-rule rounded-ctl px-2 py-1 font-mono"
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
          className="accent-highlight"
        />
        <span className="text-chalk-dim">
          Show agent thinking{' '}
          <span className="text-chalk-faint">
            (when the provider supports it)
          </span>
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-chalk-dim">
          Custom rules (appended to system prompt)
        </span>
        <textarea
          value={customRules}
          onChange={(e) => onUpdate({ customRules: e.target.value })}
          rows={3}
          spellCheck={false}
          className="bg-raised border border-rule rounded-ctl px-2 py-1 text-meta"
          placeholder="e.g. Always add a 0.3s wait after Hebrew text lines."
        />
      </label>
    </div>
  );
}
