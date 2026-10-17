"""HebrewMatrix – a LaTeX matrix whose entries, brackets and bar are separate mobjects.

The whole matrix is compiled once as a real LaTeX ``array`` (so TeX does the column
alignment and sizes the brackets), with every entry, each bracket and the augment bar
in its own tag colour.  The SVG paths are then split by colour, so every entry can be
coloured, animated or boxed on its own, like the segments of a ``HebrewMathLine``.
It uses the same Hebrew TeX template as ``HebrewMathLine``.

Example::

    m = HebrewMatrix([["1", "2"], ["3", r"\\lambda"]], bracket="round")
    self.play(Write(m))
    self.play(m.cells((0, 0), (1, 1)).animate.set_color(YELLOW))
"""

from __future__ import annotations

from typing import Any, Iterable, Sequence

import numpy as np
from manim import DOWN, LEFT, RIGHT, UP, WHITE, Line
from manim.constants import DEFAULT_FONT_SIZE
from manim.mobject.svg.svg_mobject import SVGMobject
from manim.mobject.types.vectorized_mobject import VGroup, VMobject
from manim.utils.tex import TexTemplate
from manim.utils.tex_file_writing import tex_to_svg_file

try:
    from manim.constants import SCALE_FACTOR_PER_FONT_POINT
except ImportError:  # older Manim CE: lives on Tex/MathTex module
    from manim.mobject.text.tex_mobject import SCALE_FACTOR_PER_FONT_POINT

from hebrew_tex_template import get_hebrew_tex_template

# ``\left`` / ``\right`` delimiters for each bracket style (empty = no bracket).
BRACKETS: dict[str, tuple[str, str]] = {
    "square": ("[", "]"),
    "round": ("(", ")"),
    "curly": (r"\{", r"\}"),
    "bars": ("|", "|"),
    "double_bars": (r"\|", r"\|"),
    "none": ("", ""),
}
ALIGNS = {"center": "c", "left": "l", "right": "r"}
MAX_SIZE = 12
# LaTeX defaults: \arraycolsep = 5pt, \arraystretch = 1.
BASE_COL_SEP_PT = 5.0

_LEFT_TAG = (250, 1, 1)
_RIGHT_TAG = (250, 1, 2)
_BAR_TAG = (250, 1, 3)


