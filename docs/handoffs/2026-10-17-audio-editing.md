---
slug: audio-editing
created: 2026-10-17
status: verifying
owner_role: verifier
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

### Phase 1 (2026-10-17)
- `types/scene.ts`: optional `sourceIn`, `sourceDuration`, `gainDb` on `AudioTrackItem`
  (optional + readers default them, so no version bump; audio items are saved whole).
- `lib/audioSchedule.ts` (new): segments, fade envelope (linear like `afade`), `scheduleFrom`,
  ramp points. `lib/waveformPeaks.ts` (new): 200 bins/s peaks, columns for a file range.
- `timeline/audioBuffers.ts` (new): one AudioContext, decode cache by URL, peaks + subscribe.
- `timeline/timelineAudioController.ts`: rewritten on Web Audio. All clips still ahead are
  scheduled on the context clock (file offset, length, gain, fade ramps), bed looped from
  `sceneTime % bedLength`; restarts on seek/drift > 0.2 s or when audio items / bed / default
  fade change; stops on pause. `useTimelineAudioSync` no longer prunes a pool.
- `timeline/Waveform.tsx` (new) drawn in every narration clip; lane 56 px.
- Ran: build ok; `npm run test` 1056 passed; lint clean on new files (Timeline.tsx has two
  pre-existing set-state-in-effect errors on untouched lines). Headless Chrome (CDP, the
  extension was not connected) against the dev server: a 3 s file (1 s silence + tone) plus a
  trimmed −6 dB piece of it → output RMS 0 / 0.172 / 0 / 0.087 at 0.5 / 1.5 / 3.2 / 4.0 s, as
  expected; both waveform canvases drawn.

### Phase 2 (2026-10-17)
- `lib/audioEdit.ts` (new): `sliceClip` (words kept by midpoint, `word_boundaries` dropped,
  `sourceDuration` recorded), `splitClip`, `trimClipStart/End`, `copyRange`, `deleteClipRange`
  (ripple: unlinked clips starting at/after the cut end move left), `pasteClips` (`over` =
  lay on the lane, nothing else moves; `insert` = split the unlinked clip under the playhead
  and push unlinked audio right). `isEditedClip` = has `sourceIn`/`sourceDuration`/gain.
- `lib/audioMixdown.ts`: edited clips send `source_in_sec`, `duration_sec`, `gain_db` and
  force the mixdown.
- `codegen/audioClipCodegen.ts` (new): `pySoundCall` keeps `self.add_sound(path)` for whole
  files; edited clips call module-level `_mt_clip(self, path, src_in, dur, …)` (pydub slice,
  gain, fades, `file_writer.add_audio_segment`). All 15 `add_sound` emission sites go through
  it (`ResolvedRecordedPlayback.track`); helper emitted once when any clip is edited.
  Verified with a real `manim -ql` render: −6 dB slice exactly −6 dB, silence between clips,
  webm input same level as Manim's own `add_sound`.
- `store/useSceneStore.ts`: `splitAudioAt`, `trimAudioClip` (from the drag-start clip so
  trimmed words come back), `deleteAudioRange`, `pasteAudioClips`, `setAudioClipGain`,
  `commitAudioDrag` (one undo step per drag). `removeAudioItem` no longer revokes the blob
  URL: split pieces/clipboard share it and undo restored a dead URL before.
- UI: `timeline/audioEditSession.ts` (new: marked range + clipboard, outside undo history);
  `AudioClip.tsx` trim handles (no start handle on linked clips), Alt+drag range overlay,
  tooltip lists shortcuts; `Timeline.tsx` S / Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+Shift+V /
  Delete-range / Esc; `AudioClipEditPopup.tsx` preview plays the clip's slice via Web Audio
  (`playAudioPreview`), "plays a–b s of N s file", Edit section (split at playhead, delete
  range, gain dB).
- Ran: build ok; `npm run test` 1080 passed; staged tree alone (WIP excluded) tsc + vitest
  1058 passed; timing sweep 50 ok / 0 failed. Headless Chrome: S split, end-trim drag, Alt+drag
  range + Delete (gap closed, later piece moved left), Ctrl+C/V on top, Ctrl+Shift+V insert,
  playback scheduled all six pieces.

### Phase 3 (2026-10-17)
- `types/scene.ts`: `WordBoundary.id?`; `WordAnchored.wordAnchor?: { wordId }` on every
  top-level clip type (SceneItemBase, exit, blink, target, camera, surroundingRect);
  `getAudioBoundaries` keeps ids. Optional fields, no version bump.
- `lib/wordAnchors.ts` (new): word times by id, `anchoredStartShifts` (relative follow: a clip
  moves by as much as its word moved), `withWordIds`.
- `lib/audioEdit.ts`: slices keep word ids; pasted copies drop them.
- `store/useSceneStore.ts`: `followWordAnchorsInDraft` after moveItem, setSceneItemStartTimes
  (the dragged clips themselves excluded), moveAudioItem, setAudioItemStartTimes,
  updateAudioBoundary (keeps ids now), placeAudioAfterPrevious, spaceSelectedAudioItems,
  deleteAudioRange, pasteAudioClips, commitAudioDrag. Not in the time-surgery actions (they
  move clips and audio together already). `setWordAnchor` (refused when the clip owns that
  narration).
