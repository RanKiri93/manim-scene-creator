"""Test: font choice and font_size parameters."""

from manim import *
from hebrew_math_line import HebrewMathLine


class TestFontAndSize(Scene):
    def construct(self):
        line_david = HebrewMathLine(
            r"אם $f(x)$ רציפה אזי $\int f\,dx$ קיים",
            hebrew_font="David",
            font_size=30,
        )
        label_david = Text("David, 30pt", font_size=18).next_to(line_david, DOWN)

        line_frank = HebrewMathLine(
            r"אם $f(x)$ רציפה אזי $\int f\,dx$ קיים",
            hebrew_font="FrankRuehl",
            font_size=30,
        )
        label_frank = Text("FrankRuehl, 30pt", font_size=18).next_to(line_frank, DOWN)

        line_miriam = HebrewMathLine(
            r"אם $f(x)$ רציפה אזי $\int f\,dx$ קיים",
            hebrew_font="Miriam",
            font_size=30,
        )
        label_miriam = Text("Miriam, 30pt", font_size=18).next_to(line_miriam, DOWN)

        line_big = HebrewMathLine(
            r"אם $f(x)$ רציפה",
            hebrew_font="David",
            font_size=60,
        )
        label_big = Text("David, 60pt", font_size=18).next_to(line_big, DOWN)

        grp = VGroup(
            VGroup(line_david, label_david),
            VGroup(line_frank, label_frank),
            VGroup(line_miriam, label_miriam),
            VGroup(line_big, label_big),
        ).arrange(DOWN, buff=0.5)

        self.add(grp)
