---
slug: copilot-compatibility-audit
created: 2026-09-11
status: planned
owner_role: copilot-dev
next_tool: any
source: user request / compatibility audit
---

## Plan (architect)

### Goal
Document the current compatibility surface of the in-app AI Copilot: supported providers/models paths, supported CREATE/UPDATE/DELETE actions, whitelisted scene item kinds, preview/approval behavior, script-to-timeline behavior, validator auto-repairs, and known gaps. This is a read-only audit unless a follow-up asks to expand Copilot support.

### Non-goals
- Do not implement new Copilot kinds, providers, schemas, prompts, or UI affordances in this audit.
- Do not edit `src/agent/*` files unless a later follow-up chooses a specific compatibility gap to fix.
- Do not call live LLM providers or write API keys to files/local storage.
- Do not change project schema, codegen, measure server, or timeline/editor behavior.

### Touched files
docs:
- `docs/handoffs/2026-09-11-copilot-compatibility-audit.md` (new) — records this audit plan and can be extended by `copilot-dev` if a fuller compatibility matrix is desired.

agent/ (read-only for this audit):
- `manim-timeline/src/agent/ARCHITECTURE.md` — authoritative compatibility reference.
- `manim-timeline/src/agent/types.ts` — provider-agnostic action envelope, kind whitelist, canonical schema, UI-only-field list.
- `manim-timeline/src/agent/systemPrompt.ts` — prompt-level capability/invariant rules.
- `manim-timeline/src/agent/validate.ts` — validator/normalizer compatibility and auto-repair behavior.
- `manim-timeline/src/agent/serialize.ts` — context payload compatibility.
- `manim-timeline/src/agent/commit.ts` — approved action commit semantics.
- `manim-timeline/src/agent/previewSelectors.ts` — pending proposal preview semantics.
- `manim-timeline/src/agent/providers/*.ts` — OpenAI, Anthropic, Gemini, and custom OpenAI-compatible adapters.
- `manim-timeline/src/agent/*.test.ts` — tests covering current Copilot contracts.

### Invariants at risk
- Canonical vs Gemini schema parity; enforced by `manim-timeline/src/agent/types.ts`, `manim-timeline/src/agent/providers/gemini.ts`, and `copilot-add-kind` checklist.
- Whitelisted CREATE kinds only; enforced by `AGENT_ALLOWED_KINDS` in `manim-timeline/src/agent/types.ts` and `normalizeCreateItem` in `manim-timeline/src/agent/validate.ts`.
- UI-only fields must be stripped from context and rejected in responses; enforced by `AGENT_UI_ONLY_FIELDS` in `types.ts`, `serialize.ts`, and `validate.ts`.
- Preview-before-approval: real store remains unchanged until Approve; enforced by `previewSelectors.ts`, `useAgentStore.ts`, and `commit.ts`.
- `commit.ts` must re-read `useSceneStore.getState()` per action; enforced by `manim-timeline/src/agent/commit.ts` and tests in `commit.test.ts`.
- Text/Hebrew workflow (`raw`, `$...$`, `||`, no styled CREATE) must remain enforced; documented in `systemPrompt.ts` / `ARCHITECTURE.md` and validated in `validate.ts` / `validate.test.ts`.
- API keys remain browser-local and are never hardcoded; enforced by `AgentPanel.tsx` settings behavior and repo rules.

### Test plan
Exact commands from `manim-timeline/` for a compatibility audit or future Copilot change:
- `npx vitest run src/agent` — current audit baseline passed: 4 files, 52 tests.
- `npm run build` — required for any future code change under `src/agent`.
- If schemas/providers change: add/extend `manim-timeline/src/agent/validate.test.ts`, `serialize.test.ts`, `commit.test.ts`, or provider-specific tests as appropriate; canonical schema (`types.ts`) and Gemini flat schema (`providers/gemini.ts`) must be updated together.
- Manual smoke (only if a real provider key is available): run `npm run dev`, open Copilot, pick provider/model, send a pure-chat question and one simple scene-edit request, verify pending preview then Approve/Reject. Never persist or commit API keys.

### Open questions
What does “compatibilities” mean for the next implementation step: provider/model compatibility, supported scene item kinds, Hebrew/math task capability, or missing editor features the Copilot should learn next? The audit below can answer all at a high level, but a follow-up implementation should choose one dimension.
