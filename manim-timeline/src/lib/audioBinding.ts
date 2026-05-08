import type { AudioTrackItem, ItemId, SceneItem } from '@/types/scene';
import { effectiveStart } from '@/lib/time';
import { itemClipDisplayName } from '@/lib/itemDisplayName';

export const AUDIO_BINDING_NONE = '__none__';

export function isAudioBindingNone(
  audioTrackId: string | null | undefined,
): boolean {
  return audioTrackId === AUDIO_BINDING_NONE;
}

export function audioTrackLabel(track: AudioTrackItem): string {
  const text = track.text.trim();
  const short =
    text.length > 36 ? `${text.slice(0, 35)}...` : text;
  return text
    ? `${short} (${track.startTime.toFixed(1)}s, ${track.duration.toFixed(1)}s)`
    : `Audio ${track.id.slice(0, 6)} (${track.startTime.toFixed(1)}s, ${track.duration.toFixed(1)}s)`;
}

/** Scene items explicitly bound to this audio track (`audioTrackId` matches). Ignores auto and `AUDIO_BINDING_NONE`. */
export function explicitAudioBindingsForTrack(
  items: Map<ItemId, SceneItem>,
  audioTrackId: string,
): SceneItem[] {
  const out: SceneItem[] = [];
  for (const item of items.values()) {
    if (
      'audioTrackId' in item &&
      item.audioTrackId === audioTrackId
    ) {
      out.push(item);
    }
  }
  return out;
}

export function explicitAudioBindingLabel(
  items: Map<ItemId, SceneItem>,
  audioTrackId: string,
): string {
  const bound = explicitAudioBindingsForTrack(items, audioTrackId);
  if (bound.length === 0) return 'No explicit visual bindings';
  return bound.map(itemClipDisplayName).join(', ');
}

/** Matches export: early narration keeps `add_sound` at track start; otherwise playback aligns with the visual. */
export function isExplicitAudioTrackBinding(
  audioTrackId: string | null | undefined,
): audioTrackId is string {
  return Boolean(audioTrackId) && !isAudioBindingNone(audioTrackId);
}

export interface BoundAudioPlaybackMarker {
  id: string;
  audioTrack: AudioTrackItem;
  visualItem: SceneItem;
  visualItemId: ItemId;
  playbackStart: number;
}

export function boundAudioPlaybackStart(
  item: SceneItem,
  track: AudioTrackItem,
  items: Map<ItemId, SceneItem>,
): number {
  const visualStart = effectiveStart(item, items);
  return track.startTime < visualStart - 1e-9
    ? track.startTime
    : visualStart;
}

export function listBoundAudioPlaybackMarkers(
  items: Map<ItemId, SceneItem>,
  audioItems: AudioTrackItem[],
): BoundAudioPlaybackMarker[] {
  const tracksById = new Map(audioItems.map((t) => [t.id, t]));
  const markers: BoundAudioPlaybackMarker[] = [];
  for (const item of items.values()) {
    if (!('audioTrackId' in item)) continue;
    if (!isExplicitAudioTrackBinding(item.audioTrackId)) continue;
    const track = tracksById.get(item.audioTrackId);
    if (!track) continue;
    markers.push({
      id: `${item.id}__audio_marker__${track.id}`,
      audioTrack: track,
      visualItem: item,
      visualItemId: item.id,
      playbackStart: boundAudioPlaybackStart(item, track, items),
    });
  }
  return markers.sort(
    (a, b) =>
      a.playbackStart - b.playbackStart ||
      a.audioTrack.id.localeCompare(b.audioTrack.id) ||
      a.visualItemId.localeCompare(b.visualItemId),
  );
}

/** Single visual owner explicitly bound to this audio track (`__none__` / auto excluded). */
export function explicitVisualOwnerForAudioTrack(
  items: Map<ItemId, SceneItem>,
  audioTrackId: string,
): SceneItem | undefined {
  for (const item of items.values()) {
    if (!('audioTrackId' in item)) continue;
    const tid = item.audioTrackId;
    if (
      typeof tid === 'string' &&
      isExplicitAudioTrackBinding(tid) &&
      tid === audioTrackId
    ) {
      return item;
    }
  }
  return undefined;
}
