"""Write the trained model out for the server, and prove the copy is exact.

    python ml/export_model.py

Reads ml/models/outcome_lgbm.txt (from train.py --final) and writes
server/models/outcome_trees.json: every tree as flat arrays the server walks in
plain Python (server/outcome_model.py), so the deployed server needs no
LightGBM, numpy or scipy.

Before writing, it scores real balls in play with both LightGBM and the plain
evaluator and refuses to export if any probability differs by more than 1e-9.
A sample of those balls goes into the file too, with LightGBM's answers, so the
server's self-test can keep checking the copy after it ships.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

ML = Path(__file__).resolve().parent
ROOT = ML.parent
SOURCE = ML / "models" / "outcome_lgbm.txt"
TARGET = ROOT / "server" / "models" / "outcome_trees.json"
FEATURES = ["launch_speed", "launch_angle", "spray_pull", "bats_left"]
CLASSES = ["out", "1B", "2B", "3B", "HR"]
TOLERANCE = 1e-9
CHECKS_IN_FILE = 40


def flatten(structure: dict) -> dict:
    """One LightGBM tree -> {"n": [[feature, threshold, left, right,
    default_left, missing], ...], "v": [leaf values]}. Children below zero
    point at leaves (leaf ~child)."""
    nodes, leaves = [], []

    def walk(node: dict) -> int:
        if "leaf_value" in node:
            leaves.append(node["leaf_value"])
            return ~(len(leaves) - 1)
        if node.get("decision_type", "<=") != "<=":
            raise ValueError(f"unsupported split {node.get('decision_type')}")
        i = len(nodes)
        nodes.append(None)
        left = walk(node["left_child"])
        right = walk(node["right_child"])
        nodes[i] = [node["split_feature"], node["threshold"], left, right,
                    bool(node["default_left"]), node.get("missing_type", "None")]
        return i

    root = walk(structure)
    if root < 0:  # a tree that is a single leaf
        nodes.append([0, float("inf"), root, root, True, "None"])
    return {"n": nodes, "v": leaves}


def balls_to_check() -> pd.DataFrame:
    bip = pd.read_parquet(ML / "data" / "bip.parquet")
    bip = bip[~bip["is_bunt"]]
    sample = bip.sample(600, random_state=11)
    # Make sure the awkward cases are in it: no spray, both sides.
    extra = bip[bip["spray_angle"].isna()].head(20)
    rows = pd.concat([sample, extra])
    rows["bats_left"] = (rows["stand"] == "L").astype(float)
    return rows


def main() -> int:
    booster = lgb.Booster(model_file=str(SOURCE))
    if booster.feature_name() != FEATURES:
        sys.exit(f"model features {booster.feature_name()} != {FEATURES}")
    dump = booster.dump_model()
    model = {
        "source": SOURCE.name,
        "features": FEATURES,
        "classes": CLASSES,
        "num_class": dump["num_class"],
        "trees": [flatten(t["tree_structure"]) for t in dump["tree_info"]],
    }

    # Check the plain evaluator against LightGBM before anything is written.
    sys.path.insert(0, str(ROOT / "server"))
    import outcome_model

    outcome_model._model.cache_clear()
    outcome_model._model = lambda: model  # evaluate the in-memory copy

    rows = balls_to_check()
    x = rows[FEATURES].to_numpy(float)
    want = booster.predict(x)
    got = np.array([outcome_model.probabilities(list(r)) for r in x])
    worst = float(np.abs(want - got).max())
    print(f"checked {len(rows)} balls ({int(np.isnan(x[:, 2]).sum())} with no spray): "
          f"largest difference from LightGBM {worst:.2e}")
    if worst > TOLERANCE:
        sys.exit("plain evaluator does not match LightGBM; not exporting")

    model["checks"] = [
        {"x": [None if np.isnan(v) else float(v) for v in x[i]], "p": [float(p) for p in want[i]]}
        for i in range(CHECKS_IN_FILE)
    ]
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(model, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(model['trees'])} trees -> {TARGET.relative_to(ROOT)} "
          f"({TARGET.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
