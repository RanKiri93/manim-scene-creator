"""Run the Manim CLI and report render progress on stderr.

``python -m manim_progress render scene.py Scene -ql`` behaves like ``python -m manim render ...``
and also prints machine-readable lines that the measure server reads to show a progress bar:

- ``@@MT_BUILT <n>``: *n* ``HebrewMathLine`` objects built so far (each one compiles TeX, which is
  most of the time before the first frame).
- ``@@MT_PROGRESS <seconds>``: scene time written so far (every frame batch, at most 5 per second).
- ``@@MT_PHASE combining``: all frames are written; Manim is joining the partial movies.

Manim's own progress bars only cover ``play`` calls (waits are written as one frozen frame batch)
and barely update when output is piped, so the scene time comes from the renderer itself.
"""

from __future__ import annotations

import sys
import time

MARK_PROGRESS = "@@MT_PROGRESS"
MARK_PHASE = "@@MT_PHASE"
MARK_BUILT = "@@MT_BUILT"
REPORT_INTERVAL_S = 0.2


def _emit(line: str) -> None:
    try:
        sys.stderr.write(line + "\n")
        sys.stderr.flush()
    except (OSError, ValueError):
        pass


def install() -> None:
    """Wrap the renderer's frame and movie-combining steps so they report progress."""
    from manim.renderer.cairo_renderer import CairoRenderer
    from manim.scene.scene_file_writer import SceneFileWriter

    last = [0.0]
    add_frame = CairoRenderer.add_frame

    def add_frame_with_progress(self, frame, num_frames: int = 1) -> None:  # type: ignore[no-untyped-def]
        add_frame(self, frame, num_frames)
        now = time.monotonic()
        if now - last[0] >= REPORT_INTERVAL_S:
            last[0] = now
            _emit(f"{MARK_PROGRESS} {self.time:.3f}")

    CairoRenderer.add_frame = add_frame_with_progress  # type: ignore[method-assign]

    combine = SceneFileWriter.combine_to_movie

    def combine_with_progress(self) -> None:  # type: ignore[no-untyped-def]
        _emit(f"{MARK_PHASE} combining")
        combine(self)

    SceneFileWriter.combine_to_movie = combine_with_progress  # type: ignore[method-assign]

    try:
        from hebrew_math_line import HebrewMathLine
    except ImportError:
        return
    built = [0]
    init = HebrewMathLine.__init__

    def init_with_progress(self, *args, **kwargs) -> None:  # type: ignore[no-untyped-def]
        init(self, *args, **kwargs)
        built[0] += 1
        _emit(f"{MARK_BUILT} {built[0]}")

    HebrewMathLine.__init__ = init_with_progress  # type: ignore[method-assign]


def main() -> None:
    from manim.__main__ import main as manim_main

    install()
    manim_main(args=sys.argv[1:], prog_name="manim")


if __name__ == "__main__":
    main()
