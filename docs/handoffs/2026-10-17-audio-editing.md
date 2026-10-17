---
slug: audio-editing
created: 2026-10-17
status: implementing
owner_role: editor-dev
next_tool: any
source: user request 2026-10-17 (recording + audio editing review); idea.md §3
---

## Plan (architect)

### Goal
Narration can be edited without re-recording. A user can split a clip, trim its edges, delete a
range inside it, copy and paste pieces, and hear the result (fades, overlapping clips, the
background bed) in the timeline preview exactly as it will export. Visual clips snap to spoken
words while dragging and can stay anchored to a word when the audio later moves or is cut.
Recording gets a level meter, mic picker, countdown, lossless WAV capture and record-at-playhead.
The Copilot can read pauses and suggest cuts and word anchors.

User decisions (2026-10-17):
1. Edits are **non-destructive**: a clip points at a file plus an offset into it. No file is
   written for a cut.
2. Deleting audio moves word-anchored visuals and unlinked audio after the cut; other clips stay.
3. Paste lays the piece **on top** at the playhead by default; an option (Shift+Ctrl+V / menu)
   inserts it and pushes later audio (and anchored visuals) right.
4. Phase order 0 → 6 as below.

Clip model (types): `AudioTrackItem` gains optional `sourceIn` (seconds into the file where the
clip starts, default 0), `sourceDuration` (full file length, when known) and `gainDb`.
`duration` and `boundaries` stay **clip-local** (after trimming), so every existing timing rule
in codegen, binding sync and the Copilot narration view keeps working unchanged. Trimming the
start = raise `sourceIn`, lower `duration`, move `startTime` right, shift and drop boundaries.

### Phases
- **0 Fixes.** Mixdown used ffmpeg `amix` with its default `normalize=1`: each clip was divided
  by the number of inputs still running (measured: four equal clips at −33/−31/−27/−21 dB; with
  `normalize=0` all −21 dB). Build the filter graph in a pure module (`audio_mixdown.py`) with
  `normalize=0` and a latency-compensated `alimiter`. Stale "cleanup chain is applied on import"
  text in the record panel (`autoClean: false`).
- **1 Web Audio preview + waveforms.** Pure `lib/audioSchedule.ts` turns audio items + bed +
  defaults into scheduled segments (file offset, length, fades, gain); the preview controller
  plays them through an `AudioContext` (all overlapping clips, fades, looped bed) instead of one
  `<audio>` element. Decoded buffers also give waveform peaks drawn on clips.
- **2 Clip edit model.** Fields above + PROJECT_VERSION bump/migration test. Store actions:
  split at time, trim start/end, delete range (ripple per decision 2), copy/cut/paste (on top /
  insert), set gain. Trim handles on clips, S = split at playhead, Ctrl+C/X/V on audio, range
  selection inside a clip. Mixdown trims (`atrim`) before gain and fades; codegen emits a small
  `_mt_add_clip` helper (pydub slice + fades + gain via `file_writer.add_audio_segment`) for
  trimmed or gained clips so the downloadable `.py` is correct too; untrimmed clips keep plain
  `add_sound`.
- **3 Sync.** Snap threshold in pixels, snap to word starts and ends, markers, playhead and clip
  edges; guide line with the word; resize handles snap; Alt bypasses. Stable word ids;
  `wordAnchor` on visual clips (set when a drag snaps to a word) keeps the clip on that word when
  the audio moves, is trimmed or rippled. Markers (M) during playback.
- **4 Transcript editing.** Select words in the clip editor → delete / cut / copy; cut points sit
  in the gap between words; optional room-tone fill for removed gaps.
- **5 Recording.** AudioWorklet PCM capture → WAV, level meter with clip warning, mic picker,
  countdown, record at playhead while the timeline plays.
- **6 Copilot.** Pause map from the server (`silencedetect`), script-vs-transcript diff, actions
  for split/trim/delete-range/anchor in both schemas, suggestions as proposals (one undo each).

