# AI Copilot — Architecture & Integration Guide

This document explains the AI Agent integration that lives under `src/agent/`. It is written for an engineer (or another AI assistant) who needs to understand, extend, or debug the Copilot without re-deriving it from code.

The Copilot is a **chat-style assistant** for the Manim Timeline scene. The user holds a multi-turn conversation with it; on each turn the assistant may reply with plain text (discussion, clarifying questions, explanations) and/or propose structural edits (CREATE / UPDATE / DELETE of `SceneItem`s). Every proposal is rendered as a **preview** on the canvas and timeline, and only mutates the real Zustand store after the user clicks **Approve** on that specific assistant message.

---

## 1. High-level flow

```
┌────────────────┐   user msg  ┌────────────────────┐   JSON reply   ┌────────────┐
│  AgentPanel UI │ ──────────► │ useAgentStore       │ ─────────────► │ Provider   │
│  (chat + input)│             │ .sendMessage        │                │ (OpenAI /  │
└────────────────┘             │ (history + payload) │                │ Anthropic/ │
        ▲                      └──────┬──────────────┘                │ Gemini /   │
        │  assistant msg              │                               │ custom)    │
        │  (reply, thinking?,         │ validate + normalize           └────────────┘
        │   actions, actionsStatus)   ▼
        │                      ┌─────────────────────┐
        │                      │ messages[]          │
        │                      │ activePreviewMsgId  │
        │                      └──────┬──────────────┘
        │                             │ one message's actions drive the preview
        │                             ▼
┌───────┴────────┐     reads   ┌──────────────┐
│ SceneCanvas    │ ◄────────── │ usePreview*  │ ──► Timeline
│ + Timeline     │  (opacity + │ selectors    │
│ (preview skin) │   dashed)   └──────────────┘
        │
        │ Approve on that message
        ▼
  commitActions() ──► useSceneStore CRUD  ──► zundo snapshot
```

Key ideas:

- The real scene state (`useSceneStore`) is **never mutated** until the user approves a specific assistant message. The preview is a *virtual* merge the canvas/timeline render through.
- **At most one** assistant message drives the preview at a time (`activePreviewMessageId`). When a newer assistant turn proposes fresh actions, any still-`pending` prior proposal is automatically demoted to `superseded` so the canvas stays coherent.
- Both the user-visible transcript and the persisted settings live in `useAgentStore`. History is sent to the LLM on every turn so the conversation actually feels like a conversation.

---

## 2. File map

All paths are relative to `src/agent/`.

| File | Role |
| --- | --- |
| `types.ts` | Data contract: `AgentContextPayload`, `AgentAction`, `AgentChatMessage`, `AgentChatResponse`, `AGENT_CHAT_RESPONSE_JSON_SCHEMA`, `AGENT_ALLOWED_KINDS`, `AGENT_UI_ONLY_FIELDS`. |
| `serialize.ts` | `buildContextPayload()` + `stripUiFields()` — produce the slim JSON the LLM sees. |
| `systemPrompt.ts` | `BASE_SYSTEM_PROMPT` + `buildSystemPrompt(customRules)`. |
| `validate.ts` | `validateAgentResponse()` — strict cross-action invariants, per-kind normalizers, and forgiving auto-repair. |
| `commit.ts` | `commitActions(actions)` — applies an approved action list to `useSceneStore`. |
| `previewSelectors.ts` | `usePreviewMergedItems()`, `usePreviewOps()`, `buildPreviewState(items, actions)`. |
| `useAgentStore.ts` | Zustand store: persisted provider settings + persisted chat log + ephemeral request state. |
| `AgentPanel.tsx` | The React chat UI (transcript, per-message Approve/Reject, collapsible Thinking, Settings, New chat). |
| `providers/types.ts` | `AgentProvider`, `ProviderConfig`, `ProviderId`, `AgentProviderError`, `ProviderGenerateInput` (with `history` + `includeThinking`). |
| `providers/openai.ts` | OpenAI Chat Completions + Structured Outputs (`response_format.json_schema`), with optional `reasoning_effort` for o-series / gpt-5. |
| `providers/anthropic.ts` | Anthropic Messages API with forced tool use (`emit_response` tool) + optional `thinking` blocks. |
| `providers/gemini.ts` | Google Gemini `generateContent` with forced function calling (`emit_response`), Gemini-tuned flat schema, optional `thinkingConfig.includeThoughts`. |
| `providers/index.ts` | `getProvider(cfg)` factory. |
| `validate.test.ts` / `serialize.test.ts` | Vitest coverage for the agent-side invariants. |

