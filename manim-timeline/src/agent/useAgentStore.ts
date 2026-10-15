import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useSceneStore } from '@/store/useSceneStore';
import { buildContextPayload, stripUiFields } from './serialize';
import { buildSystemPrompt } from './systemPrompt';
import { validateAgentResponse } from './validate';
import { commitActions } from './commit';
import {
  getLoopProvider,
  getProvider,
  AgentProviderError,
  type ProviderConfig,
  type ProviderId,
} from './providers';
import type { AgentAction, AgentChatMessage } from './types';
import { DraftSession } from './loop/draft';
import { runAgentLoop } from './loop/runAgentLoop';
import { loopToolSpecs } from './loop/tools';
import { loopToolEnv } from './loop/env';
import type { LoopLogEntry, LoopProvider } from './loop/types';
import { DEFAULT_ANTHROPIC_MODEL } from './providers/anthropic';
import { DEFAULT_OPENAI_MODEL } from './providers/openai';
import { resolveCameraRequests } from './cameraRequests';

export type AgentStatus = 'idle' | 'loading' | 'error';

export interface AgentSettings extends ProviderConfig {
  /** Free-text rules appended to the system prompt on every request. */
  customRules: string;
  /** If true, send reasoning/thinking requests to providers that support it. */
  showThinking: boolean;
  /**
   * Let the Copilot work in a tool loop (propose → check → fix) on providers that support it
   * (Anthropic, OpenAI, OpenAI-compatible). Off = one structured reply per message.
   */
  useToolLoop: boolean;
  /** Apply the loop's finished draft immediately as one undo step instead of waiting for Approve. */
  autoApply: boolean;
}

/** Cap on persisted message history to keep localStorage bounded. */
const MAX_PERSISTED_MESSAGES = 100;

interface AgentSession {
  status: AgentStatus;
  messages: AgentChatMessage[];
  /** Which assistant message's pending actions drive the canvas preview. */
  activePreviewMessageId: string | null;
  /** Tool loop: the draft while the Copilot works (drives the canvas preview). Not persisted. */
  draftActions: AgentAction[] | null;
  /** Tool loop: what the Copilot has done so far this turn. Not persisted. */
  loopLog: LoopLogEntry[];
}

interface AgentStoreShape extends AgentSettings, AgentSession {
  /** Live abort controller for an in-flight request. Not persisted. */
  _abort: AbortController | null;

  updateSettings: (patch: Partial<AgentSettings>) => void;
  setProvider: (provider: ProviderId) => void;

  sendMessage: (prompt: string) => Promise<void>;
  cancelRequest: () => void;
  approveMessage: (messageId: string) => void;
  rejectMessage: (messageId: string) => void;
  regenerateLast: () => Promise<void>;
  newChat: () => void;
}

const INITIAL_SESSION: AgentSession & { _abort: null } = {
  status: 'idle',
  messages: [],
  activePreviewMessageId: null,
  draftActions: null,
  loopLog: [],
  _abort: null,
};

const INITIAL_SETTINGS: AgentSettings = {
  provider: 'openai',
  apiKey: '',
  baseUrl: '',
  model: DEFAULT_OPENAI_MODEL,
  customRules: '',
  showThinking: true,
  useToolLoop: true,
  autoApply: true,
};

function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Demote any assistant messages with `actionsStatus === 'pending'` to
 * `'superseded'` so the canvas merge code always has at most one active
 * preview set. We keep them visible in the transcript with a pill in the UI.
 */
function supersedePending(messages: AgentChatMessage[]): AgentChatMessage[] {
  let changed = false;
  const next = messages.map((m) => {
    if (m.role === 'assistant' && m.actionsStatus === 'pending') {
      changed = true;
      return { ...m, actionsStatus: 'superseded' as const };
    }
    return m;
  });
  return changed ? next : messages;
}

