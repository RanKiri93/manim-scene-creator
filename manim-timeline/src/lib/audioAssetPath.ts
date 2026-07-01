import type { AudioBed, AudioTrackItem } from '@/types/scene';

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

/**
 * If the track’s audio already lives on the measure server as ``assets/audio/...``,
 * return that relative path so the server can read the file without re-uploading.
 * Otherwise return null (client must send bytes, e.g. blob URL).
 */
export function measureServerRelativeAudioPath(
  track: AudioTrackItem,
): string | null {
  const pinned = track.assetRelPath?.trim().replace(/^\/+/, '');
  if (pinned?.startsWith('assets/audio/')) {
    return pinned;
  }
  const u = track.audioUrl.split('?')[0].trim();
  if (u.startsWith('assets/audio/')) {
    return u;
  }
  try {
    if (u.startsWith('http://') || u.startsWith('https://')) {
      const p = new URL(u).pathname.replace(/^\/+/, '');
      if (p.startsWith('assets/audio/')) {
        return p;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Stable `assets/audio/...` path for a scene background bed (`.mtproj` + server sync).
 */
export function deriveAudioBedAssetRelPath(bed: AudioBed): string {
  const pinned = bed.assetRelPath?.trim();
  if (pinned) {
    return pinned.replace(/^\/+/, '');
  }

  const u = bed.audioUrl.split('?')[0];
  const parts = u.split('/').filter(Boolean);
  let base = parts.length ? parts[parts.length - 1]! : 'bed.webm';
  base = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  const lower = base.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot) : '';
  const hasKnownAudioExt = ext.length > 1 && KNOWN_AUDIO_EXTENSIONS.has(ext);
  if (!hasKnownAudioExt) {
    const stem = dot >= 0 ? base.slice(0, dot) : base;
    base = stem.length > 0 ? stem : 'bed';
    if (!base.toLowerCase().endsWith('.webm')) base = `${base}.webm`;
  }
  return `assets/audio/${base}`;
}

/**
 * If the bed audio already lives on the measure server as ``assets/audio/...``,
 * return that relative path.
 */
export function measureServerRelativeAudioBedPath(bed: AudioBed): string | null {
  const pinned = bed.assetRelPath?.trim().replace(/^\/+/, '');
  if (pinned?.startsWith('assets/audio/')) {
    return pinned;
  }
  const u = bed.audioUrl.split('?')[0].trim();
  if (u.startsWith('assets/audio/')) {
    return u;
  }
  try {
    if (u.startsWith('http://') || u.startsWith('https://')) {
      const p = new URL(u).pathname.replace(/^\/+/, '');
      if (p.startsWith('assets/audio/')) {
        return p;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}
