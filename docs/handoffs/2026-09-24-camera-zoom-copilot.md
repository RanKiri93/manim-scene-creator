---
slug: camera-zoom-copilot
created: 2026-09-24
status: planned
owner_role: copilot-dev
next_tool: any
source: user request
---

<!--
Copy this file to docs/handoffs/<created>-<slug>.md.
Each role appends ONLY its own section. Never edit a section written by an earlier role;
add a dated note under your own section instead. Update the frontmatter `status`,
`owner_role`, and `next_tool` when you hand off.
-->

## Plan (architect)

### Goal
Allow the in-app Copilot to propose, preview, and apply the same camera clips users can author manually, including: **"At this current time, zoom in on a rectangle around axis 2, and 3 seconds after it is done, add a zoom out."** The proposal must resolve an exact existing target, use the request-time playhead, calculate the return time from the zoom's end, and await approval. This is stage 3, after `2026-09-24-camera-zoom-editor.md` and `2026-09-24-camera-zoom-codegen.md`, not a separate camera system.

### Non-goals
- No implementation in this architect session; no edits to existing WIP or live-provider calls.
- No new camera action family/collection, persisted relative-time DSL, model-invented bounds, invisible object transformations, or visible surrounding rectangle unless explicitly requested as content.
- No model access to UI measurement/raster caches, secrets, server execution, or automatic approval. No expansion of unrelated allowed object kinds.
- No live camera following or same-proposal create-new-object-then-measure-it shortcut in the approved snapshot version. An unmeasured/unsupported target requires clarification or a region supplied through the UI.
- No editor/codegen edits by copilot-dev. If their shared API is insufficient, return to the preceding owner rather than duplicating camera geometry here.
- Expanding v1 to fit a not-yet-created or not-yet-measured object within one proposal requires a separate dependency/measurement design. Use existing reliable targets or an explicit region, and ask rather than fabricate geometry.

### Evidence and order
- Read `AGENTS.md`, Git status, `copilot-add-kind`, README AI Copilot/Canvas/Export timing, `src/agent/ARCHITECTURE.md`, and relevant test bodies.
- `camera_move` already participates in ordinary SceneItem CRUD/preview, but is not in `AGENT_ALLOWED_KINDS`. Extending that kind is smaller than introducing CREATE_CAMERA_EVENT and a second proposal track.
- `currentTimeSec`, frame catalog, start frame and active creation frame already reach the provider. Validation currently uses a fresh item map after the async provider call; it does not have a frozen camera-fit/playhead context. `activeFrameId` is not the timeline camera's current frame.
- `types.ts` currently uses a permissive canonical **`anyOf` + enum** schema and OpenAI `strict: false`; the skill/architecture's older strict/`oneOf` description is stale. Extend actual provider-compatible schemas, not the stale representation. Gemini's flat schema must explicitly declare new camera and timing fields for both CREATE and UPDATE.
- `commit.ts` already handles scalar camera fields via generic CRUD and re-reads `getState()` per action. `previewSelectors.ts` already merges camera CREATE/UPDATE; DELETE retains the clip for red styling, so stage 1 must filter it out of camera evaluation.
- Existing IDs/labels are serialized, but **"axis 2" is not a guaranteed item ID or ordinal**. Use UI display names plus real IDs/frame context where useful and ask if ambiguous. Never map the phrase to the second Map entry.
- Tests read: `serialize.test.ts` (`stripUiFields`, `buildContextPayload`, `frame-aware Copilot context`); `validate.test.ts` (`validateAgentResponse`, `allowed kind boundary`, `frameId validation`); `commit.test.ts` (`commitActions — graphFunctionSeries deep-merge`, `commitActions — target_animation row merge`). No existing camera proposal lifecycle/provider schema tests establish the requested behavior.
- Preserve the WIP inventory in stage 1, especially `validate.ts`'s uncommitted `snapBuffer: 0.3` text default. Stage 1 owns schema/factory migration; stage 2 owns export/runtime proof.
- **User follow-up, 2026-09-24:** all product decisions are approved; later zoom-ins override earlier zoom-ins rather than being rejected for overlap, and **scheduled returns remain in place**. Teach the shared later-start rule, continuous interruption and no resumption to the model; do not ask it to delete/trim an earlier zoom merely to avoid overlap or cancel/retime/retarget another explicit future command.
- Delegation order: editor-dev and codegen-dev implement in order with verification before copilot-dev starts. Copilot work may be reviewed in advance but must not be implemented in parallel against hypothetical shared APIs. Use the actual upstream Implementation notes/test evidence, not a second camera scheduler. No further product confirmation is required.