### Non-goals
Multiband EQ UI, noise-reduction strength, destructive bake of edits, multitrack recording,
punch-in re-recording of a few words (later), VST-style effects.

### Touched files
- server: `audio_mixdown.py` (new, pure filter graph), `measure_server.py` (mixdown uses it;
  source offset/length per clip; silence map endpoint in phase 6), `test_audio_mixdown.py` (new).
- `types/scene.ts`: clip fields, word ids, `wordAnchor`, markers; `lib/migrateProject*` + test.
- `lib/`: `audioSchedule.ts` (new), `audioEdit.ts` (new: split/trim/range/paste pure helpers),
  `audioMixdown.ts` (offset/length/gain in spec), `waveformPeaks.ts` (new), snap helpers.
- `codegen/lineCodegen.ts` + every `self.add_sound` site: one `pyAddSound` helper.
- `store/useSceneStore.ts`: edit actions, clipboard, anchors.
- UI: `timeline/AudioClip.tsx`, `timeline/AudioClipEditPopup.tsx`, `timeline/Timeline.tsx`,
  `timeline/timelineAudioController.ts`, `timeline/TimelineClip.tsx`, `timeline/timelineSnap.ts`,
  `panels/AudioPanel.tsx`.
- Copilot (phase 6): `agent/` schema fragments (canonical + Gemini flat), narration view.
- docs: README audio sections + trailer, idea.md §3.

### Invariants at risk
- Codegen run times from boundaries (`runTimeFromBoundaries`) assume clip-local boundaries —
  kept by the model choice above.
- Audio binding sync (visual owns linked audio) must not fight word anchors: a visual that owns
  its audio is never word-anchored to that same audio.
- Untrimmed clips export byte-identical Python (existing codegen tests stay green).
- PROJECT_VERSION migration chain; zundo history must not record transient playback state.

### Test plan
- `pytest test_audio_mixdown.py test_parser.py test_script_alignment.py` (mixdown test renders
  real tones through ffmpeg when it is on PATH and checks levels and trims).
- `npm run test` with new `lib/audioSchedule.test.ts`, `lib/audioEdit.test.ts`,
  migration test, codegen test for `_mt_add_clip`, snap/anchor tests.
- `npm run build`, `npm run lint` on touched files; timing sweep after the codegen change.
- `/api/mixdown_audio` exercised once for real.

### Open questions
None open; decisions recorded above.

## Implementation notes (editor-dev)

### Phase 0 (2026-10-17)
- `audio_mixdown.py` (new): pure filter graph. Per clip `atrim` (only when trimmed) → gain →
  fades (scaled down when longer than the clip) → `adelay … all=1`. Sum with
  `amix … normalize=0`, then `aresample=48000`, `alimiter` (limit 0.97, `level=0` so it does not
  auto-level, `latency=1` so it does not shift audio), `apad`/`atrim` by sample count so the
  master is exactly the scene length (time-based `atrim` came out ~5 ms short).
- `measure_server.py`: mixdown builds inputs and probes durations, graph from the module;
  `MixdownClip` gains `source_in_sec` and `duration_sec` (used from phase 2).
- `test_audio_mixdown.py` (new): graph text + real ffmpeg renders (equal levels for 4 clips,
  exact length, trimmed slice onset at 0.5 s ±2 ms, overlap limited ≤ 0.97).
- `panels/AudioPanel.tsx`: record-panel text no longer claims cleanup runs on import.
- Ran: `pytest test_parser.py test_script_alignment.py test_audio_mixdown.py` → 50 passed.
  `/api/mixdown_audio` on a server with an isolated data dir: two clips (one trimmed) + bed →
  5.000 s, 48 kHz stereo, both clips −23.8 dB, bed alone −54 dB.

## Verification (verifier)

## Review notes (manim-reviewer / ui-reviewer — optional)

## Docs delta (docs-keeper)