`AgentPanel` is mounted from `App.tsx` via a `FloatingPanel`, toggled by the `agentOpen` UI slice on `useSceneStore`.

---

## 3. Data contract (`types.ts`)

### 3.1 Context sent to the LLM

```ts
interface AgentContextPayload {
  projectDefaults: ProjectDefaults;    // constants from useSceneStore.defaults
  currentTimeSec: number;              // wall-clock position on the timeline
  existingItems: MinimalSceneItem[];   // UI-only fields stripped
}
```

`MinimalSceneItem = Omit<SceneItem, AgentUiOnlyField>`, where `AGENT_UI_ONLY_FIELDS` currently removes:

```
measure, previewDataUrl, measureError, segmentMeasures,
topLevelError, streamPlacementActive
```

These are runtime-only artefacts (glyph metrics, raster caches, error surfaces). They would blow the token budget and confuse the model. They must **never** appear in CREATE items or UPDATE patches either; the validator rejects responses that contain them.

### 3.2 Response the LLM must emit

```ts
interface AgentChatResponse {
  reply: string;              // conversational message, required, non-empty
  actions: AgentAction[];     // may be empty (pure chat)
  thinking?: string;          // reasoning summary, when provider exposes it
}

type AgentAction =
  | { action: 'CREATE'; item: SceneItem }
  | { action: 'UPDATE'; itemId: ItemId; updates: Partial<SceneItem> }
  | { action: 'DELETE'; itemId: ItemId };
```

`reply` is the text shown in the assistant's chat bubble. An empty `actions` array is explicitly allowed and means "I'm only chatting / asking / answering — no scene edits this turn." The validator tolerates a missing `actions` field (treats it as `[]`) and also accepts a legacy `rationale` key as a fallback for the new `reply` key, so old provider adapters or cached responses don't break hard.

### 3.2a Persisted chat log

```ts
interface AgentChatMessage {
  id: string;
  createdAt: number;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  actions?: AgentAction[];
  actionsStatus?: 'pending' | 'approved' | 'rejected' | 'superseded';
  error?: string[];
}
```

The store keeps an ordered `messages: AgentChatMessage[]` log. On each turn the entire log is sent to the LLM as conversation history (see §6) alongside the current scene payload.

### 3.3 v1 kind whitelist

Only these `kind` values may appear in CREATE actions (see `AGENT_ALLOWED_KINDS` in `types.ts`):

```
textLine, axes, graphPlot, graphCurve, graphDot, graphFunctionSeries, graphPointSequence,
shape, surroundingRect, exit_animation, blink_animation, target_animation
```

`graphArea` and `graphField` remain UI-only creations for now (not agent-emitted).

**`target_animation`** — Permanent timed effects on existing drawable items: `mode` is one of `scale`, `color`, `move`, `path`, `rotate`; each `targets[]` row references `targetId` and mode-specific fields (`scaleFactor`, `color`, `dx`/`dy`, `pathKind` + `pathPoints` or `parametricPath`, `angleDeg`, optional `segmentIndices` / `mathSubtargets` for refined text/math targeting). Cross-reference validation uses `canBeTargetAnimationTargetKind(mode, resolvedKind)` (see `validate.ts`). Normalization fills defaults and coerces path/parametric payloads (`normalizeTargetAnimation`).

For `graphFunctionSeries`, the normalizer in `validate.ts` upholds:

- `axesId` must point at an existing `axes` item (same rule as `graphPlot` / `graphDot`; the auto-link pass in §7.1 applies).
- Both `jsExpr` (canvas preview + validation) and `pyExpr` (Manim export) must be derivable — same alias chain as `graphPlot`, but **no silent default curve** if every dialect is absent.
- `nMin` / `nMax` must be integers; reversed ranges are swapped; `nMin === nMax` is widened by +1 so playback is non-empty (matches factory behaviour).
- Clip `duration`: preserved when the model supplies a finite `duration`; otherwise derived from `functionSeriesTotalDuration` (aligned with `createGraphFunctionSeries` in `store/factories.ts`).
- `mode: 'replacement'` has a **single-on-scene-mobject** invariant — the first curve `n_1` is morphed in place through every subsequent shape via the emitted `_FSRevealTransform` helper class; `n_2..n_last` exist only as transform *targets*. In particular, `exit_animation` clips that target a replacement-mode series resolve to `n_1` (not the parent `VGroup`, not `n_last`); the validator does not need to special-case this because the exit clip's `targetId` still points at the series id, but the agent should not propose edits that assume all `n_k` are independently on-scene (e.g. a `surroundingRect` over "just the last curve" would need to be expressed differently).
- `displayMode: 'partialSum'` has a poisoning semantics in validation: any `x` where a `f_n` is non-finite poisons every later partial sum at that `x`. `src/lib/functionSeriesValidation.ts` is the canonical implementation; agent-emitted series should not try to replicate it.

