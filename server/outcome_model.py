"""Expected outcomes for a ball in play: the trained model, without LightGBM.

The model (ml/train.py) is a LightGBM booster: 1,205 small decision trees.
Installing LightGBM on the server would pull numpy and scipy into an image that
otherwise needs one package, so ml/export_model.py writes the trees out as
plain JSON (server/models/outcome_trees.json) and this walks them. The export
checks the result against LightGBM itself on hundreds of real balls, and
selftest.py re-checks a stored sample on every run, so the two cannot drift.

    expected(exit_velo, launch_angle, coord_x, coord_y, bat_side)
        -> {"out": .., "1B": .., "2B": .., "3B": .., "HR": .., "xBA": .., "xSLG": ..}

Inputs are as the feed gives them: mph, degrees, MLB hit-grid coordinates and
the batter's side ("R"/"L"). Returns None when there is nothing to judge (no
exit velocity or launch angle) or no model file.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

MODEL_FILE = Path(__file__).resolve().parent / "models" / "outcome_trees.json"

# Home plate on MLB's hit grid. The same numbers as prepare.py and the app's
# fromHitGrid (src/replay/field/spec.js); all three have to agree.
GRID_HOME_X = 125.42
GRID_HOME_Y = 203.5

BASES = {"out": 0, "1B": 1, "2B": 2, "3B": 3, "HR": 4}


@lru_cache(maxsize=1)
def _model() -> dict | None:
    if not MODEL_FILE.exists():
        return None
    return json.loads(MODEL_FILE.read_text(encoding="utf-8"))


def _leaf(tree: dict, x: list[float]) -> float:
    """Walk one tree. Nodes are [feature, threshold, left, right, default_left,
    missing]; a child below zero is leaf ~child. Missing values follow
    LightGBM's own rule: NaN goes the default way on a node trained with NaNs,
    and counts as 0.0 on any other."""
    nodes, leaves = tree["n"], tree["v"]
    i = 0
    while i >= 0:
        feature, threshold, left, right, default_left, missing = nodes[i]
        value = x[feature]
        if math.isnan(value) and missing != "NaN":
            value = 0.0
        if (missing == "NaN" and math.isnan(value)) or (missing == "Zero" and value == 0.0):
            i = left if default_left else right
        else:
            i = left if value <= threshold else right
    return leaves[~i]


def probabilities(features: list[float]) -> list[float] | None:
    """Class probabilities for one row in the model's own feature order."""
    model = _model()
    if model is None:
        return None
    k = model["num_class"]
    raw = [0.0] * k
    for t, tree in enumerate(model["trees"]):
        raw[t % k] += _leaf(tree, features)  # trees cycle through the classes
    top = max(raw)
    exp = [math.exp(r - top) for r in raw]
    total = sum(exp)
    return [e / total for e in exp]


def spray_angle(coord_x, coord_y) -> float | None:
    """Degrees off dead center, positive toward right field."""
    if coord_x is None or coord_y is None:
        return None
    return math.degrees(math.atan2(coord_x - GRID_HOME_X, GRID_HOME_Y - coord_y))


def expected(exit_velo, launch_angle, coord_x, coord_y, bat_side) -> dict | None:
    # A copy, so a caller editing the dict cannot change the cached answer.
    out = _expected(exit_velo, launch_angle, coord_x, coord_y, (bat_side or "R").upper()[:1])
    return dict(out) if out else None


# A live game is re-projected on every poll and every ball in it comes round
# again, so each distinct ball is worked out once.
@lru_cache(maxsize=8192)
def _expected(exit_velo, launch_angle, coord_x, coord_y, side) -> dict | None:
    model = _model()
    if model is None or exit_velo is None or launch_angle is None:
        return None
    spray = spray_angle(coord_x, coord_y)
    # Field angle -> pull, as prepare.py does: a right-hander pulls to left.
    pull = float("nan") if spray is None else (-spray if side == "R" else spray)
    probs = probabilities([float(exit_velo), float(launch_angle), pull, 1.0 if side == "L" else 0.0])
    out = {c: round(p, 4) for c, p in zip(model["classes"], probs)}
    out["xBA"] = round(sum(p for c, p in zip(model["classes"], probs) if c != "out"), 3)
    out["xSLG"] = round(sum(p * BASES[c] for c, p in zip(model["classes"], probs)), 3)
    return out
