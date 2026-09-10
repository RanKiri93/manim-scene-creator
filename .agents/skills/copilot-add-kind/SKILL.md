---
name: copilot-add-kind
description: Checklist for changing the in-app AI Copilot (manim-timeline/src/agent) — allowing a new SceneItem kind, adding a field the model may emit, changing the system prompt, or fixing a provider. Load before touching anything under src/agent.
---

# Copilot (src/agent) change checklist

Authoritative reference: `manim-timeline/src/agent/ARCHITECTURE.md`. This skill is the
operational checklist; read the relevant ARCHITECTURE section when a step is unclear.

## Allow a new `kind` (ARCHITECTURE §10.1)

1. `types.ts` — add the kind string to `AGENT_ALLOWED_KINDS`.
2. `validate.ts` — add a `case` in `normalizeCreateItem` and a `normalize<Kind>(raw, errors, prefix)`
   that fills `baseDefaults()`, stamps UI-only fields to `null`, and rejects missing
   cross-references (`axesId`, `targetId`, …). Mirror `store/factories.ts` defaults exactly.
3. `systemPrompt.ts` — one or two lines in `BASE_SYSTEM_PROMPT` if the kind has invariants the
   model must know (e.g. "needs `axesId`", "power is `**` never `^`").
4. `providers/gemini.ts` — extend `GEMINI_RESPONSE_SCHEMA...item.properties` with every field
   the kind requires, each with a `description`. Gemini ignores undeclared properties.
5. `validate.test.ts` — happy path with defaults filled, plus one failure per required field.
6. `previewSelectors.ts` / canvas: if the kind is drawable, confirm the preview skin
   (`ops` opacity + dashed border) renders it; if not drawable (a clip), confirm
   `TimelineClip` shows the preview treatment.
7. ARCHITECTURE §3.3 list and §13 limitations updated (or tell `docs-keeper` in the handoff).

## Schema skew rule (ARCHITECTURE §9.2)

Two schemas must evolve together:
- `AGENT_CHAT_RESPONSE_JSON_SCHEMA` in `types.ts` — canonical, strict, `oneOf` + `const`.
  Used verbatim by OpenAI Structured Outputs and Anthropic `emit_response` tool.
- `GEMINI_RESPONSE_SCHEMA` in `providers/gemini.ts` — flat, no `const`/`additionalProperties`/
  `oneOf`, everything optional except `reply`, descriptions carry the constraints.
Adding a field under `item` in one without the other is a bug.

## Validator philosophy (ARCHITECTURE §7)

Fail loudly on: unknown ids, dangling `axesId`, UI-only field leakage, disallowed kinds,
`id`/`kind` mutation via UPDATE. Silently repair: missing `axesId` when exactly one axes is
created in the same response, duplicate identical CREATEs, `raw` reconstructed from
`segments`, `fn` expression aliases, `^` → `**`. When a new model hallucination shows up,
prefer a rescue in `validate.ts` over tightening the schema.

## textLine rules the prompt enforces (do not weaken)

- Full LaTeX in `raw`; math in `$…$`; Hebrew not in `\text{}`; `segments: []` on CREATE.
- `font` copied from `projectDefaults.font`, fallback `"Alef"`, never `"Arial"`.
- Styling a word = UPDATE with `||` inserted in `raw` and matching `segments` styles; never
  change `segments[i].text` without the matching `raw` split.
- Positioning via `posSteps` (`to_edge`, `next_to`), `kind:"absolute"` almost never.

## commit.ts

`commitActions` re-reads `useSceneStore.getState()` per action. Keep that; capturing once
drops UPDATEs that target CREATEs from the same batch. `ensureTextLineSegments` runs on
CREATE; if you add a kind with derived arrays, add the equivalent there.

## Providers

- Forward `signal` to `fetch`; the store aborts on cancel/new chat.
- History: scene payload only on the current user turn; rejected/superseded assistant turns
  are re-sent with `actions: []` and a note.
- Thinking is opt-in per provider (`includeThinking`) and gated on model capability.
- Gemini auth is the `key` query param, not a header.

## Gates

```
cd manim-timeline
npx vitest run src/agent
npm run build
```
There is no test that calls a live model. For a real smoke test, run `npm run dev`, open the
Copilot panel, and use a live key — never write the key into a file.
