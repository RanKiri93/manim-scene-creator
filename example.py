from manim import *
from manim.utils.color import ManimColor
from hebrew_math_line import HebrewMathLine
from manim_voiceover import VoiceoverScene
from manim_voiceover.services.recorder import RecorderService

class Scene1(VoiceoverScene):
    def construct(self):
        self.set_speech_service(RecorderService())
        # ========== 1. Definitions ==========
        line_1 = HebrewMathLine(
            r"""\textbf{משפט דיריכלה לטורי פוריה קלאסיים}""",
            font_size=60, hebrew_font="Alef",
        )
        line_2 = HebrewMathLine(
            r"""משפט:""",
            r""" תהא """,
            r"""$f(x)$""",
            r""" פונקציה רציפה למקוטעין בקטע """,
            r"""$[a,b]$""",
            r""" ויהא""",
            font_size=48, hebrew_font="Alef",
        )
        line_3 = HebrewMathLine(
            r"""$\displaystyle{f\sim\frac{a_0}{2}+\sum\limits_{n=1}^{\infty}a_n\cos{(nx)}+b_n\sin{(nx)}}$""",
            font_size=36, hebrew_font="Alef",
        )
        line_4 = HebrewMathLine(
            r"""טור הפוריה הקלאסי שלה בקטע. אזי, לכל """,
            r"""$x_0\in\left(-\pi,\pi\right)$""",
            r""", הטור יתכנס""",
            font_size=48, hebrew_font="Alef",
        )
        line_5 = HebrewMathLine(
            r"""נקודתית לממוצע הגבולות החד-צדדיים של """,
            r"""$f$""",
            r""" בנקודה. כלומר לערך:""",
            font_size=48, hebrew_font="Alef",
        )
        line_6 = HebrewMathLine(
            r"""$\displaystyle{\frac{f(x_0^+)+f(x_0^-)}{2}}$""",
            font_size=36, hebrew_font="Alef",
        )
        line_7 = HebrewMathLine(
            r"""כמו כן, בקצוות """,
            r"""$x_0=\pm\pi$""",
            r""", הטור יתכנס לערך """,
            r"""$\frac{f(-\pi^+)+f(\pi^-)}{2}$""",
            r""".""",
            font_size=48, hebrew_font="Alef",
        )

        # ========== 2. Positioning ==========
        line_1.to_edge(UP, buff=0.5)
        line_2.next_to(line_1, DOWN, buff=0.3)
        line_2.to_edge(RIGHT, buff=0.3)
        line_2[2].set_color(ManimColor("#00FFFF"))
        line_2[4].set_color(ManimColor("#00FFFF"))
        line_3.next_to(line_2, DOWN, buff=0.5)
        line_3.set_x(0.000000)
        line_3[0].set_color(ManimColor("#00FFFF"))
        line_4.next_to(line_3, DOWN, buff=0.3)
        line_4.to_edge(RIGHT, buff=0.3)
        line_4[1].set_color(ManimColor("#00FFFF"))
        line_5.next_to(line_4, DOWN, buff=0.3)
        line_5.to_edge(RIGHT, buff=0.3)
        line_5[1].set_color(ManimColor("#00FFFF"))
        line_6.next_to(line_5, DOWN, buff=0.3)
        line_6.set_x(0.000000)
        line_6[0].set_color(ManimColor("#00FFFF"))
        line_7.next_to(line_6, DOWN, buff=0.3)
        line_7.to_edge(RIGHT, buff=0.3)
        line_7[1].set_color(ManimColor("#00FFFF"))
        line_7[3].set_color(ManimColor("#00FFFF"))

        # ========== 3. Playback ==========
        with self.voiceover(text=r"""בסרטון זה נציג ואז נמחיש את<bookmark mark='bm0' />משפט דיריכלה לטורי פוריה קלאסיים""") as tracker:
            self.wait_until_bookmark("bm0")
            self.play(Write(line_1), run_time=max(tracker.get_remaining_duration(), 0.01))
        self.wait(0.3000)
        with self.voiceover(text=r"""נתחיל בנוסח<bookmark mark='bm0' />המשפט. תהא f פונקציה רציפה למקוטעין בקטע a b ויהא""") as tracker:
            self.wait_until_bookmark("bm0")
            self.play(Write(line_2), run_time=max(tracker.get_remaining_duration(), 0.01))
        self.wait(0.3000)
        with self.voiceover(text=r"""<bookmark mark='bm0' />f שווה ל a אפס חלקי שתיים ועוד הסכום שרץ מאחד עד אינסוף של a n קוסינוס n x ועוד b n סינוס n x""") as tracker:
            self.wait_until_bookmark("bm0")
            self.play(Write(line_3), run_time=max(tracker.get_remaining_duration(), 0.01))
        self.wait(0.3000)
        with self.voiceover(text=r"""<bookmark mark='bm0' />טור הפוריה הקלאסי שלה בקטע. אזי, לכל x אפס בין מינוס פאי לפאי, הטור יתכנס""") as tracker:
            self.wait_until_bookmark("bm0")
            self.play(Write(line_4), run_time=max(tracker.get_remaining_duration(), 0.01))
        self.wait(0.3000)
        with self.voiceover(text=r"""<bookmark mark='bm0' />נקודתית לממוצע הגבולות החד-צדדיים של f בנקודה. כלומר לערך""") as tracker:
            self.wait_until_bookmark("bm0")
            self.play(Write(line_5), run_time=max(tracker.get_remaining_duration(), 0.01))
        self.wait(0.3000)
        with self.voiceover(text=r"""<bookmark mark='bm0' />f באיקס אפס פלוס ועוד f באיקס אפס מינוס חלקי שתיים""") as tracker:
            self.wait_until_bookmark("bm0")
            self.play(Write(line_6), run_time=max(tracker.get_remaining_duration(), 0.01))
        self.wait(0.3000)
        with self.voiceover(text=r"""<bookmark mark='bm0' />כמו כן, בקצוות x אפס שווה לפלוס מינוס פאי, הטור יתכנס לערך f במינוס פאי פלוס ועוד f בפאי מינוס חלקי 2""") as tracker:
            self.wait_until_bookmark("bm0")
            self.play(Write(line_7), run_time=max(tracker.get_remaining_duration(), 0.01))
        self.wait(0.3000)
