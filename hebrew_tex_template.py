"""Custom XeTeX template for mixed Hebrew + Math typesetting in Manim.

XeTeX renders Hebrew OpenType fonts and math correctly into .xdv, which
dvisvgm converts to SVG.  However, Manim's ``\\special{dvisvgm:raw}``
group markers produce *empty* ``<g>`` elements in XDV-derived SVGs, so
the standard ``Tex`` / ``MathTex`` substring isolation is broken.

For Phase 1 we provide :func:`get_hebrew_tex_template` (template only)
and :class:`HebrewTex` (a thin wrapper around ``SingleStringMathTex``
that skips the broken grouping).
"""

from __future__ import annotations

from typing import Any

from manim import config
from manim.constants import DEFAULT_FONT_SIZE
from manim.mobject.text.tex_mobject import SingleStringMathTex
from manim.utils.tex import TexTemplate


def get_hebrew_tex_template(
    hebrew_font: str = "David",
    hebrew_font_scale: float | str | None = None,
    math_font: str | None = None,
) -> TexTemplate:
    """Create a TexTemplate that compiles Hebrew + inline math via XeTeX.

    Parameters
    ----------
    hebrew_font
        System font name to use for Hebrew text. Must support Hebrew glyphs.
        Common choices: "David", "FrankRuehl", "Miriam", "Narkisim".
    hebrew_font_scale
        How to scale the Hebrew font in XeLaTeX (polyglossia ``\\hebrewfont``).

        * ``None`` (default) – no ``[Scale=…]`` option; Hebrew uses the font's
          native metrics at the document size, then Manim's ``font_size`` scales
          the SVG consistently with other ``Tex`` objects.
        * ``"MatchLowercase"`` – shrink Hebrew so x-height matches Computer Modern
          (better for mixed Hebrew+math lines; can make **pure Hebrew** look smaller
          than ``font_size`` suggests).
        * ``"MatchUppercase"`` – match cap-height instead.
        * A float like ``1.2`` – explicit ``[Scale=1.2]``.
    math_font
        Optional OpenType math font (e.g. "XITS Math", "Libertinus Math").
        If None, falls back to the default Computer Modern via amsmath.
    """
    math_preamble = ""
    if math_font:
        math_preamble = (
            r"\usepackage{unicode-math}" "\n"
            rf"\setmathfont{{{math_font}}}"
        )

    font_options = ""
    if hebrew_font_scale is not None:
        if isinstance(hebrew_font_scale, str):
            font_options = f"[Scale={hebrew_font_scale}]"
        else:
            font_options = f"[Scale={hebrew_font_scale}]"

    # amsmath must load before polyglossia (Hebrew loads bidi; bidi forbids amsmath after it).
    preamble = "\n".join(filter(None, [
        r"\usepackage{amsmath}",
        r"\usepackage{amssymb}",
        r"\usepackage{polyglossia}",
        r"\setmainlanguage{hebrew}",
        r"\setotherlanguage{english}",
        rf"\newfontfamily\hebrewfont{font_options}{{{hebrew_font}}}",
        math_preamble,
    ]))

    return TexTemplate(
        tex_compiler="xelatex",
        output_format=".xdv",
        preamble=preamble,
        description="Hebrew + Math via XeTeX/polyglossia",
    )


class HebrewTex(SingleStringMathTex):
    """Render a single Hebrew+math string via XeTeX.

    Uses ``SingleStringMathTex`` directly (no dvisvgm:raw specials), so
    the XDV grouping bug is avoided.  The entire expression becomes one
    opaque ``VMobject``; sub-expression isolation will be added in a
    later phase.
    """

    def __init__(
        self,
        tex_string: str,
        *,
        tex_template: TexTemplate | None = None,
        tex_environment: str | None = "center",
        font_size: float = DEFAULT_FONT_SIZE,
        **kwargs: Any,
    ):
        if tex_template is None:
            tex_template = get_hebrew_tex_template()
        super().__init__(
            tex_string,
            tex_template=tex_template,
            tex_environment=tex_environment,
            font_size=font_size,
            **kwargs,
        )
