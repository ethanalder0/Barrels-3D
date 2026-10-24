"""Turn the downloaded seasons into one balls-in-play table.

    python ml/prepare.py                # every season on disk
    python ml/prepare.py 2023 2024      # just these

Reads ml/data/raw/<season>/pitches_*.parquet (from fetch.py) and writes
ml/data/bip.parquet: one row per ball put in play, with the five-class outcome
label and the features the hit-probability model trains on. Prints what was
kept and dropped at every step, because a dataset nobody can account for is
not one anyone should trust.

The spray angle is computed exactly the way the app computes it from the same
hit-grid coordinates (src/replay/field/spec.js: fromHitGrid, thetaOf), so the
model sees the same number in training that it will see on a live ball.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ML = Path(__file__).resolve().parent
RAW = ML / "data" / "raw"
OUT = ML / "data" / "bip.parquet"

# Savant `events` on a ball in play -> the five classes the model predicts.
# Errors count as outs: the batter did not earn the base, and the model is
# about what the contact deserved, not about the fielding. Sacrifices are outs
# too. Anything not listed is reported and dropped rather than guessed at.
OUTCOME = {
    "single": "1B",
    "double": "2B",
    "triple": "3B",
    "home_run": "HR",
    **{
        e: "out"
        for e in (
            "field_out",
            "force_out",
            "grounded_into_double_play",
            "double_play",
            "triple_play",
            "fielders_choice",
            "fielders_choice_out",
            "field_error",
            "sac_fly",
            "sac_fly_double_play",
            "sac_bunt",
            "sac_bunt_double_play",
        )
    },
}
CLASSES = ["out", "1B", "2B", "3B", "HR"]

# The hit grid's origin (home plate) in MLB's coordinate space. Same numbers
# as fromHitGrid in src/replay/field/spec.js; keep the two in step.
GRID_HOME_X = 125.42
GRID_HOME_Y = 203.5

KEEP = [
    # identity, for joins and for the time split
    "game_pk", "game_date", "at_bat_number", "pitch_number", "home_team",
    "batter", "pitcher", "stand", "p_throws",
    # the contact
    "launch_speed", "launch_angle", "hc_x", "hc_y", "bb_type", "des",
    # the result
    "events",
    # Savant's own expected stats, the benchmark to beat (never a feature)
    "estimated_ba_using_speedangle", "estimated_woba_using_speedangle",
    # measured partly from where the ball ended up, so it leaks the outcome:
    # kept for analysis only, never a feature
    "hit_distance_sc",
]


def load(seasons: list[int]) -> pd.DataFrame:
    frames = []
    for season in seasons:
        files = sorted((RAW / str(season)).glob("pitches_*.parquet"))
        if not files:
            print(f"{season}: no files in {RAW / str(season)}, skipping")
            continue
        df = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
        df["season"] = season
        print(f"{season}: {len(df):,} pitches from {len(files)} files")
        frames.append(df)
    if not frames:
        sys.exit("nothing to prepare: run fetch.py first")
    return pd.concat(frames, ignore_index=True)


def spray_angle(hc_x: pd.Series, hc_y: pd.Series) -> pd.Series:
    """Degrees off dead center, positive toward right field (first base)."""
    return np.degrees(np.arctan2(hc_x - GRID_HOME_X, GRID_HOME_Y - hc_y))


def prepare(seasons: list[int]) -> pd.DataFrame:
    pitches = load(seasons)
    log = []

    def step(label: str, df: pd.DataFrame) -> pd.DataFrame:
        log.append((label, len(df)))
        return df

    # Ball in play: Savant's pitch `type` is B (ball), S (strike) or X (in play).
    bip = step("balls in play", pitches[pitches["type"] == "X"])

    # The same pitch can come back twice if a month was ever re-downloaded.
    bip = step(
        "after de-duplicating pitches",
        bip.drop_duplicates(["game_pk", "at_bat_number", "pitch_number"]),
    )

    bip = bip[KEEP + ["season"]].copy()
    bip["outcome"] = bip["events"].map(OUTCOME)
    unmapped = bip.loc[bip["outcome"].isna(), "events"].value_counts(dropna=False)
    bip = step("with a known outcome", bip[bip["outcome"].notna()])

    # The two numbers every model here starts from. A ball Statcast did not
    # track (a rare miss, usually a bunt or a check-swing dribbler) has neither.
    bip = step(
        "with exit velocity and launch angle",
        bip.dropna(subset=["launch_speed", "launch_angle"]),
    )

    # Spray from the hit grid. Kept as NaN, not dropped, when the coordinates
    # are missing: a tree model can still use the speed and angle.
    bip["spray_angle"] = spray_angle(bip["hc_x"], bip["hc_y"])
    # The same angle with pull as positive whatever the batter's side: a
    # right-hander pulls to left field (negative), a left-hander to right.
    bip["spray_pull"] = np.where(bip["stand"] == "R", -bip["spray_angle"], bip["spray_angle"])

    # Bunts are a different skill (placement, the fielders charging) and would
    # pull the model around near zero exit velocity. Flagged, not dropped, so
    # the modeling step decides.
    bip["is_bunt"] = bip["des"].str.contains("bunt", case=False, na=False)

    bip["game_date"] = pd.to_datetime(bip["game_date"])
    bip["outcome"] = pd.Categorical(bip["outcome"], categories=CLASSES)
    bip = bip.drop(columns=["des"]).sort_values(["game_date", "game_pk", "at_bat_number"])

    report(log, unmapped, bip)
    return bip.reset_index(drop=True)


def report(log, unmapped, bip: pd.DataFrame) -> None:
    print("\nfiltering")
    prev = None
    for label, n in log:
        drop = f"  (-{prev - n:,})" if prev is not None and prev != n else ""
        print(f"  {label:<40} {n:>9,}{drop}")
        prev = n
    if len(unmapped):
        print("  dropped events with no outcome class:")
        for event, n in unmapped.items():
            print(f"    {event!s:<36} {n:>7,}")

    print("\nper season")
    print(bip.groupby("season", observed=True).size().to_string())

    print("\noutcome balance")
    share = bip["outcome"].value_counts(normalize=True).reindex(CLASSES)
    counts = bip["outcome"].value_counts().reindex(CLASSES)
    for c in CLASSES:
        print(f"  {c:<4} {counts[c]:>8,}  {share[c]:6.2%}")

    missing_spray = bip["spray_angle"].isna().sum()
    print(f"\nno hit coordinates (spray NaN): {missing_spray:,}")
    print(f"bunts flagged:                  {bip['is_bunt'].sum():,}")


def main() -> int:
    seasons = [int(a) for a in sys.argv[1:]] or sorted(
        int(p.name) for p in RAW.iterdir() if p.is_dir() and p.name.isdigit()
    )
    bip = prepare(seasons)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    bip.to_parquet(OUT, index=False)
    print(f"\nwrote {len(bip):,} balls in play -> {OUT.relative_to(ML.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
