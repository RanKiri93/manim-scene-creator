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


# ── English runs and left-to-right lines ──────────────────────────────


def _cx(mob) -> float:
    return float(mob.get_center()[0])


def test_english_run_reads_left_to_right_inside_hebrew_line():
    line = HebrewMathLine(r"אם \en{the function || is continuous} אז", hebrew_font="Alef")
    assert [(s.content, s.lang) for s in line.segments] == [
        ("אם ", "he"),
        ("the function ", "en"),
        (" is continuous", "en"),
        (" אז", "he"),
    ]
    he_first, en_a, en_b, he_last = (_cx(m) for m in line.submobjects)
    # Hebrew flows right to left around the run; inside the run English flows left to right.
    assert he_first > en_b > en_a > he_last


def test_ltr_line_with_hebrew_run():
    line = HebrewMathLine(
        r"The function $f$ is \he{רציפה || בקטע}", hebrew_font="Alef", base_dir="ltr"
    )
    assert [s.lang for s in line.segments] == ["en", "en", "en", "he", "he"]
    en_a, f, en_b, he_a, he_b = (_cx(m) for m in line.submobjects)
    assert en_a < f < en_b < he_b < he_a


def test_glyph_order_follows_segment_language():
    line = HebrewMathLine(r"אם \en{word}", hebrew_font="Alef")
    he_xs = [_cx(g) for g in line[0].submobjects]
    en_xs = [_cx(g) for g in line[1].submobjects]
    assert he_xs == sorted(he_xs, reverse=True)
    assert en_xs == sorted(en_xs)


def test_segments_line_up_with_full_compile():
    from manim import SVGMobject
    from manim.utils.tex_file_writing import tex_to_svg_file

    # No `||` here: spaces on both sides of `||` stay two spaces in the per-segment compiles
    # (each phantom is a box) but collapse in one compile, as they always have for Hebrew.
    line = HebrewMathLine(r"אם \en{the function $f$ is continuous} אז $x>0$", hebrew_font="Alef")
    svg = tex_to_svg_file(line.full_tex, environment="center", tex_template=line._tex_template)
    full = SVGMobject(svg, should_center=False, height=None, stroke_width=0)
    full.scale(line.height / full.height)
    assert abs(full.width - line.width) < 0.005 * line.width


def test_plain_hebrew_line_keeps_its_preamble():
    from hebrew_tex_template import get_hebrew_tex_template

    line = HebrewMathLine(r"אם $x>0$", hebrew_font="Alef")
    assert line._tex_template.preamble == get_hebrew_tex_template(hebrew_font="Alef").preamble


def test_english_font_defaults_to_hebrew_font():
    line = HebrewMathLine(r"אם \en{x}", hebrew_font="Alef")
    assert r"\newfontfamily\englishfont{Alef}" in line._tex_template.preamble
    latin = HebrewMathLine(r"אם \en{x}", hebrew_font="Alef", english_font="Latin Modern Roman")
    assert r"\englishfont" not in latin._tex_template.preamble
