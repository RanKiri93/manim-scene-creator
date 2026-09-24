---
slug: camera-zoom-copilot-resume
created: 2026-09-24
status: planned
owner_role: copilot-dev
next_tool: any
source: user request / stopped camera-zoom implementation
---

<!--
Copy this file to docs/handoffs/<created>-<slug>.md.
Each role appends ONLY its own section. Never edit a section written by an earlier role;
add a dated note under your own section instead. Update the frontmatter `status`,
`owner_role`, and `next_tool` when you hand off.
-->

## Plan (architect)

### Goal
After the editor and codegen stages are verified, let Copilot propose, preview, and approve the same snapshot camera clips users can author manually. A request such as “at the current time, zoom around Axis 2, then add a zoom out three seconds after it finishes” must use the frozen request playhead and measured existing target, resolve to ordinary `camera_move` CREATE/UPDATE actions, show timing and override effects before approval, preserve explicit future returns, and never invent geometry or mutate the scene before approval. This is the second remaining implementation handoff and must follow `2026-09-24-camera-zoom-codegen-resume.md`.

### Non-goals
- Do not start this stage until the codegen handoff has passed focused tests and real export/render review.
- Do not add a new action family, persisted relative-time DSL, live object-follow dependency, model-invented bounds, or automatic approval.
- Do not change editor, codegen, server, or migration ownership; use the verified public camera/bounds/schedule APIs.
- Do not alter the unrelated `snapBuffer: 0.3` WIP in `src/agent/validate.ts` except to preserve it through nearby edits.
- Do not make a same-response new drawable measurable; clarify when an existing target is ambiguous, unsupported, stale, or unavailable.

### Touched files
Paths are relative to `manim-timeline/` unless noted.

**`src/agent/` contract and normalization**
- `src/agent/types.ts` — allow `camera_move`, add request-only target/context types, and extend the canonical schema without leaking descriptors into persisted items.
- `src/agent/providers/gemini.ts` — keep Gemini's flat camera CREATE/UPDATE fields and descriptions in parity with the canonical schema.
- `src/agent/cameraRequests.ts`, `src/agent/cameraRequests.test.ts` (new) — resolve object/region/frame descriptors through `lib/cameraBounds.ts` and `lib/camera.ts`, apply defaults, and return clarification outcomes.
- `src/agent/validate.ts`, `src/agent/validate.test.ts` — normalize camera CREATE/UPDATE, validate complete resulting items and ordered batches, accept valid overlaps, reject malformed references, and preserve existing validation/WIP rules.
- `src/agent/systemPrompt.ts` — document exact IDs, request-time “now”, end-plus-delay arithmetic, snapshot fitting, later-start override, and preservation of explicit returns.

**`src/agent/` context, lifecycle, and preview**
- `src/agent/serialize.ts`, `src/agent/serialize.test.ts` — send compact logical camera frame/pose and supported target IDs/names while excluding UI measurements and caches.
- `src/agent/useAgentStore.ts`, `src/agent/useAgentStore.test.ts` (new) — freeze playhead, frames, camera/bounds resolution and relevant state before provider await; revalidate reviewed effects before approval and reject stale proposals atomically.
- `src/agent/AgentPanel.tsx` — show destination, duration, return timing, and shared override explanations in the existing approval flow.
- `src/agent/previewSelectors.test.ts` (new) and `src/agent/previewSelectors.ts` only if required — prove virtual camera CREATE/UPDATE/DELETE behavior, including deleted cameras having no camera effect while remaining visually marked for deletion.
- `src/agent/commit.test.ts` — prove fresh-state CREATE→UPDATE/DELETE, scalar preservation, no request-only fields, and unchanged independent returns; production `commit.ts` should remain unchanged unless a test demonstrates a necessary fix.
- `src/agent/providers/schema.test.ts` (new) — mock canonical and Gemini requests for camera field parity and unchanged non-camera actions.

**Docs**
- `src/agent/ARCHITECTURE.md` — update allowed kinds, request-only snapshot lifecycle, schema description, and camera limitations after verification.
- `manim-timeline/README.md` — add the verified Copilot camera example and clarification/snapshot behavior; extend the Last-updated trailer only after integrated verification.
- `docs/handoffs/2026-09-24-camera-zoom-copilot-resume.md` — later roles append implementation and verification notes only.

