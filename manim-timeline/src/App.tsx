import { useState, useCallback } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { downloadProjectFile, loadProjectFile } from '@/lib/projectIO';
import { safeSceneClassName } from '@/lib/pythonIdent';
import SceneCanvas from '@/canvas/SceneCanvas';
import Timeline from '@/timeline/Timeline';
import ItemList from '@/panels/ItemList';
import PropertyPanel from '@/panels/PropertyPanel';
import ExportPanel from '@/panels/ExportPanel';
import AudioPanel from '@/panels/AudioPanel';
import FloatingPanel from '@/components/FloatingPanel';

export default function App() {
  const [timelineHeight, setTimelineHeight] = useState(220);
  const exportOpen = useSceneStore((s) => s.exportOpen);
  const setExportOpen = useSceneStore((s) => s.setExportOpen);
  const audioMode = useSceneStore((s) => s.audioMode);
  const setAudioMode = useSceneStore((s) => s.setAudioMode);

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
  const toProjectFile = useSceneStore((s) => s.toProjectFile);
  const loadProject = useSceneStore((s) => s.loadProjectFile);
  const defaults = useSceneStore((s) => s.defaults);
  const setDefaults = useSceneStore((s) => s.setDefaults);

  const handleSave = () => downloadProjectFile(toProjectFile());
  const handleLoad = async () => {
    const f = await loadProjectFile();
    if (f) loadProject(f);
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
          onClick={handleLoad}
          className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors"
        >
          Open project
        </button>
        <button
          onClick={handleSave}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded transition-colors"
        >
          Save project
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
