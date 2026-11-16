"""Imported by the exported scene during a timing sweep: logs every leaf animation's
scene-time window and every add_sound, attributed to the construct() variables involved.

Writes JSON to the path in TIMING_SWEEP_OUT when the process exits.
"""
import atexit
import inspect
import json
import os

from manim import Animation, AnimationGroup, Mobject, Scene, Wait
from manim.animation.animation import prepare_animation

LOG = []
_NAMED = {}  # id(mobject) -> (names, mobject)


def _refresh_names():
    f = inspect.currentframe()
    while f and f.f_code.co_name != "construct":
        f = f.f_back
    if not f:
        return
    _NAMED.clear()
    for k, v in f.f_locals.items():
        if isinstance(v, Mobject) and not k.startswith("_"):
            names, _ = _NAMED.get(id(v), ([], v))
            _NAMED[id(v)] = (names + [k], v)


def _names_for(mob):
    if mob is None:
        return []
    if id(mob) in _NAMED:
        return sorted(_NAMED[id(mob)][0])
    # Unnamed group (FadeOut(*line_1), FadeOut(a, b)): attribute through each piece.
    out = []
    for piece in mob.submobjects or [mob]:
        if id(piece) in _NAMED:
            out.extend(_NAMED[id(piece)][0])
            continue
        for names, parent in _NAMED.values():
            if piece in parent.get_family():
                out.extend(names)
    return sorted(set(out))


def _walk(anim, t0, dur):
    # AnimationGroup.interpolate maps group alpha onto max_end_time, so nested timings scale
    # with the group's actual run time.
    if isinstance(anim, AnimationGroup):
        max_end = anim.max_end_time or 1e-9
        for row in anim.anims_with_timings:
            a, s, e = row["anim"], float(row["start"]), float(row["end"])
            _walk(a, t0 + s / max_end * dur, (e - s) / max_end * dur)
        return
    if isinstance(anim, Wait):
        return
    LOG.append({
        "anim": type(anim).__name__,
        "vars": _names_for(getattr(anim, "mobject", None)),
        "start": round(t0, 6),
        "end": round(t0 + dur, 6),
    })


_orig_play = Scene.play
_orig_sound = Scene.add_sound


def _play(self, *args, **kwargs):
    _refresh_names()
    # `mob.animate...` arrives as a builder; build it here so the logged object is the played one.
    anims = [a if isinstance(a, Animation) else prepare_animation(a) for a in args]
    t0 = self.renderer.time
    _orig_play(self, *anims, **kwargs)
    t1 = self.renderer.time
    for a in anims:
        if isinstance(a, Animation):
            _walk(a, t0, t1 - t0)


def _add_sound(self, sound_file, time_offset=0, gain=None, **kwargs):
    t = self.renderer.time + time_offset
    LOG.append({"anim": "<sound>", "vars": [sound_file], "start": round(t, 6), "end": round(t, 6)})
    return _orig_sound(self, sound_file, time_offset, gain, **kwargs)


Scene.play = _play
Scene.add_sound = _add_sound


@atexit.register
def _dump():
    with open(os.environ["TIMING_SWEEP_OUT"], "w", encoding="utf-8") as f:
        json.dump(LOG, f, indent=1)
