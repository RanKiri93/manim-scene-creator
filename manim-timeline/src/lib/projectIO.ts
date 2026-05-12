import type { ProjectFile, ProjectFragmentFile } from '@/types/scene';
import { isProjectFragmentFile } from '@/types/scene';
import { MtprojUnpackError } from '@/lib/mtprojErrors';

export { MtprojPackError, MtprojUnpackError } from '@/lib/mtprojErrors';

export type LoadedProjectOrFragment =
  | { kind: 'project'; data: ProjectFile }
  | { kind: 'fragment'; data: ProjectFragmentFile };

/** How the active disk file should be written (matches extension). */
export type ProjectSaveKind = 'json' | 'mtproj';

/** Result of open dialog: browser file handle and/or Tauri absolute path. */
export type OpenProjectDiskResult = {
  loaded: LoadedProjectOrFragment;
  fileHandle: FileSystemFileHandle | null;
  /** Tauri desktop: path for silent overwrite on save (no FSA). */
  tauriPath: string | null;
};

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return (
    w.__TAURI_INTERNALS__ !== undefined ||
    w.__TAURI__ !== undefined
  );
}

const OPEN_ACCEPT_TYPES: FilePickerAcceptType[] = [
  {
    description: 'Manim Timeline project',
    accept: {
      'application/json': ['.json'],
      'application/zip': ['.mtproj'],
    },
  },
];

const JSON_SAVE_ACCEPT: FilePickerAcceptType[] = [
  {
    description: 'JSON project',
    accept: { 'application/json': ['.json'] },
  },
];

const MTPROJ_SAVE_ACCEPT: FilePickerAcceptType[] = [
  {
    description: 'Manim bundle',
    accept: { 'application/zip': ['.mtproj'] },
  },
];

export function supportsFileSystemAccess(): boolean {
  return (
    typeof window !== 'undefined' &&
    'showOpenFilePicker' in window &&
    'showSaveFilePicker' in window
  );
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
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
 * Infer save format from a filename (defaults to JSON when unknown).
 */
export function saveKindFromFilename(filename: string): ProjectSaveKind {
  return filename.toLowerCase().endsWith('.mtproj') ? 'mtproj' : 'json';
}

/**
 * Parse a loaded file into project or fragment. Returns null for unrecognized JSON shape.
 * @throws MtprojUnpackError from bundle parser
 */
export async function parseLoadedFromFile(
  file: File,
): Promise<LoadedProjectOrFragment | null> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.mtproj')) {
    const { parseMtprojFromFile } = await import('@/lib/mtprojBundle');
    const parsed = await parseMtprojFromFile(file);
    if (isProjectFragmentFile(parsed)) {
      return { kind: 'fragment', data: parsed };
    }
    return { kind: 'project', data: parsed };
  }
  if (name.endsWith('.json')) {
    const raw = JSON.parse(await file.text()) as unknown;
    return parseJsonPayload(raw);
  }
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (isZipMagic(head)) {
    const { parseMtprojFromFile } = await import('@/lib/mtprojBundle');
    const parsed = await parseMtprojFromFile(file);
    if (isProjectFragmentFile(parsed)) {
      return { kind: 'fragment', data: parsed };
    }
    return { kind: 'project', data: parsed };
  }
  const raw = JSON.parse(await file.text()) as unknown;
  return parseJsonPayload(raw);
}