### Implementation outline

**Reuse camera items and public operations**
- Add `camera_move` to the allowed-kind whitelist. Keep validated `AgentAction` as CREATE/UPDATE/DELETE of SceneItems. Persist only stage-1 `targetFrameId`, offsets, `targetWidth`, start/duration and ordinary metadata.
- Introduce an agent-side **request-only** `cameraTarget` descriptor, accepted only on camera CREATE or camera UPDATE: object `{mode: 'object', targetId, padding?}`, region `{mode: 'region', frameId, left, right, top, bottom}`, or full frame `{mode: 'frame', frameId}`. Region values are frame-local Manim units, not screen pixels. This mirrors **Fit selected object**, **Zoom to region**, and **Zoom to frame**; it is not a hidden transformation.
- Resolve this descriptor through the shared stage-1 camera/bounds API. Consume/remove it before producing validated actions; do not add it to persisted `CameraMoveItem`, store it in project JSON, or retain it as a live dependency. Reject a descriptor mixed with conflicting numeric destination fields instead of guessing precedence. A direct numeric camera destination remains allowed if valid.
- Object mode requires an exact existing request-snapshot ID and supported reliable bounds. No generic `getItemBBox` guessed text fallback and no accidental axes-wide fit for a graph dot. If bounds are unavailable, provide a conversational clarification with **no actions for the dependent proposal**, not a fabricated zoom-in or an orphan zoom-out.

**Freeze context and make timing explicit**
- Capture request-time items, frames, playhead and resolved logical camera frame before awaiting the provider. Pass a local fit-resolution snapshot to validation; continue stripping measurements from the provider payload. Include a small camera context in serialization (current logical frame/pose and supported target names/IDs), clearly separate from `activeFrameId`.
- Prompt: "now" means the captured `currentTimeSec`. With zoom start T and duration D, **three seconds after it is done** means return start **T + D + 3**, not T+3 and not a three-second zoom. Use the shared approved default duration when omitted. Existing absolute numeric fields suffice; do not add a dependency expression language.
- Resolve the numeric destination once against that snapshot. Approval at a later playhead must not re-anchor the start time or recalculate object bounds. Before approval, revalidate frame existence, numeric data and the reviewed camera schedule against live state. Valid overlap is not a conflict: an unchanged reviewed overlap applies normally. If intervening scene/camera edits change the reviewed source pose, winning clips or interruption effects, ask to regenerate instead of applying a materially different shot or partially applying. A source object's later edit does not silently move a snapshot shot; distinguish this from a deleted destination frame.
- Return uses an explicit frame target according to the agreed semantics, normally the frame associated with the zoom, not the current editor creation frame at approval time. For "current frame", use the shared logical-frame result even during motion: last actually completed, non-interrupted camera destination, otherwise `startFrameId`. Motion itself is not ambiguous and does not require clarification. Ambiguous target names or genuinely unresolvable frame/data references lead to a clarifying response with `actions: []`.