- `timeline/timelineSnap.ts` rewritten: 8 px threshold, targets = playhead, word starts
  (anchorable) and ends, narration edges, other clips' edges; both edges of a dragged clip
  snap; word start wins ties; Alt disables; `useSnapGuide` drives a guide line + label in
  `Timeline.tsx`. Used by visual clip move/resize and narration move/trim.
- `TimelineClip.tsx`: dropping the start on a word anchors, dropping elsewhere clears; badge
  "⟂ word" with explanation.
- Not done: free markers (M key) — would need a new project-level field; left for later.
- Ran: build ok; `npm run test` 1089 passed; lint clean on touched files. Headless Chrome:
  guide labelled "beta" while dragging, drop at exactly 3.5 s anchored, clip followed a +2 s
  narration move and a 0.5 s cut before the word.

### Phase 4 (2026-10-17)
- `lib/audioEdit.ts`: `wordRangeCut(clip, first, last)` — cut points in the middle of the pauses
  around the words (clip edges for first/last word).
- `AudioClipEditPopup.tsx`: Transcript section of word chips (click, Shift+click extends) that
  sets the shared marked range, so the timeline highlight, Delete and Ctrl+C/X/V all apply;
  Play selection / Delete words / Cut / Copy buttons.
- Deviation: room-tone fill dropped. Deletes always close the gap, so there is no hole to
  fill; joins get the cut fades and the bed (room tone) already runs under everything.
- Known limit: deleting words in the middle leaves two clips (a clip is one slice of a file).
- Ran: tsc ok, audioEdit tests 13 passed. Headless Chrome: two filler words selected by
  click + Shift+click, Delete words → cut 0.80–2.00 s, two clips remain, gap closed.

### Phase 5 (2026-10-17)
- `lib/wavEncode.ts` (new, tested): 16-bit mono WAV, chunk join, peak dBFS.
- `services/micRecorder.ts` (new): AudioWorklet capture (inline module, 2048-frame batches,
  channels averaged to mono) → WAV; mic constraints (raw by default, optional device id);
  `listMicrophones`; MediaRecorder fallback when AudioWorklet is missing.
- `panels/AudioPanel.tsx` record mode: microphone picker, 3 s count-in (cancellable), record
  over the timeline (plays from the playhead with timeline narration muted via
  `setTimelineAudioMuted`, pauses after; take placed at the start playhead), elapsed time,
  peak meter with hold, sticky clipping warning. Old MediaRecorder code removed here.
- `store`: `addRecordedAudioTrack({ startTime })`.
- Not changed: the bed popup's room-tone recorder still uses MediaRecorder.
- Ran: build ok, `npm run test` 1093 passed (1 skipped), lint clean. Headless Chrome with the fake mic:
  count-in text, playback running during the take and paused after, meter −2 dB with the
  clipping warning (fake beep is full scale), result RIFF 48 kHz, 2.13 s.

### Phase 6 (2026-10-17)
- `lib/narrationReport.ts` (new, tested): from word timings only — long pauses (incl. clip-edge
  silence; cut keeps 0.5 s), filler words (Hebrew + English list), phrases of 1–5 words said
  twice in a row (cut the first saying), measured-loudness spread. Server `silencedetect` was
  planned but not needed for this; word gaps carry the same information for Whisper'd clips.
- `agent/audioEdits.ts` (new): AUDIO action `cut` (scene range inside one narration clip) /
  `gain` / `anchor` (word starting at `at` ±0.06 s); normalize, describe, `applyAudioEdit` on
  copies, `locateCut`, `locateWord`.
- Wired through `types.ts` (union, `actionItemId`, canonical anyOf branch with
  `AUDIO_EDIT_SCHEMA`), `providers/gemini.ts` (enum + shared `ANY_EDIT_SCHEMA`), `validate.ts`
  (normalize, anchor target exists, camera pass, `virtualStateAfter`), `timelineEdits.ts`
  (ordered check of TIMELINE + AUDIO), `previewSelectors.ts` (anchor moves the clip), `commit.ts`
  (store actions), `AgentPanel.tsx`, `cameraProposalSummary.ts`, `loop/history.ts`,
  `loop/tools.ts` (`audio_report` tool), `systemPrompt.ts` (rule 16, tool list), `recipes.ts`
  (R24 narration cleanup, R15 step 4 anchor, R7 check for R24), `ARCHITECTURE.md`.
- Tests: `agent/loop/exposeAudio.test.ts` (report → anchor + cuts last-to-first → anchored clip
  follows, refusals, preview, commit as one undo step); pinned schema/prompt/tool-list tests
  updated for the fifth action and the new tool.
- Ran: `npx vitest run src/agent` 271 passed; `npm run test` 1102 passed; build ok; lint clean
  on `src/agent`; practice set (golden) passed. Not run against a live model.

## Verification (verifier)

## Review notes (manim-reviewer / ui-reviewer — optional)

## Docs delta (docs-keeper)

- README "Global audio timeline (narration)": record, upload; Recording, Non-destructive edits,
  Preview, Sync to words, Copilot, Edited clips in export paragraphs; `*Last updated:*` trailer
  extended (Narration editing). Committed as own hunks only (README carries older WIP).
- ARCHITECTURE.md: Narration paragraph + new Narration edits paragraph (AUDIO, audio_report).
- idea.md: shortlist item 4 marked mostly done; §3 Preview done, popup sections, Editor (done),
  Still open (markers, punch-in, takes/prompter, bed recorder, edit lists inside a clip).
