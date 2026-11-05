"""Stuff: what a pitch is worth from its physics alone, without LightGBM.

The model (ml/stuff_train.py) is a small LightGBM regression -- about fifty
trees -- predicting a pitch's run value (Savant's delta_run_exp, batting side's
view, so LOWER is better for the pitcher) from velocity, shape, arm angle and
the gaps to the pitcher's own primary fastball. ml/stuff_export.py writes the
trees to server/models/stuff_trees.json and checks this walker against
LightGBM before it does; selftest.py re-checks a stored sample on every run.

The server never sees individual pitches, only Savant's season averages per
pitch type, so `arsenal_stuff` runs the model on those averages. The model was
trained on inputs coarsened to match (see ml/stuff_prepare.py), and on 2026 the
averages version tracks the mean of per-pitch predictions at r = 0.90.

    run_value(pitch_type, velo, hb, ivb, arm_angle, velo_gap, hb_gap, ivb_gap)
        -> expected runs per pitch (batting side), or None
    arsenal_stuff(pitches, arm_angle)
        -> (runs per 100 pitches, pitches counted), or None

hb is horizontal break in inches, ARM SIDE positive; ivb is induced vertical
break in inches; gaps are this pitch minus his primary fastball.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

MODEL_FILE = Path(__file__).resolve().parent / "models" / "stuff_trees.json"

FASTBALLS = ("FF", "SI", "FC")
# Savant's pitch-movement board reports horizontal break as a magnitude. Which
# side it breaks to is put back by type: these move to the arm side, the rest to
# the glove side. Right for 98.9% of 2026 pitcher-pitches; the misses are
# mostly cutters with a little arm-side run, which are small breaks anyway.
ARM_SIDE = {"FF", "SI", "CH", "FS"}


@lru_cache(maxsize=1)
def _model() -> dict | None:
    if not MODEL_FILE.exists():
        return None
    model = json.loads(MODEL_FILE.read_text(encoding="utf-8"))
    # Categorical splits arrive as lists; sets make the walk O(1) per node.
    for tree in model["trees"]:
        for node in tree["n"]:
            if isinstance(node[1], list):
                node[1] = frozenset(node[1])
    return model


def _leaf(tree: dict, x: list[float]) -> float:
    """Walk one tree. Nodes are [feature, threshold, left, right, default_left,
    missing]; a child below zero is leaf ~child. A categorical node's threshold
    is the set of category indices that go left; anything else, including a
    missing value, goes right -- LightGBM's own rule."""
    nodes, leaves = tree["n"], tree["v"]
    i = 0
    while i >= 0:
        feature, threshold, left, right, default_left, missing = nodes[i]
        value = x[feature]
        if isinstance(threshold, frozenset):
            i = left if not math.isnan(value) and int(value) in threshold else right
            continue
        if math.isnan(value) and missing != "NaN":
            value = 0.0
        if (missing == "NaN" and math.isnan(value)) or (missing == "Zero" and value == 0.0):
            i = left if default_left else right
        else:
            i = left if value <= threshold else right
    return leaves[~i]


def predict(features: list[float]) -> float | None:
    """Raw model output for one row in the model's own feature order."""
    model = _model()
    if model is None:
        return None
    return sum(_leaf(t, features) for t in model["trees"])


def _num(v) -> float:
    return float("nan") if v is None else float(v)


def run_value(pitch_type, velo, hb, ivb, arm_angle, velo_gap=None, hb_gap=None, ivb_gap=None):
    model = _model()
    if model is None or velo is None or hb is None or ivb is None:
        return None
    code = "CU" if pitch_type == "KC" else pitch_type
    if code not in model["categories"]:
        return None
    return predict([float(model["categories"].index(code)), float(velo), float(hb), float(ivb),
                    _num(arm_angle), _num(velo_gap), _num(hb_gap), _num(ivb_gap)])


def arsenal_stuff(pitches: dict, arm_angle) -> tuple[float, float] | None:
    """A pitcher's Stuff: his pitches' expected run values, weighted by how many he threw.

    `pitches` is {code: {"velo", "breakX", "ivb", "pitches"}} from Savant's
    pitch-movement board, breakX unsigned. Returns runs per 100 pitches (lower
    is better) and the pitches it covers.
    """
    shaped = {}
    for code, p in pitches.items():
        if p.get("velo") is None or p.get("breakX") is None or p.get("ivb") is None or not p.get("pitches"):
            continue
        side = 1.0 if code in ARM_SIDE else -1.0
        shaped[code] = (p["velo"], side * abs(p["breakX"]), p["ivb"], p["pitches"])
    if not shaped:
        return None

    fastballs = [c for c in FASTBALLS if c in shaped]
    primary = max(fastballs, key=lambda c: shaped[c][3]) if fastballs else None
    fb = shaped[primary] if primary else None

    total = count = 0.0
    for code, (velo, hb, ivb, n) in shaped.items():
        gaps = (velo - fb[0], hb - fb[1], ivb - fb[2]) if fb else (None, None, None)
        rv = run_value(code, velo, hb, ivb, arm_angle, *gaps)
        if rv is None:
            continue
        total += rv * n
        count += n
    return (100.0 * total / count, count) if count else None
