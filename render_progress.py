"""Render progress for ``/api/render``: run Manim through ``manim_progress`` and track each job.

The browser sends a ``job_id`` with the render request and polls ``/api/render/progress`` while it
waits. Two stretches of the bar move with real work: building the text objects (counted against
the ``HebrewMathLine(`` calls in the scene code) and writing frames (scene time written divided by
the scene length the browser expects). The other phases get fixed values.
"""

from __future__ import annotations

import re
import subprocess
import threading
import time
from typing import Any, Callable

from manim_progress import MARK_BUILT, MARK_PHASE, MARK_PROGRESS

JOB_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_MARKS = {MARK_PROGRESS: "progress", MARK_PHASE: "phase", MARK_BUILT: "built"}
_MARK_RE = re.compile("(" + "|".join(re.escape(m) for m in _MARKS) + r") (\S+)")
_TEXT_CALL_RE = re.compile(r"\bHebrewMathLine\(")
_COMPREHENSION_RE = re.compile(r"""\bfor\s+\w+\s+in\s+(?:"([^"]*)"|'([^']*)')""")
JOB_TTL_S = 900

# Share of the bar each stretch reaches. Building text fills BUILD_START..BUILD_END (only when the
# scene has text), writing frames fills from there to RENDER_END.
BUILD_START = 1.0
BUILD_END = 20.0
RENDER_START = 2.0
RENDER_END = 94.0
PHASE_PERCENT = {"starting": 0.0, "combining": 95.0, "audio": 98.0, "done": 100.0}


def parse_marks(line: str) -> list[tuple[str, str]]:
    """``[("progress", "1.250"), ("phase", "combining")]`` for the markers in one output line."""
    return [(_MARKS[mark], value) for mark, value in _MARK_RE.findall(line)]


def count_text_objects(python_code: str) -> int:
    """How many ``HebrewMathLine`` objects the scene code builds (a comprehension over a string
    literal counts once per character, like the graph tick glyphs)."""
    total = 0
    for line in python_code.splitlines():
        stripped = line.lstrip()
        if stripped.startswith(("import ", "from ", "#")):
            continue
        calls = len(_TEXT_CALL_RE.findall(line))
        if not calls:
            continue
        loop = _COMPREHENSION_RE.search(line)
        if loop:
            chars = loop.group(1) if loop.group(1) is not None else loop.group(2)
            total += calls * max(1, len(chars))
        else:
            total += calls
    return total


def strip_marks(text: str) -> str:
    """Manim's output without the progress marker lines (for error messages)."""
    return "\n".join(line for line in text.splitlines() if not _MARK_RE.search(line))


def progress_percent(
    phase: str,
    scene_time: float,
    duration: float | None,
    text_built: int = 0,
    text_total: int = 0,
) -> float | None:
    """Overall percent for a job, or None while rendering when the scene length is unknown."""
    render_start = BUILD_END if text_total > 0 else RENDER_START
    if phase == "building":
        if text_total <= 0:
            return BUILD_START
        frac = max(0.0, min(1.0, text_built / text_total))
        return round(BUILD_START + (BUILD_END - BUILD_START) * frac, 1)
    if phase == "rendering":
        if not duration or duration <= 0:
            return None
        frac = max(0.0, min(1.0, scene_time / duration))
        return round(render_start + (RENDER_END - render_start) * frac, 1)
    if phase == "error":
        return None
    return PHASE_PERCENT.get(phase)


class RenderJobs:
    """Thread-safe progress of the renders in flight, by job id."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}

    def start(self, job_id: str, duration: float | None, text_total: int = 0) -> None:
        now = time.time()
        with self._lock:
            for key in [k for k, v in self._jobs.items() if now - v["updated"] > JOB_TTL_S]:
                self._jobs.pop(key, None)
            self._jobs[job_id] = {
                "phase": "starting",
                "scene_time": 0.0,
                "duration": duration if duration and duration > 0 else None,
                "text_built": 0,
                "text_total": max(0, text_total),
                "started": now,
                "updated": now,
            }

    def update(
        self,
        job_id: str,
        *,
        phase: str | None = None,
        scene_time: float | None = None,
        text_built: int | None = None,
    ) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            if text_built is not None:
                job["text_built"] = max(job["text_built"], text_built)
                if job["phase"] == "starting":
                    job["phase"] = "building"
            if scene_time is not None:
                job["scene_time"] = max(job["scene_time"], scene_time)
                if job["phase"] in ("starting", "building"):
                    job["phase"] = "rendering"
            if phase is not None:
                job["phase"] = phase
            job["updated"] = time.time()

    def get(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return {"phase": "unknown", "percent": None}
            out = {k: job[k] for k in ("phase", "scene_time", "duration", "text_built", "text_total")}
            out["elapsed"] = round(time.time() - job["started"], 1)
        out["percent"] = progress_percent(
            out["phase"], out["scene_time"], out["duration"], out["text_built"], out["text_total"]
        )
        return out

    def on_mark(self, job_id: str) -> Callable[[str, str], None]:
        """A marker callback for :func:`run_streaming` that updates *job_id*."""

        def handle(kind: str, value: str) -> None:
            if kind == "progress":
                try:
                    self.update(job_id, scene_time=float(value))
                except ValueError:
                    pass
            elif kind == "built":
                try:
                    self.update(job_id, text_built=int(value))
                except ValueError:
                    pass
            else:
                self.update(job_id, phase=value)

        return handle


def run_streaming(
    cmd: list[str],
    *,
    cwd: str,
    env: dict[str, str],
    timeout: float,
    on_mark: Callable[[str, str], None] | None = None,
) -> tuple[int, str, str]:
    """Run *cmd* (an argument list, no shell); call *on_mark* for progress markers on stderr.

    Returns ``(returncode, stdout, stderr)`` with the marker lines left out of stderr. Raises
    ``subprocess.TimeoutExpired`` after killing the process when it runs past *timeout*.
    """
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    out_parts: list[str] = []
    err_lines: list[str] = []

    def read_stdout() -> None:
        assert proc.stdout is not None
        out_parts.append(proc.stdout.read())

    def read_stderr() -> None:
        assert proc.stderr is not None
        for line in proc.stderr:
            marks = parse_marks(line)
            if not marks:
                err_lines.append(line)
                continue
            for kind, value in marks:
                if on_mark is not None:
                    try:
                        on_mark(kind, value)
                    except Exception:
                        pass

    readers = [threading.Thread(target=read_stdout, daemon=True), threading.Thread(target=read_stderr, daemon=True)]
    for t in readers:
        t.start()
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
        for t in readers:
            t.join(timeout=5)
        raise
    for t in readers:
        t.join(timeout=30)
    return proc.returncode, "".join(out_parts), "".join(err_lines)
