"""Timing sweep: does the exported video animate each clip when the timeline says it should?

Exports the fixture scenes in src/codegen/timingSweep.ts with the real exporter, runs each in
Manim with --dry_run (scene clock advances by exact run times, no frames are rendered) while
timing_sweep_instrument.py logs every animation, and compares the measured windows with
clipAnimationWindow() (src/lib/clipWindows.ts), the window the canvas preview follows.

Usage, from the repo root:  python manim-timeline/scripts/timing-sweep/run_sweep.py [--keep]
Needs Node (npx), Manim and LaTeX. Exits 1 on any mismatch. Takes about a minute (TeX).
"""
from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import wave
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
UI = HERE.parents[1]
ROOT = UI.parent
TOL = 0.01  # seconds; dry runs have no frame rounding

EXIT = {"FadeOut", "Uncreate", "ShrinkToCenter", "Unwrite"}
# In a concurrent cluster, move/rotate/scale/colour steps are ApplyFunction (see animateExpr).
TARGET = {"_MethodAnimation", "ApplyFunction", "MoveAlongPath", "UpdateFromAlphaFunc", "Rotate"}
# A blink inside a concurrent cluster is built from ApplyFunction steps (see animateExpr in blinkCodegen.ts).
BLINK = {"_MethodAnimation", "ApplyFunction"}
ROLE_CLASSES = {"exit": EXIT, "blink": BLINK, "target": TARGET}
# Audio fixture lengths (seconds) for narrationScene() in timingSweep.ts.
AUDIO = {"s1.wav": 2.0, "s2.wav": 2.6, "s3.wav": 1.4, "s4.wav": 4.0}


def write_png(path: Path, w: int = 12, h: int = 8) -> None:
    raw = b"".join(b"\x00" + b"\xf0\xac\x5f" * w for _ in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def write_wav(path: Path, seconds: float, rate: int = 8000) -> None:
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(b"\x00\x00" * int(seconds * rate))


def owner_of(var: str, vars_by_item: dict[str, list[str]]) -> str | None:
    """Item whose variable prefix matches `var` longest (axes_1 vs axes_1_plot_x)."""
    if var.endswith("_tgt"):  # surrounding-rect alias of its target, not a mobject of its own
        return None
    best, best_len = None, -1
    for item_id, prefixes in vars_by_item.items():
        for p in prefixes:
            if (var == p or var.startswith(p + "_")) and len(p) > best_len:
                best, best_len = item_id, len(p)
    return best


def check_scene(name: str, expect: dict, actual: list[dict]) -> list[tuple]:
    vars_by_item = expect["vars"]
    rows = []
    for e in expect["expectations"]:
        if e["role"] == "camera":
            rows.append((name, e["id"], e["kind"], e["start"], e["end"], None, None, "skip (camera writer spans its cluster)"))
            continue
        if e["role"] == "sound":
            hits = [a for a in actual if a["anim"] == "<sound>" and a["vars"] == e["vars"]]
            if len(hits) != 1:
                status = f"FAIL added {len(hits)}x"
            else:
                status = "ok" if abs(hits[0]["start"] - e["start"]) <= TOL else "FAIL"
            first = hits[0]["start"] if hits else None
            rows.append((name, e["id"], "audio", e["start"], e["end"], first, first, status))
            continue
        if e["role"] == "intro":
            owners = {e["id"]}
            ok_class = lambda c: c not in EXIT | TARGET | BLINK  # noqa: E731
        else:
            owners = {owner_of(v, vars_by_item) for v in e["vars"]}
            classes = ROLE_CLASSES[e["role"]]
            ok_class = lambda c, classes=classes: c in classes  # noqa: E731
        cands = [
            a for a in actual
            if a["anim"] != "<sound>" and ok_class(a["anim"])
            and any(owner_of(v, vars_by_item) in owners for v in a["vars"])
        ]
        if e["role"] != "intro":
            # Clips of the same class on one target (scale then color): keep the ones in this window.
            near = [a for a in cands if e["start"] - 0.5 <= a["start"] <= e["end"] + TOL]
            cands = near or cands[:1]
        if not cands:
            rows.append((name, e["id"], e["kind"], e["start"], e["end"], None, None, "FAIL no animation found"))
            continue
        s, t = min(a["start"] for a in cands), max(a["end"] for a in cands)
        ok = abs(s - e["start"]) <= TOL and abs(t - e["end"]) <= TOL
        rows.append((name, e["id"], e["kind"], e["start"], e["end"], s, t, "ok" if ok else "FAIL"))
    return rows


def main() -> int:
    keep = "--keep" in sys.argv
    work = Path(tempfile.mkdtemp(prefix="timing_sweep_"))
    try:
        npx = "npx.cmd" if os.name == "nt" else "npx"
        subprocess.run(
            [npx, "vite-node", "--config", "vitest.config.ts", "scripts/timing-sweep/export.ts", str(work)],
            cwd=UI, check=True,
        )
        (work / "assets" / "textures").mkdir(parents=True)
        (work / "assets" / "audio").mkdir(parents=True)
        write_png(work / "assets" / "textures" / "sweep.png")
        for fname, sec in AUDIO.items():
            write_wav(work / "assets" / "audio" / fname, sec)
        shutil.copy(HERE / "timing_sweep_instrument.py", work)

        env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
        env["PYTHONPATH"] = os.pathsep.join([str(work), str(ROOT), env.get("PYTHONPATH", "")])
        rows = []
        for expect_file in sorted(work.glob("*.expect.json")):
            name = expect_file.name.removesuffix(".expect.json")
            code = (work / f"{name}.py").read_text(encoding="utf-8").split("\n", 1)
            (work / f"run_{name}.py").write_text(code[0] + "\nimport timing_sweep_instrument\n" + code[1], encoding="utf-8")
            out = work / f"actual_{name}.json"
            proc = subprocess.run(
                [sys.executable, "-m", "manim", "render", f"run_{name}.py", name, "--dry_run", "--progress_bar", "none"],
                cwd=work, env=dict(env, TIMING_SWEEP_OUT=str(out)), capture_output=True, text=True, encoding="utf-8", errors="replace",
            )
            if proc.returncode != 0 or not out.exists():
                print(f"{name}: Manim failed\n{(proc.stderr or proc.stdout)[-2000:]}")
                return 1
            rows += check_scene(name, json.loads(expect_file.read_text(encoding="utf-8")), json.loads(out.read_text(encoding="utf-8")))

        fmt = lambda v: "-" if v is None else f"{v:7.3f}"  # noqa: E731
        print(f"{'scene':<11}{'clip':<14}{'kind':<20}{'expected':>17}{'actual':>17}  status")
        for scene, cid, kind, es, ee, s, t, status in rows:
            print(f"{scene:<11}{cid:<14}{kind:<20}{fmt(es)}-{fmt(ee)}  {fmt(s)}-{fmt(t)}  {status}")
        failed = [r for r in rows if r[-1].startswith("FAIL")]
        print(f"\n{len(rows) - len(failed)} ok, {len(failed)} failed")
        if keep:
            print(f"work dir kept: {work}")
        return 1 if failed else 0
    finally:
        if not keep:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