export const useAgentStore = create<AgentStoreShape>()(
  persist(
    (set, get) => {
      /**
       * Shared implementation of sending a user turn. Extracted so
       * `regenerateLast` can reuse it without re-typing the prompt into the
       * transcript (it drops the previous assistant turn and re-sends the
       * existing last user turn).
       */
      /** Tool-loop turn: the Copilot drafts, checks and fixes its changes before finishing. */
      const runLoopTurn = async (
        loopProvider: LoopProvider,
        req: {
          controller: AbortController;
          payload: ReturnType<typeof buildContextPayload>;
          history: AgentChatMessage[];
          userPrompt: string;
          cameraSnapshotKey: string;
          base: ConstructorParameters<typeof DraftSession>[0];
        },
      ): Promise<void> => {
        const state = get();
        set((s) => ({ ...s, messages: supersedePending(s.messages), activePreviewMessageId: null, draftActions: [], loopLog: [] }));
        const session = new DraftSession(req.base);
        const env = loopToolEnv();
        try {
          const conversation = loopProvider.startConversation({
            systemPrompt: buildSystemPrompt(state.customRules, 'loop'),
            history: req.history,
            payload: req.payload,
            userPrompt: req.userPrompt,
            tools: loopToolSpecs(env),
            includeThinking: state.showThinking,
          });
          const outcome = await runAgentLoop({
            conversation,
            session,
            env,
            signal: req.controller.signal,
            onProgress: (p) => {
              if (get()._abort === req.controller) set({ draftActions: p.draft, loopLog: p.log });
            },
          });
          if (get()._abort !== req.controller) return;
          const hasActions = outcome.actions.length > 0;
          const autoApply = hasActions && get().autoApply && !outcome.stoppedEarly;
          if (autoApply) commitActions(outcome.actions);
          const touchesCamera = outcome.actions.some(
            (a) =>
              (a.action === 'CREATE' && a.item.kind === 'camera_move') ||
              (a.action === 'UPDATE' && req.base.items.get(a.itemId)?.kind === 'camera_move'),
          );
          const message: AgentChatMessage = {
            id: nextId('asst'),
            createdAt: Date.now(),
            role: 'assistant',
            content: outcome.reply,
            ...(outcome.thinking ? { thinking: outcome.thinking } : {}),
            ...(outcome.warnings.length ? { warnings: outcome.warnings } : {}),
            ...(outcome.log.length ? { log: outcome.log } : {}),
            ...(hasActions
              ? {
                  actions: outcome.actions,
                  actionsStatus: autoApply ? ('approved' as const) : ('pending' as const),
                  ...(autoApply ? { autoApplied: true } : {}),
                  ...(!autoApply && touchesCamera ? { cameraSnapshotKey: req.cameraSnapshotKey } : {}),
                }
              : {}),
          };
          set((s) => ({
            ...s,
            status: 'idle',
            messages: [...supersedePending(s.messages), message],
            activePreviewMessageId: hasActions && !autoApply ? message.id : null,
            draftActions: null,
            loopLog: [],
            _abort: null,
          }));
        } catch (err) {
          if ((err as DOMException)?.name === 'AbortError') {
            set({ status: 'idle', _abort: null, draftActions: null, loopLog: [] });
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          const log = get().loopLog;
          set((s) => ({
            ...s,
            status: 'error',
            messages: [
              ...s.messages,
              {
                id: nextId('asst'),
                createdAt: Date.now(),
                role: 'assistant',
                content: 'The request failed.',
                error: [msg],
                ...(log.length ? { log } : {}),
              },
            ],
            draftActions: null,
            loopLog: [],
            _abort: null,
          }));
        }
      };

      const runTurn = async (): Promise<void> => {
        const state = get();
        const messages = state.messages;
        const lastUser = [...messages]
          .reverse()
          .find((m) => m.role === 'user');
        if (!lastUser) return;

        const prev = state._abort;
        if (prev) prev.abort();
        const controller = new AbortController();
        set({
          status: 'loading',
          _abort: controller,
        });

        const sceneState = useSceneStore.getState();
        const requestItems = new Map(sceneState.items);
        const requestFrames = sceneState.frames.map((frame) => ({ ...frame }));
        const requestTime = sceneState.currentTime;
        const cameraSnapshotKey = cameraContextKey(requestItems, requestFrames, sceneState.startFrameId);
        const payload = buildContextPayload({
          defaults: sceneState.defaults,
          currentTime: sceneState.currentTime,
          items: sceneState.items,
          frames: sceneState.frames,
          startFrameId: sceneState.startFrameId,
          activeFrameId: sceneState.activeFrameId,
        });
        const systemPrompt = buildSystemPrompt(state.customRules);
        // Everything preceding the most recent user turn is "history".
        const lastUserIdx = messages.lastIndexOf(lastUser);
        const history = messages.slice(0, lastUserIdx);

        const loopProvider = state.useToolLoop
          ? getLoopProvider({
              provider: state.provider,
              apiKey: state.apiKey,
              baseUrl: state.baseUrl,
              model: state.model,
            })
          : null;
        if (loopProvider) {
          await runLoopTurn(loopProvider, {
            controller,
            payload,
            history,
            userPrompt: lastUser.content,
            cameraSnapshotKey,
            base: {
              items: requestItems,
              frames: requestFrames,
              startFrameId: sceneState.startFrameId,
              activeFrameId: sceneState.activeFrameId,
              defaults: sceneState.defaults,
              audioItems: sceneState.audioItems,
              currentTimeSec: requestTime,
            },
          });
          return;
        }

        try {
          const provider = getProvider({
            provider: state.provider,
            apiKey: state.apiKey,
            baseUrl: state.baseUrl,
            model: state.model,
          });
          const raw = await provider.generate({
            payload,
            systemPrompt,
            history,
            userPrompt: lastUser.content,
            includeThinking: state.showThinking,
            signal: controller.signal,
          });
          const normalizedRaw = resolveCameraRequests(raw, {
            currentTimeSec: requestTime,
            items: requestItems,
            frames: requestFrames,
            startFrameId: sceneState.startFrameId,
            activeFrameId: sceneState.activeFrameId,
          });
          const result = validateAgentResponse(
            normalizedRaw,
            requestItems,
            {
              frameIds: sceneState.frames.map((f) => f.id),
              frames: requestFrames,
              activeFrameId: sceneState.activeFrameId,
              startFrameId: sceneState.startFrameId,
            },
          );
          if (!result.ok) {
            const errorMsg: AgentChatMessage = {
              id: nextId('asst'),
              createdAt: Date.now(),
              role: 'assistant',
              content: "I couldn't produce a valid response — see errors below.",
              error: result.errors,
            };
            set((s) => ({
              ...s,
              status: 'error',
              messages: [...s.messages, errorMsg],
              _abort: null,
            }));
            return;
          }
          const resp = result.response;
          const hasActions = resp.actions.length > 0;
          const newAssistant: AgentChatMessage = {
            id: nextId('asst'),
            createdAt: Date.now(),
            role: 'assistant',
            content: resp.reply,
            ...(resp.thinking ? { thinking: resp.thinking } : {}),
            ...(result.warnings.length ? { warnings: result.warnings } : {}),
            ...(hasActions
              ? {
                  actions: resp.actions,
                  actionsStatus: 'pending' as const,
                  ...(resp.actions.some((action) => action.action === 'CREATE' && action.item.kind === 'camera_move' || action.action === 'UPDATE' && requestItems.get(action.itemId)?.kind === 'camera_move') ? { cameraSnapshotKey } : {}),
                }
              : {}),
          };
          set((s) => {
            const superseded = supersedePending(s.messages);
            return {
              ...s,
              status: 'idle',
              messages: [...superseded, newAssistant],
              activePreviewMessageId: hasActions ? newAssistant.id : null,
              _abort: null,
            };
          });
        } catch (err) {
          if ((err as DOMException)?.name === 'AbortError') {
            set({ status: 'idle', _abort: null });
            return;
          }
          const msg =
            err instanceof AgentProviderError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          const errorMsg: AgentChatMessage = {
            id: nextId('asst'),
            createdAt: Date.now(),
            role: 'assistant',
            content: 'The request failed.',
            error: [msg],
          };
          set((s) => ({
            ...s,
            status: 'error',
            messages: [...s.messages, errorMsg],
            _abort: null,
          }));
        }
      };

      return {
        ...INITIAL_SETTINGS,
        ...INITIAL_SESSION,

        updateSettings: (patch) =>
          set((s) => ({ ...s, ...patch })),

        setProvider: (provider) =>
          set((s) => ({
            ...s,
            provider,
            model: pickDefaultModel(provider, s.model),
          })),

        sendMessage: async (prompt) => {
          const trimmed = prompt.trim();
          if (!trimmed) return;
          const userMsg: AgentChatMessage = {
            id: nextId('user'),
            createdAt: Date.now(),
            role: 'user',
            content: trimmed,
          };
          set((s) => ({
            ...s,
            messages: [...s.messages, userMsg],
          }));
          await runTurn();
        },

        cancelRequest: () => {
          const ctrl = get()._abort;
          if (ctrl) ctrl.abort();
          set({ status: 'idle', _abort: null, draftActions: null, loopLog: [] });
        },

        approveMessage: (messageId) => {
          const msg = get().messages.find((m) => m.id === messageId);
          if (
            !msg ||
            msg.role !== 'assistant' ||
            !msg.actions ||
            msg.actionsStatus !== 'pending'
          ) {
            return;
          }
          if (msg.cameraSnapshotKey && msg.cameraSnapshotKey !== cameraContextKey(useSceneStore.getState().items, useSceneStore.getState().frames, useSceneStore.getState().startFrameId)) {
            set((s) => ({ ...s, messages: s.messages.map((m) => m.id === messageId ? { ...m, actionsStatus: 'rejected' as const, error: ['Camera proposal is stale: frames, target geometry, or camera schedule changed after the request. Ask Copilot to re-propose against the current scene.'] } : m), activePreviewMessageId: s.activePreviewMessageId === messageId ? null : s.activePreviewMessageId }));
            return;
          }
          commitActions(msg.actions);
          set((s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === messageId
                ? { ...m, actionsStatus: 'approved' as const }
                : m,
            ),
            activePreviewMessageId:
              s.activePreviewMessageId === messageId
                ? null
                : s.activePreviewMessageId,
          }));
        },

        rejectMessage: (messageId) => {
          set((s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === messageId && m.actionsStatus === 'pending'
                ? { ...m, actionsStatus: 'rejected' as const }
                : m,
            ),
            activePreviewMessageId:
              s.activePreviewMessageId === messageId
                ? null
                : s.activePreviewMessageId,
          }));
        },

        regenerateLast: async () => {
          set((s) => {
            // Drop trailing assistant messages so `runTurn` re-sends the
            // previous user turn. Also clear the active preview if it was
            // attached to a message we're about to remove.
            const msgs = [...s.messages];
            while (
              msgs.length > 0 &&
              msgs[msgs.length - 1]!.role === 'assistant'
            ) {
              msgs.pop();
            }
            return {
              ...s,
              messages: msgs,
              activePreviewMessageId: null,
            };
          });
          await runTurn();
        },

        newChat: () => {
          const ctrl = get()._abort;
          if (ctrl) ctrl.abort();
          set({
            status: 'idle',
            messages: [],
            activePreviewMessageId: null,
            draftActions: null,
            loopLog: [],
            _abort: null,
          });
        },
      };
    },
    {
      name: 'manim-timeline.agent-settings',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        provider: s.provider,
        apiKey: s.apiKey,
        baseUrl: s.baseUrl,
        model: s.model,
        customRules: s.customRules,
        showThinking: s.showThinking,
        useToolLoop: s.useToolLoop,
        autoApply: s.autoApply,
        messages: s.messages.slice(-MAX_PERSISTED_MESSAGES),
        activePreviewMessageId: s.activePreviewMessageId,
      }),
      version: 3,
      migrate: (persisted, fromVersion) => {
        let state = (persisted ?? {}) as Partial<AgentStoreShape>;
        // v1 persisted only the provider settings; chat state starts empty.
        if (fromVersion < 2) {
          state = {
            ...INITIAL_SETTINGS,
            ...(state as Partial<AgentSettings>),
            messages: [],
            activePreviewMessageId: null,
          };
        }
        // v3: the old default models were retired.
        if (fromVersion < 3 && typeof state.model === 'string' && RETIRED_DEFAULT_MODELS[state.model]) {
          state = { ...state, model: RETIRED_DEFAULT_MODELS[state.model] };
        }
        return state;
      },
    },
  ),
);

