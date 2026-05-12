# Feature Ideas And Status

This file is a handoff note for future agents. It tracks which feature directions were already explored or implemented, and what remains useful to build next.

## Done Or Recently Implemented

1. Measurement-aware text layout, first slices
   - Added ink-aware frame-edge alignment for text-line `to_edge` positioning.
   - `to_edge` can now distinguish legacy behavior, Manim/VGroup bbox alignment, and tight visible ink alignment.
   - Added quick layout buttons for measured text lines, such as visible-ink edge alignment and Center X.
   - Fixed the Center X follow-up issue: manual X/Y editing should work with active `set_x` / `set_y` positioning steps instead of appearing stuck.
   - Important design decision: layout helpers should keep writing ordinary `posSteps`, so users can inspect and edit the result in the existing Positioning steps UI.

2. Copilot support for `graphFunctionSeries`
   - Basic Copilot CREATE support for `graphFunctionSeries` was planned and handed off.
   - Expected completed behavior: the agent can create a function series on valid axes with `jsExpr`, `pyExpr`, `nMin`, `nMax`, `displayMode`, and `mode`.
   - Follow-up check found that advanced editing support is already present:
     - The system prompt instructs UPDATEs for `displayMode`, `mode`, `nMin` / `nMax`, defaults, and per-`n` styling/timing.
     - `validate.ts` normalizes `graphFunctionSeries` UPDATE patches, including `perN`, `defaults`, `nMin` / `nMax`, `mode`, `jsExpr`, and `pyExpr`.
     - `commit.ts` deep-merges `perN` and `defaults` so partial Copilot edits do not wipe user-authored styling.
     - Tests cover per-`n` update normalization and deep-merge behavior.

3. Explicit audio-to-visual binding
   - Added an item-level Audio binding selector using the existing `audioTrackId` model.
   - Semantics:
     - Auto: use existing timeline-overlap heuristic.
     - None: disable audio binding for that item.
     - Explicit track: bind the visual item to a selected audio clip.
   - Export already preferred explicit `audioTrackId`; the main work was UI and explicit-none behavior.

4. Timeline binding clarity
   - Audio/visual timeline indicators were explored.
   - Final user preference: when an audio track is explicitly bound to a visual clip, the real audio clip should snap to the visual clip's timeline start and follow it when the visual moves.
   - Do not use ghost audio overlays or duplicate audio blocks for this behavior.
   - Important design decision: explicit binding means the visual item owns the audio track's `startTime`.
   - If one audio track is bound to a different visual item, the app should prevent ambiguous ownership or clearly resolve it.

5. Selection Fragment export cleanup
   - The Selection Fragment UI was identified as not useful.
   - If still present, remove only that feature:
     - UI labeled "SELECTION FRAGMENT"
     - Compact / Strip segment wait controls
     - Export JSON / Export `.mtproj` / Copy JSON for selection fragments
   - Do not remove normal project save/load, normal `.mtproj` bundles, or normal export.

6. Script-to-timeline workflow, MVP
   - Added a Copilot preset inside the existing AI panel.
   - Users can paste a Hebrew lesson script and click "Propose timeline".
   - The app wraps the script in a strict prompt and sends it through the normal `sendMessage` path.
   - The LLM still emits ordinary `CREATE` / `UPDATE` / `DELETE` actions.
   - Existing validation, pending preview, Approve, and Reject behavior are reused; the script panel does not directly mutate scene state.
   - Added focused tests for `scriptToTimelinePrompt`.
   - Verified with `npm test -- scriptToTimelinePrompt`, `npm test -- validate`, and `npm run build`.
   - Important design decision: keep this as an AI Copilot preset first, not a deterministic markdown parser or project importer, until the workflow proves useful.

7. Property panel canvas-anchor implementation
   - Wrote `property-panel-canvas-anchor-guide.md`.
   - Wrote `property-panel-canvas-anchor-composer-task.md` for the implementation handoff.
   - Implemented the behavior: the Properties popup now opens from the top-left of the black canvas frame instead of the top-right of the app viewport.
   - Approach: measure `SceneCanvas`'s `containerRef` with `getBoundingClientRect()`, pass the rect through `App`, and initialize `PropertyPanel` position from that anchor.
   - Keep dragging/resizing unchanged and only reset the position when the panel opens.

