import type {
  AudioBed,
  AudioTrackItem,
  FrameDef,
  ItemId,
  SceneDefaults,
  SceneItem,
} from '@/types/scene';
import {
  buildAudioMixdownSpec,
  needsAudioMixdown,
} from '@/lib/audioMixdown';
import { mixdownAudio, syncRenderAudioAssets } from '@/services/measureClient';

export interface SceneAudioRenderContext {
  items: SceneItem[];
  defaults: SceneDefaults;
  frames: FrameDef[];
  startFrameId: ItemId;
  audioItems: AudioTrackItem[];
  audioBed?: AudioBed | null;
}

/**
 * Sync bundled assets, optionally build a master mixdown WAV for export mux.
 * Returns repo-relative `assets/audio/master_*.wav` path, or null when Manim audio is used as-is.
 */
export async function prepareSceneMasterAudio(
  measureUrl: string,
  scene: SceneAudioRenderContext,
): Promise<string | null> {
  await syncRenderAudioAssets(
    measureUrl,
    scene.audioItems,
    scene.audioBed ?? null,
  );
  if (!needsAudioMixdown(scene.audioBed, scene.audioItems, scene.defaults)) {
    return null;
  }
  const spec = buildAudioMixdownSpec(
    scene.items,
    scene.audioItems,
    scene.defaults,
    {
      audioBed: scene.audioBed,
      frames: scene.frames,
      startFrameId: scene.startFrameId,
    },
  );
  const { file_path } = await mixdownAudio(measureUrl, spec);
  return file_path;
}
