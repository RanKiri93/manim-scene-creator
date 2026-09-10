---
slug: copilot-gap-priorities
created: 2026-09-11
status: docs
owner_role: copilot-dev
next_tool: any
source: user request / Copilot gap prioritization
---

## Plan (architect)

### Goal
Choose the safest next Copilot compatibility gap to implement. The recommendation is to start with a schema-light, high-value Copilot upgrade: make the agent frame-aware in its context and preserve/validate `frameId` on created/updated drawable items, while explicitly deferring new persistent frame actions and render/vision/audio features. This gives immediate practical value in the current multi-frame editor without changing the project file format or server.

Implementability ranking from current code/docs:
1. **Implement now (small/medium, copilot-only): frame-aware context + `frameId` validation/prompting.** Existing app already has `frames`, `startFrameId`, `activeFrameId`, and item `frameId`; the Copilot payload currently sends only defaults/currentTime/items. Add frame catalog + active frame to agent context, teach the prompt to use `activeFrameId`/explicit frame ids, and validate frame ids instead of silently relying on store fallbacks. No `types/scene.ts` persisted shape change is needed if this only exposes existing fields.
2. **Implement now (small, copilot-only): better rejected/superseded history notes.** Architecture already notes the limitation; providers currently strip rejected/superseded action lists and append only a note. Expand the note with a compact summary of rejected action kinds/labels/ids so the model is less likely to repeat a rejected proposal. No schema change.
3. **Implement now (medium, copilot-only): allow `graphArea` CREATE.** The editor/codegen already has graph areas. Add whitelist/schema/normalizer/tests/prompt. This is feasible but should be separate from frame work because it touches canonical + Gemini schema and validation. `graphArea` depends on axes/curves and should be tested carefully.
4. **Implement soon but larger: allow `graphField` CREATE.** Feasible because the editor/codegen has it, but validator/prompt/Gemini schema surface is larger (slope/vector modes, expressions, density, streamlines, colors). Do after `graphArea`.
5. **Defer / split cross-role: render-review / vision feedback.** Implementable, but not “right now” as a single Copilot task: touches server, measure client, agent provider payloads, UI, and slow Manim rendering. Needs server-dev then copilot-dev handoffs.
6. **Defer / split cross-role: Copilot audio/narration creation.** Implementable but spans audio pipeline/server/store/Copilot and needs `audio-pipeline`; not a small Copilot-only change.
7. **Defer: dedicated frame actions (`CREATE_FRAME`, `UPDATE_FRAME`) and camera panning.** Requires action-schema expansion beyond SceneItem CRUD and likely store/UI semantics. Do after context-only frame awareness proves useful.
8. **Defer / UX-sensitive: token streaming.** Provider/UI work, not scene-compatibility critical.
9. **Defer until undo architecture pass: batch approved action list into one undo snapshot.** Valuable, but touches store/zundo semantics beyond Copilot.

### Non-goals
- Do not implement all gaps in one pass.
- Do not add audio, server render endpoints, vision-provider requests, or new frame actions in the recommended first pass.
- Do not change persisted project schema unless a later task explicitly adds new stored fields.
- Do not touch codegen or emitted Manim for the frame-awareness first pass.
- Do not hardcode or test live provider API keys.

### Touched files
agent/:
- `manim-timeline/src/agent/types.ts` — extend `AgentContextPayload` with existing frame catalog fields only (`frames`, `startFrameId`, `activeFrameId`) and keep action envelope unchanged.
- `manim-timeline/src/agent/serialize.ts` — include frame catalog/current active frame in `buildContextPayload` and tests; ensure UI-only item stripping remains unchanged.
- `manim-timeline/src/agent/systemPrompt.ts` — teach the model to assign new drawable items to the active frame by default, reference valid `frameId`s only, and ask when frame intent is ambiguous.
- `manim-timeline/src/agent/validate.ts` — validate `frameId` on CREATE/UPDATE for drawable items that support it; normalize missing `frameId` to the active/start frame if appropriate through payload-aware validation, or fail only on unknown explicit frame ids (implementation choice must be documented). Keep `id`/`kind` mutation and UI-only rejection unchanged.
- `manim-timeline/src/agent/useAgentStore.ts` — pass `frames`, `startFrameId`, `activeFrameId` from `useSceneStore` into `buildContextPayload` / validator if needed.
- `manim-timeline/src/agent/validate.test.ts` — add frame-aware create/update tests and unknown-frame rejection tests.
- `manim-timeline/src/agent/serialize.test.ts` — add frame catalog serialization test.

