"""Phase 3 test: HebrewMathLine with individually colored segments."""

from manim import *
from hebrew_math_line import HebrewMathLine


class TestHebrewMathLine(Scene):
    def construct(self):
        # ── Test 1: auto-split with per-segment coloring ────────────
        line = HebrewMathLine(
            r"משפט: אם $f(x)$ פונקציה רציפה בקטע $[a,b]$, אזי $\int_a^x f(t)\,{\rm d}t$ פונקציה גזירה."
        )

        colors = [BLUE, YELLOW, GREEN, RED, PINK, ORANGE, TEAL]
        for i, seg_mob in enumerate(line.submobjects):
            seg_mob.set_color(colors[i % len(colors)])

        self.add(line)


class TestPreSplit(Scene):
    def construct(self):
        # ── Test 2: manual pre-split ────────────────────────────────
        line = HebrewMathLine(
            "משפט: אם",
            "$f(x)$",
            "פונקציה רציפה בקטע",
            "$[a,b]$",
            ", אזי",
            r"$\int_a^x f(t)\,{\rm d}t$",
            "פונקציה גזירה.",
        )

        # Color math segments red, text segments white
        for mob in line.get_text_segments():
            mob.set_color(WHITE)
        for mob in line.get_math_segments():
            mob.set_color(YELLOW)

        self.add(line)


class TestSimple(Scene):
    def construct(self):
        # ── Test 3: simple two-segment case ─────────────────────────
        line = HebrewMathLine(r"אם $x>0$ אזי")
        line[0].set_color(BLUE)
        line[1].set_color(RED)
        line[2].set_color(GREEN)
        self.add(line)
