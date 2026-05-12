import { create } from 'zustand';
import type { ProjectSaveKind } from '@/lib/projectIO';

/**
 * Writable path for the current session (File System Access API).
 * Not persisted; survives only in-memory (handles are not serializable).
 */
interface ProjectFileSessionState {
  activeHandle: FileSystemFileHandle | null;
  activeKind: ProjectSaveKind | null;
  /** Tauri: absolute path — overwrites on save without browser download */
  activeTauriPath: string | null;
  setActiveProjectFile: (handle: FileSystemFileHandle, kind: ProjectSaveKind) => void;
  setActiveTauriPath: (path: string | null) => void;
  clearActiveProjectFile: () => void;
}

export const useProjectFileStore = create<ProjectFileSessionState>((set) => ({
  activeHandle: null,
  activeKind: null,
  activeTauriPath: null,
  setActiveProjectFile: (handle, kind) =>
    set({ activeHandle: handle, activeKind: kind, activeTauriPath: null }),
  setActiveTauriPath: (path) =>
    set(
      path
        ? { activeTauriPath: path, activeHandle: null, activeKind: null }
        : { activeTauriPath: null },
    ),
  clearActiveProjectFile: () =>
    set({ activeHandle: null, activeKind: null, activeTauriPath: null }),
}));
