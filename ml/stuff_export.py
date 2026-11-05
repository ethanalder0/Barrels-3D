"""Write the Stuff model out for the server, and prove the copy is exact.

    python ml/stuff_export.py

Reads ml/models/stuff_lgbm.txt (from stuff_train.py --final) and writes
server/models/stuff_trees.json, walked in plain Python by server/stuff_model.py.
The same contract as export_model.py: it scores real pitches with LightGBM and
with the plain walker, refuses to write if any prediction differs by more than
1e-9, and stores a sample with LightGBM's answers for selftest.py to re-check.

Unlike the outcome model this one has a CATEGORICAL split (pitch type), which
LightGBM dumps as "a||b||c": the category indices that go left. Those become
lists here.

It also reports what the server's view costs: the model run on each
pitcher-pitch's season AVERAGES, with horizontal break unsigned and re-signed by
type as the Savant board forces, against the mean of its per-pitch predictions.
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
SOURCE = ML / "models" / "stuff_lgbm.txt"
TARGET = ROOT / "server" / "models" / "stuff_trees.json"
DATA = ML / "data" / "stuff.parquet"
FEATURES = ["pitch_type", "velo", "hb", "ivb", "arm_angle", "velo_gap", "hb_gap", "ivb_gap"]
TOLERANCE = 1e-9
CHECKS_IN_FILE = 40


def flatten(structure: dict) -> dict:
    nodes, leaves = [], []

    def walk(node: dict) -> int:
        if "leaf_value" in node:
            leaves.append(node["leaf_value"])
            return ~(len(leaves) - 1)
        kind = node.get("decision_type", "<=")
        if kind == "<=":
            threshold = node["threshold"]
        elif kind == "==":
            threshold = [int(c) for c in str(node["threshold"]).split("||")]
        else:
            raise ValueError(f"unsupported split {kind}")
        i = len(nodes)
        nodes.append(None)
        left = walk(node["left_child"])
        right = walk(node["right_child"])
        nodes[i] = [node["split_feature"], threshold, left, right,
                    bool(node["default_left"]), node.get("missing_type", "None")]
        return i

    root = walk(structure)
    if root < 0:
        nodes.append([0, float("inf"), root, root, True, "None"])
    return {"n": nodes, "v": leaves}


def main() -> int:
    booster = lgb.Booster(model_file=str(SOURCE))
    if booster.feature_name() != FEATURES:
        sys.exit(f"model features {booster.feature_name()} != {FEATURES}")
    dump = booster.dump_model()
    categories = dump["pandas_categorical"][0]
    model = {
        "source": SOURCE.name,
        "features": FEATURES,
        "categories": categories,
        "trees": [flatten(t["tree_structure"]) for t in dump["tree_info"]],
    }

    sys.path.insert(0, str(ROOT / "server"))
    import stuff_model

    stuff_model._model.cache_clear()
    in_memory = json.loads(json.dumps(model))
    for tree in in_memory["trees"]:
        for node in tree["n"]:
            if isinstance(node[1], list):
                node[1] = frozenset(node[1])
    stuff_model._model = lambda: in_memory

    df = pd.read_parquet(DATA)
    df["pitch_type"] = pd.Categorical(df["pitch_type"], categories=categories)
    rows = pd.concat([df.sample(800, random_state=11), df[df["velo_gap"].isna()].head(20)])
    want = booster.predict(rows[FEATURES])
    x = np.column_stack([rows["pitch_type"].cat.codes.to_numpy(float)] +
                        [rows[f].to_numpy(float) for f in FEATURES[1:]])
    got = np.array([stuff_model.predict(list(r)) for r in x])
    worst = float(np.abs(want - got).max())
    print(f"checked {len(rows)} pitches ({int(np.isnan(x[:, 5]).sum())} with no fastball): "
          f"largest difference from LightGBM {worst:.2e}")
    if worst > TOLERANCE:
        sys.exit("plain walker does not match LightGBM; not exporting")

    # What the server's view costs, on the latest season.
    season = int(df["season"].max())
    d = df[df["season"] == season].assign(pred=booster.predict(df.loc[df["season"] == season, FEATURES]))
    g = d.groupby(["pitcher", "pitch_type"], observed=True).agg(
        n=("pred", "size"), per_pitch=("pred", "mean"), velo=("velo", "mean"), hb=("hb", "mean"),
        ivb=("ivb", "mean"), arm=("arm_angle", "mean")).reset_index()
    g = g[g["n"] >= 50]
    board = {}
    for pid, grp in g.groupby("pitcher"):
        pitches = {str(r.pitch_type): {"velo": r.velo, "breakX": abs(r.hb), "ivb": r.ivb, "pitches": r.n}
                   for r in grp.itertuples()}
        stuff = stuff_model.arsenal_stuff(pitches, float(grp["arm"].iloc[0]))
        exact = 100 * (grp["per_pitch"] * grp["n"]).sum() / grp["n"].sum()
        if stuff and grp["n"].sum() >= 1000:
            board[pid] = (stuff[0], exact)
    a, b = zip(*board.values())
    print(f"{season}, pitchers with 1000+ pitches: Stuff from season averages vs from every pitch, "
          f"r = {np.corrcoef(a, b)[0, 1]:.3f} (n={len(board)})")

    model["checks"] = [
        {"x": [None if np.isnan(v) else float(v) for v in x[i]], "y": float(want[i])}
        for i in range(CHECKS_IN_FILE)
    ]
    TARGET.write_text(json.dumps(model, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(model['trees'])} trees -> {TARGET.relative_to(ROOT)} "
          f"({TARGET.stat().st_size / 1e3:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