docs:
- `manim-timeline/src/agent/ARCHITECTURE.md` — update context-payload section, known limitations, and frame-awareness notes.
- `manim-timeline/README.md` — update Copilot/Timeline docs and `*Last updated:*` trailer only after verified behavior changes.

### Invariants at risk
- Canonical vs Gemini schema parity; enforced by `manim-timeline/src/agent/types.ts` and `manim-timeline/src/agent/providers/gemini.ts`. The recommended first pass avoids action/schema kind changes; if `AgentContextPayload` changes only, confirm provider payload construction still compiles for OpenAI/Anthropic/Gemini.
- Copilot context must stay slim and strip UI-only fields; enforced by `AGENT_UI_ONLY_FIELDS` in `types.ts`, `serialize.ts`, and `serialize.test.ts`.
- CREATE kind whitelist must remain unchanged for the frame-awareness pass; enforced by `AGENT_ALLOWED_KINDS` in `types.ts` and `validate.test.ts`.
- Frame filtering/association semantics must match editor behavior; enforced by `associatedFrameId`, `frameDisplayName`, and `readingOrderFrames` in `manim-timeline/src/lib/frameGrid.ts`, and frame editors/panels.
- `commit.ts` per-action `getState()` must remain unchanged; enforced by `manim-timeline/src/agent/commit.ts` and `commit.test.ts`.
- TextLine Hebrew/math workflow must not regress; enforced by `systemPrompt.ts`, `validate.ts`, and `validate.test.ts`.
- API keys remain browser-local; enforced by `AgentPanel.tsx` settings behavior and repo rules.
- Existing uncommitted WIP from prior handoffs must be preserved: do not revert/reformat README, `App.tsx`, `AddObjectToolbar.tsx`, `ItemList.tsx`, scrubber/timeline-surgery files, or handoff docs unrelated to this Copilot task.

### Test plan
Exact commands from `manim-timeline/` for the recommended first pass:
- `npx vitest run src/agent/serialize.test.ts src/agent/validate.test.ts` — extend with `describe('frame-aware Copilot context')` and `describe('frameId validation')` cases: payload includes frames/start/active; drawable CREATE defaults/accepts valid active frame; explicit unknown `frameId` rejects; UPDATE cannot set unknown `frameId`; non-frame clips such as `exit_animation` / `blink_animation` / `target_animation` continue to derive frame association from targets and do not require `frameId`.
- `npx vitest run src/agent` — full Copilot suite.
- `npm run build` — TypeScript/provider payload gate.
- `npx eslint src/agent/types.ts src/agent/serialize.ts src/agent/systemPrompt.ts src/agent/validate.ts src/agent/useAgentStore.ts src/agent/serialize.test.ts src/agent/validate.test.ts` — touched files clean.
- Manual smoke (optional, no keys committed): `npm run dev`, open a multi-frame project, ask Copilot to add a line “to the active frame”, verify pending preview appears in that frame, then Approve/Reject.

### Open questions
Which gap should be implemented first? My recommendation is **frame-aware context + `frameId` validation** because it is high-value and contained in `src/agent`. If you prefer quick wins instead, choose **better rejected/superseded history notes**; if you prefer new visual creation power, choose **graphArea CREATE** next.

## Implementation notes (copilot-dev)

Implemented gap #1 (frame-aware context + `frameId` validation). Other ranked gaps untouched.

