"""Tests for render_progress (no Manim: the streaming reader runs a tiny Python child)."""

import subprocess
import sys

import pytest

import render_progress as rp


def test_parse_marks_finds_markers_anywhere_in_a_line():
    assert rp.parse_marks("@@MT_PROGRESS 1.250\n") == [("progress", "1.250")]
    assert rp.parse_marks("noise\r@@MT_PHASE combining\n") == [("phase", "combining")]
    assert rp.parse_marks("@@MT_BUILT 3\n") == [("built", "3")]
    assert rp.parse_marks("INFO Animation 3 : Partial movie file written\n") == []


def test_progress_percent_maps_scene_time_into_the_render_share():
    assert rp.progress_percent("starting", 0, 10) == 0
    assert rp.progress_percent("rendering", 0, 10) == rp.RENDER_START
    assert rp.progress_percent("rendering", 5, 10) == pytest.approx((rp.RENDER_START + rp.RENDER_END) / 2, abs=0.1)
    assert rp.progress_percent("rendering", 99, 10) == rp.RENDER_END
    assert rp.progress_percent("rendering", 5, None) is None
    assert rp.progress_percent("combining", 10, 10) == 95
    assert rp.progress_percent("audio", 10, 10) == 98
    assert rp.progress_percent("done", 10, 10) == 100
    assert rp.progress_percent("error", 10, 10) is None


def test_count_text_objects():
    code = (
        "from hebrew_math_line import HebrewMathLine\n"
        "        a = HebrewMathLine(\n"
        "            'x', font_size=36)\n"
        "        b = HebrewMathLine('y')  # HebrewMathLine( in a comment still counts once\n"
        '        g = {c: HebrewMathLine(c, font_size=18) for c in "0123456789"}\n'
        "        # c = HebrewMathLine('commented out')\n"
    )
    assert rp.count_text_objects(code) == 1 + 2 + 10


def test_building_text_fills_the_first_stretch():
    assert rp.progress_percent("building", 0, 10, text_built=0, text_total=4) == rp.BUILD_START
    assert rp.progress_percent("building", 0, 10, text_built=4, text_total=4) == rp.BUILD_END
    assert rp.progress_percent("building", 0, 10, text_built=9, text_total=4) == rp.BUILD_END
    # With text, rendering starts where building ended.
    assert rp.progress_percent("rendering", 0, 10, text_built=4, text_total=4) == rp.BUILD_END
    assert rp.progress_percent("rendering", 10, 10, text_built=4, text_total=4) == rp.RENDER_END


def test_jobs_track_time_and_phase():
    jobs = rp.RenderJobs()
    assert jobs.get("missing") == {"phase": "unknown", "percent": None}
    jobs.start("j1", 8.0, text_total=2)
    assert jobs.get("j1")["phase"] == "starting"
    mark = jobs.on_mark("j1")
    mark("built", "1")
    assert jobs.get("j1")["phase"] == "building"
    assert jobs.get("j1")["percent"] == rp.progress_percent("building", 0, 8.0, 1, 2)
    mark("progress", "2.0")
    mark("progress", "1.0")  # never goes backwards
    state = jobs.get("j1")
    assert state["phase"] == "rendering" and state["scene_time"] == 2.0 and state["duration"] == 8.0
    assert state["percent"] == rp.progress_percent("rendering", 2.0, 8.0, 1, 2)
    mark("phase", "combining")
    assert jobs.get("j1")["percent"] == 95


def test_job_ids_are_restricted():
    assert rp.JOB_ID_RE.match("render-1a2B_3")
    assert not rp.JOB_ID_RE.match("../etc")
    assert not rp.JOB_ID_RE.match("a" * 65)


def test_run_streaming_reports_marks_and_keeps_them_out_of_stderr():
    child = (
        "import sys\n"
        "print('hello stdout')\n"
        "sys.stderr.write('@@MT_PROGRESS 0.5\\n'); sys.stderr.flush()\n"
        "sys.stderr.write('real warning\\n')\n"
        "sys.stderr.write('@@MT_PHASE combining\\n')\n"
        "sys.exit(3)\n"
    )
    seen = []
    code, out, err = rp.run_streaming(
        [sys.executable, "-c", child], cwd=".", env=None, timeout=30, on_mark=lambda k, v: seen.append((k, v))
    )
    assert code == 3
    assert out.strip() == "hello stdout"
    assert err.strip() == "real warning"
    assert seen == [("progress", "0.5"), ("phase", "combining")]


def test_run_streaming_times_out():
    with pytest.raises(subprocess.TimeoutExpired):
        rp.run_streaming([sys.executable, "-c", "import time; time.sleep(30)"], cwd=".", env=None, timeout=0.5)
