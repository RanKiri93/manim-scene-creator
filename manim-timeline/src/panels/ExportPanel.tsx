import { useState, useMemo, useCallback, useEffect, type ChangeEvent, type FormEvent } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import {
  snapshotEditorToDiskPayload,
  useProjectScenesStore,
} from '@/store/useProjectScenesStore';
import { computeSceneDurationSec, exportManimCode } from '@/codegen/manimExporter';
import { exportMultiSceneCombinedPython, type SceneExportInput } from '@/codegen/projectExporter';
import {
  imageNeedsExportPreparation,
  prepareImageItemsForManimExport,
} from '@/lib/imageExportAssets';
import {
  exportAudioScriptToMarkdown,
  exportScriptToMarkdown,
} from '@/codegen/scriptExport';
import {
  concatMp4Files,
  renderSceneMp4,
  type RenderProgress,
} from '@/services/measureClient';
import { prepareSceneMasterAudio } from '@/lib/audioRenderHelpers';
import { safeSceneClassName } from '@/lib/pythonIdent';
import { Field, TextInput } from '@/components/ui';
import type { SceneItem } from '@/types/scene';
import { fingerprintSceneDiskPayload } from '@/lib/sceneFingerprint';
import { graphFollowExportBlock } from '@/lib/exportReadiness';

const RENDER_QUALITIES = [
  { value: 'l', label: 'Low (l)' },
  { value: 'm', label: 'Medium (m)' },
  { value: 'h', label: 'High (h)' },
  { value: 'k', label: '4K (k)' },
] as const;

interface RenderProgressState {
  label: string;
  detail?: string;
  percent: number | null;
}

function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function formatSceneTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** What the measure server says it is doing, in words. */
function describeRenderProgress(p: RenderProgress): string {
  switch (p.phase) {
    case 'starting':
      return 'Starting Manim.';
    case 'building':
      return p.textTotal
        ? `Building text ${Math.min(p.textBuilt ?? 0, p.textTotal)} of ${p.textTotal} (LaTeX).`
        : 'Building text (LaTeX).';
    case 'rendering':
      return p.duration
        ? `Writing frames: ${formatSceneTime(p.sceneTime ?? 0)} of ${formatSceneTime(p.duration)}.`
        : `Writing frames: ${formatSceneTime(p.sceneTime ?? 0)} so far.`;
    case 'combining':
      return 'Joining the rendered parts into one video.';
    case 'audio':
      return 'Adding the mixed audio track.';
    case 'done':
      return 'Sending the video.';
    default:
      return 'Manim is running on the measure server.';
  }
}

/** Map a render's own 0–100 into the `from`..`to` stretch of a bigger progress bar. */
function scaleRenderPercent(p: RenderProgress, from: number, to: number): number | null {
  return p.percent == null ? null : from + ((to - from) * p.percent) / 100;
}

