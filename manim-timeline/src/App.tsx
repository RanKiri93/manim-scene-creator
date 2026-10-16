import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSceneStore, type SceneDiskPayload } from '@/store/useSceneStore';
import { useProjectFileStore } from '@/store/useProjectFileStore';
import {
  downloadMtprojBundle,
  isTauriRuntime,
  MtprojPackError,
  MtprojUnpackError,
  openProjectFromDisk,
  pickTauriMtprojSavePath,
  saveKindFromFilename,
  saveProjectWithPicker,
  supportsFileSystemAccess,
  writeMtprojToTauriPath,
  writeProjectToHandle,
} from '@/lib/projectIO';
import type { FragmentTimeMode } from '@/lib/projectFragment';
import SceneCanvas from '@/canvas/SceneCanvas';
import Timeline from '@/timeline/Timeline';
import ItemList from '@/panels/ItemList';
import FramesPanel from '@/panels/FramesPanel';
import AddObjectToolbar from '@/panels/AddObjectToolbar';
import PropertyPanel from '@/panels/PropertyPanel';
import ExportPanel from '@/panels/ExportPanel';
import AudioPanel from '@/panels/AudioPanel';
import FloatingPanel from '@/components/FloatingPanel';
import { useAxesPreviewSync } from '@/services/axisPreviewHooks';
import { useSceneUndoRedo } from '@/hooks/useSceneUndoRedo';
import { useProjectScenesStore } from '@/store/useProjectScenesStore';
import SceneTabsBar from '@/components/SceneTabsBar';
import { Button, IconButton, RedoIcon, UndoIcon } from '@/components/ui';

const TOOLBAR_WIDTH_STORAGE_KEY = 'manim-timeline-add-toolbar-width';
const INSERT_SIDEBAR_COLLAPSED_KEY = 'manim-timeline-insert-sidebar-collapsed';
const DEFAULT_TOOLBAR_WIDTH = 216;
const MIN_TOOLBAR_WIDTH = 64;
const MAX_TOOLBAR_WIDTH = 360;
const COLLAPSED_INSERT_WIDTH = 52;
const MIN_EXPANDED_INSERT_WIDTH = 180;

function readStoredToolbarWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_TOOLBAR_WIDTH;
  try {
    const raw = localStorage.getItem(TOOLBAR_WIDTH_STORAGE_KEY);
    if (raw == null) return DEFAULT_TOOLBAR_WIDTH;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_TOOLBAR_WIDTH;
    return Math.max(MIN_TOOLBAR_WIDTH, Math.min(MAX_TOOLBAR_WIDTH, Math.round(n)));
  } catch {
    return DEFAULT_TOOLBAR_WIDTH;
  }
}

function readStoredInsertCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // Icon rail by default; only an explicit '0' keeps the labelled sidebar.
    return localStorage.getItem(INSERT_SIDEBAR_COLLAPSED_KEY) !== '0';
  } catch {
    return true;
  }
}

function promptFragmentTimeMode(): FragmentTimeMode | null {
  const v = window.prompt(
    'Fragment placement:\n1 = keep original times\n2 = start at playhead\n3 = append after scene (default)\n\nEnter 1, 2, or 3:',
    '3',
  );
  if (v === null) return null;
  const t = v.trim();
  if (t === '1') return 'preserve';
  if (t === '2') return 'playhead';
  return 'appendEnd';
}

function fileBasename(path: string): string {
  return path.replace(/^.*[/\\]/, '');
}

