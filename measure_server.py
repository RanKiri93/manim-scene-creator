"""Local HTTP API: compile ``HebrewMathLine`` and return Manim-space size (and optional PNG).

Run (from this directory)::

    pip install fastapi uvicorn
    uvicorn measure_server:app --reload --port 8765

POST /measure with JSON body::

    {
      "tex": "אם $x>0$ ...",
      "hebrew_font": "Alef",
      "font_size": 36,
      "math_font": null,
      "include_preview": true
    }

Set ``include_preview`` to ``true`` to also get a Cairo raster of the line (cropped PNG,
base64), matching what Manim draws.

Response::

    { "ok": true, "width": ..., "height": ...,
      "width_ink": ..., "height_ink": ...,  # tight ink from raster (preview); may be < width/height
      "left": ..., "right": ..., "top": ..., "bottom": ...,
      "png_base64": "...", "png_width": ..., "png_height": ... }

Requires the same toolchain as Manim + HebrewMathLine (XeLaTeX, dvisvgm, fonts).

**Future / spike:** per-segment boxes are returned today; exposing stable **math glyph**
sub-boxes (nested under each ``HebrewMathLine`` segment) would require enumerating
submobjects in a deterministic order and versioning that contract with the UI/preview.

**Merge videos:** ``POST /api/concat_mp4`` accepts multiple uploads (multipart field ``files``)
and concatenates them with ``ffmpeg`` (must be on ``PATH``). See endpoint docstring in code.

**Normalize audio:** ``POST /api/normalize_audio`` applies EBU R128 loudness normalization
(ffmpeg ``loudnorm``) to an uploaded file or an existing ``assets/audio/...`` path; requires
``ffmpeg`` and optionally ``ffprobe`` on ``PATH``.

**Axes preview:** ``POST /api/preview_axes`` returns a transparent PNG of ``Axes`` (same config as timeline export).

**Security:** Do not expose this on the public internet without a sandbox: TeX can
execute shell commands if templates are attacker-controlled.

**Bold / italic:** When ``segment_styles`` requests bold or italic, the server builds a
modified LaTeX line (``\\textbf``, ``\\textit``, ``\\mathbf``, ``\\mathit``). If that
fails to compile, it falls back to the original ``tex``. To disable this behaviour
without reverting code, set :data:`APPLY_TEX_BOLD_ITALIC` to ``False`` in
``measure_server.py``.
"""

from __future__ import annotations

import os
import sys
import traceback
import json

# Project root on sys.path when launched from elsewhere
_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def _default_data_root() -> str:
    configured = os.environ.get("MANIM_TIMELINE_DATA_DIR")
    if configured:
        return configured
    if getattr(sys, "frozen", False):
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return os.path.join(base, "Manim Timeline", "measure-server")
    return _ROOT


_DATA_ROOT = _default_data_root()
os.makedirs(_DATA_ROOT, exist_ok=True)
_RENDER_DEBUG_DIR = os.path.join(_DATA_ROOT, "render_debug")

import base64
import re
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from io import BytesIO

import numpy as np
from PIL import Image
from pydantic import BaseModel, Field

from manim import config
from manim.mobject.mobject import Mobject

try:
    from manim.utils.color import ManimColor
except ImportError:  # older Manim CE: no ManimColor wrapper
    ManimColor = None  # type: ignore[misc, assignment]

# Headless-friendly renderer (no OpenGL window)
config.renderer = "cairo"

from hebrew_math_line import HebrewMathLine
from hebrew_math_parser import Segment, parse_segments, reconstruct_line

# Set to False to disable LaTeX wrapping for bold/italic (instant rollback if TeX breaks).
APPLY_TEX_BOLD_ITALIC: bool = True


class SegmentStyleIn(BaseModel):
    """Style for segment at *parse_index* (same order as ``parse_segments(tex)``)."""

    parse_index: int = Field(..., ge=0)
    color: str | None = Field(None, description="CSS hex, e.g. #ffcc00")
    bold: bool = False
    italic: bool = False


class MeasureRequest(BaseModel):
    tex: str = Field(..., description="Full line: Hebrew + $math$ segments")
    hebrew_font: str | None = Field(None, description="Font passed to get_hebrew_tex_template")
    math_font: str | None = None
    font_size: float = 48.0
    include_preview: bool = Field(
        False,
        description="If true, rasterize the line with Manim and return a cropped PNG (base64).",
    )
    segment_styles: list[SegmentStyleIn] | None = Field(
        None,
        description="Per-segment colours (parse order); applied before rasterizing preview.",
    )


class SegmentBoxOut(BaseModel):
    """One ``HebrewMathLine`` submobject bbox in the line's frame (line centered)."""

    cx: float
    cy: float
    w: float
    h: float
    is_math: bool | None = None


class MathChildBoxOut(BaseModel):
    """Nested submobject inside one math segment; index matches ``line[seg][child]`` after BIDI sort."""

    child_index: int
    cx: float
    cy: float
    w: float
    h: float


class MathSegmentChildrenOut(BaseModel):
    segment_index: int
    children: list[MathChildBoxOut]


class MeasureResponse(BaseModel):
    ok: bool
    width: float | None = None
    height: float | None = None
    # Tight horizontal/vertical extent of visible ink (from raster), in Manim units — use for UI preview.
    # May be smaller than width/height when the axis-aligned VGroup bbox has empty margin (e.g. RTL lines).
    width_ink: float | None = None
    height_ink: float | None = None
    # Corners in Manim space (line is centred at origin after HebrewMathLine.__init__)
    left: float | None = None
    right: float | None = None
    top: float | None = None
    bottom: float | None = None
    png_base64: str | None = None
    png_width: int | None = None
    png_height: int | None = None
    # Ink bbox center minus mobject center (Manim units) — preview chip must be shifted by this
    # so raster aligns with video; RTL lines often have ink shifted vs symmetric VGroup bbox.
    offset_ink_x: float | None = None
    offset_ink_y: float | None = None
    # Ink bbox edges in Manim coords when mobject center is at origin (matches raster columns/rows).
    ink_left_x: float | None = None
    ink_right_x: float | None = None
    ink_top_y: float | None = None
    ink_bottom_y: float | None = None
    segment_boxes: list[SegmentBoxOut] | None = None
    math_child_boxes: list[MathSegmentChildrenOut] | None = None
    error: str | None = None


class AxesPreviewRequest(BaseModel):
    """JSON body for raster preview of coordinate axes (matches timeline export fields)."""

    x_range: tuple[float, float, float] = Field(..., description="x_min, x_max, x_step")
    y_range: tuple[float, float, float] = Field(..., description="y_min, y_max, y_step")
    scale_x: float = Field(1.0, ge=0.01)
    scale_y: float = Field(1.0, ge=0.01)
    x_label: str = ""
    y_label: str = ""
    include_numbers: bool = False
    include_tip: bool = True
    axis_color: str | None = None
    axis_stroke_width: float | None = Field(None, ge=0.5)
    tick_length: float | None = Field(None, ge=0.01)
    tick_color: str | None = None
    tick_stroke_width: float | None = Field(None, ge=0.5)
    number_color: str | None = None
    number_font_size: float | None = Field(None, ge=1.0)
    tip_shape: str | None = Field(None, description="Manim tip class name, e.g. StealthTip")
    tip_height: float | None = Field(None, ge=0.05)
    tip_width: float | None = Field(None, ge=0.05)
    tip_stroke_width: float | None = Field(None, ge=0.0)
    tip_fill_opacity: float | None = Field(None, ge=0.0, le=1.0)


class AxesPreviewResponse(BaseModel):
    ok: bool
    png_base64: str | None = None
    png_width: int | None = None
    png_height: int | None = None
    left: float | None = None
    right: float | None = None
    top: float | None = None
    bottom: float | None = None
    offset_ink_x: float | None = None
    offset_ink_y: float | None = None
    error: str | None = None


def mobject_to_cropped_png_base64(
    mob: Mobject,
) -> tuple[str, int, int, float, float, float, float, float, float, float, float]:
    """Rasterize *mob*, crop to ink, return PNG + pixel size + ink extents in Manim units.

    **Critical:** ``mob.get_image()`` renders onto a **full-frame Camera**
    (``config.frame_width × config.frame_height``), NOT just the mobject bbox.
    Pixel↔Manim mapping must use the *camera frame*, not mob edges.
    """
    frame_w = float(config.frame_width)
    frame_h = float(config.frame_height)

    img = mob.get_image()
    pil_rgba = img.convert("RGBA")
    arr = np.asarray(pil_rgba, dtype=np.uint8).copy()
    hpx, wpx = arr.shape[0], arr.shape[1]

    # Manim scene background is black; make it transparent
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    is_bg = (r <= 12) & (g <= 12) & (b <= 12)
    arr[is_bg] = (0, 0, 0, 0)

    mask = arr[:, :, 3] > 10
    if not np.any(mask) or wpx <= 0 or hpx <= 0:
        tiny = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
        buf = BytesIO()
        tiny.save(buf, format="PNG")
        fw = float(mob.get_width())
        fh = float(mob.get_height())
        return (
            base64.b64encode(buf.getvalue()).decode("ascii"),
            1, 1, fw, fh, 0.0, 0.0,
            float(mob.get_left()[0]), float(mob.get_right()[0]),
            float(mob.get_top()[1]), float(mob.get_bottom()[1]),
        )

    rows = np.where(np.any(mask, axis=1))[0]
    cols = np.where(np.any(mask, axis=0))[0]
    y0, y1 = int(rows[0]), int(rows[-1])
    x0, x1 = int(cols[0]), int(cols[-1])
    pad = 2
    y0 = max(0, y0 - pad)
    y1 = min(hpx - 1, y1 + pad)
    x0 = max(0, x0 - pad)
    x1 = min(wpx - 1, x1 + pad)

    # Pixel↔Manim: full-frame camera, origin at center.
    #   col c  →  x = -frame_w/2 + c/wpx * frame_w
    #   row r  →  y = +frame_h/2 - r/hpx * frame_h
    ink_left_x   = -frame_w / 2 + x0 / wpx * frame_w
    ink_right_x  = -frame_w / 2 + (x1 + 1) / wpx * frame_w
    ink_top_y    =  frame_h / 2 - y0 / hpx * frame_h
    ink_bottom_y =  frame_h / 2 - (y1 + 1) / hpx * frame_h

    ink_w = max(ink_right_x - ink_left_x, 1e-12)
    ink_h = max(ink_top_y - ink_bottom_y, 1e-12)

    cx_mob = float(mob.get_center()[0])
    cy_mob = float(mob.get_center()[1])
    off_x = (ink_left_x + ink_right_x) / 2.0 - cx_mob
    off_y = (ink_top_y + ink_bottom_y) / 2.0 - cy_mob

    cropped = arr[y0 : y1 + 1, x0 : x1 + 1]
    out = Image.fromarray(cropped, mode="RGBA")
    buf = BytesIO()
    out.save(buf, format="PNG")
    return (
        base64.b64encode(buf.getvalue()).decode("ascii"),
        out.width,
        out.height,
        ink_w,
        ink_h,
        off_x,
        off_y,
        ink_left_x,
        ink_right_x,
        ink_top_y,
        ink_bottom_y,
    )


