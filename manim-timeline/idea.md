# Manim Timeline — Ideas Roadmap

This file collects product / engineering ideas that are worth discussing before
implementation. Each item should eventually become a focused implementation plan
or a small PR-sized task.

## Priority Shortlist

1. **Undo history should ignore playback / transient UI state.**
2. **Social-media export presets should become scene/project settings, not only export options.**
3. **Guided transcription should align recorded audio with the intended script.**
4. **Audio editing should grow from the current normalize / clean / match-EQ pipeline.**
5. **Agent self-feedback should start with single-frame visual review before autonomous loops.**

## 1. Social-Media Video Presets

### Goal

Allow the user to choose a target video format before authoring / rendering, so
the canvas, frame grid, Manim export, and final MP4 all share the same aspect
ratio and resolution. Main use cases: Instagram Reels / TikTok / Shorts
(`9:16`), square posts (`1:1`), and standard landscape (`16:9`).

### MVP

- Add a scene/project-level video format setting, for example:
  - `16:9 landscape` → `1920x1080`
  - `9:16 vertical` → `1080x1920`
  - `1:1 square` → `1080x1080`
  - `custom` → explicit width / height
- Feed this setting into Manim export as `config.pixel_width`,
  `config.pixel_height`, and the matching frame dimensions when needed.
- Update the canvas preview and frame grid to use the selected aspect ratio.
- Show the active format clearly in the UI, probably near project defaults or
  export settings.

### Design Notes

- This should not live only in `ExportPanel`; the authoring surface must match
  the final video.
- The existing `FrameDef` grid should remain camera-sized, but the camera cell
  dimensions need to follow the chosen format.
- Existing projects need a migration/default, probably the current Manim-style
  landscape ratio.

### Likely Touchpoints

`src/types/scene.ts`, `src/store/useSceneStore.ts`, project migrations,
canvas sizing / coordinate helpers, frame grid helpers, and Manim exporters.

## 2. Agent Self-Feedback From Rendered Frames

### Goal

Let the agent inspect visual output instead of relying only on structured scene
JSON. The agent should be able to render selected timestamps / frames, evaluate
whether the result looks good, and then propose or apply corrections.

Examples:

- Check that a graph is not clipped.
- Check that colors are readable.
- Check that function stroke width is visible.
- Check that labels and Hebrew text are positioned correctly.
- Check that objects are inside the intended frame.

### MVP

- Add a measure-server endpoint that renders one still image for a scene at a
  requested timestamp.
- Add a UI action such as `Render current frame for agent review`.
- Send the image plus scene JSON to a vision-capable provider with a small
  rubric.
- Have the agent return normal timeline actions, not hidden mutations.

### Later

- Allow the agent to run a bounded review loop:
  1. apply candidate changes,
  2. render one or more timestamps,
  3. review the result,
  4. stop when acceptable or after a limit.
- Store the rendered snapshots and review notes so the user can understand what
  changed and why.

### Guardrails

- Always use a hard iteration limit.
- Make failures visible instead of silently continuing.
- Prefer user approval before applying large visual rewrites.
- Do not let this become an unbounded render loop; rendering is expensive.

### Likely Touchpoints

`measure_server.py`, `src/services/measureClient.ts`, agent context / provider
pipeline, agent validation / commit flow, and preview UI.

## 3. Advanced Audio Editing

### Goal

Let the user fix narration clips without re-recording. The audio workflow should
support basic destructive or asset-generating edits from the timeline.

### Natural cuts (v1 — implemented)

- **Background bed:** post-production layer on a dedicated **Bed** timeline row (full-scene,
  auto-looped at export). Sources: upload music, record room tone, or **server-generated
  noise** (pink/brown/white via `/api/generate_bed_noise`). Managed via `BackgroundBedPopup`
  from the Bed lane — not tied to any narration clip.
- **Cut fades:** short fade-in / fade-out (default 40 ms, configurable 20–80 ms)
  at narration clip boundaries.
- **Export delivery:** server-side ffmpeg mixdown (`/api/mixdown_audio`) builds one
  master WAV (clips at timeline positions + fades + looped bed); after Manim render,
  ffmpeg mux replaces the video’s audio track with the master.
- **Preview:** bed and cut fades are **render-only for v1**. Timeline preview still
  plays one narration clip at a time with no bed/fade audibility.
- **Later:** WebAudio mixing graph so bed + fades are audible while scrubbing the
  timeline (deferred).

### Audio clip editor popup (partial — implemented)

- Double-click a narration clip (or **Edit** when selected) to open `AudioClipEditPopup`.
- Popup sections today: **Processing** (Clean, Normalize, Set as ref, Match EQ),
  **Timing** (gap presets T/N/I/R), **Export fades** (per-clip in/out ms), audio preview,
  processing status badges.
- Inline clip overlay is minimal (name, Linked, remove, word-boundary ticks only).

### MVP (deferred — full audio editor)

- Right-click / extended editor with:
  - waveform preview,
  - trim start / trim end,
  - split at playhead or selected time,
  - gain adjustment.
- Apply destructive edits by creating new processed assets through the measure server.

