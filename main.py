import os
import sys

# Windows: avoid Rich/Manim logging Unicode → cp1252 console → Logging error on emit.
if sys.platform == "win32":
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from manim import *
from manim.utils.color import ManimColor
from manim_voiceover import VoiceoverScene
from manim_voiceover.services.recorder import RecorderService
from hebrew_math_line import HebrewMathLine
# pip install "manim-voiceover[recorder]"
class Scene1(VoiceoverScene):
    def construct(self):
        # Voice lines mix TTS and recorder — one speech service per scene; using RecorderService.
        # Split scenes or use one mode if you need gTTS-only.
        # mic: pip install "manim-voiceover[recorder]" ; render with --disable_caching
        self.set_speech_service(RecorderService())
        # ========== 1. Definitions (mobjects) ==========

        # Line 1 — to_edge(UP, buff=0.5) → move_to (visible ink; re-measure if text changes)
        Introline_1 = HebrewMathLine(
            r"""\textbf{משפט דיריכלה לטורי פוריה קלאסיים}""",
            font_size=60, hebrew_font="Alef",
        )

        # Line 2 — next_to(Introline_1, DOWN, buff=0.5) → to_edge(RIGHT, buff=0.3) → move_to (visible ink; re-measure if text changes)
        Introline_2 = HebrewMathLine(
            r"""\textbf{משפט:}""",
            r""" תהא """,
            r"""$f(x)$""",
            r""" פונקציה רציפה למקוטעין בקטע """,
            r"""$[-\pi,\pi]$""",
            r""" ויהא""",
            font_size=36, hebrew_font="Alef",
        )

        # Line 3 — next_to(Introline_2, DOWN, buff=0.5) → set_x(0.00)
        Introline_3 = HebrewMathLine(
            r"""$\displaystyle{f\sim\frac{a_0}{2}+\sum\limits_{n=1}^{\infty}a_n\cos{(nx)}+b_n\sin{(nx)}}$""",
            font_size=36, hebrew_font="Alef",
        )

        # Line 4 — next_to(Introline_3, DOWN, buff=0.5) → to_edge(RIGHT, buff=0.3) → move_to (visible ink; re-measure if text changes)
        Introline_4 = HebrewMathLine(
            r"""טור הפוריה הקלאסי של $f$ בקטע. אזי, לכל $x_0\in(-\pi,\pi)$ הטור יתכנס נקודתית לממוצע""",
            font_size=36, hebrew_font="Alef",
        )

        # Line 5 — next_to(Introline_4, DOWN, buff=0.3) → to_edge(RIGHT, buff=0.3) → move_to (visible ink; re-measure if text changes)
        Introline_5 = HebrewMathLine(
            r"""הגבולות החד-צדדיים בנקודה, כלומר:""",
            font_size=36, hebrew_font="Alef",
        )

        # Line 6 — next_to(Introline_5, DOWN, buff=0.5) → set_x(0.00)
        Introline_6 = HebrewMathLine(
            r"""$\displaystyle{\frac{a_0}{2}+\sum\limits_{n=1}^{\infty}a_n\cos{(nx_0)}+b_n\sin{(nx_0)}=\frac{f(x_0^+)+f(x_0^-)}{2}}$""",
            font_size=36, hebrew_font="Alef",
        )

        # Line 7 — next_to(Introline_6, DOWN, buff=0.3) → to_edge(RIGHT, buff=0.3) → move_to (visible ink; re-measure if text changes)
        Introline_7 = HebrewMathLine(
            r"""בנוסף, בקצוות, $x_0=\pm\pi$, הטור יתכנס לערך $\frac{f(-\pi^+)+f(-\pi^-)}{2}$.""",
            font_size=36, hebrew_font="Alef",
        )

        # ========== 2. Positioning ==========
        # UP: visible ink flush to frame (plain to_edge uses LaTeX bbox — huge RTL gap). Uses set_x/set_y so a prior next_to keeps the other axis.
        Introline_1.set_y(config.frame_height/2 - 0.500000 - 0.266667)
        Introline_1[0].set_color(WHITE)
        Introline_2.next_to(Introline_1, DOWN, buff=0.5)
        # RIGHT: visible ink flush to frame (plain to_edge uses LaTeX bbox — huge RTL gap). Uses set_x/set_y so a prior next_to keeps the other axis.
        Introline_2.set_x(config.frame_width/2 - 0.300000 - 4.696296)
        Introline_2[0].set_color(ManimColor("#ffff00"))
        Introline_2[1].set_color(WHITE)
        Introline_2[2].set_color(ManimColor("#00FFFF"))
        Introline_2[3].set_color(WHITE)
        Introline_2[4].set_color(ManimColor("#00FFFF"))
        Introline_2[5].set_color(WHITE)
        Introline_3.next_to(Introline_2, DOWN, buff=0.5)
        Introline_3.set_x(0.000000)
        Introline_3[0].set_color(ManimColor("#00FFFF"))
        Introline_4.next_to(Introline_3, DOWN, buff=0.5)
        # RIGHT: visible ink flush to frame (plain to_edge uses LaTeX bbox — huge RTL gap). Uses set_x/set_y so a prior next_to keeps the other axis.
        Introline_4.set_x(config.frame_width/2 - 0.300000 - 6.414815)
        Introline_4[0].set_color(WHITE)
        Introline_4[1].set_color(ManimColor("#00FFFF"))
        Introline_4[2].set_color(WHITE)
        Introline_4[3].set_color(ManimColor("#00FFFF"))
        Introline_4[4].set_color(WHITE)
        Introline_5.next_to(Introline_4, DOWN, buff=0.3)
        # RIGHT: visible ink flush to frame (plain to_edge uses LaTeX bbox — huge RTL gap). Uses set_x/set_y so a prior next_to keeps the other axis.
        Introline_5.set_x(config.frame_width/2 - 0.300000 - 2.800000)
        Introline_5[0].set_color(WHITE)
        Introline_6.next_to(Introline_5, DOWN, buff=0.5)
        Introline_6.set_x(0.000000)
        Introline_6[0].set_color(ManimColor("#00FFFF"))
        Introline_7.next_to(Introline_6, DOWN, buff=0.3)
        # RIGHT: visible ink flush to frame (plain to_edge uses LaTeX bbox — huge RTL gap). Uses set_x/set_y so a prior next_to keeps the other axis.
        Introline_7.set_x(config.frame_width/2 - 0.300000 - 4.614815)
        Introline_7[0].set_color(WHITE)
        Introline_7[1].set_color(ManimColor("#00FFFF"))
        Introline_7[2].set_color(WHITE)
        Introline_7[3].set_color(ManimColor("#00FFFF"))
        Introline_7[4].set_color(WHITE)

        # ========== 3. Playback / animation ==========
        # Single recording + bookmarks: segment run_time from tracker.time_until_bookmark; last segment max(..., 0.01) if needed. Needs Whisper word boundaries.
        with self.voiceover(text=r"""בסרטון זה נדון וגם נמחיש את<bookmark mark='bm0' />משפט דיריכלה לטורי פוריה קלאסיים""") as tracker:
            self.wait_until_bookmark("bm0")
            self.play(Write(Introline_1), run_time=max(tracker.get_remaining_duration(), 0.01))
        self.wait(0.5000)
        # Single recording + bookmarks: segment run_time from tracker.time_until_bookmark; last segment max(..., 0.01) if needed. Needs Whisper word boundaries.
        with self.voiceover(text=r"""<bookmark mark='bm0' />בנוסף, בקצוות איקס שווה לפלוס מינוס פאי, הטור יתכנס לערך f במינוס פאי פלוס ועוד f בפאי מינוס חלקי שתיים.""") as tracker:
            self.wait_until_bookmark("bm0")
            self.play(Write(Introline_7), run_time=max(tracker.get_remaining_duration(), 0.01))
        self.wait(0.3000)

        #Transition to part2
        