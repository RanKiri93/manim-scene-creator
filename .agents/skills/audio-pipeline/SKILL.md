---
name: audio-pipeline
description: How narration audio flows through the app — TTS/upload, Whisper word boundaries, asset paths, processing chain (normalize/clean/match-EQ), background bed, mixdown, and .mtproj bundling. Load for any task touching audioItems, AudioPanel, AudioClip*, BedClip, measure_server audio endpoints, or add_sound export.
---

# Audio pipeline

## Data model (`src/types/scene.ts`)

- `audioItems: AudioTrackItem[]` on the scene (not per visual item). Fields: `text`, `audioUrl`,
  `assetRelPath?`, `boundaries?`/`word_boundaries?` (Whisper, seconds; `getAudioBoundaries`
  normalises ms→s), `startTime`, `duration`, `fadeInMs?`/`fadeOutMs?`, `audioProcessing?`
  (`normalized` / `cleaned` / `matchedEq` metadata).
- `audioBed?: AudioBed` — one scene-level bed (`music` | `roomtone` | `noise`), `gainDb`.
- Visual items carry `audioTrackId?: string | null`: `null`/`undefined` = auto by overlap,
  explicit id = that track, `AUDIO_BINDING_NONE` (`__none__`) = never bind.
  `src/lib/audioBinding.ts` has the helpers; the store keeps bindings exclusive
  (`dedupeExclusiveAudioOwner`).

## Asset paths (`src/lib/audioAssetPath.ts`)

- `deriveAudioAssetRelPath(track)` → stable `assets/audio/<file>` used by Manim
  `self.add_sound(...)` and by `.mtproj`. `assetRelPath` wins when set.
- `measureServerRelativeAudioPath(track)` → the same path only if the bytes already live on
  the server (so processing endpoints can read the file instead of re-uploading).
- `blob:` URLs live only in the current browser session; only `.mtproj` bundles move audio
  between machines (`src/lib/mtprojBundle.ts`, ZIP via `fflate`, MD5 manifest via `spark-md5`).

## Server endpoints (`measure_server.py`)

| Endpoint | Purpose | Notes |
|---|---|---|
| `POST /api/generate_audio` | gTTS + Whisper boundaries | `{text, lang}`; lang `iw` = Hebrew |
| `POST /api/upload_audio` | mic/file upload + transcription | multipart; `transcribe=false` for beds; optional `script` for guided alignment (WIP) |
| `POST /api/sync_audio_asset` | push bytes so the server has `assets/audio/<file>` | used before render when audio came from `blob:` |
| `POST /api/normalize_audio` | EBU R128 `loudnorm` | ffmpeg |
| `POST /api/process_audio` | full cleanup chain (high-pass, denoise, compress, loudnorm) | recordings auto-clean on import |
| `POST /api/match_eq` | corrective multiband EQ toward a reference take | returns `bands[]` |
| `POST /api/generate_bed_noise` | pink/brown/white bed | no Whisper |
| `POST /api/mixdown_audio` | master WAV: clips at timeline positions + cut fades + looped bed | `MixdownRequest{total_duration_sec, clips[], bed}` |
| `POST /api/render` | Manim render; `master_audio_path` muxes the master over the video | ffmpeg |
| `GET /assets/audio/*` | static serving of stored assets | required for playback and bundling |

Processed files are written as new assets with prefixes `normalized_`, `cleaned_`,
`matched_`, `master_`. Never overwrite the source asset.

## Export alignment (see skill `codegen-invariants`)

Codegen picks a track per leaf (explicit binding or overlap), sets `run_time` from word
boundaries when they fit, emits `self.add_sound("assets/audio/…")`, and pads with tail waits
capped by `tailCeilingAbs`. Render-time delivery: client builds the `MixdownRequest` from
`src/lib/audioMixdown.ts`, server returns `master_<id>.wav`, client passes it as
`master_audio_path` to `/api/render`. Bed and cut fades are render-only (not audible in the
timeline preview) as of v1.

## Timeline preview (`src/timeline/timelineAudioController.ts`)

One narration clip at a time, seeked to `currentTime - startTime`. Word boundaries render as
ticks/bookmarks (`BoundaryLabel.tsx`, editable — WIP). Gap presets (T/N/I/R) in
`src/lib/audioGapPresets.ts` re-chain unlinked clips.

## Rules

- Splitting or trimming a clip must split/remap `boundaries` too.
- Warn (in UI) before edits that change duration on a clip bound to a visual item.
- Do not read files under `assets/audio/` into context; they are binaries. Use `ffprobe` via
  the server helpers when you need duration.
- New processing operations must be idempotent per input and record metadata under
  `audioProcessing` so the popup badges stay truthful.
