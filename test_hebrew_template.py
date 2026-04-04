"""Phase 1 test: verify the XeTeX Hebrew+Math template compiles and renders."""

from manim import *
from hebrew_tex_template import HebrewTex


class TestHebrewTemplate(Scene):
    def construct(self):
        # --- Test 1: Pure Hebrew text ---
        hebrew_only = HebrewTex(
            r"משפט פונדמנטלי של החשבון האינטגרלי",
        )
        hebrew_only.to_edge(UP)

        # --- Test 2: Pure inline math ---
        math_only = HebrewTex(
            r"$\int_a^b f(x)\,{\rm d}x = F(b) - F(a)$",
        )

        # --- Test 3: Mixed Hebrew + math (the target use-case) ---
        mixed = HebrewTex(
            r"משפט: אם $f(x)$ פונקציה רציפה בקטע $[a,b]$, אזי $\int_a^x f(t)\,{\rm d}t$ פונקציה גזירה.",
        )
        mixed.to_edge(DOWN)

        self.add(hebrew_only, math_only, mixed)
