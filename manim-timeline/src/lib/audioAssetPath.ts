import type { AudioTrackItem } from '@/types/scene';

const KNOWN_AUDIO_EXTENSIONS = new Set([
  '.webm',
  '.wav',
  '.mp3',
  '.m4a',
  '.ogg',
  '.flac',
  '.opus',
  '.aac',
]);

/**
 * Stable `assets/audio/...` path for .mtproj and Manim `add_sound`.
 * When `assetRelPath` is set (e.g. after loading a bundle), it wins.
 */
export function deriveAudioAssetRelPath(track: AudioTrackItem): string {
  const pinned = track.assetRelPath?.trim();
  if (pinned) {
    return pinned.replace(/^\/+/, '');
  }

  const u = track.audioUrl.split('?')[0];
  const parts = u.split('/').filter(Boolean);
  let base = parts.length ? parts[parts.length - 1]! : `${track.id}.webm`;
  base = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  const lower = base.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot) : '';
  const hasKnownAudioExt = ext.length > 1 && KNOWN_AUDIO_EXTENSIONS.has(ext);
  if (!hasKnownAudioExt) {
    const stem = dot >= 0 ? base.slice(0, dot) : base;
    base = stem.length > 0 ? stem : track.id;
    if (!base.toLowerCase().endsWith('.webm')) base = `${base}.webm`;
  }
  return `assets/audio/${base}`;
}

/**
 * True when `audioUrl` is a virtual in-archive path (not yet rehydrated to a blob URL).
 */
export function isBundledVirtualAudioUrl(url: string): boolean {
  const u = url.split('?')[0].trim();
  return u.startsWith('assets/audio/') || u.startsWith('assets/textures/');
}
