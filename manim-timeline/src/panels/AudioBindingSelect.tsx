import { useMemo } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import {
  AUDIO_BINDING_NONE,
  audioTrackLabel,
  explicitVisualOwnerForAudioTrack,
  isAudioBindingNone,
} from '@/lib/audioBinding';
import { itemClipDisplayName } from '@/lib/itemDisplayName';

interface AudioBindingSelectProps {
  value: string | null | undefined;
  onChange: (audioTrackId: string | null) => void;
  /** Item whose binding is edited; annotates tracks already explicitly bound elsewhere. */
  currentItemId?: string;
}

export default function AudioBindingSelect({
  value,
  onChange,
  currentItemId,
}: AudioBindingSelectProps) {
  const audioItems = useSceneStore((s) => s.audioItems);
  const items = useSceneStore((s) => s.items);

  const orphanedExplicit = useMemo(() => {
    if (value == null || value === '') return false;
    if (isAudioBindingNone(value)) return false;
    return !audioItems.some((a) => a.id === value);
  }, [audioItems, value]);

  const selectValue = value == null || value === '' ? '' : value;

  return (
    <label className="text-xs text-slate-400 block">
      Audio binding
      <select
        value={selectValue}
        onChange={(e) => {
          const next = e.target.value;
          if (next === '') onChange(null);
          else onChange(next);
        }}
        className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
      >
        <option value="">Auto by timeline overlap</option>
        <option value={AUDIO_BINDING_NONE}>None</option>
        {orphanedExplicit && typeof value === 'string' ? (
          <option value={value}>Missing track ({value.slice(0, 12)}...)</option>
        ) : null}
        {audioItems.map((track) => {
          const owner =
            typeof currentItemId === 'string'
              ? explicitVisualOwnerForAudioTrack(items, track.id)
              : undefined;
          const occupiedElsewhere =
            owner != null &&
            typeof currentItemId === 'string' &&
            owner.id !== currentItemId;
          const occupantSuffix = occupiedElsewhere
            ? ` (bound to ${itemClipDisplayName(owner)})`
            : '';
          return (
            <option key={track.id} value={track.id}>
              {audioTrackLabel(track)}
              {occupantSuffix}
            </option>
          );
        })}
      </select>
      <p className="mt-1 text-[10px] text-slate-500">
        Auto uses the current export heuristic. None disables audio binding for this clip. Choosing a
        specific track aligns that audio clip’s timeline start with this clip and keeps it synced
        when you move the clip; only one visual may own a track at a time.
      </p>
    </label>
  );
}