/**
 * Pick a sensible default model when the user switches providers, but preserve
 * the user's current model if it looks appropriate for the new provider.
 */
function pickDefaultModel(provider: ProviderId, current: string): string {
  if (provider === 'anthropic') {
    if (current.startsWith('claude-')) return current;
    return DEFAULT_ANTHROPIC_MODEL;
  }
  if (provider === 'openai') {
    if (current.startsWith('gpt-') || /^o\d/.test(current)) return current;
    return DEFAULT_OPENAI_MODEL;
  }
  if (provider === 'gemini') {
    if (current.startsWith('gemini-')) return current;
    return 'gemini-2.5-flash';
  }
  return current || DEFAULT_OPENAI_MODEL;
}

/** Former built-in defaults that are retired or far behind; replaced on load. */
const RETIRED_DEFAULT_MODELS: Record<string, string> = {
  'claude-3-5-sonnet-latest': DEFAULT_ANTHROPIC_MODEL,
  'gpt-4o-mini': DEFAULT_OPENAI_MODEL,
};

function cameraContextKey(items: Map<string, import('@/types/scene').SceneItem>, frames: readonly import('@/types/scene').FrameDef[], startFrameId: string | null): string {
  const serialized = [...items.values()].sort((a, b) => a.id.localeCompare(b.id)).map((item) => {
    const visible = stripUiFields(item) as Record<string, unknown>;
    if (item.kind === 'axes') {
      visible.axisPreviewHash = item.axisPreviewHash;
      visible.axisPreviewBounds = item.axisPreviewBounds;
    } else if (item.kind === 'textLine') {
      const measure = item.measure;
      visible.measureInk = measure ? {
        width: measure.width, height: measure.height, widthInk: measure.widthInk, heightInk: measure.heightInk,
        offsetInkX: measure.offsetInkX, offsetInkY: measure.offsetInkY, inkLeftX: measure.inkLeftX,
        inkRightX: measure.inkRightX, inkTopY: measure.inkTopY, inkBottomY: measure.inkBottomY,
      } : null;
    }
    return visible;
  });
  return JSON.stringify({ frames, startFrameId, items: serialized });
}
