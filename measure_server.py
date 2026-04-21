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

**Merge videos:** ``POST /api/concat_mp4`` accepts multiple uploads (multipart field ``files``)
and concatenates them with ``ffmpeg`` (must be on ``PATH``). See endpoint docstring in code.

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

# Project root on sys.path when launched from elsewhere
_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import base64
import shutil
import subprocess
import tempfile
import uuid
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
        for sub in line:
            c = sub.get_center()
            seg_boxes.append(
                SegmentBoxOut(
                    cx=float(c[0]),
                    cy=float(c[1]),
                    w=float(sub.get_width()),
                    h=float(sub.get_height()),
                )
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
        )
    except Exception as e:
        return MeasureResponse(
            ok=False,
            error=f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
        )


try:
    from fastapi import FastAPI, File, HTTPException, UploadFile
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

    _AUDIO_ASSETS_DIR = os.path.join(_ROOT, "assets", "audio")
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

    def _get_whisper_model():
        global _whisper_model
        if _whisper_model is None:
            import whisper

            _whisper_model = whisper.load_model("base")
        return _whisper_model

    @app.post("/measure", response_model=MeasureResponse)
    def measure(req: MeasureRequest) -> MeasureResponse:
        return measure_line(req)

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
            whisper_lang = "he"
        else:
            tts_lang = incoming
            whisper_lang = incoming
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

            word_boundaries: list[WordBoundaryOut] = []
            for seg in result.get("segments") or []:
                for w in seg.get("words") or []:
                    raw = w.get("word") or ""
                    word_boundaries.append(
                        WordBoundaryOut(
                            word=raw.strip(),
                            start=float(w.get("start", 0.0)),
                            end=float(w.get("end", 0.0)),
                        )
                    )
            if not word_boundaries:
                for seg in result.get("segments") or []:
                    txt = (seg.get("text") or "").strip()
                    word_boundaries.append(
                        WordBoundaryOut(
                            word=txt or "…",
                            start=float(seg.get("start", 0.0)),
                            end=float(seg.get("end", 0.0)),
                        )
                    )

            duration = 0.0
            for wb in word_boundaries:
                duration = max(duration, wb.end)
            if duration <= 0.0 and result.get("segments"):
                duration = float(result["segments"][-1].get("end", 0.0))

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
    async def upload_audio(file: UploadFile) -> dict[str, object]:
        try:
            import whisper
        except ImportError as e:
            raise HTTPException(status_code=501, detail=f"openai-whisper not installed: {e}") from e

        ext = os.path.splitext(file.filename or "")[1] or ".webm"
        filename = f"{uuid.uuid4().hex}{ext}"
        rel_path = f"assets/audio/{filename}"
        abs_path = os.path.join(_AUDIO_ASSETS_DIR, filename)

        try:
            body = await file.read()
            with open(abs_path, "wb") as out_f:
                shutil.copyfileobj(BytesIO(body), out_f)

            model = _get_whisper_model()
            result = model.transcribe(
                abs_path,
                word_timestamps=True,
                language="he",
            )

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
                            "word": txt or "…",
                            "start": float(seg.get("start", 0.0)),
                            "end": float(seg.get("end", 0.0)),
                        }
                    )

            duration = 0.0
            for wb in word_boundaries:
                duration = max(duration, float(wb["end"]))
            if duration <= 0.0 and result.get("segments"):
                duration = float(result["segments"][-1].get("end", 0.0))

            boundaries = word_boundaries
            print(f"DEBUG: Found {len(boundaries)} words")
            return {
                "file_path": rel_path,
                "duration": duration,
                "word_boundaries": word_boundaries,
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

    def _which_ffmpeg() -> str | None:
        return shutil.which("ffmpeg")

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

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    class RenderRequest(BaseModel):
        python_code: str = Field(..., description="Full Manim scene Python source")
        quality: str = Field(..., description="Render quality: l, m, h, or k")
        scene_name: str = Field(..., description="Scene class name for manim CLI")

    def _cleanup_render_workdir(path: str) -> None:
        shutil.rmtree(path, ignore_errors=True)

    def _stage_project_assets_for_render(work_dir: str) -> None:
        """Copy ``assets/audio`` from the repo into *work_dir*.

        Timeline export emits ``self.add_sound("assets/audio/...")`` paths relative to the
        process cwd. ``manim`` is run with ``cwd=work_dir`` (a temp directory), so without
        this step audio files are missing and ``construct()`` fails.
        """
        src = os.path.join(_ROOT, "assets", "audio")
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
                raise HTTPException(
                    status_code=500,
                    detail="No MP4 file found under media/videos after render.",
                )

            mp4_path: str | None = None
            for p in candidates:
                if os.path.splitext(os.path.basename(p))[0] == scene:
                    mp4_path = p
                    break
            if mp4_path is None:
                mp4_path = max(candidates, key=lambda p: os.path.getmtime(p))

            return FileResponse(
                mp4_path,
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
