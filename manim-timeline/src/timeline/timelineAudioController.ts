import { useSceneStore } from '@/store/useSceneStore';
import type { AudioTrackItem } from '@/types/scene';

const DRIFT_SEC = 0.35;

/**
 * Single timeline preview element. Overlapping audio clips (or duplicate tracks) must not
 * each call `play()` — that stacks multiple decoders and sounds like “the same audio twice”.
 */
let sharedEl: HTMLAudioElement | null = null;

let rafId: number | null = null;
let storeUnsub: (() => void) | null = null;
let syncWired = false;
let lastIsPlaying = false;

function stopRaf() {
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function getSharedElement(): HTMLAudioElement {
  if (!sharedEl) {
    sharedEl = document.createElement('audio');
    sharedEl.preload = 'auto';
  }
  return sharedEl;
}

/** At most one track at the playhead: earliest `startTime`, then `id` for stability. */
export function pickActiveAudioTrackAtTime(
  t: number,
  tracks: readonly AudioTrackItem[],
): AudioTrackItem | null {
  const active = tracks.filter((tr) => {
    const rel = t - tr.startTime;
    return rel >= 0 && rel < tr.duration;
  });
  if (active.length === 0) return null;
  active.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  return active[0] ?? null;
}

function applySyncFrame() {
  const { currentTime: t, audioItems: tracks, isPlaying } = useSceneStore.getState();
  const el = getSharedElement();

  if (!isPlaying) {
    el.pause();
    return;
  }

  const track = pickActiveAudioTrackAtTime(t, tracks);
  if (!track) {
    el.pause();
    return;
  }

  const url = track.audioUrl;
  const rel = t - track.startTime;
  const key = `${track.id}|${url}`;

  if (url && el.dataset.mtTimelineKey !== key) {
    el.dataset.mtTimelineKey = key;
    el.pause();
    el.src = url;
    el.load();
  }

  if (Math.abs(el.currentTime - rel) > DRIFT_SEC) {
    try {
      el.currentTime = rel;
    } catch {
      /* ignore */
    }
  }
  if (el.paused) {
    void el.play().catch(() => {
      /* autoplay policy / decode */
    });
  }
}

function rafLoop() {
  rafId = null;
  const playing = useSceneStore.getState().isPlaying;
  if (!playing) {
    sharedEl?.pause();
    return;
  }
  applySyncFrame();
  rafId = requestAnimationFrame(rafLoop);
}

function kickRafIfPlaying() {
  const playing = useSceneStore.getState().isPlaying;
  if (playing && rafId == null) {
    rafId = requestAnimationFrame(rafLoop);
  }
}

/**
 * Idempotent: one zustand subscription + one RAF chain for the whole app.
 * Call from a root timeline hook once per app mount.
 */
export function ensureTimelineAudioSyncWired() {
  if (syncWired) return;
  syncWired = true;
  lastIsPlaying = useSceneStore.getState().isPlaying;

  storeUnsub = useSceneStore.subscribe((state) => {
    const playing = state.isPlaying;
    if (playing === lastIsPlaying) return;
    lastIsPlaying = playing;
    if (playing) {
      kickRafIfPlaying();
    } else {
      stopRaf();
      sharedEl?.pause();
    }
  });

  kickRafIfPlaying();
}

/** Kept for API compatibility; single element is reused (no per-id pool). */
export function pruneTimelineAudioPool(_tracks: AudioTrackItem[]) {
  /* no-op: active track selection uses current store state each frame */
}

/** @internal Vitest only */
export function resetTimelineAudioControllerForTests() {
  syncWired = false;
  lastIsPlaying = false;
  storeUnsub?.();
  storeUnsub = null;
  stopRaf();
  if (sharedEl) {
    sharedEl.pause();
    sharedEl.removeAttribute('src');
    sharedEl.removeAttribute('data-mt-timeline-key');
    sharedEl.load();
  }
  sharedEl = null;
}

/** @internal Vitest only */
export function timelineAudioPoolSizeForTests() {
  return sharedEl ? 1 : 0;
}

/** @internal Vitest only */
export function timelineAudioRafScheduledForTests() {
  return rafId != null;
}

/** @internal Vitest only — run one sync pass (same body as inside the RAF loop). */
export function runTimelineAudioSyncFrameForTests() {
  applySyncFrame();
}