### 3.4 Envelope JSON Schema

`AGENT_CHAT_RESPONSE_JSON_SCHEMA` is a strict JSON Schema with `oneOf` for the three action variants and `const` discriminators for `action`. `required` is `['reply', 'actions']` where `actions` is always present but may be an empty array. The schema is used directly by OpenAI Structured Outputs and as the `input_schema` for Anthropic's `emit_response` tool.

**Gemini uses a different (flattened) schema** — see §6.3.

---

## 4. Request lifecycle (`useAgentStore.sendMessage`)

1. **Append user turn**: push a `{role:'user', content}` entry onto `messages`.
2. **Snapshot state**: read `items`, `currentTime`, `defaults` from `useSceneStore`.
3. **Serialize**: `buildContextPayload(...)` produces the slim payload (UI-only fields stripped). The payload is attached only to the **current** user turn, never to historical turns.
4. **Build system prompt**: `buildSystemPrompt(customRules)` = `BASE_SYSTEM_PROMPT` + optional user rules.
5. **Pick provider**: `getProvider({ provider, apiKey, baseUrl, model })`.
6. **Call the provider** with `{ payload, systemPrompt, history, userPrompt, includeThinking, signal }`. `history` is every `messages` entry before the latest user turn, oldest-first.
7. **Validate**: `validateAgentResponse(raw, currentItems)` — strict invariants, per-kind normalizers, plus auto-repair passes (see §7). Accepts empty `actions` as a valid pure-chat reply.
8. On success: append a new `{role:'assistant'}` message with `content=reply`, optional `thinking`, and — if actions are non-empty — `actions + actionsStatus:'pending'`. Any prior `pending` assistant message is demoted to `'superseded'` (see §5) and `activePreviewMessageId` is set to the new message.
9. On failure: append an assistant message with `error: [...]` attached; the UI renders it as a red bubble with a Retry button (which reuses the previous user turn via `regenerateLast()`).

An `AbortController` is created per request; `cancelRequest()` aborts the in-flight fetch. `newChat()` clears the log (keeping settings) and aborts any pending request. `regenerateLast()` drops trailing assistant messages and re-runs the last user turn.

---

## 5. Preview → Approve / Reject

### 5.1 Virtual merge

Exactly one assistant message can drive the canvas preview at a time. Its id is held in `activePreviewMessageId`. When a newer assistant turn arrives with actions, any still-`pending` assistant message transitions to `actionsStatus: 'superseded'` so the canvas never tries to merge two competing proposals.

`buildPreviewState(items, actions)` (in `previewSelectors.ts`) produces:

```ts
interface PreviewState {
  mergedItems: Map<ItemId, SceneItem>;  // as if actions were committed
  ops: Map<ItemId, PreviewOp>;          // 'create' | 'update' | 'delete'
}
```

`PreviewOp` is used by the renderer to apply distinctive styling:

- **create** — reduced opacity + dashed fuchsia border on the timeline clip.
- **update** — reduced opacity + dashed amber border.
- **delete** — faded red, listening disabled on the canvas so the user can't interact with something that's about to disappear.

`usePreviewMergedItems()` resolves the active assistant message by id and returns its merged item map when the message is still `pending`; otherwise it returns the raw store items. `SceneCanvas` and `Timeline` consume only these selectors; they are oblivious to the chat mechanism otherwise.

### 5.2 Commit

`approveMessage(id)` looks up the message, calls `commitActions(message.actions)` which iterates the actions in order and re-reads `useSceneStore.getState()` **fresh for each action** (critical — see §9.3):

- `CREATE` → `ensureTextLineSegments(item, defaults)` then `s.addItem(item)`
- `UPDATE` → re-read state, then `s.updateItem(id, updates)` if the id still exists
- `DELETE` → re-read state, then `s.removeItem(id)` if the id still exists

