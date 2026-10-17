"""Tests for audio_mixdown (filter graph text, and real ffmpeg renders when ffmpeg is on PATH)."""

import shutil
import subprocess
import wave

import numpy as np
import pytest

import audio_mixdown as am
from audio_mixdown import MixClip

FFMPEG = shutil.which("ffmpeg")
SR = 48000


def test_untrimmed_clip_has_no_atrim_and_keeps_fades_and_delay():
    f = am.clip_filter(0, MixClip(file_duration=2.0, start_sec=1.5, fade_in_ms=40, fade_out_ms=40))
    assert f == (
        "[0:a]afade=t=in:st=0:d=0.0400,afade=t=out:st=1.9600:d=0.0400,"
        "adelay=delays=1500:all=1[a0]"
    )


def test_trimmed_clip_slices_the_file_before_gain_and_fades():
    f = am.clip_filter(
        2,
        MixClip(file_duration=5.0, start_sec=0, fade_out_ms=100, gain_db=-3, source_in_sec=1.0, duration_sec=2.0),
    )
    assert f.startswith("[2:a]atrim=start=1.0000:duration=2.0000,asetpts=PTS-STARTPTS,volume=-3.00dB,")
    assert "afade=t=out:st=1.9000:d=0.1000" in f
    assert f.endswith("[a2]")


def test_clip_is_clamped_to_the_file_and_empty_clips_drop_out():
    assert am.clip_span(MixClip(file_duration=3.0, source_in_sec=2.5, duration_sec=4.0)) == (2.5, 0.5)
    assert am.clip_filter(0, MixClip(file_duration=3.0, source_in_sec=3.0)) is None


def test_fades_longer_than_the_clip_are_scaled_down():
    f = am.clip_filter(0, MixClip(file_duration=0.1, fade_in_ms=100, fade_out_ms=100))
    assert "afade=t=in:st=0:d=0.0500" in f
    assert "afade=t=out:st=0.0500:d=0.0500" in f


def test_graph_mixes_without_normalizing_and_limits():
    g = am.mixdown_filter_graph([MixClip(file_duration=1), MixClip(file_duration=1)], 5.0, bed_gain_db=-24)
    assert "amix=inputs=3:duration=longest:dropout_transition=0:normalize=0" in g
    assert "[2:a]atrim=0:5.0000" in g and "volume=-24.0dB[bed]" in g
    assert "alimiter=limit=0.97:level=0:latency=1" in g
    assert g.endswith("apad=whole_len=240000,atrim=end_sample=240000[out]")


def test_graph_needs_something_to_play():
    with pytest.raises(ValueError):
        am.mixdown_filter_graph([MixClip(file_duration=0)], 1.0)


# ── real renders ──


def _tone(path, seconds, freq=440.0, amp=0.25, lead_silence=0.0):
    t = np.arange(int(seconds * SR)) / SR
    x = amp * np.sin(2 * np.pi * freq * t)
    x = np.concatenate([np.zeros(int(lead_silence * SR)), x])
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())


def _render(tmp_path, files, clips, total, bed=None):
    inputs = []
    for f in files:
        inputs += ["-i", str(f)]
    if bed is not None:
        inputs += ["-stream_loop", "-1", "-i", str(bed[0])]
    graph = am.mixdown_filter_graph(clips, total, None if bed is None else bed[1])
    out = tmp_path / "out.wav"
    subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", graph,
         "-map", "[out]", "-ar", str(SR), "-ac", "1", str(out)],
        check=True,
    )
    with wave.open(str(out)) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float) / 32767
    return data


def _rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x**2)) + 1e-12)


def _window(data, t0, t1):
    return data[int(t0 * SR) : int(t1 * SR)]


@pytest.mark.skipif(FFMPEG is None, reason="ffmpeg not on PATH")
def test_every_clip_keeps_its_level_however_many_clips_there_are(tmp_path):
    files = []
    for i in range(4):
        files.append(tmp_path / f"c{i}.wav")
        _tone(files[-1], 2.0)
    clips = [MixClip(file_duration=2.0, start_sec=2.0 * i) for i in range(4)]
    data = _render(tmp_path, files, clips, 8.0)
    levels = [_rms_db(_window(data, 2.0 * i + 0.5, 2.0 * i + 1.5)) for i in range(4)]
    assert max(levels) - min(levels) < 0.2
    assert levels[0] == pytest.approx(_rms_db(0.25 * np.sin(np.linspace(0, 200 * np.pi, 48000))), abs=0.3)
    assert len(data) == 8 * SR


@pytest.mark.skipif(FFMPEG is None, reason="ffmpeg not on PATH")
def test_a_trimmed_piece_plays_only_its_slice_at_its_timeline_start(tmp_path):
    src = tmp_path / "src.wav"
    _tone(src, 1.0, lead_silence=1.0)  # silence 0–1 s, tone 1–2 s
    clip = MixClip(file_duration=2.0, start_sec=0.5, source_in_sec=1.0, duration_sec=0.5)
    data = _render(tmp_path, [src], [clip], 2.0)
    assert _rms_db(_window(data, 0.0, 0.49)) < -80
    assert _rms_db(_window(data, 0.52, 0.98)) == pytest.approx(-15.05, abs=0.2)
    assert len(data) == 2 * SR
    assert _rms_db(_window(data, 1.02, 2.0)) < -80
    onset = int(np.argmax(np.abs(data) > 0.01)) / SR
    assert onset == pytest.approx(0.5, abs=0.002)


@pytest.mark.skipif(FFMPEG is None, reason="ffmpeg not on PATH")
def test_overlapping_loud_clips_are_limited_not_clipped(tmp_path):
    a = tmp_path / "a.wav"
    _tone(a, 1.0, amp=0.9)
    data = _render(tmp_path, [a, a], [MixClip(file_duration=1.0), MixClip(file_duration=1.0)], 1.0)
    assert np.max(np.abs(data)) <= am.LIMIT + 0.01
