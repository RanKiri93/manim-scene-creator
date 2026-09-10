"""Tests for guided script-to-Whisper alignment helpers in measure_server."""

import numpy as np

import measure_server
from measure_server import (
    _align_script_to_word_timings,
    _script_words,
    _snap_boundaries_to_onsets,
    _tokenize_script,
)


def _wb(word: str, start: float, end: float) -> dict:
    return {"word": word, "start": start, "end": end}


def test_empty_script_returns_whisper_unchanged():
    whisper = [_wb("hello", 0.0, 0.5), _wb("world", 0.5, 1.0)]
    assert _align_script_to_word_timings("", whisper, 1.0) == whisper
    assert _align_script_to_word_timings(None, whisper, 1.0) == whisper


def test_empty_whisper_even_splits_tokens():
    script = "one two three"
    aligned = _align_script_to_word_timings(script, [], duration=3.0)
    assert len(aligned) == 3
    assert aligned[0] == {"word": "one", "start": 0.0, "end": 1.0}
    assert aligned[1] == {"word": "two", "start": 1.0, "end": 2.0}
    assert aligned[2] == {"word": "three", "start": 2.0, "end": 3.0}


def test_exact_match_preserves_whisper_timings():
    script = "alpha beta gamma"
    whisper = [
        _wb("alpha", 0.0, 0.4),
        _wb("beta", 0.4, 0.8),
        _wb("gamma", 0.8, 1.2),
    ]
    aligned = _align_script_to_word_timings(script, whisper, 1.2)
    assert [a["word"] for a in aligned] == ["alpha", "beta", "gamma"]
    assert aligned[0]["start"] == 0.0 and aligned[0]["end"] == 0.4
    assert aligned[1]["start"] == 0.4 and aligned[1]["end"] == 0.8
    assert aligned[2]["start"] == 0.8 and aligned[2]["end"] == 1.2


def test_extra_whisper_word_does_not_drift_anchors():
    script = "one two three"
    whisper = [
        _wb("one", 0.0, 0.3),
        _wb("um", 0.3, 0.4),
        _wb("two", 0.4, 0.7),
        _wb("three", 0.7, 1.0),
    ]
    aligned = _align_script_to_word_timings(script, whisper, 1.0)
    assert [a["word"] for a in aligned] == ["one", "two", "three"]
    assert aligned[0]["start"] == 0.0 and aligned[0]["end"] == 0.3
    assert aligned[1]["start"] == 0.4 and aligned[1]["end"] == 0.7
    assert aligned[2]["start"] == 0.7 and aligned[2]["end"] == 1.0


def test_dropped_script_word_still_aligns_neighbors():
    script = "one two three four"
    whisper = [
        _wb("one", 0.0, 0.2),
        _wb("two", 0.2, 0.4),
        _wb("four", 0.6, 0.8),
    ]
    aligned = _align_script_to_word_timings(script, whisper, 0.8)
    assert [a["word"] for a in aligned] == ["one", "two", "three", "four"]
    assert aligned[0]["start"] == 0.0 and aligned[0]["end"] == 0.2
    assert aligned[1]["start"] == 0.2 and aligned[1]["end"] == 0.4
    assert aligned[3]["start"] == 0.6 and aligned[3]["end"] == 0.8
    assert aligned[2]["start"] >= aligned[1]["end"]
    assert aligned[2]["end"] <= aligned[3]["start"] + 0.01 or aligned[2]["end"] <= 0.8


def test_no_text_match_follows_whisper_timings_not_even_split():
    # Script words do not string-match the ASR text at all, but the user read them in order.
    # Timings must follow Whisper's (non-uniform) word times, never an even split.
    script = "aleph bet gimel"
    whisper = [
        _wb("xxx", 0.0, 0.2),
        _wb("yyy", 0.2, 0.4),
        _wb("zzz", 2.0, 2.5),
    ]
    aligned = _align_script_to_word_timings(script, whisper, 2.5)
    assert [a["word"] for a in aligned] == ["aleph", "bet", "gimel"]
    assert aligned[0]["start"] == 0.0
    assert aligned[1]["start"] == 0.2
    assert aligned[2]["start"] == 2.0
    # A big pause before the last word must be preserved (not evenly spaced).
    gap_before_last = aligned[2]["start"] - aligned[1]["end"]
    assert gap_before_last > 1.0


