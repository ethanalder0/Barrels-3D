"""Outcome probabilities for one batted ball, from the trained model.

As a function:

    from predict import predict_outcomes
    predict_outcomes(exit_velo=104.5, launch_angle=27, spray_angle=-18, bats="R")

From a terminal, inside ml/:

    python predict.py 104.5 27 -18              # right-handed batter (default)
    python predict.py 95 12 20 --bats L
    python predict.py                           # interactive: type balls one at a time

Inputs, in the same units and conventions as the app and the training data:

    exit_velo     mph off the bat
    launch_angle  degrees above horizontal (negative is into the ground)
    spray_angle   degrees off dead center field, POSITIVE TOWARD RIGHT FIELD
                  (first base), negative toward left. This is the field angle,
                  not "pull": the batter's side turns it into pull here, the
                  same way prepare.py does, so a -18 from a right-hander and a
                  +18 from a left-hander are both a ball pulled 18 degrees.
    bats          "R" or "L", the side the batter hit from

Returns the five outcome probabilities (they sum to 1) plus two numbers
derived from them: xBA, the chance it is a hit, and xSLG, the expected total
bases.
"""

from __future__ import annotations

import argparse
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np

MODEL = Path(__file__).resolve().parent / "models" / "outcome_lgbm.txt"

# Must match train.py: the order the model was trained on, and its classes.
FEATURES = ["launch_speed", "launch_angle", "spray_pull", "bats_left"]
CLASSES = ["out", "1B", "2B", "3B", "HR"]
LABELS = {"out": "xOut%", "1B": "x1B%", "2B": "x2B%", "3B": "x3B%", "HR": "xHR%"}
BASES = {"out": 0, "1B": 1, "2B": 2, "3B": 3, "HR": 4}

# What the model has seen. Outside these it is extrapolating, so it refuses
# rather than return a confident-looking number about nothing.
LIMITS = {
    "exit_velo": (0.0, 125.0),
    "launch_angle": (-90.0, 90.0),
    "spray_angle": (-180.0, 180.0),
}


@lru_cache(maxsize=1)
def _booster():
    import lightgbm as lgb

    if not MODEL.exists():
        raise FileNotFoundError(f"no trained model at {MODEL}; run `python ml/train.py --final`")
    booster = lgb.Booster(model_file=str(MODEL))
    if booster.feature_name() != FEATURES:
        raise RuntimeError(
            f"model was trained on {booster.feature_name()}, this expects {FEATURES}"
        )
    return booster


def _check(name: str, value: float) -> float:
    lo, hi = LIMITS[name]
    value = float(value)
    if not (lo <= value <= hi) or np.isnan(value):
        raise ValueError(f"{name} {value} is outside {lo}..{hi}")
    return value


def predict_outcomes(exit_velo, launch_angle, spray_angle, bats="R") -> dict:
    """Probabilities of out / 1B / 2B / 3B / HR for one ball, plus xBA and xSLG.

    `spray_angle` may be None when the direction is not known; the model was
    trained with a few balls like that and falls back on speed and angle.
    """
    side = str(bats).strip().upper()[:1]
    if side not in ("R", "L"):
        raise ValueError(f"bats must be 'R' or 'L', not {bats!r}")
    ev = _check("exit_velo", exit_velo)
    la = _check("launch_angle", launch_angle)
    if spray_angle is None:
        pull = np.nan
    else:
        spray = _check("spray_angle", spray_angle)
        # Field angle -> pull, as prepare.py does: a right-hander pulls to
        # left field (negative), a left-hander to right (positive).
        pull = -spray if side == "R" else spray

    row = np.array([[ev, la, pull, 1.0 if side == "L" else 0.0]])
    probs = _booster().predict(row)[0]
    out = {c: float(p) for c, p in zip(CLASSES, probs)}
    out["xBA"] = float(sum(out[c] for c in CLASSES[1:]))
    out["xSLG"] = float(sum(out[c] * BASES[c] for c in CLASSES))
    return out


def describe(result: dict) -> str:
    """The result as a few aligned lines, most likely outcome marked."""
    likeliest = max(CLASSES, key=lambda c: result[c])
    lines = []
    for c in CLASSES:
        bar = "#" * round(result[c] * 40)
        mark = "  <- most likely" if c == likeliest else ""
        lines.append(f"  {LABELS[c]:<6} {result[c]:7.1%}  {bar}{mark}")
    lines.append(f"  {'xBA':<6} {result['xBA']:7.3f}")
    lines.append(f"  {'xSLG':<6} {result['xSLG']:7.3f}")
    return "\n".join(lines)


def _show(ev, la, spray, bats) -> None:
    result = predict_outcomes(ev, la, spray, bats)  # raises before anything prints
    where = "direction unknown" if spray is None else f"spray {spray:+g} deg"
    print(f"\n{ev:g} mph at {la:+g} deg, {where}, {bats.upper()} batter")
    print(describe(result))


def _interactive() -> int:
    print("Enter: exit_velo launch_angle spray_angle [R|L]   (blank line to quit)")
    print("spray: 0 = center field, + toward right field, - toward left")
    while True:
        try:
            # lstrip the byte-order mark PowerShell puts on piped-in text.
            line = input("\nball> ").lstrip("﻿").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if not line:
            return 0
        parts = line.replace(",", " ").split()
        try:
            if len(parts) not in (3, 4):
                raise ValueError("need 3 numbers, and optionally R or L")
            bats = parts[3] if len(parts) == 4 else "R"
            _show(float(parts[0]), float(parts[1]), float(parts[2]), bats)
        except ValueError as err:
            print(f"  {err}")


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Outcome probabilities for one batted ball.",
        epilog="With no arguments, runs interactively.",
    )
    ap.add_argument("exit_velo", nargs="?", type=float, help="mph")
    ap.add_argument("launch_angle", nargs="?", type=float, help="degrees")
    ap.add_argument(
        "spray_angle", nargs="?", type=float,
        help="degrees off center field, + toward right field, - toward left",
    )
    ap.add_argument("--bats", default="R", choices=["R", "L", "r", "l"], help="batter side (default R)")
    args = ap.parse_args()

    if args.exit_velo is None:
        return _interactive()
    if args.launch_angle is None or args.spray_angle is None:
        ap.error("give exit_velo, launch_angle and spray_angle, or nothing for interactive mode")
    try:
        _show(args.exit_velo, args.launch_angle, args.spray_angle, args.bats)
    except ValueError as err:
        ap.error(str(err))
    return 0


if __name__ == "__main__":
    sys.exit(main())
