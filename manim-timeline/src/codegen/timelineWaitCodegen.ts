/**
 * Absolute timeline waits for the playback section.
 *
 * Manim rounds every `play`/`wait` to whole frames. Relative `self.wait(Δ)` calls computed from
 * the exporter's modelled clock let that rounding accumulate over a scene (measured: +0.1 s by
 * 18 s at 15 fps), which shows up as picture drifting behind the timeline-placed mixdown audio.
 * Waiting *until* an absolute scene time keeps every timeline event within about one frame.
 */

export const TIMELINE_WAIT_HELPER_NAME = '_wait_to';

/**
 * Module-level helper; Manim's own `Scene.wait_until` waits on a condition, not a time.
 * Comments instead of a docstring: multi-scene export merges headers line by line
 * (`combineMultiScenePythonExports`), which would drop a bare `"""` line seen earlier.
 */
export function timelineWaitHelperSource(): string {
  return (
    `def ${TIMELINE_WAIT_HELPER_NAME}(scene, t):\n` +
    `    # Wait until absolute scene time t (timeline seconds). Absolute targets stop\n` +
    `    # Manim's per-animation frame rounding from accumulating across the scene.\n` +
    `    frames = round((t - scene.time) * config.frame_rate)\n` +
    `    if frames > 0:\n` +
    `        # Static waits floor to whole frames; half a frame of headroom lands exactly.\n` +
    `        scene.wait((frames + 0.5) / config.frame_rate)\n`
  );
}

/** One playback line that waits until absolute timeline second `t`. */
export function timelineWaitLine(pad: string, t: number): string {
  return `${pad}${TIMELINE_WAIT_HELPER_NAME}(self, ${t.toFixed(4)})\n`;
}
