"""ffmpeg filter graph for the narration mixdown (pure: ``measure_server`` probes files and runs ffmpeg).

Each narration clip plays ``duration_sec`` seconds of its file from ``source_in_sec`` (a clip can be
a piece of a longer recording), with its gain and cut fades, at ``start_sec`` on the timeline. The
optional background bed is input ``len(clips)``, looped by the caller (``-stream_loop -1``).

``amix`` runs with ``normalize=0``: its default divides every input by the number of inputs still
running, so with N clips the first one played at 1/N volume and the level rose as clips ended. A
latency-compensated limiter after the sum catches peaks where clips overlap.
"""

from __future__ import annotations

from dataclasses import dataclass

LIMIT = 0.97
SAMPLE_RATE = 48000


@dataclass
class MixClip:
    file_duration: float
    start_sec: float = 0.0
    fade_in_ms: float = 0.0
    fade_out_ms: float = 0.0
    gain_db: float = 0.0
    source_in_sec: float = 0.0
    duration_sec: float | None = None


def clip_span(clip: MixClip) -> tuple[float, float]:
    """(source in, length) clamped to the file; length 0 means the clip plays nothing."""
    file_dur = max(0.0, float(clip.file_duration))
    src_in = min(max(0.0, float(clip.source_in_sec)), file_dur)
    rest = file_dur - src_in
    length = rest if clip.duration_sec is None else min(max(0.0, float(clip.duration_sec)), rest)
    return src_in, length


def clip_filter(index: int, clip: MixClip) -> str | None:
    """``[index:a]…[a<index>]`` for one clip, or None when it plays nothing."""
    src_in, length = clip_span(clip)
    if length <= 0.0005:
        return None
    fade_in = max(0.0, float(clip.fade_in_ms) / 1000.0)
    fade_out = max(0.0, float(clip.fade_out_ms) / 1000.0)
    if fade_in + fade_out > length:
        scale = length / (fade_in + fade_out)
        fade_in *= scale
        fade_out *= scale

    parts: list[str] = []
    if src_in > 0 or clip.duration_sec is not None:
        parts.append(f"atrim=start={src_in:.4f}:duration={length:.4f}")
        parts.append("asetpts=PTS-STARTPTS")
    if clip.gain_db:
        parts.append(f"volume={float(clip.gain_db):.2f}dB")
    if fade_in > 0:
        parts.append(f"afade=t=in:st=0:d={fade_in:.4f}")
    if fade_out > 0:
        parts.append(f"afade=t=out:st={length - fade_out:.4f}:d={fade_out:.4f}")
    delay_ms = int(round(max(0.0, float(clip.start_sec)) * 1000))
    parts.append(f"adelay=delays={delay_ms}:all=1")
    return f"[{index}:a]" + ",".join(parts) + f"[a{index}]"


def mixdown_filter_graph(
    clips: list[MixClip],
    total_duration_sec: float,
    bed_gain_db: float | None = None,
) -> str:
    """``-filter_complex`` value ending in ``[out]``; the bed (when given) is input ``len(clips)``."""
    total = max(0.01, float(total_duration_sec))
    parts: list[str] = []
    labels: list[str] = []
    for i, clip in enumerate(clips):
        f = clip_filter(i, clip)
        if f is not None:
            parts.append(f)
            labels.append(f"[a{i}]")
    if bed_gain_db is not None:
        bed = len(clips)
        parts.append(
            f"[{bed}:a]atrim=0:{total:.4f},asetpts=PTS-STARTPTS,volume={float(bed_gain_db)}dB[bed]"
        )
        labels.append("[bed]")
    if not labels:
        raise ValueError("mixdown has nothing to play")

    # Sample-exact length: resample first, then pad/cut to the scene's sample count.
    n = int(round(total * SAMPLE_RATE))
    tail = (
        f"aresample={SAMPLE_RATE},alimiter=limit={LIMIT}:level=0:latency=1,"
        f"apad=whole_len={n},atrim=end_sample={n}[out]"
    )
    if len(labels) == 1:
        parts.append(f"{labels[0]}{tail}")
    else:
        parts.append(
            "".join(labels)
            + f"amix=inputs={len(labels)}:duration=longest:dropout_transition=0:normalize=0,"
            + tail
        )
    return ";".join(parts)