function RenderProgressBar({ progress }: { progress: RenderProgressState }) {
  const percent = progress.percent == null ? null : clampPercent(progress.percent);
  return (
    <div className="rounded-ctl border border-rule bg-ink/70 p-2 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-meta">
        <span className="text-chalk-dim flex-1">{progress.label}</span>
        <span className="text-chalk-faint font-mono">
          {percent == null ? 'working' : `${percent}%`}
        </span>
      </div>
      {progress.detail && (
        <p className="text-meta text-chalk-faint leading-relaxed">{progress.detail}</p>
      )}
      <div className="h-2 rounded-ctl bg-raised overflow-hidden">
        {percent == null ? (
          <div className="h-full w-1/2 rounded-ctl bg-highlight animate-pulse" />
        ) : (
          <div
            className="h-full rounded-ctl bg-highlight transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
    </div>
  );
}

export default function ExportPanel() {
  const itemsMap = useSceneStore((s) => s.items);
  const activeGraphFollowBlock = useSceneStore((s) => s.graphFollowExportBlock());
  const items = useMemo(
    () => Array.from(itemsMap.values()).sort((a: SceneItem, b: SceneItem) => a.startTime - b.startTime || a.layer - b.layer),
    [itemsMap],
  );
  const defaults = useSceneStore((s) => s.defaults);
  const setDefaults = useSceneStore((s) => s.setDefaults);
  const frames = useSceneStore((s) => s.frames);
  const startFrameId = useSceneStore((s) => s.startFrameId);
  const audioItems = useSceneStore((s) => s.audioItems);
  const audioBed = useSceneStore((s) => s.audioBed);
  const measureUrl = useSceneStore((s) => s.measureConfig.url);
  const sceneOrderSig = useProjectScenesStore((s) => s.sceneIds.join('|'));
  const idleScenes = useProjectScenesStore((s) => s.idleScenes);
  const graphFollowBlock = useMemo(() => {
    if (activeGraphFollowBlock) return activeGraphFollowBlock;
    for (const scene of Object.values(idleScenes)) {
      const blocked = graphFollowExportBlock(scene.items);
      if (blocked) return `Another scene: ${blocked}`;
    }
    return null;
  }, [activeGraphFollowBlock, idleScenes]);
  const [fullFile, setFullFile] = useState(true);
  const [copied, setCopied] = useState(false);
  const [renderModalOpen, setRenderModalOpen] = useState(false);
  const [renderQuality, setRenderQuality] = useState<string>('m');
  const [openAfterRender, setOpenAfterRender] = useState(false);
  const [renderSceneName, setRenderSceneName] = useState('');
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState<RenderProgressState | null>(null);
  const [mergeFiles, setMergeFiles] = useState<File[]>([]);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [renderAllBusy, setRenderAllBusy] = useState(false);
  const [renderAllErr, setRenderAllErr] = useState<string | null>(null);
  const [renderAllProgress, setRenderAllProgress] = useState<RenderProgressState | null>(null);

  // Live `blob:`/`http(s):` images cannot go straight into Manim Python
  // (codegen only accepts bundle paths or embedded data URLs), so prepare an
  // export-only snapshot with those bytes inlined as data URLs. The store and
  // persisted project are never touched — preparation clones items.
  const [preparedExports, setPreparedExports] = useState<{
    single: SceneItem[];
    multi: SceneExportInput[];
  } | null>(null);
  const [needsImagePrep, setNeedsImagePrep] = useState(false);
  const [preparingImages, setPreparingImages] = useState(false);
  const [imagePrepError, setImagePrepError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ps = useProjectScenesStore.getState();
    ps.persistActiveIntoIdle();
    const file = ps.toMultiSceneProjectFile();
    const needsWork =
      items.some(imageNeedsExportPreparation) ||
      file.scenes.some((sc) => (sc.items ?? []).some(imageNeedsExportPreparation));
    setNeedsImagePrep(needsWork);
    if (!needsWork) {
      setPreparedExports(null);
      setImagePrepError(null);
      setPreparingImages(false);
      return;
    }
    // Retain previous code until the new snapshot is ready.
    setPreparingImages(true);
    void (async () => {
      try {
        const single = await prepareImageItemsForManimExport(items);
        // Re-run if scene tabs changed mid-prep; that effect run owns the update.
        const sig = sceneOrderSig;
        const multi: SceneExportInput[] = [];
        for (const sc of file.scenes) {
          multi.push({
            items: await prepareImageItemsForManimExport(sc.items ?? []),
            defaults: sc.defaults,
            frames: sc.frames,
            startFrameId: sc.startFrameId,
            audioItems: sc.audioItems,
          });
        }
        if (cancelled) return;
        if (useProjectScenesStore.getState().sceneIds.join('|') !== sig) return;
        setPreparedExports({ single, multi });
        setImagePrepError(null);
      } catch (e) {
        if (cancelled) return;
        setPreparedExports(null);
        setImagePrepError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setPreparingImages(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items, sceneOrderSig]);

  const code = useMemo(() => {
    if (graphFollowBlock) return `# EXPORT ERROR: ${graphFollowBlock}\n`;
    if (imagePrepError) return `# EXPORT ERROR: ${imagePrepError}\n`;
    if (needsImagePrep && !preparedExports) return '# Preparing image assets for export…\n';
    return exportManimCode(preparedExports?.single ?? items, { fullFile, defaults, frames, startFrameId, audioItems });
  }, [preparedExports, imagePrepError, needsImagePrep, items, fullFile, defaults, frames, startFrameId, audioItems, graphFollowBlock]);

  const codeFullFile = useMemo(() => {
    if (graphFollowBlock) return `# EXPORT ERROR: ${graphFollowBlock}\n`;
    if (imagePrepError) return `# EXPORT ERROR: ${imagePrepError}\n`;
    if (needsImagePrep && !preparedExports) return '# Preparing image assets for export…\n';
    return exportManimCode(preparedExports?.single ?? items, { fullFile: true, defaults, frames, startFrameId, audioItems });
  }, [preparedExports, imagePrepError, needsImagePrep, items, defaults, frames, startFrameId, audioItems, graphFollowBlock]);

  const combinedPython = useMemo(() => {
    // Read via `void` so scene-tab add/remove/rename recomputes this memo even
    // though the multi-scene file itself is read from the store below.
    void sceneOrderSig;
    if (graphFollowBlock) return `from manim import *\n\n# COMBINED EXPORT ERROR: ${graphFollowBlock}\n`;
    if (imagePrepError) {
      return `from manim import *\n\n# COMBINED EXPORT ERROR: ${imagePrepError}\n`;
    }
    if (needsImagePrep && !preparedExports) {
      return 'from manim import *\n\n# Preparing image assets for export…\n';
    }
    try {
      if (preparedExports) return exportMultiSceneCombinedPython(preparedExports.multi);
      useProjectScenesStore.getState().persistActiveIntoIdle();
      const file = useProjectScenesStore.getState().toMultiSceneProjectFile();
      return exportMultiSceneCombinedPython(
        file.scenes.map((sc) => ({
          items: sc.items,
          defaults: sc.defaults,
          frames: sc.frames,
          startFrameId: sc.startFrameId,
          audioItems: sc.audioItems,
        })),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `from manim import *\n\n# COMBINED EXPORT ERROR: ${msg}\n`;
    }
  }, [preparedExports, imagePrepError, needsImagePrep, sceneOrderSig, graphFollowBlock]);

  const openRenderModal = useCallback(() => {
    if (graphFollowBlock) return;
    setRenderSceneName(safeSceneClassName(defaults.sceneName ?? ''));
    setRenderError(null);
    setRenderProgress(null);
    setRenderModalOpen(true);
  }, [defaults.sceneName, graphFollowBlock]);

  const handleRenderSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (graphFollowBlock) { setRenderError(graphFollowBlock); return; }
    setRenderError(null);
    setRendering(true);
    const scene = safeSceneClassName(renderSceneName);
    const filename = `${scene}.mp4`;
    try {
      setRenderProgress({
        label: 'Syncing audio assets',
        detail: 'Preparing any local audio files Manim needs for this scene.',
        percent: 8,
      });
      let masterPath: string | null = null;
      setRenderProgress({
        label: 'Preparing audio for export',
        detail: 'Syncing assets and building mixdown when bed or cut fades are enabled.',
        percent: 10,
      });
      masterPath = await prepareSceneMasterAudio(measureUrl, {
        items,
        defaults,
        frames,
        startFrameId,
        audioItems,
        audioBed,
      });
      setRenderProgress({
        label: `Rendering ${scene}`,
        detail: 'Starting Manim.',
        percent: 12,
      });
      const blob = await renderSceneMp4(
        measureUrl,
        codeFullFile,
        renderQuality,
        scene,
        masterPath,
        {
          expectedDurationSec: computeSceneDurationSec(preparedExports?.single ?? items, {
            audioItems,
            frames,
            startFrameId,
          }),
          onProgress: (p) =>
            setRenderProgress({
              label: `Rendering ${scene}`,
              detail: describeRenderProgress(p),
              percent: scaleRenderPercent(p, 12, 95),
            }),
        },
      );
      setRenderProgress({
        label: 'Preparing MP4 download',
        percent: 95,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      const ps = useProjectScenesStore.getState();
      const sid = ps.activeSceneId;
      if (sid) {
        ps.updateRenderMeta(sid, {
          fingerprint: fingerprintSceneDiskPayload(
            snapshotEditorToDiskPayload(),
          ),
          quality: renderQuality,
          renderedAt: new Date().toISOString(),
          error: null,
        });
      }
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
      setRenderProgress({
        label: 'Render complete',
        percent: 100,
      });
      setRenderModalOpen(false);
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : String(err));
      setRenderProgress({
        label: 'Render failed',
        percent: 100,
      });
    } finally {
      setRendering(false);
    }
  };

  const handleCopy = async () => {
    if (graphFollowBlock) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownloadScript = () => {
    exportScriptToMarkdown({ items: useSceneStore.getState().items });
  };

  const handleDownloadAudioScript = () => {
    const s = useSceneStore.getState();
    exportAudioScriptToMarkdown({
      items: s.items,
      audioItems: s.audioItems,
    });
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

  const renderFullProjectSequential = useCallback(async () => {
    if (graphFollowBlock) { setRenderAllErr(graphFollowBlock); return; }
    setRenderAllBusy(true);
    setRenderAllErr(null);
    setRenderAllProgress({
      label: 'Preparing project render',
      detail: 'Collecting scene tabs and export settings.',
      percent: 3,
    });
    try {
      const ps = useProjectScenesStore.getState();
      ps.persistActiveIntoIdle();
      const file = ps.toMultiSceneProjectFile();
      const blobs: Blob[] = [];
      const nowIso = new Date().toISOString();
      const totalScenes = Math.max(1, file.scenes.length);

      for (const [index, sc] of file.scenes.entries()) {
        const sceneNo = index + 1;
        const klass = safeSceneClassName(sc.defaults.sceneName ?? '');
        const sceneBasePercent = 5 + (index / totalScenes) * 80;
        setRenderAllProgress({
          label: `Syncing audio for scene ${sceneNo} of ${totalScenes}`,
          detail: klass,
          percent: sceneBasePercent,
        });
        let masterPath: string | null = null;
        // Inline live `blob:`/`http(s):` images as export-only data URLs so
        // each scene's Python matches the Export panel preview.
        let preparedSceneItems: SceneItem[] = sc.items ?? [];
        setRenderAllProgress({
          label: `Preparing image assets for scene ${sceneNo} of ${totalScenes}`,
          detail: klass,
          percent: sceneBasePercent,
        });
        preparedSceneItems = await prepareImageItemsForManimExport(sc.items ?? []);
        masterPath = await prepareSceneMasterAudio(measureUrl, {
          items: preparedSceneItems,
          defaults: sc.defaults,
          frames: sc.frames,
          startFrameId: sc.startFrameId,
          audioItems: sc.audioItems ?? [],
          audioBed: sc.audioBed,
        });
        const py = exportManimCode(preparedSceneItems, {
          fullFile: true,
          defaults: sc.defaults,
          frames: sc.frames,
          startFrameId: sc.startFrameId,
          audioItems: sc.audioItems,
        });
        const sceneSpan = 80 / totalScenes;
        const renderFrom = sceneBasePercent + sceneSpan * 0.1;
        setRenderAllProgress({
          label: `Rendering scene ${sceneNo} of ${totalScenes}`,
          detail: `${klass}: starting Manim.`,
          percent: renderFrom,
        });
        blobs.push(
          await renderSceneMp4(measureUrl, py, renderQuality, klass, masterPath, {
            expectedDurationSec: computeSceneDurationSec(preparedSceneItems, {
              audioItems: sc.audioItems,
              frames: sc.frames,
              startFrameId: sc.startFrameId,
            }),
            onProgress: (p) =>
              setRenderAllProgress({
                label: `Rendering scene ${sceneNo} of ${totalScenes}`,
                detail: `${klass}: ${describeRenderProgress(p)}`,
                percent: scaleRenderPercent(p, renderFrom, sceneBasePercent + sceneSpan),
              }),
          }),
        );
        setRenderAllProgress({
          label: `Finished scene ${sceneNo} of ${totalScenes}`,
          detail: klass,
          percent: 5 + (sceneNo / totalScenes) * 80,
        });
        ps.updateRenderMeta(sc.id, {
          fingerprint: fingerprintSceneDiskPayload({
            defaults: sc.defaults,
            frames: sc.frames,
            startFrameId: sc.startFrameId,
            items: sc.items,
            audioItems: sc.audioItems,
          }),
          quality: renderQuality,
          renderedAt: nowIso,
          error: null,
        });
      }

      let combined: Blob;
      if (blobs.length === 1) {
        combined = blobs[0]!;
      } else {
        setRenderAllProgress({
          label: 'Merging rendered scenes',
          detail: 'Joining the individual MP4 files into one project video.',
          percent: 90,
        });
        const mp4Files = blobs.map(
          (b, i) => new File([b], `scene_${i}.mp4`, { type: 'video/mp4' }),
        );
        combined = await concatMp4Files(measureUrl, mp4Files);
      }

      setRenderAllProgress({
        label: 'Preparing full project download',
        percent: 97,
      });
      const url = URL.createObjectURL(combined);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'full_project.mp4';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
      setRenderAllProgress({
        label: 'Full project render complete',
        percent: 100,
      });
    } catch (err) {
      setRenderAllErr(err instanceof Error ? err.message : String(err));
      setRenderAllProgress({
        label: 'Full project render failed',
        percent: 100,
      });
    } finally {
      setRenderAllBusy(false);
    }
  }, [measureUrl, renderQuality, graphFollowBlock]);

  return (
    <div className="flex flex-col gap-2">
      <Field
        label="Manim class for this scene"
        hint={`Exported as class ${safeSceneClassName(defaults.sceneName ?? '')}.`}
        className="mb-2"
      >
        <TextInput
          code
          size="sm"
          value={defaults.sceneName}
          onChange={(e) => setDefaults({ sceneName: e.target.value })}
          placeholder="Scene1"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2 [&>button]:whitespace-nowrap">
        <h3 className="m-0 w-full font-display text-title font-medium text-chalk">Manim code</h3>
        <label className="flex items-center gap-1 text-ctl text-chalk-dim cursor-pointer">
          <input
            type="checkbox"
            checked={fullFile}
            onChange={(e) => setFullFile(e.target.checked)}
            className="accent-highlight"
          />
          Full file
        </label>
        <button
          type="button"
          onClick={handleDownloadScript}
          className="px-2 py-1 text-ctl bg-raised hover:bg-rule text-chalk rounded-ctl transition-colors"
        >
          Download Script (.md)
        </button>
        <button
          type="button"
          onClick={handleDownloadAudioScript}
          className="px-2 py-1 text-ctl bg-raised hover:bg-rule text-chalk rounded-ctl transition-colors"
        >
          Download Audio Script (.md)
        </button>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!!graphFollowBlock}
          title={graphFollowBlock ?? 'Copy generated Manim code'}
          className="px-2 py-1 text-ctl bg-raised hover:bg-rule disabled:opacity-50 disabled:cursor-not-allowed text-chalk rounded-ctl transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={openRenderModal}
          disabled={rendering || preparingImages || !!graphFollowBlock}
          className="bg-highlight font-semibold text-highlight-ink enabled:hover:bg-highlight/90 px-2 py-1 text-ctl disabled:opacity-50 rounded-ctl transition-colors"
          title={preparingImages ? 'Preparing image assets for export…' : undefined}
        >
          {preparingImages ? 'Preparing images…' : 'Render MP4'}
        </button>
      </div>
      {graphFollowBlock && <p className="text-meta text-warn" role="alert">{graphFollowBlock}</p>}
      {preparingImages && (
        <p className="text-meta text-chalk-faint" role="status">
          Preparing image assets for export…
        </p>
      )}
      {imagePrepError && (
        <p className="text-meta text-danger whitespace-pre-wrap break-words">
          Image export preparation failed: {imagePrepError}
        </p>
      )}

      <div className="rounded-ctl border border-rule bg-ink/50 p-3 flex flex-col gap-2">
        <h4 className="text-ctl font-semibold text-chalk">Multi-scene render</h4>
        <p className="text-meta text-chalk-faint leading-relaxed">
          Renders each scene tab in order, then merges MP4s via the measure server. Quality matches the Render MP4 modal
          (default medium until changed).
        </p>
        <button
          type="button"
          onClick={() => void renderFullProjectSequential()}
          disabled={renderAllBusy || rendering}
          className="self-start px-2 py-1 text-ctl bg-raised hover:bg-rule disabled:opacity-50 text-chalk rounded-ctl transition-colors"
        >
          {renderAllBusy ? 'Rendering all…' : 'Render all scenes → full_project.mp4'}
        </button>
        {renderAllProgress && <RenderProgressBar progress={renderAllProgress} />}
        {renderAllErr && (
          <p className="text-meta text-danger whitespace-pre-wrap break-words max-h-24 overflow-auto">
            {renderAllErr}
          </p>
        )}
      </div>

      <details className="rounded-ctl border border-rule bg-ink/40 p-2">
        <summary className="cursor-pointer text-ctl text-chalk-dim select-none">
          Combined Python export (all scenes, one file)
        </summary>
        <pre className="mt-2 bg-ink border border-rule rounded-ctl p-2 text-meta text-chalk-dim font-mono overflow-auto max-h-[30vh] whitespace-pre">
          {combinedPython}
        </pre>
      </details>

      <div className="rounded-ctl border border-rule bg-ink/50 p-3 flex flex-col gap-2">
        <h4 className="text-ctl font-semibold text-chalk">Merge MP4s</h4>
        <p className="text-meta text-chalk-faint leading-relaxed">
          Join rendered clips end-to-end. The measure server runs{' '}
          <span className="font-mono text-chalk-dim">ffmpeg</span> — it must be installed and on{' '}
          <span className="font-mono text-chalk-dim">PATH</span> for the server process. File order is the order you
          select (same as listed in the file picker).
        </p>
        <label className="flex flex-col gap-1 text-ctl text-chalk-dim">
          <span>Videos (.mp4)</span>
          <input
            type="file"
            accept="video/mp4,video/*"
            multiple
            disabled={merging}
            onChange={onMergeFilesChange}
            className="text-meta text-chalk-dim file:mr-2 file:rounded-ctl file:border-0 file:bg-raised file:px-2 file:py-1 file:text-ctl"
          />
        </label>
        {mergeFiles.length > 0 && (
          <p className="text-meta text-chalk-faint">
            {mergeFiles.length} file{mergeFiles.length === 1 ? '' : 's'} selected
          </p>
        )}
        {mergeError && (
          <p className="text-meta text-danger whitespace-pre-wrap break-words max-h-24 overflow-auto">
            {mergeError}
          </p>
        )}
        <button
          type="button"
          onClick={handleMergeMp4s}
          disabled={merging || mergeFiles.length < 2}
          className="self-start px-2 py-1 text-ctl bg-raised hover:bg-rule disabled:opacity-50 text-chalk rounded-ctl transition-colors"
        >
          {merging ? 'Merging…' : 'Download merged.mp4'}
        </button>
      </div>

      {renderModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
          role="presentation"
          onClick={() => !rendering && setRenderModalOpen(false)}
        >
          <form
            className="bg-ink border border-rule rounded-pop p-4 w-full max-w-md shadow-xl flex flex-col gap-3"
            role="dialog"
            aria-labelledby="render-mp4-title"
            onClick={(ev) => ev.stopPropagation()}
            onSubmit={handleRenderSubmit}
          >
            <h4 id="render-mp4-title" className="text-body font-semibold text-chalk">
              Render MP4 (measure server)
            </h4>
            <p className="text-ctl text-chalk-dim">
              Uses <span className="font-mono text-chalk-dim">{measureUrl}</span> — full-file export is sent to Manim.
            </p>
            <label className="flex flex-col gap-1 text-ctl text-chalk-dim">
              Scene class name
              <input
                type="text"
                value={renderSceneName}
                onChange={(e) => setRenderSceneName(e.target.value)}
                disabled={rendering}
                className="bg-ink border border-rule rounded-ctl px-2 py-1 text-chalk font-mono"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-ctl text-chalk-dim">
              Quality
              <select
                value={renderQuality}
                onChange={(e) => setRenderQuality(e.target.value)}
                disabled={rendering}
                className="bg-ink border border-rule rounded-ctl px-2 py-1 text-chalk"
              >
                {RENDER_QUALITIES.map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-ctl text-chalk-dim cursor-pointer">
              <input
                type="checkbox"
                checked={openAfterRender}
                onChange={(e) => setOpenAfterRender(e.target.checked)}
                disabled={rendering}
                className="accent-highlight"
              />
              Open file after render? (new tab)
            </label>
            {renderError && (
              <p className="text-ctl text-danger whitespace-pre-wrap break-words max-h-32 overflow-auto">
                {renderError}
              </p>
            )}
            {renderProgress && <RenderProgressBar progress={renderProgress} />}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => !rendering && setRenderModalOpen(false)}
                className="px-3 py-1 text-ctl bg-raised hover:bg-rule text-chalk rounded-ctl"
                disabled={rendering}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={rendering}
                className="bg-highlight font-semibold text-highlight-ink enabled:hover:bg-highlight/90 px-3 py-1 text-ctl disabled:opacity-50 rounded-ctl"
              >
                {rendering ? 'Rendering…' : 'Start render'}
              </button>
            </div>
          </form>
        </div>
      )}

      <pre className="bg-ink border border-rule rounded-ctl p-3 text-ctl text-chalk-dim font-mono overflow-auto max-h-[50vh] whitespace-pre">
        {code || '# Add items to see generated code.'}
      </pre>
    </div>
  );
}
