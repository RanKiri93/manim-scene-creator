import type { ProjectFile } from '@/types/scene';
import { MtprojUnpackError } from '@/lib/mtprojErrors';

export { MtprojPackError, MtprojUnpackError } from '@/lib/mtprojErrors';

export function downloadProjectFile(project: ProjectFile) {
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `manim-project-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadMtprojBundle(project: ProjectFile): Promise<void> {
  const { packMtprojToBlob } = await import('@/lib/mtprojBundle');
  const blob = await packMtprojToBlob(project);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `manim-project-${new Date().toISOString().slice(0, 10)}.mtproj`;
  a.rel = 'noopener';
  a.click();
  URL.revokeObjectURL(url);
}

function isZipMagic(head: Uint8Array): boolean {
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b;
}

/**
 * Pick a `.json` or `.mtproj` (ZIP) project from disk.
 * Throws {@link MtprojUnpackError} when a bundle is invalid or fails checksum verification.
 */
export async function loadProjectFile(): Promise<ProjectFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.mtproj,application/json,application/zip';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const name = file.name.toLowerCase();
      try {
        if (name.endsWith('.mtproj')) {
          const { parseMtprojFromFile } = await import('@/lib/mtprojBundle');
          resolve(await parseMtprojFromFile(file));
          return;
        }
        if (name.endsWith('.json')) {
          resolve(JSON.parse(await file.text()) as ProjectFile);
          return;
        }
        const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        if (isZipMagic(head)) {
          const { parseMtprojFromFile } = await import('@/lib/mtprojBundle');
          resolve(await parseMtprojFromFile(file));
          return;
        }
        resolve(JSON.parse(await file.text()) as ProjectFile);
      } catch (e) {
        if (e instanceof MtprojUnpackError) {
          reject(e);
          return;
        }
        resolve(null);
      }
    };
    input.click();
  });
}