def _wrap_segment_for_style(seg: Segment, bold: bool, italic: bool) -> Segment:
    """Wrap segment content with standard LaTeX (polyglossia + amsmath).

    Skips wrapping if ``{`` / ``}`` appear in content (avoid brittle TeX).
    """
    if not bold and not italic:
        return seg
    c = seg.content
    if "{" in c or "}" in c:
        return seg
    if seg.is_math:
        if bold and italic:
            c = rf"\mathbf{{\mathit{{{c}}}}}"
        elif bold:
            c = rf"\mathbf{{{c}}}"
        else:
            c = rf"\mathit{{{c}}}"
    else:
        if bold and italic:
            c = rf"\textbf{{\textit{{{c}}}}}"
        elif bold:
            c = rf"\textbf{{{c}}}"
        else:
            c = rf"\textit{{{c}}}"
    return Segment(c, seg.seg_type)


def _segments_with_style_wraps(tex: str, styles: list[SegmentStyleIn] | None) -> list[Segment]:
    """Same segment list as ``parse_segments(tex)``, with bold/italic LaTeX wraps applied per style."""
    parsed = parse_segments(tex)
    if not APPLY_TEX_BOLD_ITALIC or not styles:
        return parsed
    if not any(s.bold or s.italic for s in styles):
        return parsed
    by_j = {s.parse_index: s for s in styles}
    new_segs: list[Segment] = []
    for j, seg in enumerate(parsed):
        st = by_j.get(j)
        if st is not None and (st.bold or st.italic):
            new_segs.append(_wrap_segment_for_style(seg, st.bold, st.italic))
        else:
            new_segs.append(seg)
    return new_segs


def _build_styled_tex(tex: str, styles: list[SegmentStyleIn] | None) -> str:
    """Legacy single-string reconstruction (merges adjacent TEXT segments — do not use for HebrewMathLine)."""
    segs = _segments_with_style_wraps(tex, styles)
    return reconstruct_line(segs)


def _content_matches_after_style_wrap(pu: Segment, ls: Segment) -> bool:
    """Whether *ls* is *pu* or the result of ``_wrap_segment_for_style`` on *pu* for some bold/italic flags."""
    if pu.seg_type != ls.seg_type:
        return False
    if pu.content == ls.content:
        return True
    for bold in (False, True):
        for italic in (False, True):
            if not bold and not italic:
                continue
            w = _wrap_segment_for_style(pu, bold, italic)
            if w.content == ls.content:
                return True
    return False


def _map_parse_index_to_line_index(line: HebrewMathLine, req_tex: str) -> list[int]:
    """Map client parse-order index *j* (``parse_segments(req_tex)``) to ``line`` submobject index after RTL reorder."""
    parsed = parse_segments(req_tex)
    line_segs = list(line.segments)
    n = len(parsed)
    if n != len(line_segs) or n != len(line.submobjects):
        return [min(i, len(line.submobjects) - 1) for i in range(min(n, len(line.submobjects)))]
    remaining: list[tuple[int, object]] = list(enumerate(line_segs))
    out = [-1] * n
    for j, ps in enumerate(parsed):
        for k, (li, ls) in enumerate(remaining):
            if _content_matches_after_style_wrap(ps, ls):
                out[j] = li
                remaining.pop(k)
                break
    return out


def _apply_segment_styles(line: HebrewMathLine, req_tex: str, styles: list[SegmentStyleIn]) -> None:
    mapping = _map_parse_index_to_line_index(line, req_tex)
    for st in styles:
        j = st.parse_index
        if j < 0 or j >= len(mapping):
            continue
        li = mapping[j]
        if li < 0 or li >= len(line.submobjects):
            continue
        mob = line[li]
        if st.color:
            try:
                if ManimColor is not None:
                    mob.set_color(ManimColor(st.color))
                else:
                    mob.set_color(st.color)
            except Exception:
                mob.set_color(st.color)


def measure_line(req: MeasureRequest) -> MeasureResponse:
    try:
        kwargs: dict = {"font_size": req.font_size}
        if req.hebrew_font is not None:
            kwargs["hebrew_font"] = req.hebrew_font
        if req.math_font is not None:
            kwargs["math_font"] = req.math_font

        use_multi_arg = bool(
            req.segment_styles
            and APPLY_TEX_BOLD_ITALIC
            and any(s.bold or s.italic for s in req.segment_styles)
        )
        try:
            if use_multi_arg:
                styled_segs = _segments_with_style_wraps(req.tex, req.segment_styles)
                line = HebrewMathLine(*[s.latex for s in styled_segs], **kwargs)
            else:
                line = HebrewMathLine(req.tex, **kwargs)
        except Exception:
            if use_multi_arg:
                try:
                    line = HebrewMathLine(req.tex, **kwargs)
                except Exception:
                    raise
            else:
                raise
        w = float(line.get_width())
        h = float(line.get_height())

        png_b64: str | None = None
        pw: int | None = None
        ph: int | None = None
        w_ink: float | None = None
        h_ink: float | None = None
        ox_ink: float | None = None
        oy_ink: float | None = None
        ilx = irx = ity = iby = None
        if req.include_preview:
            if req.segment_styles:
                _apply_segment_styles(line, req.tex, req.segment_styles)
            (
                png_b64,
                pw,
                ph,
                w_ink,
                h_ink,
                ox_ink,
                oy_ink,
                ilx,
                irx,
                ity,
                iby,
            ) = mobject_to_cropped_png_base64(line)
        else:
            png_b64 = None
            pw = ph = None
            w_ink, h_ink = w, h
            ox_ink, oy_ink = 0.0, 0.0
            ilx = float(line.get_left()[0])
            irx = float(line.get_right()[0])
            ity = float(line.get_top()[1])
            iby = float(line.get_bottom()[1])

        seg_boxes: list[SegmentBoxOut] = []
        for i, sub in enumerate(line):
            c = sub.get_center()
            seg = line.segments[i] if i < len(line.segments) else None
            seg_boxes.append(
                SegmentBoxOut(
                    cx=float(c[0]),
                    cy=float(c[1]),
                    w=float(sub.get_width()),
                    h=float(sub.get_height()),
                    is_math=bool(getattr(seg, "is_math", False)) if seg is not None else None,
                )
            )

        _MIN_BOX = 1e-3
        math_child_boxes: list[MathSegmentChildrenOut] = []
        for i, sub in enumerate(line):
            seg = line.segments[i] if i < len(line.segments) else None
            is_math = bool(getattr(seg, "is_math", False)) if seg is not None else False
            if not is_math:
                continue
            kids: list[MathChildBoxOut] = []
            for j, ch in enumerate(sub.submobjects):
                cw = float(ch.get_width())
                chh = float(ch.get_height())
                if cw < _MIN_BOX and chh < _MIN_BOX:
                    continue
                cc = ch.get_center()
                kids.append(
                    MathChildBoxOut(
                        child_index=j,
                        cx=float(cc[0]),
                        cy=float(cc[1]),
                        w=cw,
                        h=chh,
                    )
                )
            if kids:
                math_child_boxes.append(
                    MathSegmentChildrenOut(segment_index=i, children=kids)
                )

        return MeasureResponse(
            ok=True,
            width=w,
            height=h,
            width_ink=w_ink,
            height_ink=h_ink,
            offset_ink_x=ox_ink,
            offset_ink_y=oy_ink,
            ink_left_x=ilx,
            ink_right_x=irx,
            ink_top_y=ity,
            ink_bottom_y=iby,
            left=float(line.get_left()[0]),
            right=float(line.get_right()[0]),
            top=float(line.get_top()[1]),
            bottom=float(line.get_bottom()[1]),
            png_base64=png_b64,
            png_width=pw,
            png_height=ph,
            segment_boxes=seg_boxes or None,
            math_child_boxes=math_child_boxes or None,
        )
    except Exception as e:
        return MeasureResponse(
            ok=False,
            error=f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
        )


def _manim_color_maybe(hex_str: str) -> object:
    s = hex_str.strip()
    if not s:
        return s
    if ManimColor is not None:
        try:
            return ManimColor(s)
        except Exception:
            return s
    return s


def _resolve_tip_shape_class(name: str | None) -> type | None:
    if not name:
        return None
    n = name.strip()
    if not n or n.lower() == "default":
        return None
    try:
        import manim as m

        cls = getattr(m, n, None)
        return cls if isinstance(cls, type) else None
    except Exception:
        return None


