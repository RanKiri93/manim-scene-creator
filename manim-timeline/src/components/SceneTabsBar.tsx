import {
  snapshotEditorToDiskPayload,
  useProjectScenesStore,
} from '@/store/useProjectScenesStore';
import { fingerprintSceneDiskPayload } from '@/lib/sceneFingerprint';

export default function SceneTabsBar() {
  const sceneIds = useProjectScenesStore((s) => s.sceneIds);
  const activeSceneId = useProjectScenesStore((s) => s.activeSceneId);
  const tabs = useProjectScenesStore((s) => s.sceneTabNames);
  const meta = useProjectScenesStore((s) => s.sceneRenderMeta);
  const idle = useProjectScenesStore((s) => s.idleScenes);

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-700 bg-slate-850 px-3 py-1.5 shrink-0">
      <span className="text-[10px] uppercase tracking-wide text-slate-500 shrink-0 mr-1">
        Scenes
      </span>
      {sceneIds.map((id) => {
        const idlePayload = idle[id];
        let liveFingerprint: string;
        if (id === activeSceneId) {
          liveFingerprint = fingerprintSceneDiskPayload(
            snapshotEditorToDiskPayload(),
          );
        } else if (idlePayload) {
          liveFingerprint = fingerprintSceneDiskPayload(idlePayload);
        } else {
          liveFingerprint = '';
        }
        const m = meta[id];
        const lastCached = m?.fingerprint ?? null;
        const hasRenderArtifact = Boolean(m?.renderedAt);
        const synced =
          Boolean(hasRenderArtifact) &&
          lastCached != null &&
          lastCached === liveFingerprint;

        return (
          <button
            key={id}
            type="button"
            onClick={() => void useProjectScenesStore.getState().switchToScene(id)}
            className={`max-w-[160px] truncate rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              activeSceneId === id
                ? 'bg-blue-700 text-blue-50'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title={
              synced
                ? `${tabs[id] ?? id}: last MP4 matches current edits`
                : `${tabs[id] ?? id}: not rendered or stale`
            }
          >
            <span>{tabs[id] ?? 'Scene'}</span>
            <span className={`ml-1 ${synced ? 'text-emerald-300' : 'text-amber-400/80'}`}>●</span>
          </button>
        );
      })}
      <div className="ml-auto flex flex-wrap items-center gap-1 shrink-0">
        <button
          type="button"
          title="Rename active scene tab (Manim class name stays in toolbar above)"
          className="px-2 py-0.5 text-[10px] rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
          onClick={() => {
            const sid = activeSceneId;
            if (!sid) return;
            const v = window.prompt('Scene tab label', tabs[sid] ?? '');
            if (v !== null && v.trim()) {
              useProjectScenesStore.getState().renameSceneTab(sid, v.trim());
            }
          }}
        >
          Rename tab
        </button>
        <button
          type="button"
          className="px-2 py-0.5 text-[10px] rounded bg-emerald-900/70 hover:bg-emerald-800 text-emerald-100"
          onClick={() => void useProjectScenesStore.getState().addScene()}
        >
          + Scene
        </button>
        <button
          type="button"
          disabled={sceneIds.length < 2}
          title="Duplicate active scene"
          className="px-2 py-0.5 text-[10px] rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => {
            const sid = activeSceneId;
            if (sid) useProjectScenesStore.getState().duplicateScene(sid);
          }}
        >
          Duplicate
        </button>
        <button
          type="button"
          disabled={sceneIds.length < 2}
          className="px-2 py-0.5 text-[10px] rounded bg-red-900/70 hover:bg-red-800 text-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => {
            const sid = activeSceneId;
            if (sid && window.confirm('Remove this scene?')) {
              useProjectScenesStore.getState().removeScene(sid);
            }
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
