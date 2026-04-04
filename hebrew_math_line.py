"""HebrewMathLine – a VGroup of individually addressable Hebrew+math segments.

Each segment is compiled in the context of the *full line* (via phantom
overlays), so LaTeX handles baseline alignment, bidi layout, and math-axis
centering natively.  The segments are then overlaid in a single VGroup
where every sub-mobject can be coloured, animated, or voiced independently.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from manim import BLACK, RIGHT, WHITE, config, logger
from manim.constants import DEFAULT_FONT_SIZE, SCALE_FACTOR_PER_FONT_POINT
from manim.mobject.svg.svg_mobject import SVGMobject
from manim.mobject.types.vectorized_mobject import VGroup, VMobject
from manim.utils.tex_file_writing import tex_to_svg_file

from hebrew_math_parser import (
    Segment,
    classify_segments,
    generate_phantom_source,
    parse_segments,
    reconstruct_line,
)
from hebrew_tex_template import get_hebrew_tex_template

from manim.utils.tex import TexTemplate


class HebrewMathLine(VGroup):
    r"""A line of mixed Hebrew + math with individually addressable segments.

    Accepts **either** a single raw LaTeX string (auto-split on ``$…$``)
    **or** multiple pre-split positional arguments (auto-classified as
    text/math).

    Examples
    --------
    Auto-split::

        line = HebrewMathLine(
            r"משפט: אם $f(x)$ רציפה בקטע $[a,b]$"
        )

    Pre-split::

        line = HebrewMathLine(
            "משפט: אם", "$f(x)$", "רציפה בקטע", "$[a,b]$"
        )

    Custom font and size::

        line = HebrewMathLine(
            r"אם $x>0$",
            hebrew_font="FrankRuehl",
            font_size=36,
        )

    Access individual segments for styling / animation::

        line[0].set_color(YELLOW)       # first text segment
        self.play(Write(line[1]))       # animate the math f(x)
    """

    def __init__(
        self,
        *args: str,
        hebrew_font: str | None = None,
        hebrew_font_scale: float | str | None = None,
        math_font: str | None = None,
        tex_template: TexTemplate | None = None,
        tex_environment: str | None = "center",
        font_size: float = DEFAULT_FONT_SIZE,
        color: Any = WHITE,
        **kwargs: Any,
    ):
        if tex_template is not None:
            self._tex_template = tex_template
        else:
            tmpl_kwargs: dict[str, Any] = {}
            if hebrew_font is not None:
                tmpl_kwargs["hebrew_font"] = hebrew_font
            if hebrew_font_scale is not None:
                tmpl_kwargs["hebrew_font_scale"] = hebrew_font_scale
            if math_font is not None:
                tmpl_kwargs["math_font"] = math_font
            self._tex_template = get_hebrew_tex_template(**tmpl_kwargs)
        self._tex_environment = tex_environment
        self._target_color = color

        # ── 1. Parse ────────────────────────────────────────────────
        if len(args) == 1:
            self.segments: list[Segment] = parse_segments(args[0])
        else:
            self.segments = classify_segments(*args)

        self.full_tex: str = reconstruct_line(self.segments)

        # ── 2. Compile each segment via phantom overlay ─────────────
        seg_mobs = self._compile_all_segments()

        # ── 3. Assemble VGroup ──────────────────────────────────────
        super().__init__(*seg_mobs, **kwargs)

        # ── 4. Reorder glyphs for RTL-aware Write animation ────────
        self._sort_glyphs_for_bidi()

        # ── 5. Scale to desired font_size and centre ────────────────
        if self.submobjects and any(m.submobjects for m in self.submobjects):
            scale = font_size * SCALE_FACTOR_PER_FONT_POINT
            self.scale(scale)
            self.center()

    # ── compilation internals ───────────────────────────────────────

    def _compile_all_segments(self) -> list[VMobject]:
        """Return one SVGMobject per segment, all in the same coordinate frame.

        SVGMobject.generate_mobject() flips y via ``self.flip(RIGHT)``,
        using each mobject's own bounding-box centre.  Because each
        phantom-compiled segment has different visible vertical extent,
        the flip centres differ and the shared TeX baseline drifts apart.

        Fix: undo each per-segment flip, then re-flip *all* segments
        around a single common centre so the baseline stays aligned.
        """
        mobs: list[VMobject] = []
        for idx in range(len(self.segments)):
            mob = self._compile_one_segment(idx)
            mob.flip(RIGHT)  # undo per-segment flip
            mobs.append(mob)

        common_center = VGroup(*mobs).get_center()
        for mob in mobs:
            mob.rotate(np.pi, RIGHT, about_point=common_center)
        return mobs

    def _compile_one_segment(self, idx: int) -> VMobject:
        """Compile the line with only segment *idx* visible (rest phantom)."""
        phantom_src = generate_phantom_source(self.segments, visible=idx)
        svg_file = tex_to_svg_file(
            phantom_src,
            environment=self._tex_environment,
            tex_template=self._tex_template,
        )
        mob = SVGMobject(
            file_name=svg_file,
            should_center=False,
            height=None,
            stroke_width=0,
            path_string_config={
                "should_subdivide_sharp_curves": True,
                "should_remove_null_curves": True,
            },
            use_svg_cache=False,
        )
        self._apply_default_color(mob)
        return mob

    def _apply_default_color(self, mob: SVGMobject) -> None:
        """Recolour BLACK paths (TeX default) to the target colour."""
        for sub in mob.submobjects:
            if sub.color == BLACK:
                sub.color = self._target_color
                sub.set_fill(self._target_color)
                sub.set_stroke(self._target_color, width=0)

    # ── bidi glyph ordering ───────────────────────────────────────

    def _sort_glyphs_for_bidi(self) -> None:
        """Reorder glyphs inside each segment for bidi-aware ``Write``.

        * **TEXT** (Hebrew / RTL) segments: glyphs sorted right → left
          so ``Write`` reveals them in natural Hebrew reading order.
        * **MATH** (LTR) segments: glyphs sorted left → right (default).

        The top-level segment order is also set to right → left so that
        ``Write(line)`` reveals the line in Hebrew reading order.
        """
        for seg, mob in zip(self.segments, self.submobjects):
            if not mob.submobjects:
                continue
            reverse = seg.is_text  # RTL for Hebrew text
            mob.submobjects.sort(
                key=lambda m: m.get_center()[0],
                reverse=reverse,
            )

        # Top-level: reveal segments right → left (Hebrew reading order)
        paired = list(zip(self.segments, self.submobjects))
        paired.sort(key=lambda p: p[1].get_center()[0] if p[1].submobjects else 0, reverse=True)
        self.segments = [s for s, _ in paired]
        self.submobjects = [m for _, m in paired]

    # ── convenience accessors ───────────────────────────────────────

    def get_segment(self, idx: int) -> VMobject:
        """Return the mobject for segment *idx*."""
        return self.submobjects[idx]

    def get_text_segments(self) -> list[VMobject]:
        """Return mobjects for all TEXT segments."""
        return [
            self.submobjects[i]
            for i, seg in enumerate(self.segments)
            if seg.is_text
        ]

    def get_math_segments(self) -> list[VMobject]:
        """Return mobjects for all MATH segments."""
        return [
            self.submobjects[i]
            for i, seg in enumerate(self.segments)
            if seg.is_math
        ]