### Invariants at risk
- **Canonical/Gemini schema parity** — `src/agent/types.ts` and `src/agent/providers/gemini.ts` must expose camera target modes, IDs, width/offsets, and timing for both CREATE and UPDATE.
- **Only normalized approved items reach the store** — `src/agent/validate.ts`, `src/agent/useAgentStore.ts`, `src/agent/commit.ts`, and `src/store/useSceneStore.ts` must strip request-only descriptors and reject partial dependent batches.
- **Fresh state for ordered actions** — `src/agent/commit.ts` must retain per-action `getState()` so CREATE→UPDATE/DELETE works; `commit.test.ts` is the enforcement point.
- **One geometry and schedule authority** — `src/lib/cameraBounds.ts` and `src/lib/camera.ts` own fitting, snapshot semantics, and later-start override; Copilot must not duplicate them or guess dimensions.
- **Frozen request timing/frame context** — `src/agent/useAgentStore.ts`, `src/agent/serialize.ts`, and `src/lib/frameGrid.ts` distinguish the captured logical camera frame from `activeFrameId` and approval-time navigation.
- **Virtual preview is not persistence** — `src/agent/previewSelectors.ts` and `SceneCanvas.tsx` keep pending actions virtual and exclude delete-marked camera clips from evaluation while retaining deletion styling.
- **Valid overlap is non-destructive** — `src/lib/camera.ts`, `validate.ts`, and lifecycle revalidation must preserve authored old clips and explicit returns; only an explicit DELETE/UPDATE may change a scheduled return.
- **Existing agent contracts remain strict** — `validate.ts` and `systemPrompt.ts` preserve Hebrew text, expression-pair, frame-ID, UI-field, and WIP snapping rules.

### Test plan
- Add `src/agent/cameraRequests.test.ts` blocks for object/region/frame modes, frame-local regions and padding, defaults/legacy width, finite/positive validation, unavailable bounds, conflicting numeric destinations, and descriptor consumption.
- Extend `src/agent/validate.test.ts` with camera whitelist/normalization, CREATE defaults, UPDATE preservation, full resulting-item validation, ordered CREATE→UPDATE/DELETE, accepted overlap, missing-frame/invalid-width/time failures, and the frozen “time 5, duration 1, return 9” example with ambiguous/unavailable target clarification.
- Extend `src/agent/serialize.test.ts`, `commit.test.ts`, and add `previewSelectors.test.ts` for logical frame context, request-only field stripping, fresh-state actions, virtual pending/deleted camera effects, independent return preservation, and no committed mutation.
- Add `src/agent/useAgentStore.test.ts` for provider-await playhead/geometry changes, stale schedule rejection without partial writes, approved overlap, rejection/superseding/cancel restoration, clarification with `actions: []`, and the B `7..11` / explicit return `9..10` case.
- Add `src/agent/providers/schema.test.ts` for canonical/Gemini CREATE and UPDATE parity; no live keys or network calls.
- Run the focused suite from `manim-timeline/`: `npx vitest run src/agent/cameraRequests.test.ts src/agent/validate.test.ts src/agent/serialize.test.ts src/agent/commit.test.ts src/agent/previewSelectors.test.ts src/agent/useAgentStore.test.ts src/agent/providers/schema.test.ts`, then `npx vitest run src/agent`.
- Run integration gates: `npx vitest run src/lib/camera.test.ts src/lib/cameraBounds.test.ts src/store/useSceneStore.camera.test.ts src/codegen/cameraCodegen.test.ts src/codegen/manimExporter.overlap.test.ts`, `npm run build`, `npm run test`, `npm run lint`, and touched-file ESLint. Record unrelated baseline lint separately.
- Manual acceptance must use the existing app with a measured, explicitly named axes target at playhead 5: review zoom `5..6`, hold `6..9`, return `9..10`; reject and re-propose; change playhead after request; approve; test overlap/override, stale edits, ambiguous names, unavailable measurement, deleted frame, save/reopen, and undo/redo. Never store a Copilot API key in source or handoffs.

### Open questions

## Implementation notes (copilot-dev)

- What changed, per file.
- Deviations from the plan and why.
- Commands run and their result (paste short excerpts, not full logs).
- Anything left undone and why.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| … | … | pass / fail + one-line evidence |

- Out-of-scope changes found in the diff (files not in "Touched files"):
- Claims in "Implementation notes" that could not be confirmed:

Verdict: **pass** / **fail** (fail sends `status` back to `implementing`).

## Review notes (manim-reviewer / ui-reviewer — optional)

Findings in severity order, each with file:line and a concrete fix suggestion.

## Docs delta (docs-keeper)

- README sections touched, `*Last updated:*` trailer extended: yes/no
- ARCHITECTURE.md touched: yes/no
- idea.md item closed or updated: which