**`ensureTextLineSegments`** (added in `commit.ts`): when a `textLine` arrives with `raw` set but `segments: []`, it calls `parseSegments(raw)` and `createSegmentStyle(...)` to populate the segments array before the item reaches the store. This mirrors `LineEditor.onRawChange` so that segment styling can be applied in a subsequent turn immediately after approval, without the user having to touch the LaTeX source field manually. Text segments default to `color: "#ffffff"`; math segments default to `color: defaults.mathColor` (`"#00FFFF"` by default).

The message's `actionsStatus` flips to `'approved'` and `activePreviewMessageId` is cleared. `rejectMessage(id)` flips to `'rejected'` without committing. Each commit call produces its own `zundo` snapshot today. Batching to a single undo entry is an open TODO noted in the file.

---

## 6. Providers (`providers/`)

### 6.1 `AgentProvider` interface

```ts
interface AgentProvider {
  id: ProviderId;  // 'openai' | 'anthropic' | 'gemini' | 'customOpenAI'
  generate(input: ProviderGenerateInput): Promise<RawAgentResponse>;
}

interface ProviderGenerateInput {
  payload: AgentContextPayload;
  systemPrompt: string;
  history: AgentChatMessage[];    // prior turns, oldest-first, excluding current
  userPrompt: string;              // the current (latest) user message
  includeThinking: boolean;        // opt in to provider reasoning, when supported
  signal?: AbortSignal;
}
```

Each provider is responsible for turning `{payload, systemPrompt, history, userPrompt}` into a provider-specific API call and returning the raw parsed JSON the model emitted (including a `thinking` field if the provider exposed reasoning). The returned value is validated downstream — providers do not do schema checking themselves.

**History rules that apply to all providers:**

- The scene payload is attached only to the **current** user turn — historical turns never duplicate it. This keeps the context window focused on the latest state.
- Historical assistant turns are re-sent using each provider's structured format so the model stays anchored on the schema across turns.
- For any prior assistant message whose `actionsStatus` is `'rejected'` or `'superseded'`, the re-sent assistant turn strips `actions` down to `[]` and appends a short parenthetical note to the reply ("the user rejected the previous proposal; it was NOT applied"). Only `'approved'` proposals are re-sent with their action list intact. This keeps the model's mental model of the scene aligned with what was actually committed.

### 6.2 OpenAI & Anthropic

- **OpenAI** uses Chat Completions with `response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: AGENT_CHAT_RESPONSE_JSON_SCHEMA } }`. The response body is a JSON string that parses directly into `AgentChatResponse`. Historical assistant turns are re-emitted as `{role:'assistant', content: JSON.stringify({reply, actions})}`. When `includeThinking` is true and the selected model matches the o-series / gpt-5 family (`supportsReasoning`), the adapter sets `reasoning_effort: 'medium'` and surfaces any `reasoning_content` / `reasoning.summary` returned by the endpoint as `thinking`.
- **Anthropic** uses the Messages API with a single tool (`emit_response`) whose `input_schema` is `AGENT_CHAT_RESPONSE_JSON_SCHEMA`, then forces `tool_choice: { type: 'tool', name: 'emit_response' }`. We read `content[*].input` for the first matching `tool_use` block. Historical assistant turns are re-emitted as a `tool_use` block with the original envelope (filtered per §6.1); Anthropic requires a following `tool_result` block, so we synthesize a trivial `"ok"` result on the next user turn. When `includeThinking` is true and the model supports extended thinking (claude-3.7 / claude-4 family), the adapter enables `thinking: {type:'enabled', budget_tokens: 4000}` and concatenates any returned `thinking` content blocks into the `thinking` field.
- **customOpenAI** reuses the OpenAI adapter; the `baseUrl` setting lets you point at any OpenAI-compatible endpoint (vLLM, LM Studio, proxies, etc.).

Both providers accept the canonical schema verbatim (they understand `const`, `additionalProperties`, and `oneOf`).

### 6.3 Gemini — special handling

Gemini's function-calling subset is **much more restrictive** than OpenAI / Anthropic:

| JSON Schema feature | Gemini behavior |
| --- | --- |
| `additionalProperties` | Rejected (`Unknown name "additionalProperties"`). |
| `const` | Rejected (`Unknown name "const"`). |
| `$schema`, `title` | Rejected. |
| `oneOf` / `anyOf` | Syntactically accepted, but models **unreliably fill the discriminator**. |
| `if`/`then` | Not supported at all. |

