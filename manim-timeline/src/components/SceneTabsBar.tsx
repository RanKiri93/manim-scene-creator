import {
  snapshotEditorToDiskPayload,
  useProjectScenesStore,
} from '@/store/useProjectScenesStore';
import { fingerprintSceneDiskPayload } from '@/lib/sceneFingerprint';
import { cx } from '@/lib/cx';
import { CloseIcon, DuplicateIcon, IconButton, PencilIcon, PlusIcon, focusRing } from '@/components/ui';

/** Scene tabs and scene actions, rendered inside the app header row. */
export default function SceneTabsBar() {
  const sceneIds = useProjectScenesStore((s) => s.sceneIds);
  const activeSceneId = useProjectScenesStore((s) => s.activeSceneId);
  const tabs = useProjectScenesStore((s) => s.sceneTabNames);
  const meta = useProjectScenesStore((s) => s.sceneRenderMeta);
  const idle = useProjectScenesStore((s) => s.idleScenes);

  return (
    <div className="flex h-full min-w-0 items-stretch">
      <nav aria-label="Scenes" className="flex min-w-0 items-stretch overflow-x-auto">
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
          const active = activeSceneId === id;
          const name = tabs[id] ?? 'Scene';

          return (
            <button
              key={id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => void useProjectScenesStore.getState().switchToScene(id)}
              className={cx(
                '-mb-px flex max-w-[180px] shrink-0 items-center gap-1.5 border-b-2 px-3 text-ctl transition-colors',
                active
                  ? 'border-highlight text-chalk'
                  : 'border-transparent text-chalk-dim hover:text-chalk',
                focusRing,
              )}
              title={
                synced
                  ? `${name}: last MP4 matches current edits`
                  : `${name}: not rendered, or edited since the last render`
              }
            >
              <span className="truncate" dir="auto">{name}</span>
              {synced && (
                <>
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-kind-axes" />
                  <span className="sr-only">(rendered)</span>
                </>
              )}
            </button>
          );
        })}
      </nav>
      <div className="flex shrink-0 items-center gap-0.5 pl-1">
        <IconButton
          size="sm"
          label="Add scene"
          onClick={() => void useProjectScenesStore.getState().addScene()}
        >
          <PlusIcon />
        </IconButton>
        <IconButton
          size="sm"
          label="Rename scene tab"
          title="Rename the active scene tab (the Manim class name is set separately)"
          onClick={() => {
            const sid = activeSceneId;
            if (!sid) return;
            const v = window.prompt('Scene tab label', tabs[sid] ?? '');
            if (v !== null && v.trim()) {
              useProjectScenesStore.getState().renameSceneTab(sid, v.trim());
            }
          }}
        >
          <PencilIcon />
        </IconButton>
        <IconButton
          size="sm"
          label="Duplicate scene"
          disabled={sceneIds.length < 2}
          onClick={() => {
            const sid = activeSceneId;
            if (sid) useProjectScenesStore.getState().duplicateScene(sid);
          }}
        >
          <DuplicateIcon />
        </IconButton>
        <IconButton
          size="sm"
          danger
          label="Remove scene"
          disabled={sceneIds.length < 2}
          onClick={() => {
            const sid = activeSceneId;
            if (sid && window.confirm('Remove this scene?')) {
              useProjectScenesStore.getState().removeScene(sid);
            }
          }}
        >
          <CloseIcon />
        </IconButton>
      </div>
    </div>
  );
}
