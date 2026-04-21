import type { ProjectFile, ProjectFragmentFile } from '@/types/scene';
import { isProjectFragmentFile } from '@/types/scene';
import { MtprojUnpackError } from '@/lib/mtprojErrors';
import { MEASURE_SERVER_DEFAULT_URL } from '@/lib/constants';
import { defaultSceneDefaults } from '@/store/factories';

export { MtprojPackError, MtprojUnpackError } from '@/lib/mtprojErrors';

export type LoadedProjectOrFragment =
  | { kind: 'project'; data: ProjectFile }
  | { kind: 'fragment'; data: ProjectFragmentFile };

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

export function downloadProjectFragmentFile(fragment: ProjectFragmentFile) {
  const json = JSON.stringify(fragment, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `manim-fragment-${new Date().toISOString().slice(0, 10)}.json`;
  a.rel = 'noopener';
  a.click();
  URL.revokeObjectURL(url);
}

/** Minimal `ProjectFile` wrapper so `.mtproj` packing can embed fragment audio. */
export function syntheticProjectFileFromFragment(
  fragment: ProjectFragmentFile,
): ProjectFile {
  return {
    version: fragment.version,
    savedAt: fragment.savedAt,
    defaults: defaultSceneDefaults(),
    measureConfig: {
      url: MEASURE_SERVER_DEFAULT_URL,
      enabled: true,
      includePreview: true,
    },
    items: fragment.items,
    audioItems: fragment.audioItems,
  };
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

export async function downloadMtprojFragmentBundle(
  fragment: ProjectFragmentFile,
): Promise<void> {
  const { packMtprojToBlob } = await import('@/lib/mtprojBundle');
  const blob = await packMtprojToBlob(syntheticProjectFileFromFragment(fragment));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `manim-fragment-${new Date().toISOString().slice(0, 10)}.mtproj`;
  a.rel = 'noopener';
  a.click();
  URL.revokeObjectURL(url);
}

function isZipMagic(head: Uint8Array): boolean {
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b;
}

function parseJsonPayload(raw: unknown): LoadedProjectOrFragment | null {
  if (!raw || typeof raw !== 'object') return null;
  if (isProjectFragmentFile(raw)) {
    return { kind: 'fragment', data: raw };
  }
  const o = raw as Record<string, unknown>;
  if (
    Array.isArray(o.items) &&
    o.defaults &&
    typeof o.defaults === 'object' &&
    o.measureConfig &&
    typeof o.measureConfig === 'object'
  ) {
    return { kind: 'project', data: raw as ProjectFile };
  }
  return null;
}

/**
 * Pick a `.json` or `.mtproj` (ZIP) project or fragment from disk.
 * Throws {@link MtprojUnpackError} when a bundle is invalid or fails checksum verification.
 */
export async function loadProjectFile(): Promise<LoadedProjectOrFragment | null> {
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
          const parsed = await parseMtprojFromFile(file);
          if (isProjectFragmentFile(parsed)) {
            resolve({ kind: 'fragment', data: parsed });
          } else {
            resolve({ kind: 'project', data: parsed });
          }
          return;
        }
        if (name.endsWith('.json')) {
          const raw = JSON.parse(await file.text()) as unknown;
          resolve(parseJsonPayload(raw));
          return;
        }
        const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        if (isZipMagic(head)) {
          const { parseMtprojFromFile } = await import('@/lib/mtprojBundle');
          const parsed = await parseMtprojFromFile(file);
          if (isProjectFragmentFile(parsed)) {
            resolve({ kind: 'fragment', data: parsed });
          } else {
            resolve({ kind: 'project', data: parsed });
          }
          return;
        }
        const raw = JSON.parse(await file.text()) as unknown;
        resolve(parseJsonPayload(raw));
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
