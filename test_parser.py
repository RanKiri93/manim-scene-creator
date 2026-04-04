"""Tests for the Hebrew+Math string parser."""

from hebrew_math_parser import (
    Segment,
    SegmentType,
    classify_segments,
    generate_phantom_source,
    parse_segments,
    reconstruct_line,
)


def _types(segs: list[Segment]) -> list[str]:
    return [s.seg_type.name for s in segs]


def _contents(segs: list[Segment]) -> list[str]:
    return [s.content for s in segs]


# ── parse_segments (auto-split) ─────────────────────────────────────

def test_simple_mixed():
    segs = parse_segments(r"אם $f(x)$ רציפה")
    assert _types(segs) == ["TEXT", "MATH", "TEXT"]
    assert _contents(segs) == ["אם ", "f(x)", " רציפה"]


def test_target_sentence():
    raw = r"משפט: אם $f(x)$ פונקציה רציפה בקטע $[a,b]$, אזי $\int_a^x f(t)\,{\rm d}t$ פונקציה גזירה."
    segs = parse_segments(raw)
    assert _types(segs) == ["TEXT", "MATH", "TEXT", "MATH", "TEXT", "MATH", "TEXT"]
    assert segs[0].content == "משפט: אם "
    assert segs[1].content == "f(x)"
    assert segs[3].content == "[a,b]"
    assert segs[5].content == r"\int_a^x f(t)\,{\rm d}t"
    assert segs[6].content == " פונקציה גזירה."


def test_pure_hebrew():
    segs = parse_segments("משפט פונדמנטלי של החשבון")
    assert len(segs) == 1
    assert segs[0].is_text
    assert segs[0].content == "משפט פונדמנטלי של החשבון"


def test_hebrew_split_double_pipe():
    """|| splits a text run into multiple TEXT segments (not in math)."""
    segs = parse_segments(r"חלק א || חלק ב || חלק ג")
    assert _types(segs) == ["TEXT", "TEXT", "TEXT"]
    assert _contents(segs) == ["חלק א ", " חלק ב ", " חלק ג"]


def test_double_pipe_with_math():
    segs = parse_segments(r"ראשון||שני$x$שלישי")
    assert _types(segs) == ["TEXT", "TEXT", "MATH", "TEXT"]
    assert _contents(segs) == ["ראשון", "שני", "x", "שלישי"]
    assert reconstruct_line(segs) == r"ראשוןשני$x$שלישי"


def test_double_pipe_inside_math_preserved():
    segs = parse_segments(r"$a||b$")
    assert len(segs) == 1
    assert segs[0].is_math
    assert segs[0].content == "a||b"


def test_pure_math():
    segs = parse_segments(r"$\int_0^1 f(x)\,dx$")
    assert len(segs) == 1
    assert segs[0].is_math
    assert segs[0].content == r"\int_0^1 f(x)\,dx"


def test_escaped_dollar():
    segs = parse_segments(r"המחיר הוא \$5 ולא \$10")
    assert len(segs) == 1
    assert segs[0].is_text
    assert r"\$" in segs[0].content


def test_math_at_start():
    segs = parse_segments(r"$x^2$ הוא פולינום")
    assert _types(segs) == ["MATH", "TEXT"]
    assert segs[0].content == "x^2"


def test_math_at_end():
    segs = parse_segments(r"הפתרון הוא $x=5$")
    assert _types(segs) == ["TEXT", "MATH"]
    assert segs[1].content == "x=5"


def test_adjacent_math():
    segs = parse_segments(r"$a$$b$")
    assert _types(segs) == ["MATH", "MATH"]
    assert _contents(segs) == ["a", "b"]


def test_empty_string():
    segs = parse_segments("")
    assert segs == []


# ── classify_segments (manual split) ────────────────────────────────

def test_classify_basic():
    segs = classify_segments("משפט: אם", "$f(x)$", "פונקציה רציפה")
    assert _types(segs) == ["TEXT", "MATH", "TEXT"]
    assert _contents(segs) == ["משפט: אם", "f(x)", "פונקציה רציפה"]


def test_classify_latex_delimiters():
    segs = classify_segments(r"\(f(x)\)", r"\[a+b\]")
    assert _types(segs) == ["MATH", "MATH"]
    assert _contents(segs) == ["f(x)", "a+b"]


def test_classify_skips_empty():
    segs = classify_segments("hello", "", "$x$")
    assert len(segs) == 2


def test_classify_target_sentence():
    segs = classify_segments(
        "משפט: אם",
        "$f(x)$",
        "פונקציה רציפה בקטע",
        "$[a,b]$",
        ", אזי",
        r"$\int_a^x f(t)\,{\rm d}t$",
        "פונקציה גזירה.",
    )
    assert len(segs) == 7
    assert _types(segs) == ["TEXT", "MATH", "TEXT", "MATH", "TEXT", "MATH", "TEXT"]
    assert segs[5].content == r"\int_a^x f(t)\,{\rm d}t"


# ── reconstruct_line ────────────────────────────────────────────────

def test_reconstruct_roundtrip():
    raw = r"אם $f(x)$ רציפה"
    segs = parse_segments(raw)
    assert reconstruct_line(segs) == raw


def test_reconstruct_target():
    raw = r"משפט: אם $f(x)$ פונקציה רציפה בקטע $[a,b]$, אזי $\int_a^x f(t)\,{\rm d}t$ פונקציה גזירה."
    segs = parse_segments(raw)
    assert reconstruct_line(segs) == raw


# ── generate_phantom_source ─────────────────────────────────────────

def test_phantom_single_visible():
    segs = parse_segments(r"אם $f(x)$ רציפה")
    src = generate_phantom_source(segs, visible=1)
    assert r"\phantom{אם }" in src
    assert "$f(x)$" in src
    assert r"\phantom{ רציפה}" in src
    # The math segment itself must NOT be phantomed
    assert r"$\phantom{f(x)}$" not in src


def test_phantom_text_visible():
    segs = parse_segments(r"אם $f(x)$ רציפה")
    src = generate_phantom_source(segs, visible=0)
    assert "אם " in src
    assert r"$\phantom{f(x)}$" in src
    assert r"\phantom{ רציפה}" in src


def test_phantom_multiple_visible():
    segs = parse_segments(r"אם $f(x)$ רציפה")
    src = generate_phantom_source(segs, visible={0, 2})
    assert "אם " in src
    assert r"$\phantom{f(x)}$" in src
    assert " רציפה" in src
    assert r"\phantom{אם }" not in src
    assert r"\phantom{ רציפה}" not in src


def test_phantom_preserves_full_width():
    """The phantom source must have the same total content as the
    reconstructed line — just with some parts wrapped in \\phantom."""
    segs = parse_segments(r"משפט $a+b$ סוף")
    full = reconstruct_line(segs)
    for i in range(len(segs)):
        src = generate_phantom_source(segs, visible=i)
        # Every piece of content must appear (either plain or inside \phantom)
        for seg in segs:
            assert seg.content in src


# ── Segment properties ──────────────────────────────────────────────

def test_segment_latex_property():
    s_text = Segment("שלום", SegmentType.TEXT)
    s_math = Segment("x^2", SegmentType.MATH)
    assert s_text.latex == "שלום"
    assert s_math.latex == "$x^2$"


def test_segment_phantom_property():
    s_text = Segment("שלום", SegmentType.TEXT)
    s_math = Segment("x^2", SegmentType.MATH)
    assert s_text.phantom_latex == r"\phantom{שלום}"
    assert s_math.phantom_latex == r"$\phantom{x^2}$"


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-v"]))