Because of that, `providers/gemini.ts` defines its **own schema** (`GEMINI_RESPONSE_SCHEMA`) that is:

1. **Flat, not discriminated.** `actions[*]` is a single object shape where `action` is a required enum `['CREATE','UPDATE','DELETE']` and `item` / `itemId` / `updates` are all optional siblings. Our TypeScript validator still enforces the per-variant requirements, so no safety is lost.
2. **Enriched with property-level `description`s** to compensate for the loss of structural constraints — especially for `item.axesId`, `item.fn.jsExpr`, `item.fn.pyExpr`, and `item.xDomain`, which Gemini would otherwise omit.
3. **Only `reply` is `required`.** `actions` is optional at the schema level and defaults to `[]` inside the validator, so pure-chat replies are fine.

The HTTP request uses:

```
POST {baseUrl}/models/{model}:generateContent?key={apiKey}
{
  system_instruction: { parts: [{ text: systemPrompt }] },
  contents: [
    /* oldest-first history as alternating user / model turns,
       each historical model turn re-sent as a `functionCall` part for emit_response;
       synthesized `functionResponse` parts bridge adjacent model→user transitions */
    { role: 'user', parts: [{ text: "Current project state…\nUser message:\n…" }] }
  ],
  tools: [{ functionDeclarations: [{ name: 'emit_response', parameters: GEMINI_RESPONSE_SCHEMA }] }],
  toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['emit_response'] } },
  generationConfig: { thinkingConfig: { includeThoughts: true } }  /* only when includeThinking && Gemini 2.5+ */
}
```