def entry_tag_rgb(k: int) -> tuple[int, int, int]:
    """Tag colour of entry *k* (row-major); never black and never a bracket tag."""
    return (10 + k % 200, 60 + k // 200, 150)


def _rgb(tag: tuple[int, int, int]) -> str:
    return "\\color[RGB]{" + f"{tag[0]},{tag[1]},{tag[2]}" + "}"


def matrix_tex_source(
    entries: Sequence[Sequence[str]],
    bracket: str = "square",
    align: str = "center",
    augment_col: int | None = None,
    row_spacing: float = 1.0,
    col_spacing: float = 1.0,
) -> str:
    r"""Tag-coloured LaTeX for the matrix (inside ``english`` so the columns run left to right).

    ``augment_col`` = number of columns left of the vertical bar (``None`` = no bar).  Each
    entry is its own braced group after its ``\color``, so a leading ``-`` stays a unary minus.
    """
    rows = len(entries)
    cols = len(entries[0]) if rows else 0
    left, right = BRACKETS[bracket]
    a = ALIGNS[align]
    col_specs = [a] * cols
    if augment_col is not None and 0 < augment_col < cols:
        col_specs.insert(augment_col, "!{" + _rgb(_BAR_TAG) + r"\vrule}")
    preamble = "@{}" + "".join(col_specs) + "@{}"
    body_rows = []
    for i, row in enumerate(entries):
        cells = []
        for j, tex in enumerate(row):
            cells.append("{" + _rgb(entry_tag_rgb(i * cols + j)) + "{" + tex + "}}")
        body_rows.append(" & ".join(cells))
    body = r" \\ ".join(body_rows)
    sep = f"{BASE_COL_SEP_PT * col_spacing:.4f}pt"
    array = (
        r"\setlength{\arraycolsep}{" + sep + "}"
        r"\renewcommand{\arraystretch}{" + f"{row_spacing:.4f}" + "}"
        + "$"
        + (_rgb(_LEFT_TAG) + r"\left" + left if left else "")
        + _rgb(_BAR_TAG)
        + r"\begin{array}{" + preamble + "}" + body + r"\end{array}"
        + (_rgb(_RIGHT_TAG) + r"\right" + right if right else "")
        + "$"
    )
    return r"\begin{english}" + array + r"\end{english}"


def _matrix_template(hebrew_font: str | None) -> TexTemplate:
    """The ``HebrewMathLine`` template plus ``xcolor`` (tag colours) and ``array`` (``!{}`` bar)."""
    tmpl = get_hebrew_tex_template(**({"hebrew_font": hebrew_font} if hebrew_font else {})).copy()
    extra = [p for p in (r"\usepackage{xcolor}", r"\usepackage{array}") if p not in tmpl.preamble]
    marker = r"\usepackage{polyglossia}"
    if extra and marker in tmpl.preamble:
        # Both must load before polyglossia (bidi), like amsmath.
        tmpl.preamble = tmpl.preamble.replace(marker, "\n".join(extra) + "\n" + marker, 1)
    elif extra:
        tmpl.preamble = "\n".join(extra) + "\n" + tmpl.preamble
    return tmpl


class HebrewMatrix(VGroup):
    r"""A matrix of LaTeX math entries with individually addressable entries.

    Parameters
    ----------
    entries
        Rows of LaTeX math (no ``$``), all rows the same length; ``""`` = empty cell.
    bracket
        ``"square"``, ``"round"``, ``"curly"``, ``"bars"``, ``"double_bars"`` or ``"none"``.
    align
        Column alignment: ``"center"``, ``"left"`` or ``"right"``.
    augment_col
        Draw a vertical bar after this many columns (augmented matrix); ``None`` = none.
    row_spacing, col_spacing
        Multipliers of LaTeX's row height (``\arraystretch``) and column gap (``\arraycolsep``).
    entry_colors
        Rows of colours (or ``None`` = *color*) per entry.

    Submobjects: ``[entries, brackets, bar]``; use :meth:`get_entry`, :meth:`get_rows`,
    :meth:`get_columns`, :meth:`get_brackets` and :meth:`cells` rather than indexing.
    Empty cells are empty ``VGroup``\ s and are left out of rows, columns and :meth:`cells`.
    """

    def __init__(
        self,
        entries: Sequence[Sequence[str]],
        bracket: str = "square",
        align: str = "center",
        augment_col: int | None = None,
        row_spacing: float = 1.0,
        col_spacing: float = 1.0,
        font_size: float = DEFAULT_FONT_SIZE,
        color: Any = WHITE,
        entry_colors: Sequence[Sequence[Any]] | None = None,
        hebrew_font: str | None = None,
        **kwargs: Any,
    ):
        rows = [list(r) for r in entries]
        if not rows or not rows[0]:
            raise ValueError("HebrewMatrix needs at least one row and one column")
        n_cols = len(rows[0])
        if any(len(r) != n_cols for r in rows):
            raise ValueError("every row of a HebrewMatrix must have the same number of entries")
        if len(rows) > MAX_SIZE or n_cols > MAX_SIZE:
            raise ValueError(f"HebrewMatrix is limited to {MAX_SIZE}x{MAX_SIZE}")
        if bracket not in BRACKETS:
            raise ValueError(f"bracket must be one of {sorted(BRACKETS)}, got {bracket!r}")
        if align not in ALIGNS:
            raise ValueError(f"align must be one of {sorted(ALIGNS)}, got {align!r}")

        self.n_rows = len(rows)
        self.n_cols = n_cols
        self.entry_tex = rows
        self.bracket = bracket
        self.augment_col = augment_col if augment_col is not None and 0 < augment_col < n_cols else None
        self.tex_source = matrix_tex_source(
            rows, bracket, align, self.augment_col, row_spacing, col_spacing
        )

        entry_mobs, left, right, bar = self._compile(_matrix_template(hebrew_font))
        self._entries = VGroup(*entry_mobs)
        self._brackets = VGroup(left, right)
        self._bar = bar
        super().__init__(self._entries, self._brackets, self._bar, **kwargs)

        for i in range(self.n_rows):
            for j in range(self.n_cols):
                c = entry_colors[i][j] if entry_colors and entry_colors[i][j] is not None else color
                self.get_entry(i, j).set_color(c)
        self._brackets.set_color(color)
        self._bar.set_color(color)

        if self.family_members_with_points():
            self.scale(font_size * SCALE_FACTOR_PER_FONT_POINT)
            self.center()

    # ── compilation ────────────────────────────────────────────────

    def _compile(self, template: TexTemplate) -> tuple[list[VGroup], VGroup, VGroup, VGroup]:
        svg_file = tex_to_svg_file(self.tex_source, environment="center", tex_template=template)
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
        n = self.n_rows * self.n_cols
        tag_index = {entry_tag_rgb(k): k for k in range(n)}
        buckets: list[list[VMobject]] = [[] for _ in range(n)]
        left: list[VMobject] = []
        right: list[VMobject] = []
        bar: list[VMobject] = []
        stray: list[VMobject] = []
        for path in mob.family_members_with_points():
            rgb = tuple(int(round(c * 255)) for c in path.get_fill_color().to_rgb())
            path.set_stroke(width=0)
            if rgb in tag_index:
                buckets[tag_index[rgb]].append(path)
            elif rgb == _LEFT_TAG:
                left.append(path)
            elif rgb == _RIGHT_TAG:
                right.append(path)
            elif rgb == _BAR_TAG:
                bar.append(path)
            else:
                stray.append(path)  # an entry that sets its own colour
        mob.submobjects = []
        self._assign_stray(stray, buckets)
        for paths in buckets:
            paths.sort(key=lambda p: (p.get_center()[0], -p.get_center()[1]))
        return [VGroup(*p) for p in buckets], VGroup(*left), VGroup(*right), VGroup(*bar)

    @staticmethod
    def _assign_stray(stray: list[VMobject], buckets: list[list[VMobject]]) -> None:
        """Give each path in a user colour to the entry it sits in (else the nearest one)."""
        boxes = []
        for k, paths in enumerate(buckets):
            if paths:
                g = VGroup(*paths)
                boxes.append((k, g.get_corner(DOWN + LEFT), g.get_corner(UP + RIGHT), g.get_center()))
        if not boxes:
            return
        for path in stray:
            c = path.get_center()
            inside = [k for k, lo, hi, _ in boxes if np.all(c[:2] >= lo[:2]) and np.all(c[:2] <= hi[:2])]
            k = inside[0] if inside else min(boxes, key=lambda b: float(np.linalg.norm(c - b[3])))[0]
            buckets[k].append(path)

    # ── accessors ──────────────────────────────────────────────────

    def get_entry(self, i: int, j: int) -> VGroup:
        """Entry in row *i*, column *j* (0-based); an empty ``VGroup`` for an empty cell."""
        return self._entries[i * self.n_cols + j]

    def get_entries(self) -> VGroup:
        """Every non-empty entry, row by row."""
        return VGroup(*[e for e in self._entries if e.submobjects])

    def get_rows(self) -> VGroup:
        """One ``VGroup`` per row (empty cells left out)."""
        return VGroup(*[self.cells(*[(i, j) for j in range(self.n_cols)]) for i in range(self.n_rows)])

    def get_columns(self) -> VGroup:
        """One ``VGroup`` per column (empty cells left out)."""
        return VGroup(*[self.cells(*[(i, j) for i in range(self.n_rows)]) for j in range(self.n_cols)])

    def get_brackets(self) -> VGroup:
        """``VGroup(left, right)``; both empty when ``bracket="none"``."""
        return self._brackets

    def get_bar(self) -> VGroup:
        """The augment bar (empty without ``augment_col``)."""
        return self._bar

    def cells(self, *ij: tuple[int, int]) -> VGroup:
        """``VGroup`` of the given ``(row, col)`` entries, empty cells left out."""
        return VGroup(*[e for e in (self.get_entry(i, j) for i, j in ij) if e.submobjects])

    def strike_lines(self, ij: Iterable[tuple[int, int]], buff: float = 0.1, **line_kwargs: Any) -> VGroup:
        """Lines crossing out the given cells: one through each complete row and column, a
        diagonal slash through any other cell.  Rows / columns span the entries' ink plus *buff*.
        """
        sel = {(i, j) for i, j in ij}
        full_rows = [i for i in range(self.n_rows) if all((i, j) in sel for j in range(self.n_cols))]
        full_cols = [j for j in range(self.n_cols) if all((i, j) in sel for i in range(self.n_rows))]
        lines = []
        entries = self.get_entries()
        if not entries.submobjects:
            return VGroup()
        left_x = entries.get_left()[0] - buff
        right_x = entries.get_right()[0] + buff
        top_y = entries.get_top()[1] + buff
        bottom_y = entries.get_bottom()[1] - buff
        for i in full_rows:
            row = self.cells(*[(i, j) for j in range(self.n_cols)])
            if row.submobjects:
                y = row.get_center()[1]
                lines.append(Line([left_x, y, 0], [right_x, y, 0], **line_kwargs))
        for j in full_cols:
            col = self.cells(*[(i, j) for i in range(self.n_rows)])
            if col.submobjects:
                x = col.get_center()[0]
                lines.append(Line([x, top_y, 0], [x, bottom_y, 0], **line_kwargs))
        for i, j in sorted(sel):
            if i in full_rows or j in full_cols:
                continue
            e = self.get_entry(i, j)
            if e.submobjects:
                lines.append(
                    Line(e.get_corner(DOWN + LEFT) + (LEFT + DOWN) * buff, e.get_corner(UP + RIGHT) + (RIGHT + UP) * buff, **line_kwargs)
                )
        return VGroup(*lines)