### Later

- Multi-band EQ UI.
- Noise reduction strength control.
- Non-destructive edit stack.
- Compare before / after.
- Batch operations on selected clips.
- **Preview-audible bed + cut fades** (WebAudio graph; see Natural cuts above).

### Design Notes

- The app already has normalize, clean, and match-EQ operations. The editor
  should reuse that pipeline instead of creating a separate audio system.
- Splitting a clip must also split or remap word boundaries / bookmarks.
- If an audio clip is bound to a visual item, the UI should warn before edits
  that affect duration or timing.
- Background bed assets skip Whisper on upload (`transcribe=false`).

### Likely Touchpoints

`src/timeline/AudioClip.tsx`, `src/timeline/AudioClipEditPopup.tsx`, `src/timeline/BedClip.tsx`,
`src/panels/BackgroundBedPopup.tsx`, `src/lib/audioMixdown.ts`, `src/lib/audioRenderHelpers.ts`,
`src/store/useSceneStore.ts`, `src/services/measureClient.ts`,
`measure_server.py`, and audio project serialization.

## 4. Undo / Redo Keyboard Shortcuts

### Current State

`Ctrl+Z`, `Ctrl+Y`, and `Ctrl+Shift+Z` appear to already be wired in `App.tsx`,
with safeguards for focused editable inputs.

### Goal

Make undo / redo feel like a standard desktop editor.

### Follow-Up Checks

- Confirm the shortcuts work on Windows with Hebrew keyboard layouts.
- Confirm they do not hijack typing inside text inputs / textareas.
- Confirm toolbar button state matches actual history state.
- Confirm redo works after undoing object edits.

### Likely Touchpoints

`src/App.tsx`, `src/hooks/useSceneUndoRedo.ts`, and any component with its own
keyboard handlers.

## 5. Undo Should Ignore Playback And Transient State

### Goal

Undo history should contain only meaningful editing operations: creating,
deleting, moving, styling, recording/importing audio, changing timing, changing
frames, and similar content changes.

Playback should not be undoable. Scrubbing the playhead should not be undoable.
Opening panels, selecting objects, and changing temporary UI state should also
not pollute undo history.

### Current Problem

The scene store is wrapped by `zundo`, but history currently appears to include
state such as `currentTime` and `isPlaying`. This causes a bad flow: after
playback stops, pressing Undo may restore a playback state instead of undoing the
last object edit.

### MVP

- Configure `zundo` with a `partialize` function that records only persistent
  authoring state.
- Include at least:
  - `items`
  - `frames`
  - `startFrameId`
  - `defaults`
  - `audioItems`
- Exclude at least:
  - `currentTime`
  - `isPlaying`
  - `viewRange`
  - `selectedIds`
  - `inspectedId`
  - panel open flags
  - transient capture modes
  - audio batch progress
- Add a test or manual QA checklist around play / pause / scrub / undo.

### Design Notes

- Selection may or may not deserve history later, but it should not block the
  main fix.
- Import/load paths that intentionally clear history should keep doing so.
- Async audio operations need care: the final content update should be undoable,
  while progress state should not be.

### Likely Touchpoints

`src/store/useSceneStore.ts`, `src/hooks/useSceneUndoRedo.ts`, and tests around
store history.

## 6. Guided Transcription With Script Alignment

### Goal

Improve transcription and bookmark quality when the user already knows what they
intended to read. Whisper gives useful timing, but the final words / punctuation
/ segmentation can be better if aligned against the original script.

### MVP

- Add an optional `script` field when recording or uploading audio.
- Send the audio and script to a new guided transcription endpoint.
- Use Whisper for approximate word timings.
- Align the Whisper output to the provided script.
- Return cleaner `WordBoundary[]` based on the script text, not only the raw
  ASR text.

### Later

- Optional provider API key for a smarter cleanup step.
- Use an LLM to add punctuation, paragraph breaks, and bookmark candidates.
- Let the user review and approve corrected transcript / bookmarks before
  committing them to the timeline.

### Design Notes

- The robust approach is not "LLM instead of Whisper"; it is Whisper timings plus
  script alignment.
- The script should be treated as the source of truth when the recording mostly
  matches it.
- If the speaker deviates substantially from the script, the UI should show a
  confidence warning and allow fallback to raw Whisper output.

### Likely Touchpoints

`measure_server.py`, `src/services/measureClient.ts`,
`src/panels/AudioPanel.tsx`, `src/store/useSceneStore.ts`, and
`src/types/scene.ts`.

## Archived / Previous Plan: Frame-Aware Agent

The previous content of this file was a focused implementation plan for making
the agent aware of the frame grid. The core idea remains valid and should be
kept as a future agent task:

- Add frame catalog data to the agent context.
- Preserve and validate `frameId` in agent-created items.
- Add dedicated frame actions such as `CREATE_FRAME` and `UPDATE_FRAME`.
- Reject unknown frame IDs instead of silently falling back to the active frame.
- Later, allow camera panning actions between frames.

If this work resumes, split it into a separate implementation plan before
editing agent validators / schema / prompt together.
