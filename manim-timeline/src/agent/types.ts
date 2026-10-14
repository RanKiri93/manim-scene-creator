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
  'graphCurve',
  'graphDot',
  'graphFunctionSeries',
  'graphPointSequence',
  'shape',
  'surroundingRect',
  'exit_animation',
  'blink_animation',
  'target_animation',
  'camera_move',
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
  'mathChildMeasures',
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

/** Slim frame-catalog entry so the agent can reference frames by id. */
export interface AgentFrameInfo {
  id: ItemId;
  label?: string;
  col: number;
  row: number;
}

/** Payload shape the agent receives in every request. */
export interface AgentContextPayload {
  projectDefaults: SceneDefaults;
  /** Playhead position in seconds; use as `startTime` when the user asks to add "now". */
  currentTimeSec: number;
  existingItems: MinimalSceneItem[];
  /** Camera-grid frames (id + label + grid cell) the model may reference. */
  frames: AgentFrameInfo[];
  startFrameId: ItemId | null;
  /** Frame new drawable items belong to unless the model picks another valid frame. */
  activeFrameId: ItemId | null;
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
  /** Frozen camera-relevant request fingerprint, used only to gate approval. */
  cameraSnapshotKey?: string;
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
                    description: 'For camera_move use targetMode (frame, region, or object), targetFrameId, targetId or region bounds as appropriate. Request-only descriptors are resolved and stripped before persistence.',
                  },
                  targetMode: { type: 'string', enum: ['frame', 'region', 'object'], description: 'Request-only camera target mode; resolved and removed before persistence.' },
                  targetId: { type: 'string', description: 'Request-only exact existing object id for snapshot fitting.' },
                  region: { type: 'object', description: 'Request-only finite world-space rectangle.', properties: { left: { type: 'number' }, right: { type: 'number' }, bottom: { type: 'number' }, top: { type: 'number' } } },
                  targetFrameId: { type: 'string', description: 'Existing camera destination frame id.' },
                  targetWidth: { type: 'number', description: 'Positive absolute camera width in Manim units.' },
                  offsetX: { type: 'number' }, offsetY: { type: 'number' },
                  startTime: { type: 'number' }, duration: { type: 'number' },
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
                properties: {
                  targetMode: { type: 'string', enum: ['frame', 'region', 'object'], description: 'camera_move UPDATE request-only target descriptor; resolved before persistence.' },
                  targetId: { type: 'string', description: 'camera_move UPDATE request-only exact existing object id for snapshot fitting.' },
                  region: { type: 'object', description: 'camera_move UPDATE request-only finite world-space target rectangle.', properties: { left: { type: 'number' }, right: { type: 'number' }, bottom: { type: 'number' }, top: { type: 'number' } } },
                  targetFrameId: { type: 'string', description: 'camera_move UPDATE: existing destination frame id.' },
                  targetWidth: { type: 'number', description: 'camera_move UPDATE: positive absolute camera width.' },
                  offsetX: { type: 'number', description: 'camera_move UPDATE: finite horizontal offset.' },
                  offsetY: { type: 'number', description: 'camera_move UPDATE: finite vertical offset.' },
                  startTime: { type: 'number', description: 'camera_move UPDATE: finite start time in seconds.' },
                  duration: { type: 'number', description: 'camera_move UPDATE: duration at least 0.05 seconds.' },
                },
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
