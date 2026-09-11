import { useCallback, useRef, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import type { ImageItem } from '@/types/scene';
import NumberInput from '@/components/NumberInput';
import PositionStepsEditor from './PositionStepsEditor';
import AudioBindingSelect from './AudioBindingSelect';
import PropertyTabs from './PropertyTabs';
import VisibleAtSceneStartRow from './VisibleAtSceneStartRow';
import TargetAnimationEffectsNote from './TargetAnimationEffectsNote';
import {
  clampImageOpacity,
  fitImageToManimSize,
  guessImageMime,
  isSupportedImageFile,
} from '@/lib/imageAssetPath';

interface ImageEditorProps {
  item: ImageItem;
}

export default function ImageEditor({ item }: ImageEditorProps) {
  const updateItem = useSceneStore((s) => s.updateItem);
  const setItemAudioBinding = useSceneStore((s) => s.setItemAudioBinding);
  const removeItem = useSceneStore((s) => s.removeItem);
  const fileRef = useRef<HTMLInputElement>(null);
  const [lockAspect, setLockAspect] = useState(true);
  const [replaceError, setReplaceError] = useState<string | null>(null);

  const set = useCallback(
    (patch: Partial<ImageItem>) => updateItem(item.id, patch),
    [item.id, updateItem],
  );

  const aspect =
    item.width > 0 && item.height > 0 ? item.width / item.height : 1;

  const onWidth = (v: number) => {
    const w = Math.max(0.05, v);
    if (lockAspect) {
      set({ width: w, height: Math.max(0.05, w / aspect) });
    } else {
      set({ width: w });
    }
  };

  const onHeight = (v: number) => {
    const h = Math.max(0.05, v);
    if (lockAspect) {
      set({ height: h, width: Math.max(0.05, h * aspect) });
    } else {
      set({ height: h });
    }
  };

  const replaceWithFile = useCallback(
    (file: File) => {
      setReplaceError(null);
      if (!isSupportedImageFile({ name: file.name, type: file.type })) {
        setReplaceError('Unsupported file — use PNG, JPG, or GIF.');
        return;
      }
      const url = URL.createObjectURL(file);
      const probe = new Image();
      probe.onload = () => {
        const pxW = probe.naturalWidth || probe.width;
        const pxH = probe.naturalHeight || probe.height;
        if (!(pxW > 0 && pxH > 0)) {
          URL.revokeObjectURL(url);
          setReplaceError('Could not read that image file.');
          return;
        }
        const size = fitImageToManimSize(pxW, pxH);
        set({
          srcUrl: url,
          assetRelPath: undefined,
          fileName: file.name,
          mimeType: file.type || guessImageMime(file.name),
          width: size.width,
          height: size.height,
        });
      };
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        setReplaceError('Could not read that image file.');
      };
      probe.src = url;
    },
    [set],
  );

  const baseContent = (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">Image</h3>
      <p className="text-[11px] text-slate-500 leading-snug">
        Still picture from disk (PNG, JPG, or GIF — GIF shows its first
        frame). Drag on the canvas to move with absolute positioning.
      </p>

      <label className="text-xs text-slate-400 block">
        Clip name
        <input
          type="text"
          value={item.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Title illustration"
          className="mt-1 w-full max-w-md bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
      </label>

      <div className="flex flex-col gap-1 text-[11px] text-slate-400">
        <span>
          File:{' '}
          <span className="text-slate-200" dir="auto">
            {item.fileName}
          </span>
        </span>
        <span>
          Imported size: {item.width.toFixed(2)} × {item.height.toFixed(2)}{' '}
          Manim units
        </span>
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif"
          className="hidden"
          aria-label="Replace image file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) replaceWithFile(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-100 hover:bg-slate-600"
          onClick={() => fileRef.current?.click()}
        >
          Replace image…
        </button>
      </div>
      {replaceError ? (
        <p className="text-[11px] text-red-300">{replaceError}</p>
      ) : null}

      <TargetAnimationEffectsNote targetId={item.id} />

      <button
        type="button"
        className="self-start text-xs text-red-300 hover:text-red-200 underline"
        onClick={() => removeItem(item.id)}
      >
        Delete image
      </button>
    </div>
  );

  const styleContent = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <NumberInput
          label="Width (units)"
          value={item.width}
          onChange={onWidth}
          min={0.05}
          step={0.1}
        />
        <NumberInput
          label="Height (units)"
          value={item.height}
          onChange={onHeight}
          min={0.05}
          step={0.1}
        />
      </div>
      <label className="text-xs text-slate-400 flex items-center gap-2">
        <input
          type="checkbox"
          checked={lockAspect}
          onChange={(e) => setLockAspect(e.target.checked)}
          className="accent-blue-500"
        />
        Lock aspect ratio
      </label>
      <NumberInput
        label="Opacity"
        value={item.opacity}
        onChange={(v) => set({ opacity: clampImageOpacity(v) })}
        min={0}
        max={1}
        step={0.05}
      />
    </div>
  );

  const animationContent = (
    <div className="flex flex-col gap-3">
      <VisibleAtSceneStartRow
        checked={item.visibleAtSceneStart === true}
        note="No intro animation is played for export (shown from the first frame)."
        onChange={(next) =>
          set(
            next
              ? { visibleAtSceneStart: true, startTime: 0 }
              : { visibleAtSceneStart: undefined },
          )
        }
      />

      <div className="flex items-end gap-3 flex-wrap">
        <NumberInput
          label="Start (s)"
          value={item.startTime}
          onChange={(v) => set({ startTime: Math.max(0, v) })}
          min={0}
          disabled={item.visibleAtSceneStart === true}
        />
        <NumberInput
          label="Duration"
          value={item.duration}
          onChange={(v) => set({ duration: Math.max(0.05, v) })}
          min={0.05}
        />
        <NumberInput
          label="Layer"
          value={item.layer}
          onChange={(v) => set({ layer: Math.round(v) })}
          min={0}
          step={1}
        />
      </div>

      <AudioBindingSelect
        value={item.audioTrackId}
        currentItemId={item.id}
        onChange={(audioTrackId) => setItemAudioBinding(item.id, audioTrackId)}
      />
    </div>
  );

  const positionContent = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <NumberInput
          label="X"
          value={item.x}
          onChange={(v) => set({ x: v })}
          step={0.1}
        />
        <NumberInput
          label="Y"
          value={item.y}
          onChange={(v) => set({ y: v })}
          step={0.1}
        />
        <NumberInput
          label="Scale"
          value={item.scale}
          onChange={(v) => set({ scale: Math.max(0.05, v) })}
          min={0.05}
          step={0.05}
        />
        <NumberInput
          label="Rotation °"
          value={item.rotationDeg}
          onChange={(v) => set({ rotationDeg: v })}
          step={1}
        />
      </div>

      <div>
        <div className="text-xs text-slate-400 mb-1">Position steps</div>
        <PositionStepsEditor
          steps={item.posSteps}
          onChange={(posSteps) => set({ posSteps })}
          currentItemId={item.id}
        />
      </div>
    </div>
  );

  return (
    <PropertyTabs
      key={item.id}
      defaultTabId="base"
      tabs={[
        { id: 'base', label: 'Base', content: baseContent },
        { id: 'style', label: 'Style', content: styleContent },
        { id: 'animation', label: 'Animation / Audio', content: animationContent },
        { id: 'position', label: 'Positioning', content: positionContent },
      ]}
    />
  );
}
