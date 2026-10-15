"""Parse mixed Hebrew + LaTeX-math strings into typed segments.

Two entry-points:

* :func:`parse_segments` – takes a single raw LaTeX string and splits it
  automatically on ``$…$`` boundaries.
* :func:`classify_segments` – takes pre-split parts (as the user typed
  them) and auto-detects whether each part is math or text.

Both return a list of :class:`Segment` objects that carry enough
information to reconstruct the full LaTeX line and to generate
*phantom* variants for isolated per-segment compilation.

Languages: a line has a base language (``"he"`` for right-to-left lines,
``"en"`` for left-to-right lines).  ``\\en{…}`` / ``\\he{…}`` at brace depth 0
outside math open a run in that language; everything inside it (text and
math, split further by ``$…$`` and ``||``) belongs to the run.  Consecutive
segments in a language other than the base are typeset as one
``\\textenglish{…}`` / ``\\texthebrew{…}`` group, so a run split for timing
keeps its reading order.

Kept in step with ``manim-timeline/src/lib/textSegments.ts`` by
``manim-timeline/src/lib/__fixtures__/segmentParse.json``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum, auto

LANGS = ("he", "en")
_WRAPPERS = {"en": "\\en{", "he": "\\he{"}
_GROUP_CMD = {"en": "\\textenglish", "he": "\\texthebrew"}


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
    lang
        The language run the segment belongs to (``"he"`` or ``"en"``).
        Hebrew text is written right to left; English text and all math
        left to right.
    """
    content: str
    seg_type: SegmentType
    lang: str = "he"

    @property
    def is_math(self) -> bool:
        return self.seg_type is SegmentType.MATH

    @property
    def is_text(self) -> bool:
        return self.seg_type is SegmentType.TEXT

    @property
    def is_rtl(self) -> bool:
        """Whether the segment's glyphs read right to left (Hebrew text)."""
        return self.is_text and self.lang == "he"

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
        return f"Segment({tag}, {self.content!r}, {self.lang})"


def segment_part(seg: Segment, base_lang: str = "he") -> str:
    r"""The ``HebrewMathLine(*parts)`` argument for *seg*.

    Wrapped in ``\en{…}`` / ``\he{…}`` when its language differs from the
    line's base language; :func:`classify_segments` reads it back.
    """
    if seg.lang == base_lang:
        return seg.latex
    return _WRAPPERS[seg.lang] + seg.latex + "}"


# ── Language runs ────────────────────────────────────────────────────

def _matching_brace(s: str, open_idx: int) -> int:
    r"""Index of the ``}`` closing the ``{`` at *open_idx*, or -1. Skips ``\{`` / ``\}``."""
    depth = 0
    i = open_idx
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _split_language_runs(raw: str, base_lang: str) -> list[tuple[str, str]]:
    r"""Split *raw* into ``(lang, chunk)`` runs on top-level ``\en{…}`` / ``\he{…}``.

    A wrapper counts only outside math and at brace depth 0; an unclosed
    wrapper stays plain text.
    """
    runs: list[tuple[str, str]] = []
    buf: list[str] = []
    in_math = False
    depth = 0
    i = 0
    while i < len(raw):
        c = raw[i]
        if c == "\\" and i + 1 < len(raw) and raw[i + 1] in "${}":
            buf.append(raw[i : i + 2])
            i += 2
            continue
        if c == "$":
            in_math = not in_math
        elif not in_math and depth == 0 and c == "\\":
            lang = next((l for l, w in _WRAPPERS.items() if raw.startswith(w, i)), None)
            if lang is not None:
                open_idx = i + len(_WRAPPERS[lang]) - 1
                close = _matching_brace(raw, open_idx)
                if close >= 0:
                    if buf:
                        runs.append((base_lang, "".join(buf)))
                        buf = []
                    runs.append((lang, raw[open_idx + 1 : close]))
                    i = close + 1
                    continue
        elif not in_math and c == "{":
            depth += 1
        elif not in_math and c == "}" and depth > 0:
            depth -= 1
        buf.append(c)
        i += 1
    if buf:
        runs.append((base_lang, "".join(buf)))
    return runs


# ── Auto-split parser ───────────────────────────────────────────────

def _split_text_run_into_segments(text: str, lang: str = "he") -> list[Segment]:
    r"""Split one text run on ``||`` into multiple TEXT segments.

    ``||`` is not written to LaTeX output — it is only a source delimiter so you
    can colour or animate Hebrew chunks separately.  Math segments use ``$…$``
    as usual; ``||`` inside ``$…$`` is left untouched.
    """
    if "||" not in text:
        return [Segment(content=text, seg_type=SegmentType.TEXT, lang=lang)]
    out: list[Segment] = []
    for piece in text.split("||"):
        if piece == "":
            continue
        out.append(Segment(content=piece, seg_type=SegmentType.TEXT, lang=lang))
    # A run made only of ``||`` contributes no segment (same as the editor's parser).
    return out


