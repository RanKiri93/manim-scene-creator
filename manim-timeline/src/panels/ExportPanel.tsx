import { useState, useMemo, useCallback, type FormEvent } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { exportManimCode } from '@/codegen/manimExporter';
import { exportScriptToMarkdown } from '@/codegen/scriptExport';
import { renderSceneMp4 } from '@/services/measureClient';
import { safeSceneClassName } from '@/lib/pythonIdent';
import type { SceneItem } from '@/types/scene';

const RENDER_QUALITIES = [
  { value: 'l', label: 'Low (l)' },
  { value: 'm', label: 'Medium (m)' },
  { value: 'h', label: 'High (h)' },
  { value: 'k', label: '4K (k)' },
] as const;

export default function ExportPanel() {
  const itemsMap = useSceneStore((s) => s.items);
  const items = useMemo(
    () => Array.from(itemsMap.values()).sort((a: SceneItem, b: SceneItem) => a.startTime - b.startTime || a.layer - b.layer),
    [itemsMap],
  );
  const defaults = useSceneStore((s) => s.defaults);
  const audioItems = useSceneStore((s) => s.audioItems);
  const measureUrl = useSceneStore((s) => s.measureConfig.url);
  const [fullFile, setFullFile] = useState(true);
  const [copied, setCopied] = useState(false);
  const [renderModalOpen, setRenderModalOpen] = useState(false);
  const [renderQuality, setRenderQuality] = useState<string>('m');
  const [openAfterRender, setOpenAfterRender] = useState(false);
  const [renderSceneName, setRenderSceneName] = useState('');
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const code = useMemo(
    () => exportManimCode(items, { fullFile, defaults, audioItems }),
    [items, fullFile, defaults, audioItems],
  );

  const codeFullFile = useMemo(
    () => exportManimCode(items, { fullFile: true, defaults, audioItems }),
    [items, defaults, audioItems],
  );

  const openRenderModal = useCallback(() => {
    setRenderSceneName(safeSceneClassName(defaults.sceneName ?? ''));
    setRenderError(null);
    setRenderModalOpen(true);
  }, [defaults.sceneName]);

  const handleRenderSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setRenderError(null);
    setRendering(true);
    const scene = safeSceneClassName(renderSceneName);
    const filename = `${scene}.mp4`;
    try {
      const blob = await renderSceneMp4(measureUrl, codeFullFile, renderQuality, scene);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (openAfterRender) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setRenderModalOpen(false);
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownloadScript = () => {
    exportScriptToMarkdown({ items: useSceneStore.getState().items });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-200 flex-1">Manim Export</h3>
        <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={fullFile}
            onChange={(e) => setFullFile(e.target.checked)}
            className="accent-blue-500"
          />
          Full file
        </label>
        <button
          type="button"
          onClick={handleDownloadScript}
          className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
        >
          Download Script (.md)
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={openRenderModal}
          disabled={rendering}
          className="px-2 py-1 text-xs bg-emerald-800 hover:bg-emerald-700 disabled:opacity-50 text-slate-100 rounded transition-colors"
        >
          Render MP4
        </button>
      </div>

      {renderModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="presentation"
          onClick={() => !rendering && setRenderModalOpen(false)}
        >
          <form
            className="bg-slate-900 border border-slate-600 rounded-lg p-4 w-full max-w-md shadow-xl flex flex-col gap-3"
            role="dialog"
            aria-labelledby="render-mp4-title"
            onClick={(ev) => ev.stopPropagation()}
            onSubmit={handleRenderSubmit}
          >
            <h4 id="render-mp4-title" className="text-sm font-semibold text-slate-100">
              Render MP4 (measure server)
            </h4>
            <p className="text-xs text-slate-400">
              Uses <span className="font-mono text-slate-300">{measureUrl}</span> — full-file export is sent to Manim.
            </p>
            <label className="flex flex-col gap-1 text-xs text-slate-300">
              Scene class name
              <input
                type="text"
                value={renderSceneName}
                onChange={(e) => setRenderSceneName(e.target.value)}
                disabled={rendering}
                className="bg-slate-950 border border-slate-600 rounded px-2 py-1 text-slate-200 font-mono"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-300">
              Quality
              <select
                value={renderQuality}
                onChange={(e) => setRenderQuality(e.target.value)}
                disabled={rendering}
                className="bg-slate-950 border border-slate-600 rounded px-2 py-1 text-slate-200"
              >
                {RENDER_QUALITIES.map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={openAfterRender}
                onChange={(e) => setOpenAfterRender(e.target.checked)}
                disabled={rendering}
                className="accent-blue-500"
              />
              Open file after render? (new tab)
            </label>
            {renderError && (
              <p className="text-xs text-red-400 whitespace-pre-wrap break-words max-h-32 overflow-auto">
                {renderError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => !rendering && setRenderModalOpen(false)}
                className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded"
                disabled={rendering}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={rendering}
                className="px-3 py-1 text-xs bg-emerald-800 hover:bg-emerald-700 disabled:opacity-50 text-slate-100 rounded"
              >
                {rendering ? 'Rendering…' : 'Start render'}
              </button>
            </div>
          </form>
        </div>
      )}

      <pre className="bg-slate-950 border border-slate-700 rounded p-3 text-xs text-slate-300 font-mono overflow-auto max-h-[50vh] whitespace-pre">
        {code || '# Add items to see generated code.'}
      </pre>
    </div>
  );
}
