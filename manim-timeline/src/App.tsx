import { useState, useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import {
  downloadProjectFile,
  downloadMtprojBundle,
  loadProjectFile,
  MtprojPackError,
  MtprojUnpackError,
} from '@/lib/projectIO';
import type { FragmentTimeMode } from '@/lib/projectFragment';
import { safeSceneClassName } from '@/lib/pythonIdent';
import SceneCanvas from '@/canvas/SceneCanvas';
import Timeline from '@/timeline/Timeline';
import ItemList from '@/panels/ItemList';
import AddObjectToolbar from '@/panels/AddObjectToolbar';
import PropertyPanel from '@/panels/PropertyPanel';
import ExportPanel from '@/panels/ExportPanel';
import AudioPanel from '@/panels/AudioPanel';
import FloatingPanel from '@/components/FloatingPanel';
import AgentPanel from '@/agent/AgentPanel';
import { useAxesPreviewSync } from '@/services/axisPreviewHooks';

const TOOLBAR_WIDTH_STORAGE_KEY = 'manim-timeline-add-toolbar-width';
const DEFAULT_TOOLBAR_WIDTH = 104;
const MIN_TOOLBAR_WIDTH = 64;
const MAX_TOOLBAR_WIDTH = 360;

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

export default function App() {
  const [timelineHeight, setTimelineHeight] = useState(220);
  const [toolbarWidth, setToolbarWidth] = useState(readStoredToolbarWidth);
  const [canvasRect, setCanvasRect] = useState<DOMRect | null>(null);
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
  const toProjectFile = useSceneStore((s) => s.toProjectFile);
  const loadProject = useSceneStore((s) => s.loadProjectFile);
  const importFragment = useSceneStore((s) => s.importFragment);
  const defaults = useSceneStore((s) => s.defaults);
  const setDefaults = useSceneStore((s) => s.setDefaults);

  const handleSave = () => downloadProjectFile(toProjectFile());
  const handleSaveBundle = async () => {
    try {
      await downloadMtprojBundle(toProjectFile());
    } catch (e) {
      if (e instanceof MtprojPackError) {
        const lines = e.failed
          .map((f) => `• ${f.text.slice(0, 40)}${f.text.length > 40 ? '…' : ''} — ${f.reason}`)
          .join('\n');
        window.alert(`${e.message}\n\n${lines}`);
      } else {
        window.alert(e instanceof Error ? e.message : String(e));
      }
    }
  };
  const handleLoad = async () => {
    try {
      const loaded = await loadProjectFile();
      if (!loaded) return;
      if (loaded.kind === 'fragment') {
        const mode = promptFragmentTimeMode();
        if (mode == null) return;
        importFragment(loaded.data, { timeMode: mode });
        return;
      }
      loadProject(loaded.data);
    } catch (e) {
      if (e instanceof MtprojUnpackError) {
        window.alert(e.message);
      }
    }
  };

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-slate-100 overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-2 bg-slate-800 border-b border-slate-700 shrink-0">
        <h1 className="text-sm font-bold tracking-tight text-blue-400 shrink-0">Manim Timeline</h1>
        <label className="flex items-center gap-2 text-xs text-slate-400 shrink-0 max-w-[min(280px,40vw)]">
          <span className="shrink-0">Scene</span>
          <input
            type="text"
            value={defaults.sceneName}
            onChange={(e) => setDefaults({ sceneName: e.target.value })}
            spellCheck={false}
            className="min-w-0 flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-slate-200 font-mono text-xs"
            placeholder="Scene1"
            title="Manim class name in full-file export (sanitized)"
          />
          <span
            className="hidden sm:inline text-slate-500 font-mono truncate max-w-[100px]"
            title="Sanitized Python class"
          >
            → {safeSceneClassName(defaults.sceneName)}
          </span>
        </label>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void handleLoad()}
          className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          title="Open full project or import a selection fragment (.json / .mtproj)"
        >
          Open / import
        </button>
        <button
          onClick={handleSave}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded transition-colors"
          title="JSON only — audio uses blob URLs and will not reopen elsewhere"
        >
          Save project
        </button>
        <button
          type="button"
          onClick={() => void handleSaveBundle()}
          className="px-3 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 rounded transition-colors"
          title="Portable ZIP with embedded audio and checksums"
        >
          Save bundle (.mtproj)
        </button>
        <button
          type="button"
          onClick={() => setAgentOpen(!agentOpen)}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            agentOpen
              ? 'bg-fuchsia-600 hover:bg-fuchsia-500'
              : 'bg-slate-700 hover:bg-slate-600'
          }`}
          title="AI Copilot"
        >
          AI
        </button>
        <button
          type="button"
          onClick={() => useSceneStore.getState().setExportOpen(true)}
          className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors"
        >
          Export
        </button>
      </header>

      {/* Main content: list + canvas + export/audio; properties float over canvas */}
      <div className="flex flex-1 min-h-0 relative overflow-hidden">
        {/* Left sidebar: Item list */}
        <aside className="w-64 border-r border-slate-700 bg-slate-850 flex flex-col shrink-0 z-10">
          <ItemList />
        </aside>

        <div
          className="flex shrink-0 min-h-0 relative border-r border-slate-700 bg-slate-850/95"
          style={{ width: toolbarWidth }}
        >
          <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
            <AddObjectToolbar />
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize add-objects toolbar"
            title="Drag to resize toolbar"
            onPointerDown={startToolbarWidthResize}
            className="absolute top-0 right-0 bottom-0 w-3 -mr-1.5 z-20 cursor-col-resize flex justify-center touch-none group/seph"
          >
            <span className="w-px h-full bg-slate-600 group-hover/seph:bg-blue-400 group-active/seph:bg-blue-300 transition-colors" />
          </div>
        </div>

        {/* Center: Canvas */}
        <main className="flex-1 min-h-0 relative overflow-hidden flex flex-col min-w-0 p-3">
          <SceneCanvas onFrameRectChange={setCanvasRect} />
        </main>

        <PropertyPanel anchorRect={canvasRect} />

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
        {agentOpen && (
          <FloatingPanel
            title="AI Copilot"
            onClose={() => setAgentOpen(false)}
            defaultSize={{ w: 400, h: 560 }}
          >
            <AgentPanel />
          </FloatingPanel>
        )}
      </div>

      <div
        className="h-1 w-full bg-slate-800 hover:bg-blue-500 cursor-row-resize transition-colors shrink-0"
        onPointerDown={startResize}
      />

      {/* Bottom: Timeline */}
      <div className="shrink-0 flex flex-col min-h-0 overflow-hidden" style={{ height: timelineHeight }}>
        <Timeline />
      </div>
    </div>
  );
}
