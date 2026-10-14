import { useMemo, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import NumberInput from '@/components/NumberInput';
import { explicitVisualOwnerForAudioTrack } from '@/lib/audioBinding';
import {
  collectSurgerySpans,
  nextClipStartAfter,
  planCloseRange,
  planInsertTime,
} from '@/lib/timelineSurgery';

type SurgeryMode = 'close' | 'insert';

function fmt(t: number): string {
  return `${t.toFixed(1)}s`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export default function TimelineSurgeryDialog({ onClose }: { onClose: () => void }) {
  const items = useSceneStore((s) => s.items);
  const audioItems = useSceneStore((s) => s.audioItems);
  const currentTime = useSceneStore((s) => s.currentTime);
  const closeTimelineRange = useSceneStore((s) => s.closeTimelineRange);
  const insertEmptyTimelineTime = useSceneStore((s) => s.insertEmptyTimelineTime);

  const [mode, setMode] = useState<SurgeryMode>('close');
  const [closeStart, setCloseStart] = useState(currentTime);
  const [closeEnd, setCloseEnd] = useState(() => {
    const st = useSceneStore.getState();
    const spans = collectSurgerySpans(st.items, st.audioItems);
    return (
      nextClipStartAfter(spans.itemSpans, spans.audioSpans, st.currentTime) ??
      st.currentTime + 5
    );
  });
  const [insertAt, setInsertAt] = useState(currentTime);
  const [insertDuration, setInsertDuration] = useState(2);
  const [applyError, setApplyError] = useState<string | null>(null);

  const { itemSpans, audioSpans } = useMemo(
    () => collectSurgerySpans(items, audioItems),
    [items, audioItems],
  );
  const linkedAudioIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of audioItems) {
      if (explicitVisualOwnerForAudioTrack(items, a.id)) ids.add(a.id);
    }
    return ids;
  }, [items, audioItems]);

  const closePlan = useMemo(
    () => planCloseRange(itemSpans, audioSpans, closeStart, closeEnd),
    [itemSpans, audioSpans, closeStart, closeEnd],
  );
  const insertPlan = useMemo(
    () => planInsertTime(itemSpans, audioSpans, insertAt, insertDuration),
    [itemSpans, audioSpans, insertAt, insertDuration],
  );
  const plan = mode === 'close' ? closePlan : insertPlan;

  const movedVisualCount = plan.itemUpdates.length;
  // Linked tracks ride along with their visual owner instead of moving directly.
  const movedAudioCount = plan.audioUpdates.filter((u) => !linkedAudioIds.has(u.id)).length;

  const nextAfterCloseStart = useMemo(
    () => nextClipStartAfter(itemSpans, audioSpans, closeStart),
    [itemSpans, audioSpans, closeStart],
  );

  const apply = () => {
    const ok =
      mode === 'close'
        ? closeTimelineRange(closeStart, closeEnd)
        : insertEmptyTimelineTime(insertAt, insertDuration);
    if (ok) {
      onClose();
    } else {
      setApplyError('Nothing applied — the timeline changed or the edit is blocked.');
    }
  };

  const tabClass = (active: boolean) =>
    `rounded-ctl px-2.5 py-1 text-meta font-medium transition-colors ${
      active
        ? 'bg-raised text-chalk ring-1 ring-highlight/50 ring-inset'
        : 'bg-raised text-chalk-dim hover:bg-rule'
    }`;

  return (
    <div
      className="absolute left-3 right-3 top-full z-50 mt-1 max-h-[min(320px,55vh)] overflow-y-auto rounded-pop border border-rule bg-ink p-3 text-left shadow-xl"
      role="dialog"
      aria-label="Timeline time edit"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setMode('close')} className={tabClass(mode === 'close')}>
          Close empty range
        </button>
        <button type="button" onClick={() => setMode('insert')} className={tabClass(mode === 'insert')}>
          Insert empty time
        </button>
      </div>

      {mode === 'close' ? (
        <div>
          <p className="mb-2 text-meta leading-snug text-chalk-dim">
            Removes time <span className="text-chalk-dim">[start, end)</span>. Every visual clip
            and narration clip starting at or after <span className="text-chalk-dim">end</span>{' '}
            moves left by <span className="text-chalk-dim">end − start</span>. Only empty time can
            be removed — overlapping clips block the edit. The playhead inside the range jumps to
            its start.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <NumberInput label="Start (s)" value={closeStart} onChange={setCloseStart} min={0} step={0.1} />
            <NumberInput label="End (s)" value={closeEnd} onChange={setCloseEnd} min={0} step={0.1} />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCloseStart(currentTime)}
                className="rounded-ctl bg-raised px-2 py-1 text-meta text-chalk hover:bg-rule"
                title="Set start to the playhead"
              >
                Start = playhead
              </button>
              <button
                type="button"
                disabled={nextAfterCloseStart == null}
                onClick={() => {
                  if (nextAfterCloseStart != null) setCloseEnd(nextAfterCloseStart);
                }}
                className="rounded-ctl bg-raised px-2 py-1 text-meta text-chalk hover:bg-rule disabled:cursor-not-allowed disabled:opacity-40"
                title="Set end to the next clip start after start"
              >
                End = next clip
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <p className="mb-2 text-meta leading-snug text-chalk-dim">
            Opens <span className="text-chalk-dim">duration</span> seconds of empty time at{' '}
            <span className="text-chalk-dim">point</span>. Every visual clip and narration clip
            starting at or after the point moves right. A clip spanning the point blocks the edit.
            The playhead after the point shifts right with the timeline.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <NumberInput label="Point (s)" value={insertAt} onChange={setInsertAt} min={0} step={0.1} />
            <NumberInput label="Duration (s)" value={insertDuration} onChange={setInsertDuration} min={0.1} step={0.5} />
            <button
              type="button"
              onClick={() => setInsertAt(currentTime)}
              className="rounded-ctl bg-raised px-2 py-1 text-meta text-chalk hover:bg-rule"
              title="Set point to the playhead"
            >
              Point = playhead
            </button>
          </div>
        </div>
      )}

      <div className="mt-2 min-h-[20px] text-meta leading-snug">
        {plan.ok ? (
          <p className="text-kind-axes">
            {mode === 'close'
              ? `Will move ${movedVisualCount} visual ${plural(movedVisualCount, 'clip', 'clips')} and ${movedAudioCount} audio ${plural(movedAudioCount, 'clip', 'clips')} left by ${fmt(closePlan.delta)}.`
              : `Will move ${movedVisualCount} visual ${plural(movedVisualCount, 'clip', 'clips')} and ${movedAudioCount} audio ${plural(movedAudioCount, 'clip', 'clips')} right by ${fmt(insertDuration)}.`}{' '}
            <span className="text-chalk-dim">Linked audio follows its visual clip.</span>
          </p>
        ) : (
          <div>
            {plan.error ? <p className="text-warn">{plan.error}</p> : null}
            {plan.blockers.length > 0 ? (
              <ul className="mt-1 max-h-24 list-none overflow-y-auto pl-0 text-chalk-dim">
                {plan.blockers.slice(0, 6).map((b) => (
                  <li key={`${b.kind}-${b.id}`} className="truncate font-mono text-meta">
                    {b.kind === 'item' ? 'Visual' : 'Audio'} · {b.label} · {fmt(b.start)}–{fmt(b.end)}
                  </li>
                ))}
                {plan.blockers.length > 6 ? (
                  <li className="font-mono text-meta text-chalk-dim">
                    …and {plan.blockers.length - 6} more
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        )}
        {applyError ? <p className="mt-1 text-danger">{applyError}</p> : null}
      </div>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={!plan.ok}
          className="bg-highlight font-semibold text-highlight-ink enabled:hover:bg-highlight/90 rounded-ctl px-3 py-1.5 text-ctl disabled:cursor-not-allowed disabled:opacity-40"
        >
          {mode === 'close' ? 'Close range' : 'Insert time'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-ctl bg-raised px-3 py-1.5 text-ctl text-chalk hover:bg-rule"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