**Validation, preview and reviewability**
- Add a dedicated camera normalizer/helper so the large WIP `validate.ts` needs a small integration surface. Mirror factory defaults, finite numeric constraints, shared duration/width policy and valid destination frames. Accept camera overlaps, including those introduced by UPDATE; resolve them with stage 1's shared later-start/equal-start rules. Missing width on legacy/full CREATE means full frame; missing width in UPDATE preserves the existing value.
- Validate the resulting UPDATE item, not an unchecked patch. Keep `id`/`kind` immutable, reject request-only fields on other kinds and UI cache leakage, and simulate ordered camera CRUD to check intermediate and final items against the same per-action store guards. Keep reference/ID validity checks, but remove any proposed DELETE-before-CREATE or rejection requirement whose sole reason was camera overlap. Reject a genuinely malformed mixed batch before committing any part.
- Model actual same-batch dependencies: CREATE camera -> UPDATE camera works; DELETE removes a camera from the simulated schedule and reveals the recomputed earlier trajectory; unknown IDs and malformed data fail. Older camera items retain their authored starts/durations when superseded. Fit-to-object created in the same response is intentionally unavailable until measurement/selection supports it; explain rather than guess.
- Both schemas expose cameraTarget modes/fields, targetFrameId/offsets/targetWidth and startTime/duration, preserving other item variants. In Gemini use flat optional fields/descriptions, no unsupported union/const structure. UPDATE must retain all existing non-camera update properties.
- Generic commit dispatch should need no production change: preserve per-action `getState()`. Generic preview merge remains authoritative. Add compact camera destination, authored start/duration/end and effective override summaries to the proposal rows so the timing and **overrides <clip> at <time>** effect can be reviewed before approval. Use shared schedule metadata, not a duplicate overlap evaluator. Pending camera moves are visible as normal preview-treated timeline clips; Reject/Supersede removes their virtual effect and restores the original camera history.
- Prompt and validation must distinguish replacing an earlier zoom from cancelling another explicit future command. Preserve existing scheduled returns: A at 5/B at 7/return at 9 still runs the return at 9 with its original duration and destination, even if it interrupts B. Do not silently add a DELETE, dependency link, new return time or new return target. Only an explicit requested edit/delete changes that return. A return that already completed before the new zoom supplies the full-frame source through the same shared evaluator.
- Keep clarification separate from malformed-data errors: unavailable/ambiguous geometry should invite a supported alternative, not appear only as a red schema error. No live model call is required for automated coverage.

### Touched files
Paths are relative to `manim-timeline/` unless noted.

**Copilot model/schema and validation (`src/agent/`)**
- `src/agent/types.ts` — camera whitelist, request-only descriptor/context types, canonical schema camera field descriptions; keep action union unchanged.
- `src/agent/providers/gemini.ts` — flat camera CREATE/UPDATE fields, common timing fields and descriptions in sync with canonical schema.
- `src/agent/cameraRequests.ts`, `src/agent/cameraRequests.test.ts` **(new)** — shared-library adapter for request-only target resolution/defaults, normalized numeric output and clarification outcomes.
- `src/agent/validate.ts`, `src/agent/validate.test.ts` — camera CREATE/UPDATE and ordered schedule validation integration; preserve snapBuffer WIP and all existing normalizers.
- `src/agent/systemPrompt.ts` — public camera operations, exact-ID targeting, request-time anchor, end-plus-delay arithmetic, later-start override, approved defaults and clarification boundaries.

**Copilot context/lifecycle and UI**
- `src/agent/serialize.ts`, `src/agent/serialize.test.ts` — compact camera/current-frame/name context without raw measurement/cache leakage.
- `src/agent/useAgentStore.ts`, `src/agent/useAgentStore.test.ts` **(test new)** — frozen local resolution context, clarification responses and pre-approval stale-camera-effect/invalid-target checks; valid reviewed overlap is accepted. Preserve cancellation and provider history behavior.
- `src/agent/AgentPanel.tsx` — readable camera timing/override proposal summaries within existing approval/rejection flow; no new panel architecture.
- `src/agent/commit.test.ts` — camera generic CRUD and fresh-state regression; production `commit.ts` should remain unchanged.
- `src/agent/previewSelectors.test.ts` **(new)** — camera virtual CREATE/UPDATE/DELETE behavior; production selector changes only if tests expose a required defect, never a second camera collection.
- `src/agent/providers/schema.test.ts` **(new)** — mocked provider requests verify canonical/Gemini camera field parity and unchanged non-camera actions.

**Docs**
- `src/agent/ARCHITECTURE.md` — allowed-kind list, request-only normalization/current-time snapshot, approval and supported camera limitations; correct the directly affected schema description to actual `anyOf`/enum behavior.
- `manim-timeline/README.md` (repo-relative, WIP) — AI camera example, editable duration, snapshot/clarification behavior, and Last-updated trailer after integrated verification; preserve earlier stage/WIP documentation.
- `docs/handoffs/2026-09-24-camera-zoom-copilot.md` (repo-relative, **new**) — this plan; later roles append only their sections.

