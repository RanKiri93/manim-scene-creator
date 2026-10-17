import type { AudioTrackItem } from '@/types/scene';
import { deriveAudioAssetRelPath } from '@/lib/audioAssetPath';
import { clipSourceIn, isEditedClip } from '@/lib/audioEdit';

/*
 * Sound calls for timeline narration. A whole-file clip stays `self.add_sound(path)`. An edited
 * clip (a piece of its file, or with gain) goes through `_mt_clip`, a module-level helper that
 * slices the file with pydub, applies gain and cut fades, and adds the segment at the scene
 * clock, so a downloaded `.py` plays the same piece as the in-app render (which mixes the master
 * WAV on the server).
 */

export const AUDIO_CLIP_HELPER_NAME = '_mt_clip';

export function anyEditedAudio(audioItems: readonly AudioTrackItem[] | undefined): boolean {
  return (audioItems ?? []).some(isEditedClip);
}

/** Module-level helper; `defaultFadeMs` is the scene's cut fade. Comments, not a docstring (multi-scene header merge). */
export function audioClipHelperSource(defaultFadeMs: number): string {
  const d = Math.max(0, Math.round(defaultFadeMs));
  return (
    `def ${AUDIO_CLIP_HELPER_NAME}(scene, path, src_in, dur, gain_db=0.0, fade_in_ms=${d}, fade_out_ms=${d}, time_offset=0.0):\n` +
    `    # Edited timeline clip: dur seconds of the file from src_in, with gain and cut fades.\n` +
    `    if scene.renderer.skip_animations:\n` +
    `        return\n` +
    `    import os, tempfile\n` +
    `    from pydub import AudioSegment\n` +
    `    from manim.scene.scene_file_writer import convert_audio\n` +
    `    from manim.utils.sounds import get_full_sound_file_path\n` +
    `    file_path = get_full_sound_file_path(path)\n` +
    `    if file_path.suffix == ".wav":\n` +
    `        seg = AudioSegment.from_file(file_path)\n` +
    `    else:\n` +
    `        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:\n` +
    `            convert_audio(file_path, tmp, "pcm_s16le")\n` +
    `        seg = AudioSegment.from_file(tmp.name)\n` +
    `        os.unlink(tmp.name)\n` +
    `    seg = seg[int(round(src_in * 1000)):int(round((src_in + dur) * 1000))]\n` +
    `    if gain_db:\n` +
    `        seg = seg.apply_gain(gain_db)\n` +
    `    if fade_in_ms > 0:\n` +
    `        seg = seg.fade_in(int(fade_in_ms))\n` +
    `    if fade_out_ms > 0:\n` +
    `        seg = seg.fade_out(int(fade_out_ms))\n` +
    `    scene.renderer.file_writer.add_audio_segment(seg, time=scene.time + time_offset)\n`
  );
}

/** `self.add_sound(...)` or `_mt_clip(self, ...)` (no indent, no newline). */
export function pySoundCall(track: AudioTrackItem, timeOffset?: number): string {
  const path = deriveAudioAssetRelPath(track);
  const off = timeOffset != null ? `, time_offset=${timeOffset.toFixed(4)}` : '';
  if (!isEditedClip(track)) return `self.add_sound("${path}"${off})`;
  let args = `self, "${path}", ${clipSourceIn(track).toFixed(4)}, ${track.duration.toFixed(4)}`;
  if ((track.gainDb ?? 0) !== 0) args += `, gain_db=${track.gainDb!.toFixed(2)}`;
  if (track.fadeInMs != null) args += `, fade_in_ms=${Math.round(track.fadeInMs)}`;
  if (track.fadeOutMs != null) args += `, fade_out_ms=${Math.round(track.fadeOutMs)}`;
  return `${AUDIO_CLIP_HELPER_NAME}(${args}${off})`;
}
