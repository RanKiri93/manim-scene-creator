---
slug: copilot-agent-loop
created: 2026-10-16
status: implementing       # planned | implementing | verifying | reviewing | docs | done | blocked
owner_role: copilot-dev     # editor-dev | codegen-dev | server-dev | copilot-dev
next_tool: any             # opencode | cursor | any
source: user request (2026-10-15/16): "give the Copilot more freedom … and let it test its results with the preview"
---

## Plan (architect)

### Goal
The Copilot can carry out multi-step requests such as *"add the graph of a continuous function on
[0,1], show a point moving along it from x=0 to x=1, and add a vertical segment from the point to
the x-axis that moves with it"* in one conversation turn. It works in a bounded tool loop on a
draft: it proposes changes, gets validation errors back and fixes them, inspects exact positions
and timings, checks the Manim export, and looks at a snapshot of the preview, before handing the
finished proposal to the user. Approving a proposal is one undo step.

Decisions made by the user (2026-10-16):
1. The moving segment is a **general building block**: a line/arrow shape whose two ends can be
   bound to anchors (a graph dot, the dot's foot on an axis, a fixed graph point, a fixed point, or
   another object), redrawn every frame in preview and export.
2. Tool loop for **Anthropic first, then OpenAI**. Gemini stays single-shot for now. OpenAI should
   also be usable through a ChatGPT subscription ("usage"), as OpenCode does.
3. The loop **may change the scene** while working: the draft is shown live on the canvas, and a
   setting (on by default) applies the final result automatically as one undo step. Turning it off
   restores Approve / Reject.

### Non-goals
- No raw Manim code from the model (breaks preview fidelity and the `HebrewMathLine` rule).
- No Gemini tool loop; Gemini keeps the single-shot path (schemas still updated together).
- No token streaming in the chat UI.
- No new top-level `SceneItem` kind: the connector is an optional field on `shape` (line/arrow).

### Steps (each step is committed on its own)
1. **Fixes.** Unknown `target_animation.mode` is an error (no silent `scale`); UPDATE of a kind the
   agent may not create is an error; unknown UPDATE fields are reported; Anthropic extended
   thinking no longer combined with a forced `tool_choice`; current thinking models detected;
   `max_tokens` raised; default models updated; approving a proposal is one undo entry.
2. **Expose what the editor already does.** `graphDot.dot.attachment`, `showCoordinates`,
   `showProjectionGuides`, label/coordinate styling; `target_animation` mode `graphFollow` with
   `graphPlotId` / `targetX` / `graphCurveId` / `targetT` / `easing`, validated with
   `lib/graphMotion.ts`; system-prompt rules + both schemas.
3. **Connector building block.** `ShapeItem.endpoints?: { start: ShapeAnchor; end: ShapeAnchor }`
   for `line` / `arrow`. Pure resolver in `lib/shapeAnchors.ts` (shared by canvas and validation),
   canvas rendering in `SceneCanvas` / `ShapeNode`, export as a `become(...)` updater in
   `shapeCodegen.ts` + `manimExporter.ts`, Properties UI, agent normalizer + schemas + prompt.
4. **Tool loop (Anthropic, then OpenAI).** `agent/loop/`: draft state, tools
   `propose_changes`, `reset_draft`, `inspect_scene`, `check_export`, `finish`; at most 10 model
   calls per turn; validation errors returned to the model; the draft drives the canvas preview
   while the loop runs; auto-apply setting.
5. **Seeing.** `snapshot_preview(time)` tool: the canvas registers a capture function; the loop
   seeks the playhead, waits for paint, crops the camera frame, restores the playhead, and sends
   the PNG to the model. Measure-server `/api/render_frame` (Manim `-ql`, one frame via ffmpeg)
   behind a `render_manim_frame` tool.
6. **Recipes.** System-prompt recipes for the tool loop (point on graph + drop line, tangent-style
   connectors, labels that follow).
7. **OpenAI through a ChatGPT subscription.** Provider `chatgpt` using the Codex OAuth (PKCE)
   login proxied by the measure server; tokens kept in browser `localStorage` only.

### Touched files
- `types/scene.ts`: `ShapeAnchor`, `ShapeItem.endpoints?` (optional; no persisted-shape migration
  needed for old files, `PROJECT_VERSION` bump so older apps refuse files that use it).
- `lib/shapeAnchors.ts` (new): anchor → world point at time t; graph→world mapping.
- `lib/time.ts`: bound shapes are not targets of positional target animations.
- `codegen/shapeCodegen.ts`, `codegen/manimExporter.ts`: bound-line updater.
- `canvas/SceneCanvas.tsx`, `canvas/layers/ShapeNode.tsx`: bound-line rendering, no drag.
- `panels/ShapePropertiesEditor` (or the shape section of `PropertyPanel`): endpoint pickers.
- `agent/types.ts`, `agent/validate.ts`, `agent/systemPrompt.ts`, `agent/commit.ts`,
  `agent/useAgentStore.ts`, `agent/AgentPanel.tsx`, `agent/previewSelectors.ts`,
  `agent/providers/*`, `agent/loop/*` (new), `agent/ARCHITECTURE.md`.
- `measure_server.py`: `/api/render_frame`, Codex login/proxy endpoints.
- Docs: README trailer, ARCHITECTURE.md, idea.md §2.

### Invariants at risk
- Canonical vs Gemini schema parity (`providers/schema.test.ts`).
- `commit.ts` re-reads `getState()` per action (keep it inside the batched undo).
- Preview/export parity for the connector: the preview resolver and the emitted Python must give
  the same endpoints (tests on both sides).