def preview_axes_raster(req: AxesPreviewRequest) -> AxesPreviewResponse:
    """Build ``Axes`` like the timeline exporter and return a transparent cropped PNG."""
    try:
        from manim import Axes, ORIGIN, VGroup

        x_min, x_max, x_step = req.x_range
        y_min, y_max, y_step = req.y_range
        x_length = float((x_max - x_min) * req.scale_x)
        y_length = float((y_max - y_min) * req.scale_y)

        axis_config: dict = {}
        if req.include_numbers:
            axis_config["include_numbers"] = True

        dec_cfg: dict = {}
        if req.number_color and req.number_color.strip():
            dec_cfg["color"] = _manim_color_maybe(req.number_color)
        if req.number_font_size is not None:
            dec_cfg["font_size"] = float(req.number_font_size)
        if dec_cfg:
            axis_config["decimal_number_config"] = dec_cfg

        if req.axis_color and req.axis_color.strip():
            axis_config["stroke_color"] = _manim_color_maybe(req.axis_color)
        if req.axis_stroke_width is not None:
            axis_config["stroke_width"] = float(req.axis_stroke_width)
        if req.tick_length is not None:
            axis_config["tick_size"] = float(req.tick_length)

        if req.include_tip:
            tip_cls = _resolve_tip_shape_class(req.tip_shape)
            if tip_cls is not None:
                axis_config["tip_shape"] = tip_cls
            if req.tip_height is not None:
                axis_config["tip_height"] = float(req.tip_height)
            if req.tip_width is not None:
                axis_config["tip_width"] = float(req.tip_width)

        kwargs: dict = {
            "x_range": [x_min, x_max, x_step],
            "y_range": [y_min, y_max, y_step],
            "x_length": x_length,
            "y_length": y_length,
        }
        if not req.include_tip:
            kwargs["tips"] = False
        if axis_config:
            kwargs["axis_config"] = axis_config

        ax = Axes(**kwargs)

        tick_kw: dict = {}
        if req.tick_color and req.tick_color.strip():
            tick_kw["color"] = _manim_color_maybe(req.tick_color)
        if req.tick_stroke_width is not None:
            tick_kw["width"] = float(req.tick_stroke_width)
        if tick_kw:
            for axis in (ax.x_axis, ax.y_axis):
                if hasattr(axis, "ticks"):
                    axis.ticks.set_stroke(**tick_kw)

        if req.include_tip and (
            req.tip_stroke_width is not None or req.tip_fill_opacity is not None
        ):
            for _tip in (ax.x_axis.tip, ax.y_axis.tip):
                if _tip is None:
                    continue
                if req.tip_stroke_width is not None:
                    _tip.set_stroke(width=float(req.tip_stroke_width))
                if req.tip_fill_opacity is not None:
                    _tip.set_fill(opacity=float(req.tip_fill_opacity))

        parts: list = [ax]
        xl = req.x_label.strip() if req.x_label else ""
        yl = req.y_label.strip() if req.y_label else ""
        if xl:
            parts.append(ax.get_x_axis_label(xl))
        if yl:
            parts.append(ax.get_y_axis_label(yl))
        grp = VGroup(*parts)
        grp.move_to(ORIGIN)

        (
            png_b64,
            pw,
            ph,
            _w_ink,
            _h_ink,
            ox_ink,
            oy_ink,
            ilx,
            irx,
            ity,
            iby,
        ) = mobject_to_cropped_png_base64(grp)

        return AxesPreviewResponse(
            ok=True,
            png_base64=png_b64,
            png_width=pw,
            png_height=ph,
            left=float(ilx),
            right=float(irx),
            top=float(ity),
            bottom=float(iby),
            offset_ink_x=float(ox_ink),
            offset_ink_y=float(oy_ink),
        )
    except Exception as e:
        return AxesPreviewResponse(
            ok=False,
            error=f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
        )


