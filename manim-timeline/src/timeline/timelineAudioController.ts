import { useSceneStore } from '@/store/useSceneStore';
import {
  audioBedPlay,
  audioPlaySegments,
  fadeRampPoints,
  scheduleFrom,
  type AudioPlaySegment,
} from '@/lib/audioSchedule';
import { getAudioContext, loadAudioBuffer } from './audioBuffers';

/*
 * Timeline preview audio through Web Audio, mirroring the export mixdown: every narration clip
 * (overlaps included) at its timeline start with its cut fades and gain, plus the looped
 * background bed. Playback schedules all clips once on the AudioContext clock and restarts when
 * the playhead jumps (seek), drifts, or the audio edit changes.
 */

/** Restart when the playhead and the audio clock disagree by more than this (seek or drift). */
const RESYNC_SEC = 0.2;
/** Scheduling lead so the first clip is not started in the past. */
const LEAD_SEC = 0.03;

interface Session {
  ctx: AudioContext;
  ctxT0: number;
  sceneT0: number;
  nodes: { src: AudioBufferSourceNode; gain: GainNode }[];
  cancelled: boolean;
  /** Inputs the schedule was built from; a change restarts playback. */
  sig: readonly unknown[];
}

let session: Session | null = null;
let rafId: number | null = null;
let storeUnsub: (() => void) | null = null;
let syncWired = false;
let lastIsPlaying = false;

function audioSig(): readonly unknown[] {
  const s = useSceneStore.getState();
  return [s.audioItems, s.audioBed, s.defaults.audioCutFadeMs];
}

function sameSig(a: readonly unknown[], b: readonly unknown[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function stopSession() {
  const s = session;
  session = null;
  if (!s) return;
  s.cancelled = true;
  for (const { src, gain } of s.nodes) {
    try {
      src.stop();
    } catch {
      /* not started yet */
    }
    src.disconnect();
    gain.disconnect();
  }
}

/** Scene time the session's clock is at now. */
function sessionSceneTime(s: Session) {
  return s.sceneT0 + (s.ctx.currentTime - s.ctxT0);
}

function scheduleClip(s: Session, seg: AudioPlaySegment, buf: AudioBuffer) {
  if (s.cancelled) return;
  // Decoding may finish after playback started: begin from where the clock is now.
  const from = Math.max(s.sceneT0, sessionSceneTime(s) + LEAD_SEC);
  const play = scheduleFrom([seg], from)[0];
  if (!play) return;
  const soundStart = s.ctxT0 + (seg.timelineStart + play.clipOffset - s.sceneT0);
  const src = s.ctx.createBufferSource();
  src.buffer = buf;
  const gain = s.ctx.createGain();
  const pts = fadeRampPoints(play);
  gain.gain.setValueAtTime(pts[0]![1] * seg.gain, soundStart);
  for (const [rel, v] of pts.slice(1)) {
    gain.gain.linearRampToValueAtTime(v * seg.gain, soundStart + rel);
  }
  src.connect(gain).connect(s.ctx.destination);
  src.start(soundStart, seg.sourceIn + play.clipOffset, play.length);
  s.nodes.push({ src, gain });
}

function scheduleBed(s: Session, gainValue: number, buf: AudioBuffer) {
  if (s.cancelled || !(buf.duration > 0)) return;
  const from = Math.max(s.sceneT0, sessionSceneTime(s) + LEAD_SEC);
  const src = s.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const gain = s.ctx.createGain();
  gain.gain.setValueAtTime(gainValue, 0);
  src.connect(gain).connect(s.ctx.destination);
  // The export loops the bed from scene time 0.
  src.start(s.ctxT0 + (from - s.sceneT0), from % buf.duration);
  s.nodes.push({ src, gain });
}

function startSession(sceneTime: number) {
  stopSession();
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  const st = useSceneStore.getState();
  const s: Session = {
    ctx,
    ctxT0: ctx.currentTime + LEAD_SEC,
    sceneT0: sceneTime,
    nodes: [],
    cancelled: false,
    sig: audioSig(),
  };
  session = s;
  for (const play of scheduleFrom(audioPlaySegments(st.audioItems, st.defaults), sceneTime)) {
    void loadAudioBuffer(play.seg.url).then((buf) => {
      if (buf) scheduleClip(s, play.seg, buf);
    });
  }
  const bed = audioBedPlay(st.audioBed);
  if (bed) {
    void loadAudioBuffer(bed.url).then((buf) => {
      if (buf) scheduleBed(s, bed.gain, buf);
    });
  }
}

function applySyncFrame() {
  const { currentTime: t, isPlaying } = useSceneStore.getState();
  if (!isPlaying) {
    stopSession();
    return;
  }
  const s = session;
  if (
    !s ||
    !sameSig(s.sig, audioSig()) ||
    // A suspended context has a frozen clock; only judge drift once it runs.
    (s.ctx.state === 'running' && Math.abs(sessionSceneTime(s) - t) > RESYNC_SEC)
  ) {
    startSession(t);
  }
}

function rafLoop() {
  rafId = null;
  if (!useSceneStore.getState().isPlaying) {
    stopSession();
    return;
  }
  applySyncFrame();
  rafId = requestAnimationFrame(rafLoop);
}

function stopRaf() {
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function kickRafIfPlaying() {
  if (useSceneStore.getState().isPlaying && rafId == null) {
    rafId = requestAnimationFrame(rafLoop);
  }
}

/** One immediate sync pass; call from the Play click so the AudioContext resumes inside a user gesture. */
export function kickTimelineAudioSyncNow() {
  getAudioContext()?.resume().catch(() => undefined);
  applySyncFrame();
  kickRafIfPlaying();
}

/** Idempotent: one zustand subscription + one RAF chain for the whole app. */
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
      stopSession();
    }
  });

  kickRafIfPlaying();
}

/** @internal Vitest only */
export function resetTimelineAudioControllerForTests() {
  syncWired = false;
  lastIsPlaying = false;
  storeUnsub?.();
  storeUnsub = null;
  stopRaf();
  stopSession();
}

/** @internal Vitest only — run one sync pass (same body as inside the RAF loop). */
export function runTimelineAudioSyncFrameForTests() {
  applySyncFrame();
}

/** @internal Vitest only */
export function timelineAudioSessionForTests() {
  return session;
}
