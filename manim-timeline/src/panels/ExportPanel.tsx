import { useState, useMemo, useCallback, type ChangeEvent, type FormEvent } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { exportManimCode } from '@/codegen/manimExporter';
import { exportScriptToMarkdown } from '@/codegen/scriptExport';
import { concatMp4Files, renderSceneMp4 } from '@/services/measureClient';
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
  const [mergeFiles, setMergeFiles] = useState<File[]>([]);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

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
        const safeTitle = filename.replace(/[<>&"]/g, '');
        const html =
          '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
          safeTitle +
          '</title></head><body style="margin:0;background:#111">' +
          '<video src="' +
          url +
          '" controls autoplay playsinline ' +
          'style="width:100%;height:100vh;object-fit:contain"></video></body></html>';
        const docUrl = URL.createObjectURL(
          new Blob([html], { type: 'text/html;charset=utf-8' }),
        );
        window.open(docUrl, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(docUrl), 120_000);
        setTimeout(() => URL.revokeObjectURL(url), 120_000);
      } else {
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
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

  const onMergeFilesChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setMergeFiles(Array.from(e.target.files ?? []));
    setMergeError(null);
  }, []);

  const handleMergeMp4s = useCallback(async () => {
    if (mergeFiles.length < 2) return;
    setMerging(true);
    setMergeError(null);
    try {
      const blob = await concatMp4Files(measureUrl, mergeFiles);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'merged.mp4';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : String(err));
    } finally {
      setMerging(false);
    }
  }, [measureUrl, mergeFiles]);

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

      <div className="rounded border border-slate-700 bg-slate-900/50 p-3 flex flex-col gap-2">
        <h4 className="text-xs font-semibold text-slate-200">Merge MP4s</h4>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          Join rendered clips end-to-end. The measure server runs{' '}
          <span className="font-mono text-slate-400">ffmpeg</span> — it must be installed and on{' '}
          <span className="font-mono text-slate-400">PATH</span> for the server process. File order is the order you
          select (same as listed in the file picker).
        </p>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          <span>Videos (.mp4)</span>
          <input
            type="file"
            accept="video/mp4,video/*"
            multiple
            disabled={merging}
            onChange={onMergeFilesChange}
            className="text-[11px] text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-xs"
          />
        </label>
        {mergeFiles.length > 0 && (
          <p className="text-[10px] text-slate-500">
            {mergeFiles.length} file{mergeFiles.length === 1 ? '' : 's'} selected
          </p>
        )}
        {mergeError && (
          <p className="text-[10px] text-red-400 whitespace-pre-wrap break-words max-h-24 overflow-auto">
            {mergeError}
          </p>
        )}
        <button
          type="button"
          onClick={handleMergeMp4s}
          disabled={merging || mergeFiles.length < 2}
          className="self-start px-2 py-1 text-xs bg-indigo-800 hover:bg-indigo-700 disabled:opacity-50 text-slate-100 rounded transition-colors"
        >
          {merging ? 'Merging…' : 'Download merged.mp4'}
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
