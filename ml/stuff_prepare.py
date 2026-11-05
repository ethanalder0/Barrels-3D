"""Build the per-pitch table the Stuff model trains on.

    python ml/stuff_prepare.py

Reads every regular-season pitch fetch.py saved under ml/data/raw/ and writes
ml/data/stuff.parquet: one row per pitch, with the pitch's physical
characteristics, the same characteristics relative to the pitcher's own primary
fastball that season, and what the pitch was worth.

WHAT "STUFF" IS HERE. How good a pitch is from its physics alone -- speed,
shape, release -- before location, count or the hitter come into it. So the
inputs never include plate_x / plate_z: where a pitch ends up is command, and
command is its own attribute on the card.

HANDEDNESS. Every horizontal measure is turned into "arm side positive" so a
lefty's sinker and a righty's sinker are the same number. Statcast x is from the
catcher's view, positive toward first base, so a right-hander's arm side is
negative x: his values are flipped.

THE PRIMARY FASTBALL is the pitcher's most-thrown four-seamer, sinker or cutter
that season. Every pitch is also described against it (speed gap, horizontal
and vertical gap), because a changeup is good largely by looking like that
fastball and arriving 9 mph later -- which no comparison to the league's
average changeup can see.

TRAINED ON WHAT THE SERVER SEES. The deployed server cannot see pitches, only
Savant's season boards, so two inputs are deliberately coarsened to match them:
arm angle is the pitcher's SEASON average (the custom board gives one number
per pitcher), and knuckle curves are counted as curveballs (the movement board
folds KC into CU). Horizontal break on that board is unsigned; ratings.py puts
the sign back by pitch type, which is right for 98.9% of 2026 pitcher-pitches.

TARGET. `delta_run_exp`: the change in the batting side's run expectancy the
pitch caused, which is Savant's own pitch run value. Lower is better for the
pitcher. It is very noisy per pitch; the model learns its expectation.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ML = Path(__file__).resolve().parent
RAW = ML / "data" / "raw"
OUT = ML / "data" / "stuff.parquet"

TYPES = ["FF", "SI", "FC", "SL", "ST", "SV", "CU", "KC", "CH", "FS"]
MODEL_TYPES = [t for t in TYPES if t != "KC"]  # KC is folded into CU, as on the board
FASTBALLS = ["FF", "SI", "FC"]
COLUMNS = [
    "game_type", "pitcher", "player_name", "p_throws", "pitch_type", "release_speed",
    "pfx_x", "pfx_z", "arm_angle", "release_extension", "release_spin_rate",
    "release_pos_x", "release_pos_z", "delta_run_exp", "description",
]
WHIFFS = {"swinging_strike", "swinging_strike_blocked", "foul_tip"}
SWINGS = WHIFFS | {"foul", "hit_into_play", "foul_bunt", "missed_bunt"}


def season_table(season: int) -> pd.DataFrame:
    files = sorted((RAW / str(season)).glob("*.parquet"))
    if not files:
        return pd.DataFrame()
    df = pd.concat([pd.read_parquet(f, columns=COLUMNS) for f in files], ignore_index=True)
    df = df[(df["game_type"] == "R") & df["pitch_type"].isin(TYPES)].copy()
    df = df.dropna(subset=["release_speed", "pfx_x", "pfx_z", "delta_run_exp"])

    arm = np.where(df["p_throws"] == "R", -1.0, 1.0)
    out = pd.DataFrame({
        "season": season,
        "pitcher": df["pitcher"].astype(np.int64),
        "name": df["player_name"],
        "throws": df["p_throws"],
        "pitch_type": df["pitch_type"],
        "velo": df["release_speed"].astype(np.float32),
        "hb": (df["pfx_x"] * 12 * arm).astype(np.float32),     # inches, arm side +
        "ivb": (df["pfx_z"] * 12).astype(np.float32),          # inches, induced (no gravity)
        "arm_angle": df["arm_angle"].astype(np.float32),
        "extension": df["release_extension"].astype(np.float32),
        "spin": df["release_spin_rate"].astype(np.float32),
        "rel_side": (df["release_pos_x"] * arm).astype(np.float32),
        "rel_height": df["release_pos_z"].astype(np.float32),
        "rv": df["delta_run_exp"].astype(np.float32),
        "whiff": df["description"].isin(WHIFFS),
        "swing": df["description"].isin(SWINGS),
    })

    out["pitch_type"] = out["pitch_type"].replace({"KC": "CU"})
    out["arm_angle"] = out.groupby("pitcher")["arm_angle"].transform("mean")

    # The primary fastball: most-thrown of FF / SI / FC for this pitcher this season.
    fb = out[out["pitch_type"].isin(FASTBALLS)]
    counts = fb.groupby(["pitcher", "pitch_type"]).size().rename("n").reset_index()
    primary = counts.sort_values("n", ascending=False).drop_duplicates("pitcher")
    means = fb.merge(primary[["pitcher", "pitch_type"]], on=["pitcher", "pitch_type"]) \
        .groupby("pitcher")[["velo", "hb", "ivb"]].mean() \
        .rename(columns=lambda c: f"fb_{c}")
    out = out.join(means, on="pitcher")
    out["velo_gap"] = out["velo"] - out["fb_velo"]
    out["hb_gap"] = out["hb"] - out["fb_hb"]
    out["ivb_gap"] = out["ivb"] - out["fb_ivb"]
    return out.drop(columns=["fb_velo", "fb_hb", "fb_ivb"])


def main() -> int:
    seasons = sorted(int(p.name) for p in RAW.iterdir() if p.is_dir() and p.name.isdigit())
    tables = []
    for season in seasons:
        t = season_table(season)
        if t.empty:
            continue
        missing = t[["arm_angle", "extension", "spin", "velo_gap"]].isna().mean().round(4).to_dict()
        print(f"{season}: {len(t):,} pitches, {t['pitcher'].nunique():,} pitchers, missing {missing}")
        tables.append(t)
    if not tables:
        print("no raw pitches under ml/data/raw -- run ml/fetch.py first", file=sys.stderr)
        return 1
    df = pd.concat(tables, ignore_index=True)
    df["pitch_type"] = pd.Categorical(df["pitch_type"], categories=MODEL_TYPES)
    df.to_parquet(OUT, index=False)
    print(f"wrote {OUT.relative_to(ML.parent)}: {len(df):,} rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