### Invariants at risk
- **Provider schema parity:** `src/agent/types.ts` and `src/agent/providers/gemini.ts` enforce separate canonical/flat contracts. Omitted Gemini fields can disappear silently; test both CREATE and UPDATE timing/targets.
- **Only normalized approved items mutate the scene:** `src/agent/validate.ts`, `src/agent/useAgentStore.ts`, `src/agent/commit.ts`, and `src/store/useSceneStore.ts`. Request-only camera descriptors must not leak into actions/project persistence, and a dependent two-clip proposal must not half-apply.
- **Per-action fresh state:** `src/agent/commit.ts` calls `getState()` inside the loop. Preserve that so camera CREATE -> UPDATE/DELETE works; current tests do not directly establish this camera case.
- **Measurement privacy and one geometry authority:** `src/agent/serialize.ts`/`types.ts` strip UI fields; new `src/lib/camera.ts`/`cameraBounds.ts` own fitting. Model output names a target but never replaces measured geometry with a guessed rectangle.
- **Time/frame anchoring:** `src/agent/useAgentStore.ts` captures the request; new camera context must preserve it through provider await and approval. `src/lib/frameGrid.ts` distinguishes owning grid frames from camera/editor navigation. Never equate `activeFrameId` with the camera view.
- **Virtual preview and rejection:** `src/agent/previewSelectors.ts`/`useAgentStore.ts` keep pending actions out of persisted state; stage-1 `SceneCanvas.tsx` excludes delete-marked cameras from evaluation while retaining timeline deletion styling.
- **Override parity without destructive edits:** new `src/lib/camera.ts`, `src/agent/validate.ts`, and `src/agent/useAgentStore.ts` enforce the same later-start/equal-start schedule for manual, pending and committed camera items. Overlap alone is valid; a newer proposal does not trim/delete older clips, shorten scene duration, or change the reviewed source pose silently at approval.
- **Existing text/expression contracts:** `src/agent/validate.ts`, `systemPrompt.ts`, and existing validation/commit tests enforce Hebrew raw/segments, Alef defaults, expression pairs and deep merge. Camera support must not loosen those rules or overwrite WIP defaults.

### Test plan
No tests/builds/live-model calls run during planning. Load `copilot-add-kind` before implementation.

**Add/extend exact tests**
- `src/agent/cameraRequests.test.ts`: `describe('camera target requests')` — all three modes, exact frame-relative fit, padding, legacy width/default duration, unavailable bounds, nonfinite/zero rectangles, unsupported/same-batch-new targets, descriptor consumed and conflicting numeric destination rejected.
- `src/agent/validate.test.ts`: `describe('camera_move normalization')` — CREATE defaults, UPDATE preserves omitted scalars, full resulting-item validation, invalid IDs/frame/width/time, immutable fields, no UI leakage, ordered camera CREATE/UPDATE/DELETE, accepted overlaps from CREATE/UPDATE, no unnecessary DELETE of the previous zoom, malformed intermediate/final items rejected. Keep `allowed kind boundary` and `frameId validation`; `camera_move` is non-drawable and must not get a generic drawable `frameId` stamp.
- Same file: `describe('camera zoom and return proposal')` — frozen currentTime **5**, default duration **1**, return start **9**, return duration **1**; frame center/full width restored. Missing target/bounds rejects or clarifies the whole dependent pair. Unknown or ambiguous "Axis 2" must not be guessed from iteration order.
- `src/agent/serialize.test.ts`: `describe('camera-aware Copilot context')` — frame/pose separate from active creation frame, shared logical frame during an in-progress/interrupted camera transition, names with exact IDs, committed camera items/width present; keep `stripUiFields` assertions excluding axes bounds, PNGs and measurement caches.
- `src/agent/commit.test.ts`: `describe('commitActions — camera_move')` — CREATE then UPDATE of that new ID in one call; CREATE then DELETE; overlapping new zoom leaves earlier authored clips unchanged; scalar preservation and no request-only fields in stored/exported items. Preserve existing deep-merge tests. In A 5..6/return 9..10 followed by CREATE B 7..8 (and UPDATE B to end at 11), keep the existing return ID, start, duration and destination unchanged; explicit requested DELETE of the return still works.
- `src/agent/previewSelectors.test.ts`: `describe('buildPreviewState — camera_move')` — immutable preview map, created/updated width, delete op retains timeline item, no committed mutation; feed the preview through the shared schedule to show a pending later zoom interrupts continuously and deleting it reveals the original trajectory. Stage-1 evaluator/consumer tests prove deleted cameras have no virtual effect.
- `src/agent/useAgentStore.test.ts`: `describe('camera proposal snapshots')` — mocked provider captures T=5, playhead changes while awaiting and before approval, geometry changes after snapshot, no re-anchoring; reviewed overlap accepted and matches committed pose, old clip duration unchanged, rejection/superseding/cancel restores old camera history, clarification with actions empty, stale frame or changed camera effects stop approval without partial writes (not overlap itself), approval exactly once.
- Same lifecycle block: pending/approved B 7..11 leaves the already-scheduled return 9..10 active; shared preview shows the return interrupting B at 9, full frame at 10 and no B resumption through 11. Rejecting B removes only its virtual effect, not the committed return. Provider prompt/schema request mocks retain the instruction to preserve explicit returns unless the user requests an edit/delete.
- `src/agent/providers/schema.test.ts`: `describe('camera_move schema parity')` — captured mocked OpenAI/Anthropic canonical and Gemini-flat requests contain camera modes, IDs, width, offsets and start/duration for CREATE/UPDATE; retain existing non-camera update fields. No live keys/network calls.