try:
    from fastapi import FastAPI, File, Form, HTTPException, UploadFile
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles
    from starlette.background import BackgroundTask

    app = FastAPI(title="HebrewMathLine measure", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
        # Chrome: fetch from http://localhost:5173 → http://127.0.0.1:8765 needs this on preflight.
        allow_private_network=True,
    )

    _AUDIO_ASSETS_DIR = os.path.join(_DATA_ROOT, "assets", "audio")
    os.makedirs(_AUDIO_ASSETS_DIR, exist_ok=True)

    class GenerateAudioRequest(BaseModel):
        text: str = Field(..., description="Text to synthesize")
        lang: str = Field("iw", description="Language code (e.g. iw → Hebrew for gTTS/Whisper)")

    class WordBoundaryOut(BaseModel):
        word: str
        start: float
        end: float

    class GenerateAudioResponse(BaseModel):
        """TTS output; *file_path* is stored under static ``/assets/audio/`` like upload."""

        audio_base64: str
        duration: float
        word_boundaries: list[WordBoundaryOut]
        file_path: str

    _whisper_model = None

    def _whisper_language_code(lang: str | None) -> str:
        incoming = (lang or "iw").strip().lower()
        if incoming in ("he", "iw"):
            return "he"
        return incoming or "he"

    def _get_whisper_model():
        global _whisper_model
        if _whisper_model is None:
            import whisper

            model_dir = os.environ.get("MANIM_TIMELINE_WHISPER_MODEL_DIR")
            if model_dir and os.path.isdir(model_dir):
                _whisper_model = whisper.load_model("base", download_root=model_dir)
            else:
                _whisper_model = whisper.load_model("base")
        return _whisper_model

    def _word_boundaries_from_whisper_result(result: dict) -> list[dict[str, float | str]]:
        word_boundaries: list[dict[str, float | str]] = []
        for seg in result.get("segments") or []:
            for w in seg.get("words") or []:
                raw = w.get("word") or ""
                word_boundaries.append(
                    {
                        "word": raw.strip(),
                        "start": float(w.get("start", 0.0)),
                        "end": float(w.get("end", 0.0)),
                    }
                )
        if not word_boundaries:
            for seg in result.get("segments") or []:
                txt = (seg.get("text") or "").strip()
                word_boundaries.append(
                    {
                        "word": txt or "...",
                        "start": float(seg.get("start", 0.0)),
                        "end": float(seg.get("end", 0.0)),
                    }
                )
        return word_boundaries

    def _duration_from_boundaries_or_result(
        word_boundaries: list[dict[str, float | str]],
        result: dict,
        abs_path: str | None = None,
    ) -> float:
        duration = 0.0
        for wb in word_boundaries:
            duration = max(duration, float(wb["end"]))
        if duration <= 0.0 and result.get("segments"):
            duration = float(result["segments"][-1].get("end", 0.0))
        if duration <= 0.0 and abs_path:
            try:
                duration = _ffprobe_duration_seconds(abs_path)
            except Exception:
                duration = 0.0
        return duration

    def _script_words(script: str | None) -> list[str]:
        if not script:
            return []
        return [w.strip() for w in re.findall(r"\S+", script) if w.strip()]

    def _align_script_to_word_timings(
        script: str | None,
        word_boundaries: list[dict[str, float | str]],
        duration: float,
    ) -> list[dict[str, float | str]]:
        """Use the provided script as transcript text while preserving Whisper timing shape."""
        words = _script_words(script)
        if not words:
            return word_boundaries

        if not word_boundaries:
            if duration <= 0.0:
                return [{"word": word, "start": 0.0, "end": 0.0} for word in words]
            step = duration / max(len(words), 1)
            return [
                {"word": word, "start": i * step, "end": (i + 1) * step}
                for i, word in enumerate(words)
            ]

        if len(words) == len(word_boundaries):
            return [
                {
                    "word": word,
                    "start": float(src["start"]),
                    "end": float(src["end"]),
                }
                for word, src in zip(words, word_boundaries)
            ]

        n = len(word_boundaries)
        m = len(words)
        aligned: list[dict[str, float | str]] = []
        for i, word in enumerate(words):
            start_idx = min(n - 1, int(i * n / m))
            end_idx = min(n - 1, max(start_idx, int(((i + 1) * n + m - 1) / m) - 1))
            start = float(word_boundaries[start_idx]["start"])
            end = float(word_boundaries[end_idx]["end"])
            if end <= start:
                next_start = (
                    float(word_boundaries[min(n - 1, end_idx + 1)]["start"])
                    if end_idx + 1 < n
                    else duration
                )
                end = max(start + 0.01, next_start)
            aligned.append({"word": word, "start": start, "end": end})
        return aligned

    @app.post("/measure", response_model=MeasureResponse)
    def measure(req: MeasureRequest) -> MeasureResponse:
        return measure_line(req)

    @app.post("/api/preview_axes", response_model=AxesPreviewResponse)
    def preview_axes(req: AxesPreviewRequest) -> AxesPreviewResponse:
        return preview_axes_raster(req)

    @app.post("/api/generate_audio", response_model=GenerateAudioResponse)
    def generate_audio(req: GenerateAudioRequest) -> GenerateAudioResponse:
        try:
            from gtts import gTTS
        except ImportError as e:
            raise HTTPException(status_code=501, detail=f"gTTS not installed: {e}") from e
        try:
            import whisper
        except ImportError as e:
            raise HTTPException(status_code=501, detail=f"openai-whisper not installed: {e}") from e

        incoming = (req.lang.strip() or "iw")
        if incoming in ("he", "iw"):
            tts_lang = "iw"
        else:
            tts_lang = incoming
        whisper_lang = _whisper_language_code(incoming)
        tmp_path = None
        abs_saved: str | None = None
        try:
            fd, tmp_path = tempfile.mkstemp(suffix=".mp3")
            os.close(fd)
            gTTS(text=req.text, lang=tts_lang).save(tmp_path)

            filename = f"{uuid.uuid4().hex}.mp3"
            rel_path = f"assets/audio/{filename}"
            abs_saved = os.path.join(_AUDIO_ASSETS_DIR, filename)
            shutil.copy2(tmp_path, abs_saved)

            with open(abs_saved, "rb") as f:
                audio_b64 = base64.b64encode(f.read()).decode("ascii")

            model = _get_whisper_model()
            result = model.transcribe(
                abs_saved,
                word_timestamps=True,
                language=whisper_lang,
            )

            raw_boundaries = _word_boundaries_from_whisper_result(result)
            duration = _duration_from_boundaries_or_result(raw_boundaries, result, abs_saved)
            word_boundaries = [
                WordBoundaryOut(
                    word=str(wb["word"]),
                    start=float(wb["start"]),
                    end=float(wb["end"]),
                )
                for wb in _align_script_to_word_timings(req.text, raw_boundaries, duration)
            ]

            return GenerateAudioResponse(
                audio_base64=audio_b64,
                duration=duration,
                word_boundaries=word_boundaries,
                file_path=rel_path,
            )
        except HTTPException:
            raise
        except Exception as e:
            if abs_saved and os.path.isfile(abs_saved):
                try:
                    os.unlink(abs_saved)
                except OSError:
                    pass
            raise HTTPException(
                status_code=500,
                detail=f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
            ) from e
        finally:
            if tmp_path and os.path.isfile(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    @app.post("/api/upload_audio")
    async def upload_audio(
        file: UploadFile = File(...),
        lang: str = Form("iw"),
        script: str = Form(""),
        transcribe: str = Form("true"),
    ) -> dict[str, object]:
        ext = os.path.splitext(file.filename or "")[1] or ".webm"
        filename = f"{uuid.uuid4().hex}{ext}"
        rel_path = f"assets/audio/{filename}"
        abs_path = os.path.join(_AUDIO_ASSETS_DIR, filename)

        try:
            body = await file.read()
            with open(abs_path, "wb") as out_f:
                shutil.copyfileobj(BytesIO(body), out_f)

            skip_transcription = transcribe.strip().lower() in ("false", "0", "no")
            if skip_transcription:
                return {
                    "file_path": rel_path,
                    "duration": _ffprobe_duration_seconds(abs_path),
                    "word_boundaries": [],
                    "transcription_source": "skipped",
                }

            try:
                import whisper  # noqa: F401
            except ImportError:
                return {
                    "file_path": rel_path,
                    "duration": _ffprobe_duration_seconds(abs_path),
                    "word_boundaries": [],
                    "transcription_error": "openai-whisper not installed",
                }

            model = _get_whisper_model()
            result = model.transcribe(
                abs_path,
                word_timestamps=True,
                language=_whisper_language_code(lang),
            )

            raw_boundaries = _word_boundaries_from_whisper_result(result)
            duration = _duration_from_boundaries_or_result(raw_boundaries, result, abs_path)
            word_boundaries = _align_script_to_word_timings(script, raw_boundaries, duration)
            print(f"DEBUG: Found {len(word_boundaries)} words")
            return {
                "file_path": rel_path,
                "duration": duration,
                "word_boundaries": word_boundaries,
                "transcription_source": "script" if _script_words(script) else "whisper",
            }
        except HTTPException:
            raise
        except Exception as e:
            if os.path.isfile(abs_path):
                try:
                    os.unlink(abs_path)
                except OSError:
                    pass
            raise HTTPException(
                status_code=500,
                detail=f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
            ) from e

    @app.post("/api/sync_audio_asset")
    async def sync_audio_asset(
        rel_path: str = Form(...),
        file: UploadFile = File(...),
    ) -> dict[str, object]:
        """Persist a bundled project audio asset at its exported ``assets/audio/...`` path."""
        abs_path = _resolve_safe_audio_asset_target(rel_path)
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        try:
            body = await file.read()
            with open(abs_path, "wb") as out_f:
                shutil.copyfileobj(BytesIO(body), out_f)
            return {
                "file_path": rel_path.strip().replace("\\", "/"),
                "bytes": len(body),
            }
        except Exception as e:
            if os.path.isfile(abs_path):
                try:
                    os.unlink(abs_path)
                except OSError:
                    pass
            raise HTTPException(
                status_code=500,
                detail=f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
            ) from e

    def _which_ffmpeg() -> str | None:
        return shutil.which("ffmpeg")

    def _which_ffprobe() -> str | None:
        return shutil.which("ffprobe")

    def _resolve_safe_audio_asset(rel: str) -> str:
        """Resolve a repo-relative ``assets/audio/...`` path to an absolute file under ``_AUDIO_ASSETS_DIR``."""
        raw = (rel or "").strip().replace("\\", "/")
        if not raw or ".." in raw or raw.startswith("/"):
            raise HTTPException(status_code=400, detail="Invalid source_path")
        if not raw.startswith("assets/audio/"):
            raise HTTPException(
                status_code=400,
                detail="source_path must start with assets/audio/",
            )
        filename = raw.removeprefix("assets/audio/")
        abs_path = os.path.normpath(os.path.join(_AUDIO_ASSETS_DIR, filename))
        root_norm = os.path.normpath(_AUDIO_ASSETS_DIR)
        common = os.path.commonpath([abs_path, root_norm])
        if common != root_norm:
            raise HTTPException(status_code=400, detail="Invalid source_path")
        if not os.path.isfile(abs_path):
            raise HTTPException(status_code=404, detail=f"Audio file not found: {raw}")
        return abs_path

    def _resolve_safe_audio_asset_target(rel: str) -> str:
        """Resolve a writable repo-relative ``assets/audio/...`` target under ``_AUDIO_ASSETS_DIR``."""
        raw = (rel or "").strip().replace("\\", "/")
        if not raw or ".." in raw or raw.startswith("/"):
            raise HTTPException(status_code=400, detail="Invalid rel_path")
        if not raw.startswith("assets/audio/"):
            raise HTTPException(
                status_code=400,
                detail="rel_path must start with assets/audio/",
            )
        filename = raw.removeprefix("assets/audio/")
        abs_path = os.path.normpath(os.path.join(_AUDIO_ASSETS_DIR, filename))
        root_norm = os.path.normpath(_AUDIO_ASSETS_DIR)
        common = os.path.commonpath([abs_path, root_norm])
        if common != root_norm:
            raise HTTPException(status_code=400, detail="Invalid rel_path")
        return abs_path

    def _wav_data_duration_seconds(path: str) -> float:
        """PCM WAV duration from ``fmt`` + ``data`` chunks (no ffprobe)."""
        try:
            with open(path, "rb") as f:
                if f.read(4) != b"RIFF":
                    return 0.0
                f.read(4)
                if f.read(4) != b"WAVE":
                    return 0.0
                sr = 0
                bytes_per_frame = 0
                while True:
                    cid = f.read(4)
                    if len(cid) < 4:
                        break
                    sz = int.from_bytes(f.read(4), "little")
                    payload = f.read(sz)
                    if cid == b"fmt " and len(payload) >= 16:
                        ch = int.from_bytes(payload[2:4], "little")
                        sr = int.from_bytes(payload[4:8], "little")
                        bits = int.from_bytes(payload[14:16], "little") if len(payload) >= 16 else 16
                        bytes_per_frame = max(1, ch) * max(1, bits // 8)
                    elif cid == b"data" and sr > 0 and bytes_per_frame > 0:
                        return max(0.01, len(payload) / float(sr * bytes_per_frame))
        except OSError:
            pass
        return 0.0

    def _ffprobe_duration_seconds(path: str) -> float:
        """Return media duration in seconds using ffprobe, or fall back for PCM WAV."""
        prob = _which_ffprobe()
        if prob:
            try:
                proc = subprocess.run(
                    [
                        prob,
                        "-v",
                        "error",
                        "-show_entries",
                        "format=duration",
                        "-of",
                        "default=noprint_wrappers=1:nokey=1",
                        path,
                    ],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=120,
                )
                if proc.returncode == 0 and proc.stdout:
                    d = float(proc.stdout.strip())
                    if d > 0 and d < 1e7:
                        return d
            except (ValueError, subprocess.TimeoutExpired, OSError):
                pass
        return _wav_data_duration_seconds(path)

    def _loudnorm_json_from_ffmpeg_stderr(stderr: str) -> dict[str, object]:
        """Extract the loudnorm JSON object (contains ``input_i``) from ffmpeg stderr."""
        combined = stderr or ""
        idx = 0
        while True:
            start = combined.find("{", idx)
            if start < 0:
                raise ValueError("No JSON in ffmpeg loudnorm output")
            depth = 0
            end = -1
            for i, ch in enumerate(combined[start:], start=start):
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
            if end < 0:
                raise ValueError("Unbalanced JSON in ffmpeg loudnorm output")
            snippet = combined[start:end]
            if "input_i" in snippet:
                return json.loads(snippet)
            idx = start + 1

    def _parse_output_integrated_lufs(stderr: str) -> float | None:
        """Parse ``Output Integrated loudness:`` line from loudnorm summary (pass 2)."""
        for line in (stderr or "").splitlines():
            m = re.search(
                r"Output Integrated loudness:\s*([-0-9.]+)\s*LUFS",
                line,
                re.IGNORECASE,
            )
            if m:
                try:
                    return float(m.group(1))
                except ValueError:
                    return None
        return None

    def _ffmpeg_loudnorm_two_pass(
        ffmpeg_bin: str,
        input_path: str,
        output_path: str,
        target_i: float,
        target_tp: float,
        target_lra: float,
        pre_filters: str = "",
    ) -> tuple[float | None, float | None]:
        """Two-pass EBU R128 loudnorm. Returns (measured_input_lufs, measured_output_lufs).

        ``pre_filters`` is an optional ffmpeg ``-af`` chain (no trailing comma) applied *before*
        ``loudnorm`` in **both** passes. Keeping it identical in both passes is what makes the
        two-pass measurement correct: pass 1 measures the post-filter signal, pass 2 applies linear
        gain to that same post-filter signal.
        """
        null_out = "NUL" if sys.platform == "win32" else "/dev/null"
        pre = f"{pre_filters.strip().rstrip(',')}," if pre_filters and pre_filters.strip() else ""
        af1 = f"{pre}loudnorm=I={target_i}:TP={target_tp}:LRA={target_lra}:print_format=json"
        cmd1 = [
            ffmpeg_bin,
            "-hide_banner",
            "-nostats",
            "-i",
            input_path,
            "-af",
            af1,
            "-f",
            "null",
            null_out,
        ]
        p1 = subprocess.run(
            cmd1,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=3600,
        )
        err1 = (p1.stderr or "") + (p1.stdout or "")
        if p1.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"loudnorm pass 1 failed (exit {p1.returncode}): {err1[-2500:]}",
            )
        try:
            meta = _loudnorm_json_from_ffmpeg_stderr(err1)
        except (json.JSONDecodeError, ValueError) as e:
            raise HTTPException(
                status_code=500,
                detail=f"loudnorm pass 1 JSON parse failed: {e}\n{err1[-2500:]}",
            ) from e

        def _fnum(key: str) -> float:
            v = meta.get(key)
            if v is None:
                return 0.0
            return float(str(v).replace("LUFS", "").strip())

        measured_i = _fnum("input_i")
        measured_tp = _fnum("input_tp")
        measured_lra = _fnum("input_lra")
        measured_thresh = _fnum("input_thresh")
        offset = _fnum("target_offset")

        measured_in = measured_i if measured_i != 0.0 else None

        af2 = (
            f"{pre}loudnorm=I={target_i}:TP={target_tp}:LRA={target_lra}:"
            f"measured_I={measured_i}:measured_TP={measured_tp}:measured_LRA={measured_lra}:"
            f"measured_thresh={measured_thresh}:offset={offset}:linear=true:print_format=summary"
        )
        cmd2 = [
            ffmpeg_bin,
            "-hide_banner",
            "-y",
            "-i",
            input_path,
            "-af",
            af2,
            "-ar",
            "48000",
            output_path,
        ]
        p2 = subprocess.run(
            cmd2,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=3600,
        )
        err2 = (p2.stderr or "") + (p2.stdout or "")
        if p2.returncode != 0 or not os.path.isfile(output_path):
            raise HTTPException(
                status_code=500,
                detail=f"loudnorm pass 2 failed (exit {p2.returncode}): {err2[-2500:]}",
            )
        out_lufs = _parse_output_integrated_lufs(err2)
        return (measured_in, out_lufs)

    def _ffmpeg_transparent_loudness(
        ffmpeg_bin: str,
        input_path: str,
        output_path: str,
        target_i: float,
        target_tp: float,
        target_lra: float = 11.0,  # accepted for signature parity; unused (no dynamic-range remap)
        pre_filters: str = "",
    ) -> tuple[float | None, float | None]:
        """Transparent loudness normalization (no ``loudnorm`` dynamic mode).

        Measures integrated loudness, applies a single **static gain** to hit ``target_i`` exactly,
        then a true-peak limiter (ceiling ``target_tp``) that only catches occasional peaks. Because
        nothing continuously reshapes the signal — unlike ``loudnorm`` which falls back to its dynamic
        limiter on short, low-LRA spoken clips and produces a "metallic"/musical artifact — the natural
        voice is preserved while every clip still lands at the same loudness. ``pre_filters`` is an
        optional ffmpeg ``-af`` chain applied before the gain (e.g. cleanup chain or match-EQ).
        """
        null_out = "NUL" if sys.platform == "win32" else "/dev/null"
        pre = f"{pre_filters.strip().rstrip(',')}," if pre_filters and pre_filters.strip() else ""

        def _measure(path: str, extra_pre: str) -> float | None:
            af = f"{extra_pre}loudnorm=I={target_i}:TP={target_tp}:LRA=11:print_format=json"
            proc = subprocess.run(
                [ffmpeg_bin, "-hide_banner", "-nostats", "-i", path, "-af", af, "-f", "null", null_out],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=3600,
            )
            err = (proc.stderr or "") + (proc.stdout or "")
            if proc.returncode != 0:
                raise HTTPException(
                    status_code=500,
                    detail=f"loudness measure failed (exit {proc.returncode}): {err[-2500:]}",
                )
            try:
                meta = _loudnorm_json_from_ffmpeg_stderr(err)
            except (json.JSONDecodeError, ValueError) as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"loudness measure JSON parse failed: {e}\n{err[-2500:]}",
                ) from e
            v = meta.get("input_i")
            if v is None:
                return None
            try:
                return float(str(v).replace("LUFS", "").strip())
            except ValueError:
                return None

        measured_i = _measure(input_path, pre)
        # Static gain to hit target. Clamp so silence / parse-garbage can't produce an extreme gain.
        base_i = measured_i if measured_i is not None else target_i
        gain_db = max(-30.0, min(30.0, target_i - base_i))
        limit_lin = 10 ** (target_tp / 20.0)  # dBFS ceiling -> linear amplitude for alimiter
        af2 = f"{pre}volume={gain_db:.3f}dB,alimiter=limit={limit_lin:.6f}:level=false"
        cmd2 = [
            ffmpeg_bin,
            "-hide_banner",
            "-y",
            "-i",
            input_path,
            "-af",
            af2,
            "-ar",
            "48000",
            output_path,
        ]
        p2 = subprocess.run(
            cmd2,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=3600,
        )
        err2 = (p2.stderr or "") + (p2.stdout or "")
        if p2.returncode != 0 or not os.path.isfile(output_path):
            raise HTTPException(
                status_code=500,
                detail=f"loudness gain pass failed (exit {p2.returncode}): {err2[-2500:]}",
            )
        out_lufs = _measure(output_path, "")
        measured_in = measured_i if (measured_i is not None and measured_i != 0.0) else None
        return (measured_in, out_lufs)

    class NormalizeAudioResponse(BaseModel):
        file_path: str
        duration: float
        measured_input_lufs: float | None = None
        measured_output_lufs: float | None = None

    @app.post("/api/normalize_audio", response_model=NormalizeAudioResponse)
    async def normalize_audio(
        file: UploadFile | None = File(default=None),
        source_path: str | None = Form(default=None),
        target_lufs: float = Form(default=-16.0),
        true_peak: float = Form(default=-1.5),
        lra: float = Form(default=11.0),
    ) -> NormalizeAudioResponse:
        """EBU R128 loudness normalization via ffmpeg ``loudnorm``. Writes WAV under ``assets/audio/``."""
        ffmpeg_bin = _which_ffmpeg()
        if not ffmpeg_bin:
            raise HTTPException(
                status_code=503,
                detail=(
                    "ffmpeg not found on PATH. Install ffmpeg and ensure it is available "
                    "to the server process."
                ),
            )

        has_file = file is not None
        has_src = bool(source_path and str(source_path).strip())

        if has_file == has_src:
            raise HTTPException(
                status_code=400,
                detail="Provide exactly one of: multipart file upload, or form field source_path.",
            )

        input_abs: str | None = None
        temp_input: str | None = None

        try:
            if has_src:
                input_abs = _resolve_safe_audio_asset(source_path.strip())
            else:
                assert file is not None
                ext = os.path.splitext(file.filename or "")[1] or ".wav"
                fd, temp_input = tempfile.mkstemp(suffix=ext)
                os.close(fd)
                body = await file.read()
                if not body:
                    raise HTTPException(status_code=400, detail="Empty upload")
                with open(temp_input, "wb") as out_f:
                    out_f.write(body)
                input_abs = temp_input

            out_name = f"normalized_{uuid.uuid4().hex}.wav"
            out_rel = f"assets/audio/{out_name}"
            out_abs = os.path.join(_AUDIO_ASSETS_DIR, out_name)

            min_i, max_i = -70.0, -5.0
            tl = float(target_lufs)
            if tl < min_i or tl > max_i:
                raise HTTPException(
                    status_code=400,
                    detail=f"target_lufs must be between {min_i} and {max_i}",
                )
            tp = float(true_peak)
            lr = float(lra)
            if tp > 0.0 or tp < -9.0:
                raise HTTPException(
                    status_code=400,
                    detail="true_peak must be in [-9, 0] dBTP",
                )
            if lr < 1.0 or lr > 20.0:
                raise HTTPException(
                    status_code=400,
                    detail="lra must be between 1 and 20",
                )

            in_lufs, out_lufs = _ffmpeg_transparent_loudness(
                ffmpeg_bin,
                input_abs,
                out_abs,
                tl,
                tp,
                lr,
            )

            duration = _ffprobe_duration_seconds(out_abs)
            if duration <= 0.0:
                duration = _ffprobe_duration_seconds(input_abs)
            if duration <= 0.0:
                duration = 0.01

            return NormalizeAudioResponse(
                file_path=out_rel,
                duration=float(duration),
                measured_input_lufs=in_lufs,
                measured_output_lufs=out_lufs,
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
            ) from e
        finally:
            if temp_input and os.path.isfile(temp_input):
                try:
                    os.unlink(temp_input)
                except OSError:
                    pass

    def _build_cleanup_filtergraph(
        highpass_hz: float,
        denoise: bool,
        denoise_db: float,
        compress: bool,
    ) -> str:
        """Deterministic spoken-voice cleanup chain applied before ``loudnorm``.

        Identical settings produce identical processing for every clip — that determinism is the
        point: it is what makes sentence-by-sentence takes sound like one continuous recording.
        Order: high-pass (rumble/handling) -> FFT denoise (steady noise floor) -> compressor (even
        out dynamics). Final loudness is handled by the transparent gain+limiter stage that follows.
        """
        parts: list[str] = []
        if highpass_hz and highpass_hz > 0:
            parts.append(f"highpass=f={highpass_hz:g}")
        if denoise:
            # nr = noise reduction amount (dB); nf = assumed noise floor. Kept gentle: a high nf
            # (e.g. -25) treats quiet real content as noise and produces "musical"/metallic
            # artifacts on already-clean voice. -40 only removes a genuinely low noise bed.
            nr = max(0.01, min(97.0, denoise_db))
            parts.append(f"afftdn=nr={nr:g}:nf=-40")
        if compress:
            # Gentle leveling only (1.5:1, slow-ish attack to preserve transients). A heavier ratio
            # squashes the voice; the goal here is subtle evenness, not character change.
            parts.append("acompressor=threshold=-24dB:ratio=1.5:attack=30:release=300")
        return ",".join(parts)

    def _analyze_input_noise_floor(ffmpeg_bin: str, path: str) -> float | None:
        """Best-effort noise floor (dBFS) of *path* via ffmpeg ``astats``. Returns None on failure."""
        null_out = "NUL" if sys.platform == "win32" else "/dev/null"
        try:
            proc = subprocess.run(
                [
                    ffmpeg_bin,
                    "-hide_banner",
                    "-nostats",
                    "-i",
                    path,
                    "-af",
                    "astats=metadata=1:reset=0",
                    "-f",
                    "null",
                    null_out,
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=600,
            )
        except (subprocess.TimeoutExpired, OSError):
            return None
        combined = (proc.stderr or "") + (proc.stdout or "")
        vals: list[float] = []
        for line in combined.splitlines():
            m = re.search(r"Noise floor dB:\s*([-0-9.]+)", line, re.IGNORECASE)
            if m:
                try:
                    vals.append(float(m.group(1)))
                except ValueError:
                    pass
        if vals:
            # astats prints per-channel then an Overall block last; the last value is Overall.
            return vals[-1]
        return None

    class ProcessAudioResponse(BaseModel):
        file_path: str
        duration: float
        measured_input_lufs: float | None = None
        measured_output_lufs: float | None = None
        measured_input_noise_floor_db: float | None = None

    @app.post("/api/process_audio", response_model=ProcessAudioResponse)
    async def process_audio(
        file: UploadFile | None = File(default=None),
        source_path: str | None = Form(default=None),
        target_lufs: float = Form(default=-16.0),
        true_peak: float = Form(default=-1.5),
        lra: float = Form(default=11.0),
        highpass_hz: float = Form(default=80.0),
        denoise: bool = Form(default=False),
        denoise_db: float = Form(default=8.0),
        compress: bool = Form(default=True),
    ) -> ProcessAudioResponse:
        """Full deterministic cleanup chain (high-pass + denoise + compress) then EBU R128 loudnorm.

        Same contract as ``/api/normalize_audio`` (exactly one of multipart ``file`` or form
        ``source_path``), but applies the voice cleanup chain so every clip is processed identically.
        Writes a WAV under ``assets/audio/``.
        """
        ffmpeg_bin = _which_ffmpeg()
        if not ffmpeg_bin:
            raise HTTPException(
                status_code=503,
                detail=(
                    "ffmpeg not found on PATH. Install ffmpeg and ensure it is available "
                    "to the server process."
                ),
            )

        has_file = file is not None
        has_src = bool(source_path and str(source_path).strip())
        if has_file == has_src:
            raise HTTPException(
                status_code=400,
                detail="Provide exactly one of: multipart file upload, or form field source_path.",
            )

        input_abs: str | None = None
        temp_input: str | None = None
        try:
            if has_src:
                input_abs = _resolve_safe_audio_asset(source_path.strip())
            else:
                assert file is not None
                ext = os.path.splitext(file.filename or "")[1] or ".wav"
                fd, temp_input = tempfile.mkstemp(suffix=ext)
                os.close(fd)
                body = await file.read()
                if not body:
                    raise HTTPException(status_code=400, detail="Empty upload")
                with open(temp_input, "wb") as out_f:
                    out_f.write(body)
                input_abs = temp_input

            tl = float(target_lufs)
            if tl < -70.0 or tl > -5.0:
                raise HTTPException(status_code=400, detail="target_lufs must be between -70 and -5")
            tp = float(true_peak)
            if tp > 0.0 or tp < -9.0:
                raise HTTPException(status_code=400, detail="true_peak must be in [-9, 0] dBTP")
            lr = float(lra)
            if lr < 1.0 or lr > 20.0:
                raise HTTPException(status_code=400, detail="lra must be between 1 and 20")
            hp = float(highpass_hz)
            if hp < 0.0 or hp > 500.0:
                raise HTTPException(status_code=400, detail="highpass_hz must be between 0 and 500")

            out_name = f"cleaned_{uuid.uuid4().hex}.wav"
            out_rel = f"assets/audio/{out_name}"
            out_abs = os.path.join(_AUDIO_ASSETS_DIR, out_name)

            # Measure raw noise floor *before* the chain so the readout reflects the take, not the result.
            noise_floor = _analyze_input_noise_floor(ffmpeg_bin, input_abs)

            pre = _build_cleanup_filtergraph(hp, bool(denoise), float(denoise_db), bool(compress))
            in_lufs, out_lufs = _ffmpeg_transparent_loudness(
                ffmpeg_bin,
                input_abs,
                out_abs,
                tl,
                tp,
                lr,
                pre_filters=pre,
            )

            duration = _ffprobe_duration_seconds(out_abs)
            if duration <= 0.0:
                duration = _ffprobe_duration_seconds(input_abs)
            if duration <= 0.0:
                duration = 0.01

            return ProcessAudioResponse(
                file_path=out_rel,
                duration=float(duration),
                measured_input_lufs=in_lufs,
                measured_output_lufs=out_lufs,
                measured_input_noise_floor_db=noise_floor,
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
            ) from e
        finally:
            if temp_input and os.path.isfile(temp_input):
                try:
                    os.unlink(temp_input)
                except OSError:
                    pass

    def _decode_mono_f32(ffmpeg_bin: str, path: str, sr: int = 48000) -> "np.ndarray":
        """Decode *path* to a mono float32 numpy array at *sr* via ffmpeg (raw f32le on stdout)."""
        proc = subprocess.run(
            [
                ffmpeg_bin,
                "-hide_banner",
                "-nostats",
                "-i",
                path,
                "-ac",
                "1",
                "-ar",
                str(sr),
                "-f",
                "f32le",
                "-",
            ],
            capture_output=True,
            timeout=600,
        )
        if proc.returncode != 0:
            tail = (proc.stderr or b"")[-1500:].decode("utf-8", "replace")
            raise HTTPException(status_code=500, detail=f"audio decode failed: {tail}")
        return np.frombuffer(proc.stdout, dtype=np.float32)

    def _avg_mag_spectrum(
        samples: "np.ndarray", win: int = 8192, hop: int = 4096
    ) -> "np.ndarray | None":
        """Average magnitude spectrum (Hann-windowed STFT, averaged over frames)."""
        if samples.size == 0:
            return None
        if samples.size < win:
            samples = np.pad(samples, (0, win - samples.size))
        window = np.hanning(win).astype(np.float32)
        n_frames = 1 + (samples.size - win) // hop
        if n_frames <= 0:
            return None
        acc = np.zeros(win // 2 + 1, dtype=np.float64)
        for i in range(n_frames):
            start = i * hop
            frame = samples[start : start + win] * window
            acc += np.abs(np.fft.rfft(frame))
        return acc / float(n_frames)

    def _band_levels_db(
        avg_mag: "np.ndarray", sr: int, win: int, centers: list[float], spacing_oct: float
    ) -> list[float]:
        """Mean magnitude (dB) of *avg_mag* within a ``spacing_oct`` band around each center freq."""
        freqs = np.fft.rfftfreq(win, 1.0 / sr)
        half = spacing_oct / 2.0
        eps = 1e-9
        out: list[float] = []
        for fc in centers:
            lo = fc * (2.0 ** (-half))
            hi = fc * (2.0 ** half)
            idx = np.where((freqs >= lo) & (freqs < hi))[0]
            if idx.size == 0:
                j = int(np.argmin(np.abs(freqs - fc)))
                band = float(avg_mag[j])
            else:
                band = float(np.mean(avg_mag[idx]))
            out.append(20.0 * float(np.log10(band + eps)))
        return out

    def _match_eq_band_centers(
        f_lo: float = 80.0, f_hi: float = 12000.0, spacing_oct: float = 2.0 / 3.0
    ) -> tuple[list[float], float]:
        n = int(np.floor(np.log2(f_hi / f_lo) / spacing_oct)) + 1
        centers = [float(f_lo * (2.0 ** (spacing_oct * i))) for i in range(max(1, n))]
        return centers, spacing_oct

    def _compute_match_eq_gains(
        ref_db: list[float], tgt_db: list[float], max_gain_db: float
    ) -> list[float]:
        """Corrective per-band gain = reference - target, de-meaned, smoothed, and clamped.

        De-meaning removes any overall level difference (loudnorm owns loudness); smoothing avoids
        narrow resonant corrections; clamping keeps the curve musical rather than surgical.
        """
        gains = [r - t for r, t in zip(ref_db, tgt_db)]
        if not gains:
            return gains
        med = float(np.median(np.asarray(gains)))
        gains = [g - med for g in gains]
        n = len(gains)
        smoothed = [
            (gains[max(0, i - 1)] + gains[i] + gains[min(n - 1, i + 1)]) / 3.0
            for i in range(n)
        ]
        m = abs(float(max_gain_db))
        return [max(-m, min(m, g)) for g in smoothed]

    def _build_match_eq_filter(
        centers: list[float], gains_db: list[float], width_oct: float = 1.0
    ) -> str:
        """Chain of peaking biquad ``equalizer`` filters (one per band). Skips ~0 dB bands."""
        parts: list[str] = []
        for fc, g in zip(centers, gains_db):
            if abs(g) < 0.1:
                continue
            parts.append(
                f"equalizer=f={fc:.1f}:width_type=o:width={width_oct:g}:g={g:.2f}"
            )
        return ",".join(parts)

    class MatchEqBand(BaseModel):
        freq: float
        gain_db: float

    class MatchEqResponse(BaseModel):
        file_path: str
        duration: float
        measured_input_lufs: float | None = None
        measured_output_lufs: float | None = None
        bands: list[MatchEqBand] = []

    @app.post("/api/match_eq", response_model=MatchEqResponse)
    async def match_eq(
        file: UploadFile | None = File(default=None),
        source_path: str | None = Form(default=None),
        reference_path: str = Form(...),
        target_lufs: float = Form(default=-16.0),
        true_peak: float = Form(default=-1.5),
        lra: float = Form(default=11.0),
        max_gain_db: float = Form(default=9.0),
    ) -> MatchEqResponse:
        """Match the tonal balance of the target clip to a reference take, then loudness-normalize.

        Computes the average magnitude spectrum of both clips, derives a corrective multiband EQ
        (reference minus target per band), applies it as peaking biquads, then runs two-pass
        ``loudnorm`` so the result also hits ``target_lufs``. Provide the target as exactly one of
        multipart ``file`` or form ``source_path``; ``reference_path`` is a server ``assets/audio/...``.
        """
        ffmpeg_bin = _which_ffmpeg()
        if not ffmpeg_bin:
            raise HTTPException(
                status_code=503,
                detail="ffmpeg not found on PATH. Install ffmpeg and ensure it is available.",
            )

        has_file = file is not None
        has_src = bool(source_path and str(source_path).strip())
        if has_file == has_src:
            raise HTTPException(
                status_code=400,
                detail="Provide exactly one of: multipart file upload, or form field source_path.",
            )

        ref_abs = _resolve_safe_audio_asset(reference_path.strip())

        temp_input: str | None = None
        try:
            if has_src:
                input_abs = _resolve_safe_audio_asset(source_path.strip())
            else:
                assert file is not None
                ext = os.path.splitext(file.filename or "")[1] or ".wav"
                fd, temp_input = tempfile.mkstemp(suffix=ext)
                os.close(fd)
                body = await file.read()
                if not body:
                    raise HTTPException(status_code=400, detail="Empty upload")
                with open(temp_input, "wb") as out_f:
                    out_f.write(body)
                input_abs = temp_input

            tl = float(target_lufs)
            if tl < -70.0 or tl > -5.0:
                raise HTTPException(status_code=400, detail="target_lufs must be between -70 and -5")
            tp = float(true_peak)
            if tp > 0.0 or tp < -9.0:
                raise HTTPException(status_code=400, detail="true_peak must be in [-9, 0] dBTP")
            lr = float(lra)
            if lr < 1.0 or lr > 20.0:
                raise HTTPException(status_code=400, detail="lra must be between 1 and 20")
            mg = float(max_gain_db)
            if mg <= 0.0 or mg > 24.0:
                raise HTTPException(status_code=400, detail="max_gain_db must be in (0, 24]")

            sr = 48000
            win = 8192
            centers, spacing = _match_eq_band_centers()

            ref_mag = _avg_mag_spectrum(_decode_mono_f32(ffmpeg_bin, ref_abs, sr), win)
            tgt_mag = _avg_mag_spectrum(_decode_mono_f32(ffmpeg_bin, input_abs, sr), win)
            if ref_mag is None or tgt_mag is None:
                raise HTTPException(
                    status_code=400,
                    detail="Could not analyze audio (clip too short or silent).",
                )

            ref_db = _band_levels_db(ref_mag, sr, win, centers, spacing)
            tgt_db = _band_levels_db(tgt_mag, sr, win, centers, spacing)
            gains = _compute_match_eq_gains(ref_db, tgt_db, mg)
            eq_filter = _build_match_eq_filter(centers, gains)

            out_name = f"matched_{uuid.uuid4().hex}.wav"
            out_rel = f"assets/audio/{out_name}"
            out_abs = os.path.join(_AUDIO_ASSETS_DIR, out_name)

            in_lufs, out_lufs = _ffmpeg_transparent_loudness(
                ffmpeg_bin, input_abs, out_abs, tl, tp, lr, pre_filters=eq_filter
            )

            duration = _ffprobe_duration_seconds(out_abs)
            if duration <= 0.0:
                duration = _ffprobe_duration_seconds(input_abs)
            if duration <= 0.0:
                duration = 0.01

            return MatchEqResponse(
                file_path=out_rel,
                duration=float(duration),
                measured_input_lufs=in_lufs,
                measured_output_lufs=out_lufs,
                bands=[
                    MatchEqBand(freq=round(fc, 1), gain_db=round(g, 2))
                    for fc, g in zip(centers, gains)
                ],
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
            ) from e
        finally:
            if temp_input and os.path.isfile(temp_input):
                try:
                    os.unlink(temp_input)
                except OSError:
                    pass

    @app.post("/api/concat_mp4")
    async def concat_mp4(files: list[UploadFile] = File()) -> FileResponse:
        """Concatenate uploaded MP4s in order using ffmpeg (concat demuxer; re-encode if stream copy fails)."""
        if len(files) < 2:
            raise HTTPException(
                status_code=400,
                detail="Provide at least 2 video files (multipart field name: files).",
            )
        ffmpeg_bin = _which_ffmpeg()
        if not ffmpeg_bin:
            raise HTTPException(
                status_code=503,
                detail="ffmpeg not found on PATH. Install ffmpeg and ensure it is available to the server process.",
            )

        work_dir = tempfile.mkdtemp(prefix="manim_concat_")
        list_path = os.path.join(work_dir, "concat_list.txt")

        def _cleanup_concat_workdir(path: str) -> None:
            shutil.rmtree(path, ignore_errors=True)

        try:
            abs_paths: list[str] = []
            for i, uf in enumerate(files):
                body = await uf.read()
                if not body:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Empty upload for part {i + 1}.",
                    )
                seg = os.path.join(work_dir, f"part_{i:04d}.mp4")
                with open(seg, "wb") as out_f:
                    out_f.write(body)
                abs_paths.append(os.path.abspath(seg))

            with open(list_path, "w", encoding="utf-8") as lf:
                for p in abs_paths:
                    esc = p.replace("'", "'\\''")
                    lf.write(f"file '{esc}'\n")

            out_mp4 = os.path.join(work_dir, "merged.mp4")

            def _run_ffmpeg(args: list[str]) -> subprocess.CompletedProcess[str]:
                return subprocess.run(
                    args,
                    cwd=work_dir,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=3600,
                )

            copy_cmd = [
                ffmpeg_bin,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                list_path,
                "-c",
                "copy",
                out_mp4,
            ]
            proc = _run_ffmpeg(copy_cmd)
            if proc.returncode != 0 or not os.path.isfile(out_mp4):
                enc_cmd = [
                    ffmpeg_bin,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    list_path,
                    "-c:v",
                    "libx264",
                    "-crf",
                    "23",
                    "-preset",
                    "veryfast",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-movflags",
                    "+faststart",
                    out_mp4,
                ]
                proc2 = _run_ffmpeg(enc_cmd)
                if proc2.returncode != 0 or not os.path.isfile(out_mp4):
                    err = (proc2.stderr or proc2.stdout or "").strip()
                    if not err:
                        err = (proc.stderr or proc.stdout or "").strip()
                    raise HTTPException(
                        status_code=500,
                        detail=err or "ffmpeg concat failed (stream copy and re-encode).",
                    )

            return FileResponse(
                out_mp4,
                media_type="video/mp4",
                filename="merged.mp4",
                background=BackgroundTask(_cleanup_concat_workdir, work_dir),
            )
        except HTTPException:
            _cleanup_concat_workdir(work_dir)
            raise
        except Exception as e:
            _cleanup_concat_workdir(work_dir)
            raise HTTPException(
                status_code=500,
                detail=f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
            ) from e

    class MixdownClip(BaseModel):
        rel_path: str
        start_sec: float = 0
        fade_in_ms: float = 0
        fade_out_ms: float = 0
        gain_db: float = 0

    class MixdownBed(BaseModel):
        rel_path: str
        gain_db: float = -24

    class MixdownRequest(BaseModel):
        total_duration_sec: float
        clips: list[MixdownClip] = Field(default_factory=list)
        bed: MixdownBed | None = None

    def _ffmpeg_mixdown_audio(req: MixdownRequest) -> tuple[str, float]:
        """Build a single master WAV from narration clips (+ optional looped bed)."""
        ffmpeg = _which_ffmpeg()
        if not ffmpeg:
            raise HTTPException(status_code=500, detail="ffmpeg not found on PATH")

        total = max(0.01, float(req.total_duration_sec))
        if not req.clips and not req.bed:
            raise HTTPException(
                status_code=400,
                detail="mixdown requires at least one clip or a background bed",
            )

        inputs: list[str] = []
        filter_parts: list[str] = []
        mix_labels: list[str] = []
        idx = 0

        for clip in req.clips:
            abs_path = _resolve_safe_audio_asset(clip.rel_path)
            inputs.extend(["-i", abs_path])
            dur = _ffprobe_duration_seconds(abs_path)
            fade_in = max(0.0, float(clip.fade_in_ms) / 1000.0)
            fade_out = max(0.0, float(clip.fade_out_ms) / 1000.0)
            st_out = max(0.0, dur - fade_out) if fade_out > 0 else dur

            parts: list[str] = []
            if clip.gain_db != 0:
                parts.append(f"volume={clip.gain_db}dB")
            if fade_in > 0:
                parts.append(f"afade=t=in:st=0:d={fade_in:.4f}")
            if fade_out > 0 and st_out < dur:
                parts.append(f"afade=t=out:st={st_out:.4f}:d={fade_out:.4f}")
            delay_ms = int(round(float(clip.start_sec) * 1000))
            parts.append(f"adelay={delay_ms}|{delay_ms}")
            filter_parts.append(f"[{idx}:a]" + ",".join(parts) + f"[a{idx}]")
            mix_labels.append(f"[a{idx}]")
            idx += 1

        if req.bed:
            bed_path = _resolve_safe_audio_asset(req.bed.rel_path)
            inputs.extend(["-stream_loop", "-1", "-i", bed_path])
            filter_parts.append(
                f"[{idx}:a]atrim=0:{total:.4f},asetpts=PTS-STARTPTS,"
                f"volume={req.bed.gain_db}dB[bed]"
            )
            mix_labels.append("[bed]")
            idx += 1

        n = len(mix_labels)
        if n == 1:
            filter_parts.append(
                f"{mix_labels[0]}atrim=0:{total:.4f},asetpts=PTS-STARTPTS[out]"
            )
        else:
            joined = "".join(mix_labels)
            filter_parts.append(
                f"{joined}amix=inputs={n}:duration=longest:dropout_transition=0,"
                f"atrim=0:{total:.4f},asetpts=PTS-STARTPTS[out]"
            )

        out_name = f"master_{uuid.uuid4().hex}.wav"
        out_abs = os.path.join(_AUDIO_ASSETS_DIR, out_name)
        rel_out = f"assets/audio/{out_name}"

        cmd = [
            ffmpeg,
            "-y",
            *inputs,
            "-filter_complex",
            ";".join(filter_parts),
            "-map",
            "[out]",
            "-ar",
            "48000",
            "-ac",
            "2",
            out_abs,
        ]
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=600,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "ffmpeg mixdown failed").strip()
            raise HTTPException(status_code=500, detail=err[-4000:])

        duration = _ffprobe_duration_seconds(out_abs)
        if duration <= 0:
            duration = total
        return rel_out, duration

    @app.post("/api/mixdown_audio")
    def mixdown_audio(req: MixdownRequest) -> dict[str, object]:
        try:
            rel_path, duration = _ffmpeg_mixdown_audio(req)
            return {"file_path": rel_path, "duration": duration}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
            ) from e

    class GenerateBedNoiseRequest(BaseModel):
        color: str = Field("pink", description="Noise color: pink, brown, or white")
        duration_sec: float = Field(8.0, description="Clip length in seconds (looped at export)")
        level_db: float = Field(-40.0, description="Output level in dBFS before mix gain")

    _BED_NOISE_COLORS = frozenset({"pink", "brown", "white"})

    def _ffmpeg_generate_bed_noise(
        color: str,
        duration_sec: float,
        level_db: float,
    ) -> tuple[str, float]:
        ffmpeg = _which_ffmpeg()
        if not ffmpeg:
            raise HTTPException(status_code=500, detail="ffmpeg not found on PATH")

        c = (color or "pink").strip().lower()
        if c not in _BED_NOISE_COLORS:
            raise HTTPException(
                status_code=400,
                detail=f"color must be one of: {', '.join(sorted(_BED_NOISE_COLORS))}",
            )
        dur = max(1.0, min(30.0, float(duration_sec)))
        level = max(-80.0, min(0.0, float(level_db)))

        out_name = f"bed_noise_{uuid.uuid4().hex}.wav"
        out_abs = os.path.join(_AUDIO_ASSETS_DIR, out_name)
        rel_out = f"assets/audio/{out_name}"

        cmd = [
            ffmpeg,
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"anoisesrc=color={c}:d={dur:.4f}:a=0.5",
            "-af",
            f"volume={level:.2f}dB",
            "-ar",
            "48000",
            "-ac",
            "2",
            out_abs,
        ]
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "ffmpeg bed noise failed").strip()
            raise HTTPException(status_code=500, detail=err[-4000:])

        duration = _ffprobe_duration_seconds(out_abs)
        if duration <= 0:
            duration = dur
        return rel_out, duration

    @app.post("/api/generate_bed_noise")
    def generate_bed_noise(req: GenerateBedNoiseRequest) -> dict[str, object]:
        try:
            rel_path, duration = _ffmpeg_generate_bed_noise(
                req.color,
                req.duration_sec,
                req.level_db,
            )
            return {"file_path": rel_path, "duration": duration}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
            ) from e

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    class RenderRequest(BaseModel):
        python_code: str = Field(..., description="Full Manim scene Python source")
        quality: str = Field(..., description="Render quality: l, m, h, or k")
        scene_name: str = Field(..., description="Scene class name for manim CLI")
        master_audio_path: str | None = Field(
            None,
            description="Optional repo-relative assets/audio/... master WAV to replace Manim audio",
        )

    def _mux_master_audio_over_mp4(video_path: str, audio_abs: str, out_path: str) -> None:
        ffmpeg = _which_ffmpeg()
        if not ffmpeg:
            raise HTTPException(status_code=500, detail="ffmpeg not found on PATH")
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            video_path,
            "-i",
            audio_abs,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            out_path,
        ]
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=600,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "ffmpeg mux failed").strip()
            raise HTTPException(status_code=500, detail=err[-4000:])

    def _cleanup_render_workdir(path: str) -> None:
        shutil.rmtree(path, ignore_errors=True)

    def _write_render_debug_snapshot(req: RenderRequest) -> None:
        """Persist the last render request so UI/export mismatches can be inspected."""
        os.makedirs(_RENDER_DEBUG_DIR, exist_ok=True)
        source_path = os.path.join(_RENDER_DEBUG_DIR, "last_render.py")
        meta_path = os.path.join(_RENDER_DEBUG_DIR, "last_render_meta.json")
        with open(source_path, "w", encoding="utf-8") as f:
            f.write(req.python_code)
        meta = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "scene_name": req.scene_name,
            "quality": req.quality,
            "source_path": source_path,
            "source_chars": len(req.python_code),
        }
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

    def _stage_project_assets_for_render(work_dir: str) -> None:
        """Copy ``assets/audio`` from the repo into *work_dir*.

        Timeline export emits ``self.add_sound("assets/audio/...")`` paths relative to the
        process cwd. ``manim`` is run with ``cwd=work_dir`` (a temp directory), so without
        this step audio files are missing and ``construct()`` fails.
        """
        src = _AUDIO_ASSETS_DIR
        if not os.path.isdir(src):
            return
        dst = os.path.join(work_dir, "assets", "audio")
        os.makedirs(dst, exist_ok=True)
        for name in os.listdir(src):
            path = os.path.join(src, name)
            if os.path.isfile(path):
                shutil.copy2(path, os.path.join(dst, name))

    @app.post("/api/render")
    def render_scene_mp4(req: RenderRequest) -> FileResponse:
        q = req.quality.strip().lower()
        if q not in ("l", "m", "h", "k"):
            raise HTTPException(
                status_code=400,
                detail="quality must be one of: l, m, h, k",
            )
        scene = req.scene_name.strip()
        if not scene:
            raise HTTPException(status_code=400, detail="scene_name is required")

        work_dir = tempfile.mkdtemp(prefix="manim_render_")
        script_name = "timeline_export_scene.py"
        script_path = os.path.join(work_dir, script_name)

        try:
            _write_render_debug_snapshot(req)
            _stage_project_assets_for_render(work_dir)
            with open(script_path, "w", encoding="utf-8") as f:
                f.write(req.python_code)

            env = os.environ.copy()
            env["PYTHONPATH"] = _ROOT + os.pathsep + env.get("PYTHONPATH", "")
            # Windows defaults to cp1252; Manim + Rich log Unicode and crash when piping logs.
            if sys.platform == "win32":
                env.setdefault("PYTHONUTF8", "1")
                env.setdefault("PYTHONIOENCODING", "utf-8")

            cmd = [
                sys.executable,
                "-m",
                "manim",
                "render",
                script_path,
                scene,
                f"-q{q}",
                "--format=mp4",
            ]
            proc = subprocess.run(
                cmd,
                cwd=work_dir,
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=3600,
            )
            if proc.returncode != 0:
                err = (proc.stderr or "").strip() or (proc.stdout or "").strip() or "manim failed"
                raise HTTPException(status_code=500, detail=err)

            media_videos = os.path.join(work_dir, "media", "videos")
            candidates: list[str] = []
            if os.path.isdir(media_videos):
                for root, _dirs, files in os.walk(media_videos):
                    for fn in files:
                        if fn.lower().endswith(".mp4"):
                            candidates.append(os.path.join(root, fn))
            if not candidates:
                logs = "\n".join(
                    part
                    for part in ((proc.stderr or "").strip(), (proc.stdout or "").strip())
                    if part
                )
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "No MP4 file found under media/videos after render."
                        + (f"\n\nManim output:\n{logs[-3000:]}" if logs else "")
                    ),
                )

            mp4_path: str | None = None
            for p in candidates:
                if os.path.splitext(os.path.basename(p))[0] == scene:
                    mp4_path = p
                    break
            if mp4_path is None:
                mp4_path = max(candidates, key=lambda p: os.path.getmtime(p))

            deliver_path = mp4_path
            if req.master_audio_path:
                master_rel = req.master_audio_path.strip().replace("\\", "/")
                master_abs = _resolve_safe_audio_asset(master_rel)
                muxed_path = os.path.join(work_dir, f"{scene}_master_mux.mp4")
                _mux_master_audio_over_mp4(mp4_path, master_abs, muxed_path)
                deliver_path = muxed_path

            return FileResponse(
                deliver_path,
                media_type="video/mp4",
                filename=f"{scene}.mp4",
                background=BackgroundTask(_cleanup_render_workdir, work_dir),
            )
        except HTTPException:
            _cleanup_render_workdir(work_dir)
            raise
        except subprocess.TimeoutExpired:
            _cleanup_render_workdir(work_dir)
            raise HTTPException(status_code=504, detail="Render timed out") from None
        except Exception as e:
            _cleanup_render_workdir(work_dir)
            raise HTTPException(
                status_code=500,
                detail=f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
            ) from e

    # Uploaded timeline audio (`/api/upload_audio`) is stored under this folder; the app
    # plays it and `.mtproj` bundling fetches via GET — must be exposed as static files.
    app.mount(
        "/assets/audio",
        StaticFiles(directory=_AUDIO_ASSETS_DIR),
        name="timeline_audio_assets",
    )

except ImportError:
    app = None  # type: ignore[misc, assignment]

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "measure_server:app",
        host="127.0.0.1",
        port=8765,
        reload=True,
    )