- `manim-timeline/src/agent/types.ts` — added `AgentFrameInfo` (`id`/`label`/`col`/`row`) and extended `AgentContextPayload` with `frames`, `startFrameId`, `activeFrameId`. Action envelope, `AGENT_ALLOWED_KINDS`, `AGENT_UI_ONLY_FIELDS`, and the canonical response schema unchanged.
- `manim-timeline/src/agent/serialize.ts` — `buildContextPayload` accepts optional `frames`/`startFrameId`/`activeFrameId` (optional so existing callers/tests keep compiling) and always emits the frame catalog (mapped from `FrameDef`) plus nullable ids. UI-only item stripping unchanged.
- `manim-timeline/src/agent/validate.ts` — `validateAgentResponse(raw, currentItems, frameCtx?)` with new optional `AgentFrameContext`. Central `frameId` handling (no per-kind normalizer changes): drawable CREATEs get explicit-but-unknown `frameId` rejected loudly, missing `frameId` stamped with `activeFrameId ?? startFrameId` (mirrors store `addItem`, so the preview already lands in the right frame); `frameId` on exit/blink/target CREATEs and UPDATEs is dropped silently (they follow targets via `associatedFrameId`); UPDATE with unknown `frameId` on a drawable fails loudly; `frameId: null` is dropped. `isFrameDrawableKind` mirrors the store's private `isFrameDrawable` with a keep-in-sync comment. When `frameCtx` is absent, `frameId` handling is skipped and store fallbacks apply at commit.
- `manim-timeline/src/agent/useAgentStore.ts` — `runTurn` passes live `frames`/`startFrameId`/`activeFrameId` into both `buildContextPayload` and `validateAgentResponse` (request-time snapshot).
- `manim-timeline/src/agent/systemPrompt.ts` — appended frames rule (use active frame by default, only catalog ids, never `frameId` on effect clips, ask when frame intent is ambiguous). All existing textLine/math/axes/graph rules untouched.
- `manim-timeline/src/agent/providers/gemini.ts` — added optional `frameId` to `GEMINI_RESPONSE_SCHEMA` item properties with a description plus a frames bullet in the item guidance (canonical schema already permits it via `additionalProperties: true`, so parity holds: both schemas allow `frameId`).
- `manim-timeline/src/agent/serialize.test.ts` — new `describe('frame-aware Copilot context')` (catalog mapping, empty-catalog defaults); existing tests untouched.
- `manim-timeline/src/agent/validate.test.ts` — new `describe('frameId validation')` (active-frame stamping, explicit valid id kept, unknown id rejected on CREATE and UPDATE, stray `frameId` dropped on exit CREATE, blink CREATE without `frameId` passes).
- `manim-timeline/src/agent/ARCHITECTURE.md` — §3.1 payload, §4 lifecycle steps, new §7.5 `frameId` validation, §13 now notes frame-awareness plus remaining no-frame-actions limitation.
- `manim-timeline/README.md` — new `### AI Copilot` subsection under "What the application does" (no TOC change — only `##` sections are listed) plus `*Last updated:*` trailer extension.
- Deviations: (1) fixed 4 pre-existing `no-unused-vars` eslint errors in `validate.ts` (`normalizePerNDict` / `normalizePointSequencePerNDict` unused `_errors`/`_prefix` params removed, 4 call sites updated) — required for the touched-file lint gate; behavior-neutral (params were never read). (2) `frameId: null` in UPDATE is dropped rather than rejected. (3) Did not touch `idea.md` archived frame-aware plan (out of scope).
- Commands run (from `manim-timeline/`):
  - `npx vitest run src/agent/serialize.test.ts src/agent/validate.test.ts` — pass (2 files, 52 tests).
  - `npx vitest run src/agent` — pass (4 files, 60 tests; was 52).
  - `npm run test` — pass (43 files, 332 tests; was 43/324).
  - `npm run build` — pass (`tsc -b && vite build`; chunk-size warning only).
  - `npx eslint` on all 8 touched/new agent files — clean, no output (after the unused-param fix above).
