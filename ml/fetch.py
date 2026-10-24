"""Download a season of Statcast pitches from Baseball Savant.

    python ml/fetch.py 2023
    python ml/fetch.py 2023 --start 2023-04-01 --end 2023-04-02   # a quick test

Savant's search export caps how many rows one request returns, so pybaseball
splits the range into small date chunks. A full season is ~700k pitches and
takes a while, so this goes a month at a time and writes each month to its own
Parquet file as it finishes. Run it again after a failure and it skips the
months already on disk.

Output, under ml/data/raw/<season>/:

    pitches_<season>_<MM>.parquet   every regular-season pitch, every column

Everything is kept, not just balls in play: the pitch-level rows are what a
later pitch model would train on, and filtering is cheap. prepare.py turns these
into the balls-in-play table.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
from pybaseball import cache, statcast

DATA = Path(__file__).resolve().parent / "data" / "raw"

# A window that safely contains each regular season (including the overseas
# openers in March). Rows are then filtered to game_type "R": spring training
# and the postseason are different populations (split squads, minor leaguers,
# a handful of teams), and filtering on the label is surer than getting every
# Opening Day and makeup date right.
SEASONS = {season: (f"{season}-03-15", f"{season}-10-05") for season in (2023, 2024, 2025, 2026)}


def months(start: date, end: date):
    """(first, last) day pairs covering start..end, one per calendar month."""
    first = start
    while first <= end:
        nxt = (first.replace(day=1) + timedelta(days=32)).replace(day=1)
        yield first, min(end, nxt - timedelta(days=1))
        first = nxt


def fetch(season: int, start: str | None, end: str | None) -> None:
    lo, hi = SEASONS[season]
    start_d = date.fromisoformat(start or lo)
    end_d = date.fromisoformat(end or hi)
    test = start is not None or end is not None

    out = DATA / str(season)
    out.mkdir(parents=True, exist_ok=True)
    cache.enable()  # a crash part-way through a month does not refetch the days done

    total = 0
    for a, b in months(start_d, end_d):
        name = f"test_{a}_{b}" if test else f"pitches_{season}_{a.month:02d}"
        path = out / f"{name}.parquet"
        if path.exists():
            n = len(pd.read_parquet(path, columns=["game_pk"]))
            print(f"{a} .. {b}: already on disk ({n:,} pitches), skipping")
            total += n
            continue

        print(f"{a} .. {b}: downloading...", flush=True)
        df = statcast(start_dt=str(a), end_dt=str(b), verbose=False)
        if df is not None and "game_type" in df:
            df = df[df["game_type"] == "R"]
        if df is None or df.empty:
            print(f"{a} .. {b}: no regular-season pitches")
            continue
        # Savant sends some columns as mixed types; pin the object columns to
        # string so every month writes the same Parquet schema.
        for col in df.columns[df.dtypes == object]:
            df[col] = df[col].astype("string")
        df.to_parquet(path, index=False)
        total += len(df)
        print(f"{a} .. {b}: {len(df):,} pitches -> {path.name}", flush=True)

    print(f"\n{season}: {total:,} pitches in {out}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("season", type=int, choices=sorted(SEASONS))
    ap.add_argument("--start", help="YYYY-MM-DD, for a partial pull (test runs)")
    ap.add_argument("--end", help="YYYY-MM-DD")
    args = ap.parse_args()
    fetch(args.season, args.start, args.end)
    return 0


if __name__ == "__main__":
    sys.exit(main())
