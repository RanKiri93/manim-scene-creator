"""Parse mixed Hebrew + LaTeX-math strings into typed segments.

Two entry-points:

* :func:`parse_segments` – takes a single raw LaTeX string and splits it
  automatically on ``$…$`` boundaries.
* :func:`classify_segments` – takes pre-split parts (as the user typed
  them) and auto-detects whether each part is math or text.

Both return a list of :class:`Segment` objects that carry enough
information to reconstruct the full LaTeX line and to generate
*phantom* variants for isolated per-segment compilation.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum, auto


# ── Segment types ────────────────────────────────────────────────────

class SegmentType(Enum):
    TEXT = auto()
    MATH = auto()


@dataclass
class Segment:
    """One contiguous piece of a mixed Hebrew+math line.

    Attributes
    ----------
    content
        The raw text *without* ``$`` delimiters for math segments,
        or the plain Hebrew/text string for text segments.
    seg_type
        Whether this segment is inline math or regular text.
    """
    content: str
    seg_type: SegmentType

    @property
    def is_math(self) -> bool:
        return self.seg_type is SegmentType.MATH

    @property
    def is_text(self) -> bool:
        return self.seg_type is SegmentType.TEXT

    # -- LaTeX source helpers ------------------------------------------------

    @property
    def latex(self) -> str:
        """The LaTeX source for this segment (with ``$`` for math)."""
        if self.is_math:
            return f"${self.content}$"
        return self.content

    @property
    def phantom_latex(self) -> str:
        r"""The LaTeX source wrapped in ``\phantom`` (same size, invisible)."""
        if self.is_math:
            return rf"$\phantom{{{self.content}}}$"
        return rf"\phantom{{{self.content}}}"

    def __repr__(self) -> str:
        tag = "MATH" if self.is_math else "TEXT"
        return f"Segment({tag}, {self.content!r})"


# ── Auto-split parser ───────────────────────────────────────────────

def _split_text_run_into_segments(text: str) -> list[Segment]:
    r"""Split one text run on ``||`` into multiple TEXT segments.

    ``||`` is not written to LaTeX output — it is only a source delimiter so you
    can colour or animate Hebrew chunks separately.  Math segments use ``$…$``
    as usual; ``||`` inside ``$…$`` is left untouched.
    """
    if "||" not in text:
        return [Segment(content=text, seg_type=SegmentType.TEXT)]
    out: list[Segment] = []
    for piece in text.split("||"):
        if piece == "":
            continue
        out.append(Segment(content=piece, seg_type=SegmentType.TEXT))
    return out if out else [Segment(content="", seg_type=SegmentType.TEXT)]


def parse_segments(raw: str) -> list[Segment]:
    r"""Split a raw LaTeX string on ``$…$`` boundaries.

    Escaped dollar signs (``\$``) are treated as literal characters and
    do **not** delimit math mode.  Display-math ``$$…$$`` is not
    supported (we target inline expressions only).

    Within each **text** run (outside ``$…$``), you may split further with
    ``||`` to create multiple TEXT segments, e.g.
    ``"משפט: || אם || $f(x)$"`` → three text pieces plus math.

    Parameters
    ----------
    raw
        A LaTeX string such as
        ``"משפט: אם $f(x)$ פונקציה רציפה בקטע $[a,b]$"``.

    Returns
    -------
    list[Segment]
        TEXT / MATH segments in order.  Empty pieces are dropped.

    Examples
    --------
    >>> segs = parse_segments(r"אם $f(x)$ רציפה")
    >>> [(s.seg_type.name, s.content) for s in segs]
    [('TEXT', 'אם '), ('MATH', 'f(x)'), ('TEXT', ' רציפה')]

    >>> segs = parse_segments(r"חלק א || חלק ב || חלק ג")
    >>> [s.content for s in segs]
    ['חלק א ', ' חלק ב ', ' חלק ג']
    """
    segments: list[Segment] = []
    # Replace escaped dollars with a placeholder so the split logic
    # doesn't treat them as delimiters.
    _ESCAPED = "\x00"
    cleaned = raw.replace(r"\$", _ESCAPED)

    parts = cleaned.split("$")
    # After splitting on '$', even-indexed parts are text and
    # odd-indexed parts are math.
    for idx, part in enumerate(parts):
        part = part.replace(_ESCAPED, r"\$")
        if not part:
            continue
        if idx % 2 == 1:
            segments.append(Segment(content=part, seg_type=SegmentType.MATH))
        else:
            segments.extend(_split_text_run_into_segments(part))

    return segments


# ── Manual-split classifier ─────────────────────────────────────────

_MATH_RE = re.compile(
    r"^\$.*\$$"        # wrapped in single $
    r"|"
    r"^\\\(.*\\\)$"    # or \( ... \)
    r"|"
    r"^\\\[.*\\\]$",   # or \[ ... \]
    re.DOTALL,
)


def classify_segments(*parts: str) -> list[Segment]:
    r"""Classify pre-split string parts as TEXT or MATH.

    A part is considered **math** if it is wrapped in ``$…$``,
    ``\(…\)``, or ``\[…\]``.  Everything else is **text**.

    Parameters
    ----------
    *parts
        Positional string arguments, e.g.::

            classify_segments("משפט: אם", "$f(x)$", "פונקציה רציפה")

    Returns
    -------
    list[Segment]
        One :class:`Segment` per non-empty input part.

    Examples
    --------
    >>> segs = classify_segments("אם", "$f(x)$", "רציפה")
    >>> [(s.seg_type.name, s.content) for s in segs]
    [('TEXT', 'אם'), ('MATH', 'f(x)'), ('TEXT', 'רציפה')]
    """
    segments: list[Segment] = []
    for part in parts:
        if not part:
            continue
        if _MATH_RE.match(part):
            inner = _strip_math_delimiters(part)
            segments.append(Segment(content=inner, seg_type=SegmentType.MATH))
        else:
            segments.append(Segment(content=part, seg_type=SegmentType.TEXT))
    return segments


def _strip_math_delimiters(s: str) -> str:
    """Remove the outermost math delimiters from *s*."""
    if s.startswith("$") and s.endswith("$"):
        return s[1:-1]
    if s.startswith(r"\(") and s.endswith(r"\)"):
        return s[2:-2]
    if s.startswith(r"\[") and s.endswith(r"\]"):
        return s[2:-2]
    return s


# ── Full-line reconstruction ────────────────────────────────────────

def reconstruct_line(segments: list[Segment]) -> str:
    """Concatenate segments back into a single LaTeX source string."""
    return "".join(seg.latex for seg in segments)


def generate_phantom_source(
    segments: list[Segment],
    visible: int | set[int],
) -> str:
    r"""Build a LaTeX source where only *visible* segment(s) have ink.

    Every other segment is wrapped in ``\phantom{…}`` so it occupies
    the same space but is invisible.  This is the key trick for
    per-segment compilation with correct baseline alignment.

    Parameters
    ----------
    segments
        The full list of segments for the line.
    visible
        Index (or set of indices) of the segment(s) to leave visible.

    Returns
    -------
    str
        A LaTeX source string ready for compilation.

    Examples
    --------
    >>> segs = parse_segments(r"אם $f(x)$ רציפה")
    >>> print(generate_phantom_source(segs, visible=1))
    \phantom{אם }$f(x)$\phantom{ רציפה}
    """
    if isinstance(visible, int):
        visible = {visible}

    pieces: list[str] = []
    for idx, seg in enumerate(segments):
        if idx in visible:
            pieces.append(seg.latex)
        else:
            pieces.append(seg.phantom_latex)
    return "".join(pieces)