**Exact commands; working directory `manim-timeline/`**
```powershell
npx vitest run src/agent/cameraRequests.test.ts src/agent/validate.test.ts src/agent/serialize.test.ts src/agent/commit.test.ts src/agent/previewSelectors.test.ts src/agent/useAgentStore.test.ts src/agent/providers/schema.test.ts
npx vitest run src/agent
npx vitest run src/lib/camera.test.ts src/lib/cameraBounds.test.ts src/store/useSceneStore.camera.test.ts src/codegen/cameraCodegen.test.ts src/codegen/manimExporter.overlap.test.ts
npm run build
npm run test
npm run lint
npx eslint src/agent/types.ts src/agent/providers/gemini.ts src/agent/cameraRequests.ts src/agent/cameraRequests.test.ts src/agent/validate.ts src/agent/validate.test.ts src/agent/systemPrompt.ts src/agent/serialize.ts src/agent/serialize.test.ts src/agent/useAgentStore.ts src/agent/useAgentStore.test.ts src/agent/AgentPanel.tsx src/agent/commit.test.ts src/agent/previewSelectors.test.ts src/agent/providers/schema.test.ts
npm run dev
```
Record unrelated baseline lint separately; touched-file lint must pass.

**Manual acceptance / integrated verification**
- With a measured stable axes explicitly named **Axis 2** on a non-origin frame and the playhead at 5, send the user's example. Expected pending proposal: camera zoom **5..6**, hold **6..9**, full-frame return **9..10** (using approved defaults). No drawable rectangle is added.
- Review both destinations and durations in the proposal; scrub the preview, Reject, propose again, move playhead, and Approve. Approval must keep the original request's timing and captured bounds. Change duration using normal camera UI and by a follow-up AI UPDATE; DELETE the return and verify the zoomed pose persists.
- Propose a second zoom during an existing zoom and during its held view: review the named override/time, confirm continuous source pose and no resumption of the old zoom, then Reject/Approve and compare manual UI authoring. Repeat after a completed full-frame return. Keep old clip bars/durations unchanged. With A 5..6 and return 9..10, proposing B 7..8 must leave that return unchanged; extending B to 11 still permits the return to interrupt it at 9, reach full frame at 10 and hold through 11.
- Repeat with two ambiguously named axes, unavailable axes measurement, malformed camera data, a live camera edit changing the reviewed effect, and a destination frame deleted before approval. Expect clarification/diagnostic and no partial mutation, not an invented target, delayed animation, or rejection merely because two cameras overlap.
- If a live provider/key is unavailable, record the live smoke as not run and retain mock evidence; never write keys to source or handoffs. With a key, test one canonical-schema provider and Gemini because their contracts differ.
- Final verifier repeats the stage-2 real-export/render acceptance with the AI-authored pair, plus save/reopen and undo/redo. ui-reviewer checks proposal clarity; manim-reviewer checks camera timing/viewport; docs-keeper updates README/trailer and ARCHITECTURE only after verified behavior.

### Open questions

## Implementation notes (<owner_role>)

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
