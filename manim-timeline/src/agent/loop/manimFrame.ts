import { exportManimCode } from '@/codegen/manimExporter';
import { safeSceneClassName } from '@/lib/pythonIdent';
import { renderSceneFrame } from '@/services/measureClient';
import type { DraftSession } from './draft';
import type { LoopImage } from './types';

/** Export the draft scene and have the measure server render one frame of it. */
export async function renderDraftFrame(session: DraftSession, time: number, measureUrl: string): Promise<LoopImage> {
  const { defaults, audioItems, frames, startFrameId } = session.base;
  const code = exportManimCode([...session.scene().values()], {
    fullFile: true,
    defaults,
    audioItems,
    frames,
    startFrameId: startFrameId ?? undefined,
  });
  const exportError = /# EXPORT ERROR: (.*)/.exec(code)?.[1];
  if (exportError) throw new Error(`Export failed: ${exportError}`);
  const frame = await renderSceneFrame(measureUrl, code, safeSceneClassName(defaults.sceneName ?? ''), time);
  return { mediaType: 'image/png', base64: frame.pngBase64 };
}