- `GraphNode.tsx`, `graphCodegen.ts`, `staticAddCodegen.ts`, `leafConcurrentCodegen.ts` carry
  someone else's uncommitted WIP: do not edit them; commit only own hunks.
- `measure_server.py`: no user strings into TeX or a shell; render goes through the existing
  render helper.

### Test plan
- `npx vitest run src/agent` after every step; `npm run build`; `npm run lint` on touched files.
- New tests: `validate.test.ts` (graphFollow, dot attachment, connector, UPDATE whitelist, unknown
  mode), `lib/shapeAnchors.test.ts`, `codegen/shapeCodegen.test.ts` (bound line),
  `agent/loop/*.test.ts` (loop with a scripted fake provider: error round-trip, iteration cap,
  draft replacement, finish), `commit.test.ts` (one undo entry), provider request-building tests.
- Server: `pytest test_parser.py test_script_alignment.py`, `/health`, `/api/render_frame` once.

### Open questions
None (answered above).

## Implementation notes (copilot-dev)

**Step 1 (1152ce8).** `validate.ts`: unknown `target_animation.mode` → error (missing → `scale`);
UPDATE only on `AGENT_ALLOWED_KINDS` (DELETE on any kind); unknown UPDATE keys dropped and returned
as `warnings` (shown under the reply). `providers/anthropic.ts`: `thinkingModesFor` (adaptive →
enabled → off, retried on a 400 about thinking), `tool_choice: auto` with thinking plus a text/JSON
fallback, `max_tokens` 16000, default `claude-sonnet-5-5`; OpenAI default `gpt-5.1`; persisted
settings v3 replaces the retired defaults. `commit.ts`: one undo entry per approved proposal.

**Step 2 (5cd3dfc).** Dot attachment / annotation fields and `graphFollow` rows normalized;
`checkGraphMotion` runs `lib/graphMotion.ts` on the virtual scene (start time, end position, domain,
conflicts), syncs attached dots' `dx/dy`, fills a missing `graphPlotId` when the axes have one plot.
Dot UPDATEs merge over the stored dot. `schemaFragments.ts` feeds both schemas.

**Step 3.** `ShapeItem.endpoints` (optional, no version bump per the migration skill: every reader
tolerates `undefined`). `lib/shapeAnchors.ts` resolves anchors (graph→world mapping matches the
canvas: measured raster transform when current, else the ideal layout). Canvas draws connectors from
the resolver and locks drag/transform; Properties → Base → Connector ends edits them. Export:
placeholder `Line`/`Arrow` in defs, `generateConnectorBind` after frame shifts (redraw updater using
the current colour + an always-in-scene driver so the intro starts from current geometry; zero-length
guard). `removeItem` bakes connectors that follow the removed item; fragment import remaps anchors;
only colour target animations accept connectors. Validator `checkConnectors` + prompt rule 8e.
Checked with a real `manim -ql` render (dot moving along y = x² + 1 with a drop line and an arrow):
both follow the dot every frame. Lint: no new errors (remaining ones in `lib/time.ts` / `ShapeNode.tsx`
exist in HEAD).

**Step 4.** `agent/loop/` (draft session, tools, inspect, runner, history, env registry),
`providers/anthropicLoop.ts`, `providers/openaiLoop.ts`, `getLoopProvider`. Loop prompt variant.
Store: `useToolLoop` / `autoApply` settings (default on), `draftActions` + `loopLog` drive the live
preview and progress list, messages keep `log` and `autoApplied`. Camera-request resolution moved to
`cameraRequests.ts` (`resolveCameraRequests`) so the draft uses it too. Tests: scripted-model loop
(error round-trip, reset, step cap, export error), provider request building (thinking replay, image
tool results, thinking fallback), store auto-apply vs Approve, prompt modes. Not exercised against a
live API in this session (no key here): the request shapes follow the documented formats.

**Step 5.** `snapshot_preview` and `render_manim_frame` tools; `canvas/agentSnapshot.ts`,
SceneCanvas registration, `services/measureClient.ts` `renderSceneFrame`, `loop/manimFrame.ts`.
Server: `/api/render` refactored onto `_run_manim_render` (same behaviour), new `/api/render_frame`
(argument-list subprocesses only, scene name must be an identifier, time bounded 0–36000 s).
Gates: `pytest test_parser.py test_script_alignment.py` 41 passed; `/health` ok; `/api/render_frame`
called for real (connector scene, t = 4 s, about 6 s round trip, frame correct).
End-to-end in headless Edge with a scripted OpenAI-compatible fake model (customOpenAI provider):
the user's example (function on [0,1], point moving x = 0 → 1, vertical segment to the x-axis) went
through propose (one deliberate domain error returned and fixed) → inspect → snapshot → Manim frame →
export check → finish → auto-applied; both images reached the model and matched each other.
Observed: at t = 5 s the `-ql` Manim frame has the dot about 0.1 s behind the preview; this is the
export/preview timing topic of `2026-10-15-export-preview-timing-parity.md`, not changed here.
Snapshots still show the axes' editor chrome drawn by `GraphNode.tsx` (someone else's WIP; untouched).

**Step 6.** `agent/recipes.ts`: R1 graph sized to the frame, R2 point along a graph with drop line
(the user's example, same pieces as the end-to-end run), R3 live values, R4 arrow from text to a
moving dot, R5 emphasise then remove, R6 sequencing; R7 (loop only) check before finishing. Appended
by `buildSystemPrompt` in both modes; test in `systemPrompt.test.ts`.

## Verification (verifier)

## Docs delta (docs-keeper)