We read `candidates[0].content.parts[*].functionCall.args` for the structured output, with a fallback to parsing inline JSON (with ```json fence stripping) if the deployment returned text instead of a function call. Parts with `thought === true` are concatenated into the `thinking` field.

Authentication is via the `key` query parameter (the standard Gemini REST convention) rather than an `Authorization` header.

### 6.4 Adding a new provider

1. Create `providers/<name>.ts` exporting `create<Name>Provider(cfg): AgentProvider`.
2. Inside `generate()`, transform `systemPrompt` + `history` + `payload` + `userPrompt` into your wire format, call the API, and return the parsed JSON body (optionally enriched with a `thinking` field).
3. Add `'<name>'` to the `ProviderId` union in `providers/types.ts`.
4. Register it in the `switch` inside `providers/index.ts#getProvider`.
5. Add a model default in `pickDefaultModel()` (inside `useAgentStore.ts`).
6. Add an option to the `PROVIDER_OPTIONS` array in `AgentPanel.tsx` and a matching key-placeholder branch.
7. If the provider has an unusual schema subset (à la Gemini), define a provider-local schema instead of using `AGENT_CHAT_RESPONSE_JSON_SCHEMA` verbatim.
8. If the provider exposes reasoning/thinking, gate it on `includeThinking` and a model-capability check, and populate the `thinking` field in the returned JSON.

---

## 7. Resilience & auto-repair in `validate.ts`

Real LLM responses are noisy. The validator has two responsibilities:

1. **Fail loudly** on anything genuinely wrong (bad ids, dangling `axesId`, UI-field leakage, disallowed kinds, `id`/`kind` mutations via UPDATE).
2. **Silently fix** common hallucinations that do not carry semantic ambiguity. These rescues are what turn `gemini-2.5-flash` and similarly flaky models into something usable.

### 7.1 Pre-pass auto-repairs

- **`autoLinkAxesIds(actions)`** — if exactly one `axes` CREATE exists in the response and one or more `graphPlot` / `graphDot` / `graphFunctionSeries` CREATEs are missing `axesId`, the axes' id is copied onto them. In ambiguous cases (0 or ≥2 axes CREATEs), this is a no-op and the "axesId is required" error still fires.

### 7.2 Per-action tolerances

- **Exact-duplicate CREATE dedup** — if two CREATEs share an `id` and have structurally-equal bodies (via `isDeepEqual`), the second is dropped silently. Different bodies with the same id still fail, with an error message ending `"…with different content."`.
- **UPDATE / DELETE may target planned CREATEs** — the previous version only checked `currentItems`; now we also accept items created earlier in the same `actions` array. This allows the model to do "create then tweak" in one response.

### 7.3 Per-kind normalizers

`normalizeCreateItem` dispatches on `item.kind` to a kind-specific normalizer (`normalizeTextLine`, `normalizeAxes`, `normalizeGraphPlot`, …) that:

- Fills `baseDefaults()` (id, label, layer, startTime, duration, x/y/scale, posSteps, audioTrackId) when the model omits them.
- Stamps the required `measure: null`, `previewDataUrl: null`, etc. so `useSceneStore.addItem` doesn't explode when it reaches a field that's typed `T | null`.
- Validates kind-specific requirements, e.g. `graphPlot.axesId` is mandatory **after** the auto-link pass.

**`normalizeTextLine` specifics:**

- `font` falls back to `DEFAULT_FONT` (`"Alef"`, from `src/lib/constants.ts`) — **not** `"Arial"`. This ensures that even if the model omits `font`, the rendered output uses the project's Hebrew font.
- `fontSize` falls back to `DEFAULT_FONT_SIZE` (`36`).
- **`rawFromSegments` recovery**: if `raw` is empty but `segments` is non-empty, the normalizer reconstructs `raw` from the segments array: text segments are concatenated as-is, math segments are wrapped in `$…$`. This rescues the common model error of putting text in `segments[0].text` instead of `raw`, which would otherwise leave the LaTeX Source field empty in the UI.
- The validation error for empty `raw` is only triggered when *both* `raw` **and** `segments` are empty, since the recovery pass may have already filled `raw` from segments.

### 7.4 `graphPlot.fn` expression resolution

`resolveFnExprs(raw)` in `validate.ts` is the single most defensively-written piece of the validator, because prior versions silently fell back to `Math.sin(x)` / `np.sin(x)` whenever the canonical shape was missing (a very common mistake). It now accepts:

- canonical: `fn.jsExpr` / `fn.pyExpr`
- aliases under `fn`: `expr`, `expression`, `formula`, `function`, `equation`
- bare string: `fn: "x^2"`
- misplaced one level up: `item.jsExpr`, `item.expr`, etc.

If only one dialect is present, the other is derived:

- `toPyExpr(js)` — `^` → `**`, `Math.X` → `np.X`
- `toJsExpr(py)` — `np.X` → `Math.X`, preserve `**`

And finally, `^` is always rewritten to `**` on both dialects because `^` means XOR (not power) in both JavaScript and Python and is virtually never intentional in a plot expression.

**`graphFunctionSeries`** uses `resolveGraphFunctionSeriesExprs` instead: top-level `jsExpr` / `pyExpr` (plus the same string aliases), optional single-dialect derivation via `toPyExpr` / `toJsExpr`, and **no default expression** — wholly missing expressions fail validation.

---

## 8. System prompt

`BASE_SYSTEM_PROMPT` in `systemPrompt.ts` is the single source of rules the model must obey. Any new invariant should be added there (and reinforced in a provider schema description if it lives under `item`).

Current rules:

1. Time in **seconds**, with `currentTimeSec` as the "now" anchor.
2. Prefer `posSteps` (`next_to` etc.) over raw `x` / `y`.
   - `kind: "absolute"` positions the item at screen centre — almost never the right choice. Use `to_edge` or `next_to` for any directional request (top/bottom/left/right/upper section etc.).
   - Hebrew phrasing for edges ("חלק עליון", "בחלק העליון") must map to `{kind:"to_edge", edge:"UP", buff:0.5}`, **not** `kind:"absolute"`.
3. Unique alphanumeric `id`s; no duplicate CREATE ids in one response.
4. `graphPlot` / `graphDot` / `graphFunctionSeries` **MUST** have a valid `axesId`. (`graphArea` / `graphField` are not agent-created.)
5. **textLine strict workflow** — all rules apply to CREATE:
   - Put the full LaTeX source in `raw`. Do **not** put Hebrew text in `\text{…}`.
   - Math fragments must be written in `$…$`.
   - Omit `segments` (or emit `segments: []`) — the app derives them automatically from `raw`.
   - Copy `projectDefaults.font` into `font`. If `projectDefaults.font` is empty, default to `"Alef"`. Never use `"Arial"` or other non-Hebrew fonts.
   - **Two-step rule for CREATE only**: do not include segment styling (color/bold/italic) in the same response as the CREATE. Style in a later turn after the user approves.
   - 5a. `graphPlot` functions **MUST** use `fn.jsExpr` (JS) and `fn.pyExpr` (NumPy). Power is `**`, never `^`.
   - 5b. **Styling a word/phrase in an existing textLine** (UPDATE, one step):
     1. Insert `||` in `raw` around the target word: `"סדרות|| פונקציות..."` (the `||` is a segment boundary marker — invisible in the render). Math segments (`$…$`) are natural boundaries; no `||` needed around them.
     2. In the same UPDATE, include `segments` with the correct per-segment `color`/`bold`/`italic`. Preserve existing `text` and `isMath` values — only change style fields.
     3. **Never** change `segments[i].text` to a substring without a matching `||` in `raw`; that desynchronises the two fields and the split will be lost the next time the user edits `raw`.
6. No UI-only fields (`measure`, `previewDataUrl`, `segmentMeasures`, …).

User-defined rules are appended via `buildSystemPrompt(customRules)` with a separator line. They're persisted in `localStorage` as part of `AgentSettings`.

---

## 9. Pitfalls & design notes

### 9.1 Preview state is read-only

`SceneCanvas`, `Timeline`, and `TimelineClip` never write back to `useAgentStore` or `useSceneStore` from the preview code path. If you add interactive behavior inside the preview, gate it on `ops.get(id) === undefined` (i.e. untouched items) to avoid confusing the user about what's real vs. proposed.

### 9.2 Schema skew between providers

The envelope in `AGENT_CHAT_RESPONSE_JSON_SCHEMA` (canonical) and `GEMINI_RESPONSE_SCHEMA` (flat) must evolve together. If you add a new optional field under `item`, it must:

- Still validate under the canonical schema (OpenAI / Anthropic).
- Be added to the Gemini schema under `item.properties` with a descriptive `description` — Gemini ignores undeclared properties when composing its output.
- Be normalized (or rejected) by the appropriate per-kind normalizer in `validate.ts`.

### 9.3 Never capture `getState()` across store-mutating actions

`commit.ts` re-reads `useSceneStore.getState()` **per action** because Zustand+immer produces a new `items` Map each write. An earlier version captured state once at the top of the loop and silently dropped UPDATEs whose target had been CREATEd in the same batch. If you refactor this, keep the re-read.

### 9.4 Abort semantics

`sendMessage` installs an `AbortController` in `state._abort`; subsequent `sendMessage`, `regenerateLast`, `newChat`, or `cancelRequest` calls abort the previous fetch. Providers must forward `signal` to `fetch` — adding a new provider that ignores the signal will leak in-flight requests when the user clicks Cancel.

### 9.5 `customRules` leaks into every request

The custom-rules textarea is appended to the system prompt on every request, so keep it terse. It's free-form, not validated.

---

## 10. Extending the feature

### 10.1 Allowing a new `kind`

1. Add the kind string to `AGENT_ALLOWED_KINDS` in `types.ts`.
2. Add a `case` in `normalizeCreateItem` and a matching `normalizeX(raw, errors, prefix)` helper in `validate.ts`. Fill in defaults for every field the `SceneItem` variant requires; reject on missing cross-references (like `axesId`).
3. Add a line to the "Graph Dependencies" or other relevant section of `BASE_SYSTEM_PROMPT` if the kind has invariants.
4. If Gemini users should be able to emit it, expand `GEMINI_RESPONSE_SCHEMA.properties.actions.items.properties.item.properties` with the new fields (at minimum: anything the kind requires but that the validator would reject if omitted).
5. Add a test in `validate.test.ts` covering the normalizer's defaults and required-field errors.

### 10.2 Surfacing a new UI-only field

Add it to `AGENT_UI_ONLY_FIELDS` in `types.ts`. Both the serializer and the validator pick this up automatically — the serializer strips it before sending, and the validator rejects it if it appears in a CREATE item or UPDATE patch.

### 10.3 Changing the persisted settings shape

`useAgentStore` uses Zustand's `persist` middleware keyed on `'manim-timeline.agent-settings'` in `localStorage` with `version: 2`. The persisted fields are the provider settings (`provider`, `apiKey`, `baseUrl`, `model`, `customRules`, `showThinking`) plus the chat log (`messages`, capped to the last 100 entries via `MAX_PERSISTED_MESSAGES`, and `activePreviewMessageId`).

The `migrate` function accepts v1 state (provider settings only) and seeds an empty chat log. If you add a field that needs a migration, bump the version and extend `migrate`.

---

## 11. Testing

- `vitest run src/agent` covers the serializer, the validator (happy path + 10+ failure modes + auto-repair modes), and will fail fast if you break any contract.
- There is **no e2e test that actually calls an LLM** — providers are covered only at the type level. If you want to run a smoke test against a real provider, use the AgentPanel in the running app with a live API key.
- `tsc --noEmit` from the `manim-timeline` directory is the canonical type-check gate.

---

## 12. textLine segment workflow — detailed reference

This section documents the end-to-end lifecycle of a `textLine` item, from agent creation to per-word styling.

### 12.1 Creation (first agent turn)

The agent emits a single CREATE action:
```json
{ "action": "CREATE", "item": { "kind": "textLine", "id": "t1",
  "raw": "סדרות פונקציות והתכנסות במידה שווה",
  "font": "Alef", "fontSize": 60,
  "posSteps": [{ "kind": "to_edge", "edge": "UP", "buff": 0.5 }],
  "segments": [] } }
```

`validate.ts / normalizeTextLine` fills in timing, scale, posSteps defaults.  
`commit.ts / ensureTextLineSegments` detects `raw` non-empty + `segments` empty → calls `parseSegments(raw)` + `createSegmentStyle(...)` → item enters the store with one TEXT segment `"סדרות פונקציות והתכנסות במידה שווה"` coloured `#ffffff`.

### 12.2 Styling a specific word (second agent turn, after approval)

To colour / bold / italic one word the agent MUST NOT set `segments[i].text` to a substring without also updating `raw`. The correct action:
```json
{ "action": "UPDATE", "itemId": "t1", "updates": {
  "raw": "סדרות|| פונקציות והתכנסות במידה שווה",
  "segments": [
    { "text": "סדרות",  "isMath": false, "color": "#0000FF", "bold": true,  "italic": false },
    { "text": " פונקציות והתכנסות במידה שווה", "isMath": false, "color": "#ffffff", "bold": false, "italic": false }
  ] } }
```

The `||` in `raw` is a text-segment separator consumed by `parseSegments` — it does **not** appear in the rendered output. Math segments (`$…$`) are natural boundaries and never need `||`.

Segment indices are in **parse order** (left to right in `raw`), even though Hebrew text renders RTL. After this UPDATE, `Segments (2)` appears in the Properties panel and the targeted word is styled.

### 12.3 Positioning conventions

| User intent | Correct posSteps |
|---|---|
| Top of page / upper section | `[{ kind:"to_edge", edge:"UP", buff:0.5 }]` |
| Right-aligned Hebrew line | `[{ kind:"to_edge", edge:"RIGHT", buff:0.3 }]` |
| Below another item | `[{ kind:"next_to", refKind:"line", refId:"<id>", dir:"DOWN", buff:0.3, alignedEdge:null, refSegmentIndex:null, selfSegmentIndex:null, bounds:null }]` |
| Horizontally centred | `[{ kind:"set_x", x:0 }]` (after a next_to that sets Y) |
| Absolute screen centre | `[{ kind:"absolute" }]` — almost never correct; only for deliberate screen-centre placement |

---

## 13. Known limitations (v2 — chat)

- Only kinds listed in **§3.3** (`AGENT_ALLOWED_KINDS`) can be CREATEd — includes `target_animation` and graph kinds such as `graphCurve` / `graphPointSequence`; `graphArea` / `graphField` remain UI-only.
- Each approved action produces its own `zundo` snapshot rather than one batched undo entry.
- No token streaming: the UI shows a "Thinking…" indicator and waits for the full response. Reasoning/thinking output is surfaced as a collapsible block only after the turn completes.
- The full chat history is re-sent on every turn; token usage grows linearly with conversation length. `MAX_PERSISTED_MESSAGES` (100) caps the persisted log but does not summarize older turns — long conversations may need a manual "New chat".
- When a prior proposal is rejected or superseded, the model only sees a short parenthetical note in the re-sent assistant turn rather than the full diff of what was proposed. If this causes the model to re-propose the same edit, consider expanding the note to include the action list.
- Gemini preview models (`gemini-3.1-pro-preview`, `gemini-2.5-flash`) are known to occasionally emit duplicate CREATEs, omit `axesId`, and pick non-canonical `fn` shapes — `validate.ts` includes auto-repair passes specifically for these cases. If a new class of hallucination becomes common, prefer adding a rescue in `validate.ts` over tightening the schema further; that way the failure mode is recoverable for *all* providers.
- Reasoning/thinking support is best-effort per provider. Non-reasoning models silently ignore the toggle; the UI hides the Thinking block when the field is empty.
- The custom-rules field is free-form and can easily override the base rules if a user writes contradictory instructions. There's no guard against that.