function formatSavedTime(iso: string | null): string {
  if (!iso) return 'Not saved yet';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Last saved time unknown';
  return `Saved ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function buildProjectContentKeyFromState(): string {
  const project = useProjectScenesStore.getState();
  const scene = useSceneStore.getState();
  const activePayload = scene.toSceneDiskPayload();
  const scenes = project.sceneIds.map((sid) => ({
    id: sid,
    name: project.sceneTabNames[sid] ?? 'Scene',
    payload: sid === project.activeSceneId
      ? activePayload
      : project.idleScenes[sid] ?? null,
  }));
  return JSON.stringify({
    activeSceneId: project.activeSceneId,
    measureConfig: scene.measureConfig,
    scenes,
    ...(project.copilotNotes.length ? { copilotNotes: project.copilotNotes } : {}),
  });
}

function buildProjectContentKey(args: {
  sceneIds: string[];
  sceneTabNames: Record<string, string>;
  idleScenes: Record<string, SceneDiskPayload>;
  activeSceneId: string | null;
  activePayload: SceneDiskPayload;
  measureConfig: unknown;
  copilotNotes: string[];
}): string {
  const scenes = args.sceneIds.map((sid) => ({
    id: sid,
    name: args.sceneTabNames[sid] ?? 'Scene',
    payload: sid === args.activeSceneId
      ? args.activePayload
      : args.idleScenes[sid] ?? null,
  }));
  return JSON.stringify({
    activeSceneId: args.activeSceneId,
    measureConfig: args.measureConfig,
    scenes,
    ...(args.copilotNotes.length ? { copilotNotes: args.copilotNotes } : {}),
  });
}

function isEditableTargetFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  return el.isContentEditable === true;
}

export default function App() {
  const [timelineHeight, setTimelineHeight] = useState(220);
  const [toolbarWidth, setToolbarWidth] = useState(readStoredToolbarWidth);
  const [insertCollapsed, setInsertCollapsed] = useState(readStoredInsertCollapsed);

  const toggleInsertCollapsed = useCallback(() => {
    setInsertCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(INSERT_SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const insertSidebarWidth = insertCollapsed
    ? COLLAPSED_INSERT_WIDTH
    : Math.max(toolbarWidth, MIN_EXPANDED_INSERT_WIDTH);
  useAxesPreviewSync();
  const exportOpen = useSceneStore((s) => s.exportOpen);
  const setExportOpen = useSceneStore((s) => s.setExportOpen);
  const audioMode = useSceneStore((s) => s.audioMode);
  const setAudioMode = useSceneStore((s) => s.setAudioMode);
  const agentOpen = useSceneStore((s) => s.agentOpen);
  const setAgentOpen = useSceneStore((s) => s.setAgentOpen);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const newHeight = window.innerHeight - ev.clientY;
      setTimelineHeight(Math.max(100, Math.min(600, newHeight)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, []);

  const startToolbarWidthResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = toolbarWidth;
      let lastW = startW;
      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX;
        lastW = Math.max(
          MIN_TOOLBAR_WIDTH,
          Math.min(MAX_TOOLBAR_WIDTH, startW + delta),
        );
        setToolbarWidth(lastW);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        try {
          localStorage.setItem(TOOLBAR_WIDTH_STORAGE_KEY, String(lastW));
        } catch {
          /* ignore */
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [toolbarWidth],
  );
  const importFragment = useSceneStore((s) => s.importFragment);
  const { canUndo, canRedo, undo, redo } = useSceneUndoRedo();

  useEffect(() => {
    useProjectScenesStore.getState().bootstrapIfNeeded();
  }, []);

  const activeFileHandle = useProjectFileStore((s) => s.activeHandle);
  const activeTauriPath = useProjectFileStore((s) => s.activeTauriPath);
  const savedContentKey = useProjectFileStore((s) => s.savedContentKey);
  const lastSavedAt = useProjectFileStore((s) => s.lastSavedAt);
  const setActiveProjectFile = useProjectFileStore((s) => s.setActiveProjectFile);
  const setActiveTauriPath = useProjectFileStore((s) => s.setActiveTauriPath);
  const clearActiveProjectFile = useProjectFileStore((s) => s.clearActiveProjectFile);
  const projectSceneIds = useProjectScenesStore((s) => s.sceneIds);
  const projectSceneTabNames = useProjectScenesStore((s) => s.sceneTabNames);
  const projectIdleScenes = useProjectScenesStore((s) => s.idleScenes);
  const projectActiveSceneId = useProjectScenesStore((s) => s.activeSceneId);
  const projectCopilotNotes = useProjectScenesStore((s) => s.copilotNotes);
  const currentItems = useSceneStore((s) => s.items);
  const currentDefaults = useSceneStore((s) => s.defaults);
  const currentFrames = useSceneStore((s) => s.frames);
  const currentStartFrameId = useSceneStore((s) => s.startFrameId);
  const currentAudioItems = useSceneStore((s) => s.audioItems);
  const currentMeasureConfig = useSceneStore((s) => s.measureConfig);
  const currentActivePayload = useMemo<SceneDiskPayload>(
    () => ({
      defaults: { ...currentDefaults },
      frames: currentFrames.map((f) => ({ ...f })),
      startFrameId: currentStartFrameId,
      items: Array.from(currentItems.values()),
      audioItems: currentAudioItems.length > 0
        ? currentAudioItems.map((a) => ({ ...a }))
        : undefined,
    }),
    [currentAudioItems, currentDefaults, currentFrames, currentItems, currentStartFrameId],
  );
  const currentContentKey = useMemo(
    () =>
      buildProjectContentKey({
        sceneIds: projectSceneIds,
        sceneTabNames: projectSceneTabNames,
        idleScenes: projectIdleScenes,
        activeSceneId: projectActiveSceneId,
        activePayload: currentActivePayload,
        measureConfig: currentMeasureConfig,
        copilotNotes: projectCopilotNotes,
      }),
    [
      currentActivePayload,
      currentMeasureConfig,
      projectCopilotNotes,
      projectActiveSceneId,
      projectIdleScenes,
      projectSceneIds,
      projectSceneTabNames,
    ],
  );
  const isDirty = savedContentKey == null || savedContentKey !== currentContentKey;
  const saveStatusLabel = isDirty
    ? lastSavedAt
      ? `${formatSavedTime(lastSavedAt)} - unsaved changes`
      : 'Unsaved changes'
    : formatSavedTime(lastSavedAt);

  const alertPackError = (e: unknown) => {
    if (e instanceof MtprojPackError) {
      const lines = e.failed
        .map((f) => `• ${f.text.slice(0, 40)}${f.text.length > 40 ? '…' : ''} — ${f.reason}`)
        .join('\n');
      window.alert(`${e.message}\n\n${lines}`);
    } else {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  /** Save current project (.mtproj) — same as Ctrl+S / Cmd+S. */
  const saveProject = useCallback(async () => {
    useProjectScenesStore.getState().bootstrapIfNeeded();
    const project = useProjectScenesStore.getState().toMultiSceneProjectFile();
    const st = useProjectFileStore.getState();
    const markCurrentProjectSaved = () => {
      st.markSaved(buildProjectContentKeyFromState(), project.savedAt);
    };
    try {
      if (isTauriRuntime()) {
        const { activeTauriPath, setActiveTauriPath: setTauri } = st;
        if (activeTauriPath) {
          if (saveKindFromFilename(fileBasename(activeTauriPath)) === 'mtproj') {
            await writeMtprojToTauriPath(activeTauriPath, project);
            markCurrentProjectSaved();
            return;
          }
          const path = await pickTauriMtprojSavePath();
          if (!path) return;
          setTauri(path);
          await writeMtprojToTauriPath(path, project);
          markCurrentProjectSaved();
          return;
        }
        const path = await pickTauriMtprojSavePath();
        if (!path) return;
        setTauri(path);
        await writeMtprojToTauriPath(path, project);
        markCurrentProjectSaved();
        return;
      }

      const { activeHandle, activeKind } = st;
      if (supportsFileSystemAccess() && activeHandle && activeKind === 'mtproj') {
        await writeProjectToHandle(activeHandle, project, 'mtproj');
        markCurrentProjectSaved();
        return;
      }
      if (supportsFileSystemAccess() && activeHandle && activeKind === 'json') {
        const handle = await saveProjectWithPicker(project, 'mtproj');
        if (handle) st.setActiveProjectFile(handle, 'mtproj');
        if (handle) markCurrentProjectSaved();
        return;
      }
      if (supportsFileSystemAccess()) {
        const handle = await saveProjectWithPicker(project, 'mtproj');
        if (handle) st.setActiveProjectFile(handle, 'mtproj');
        if (handle) markCurrentProjectSaved();
        return;
      }
      await downloadMtprojBundle(project);
      markCurrentProjectSaved();
      if (import.meta.env.DEV) {
        console.info(
          '[Manim Timeline] Saved via browser download. For saving to one file on disk (no extra downloads), run the desktop app: npm run tauri:dev — or use Chrome/Edge at localhost with File System Access.',
        );
      }
    } catch (e) {
      alertPackError(e);
    }
  }, []);

  /** Always choose a new .mtproj path. */
  const saveProjectAs = useCallback(async () => {
    useProjectScenesStore.getState().bootstrapIfNeeded();
    const project = useProjectScenesStore.getState().toMultiSceneProjectFile();
    const st = useProjectFileStore.getState();
    const suggestedName =
      activeFileHandle?.name ??
      (activeTauriPath ? fileBasename(activeTauriPath) : undefined);
    try {
      if (isTauriRuntime()) {
        const path = await pickTauriMtprojSavePath(suggestedName);
        if (!path) return;
        await writeMtprojToTauriPath(path, project);
        st.setActiveTauriPath(path);
        st.markSaved(buildProjectContentKeyFromState(), project.savedAt);
        return;
      }

      if (supportsFileSystemAccess()) {
        const handle = await saveProjectWithPicker(project, 'mtproj', suggestedName);
        if (!handle) return;
        st.setActiveProjectFile(handle, 'mtproj');
        st.markSaved(buildProjectContentKeyFromState(), project.savedAt);
        return;
      }

      await downloadMtprojBundle(project);
      st.markSaved(buildProjectContentKeyFromState(), project.savedAt);
    } catch (e) {
      alertPackError(e);
    }
  }, [activeFileHandle?.name, activeTauriPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.isComposing) return;

      const mod = e.ctrlKey || e.metaKey;
      const saveCombo =
        e.code === 'KeyS' &&
        mod &&
        !e.shiftKey &&
        !e.altKey;
      if (saveCombo) {
        e.preventDefault();
        void saveProject();
        return;
      }

      const saveAsCombo =
        e.code === 'KeyS' &&
        mod &&
        e.shiftKey &&
        !e.altKey;
      if (saveAsCombo) {
        e.preventDefault();
        void saveProjectAs();
        return;
      }

      if (!mod || e.altKey) return;
      if (isEditableTargetFocused()) return;

      const t = useSceneStore.temporal.getState();

      if (e.code === 'KeyZ') {
        if (e.shiftKey) {
          if (t.futureStates.length === 0) return;
          e.preventDefault();
          t.redo();
          return;
        }
        if (t.pastStates.length === 0) return;
        e.preventDefault();
        t.undo();
        return;
      }

      if (e.code === 'KeyY' && !e.shiftKey) {
        if (t.futureStates.length === 0) return;
        e.preventDefault();
        t.redo();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [saveProject, saveProjectAs]);

  const handleLoad = async () => {
    try {
      const outcome = await openProjectFromDisk();
      if (!outcome) return;
      const { loaded, fileHandle, tauriPath } = outcome;
      if (loaded.kind === 'fragment') {
        const mode = promptFragmentTimeMode();
        if (mode == null) return;
        importFragment(loaded.data, { timeMode: mode });
        return;
      }
      useProjectScenesStore.getState().loadFromAnyDiskProject(loaded.data);
      if (tauriPath) {
        setActiveTauriPath(tauriPath);
      } else if (fileHandle) {
        setActiveProjectFile(fileHandle, saveKindFromFilename(fileHandle.name));
      } else {
        clearActiveProjectFile();
      }
      useProjectFileStore
        .getState()
        .markSaved(buildProjectContentKeyFromState(), loaded.data.savedAt);
    } catch (e) {
      if (e instanceof MtprojUnpackError) {
        window.alert(e.message);
      }
    }
  };

  const activeFileLabel =
    activeFileHandle?.name ??
    (activeTauriPath ? fileBasename(activeTauriPath) : null);

  return (
    <div className="h-screen flex flex-col bg-ink text-chalk overflow-hidden">
      {/* Top bar: project, scene tabs, document actions */}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-rule bg-panel pr-3 pl-4">
        <h1 className="m-0 shrink-0 font-display text-title font-medium whitespace-nowrap">
          Manim <span className="font-normal text-chalk-dim italic">Timeline</span>
        </h1>
        <div
          className="flex h-5 min-w-0 shrink items-center gap-2 border-l border-rule pl-3 text-ctl text-chalk-dim"
          title={`${activeFileLabel ?? 'Untitled project'}: ${saveStatusLabel}. ${
            isTauriRuntime()
              ? 'Ctrl+S saves; Ctrl+Shift+S opens Save as.'
              : 'Ctrl+S saves; Ctrl+Shift+S opens Save as. Browsers without File System Access download a new .mtproj.'
          }`}
        >
          {isDirty && <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-warn" />}
          <span className="max-w-[min(220px,22vw)] truncate">{activeFileLabel ?? 'Untitled project'}</span>
          <span className="sr-only">{isDirty ? '(unsaved changes)' : '(saved)'}</span>
        </div>
        <div className="flex h-full min-w-0 flex-1 items-stretch">
          <SceneTabsBar />
        </div>
        <div className="flex shrink-0 items-center gap-1 border-l border-rule pl-3">
          <IconButton label="Undo" title="Undo (Ctrl+Z, ⌘+Z)" onClick={undo} disabled={!canUndo}>
            <UndoIcon />
          </IconButton>
          <IconButton
            label="Redo"
            title="Redo (Ctrl+Y, ⌘+Y, Ctrl+Shift+Z, ⌘+Shift+Z)"
            onClick={redo}
            disabled={!canRedo}
          >
            <RedoIcon />
          </IconButton>
          <Button
            variant="ghost"
            onClick={() => void handleLoad()}
            title="Open a project or import a selection fragment (.json / .mtproj)"
          >
            Open…
          </Button>
          <Button
            onClick={() => void saveProject()}
            title="Save the current .mtproj project. Ctrl+S / Cmd+S saves to the active file when available."
          >
            Save
          </Button>
          <Button
            variant="ghost"
            onClick={() => void saveProjectAs()}
            title="Choose a new .mtproj path. Ctrl+Shift+S / Cmd+Shift+S."
          >
            Save as…
          </Button>
          <Button
            variant="ghost"
            pressed={agentOpen}
            onClick={() => setAgentOpen(!agentOpen)}
            title="Show the AI Copilot in the side panel"
          >
            Copilot
          </Button>
          <Button variant="primary" onClick={() => useSceneStore.getState().setExportOpen(true)}>
            Export
          </Button>
        </div>
      </header>

      {/* Main content: list, insert rail, canvas, docked properties; export/audio/Copilot float */}
      <div className="flex flex-1 min-h-0 relative overflow-hidden">
        {/* Left sidebar: Item list */}
        <aside className="w-64 border-r border-rule bg-panel flex flex-col shrink-0 z-10">
          <ItemList />
          <FramesPanel />
        </aside>

        <div
          className="relative flex min-h-0 shrink-0 border-r border-rule bg-panel"
          style={{ width: insertSidebarWidth }}
        >
          <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
            <AddObjectToolbar
              collapsed={insertCollapsed}
              onToggleCollapsed={toggleInsertCollapsed}
            />
          </div>
          {!insertCollapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize insert sidebar"
              title="Drag to resize insert sidebar"
              onPointerDown={startToolbarWidthResize}
              className="absolute top-0 right-0 bottom-0 w-3 -mr-1.5 z-20 cursor-col-resize flex justify-center touch-none group/seph"
            >
              <span className="h-full w-px bg-rule transition-colors group-hover/seph:bg-highlight/70 group-active/seph:bg-highlight" />
            </div>
          )}
        </div>

        {/* Center: Canvas */}
        <main className="flex-1 min-h-0 relative overflow-hidden flex flex-col min-w-0 p-3">
          <SceneCanvas />
        </main>

        <PropertyPanel />

        {exportOpen && (
          <FloatingPanel title="Export" onClose={() => setExportOpen(false)} defaultSize={{ w: 400, h: 520 }}>
            <ExportPanel />
          </FloatingPanel>
        )}
        {audioMode != null && (
          <FloatingPanel
            title={
              audioMode === 'tts'
                ? 'Text to Speech'
                : audioMode === 'upload'
                  ? 'Upload audio'
                  : 'Record Audio'
            }
            onClose={() => setAudioMode(null)}
            defaultSize={{ w: 360, h: 440 }}
          >
            <AudioPanel mode={audioMode} />
          </FloatingPanel>
        )}
      </div>

      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize timeline"
        title="Drag to resize the timeline"
        className="h-1 w-full shrink-0 cursor-row-resize bg-ink transition-colors hover:bg-highlight/70"
        onPointerDown={startResize}
      />

      {/* Bottom: Timeline */}
      <div className="shrink-0 flex flex-col min-h-0 overflow-hidden" style={{ height: timelineHeight }}>
        <Timeline />
      </div>
    </div>
  );
}
