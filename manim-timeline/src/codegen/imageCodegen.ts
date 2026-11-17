import type { AudioTrackItem, ImageItem, ItemId, SceneItem } from '@/types/scene';
import { pySoundCall } from './audioClipCodegen';
import { deriveImageAssetRelPath, clampImageOpacity } from '@/lib/imageAssetPath';
import { resolvePosition } from '@/lib/resolvePosition';
import { emitNextToPython } from './nextToCodegen';
import { pythonStringLiteral } from './texUtils';
import {
  type BoundAudioTailOpts,
  appendAudioTailAfterLeafPlayback,
  boundSoundEmittedAtTrackStart,
  resolveRecordedPlayback,
} from './lineCodegen';

function pyCommentValue(value: unknown): string {
  return JSON.stringify(value).replace(/\r?\n/g, ' ');
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function dataUrlParts(srcUrl: string): { mime: string; base64: string; ext: string } | null {
  const m = srcUrl.match(/^data:(image\/(png|jpeg|jpg|gif));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) return null;
  const mime = m[1]!.toLowerCase();
  const kind = m[2]!.toLowerCase();
  const ext = kind === 'jpeg' || kind === 'jpg' ? '.jpg' : kind === 'gif' ? '.gif' : '.png';
  return { mime, base64: m[3]!.replace(/\s+/g, ''), ext };
}

function imagePathExpr(item: ImageItem, varName: string, pad: string): { setup: string; expr: string } {
  const pinned = item.assetRelPath?.trim().replace(/^\/+/, '');
  if (pinned) {
    return { setup: '', expr: pythonStringLiteral(pinned) };
  }

  const src = item.srcUrl.trim();
  const data = dataUrlParts(src);
  if (!data) {
    if (src.startsWith('assets/textures/')) {
      return { setup: '', expr: pythonStringLiteral(src) };
    }
    if (/^(blob:|https?:\/\/)/i.test(src)) {
      throw new Error(
        `Image "${item.label || item.fileName || item.id}" is not bundled for Manim export. Save/open a .mtproj so the image is stored under assets/textures, or use an embedded data URL.`,
      );
    }
    return { setup: '', expr: pythonStringLiteral(deriveImageAssetRelPath(item)) };
  }

  const pathVar = `_${varName}_path`;
  const bytesVar = `_${varName}_bytes`;
  const stem = varName.replace(/[^a-zA-Z0-9_]/g, '_') || 'image';
  const fileLit = pythonStringLiteral(`manimui_${stem}${data.ext}`);
  const setup =
    `${pad}${bytesVar} = base64.b64decode(${pythonStringLiteral(data.base64)})\n` +
    `${pad}${pathVar} = os.path.join(tempfile.gettempdir(), ${fileLit})\n` +
    `${pad}with open(${pathVar}, "wb") as _manimui_img_f:\n` +
    `${pad}    _manimui_img_f.write(${bytesVar})\n`;
  return { setup, expr: pathVar };
}

export function imageNeedsEmbeddedDataHelper(item: ImageItem): boolean {
  return !item.assetRelPath?.trim() && dataUrlParts(item.srcUrl.trim()) != null;
}

/** Module-level helper for animated GIFs: loops on the scene clock (see `lib/gifTiming.ts`). */
export function gifImageHelperSource(): string {
  return [
    'class _ManimUIGif(ImageMobject):',
    '    """Animated GIF looping from `start` (scene seconds); frame delays as browsers play them."""',
    '    scene = None',
    '    _cache = {}',
    '',
    '    @staticmethod',
    '    def use_scene(scene):',
    '        _ManimUIGif.scene = scene',
    '',
    '    def __init__(self, path, start, **kwargs):',
    '        super().__init__(path, **kwargs)',
    '        if path not in _ManimUIGif._cache:',
    '            import numpy as _np',
    '            from PIL import Image as _PILImage, ImageSequence as _PILSequence',
    '            frames, delays = [], []',
    '            with _PILImage.open(path) as im:',
    '                for fr in _PILSequence.Iterator(im):',
    '                    frames.append(_np.array(fr.convert("RGBA")))',
    '                    raw = fr.info.get("duration", 0) or 0',
    '                    delays.append(raw if raw > 10 else 100)',
    '            _ManimUIGif._cache[path] = (frames, delays)',
    '        self.gif_path = path',
    '        self.gif_start = start',
    '        self.gif_opacity = 1.0',
    '        # Time-based, so waits keep updating (not frozen) while a GIF is on screen.',
    '        self.add_updater(lambda m, dt: m.gif_refresh())',
    '        self.gif_refresh()',
    '',
    '    def gif_index(self):',
    '        delays = _ManimUIGif._cache[self.gif_path][1]',
    '        scene = _ManimUIGif.scene',
    '        elapsed = (scene.time if scene is not None else 0.0) - self.gif_start',
    '        if len(delays) <= 1 or not elapsed > 0:',
    '            return 0',
    '        t = (elapsed * 1000) % sum(delays)',
    '        for i, d in enumerate(delays):',
    '            t -= d',
    '            if t < 0:',
    '                return i',
    '        return len(delays) - 1',
    '',
    '    def gif_refresh(self):',
    '        if not hasattr(self, "gif_path"):',
    '            return self',
    '        frame = _ManimUIGif._cache[self.gif_path][0][self.gif_index()]',
    '        if frame.shape != self.pixel_array.shape:',
    '            return self',
    '        arr = frame.copy()',
    '        arr[:, :, 3] = (frame[:, :, 3].astype(float) * self.gif_opacity).astype(arr.dtype)',
    '        self.pixel_array = arr',
    '        return self',
    '',
    '    def set_opacity(self, alpha):',
    '        if not hasattr(self, "gif_path"):',
    '            return super().set_opacity(alpha)',
    '        self.gif_opacity = alpha',
    '        self.stroke_opacity = alpha',
    '        return self.gif_refresh()',
    '',
    '    def interpolate_color(self, mobject1, mobject2, alpha):',
    '        self.gif_opacity = interpolate(getattr(mobject1, "gif_opacity", 1.0), getattr(mobject2, "gif_opacity", 1.0), alpha)',
    '        self.gif_refresh()',
    '',
  ].join('\n');
}

export function generateImageDef(
  item: ImageItem,
  varName: string,
  indent: number,
  /** Animated GIF: scene second it appears (loop origin); omit for a still picture. */
  gifStart?: number,
): string {
  const pad = ' '.repeat(indent);
  const width = finitePositive(item.width, 3);
  const height = finitePositive(item.height, 2);
  const { setup, expr } = imagePathExpr(item, varName, pad);
  let s = setup;
  s += gifStart != null
    ? `${pad}${varName} = _ManimUIGif(${expr}, ${Math.max(0, gifStart).toFixed(6)})\n`
    : `${pad}${varName} = ImageMobject(${expr})\n`;
  s += `${pad}${varName}.stretch_to_fit_width(${width.toFixed(6)})\n`;
  s += `${pad}${varName}.stretch_to_fit_height(${height.toFixed(6)})\n`;
  s += `${pad}${varName}.set_opacity(${clampImageOpacity(item.opacity).toFixed(4)})\n`;
  return s;
}

export function generateImagePos(
  item: ImageItem,
  varName: string,
  indent: number,
  idToVarName: Map<ItemId, string>,
  itemsMap: Map<ItemId, SceneItem>,
): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [
    `${pad}# timeline image ${pyCommentValue({
      id: item.id,
      label: item.label,
      fileName: item.fileName,
      x: item.x,
      y: item.y,
      scale: item.scale,
      width: item.width,
      height: item.height,
      opacity: item.opacity,
      rotationDeg: item.rotationDeg,
      posSteps: item.posSteps,
    })}`,
  ];

  const scale = Number.isFinite(item.scale) ? item.scale : 1;
  if (Math.abs(scale - 1) > 1e-6) {
    lines.push(`${pad}${varName}.scale(${scale.toFixed(6)})`);
  }

  let emittedPlacement = false;
  for (let si = 0; si < item.posSteps.length; si++) {
    const step = item.posSteps[si]!;
    switch (step.kind) {
      case 'absolute':
        lines.push(`${pad}${varName}.move_to([${item.x.toFixed(6)}, ${item.y.toFixed(6)}, 0])`);
        emittedPlacement = true;
        break;
      case 'next_to': {
        if (!step.refId) break;
        const refVar = idToVarName.get(step.refId);
        if (!refVar) break;
        const refItem = itemsMap.get(step.refId);
        if (!refItem) break;
        lines.push(
          emitNextToPython({
            varName,
            step,
            refVar,
            item,
            refItem,
            itemsMap,
            stepIndex: si,
            indent: pad,
          }),
        );
        emittedPlacement = true;
        break;
      }
      case 'to_edge':
        lines.push(`${pad}${varName}.to_edge(${step.edge}, buff=${Number.isFinite(step.buff) ? step.buff : 0.3})`);
        emittedPlacement = true;
        break;
      case 'shift':
        lines.push(`${pad}${varName}.shift(${step.dx}*RIGHT + ${step.dy}*UP)`);
        emittedPlacement = true;
        break;
      case 'set_x':
        lines.push(`${pad}${varName}.set_x(${step.x.toFixed(6)})`);
        emittedPlacement = true;
        break;
      case 'set_y':
        lines.push(`${pad}${varName}.set_y(${step.y.toFixed(6)})`);
        emittedPlacement = true;
        break;
    }
  }

  if (!emittedPlacement) {
    lines.push(`${pad}${varName}.move_to([${item.x.toFixed(6)}, ${item.y.toFixed(6)}, 0])`);
  }

  if (Math.abs(item.rotationDeg) > 1e-6) {
    const manimDeg = -item.rotationDeg;
    const p = resolvePosition(item, itemsMap);
    lines.push(
      `${pad}${varName}.rotate(${manimDeg.toFixed(4)} * DEGREES, about_point=[${p.x.toFixed(6)}, ${p.y.toFixed(6)}, 0])`,
    );
  }

  return lines.join('\n') + (lines.length ? '\n' : '');
}

export function imageIntroAnimationExpr(varName: string): string {
  return `FadeIn(${varName})`;
}

export function generateImagePlay(
  item: ImageItem,
  varName: string,
  indent: number,
  itemsMap: Map<ItemId, SceneItem>,
  audioItems?: AudioTrackItem[],
  tailOpts?: BoundAudioTailOpts,
): string {
  const pad = ' '.repeat(indent);
  if (item.visibleAtSceneStart) return '';

  const recorded = resolveRecordedPlayback(item, itemsMap, audioItems);
  if (recorded) {
    const rt = recorded.runTime.toFixed(6);
    const soundEarly =
      audioItems?.length && boundSoundEmittedAtTrackStart(item, itemsMap, audioItems);
    return (
      (soundEarly ? '' : `${pad}${pySoundCall(recorded.track)}\n`) +
      `${pad}self.play(FadeIn(${varName}), run_time=${rt})\n` +
      appendAudioTailAfterLeafPlayback(
        pad,
        recorded,
        item,
        itemsMap,
        audioItems,
        tailOpts,
      )
    );
  }

  const rt = Math.max(0.05, item.duration).toFixed(6);
  return `${pad}self.play(FadeIn(${varName}), run_time=${rt})\n`;
}