- Left undone: live-provider smoke (no keys in this session) — verifier/reviewer should confirm in `npm run dev` with a multi-frame project that Copilot-created drawables land in the active frame and unknown-frame proposals surface a clear error. No `types/scene.ts` change (no migration), no `measureClient.ts`/server change, no API keys written anywhere.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Targeted frame-aware agent tests | `npx vitest run src/agent/serialize.test.ts src/agent/validate.test.ts` (from `manim-timeline/`) | pass — `Test Files  2 passed (2)`, `Tests  52 passed (52)`. |
| Copilot suite | `npx vitest run src/agent` (from `manim-timeline/`) | pass — `Test Files  4 passed (4)`, `Tests  60 passed (60)`. |
| Full frontend tests | `npm run test` (from `manim-timeline/`) | pass — `Test Files  43 passed (43)`, `Tests  332 passed (332)`. |
| Frontend build | `npm run build` (from `manim-timeline/`) | pass — `tsc -b && vite build`; `✓ built in 1.82s` (chunk-size warning only). |
| Touched-file lint | `npx eslint src/agent/types.ts src/agent/serialize.ts src/agent/systemPrompt.ts src/agent/validate.ts src/agent/useAgentStore.ts src/agent/serialize.test.ts src/agent/validate.test.ts src/agent/providers/gemini.ts` (from `manim-timeline/`) | pass — no output; confirms the unused-param cleanup left no lint errors in these files. |
| Working tree scope check | `git status --short`; `git diff --stat` (repo root) | pass with noted scope finding — task diff files are the Copilot/README/ARCH files inspected; unrelated WIP remains in the checkout. |

- Static confirmations:
  - `AGENT_ALLOWED_KINDS` unchanged in `src/agent/types.ts`; canonical action schema unchanged and still allows per-item/update fields via `additionalProperties: true`.
  - Gemini flat schema gained optional `frameId`, so both provider schemas allow `frameId`.
  - `validate.test.ts` asserts active-frame stamping, valid explicit ids, unknown `frameId` rejection on CREATE/UPDATE, and effect-clip `frameId` dropping.
  - `useAgentStore.ts` passes `frames`, `startFrameId`, and `activeFrameId` into both `buildContextPayload` and `validateAgentResponse`.
  - `commit.ts` still re-reads `useSceneStore.getState()` per action.
  - Text-line prompt rules for `raw`, `segments`, `Alef` fallback, and `posSteps` remain present.
  - `git diff --name-only -- manim-timeline/src/types/scene.ts manim-timeline/src/services/measureClient.ts measure_server.py manim-timeline/src/agent/commit.ts` produced no output; no schema/server/measure-client/commit diff for this task.
  - README `*Last updated:*` trailer now starts with `Frame-aware Copilot`; inspected task diff and grep found no committed API-key material (only existing UI placeholders outside the task diff).
- Out-of-scope changes found in the diff (files not in "Touched files"):
  - Task-attributable but missing from the architect Touched files: `manim-timeline/src/agent/providers/gemini.ts` (required by the verifier request for Gemini schema parity and included in lint/static checks).
  - Existing checkout WIP outside this task remains: `manim-timeline/src/App.tsx`, `src/index.css`, `src/panels/AddObjectToolbar.tsx`, `src/panels/ItemList.tsx`, `src/store/useSceneStore.ts`, `src/timeline/PlaybackControls.tsx`, timeline-surgery/item-relationship files, agent/config docs, and other handoffs. Per the verifier request, these were not attributed to this task.
- Claims in "Implementation notes" that could not be confirmed:
  - Live-provider/manual `npm run dev` smoke was not run (optional/no keys).
  - The `frameId: null` note is confirmed for UPDATE; on CREATE, the code treats non-string/null as missing and stamps the active/start fallback, and that null-CREATE path is not covered by the new tests.

Verdict: **pass**.
