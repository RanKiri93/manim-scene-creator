"""HebrewMathLine keeps segments in the order they were given (needs xelatex)."""

from hebrew_math_line import HebrewMathLine
from hebrew_math_parser import parse_segments


def _legacy_visual_order(line: HebrewMathLine) -> list[int]:
    """Segment order the old top-level sort produced: right to left by centre x."""
    keys = [
        (mob.get_center()[0] if mob.submobjects else 0.0, i)
        for i, mob in enumerate(line.submobjects)
    ]
    return [i for _, i in sorted(keys, key=lambda k: k[0], reverse=True)]


def _build(raw: str) -> HebrewMathLine:
    return HebrewMathLine(*[s.latex for s in parse_segments(raw)], hebrew_font="Alef")


def test_submobjects_follow_given_order():
    parts = ["אם", "$f(x)$", "רציפה", "$[a,b]$"]
    line = HebrewMathLine(*parts, hebrew_font="Alef")
    assert [s.latex for s in line.segments] == parts
    assert len(line.submobjects) == len(parts)


def test_typed_order_matches_legacy_for_single_row_rtl():
    corpus = [
        r"אם $f(x)$ רציפה בקטע $[a,b]$",
        r"$x^2$ הוא פולינום",
        r"הפתרון הוא $x=5$",
        r"$a$ $b$",
        # No blank pieces: the old sort put ink-less segments at x=0, so lines with
        # " || $f(x)$ || " did reorder (see test_whitespace_only_segment_keeps_position).
        r"חלק א||חלק ב||$f(x)$||חלק ג",
        r"שלב 1: נחשב $\int_0^1 x\,dx$, ואז 2.5 פעמים",
    ]
    for raw in corpus:
        line = _build(raw)
        assert _legacy_visual_order(line) == list(range(len(line.submobjects))), raw


def test_whitespace_only_segment_keeps_position():
    line = _build("א||   ||ב")
    assert [s.content for s in line.segments] == ["א", "   ", "ב"]
    # The first segment (rightmost in RTL) stays first; the blank piece stays in the middle.
    assert line[0].get_center()[0] > line[2].get_center()[0]


def test_math_after_blank_piece_keeps_its_index():
    # The old sort moved the blank piece (index 4) ahead of f(x), so line[3] was blank.
    line = _build("חלק א || חלק ב || $f(x)$ || חלק ג")
    assert [s.is_math for s in line.segments] == [False, False, False, True, False, False]
    assert [bool(m.submobjects) for m in line.submobjects] == [True, True, False, True, False, True]