def _parse_chunk(chunk: str, lang: str) -> list[Segment]:
    """Split one language run on ``$…$`` and ``||``; every segment gets *lang*."""
    segments: list[Segment] = []
    # Replace escaped dollars with a placeholder so the split logic
    # doesn't treat them as delimiters.
    _ESCAPED = "\x00"
    cleaned = chunk.replace(r"\$", _ESCAPED)

    parts = cleaned.split("$")
    # After splitting on '$', even-indexed parts are text and
    # odd-indexed parts are math.
    for idx, part in enumerate(parts):
        part = part.replace(_ESCAPED, r"\$")
        if not part:
            continue
        if idx % 2 == 1:
            segments.append(Segment(content=part, seg_type=SegmentType.MATH, lang=lang))
        else:
            segments.extend(_split_text_run_into_segments(part, lang))

    return segments


def parse_segments(raw: str, base_lang: str = "he") -> list[Segment]:
    r"""Split a raw LaTeX string on ``$…$`` boundaries.

    Escaped dollar signs (``\$``) are treated as literal characters and
    do **not** delimit math mode.  Display-math ``$$…$$`` is not
    supported (we target inline expressions only).

    Within each **text** run (outside ``$…$``), you may split further with
    ``||`` to create multiple TEXT segments, e.g.
    ``"משפט: || אם || $f(x)$"`` → three text pieces plus math.

    ``\en{…}`` / ``\he{…}`` mark a run in that language (see module docs);
    everything else is in *base_lang*.

    Parameters
    ----------
    raw
        A LaTeX string such as
        ``"משפט: אם $f(x)$ פונקציה רציפה בקטע $[a,b]$"``.
    base_lang
        ``"he"`` for a right-to-left line, ``"en"`` for a left-to-right line.

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
    for lang, chunk in _split_language_runs(raw, base_lang):
        segments.extend(_parse_chunk(chunk, lang))
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


def classify_segments(*parts: str, base_lang: str = "he") -> list[Segment]:
    r"""Classify pre-split string parts as TEXT or MATH.

    A part is considered **math** if it is wrapped in ``$…$``,
    ``\(…\)``, or ``\[…\]``.  Everything else is **text**.  A part wrapped
    as a whole in ``\en{…}`` / ``\he{…}`` is in that language (its inside is
    classified the same way); every other part is in *base_lang*.

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
        lang = base_lang
        for wl, w in _WRAPPERS.items():
            if part.startswith(w) and _matching_brace(part, len(w) - 1) == len(part) - 1:
                lang, part = wl, part[len(w) : -1]
                break
        if not part:
            continue
        if _MATH_RE.match(part):
            inner = _strip_math_delimiters(part)
            segments.append(Segment(content=inner, seg_type=SegmentType.MATH, lang=lang))
        else:
            segments.append(Segment(content=part, seg_type=SegmentType.TEXT, lang=lang))
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

def reconstruct_line(segments: list[Segment], base_lang: str = "he") -> str:
    """Concatenate segments back into a single LaTeX source string."""
    return generate_phantom_source(segments, set(range(len(segments))), base_lang)


def generate_phantom_source(
    segments: list[Segment],
    visible: int | set[int],
    base_lang: str = "he",
) -> str:
    r"""Build a LaTeX source where only *visible* segment(s) have ink.

    Every other segment is wrapped in ``\phantom{…}`` so it occupies
    the same space but is invisible.  This is the key trick for
    per-segment compilation with correct baseline alignment.

    Consecutive segments in a language other than *base_lang* share one
    ``\textenglish{…}`` / ``\texthebrew{…}`` group (separate groups would be
    laid out in the base direction and reverse the run).  A left-to-right
    line (``base_lang="en"``) is wrapped in the ``english`` environment.

    Parameters
    ----------
    segments
        The full list of segments for the line.
    visible
        Index (or set of indices) of the segment(s) to leave visible.
    base_lang
        ``"he"`` for a right-to-left line, ``"en"`` for a left-to-right line.

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
    group_lang: str | None = None
    for idx, seg in enumerate(segments):
        foreign = seg.lang if seg.lang != base_lang else None
        if foreign != group_lang:
            if group_lang is not None:
                pieces.append("}")
            if foreign is not None:
                pieces.append(_GROUP_CMD[foreign] + "{")
            group_lang = foreign
        pieces.append(seg.latex if idx in visible else seg.phantom_latex)
    if group_lang is not None:
        pieces.append("}")
    body = "".join(pieces)
    if base_lang == "en":
        return "\\begin{english}" + body + "\\end{english}"
    return body
