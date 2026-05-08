import type {
  ItemId,
  SceneDefaults,
  SceneItem,
} from '@/types/scene';

/**
 * Whitelist of SceneItem kinds the agent is allowed to produce.
 * `graphArea` and `graphField` remain rejected — create those in the UI.
 */
export const AGENT_ALLOWED_KINDS = [
  'textLine',
  'axes',
  'graphPlot',
  'graphDot',
  'graphFunctionSeries',
  'shape',
  'surroundingRect',
  'exit_animation',
  'blink_animation',
] as const;

export type AgentAllowedKind = (typeof AGENT_ALLOWED_KINDS)[number];

export function isAgentAllowedKind(
  kind: unknown,
): kind is AgentAllowedKind {
  return (
    typeof kind === 'string' &&
    (AGENT_ALLOWED_KINDS as readonly string[]).includes(kind)
  );
}

/** Fields that only exist on the client and must never be sent to / received from the LLM. */
export const AGENT_UI_ONLY_FIELDS = [
  'measure',
  'previewDataUrl',
  'segmentMeasures',
  'measureError',
  'perNErrors',
  'topLevelError',
  'streamPlacementActive',
  'axisPreviewDataUrl',
  'axisPreviewError',
  'axisPreviewHash',
  'axisPreviewBounds',
] as const;

export type AgentUiOnlyField = (typeof AGENT_UI_ONLY_FIELDS)[number];

/**
 * A `SceneItem` with UI-only transient fields stripped. The agent sees these
 * in the context payload and must not emit them in its response.
 */
export type MinimalSceneItem = Omit<SceneItem, AgentUiOnlyField>;

/** Payload shape the agent receives in every request. */
export interface AgentContextPayload {
  projectDefaults: SceneDefaults;
  /** Playhead position in seconds; use as `startTime` when the user asks to add "now". */
  currentTimeSec: number;
  existingItems: MinimalSceneItem[];
}

export type AgentAction =
  | { action: 'CREATE'; item: SceneItem }
  | { action: 'UPDATE'; itemId: ItemId; updates: Partial<SceneItem> }
  | { action: 'DELETE'; itemId: ItemId };

/**
 * Validated envelope emitted by the LLM on every turn.
 * `reply` is the conversational message shown in the chat bubble.
 * `actions` may be empty when the model is only discussing or asking a question.
 * `thinking` is the provider's reasoning/thought summary, when available.
 */
export interface AgentChatResponse {
  reply: string;
  actions: AgentAction[];
  thinking?: string;
}

export type AgentMessageStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'superseded';

/** One entry in the persisted chat log. */
export interface AgentChatMessage {
  id: string;
  createdAt: number;
  role: 'user' | 'assistant';
  /** User prompt text, or assistant reply text. Never empty. */
  content: string;
  /** Assistant only: provider reasoning/thought summary. */
  thinking?: string;
  /** Assistant only: proposed CREATE/UPDATE/DELETE actions. `[]` or omitted = pure chat. */
  actions?: AgentAction[];
  /** Assistant only, set when `actions` is non-empty. */
  actionsStatus?: AgentMessageStatus;
  /** Attached to an assistant turn that failed validation or a provider error. */
  error?: string[];
}

/**
 * JSON Schema passed to OpenAI Structured Outputs (`response_format`, with
 * `strict: false`) and Anthropic tool `input_schema`. We use `anyOf` — NOT
 * `oneOf` — because OpenAI's Structured Outputs subset rejects `oneOf` outright
 * (even in non-strict mode recent model snapshots are picky). Anthropic accepts
 * either. Individual SceneItem fields are validated in TypeScript via
 * `validateAgentResponse` — keeping the schema flexible (via
 * `additionalProperties: true` on the `item` / `updates` sub-objects) avoids
 * brittleness across the ~10 SceneItem variants.
 */
export const AGENT_CHAT_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'actions'],
  properties: {
    reply: {
      type: 'string',
      description:
        'The conversational message shown to the user. Required and non-empty. ' +
        'Use this to explain changes, ask clarifying questions, or discuss the scene. ' +
        'When you are only talking (not proposing edits), set `actions` to an empty array.',
    },
    actions: {
      type: 'array',
      description:
        'Ordered list of structural edits. Empty array means a pure chat reply with no scene changes.',
      items: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['action', 'item'],
            properties: {
              action: { type: 'string', enum: ['CREATE'] },
              item: {
                type: 'object',
                additionalProperties: true,
                required: ['id', 'kind'],
                properties: {
                  id: { type: 'string', minLength: 1 },
                  kind: {
                    type: 'string',
                    enum: [...AGENT_ALLOWED_KINDS],
                  },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['action', 'itemId', 'updates'],
            properties: {
              action: { type: 'string', enum: ['UPDATE'] },
              itemId: { type: 'string', minLength: 1 },
              updates: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['action', 'itemId'],
            properties: {
              action: { type: 'string', enum: ['DELETE'] },
              itemId: { type: 'string', minLength: 1 },
            },
          },
        ],
      },
    },
  },
} as const;