async function ensureWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  try {
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Write serialized project bytes to a writable file handle.
 */
export async function writeProjectToHandle(
  handle: FileSystemFileHandle,
  project: ProjectFile,
  kind: ProjectSaveKind,
): Promise<void> {
  const ok = await ensureWritePermission(handle);
  if (!ok) throw new Error('Permission to save this file was denied.');

  let blob: Blob;
  if (kind === 'json') {
    const json = JSON.stringify(project, null, 2);
    blob = new Blob([json], { type: 'application/json' });
  } else {
    const { packMtprojToBlob } = await import('@/lib/mtprojBundle');
    blob = await packMtprojToBlob(project);
  }

  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function defaultJsonSuggestedName(): string {
  return `manim-project-${new Date().toISOString().slice(0, 10)}.json`;
}

function defaultMtprojSuggestedName(): string {
  return `manim-project-${new Date().toISOString().slice(0, 10)}.mtproj`;
}

/**
 * Show save dialog, write project, return the handle (or null if cancelled / FSA unavailable).
 */
export async function saveProjectWithPicker(
  project: ProjectFile,
  kind: ProjectSaveKind,
  suggestedName?: string,
): Promise<FileSystemFileHandle | null> {
  if (!supportsFileSystemAccess()) {
    if (isTauriRuntime() && kind === 'mtproj') {
      const path = await pickTauriMtprojSavePath(suggestedName);
      if (!path) return null;
      await writeMtprojToTauriPath(path, project);
      return null;
    }
    if (kind === 'json') {
      downloadProjectFile(project);
    } else {
      await downloadMtprojBundle(project);
    }
    return null;
  }
  try {
    const accept = kind === 'json' ? JSON_SAVE_ACCEPT : MTPROJ_SAVE_ACCEPT;
    const name =
      suggestedName?.trim() ||
      (kind === 'json' ? defaultJsonSuggestedName() : defaultMtprojSuggestedName());
    const handle = await window.showSaveFilePicker({
      suggestedName: name,
      types: accept,
    });
    await writeProjectToHandle(handle, project, kind);
    return handle;
  } catch (e) {
    if (isAbortError(e)) return null;
    throw e;
  }
}

/**
 * Write a packed .mtproj to an absolute path (Tauri native save — no browser download).
 */
export async function writeMtprojToTauriPath(
  path: string,
  project: ProjectFile,
): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { packMtprojToBlob } = await import('@/lib/mtprojBundle');
  const blob = await packMtprojToBlob(project);
  const buf = new Uint8Array(await blob.arrayBuffer());
  await invoke('write_project_bytes', { path, data: Array.from(buf) });
}

/**
 * Tauri “Save as…” for a new .mtproj on disk.
 */
export async function pickTauriMtprojSavePath(
  suggestedName?: string,
): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({
    filters: [{ name: 'Manim bundle', extensions: ['mtproj'] }],
    defaultPath: suggestedName?.trim() || defaultMtprojSuggestedName(),
  });
  if (path == null) return null;
  return typeof path === 'string' ? path : null;
}

async function openProjectFromDiskTauri(): Promise<OpenProjectDiskResult | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Project', extensions: ['mtproj', 'json'] }],
  });
  if (selected == null) return null;
  const path = Array.isArray(selected) ? selected[0] : selected;
  if (typeof path !== 'string' || path.length === 0) return null;

  const bytes = await invoke<number[]>('read_project_bytes', { path });
  const u8 = new Uint8Array(bytes);
  const base = path.replace(/^.*[/\\]/, '') || 'project';
  const file = new File([u8], base, { type: 'application/octet-stream' });
  const loaded = await parseLoadedFromFile(file);
  if (!loaded) return null;
  return { loaded, fileHandle: null, tauriPath: path };
}

/**
 * Open project: Tauri path + native I/O, else File System Access, else &lt;input&gt;.
 * @throws MtprojUnpackError
 */
export async function openProjectFromDisk(): Promise<OpenProjectDiskResult | null> {
  if (isTauriRuntime()) {
    return openProjectFromDiskTauri();
  }

  if (supportsFileSystemAccess()) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: OPEN_ACCEPT_TYPES,
        excludeAcceptAllOption: false,
        multiple: false,
        mode: 'readwrite',
      });
      const file = await handle.getFile();
      const loaded = await parseLoadedFromFile(file);
      if (!loaded) return null;
      return { loaded, fileHandle: handle, tauriPath: null };
    } catch (e) {
      if (isAbortError(e)) return null;
      throw e;
    }
  }

  const fromInput = await loadProjectFileViaInput();
  if (!fromInput) return null;
  return { ...fromInput, tauriPath: null };
}

/**
 * Pick a `.json` or `.mtproj` (ZIP) project or fragment from disk (no write handle).
 * Throws {@link MtprojUnpackError} when a bundle is invalid or fails checksum verification.
 */
export async function loadProjectFile(): Promise<LoadedProjectOrFragment | null> {
  const r = await loadProjectFileViaInput();
  return r ? r.loaded : null;
}

async function loadProjectFileViaInput(): Promise<{
  loaded: LoadedProjectOrFragment;
  fileHandle: FileSystemFileHandle | null;
} | null> {
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
      try {
        const loaded = await parseLoadedFromFile(file);
        if (!loaded) {
          resolve(null);
          return;
        }
        resolve({ loaded, fileHandle: null });
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

export function downloadProjectFile(project: ProjectFile) {
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultJsonSuggestedName();
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadMtprojBundle(project: ProjectFile): Promise<void> {
  const { packMtprojToBlob } = await import('@/lib/mtprojBundle');
  const blob = await packMtprojToBlob(project);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultMtprojSuggestedName();
  a.rel = 'noopener';
  a.click();
  URL.revokeObjectURL(url);
}