8. Axes editor scale and appearance controls
   - Moved `Scale X` / `Scale Y` from the Positioning tab to the Base tab in `AxesEditor`.
   - Added optional axes appearance fields: axis stroke color, stroke width, tip shape, and tip length.
   - Added an Appearance section to the axes editor and wired the new fields through factory defaults, validation normalization, and Manim codegen.
   - Verified with `npm test` and `npm run build`.

9. Reliable canvas playback for axes and ordinary plots
   - Added canvas-side create/progress playback for axes and ordinary `graphPlot` items, so they animate with normal Play/scrubbing like function series.
   - Axes preview now uses a richer phased create spec: x-axis, y-axis, ticks, reveal marker, and canvas arrowheads when tips are enabled.
   - Fixed axes visibility when zero is outside the displayed domain by clamping canvas axes to the nearest frame edge instead of drawing them outside the graph box.
   - Removed dedicated replay buttons; playback is driven by the normal timeline playhead.
   - Verified with `npm test` and `npm run build`.

## Good Next Features

1. Script-to-timeline follow-up
   - Test the MVP with real Hebrew lesson scripts and tighten the prompt based on failures.
   - Add examples or quick-start presets in the Script panel if users need structure.
   - Consider timeline chunking for long scripts, but only after the basic proposal quality is understood.
   - Later, add narration chunk/audio generation or deterministic parsing of a small markdown DSL.

2. Copilot support for more graph item kinds
   - Add `graphField` once its invariants are reflected in validator normalization and provider schemas.
   - Add `graphArea` after that; it has more cross-reference and geometry cases, so it should not be the first follow-up.

3. More measurement-aware layout tools
   - Align/distribute multiple selected items by visible ink bounds.
   - Add measured vertical spacing tools for proof steps and chain calculations.
   - Add overlap avoidance for measured text blocks.
   - Add snap tools for `next_to` chains while keeping generated `posSteps` visible.

4. Audio binding refinements
   - Add optional word-boundary or transcript-range binding after the simple whole-track binding is stable.
   - Consider splitting one long narration track into visual slices, but only with a clear UI model.
   - Keep the current rule clear: one explicitly bound audio clip should follow its owning visual clip.

## Larger Backlog

1. Reusable scene blocks and templates
   - Presets for theorem titles, definitions, proof steps, chain calculations, axes plus plot plus marked point, series visualizations, and transform layouts.
   - Store templates as ordinary scene items or compounds where possible.

2. Render-backed preview validation
   - Add a quick render for the current frame or selected time range using `/api/render`.
   - Use it to catch Manim/canvas mismatches in positioning, graph rendering, function series, and exit animations.

3. Future Manim-backed preview mode
   - Long-term direction: keep Konva as the interactive editor geometry, but optionally add Manim-rendered preview snapshots for selected moments or final-frame comparison.
   - A full Manim preview would send scene state at time `t` to a preview server, render a PNG/frame sequence/video snippet, and draw that result as canvas image layers.
   - Benefits: much better fidelity for axes, Hebrew text, labels, tips, stroke defaults, Manim layout, and final render parity.
   - Costs: slower edit feedback, heavier cache invalidation, more server dependency, and harder animation preview because exact motion requires frame sequences or video rather than a single PNG.
   - Interactivity still needs Konva underneath for dragging, snapping, selection, graph-point placement, and editor hit testing.
   - Best future shape: opt-in "final preview" / "render comparison" snapshots with careful hash caching, not a replacement for the default editing loop.

4. Timeline diagnostics
   - Explain why an item is visible at the current time.
   - Show which exit animation controls its end.
   - Show which audio track is matched or explicitly bound.
   - Explain where export waits, audio starts, and audio tails are inserted.
   - Surface validation locks and timing issues in a user-facing way.

5. Desktop packaging polish
   - Improve the Tauri path toward a single local tool.
   - Add clearer sidecar status, auto-start behavior, dependency checks, render logs, and export readiness feedback.

## Notes For Future Agents

- Use `HebrewMathLine` conventions and project rules for Hebrew/math text.
- Prefer writing user-visible layout changes as `posSteps`.
- Do not introduce hidden layout state when existing positioning steps can express the behavior.
- For audio binding, do not reintroduce ghost clips unless the user explicitly asks for an overlay model. The preferred model is real audio snapping to the bound visual clip.
- Before changing Copilot support, update all relevant parts together: allowed kinds, validator normalization, provider schemas, system prompt, and tests.