def test_fuzzy_anchors_from_real_recording():
    # Real capture: Whisper merged "נגדיר את" -> "נגדיחת", misspelled words, and split the spoken
    # formula into 8 tokens. Fuzzy anchoring must keep the Hebrew words early and let the math
    # token absorb the trailing formula tokens (so "העזר" is not pushed into the formula region).
    script = "נגדיר את פונקציית העזר\n$y(x)=u(\\ln{(x)})$"
    whisper = [
        _wb("נגדיחת", 0.0, 0.74),
        _wb("פונקציה", 0.74, 1.1),
        _wb("תאזר", 1.1, 1.74),
        _wb("ויש", 2.0, 2.3),
        _wb("על", 2.3, 2.5),
        _wb("X", 2.5, 2.76),
        _wb("שבל", 2.76, 3.18),
        _wb("U", 3.18, 3.42),
        _wb("של", 3.42, 3.74),
        _wb("L", 3.74, 3.94),
        _wb("X", 3.94, 4.4),
    ]
    aligned = _align_script_to_word_timings(script, whisper, 4.4)
    by_word = {a["word"]: a for a in aligned}
    # פונקציית anchors to Whisper "פונקציה", העזר anchors to "תאזר" (both early, not in the formula).
    assert abs(by_word["פונקציית"]["start"] - 0.74) < 0.05
    assert abs(by_word["העזר"]["start"] - 1.1) < 0.05
    assert by_word["העזר"]["end"] <= 1.8
    # The formula spans the trailing Whisper words.
    math = by_word["$y(x)=u(\\ln{(x)})$"]
    assert math["start"] >= 1.9
    assert abs(math["end"] - 4.4) < 0.05


def test_hebrew_math_single_boundary():
    script = "נגדיר את הפונקציה $f(x)=x^2$ ואז נגזור"
    whisper = [
        _wb("נגדיר", 0.0, 0.3),
        _wb("את", 0.3, 0.45),
        _wb("הפונקציה", 0.45, 0.9),
        _wb("אף", 0.9, 1.0),
        _wb("של", 1.0, 1.1),
        _wb("איקס", 1.1, 1.3),
        _wb("ואז", 1.3, 1.5),
        _wb("נגזור", 1.5, 1.8),
    ]
    aligned = _align_script_to_word_timings(script, whisper, 1.8)
    words = [a["word"] for a in aligned]
    assert words == [
        "נגדיר",
        "את",
        "הפונקציה",
        "$f(x)=x^2$",
        "ואז",
        "נגזור",
    ]
    math = aligned[3]
    assert math["word"] == "$f(x)=x^2$"
    assert math["start"] == 0.9
    assert math["end"] == 1.3


def test_tokenize_script_splits_math():
    tokens = _tokenize_script("hello $x^2$ world")
    assert len(tokens) == 3
    assert tokens[0]["kind"] == "text" and tokens[0]["display"] == "hello"
    assert tokens[1]["kind"] == "math" and tokens[1]["display"] == "$x^2$"
    assert tokens[2]["kind"] == "text" and tokens[2]["display"] == "world"


def test_script_words_includes_math_spans():
    assert _script_words("a $b$ c") == ["a", "$b$", "c"]


def _synthetic_speech(sr: int, bursts: list[tuple[float, float]], total_s: float):
    """Silence with speech-like noise bursts at the given [start, end] second ranges."""
    n = int(total_s * sr)
    samples = np.zeros(n, dtype=np.float32)
    rng = np.random.default_rng(0)
    for start_s, end_s in bursts:
        a = int(start_s * sr)
        b = int(end_s * sr)
        samples[a:b] = rng.normal(0.0, 0.3, size=b - a).astype(np.float32)
    return samples


def test_snap_moves_first_word_past_leading_silence(monkeypatch):
    sr = 16000
    # "נגדיר" is actually spoken at 0.5-0.9s, but Whisper starts it at 0.0 (leading silence).
    samples = _synthetic_speech(sr, [(0.5, 0.9), (1.1, 1.5)], total_s=2.0)
    monkeypatch.setattr(measure_server, "_decode_audio_mono", lambda *_: (samples, sr))

    boundaries = [
        {"word": "a", "start": 0.0, "end": 1.0},
        {"word": "b", "start": 1.05, "end": 1.6},
    ]
    snapped = _snap_boundaries_to_onsets(boundaries, "ignored.wav")
    assert 0.4 <= snapped[0]["start"] <= 0.6
    assert 1.0 <= snapped[1]["start"] <= 1.2


def test_snap_keeps_continuous_speech_start(monkeypatch):
    sr = 16000
    # Continuous speech from 0.0; the bracket begins in speech so the start is left untouched.
    samples = _synthetic_speech(sr, [(0.0, 1.5)], total_s=2.0)
    monkeypatch.setattr(measure_server, "_decode_audio_mono", lambda *_: (samples, sr))

    boundaries = [{"word": "a", "start": 0.02, "end": 0.7}]
    snapped = _snap_boundaries_to_onsets(boundaries, "ignored.wav")
    assert snapped[0]["start"] == 0.02


def test_snap_returns_input_when_decode_fails(monkeypatch):
    monkeypatch.setattr(measure_server, "_decode_audio_mono", lambda *_: (None, 16000))
    boundaries = [{"word": "a", "start": 0.0, "end": 1.0}]
    assert _snap_boundaries_to_onsets(boundaries, "ignored.wav") == boundaries
