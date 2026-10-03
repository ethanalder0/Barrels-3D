"""Baseball Savant leaderboards -- the season Statcast numbers statsapi has not got.

The GUMBO feed carries a game's tracked contact but no season Statcast totals,
and `stats=sabermetrics` stops at WAR/FIP/wOBA. Everything the player card's
ability ratings are built on -- xBA, xSLG, xwOBA, xERA, sprint speed, OAA,
whiff%, edge% -- comes from Baseball Savant's CSV leaderboards instead.

Savant keys every row on `player_id`, which IS the MLBAM person id statsapi
uses, so the join back to a box score or an at-bat is a straight dict lookup.

Every endpoint, column name and threshold below was established by probing the
live 2026 leaderboards, not assumed. Things worth knowing:

  * `min` means different units per leaderboard. On the custom batter board it
    is plate appearances; on the custom pitcher board it is INNINGS -- min=150
    returns 11 pitchers and min=100 returns 105, which is innings, not batters
    faced.
  * `min=q` is the official qualifier and is far too strict for a player card:
    137 hitters and 54 pitchers league-wide. Most of the nine names in a box
    score would have no ratings at all. We pull a wider pool (see below) so
    regulars, platoon bats and set-up men are all rated.
  * The fielding board covers 1B-3B, SS and the three outfield spots ONLY.
    Catchers and pitchers are absent by design -- Savant grades a catcher with
    three separate models instead, which `_load_catching` fetches and sums into
    the catcher Fielding Run Value that ratings.py grades them on. A pitcher
    still has no fielding number, and the ability is dropped rather than
    invented.
  * `min` on the FIELDING board is ATTEMPTS. It was briefly set to 1, which
    swept in anyone who had ever stood on the grass: Yordan Alvarez, a DH,
    picked up a -2 OAA from a handful of left-field innings and was graded 25th
    percentile against 88 full-time left fielders. OAA is a counting stat, so a
    thin sample sits near zero and lands mid-pack rather than nowhere.
  * Responses are UTF-8 with a BOM, and numeric columns arrive quoted and
    baseball-formatted (".227"). Both are handled in `_rows` / `_num`.

Cached per season with the same stale-serving contract as the scoreboard: these
move once a day, and a Savant blip must not empty a player card.
"""

from __future__ import annotations

import csv
import io
import sys
import threading
import time

import mlb_api

BASE = "https://baseballsavant.mlb.com/leaderboard"
TIMEOUT = 40   # these are whole-league CSVs, not single records

SEASON_TTL = 6 * 3600.0         # a season leaderboard moves once a day
SEASON_STALE_MAX = 48 * 3600.0  # ...and we will serve a stale one this long

# Pool thresholds. Wide enough that everyone in a lineup or bullpen is rated,
# tight enough that a 12-plate-appearance September call-up does not sit at the
# 99th percentile on a fluke. See the module note above for the units.
BATTER_MIN_PA = 100
PITCHER_MIN_IP = 25
SPRINT_MIN_RUNS = 10
# Fielding chances, not innings. 50 keeps every position pool above 40 while
# dropping the part-timers whose OAA is mostly noise -- see the module note.
FIELDING_MIN = 50
# Pitches caught. The same small-sample logic: a third catcher with 80 pitches
# behind the plate has a run value indistinguishable from zero.
CATCHER_MIN_PITCHES = 500
ARSENAL_MIN_PITCHES = 100

# Savant's custom leaderboard is selection-driven: ask for the columns you want.
BATTER_SELECTIONS = (
    "pa,xba,xslg,xwoba,batting_avg,slg_percent,on_base_percent,woba,"
    "exit_velocity_avg,launch_angle_avg,barrel_batted_rate,hard_hit_percent,"
    "k_percent,bb_percent,sweet_spot_percent"
)
PITCHER_SELECTIONS = (
    "p_formatted_ip,p_era,xera,xba,xwoba,k_percent,bb_percent,whiff_percent,"
    "swing_percent,in_zone_percent,edge_percent,fastball_avg_speed,"
    "barrel_batted_rate,hard_hit_percent"
)

# pitch-arsenals reports velocity wide, one column per pitch type. The codes are
# Savant's own; anything not listed here simply has no velocity to join.
PITCH_NAMES = {
    "FF": "4-Seam", "SI": "Sinker", "FC": "Cutter", "SL": "Slider",
    "ST": "Sweeper", "SV": "Slurve", "CU": "Curveball", "KC": "Knuckle Curve",
    "CH": "Changeup", "FS": "Splitter", "KN": "Knuckleball", "FO": "Forkball",
}

_cache: dict[int, tuple[float, "SeasonStatcast"]] = {}
_lock = threading.Lock()


# --- fetching ---------------------------------------------------------------

def _rows(path: str, params: dict) -> list[dict]:
    """One leaderboard as a list of dicts.

    Savant serves UTF-8 with a BOM. Left in place it becomes part of the first
    column's name, so `row["last_name, first_name"]` would miss on every row.
    """
    # mlb_api.session() is a plain retrying requests.Session, one per thread --
    # nothing in it is statsapi-specific, so Savant reuses it rather than
    # duplicating the retry and thread-local plumbing.
    resp = mlb_api.session().get(f"{BASE}/{path}", params={**params, "csv": "true"},
                                 timeout=TIMEOUT)
    resp.raise_for_status()
    text = resp.text.lstrip("﻿")
    return list(csv.DictReader(io.StringIO(text)))


def _num(row: dict, key: str):
    """A Savant cell as a float. Handles '.227', '96.5', '' and a missing key."""
    raw = (row.get(key) or "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _pid(row: dict, key: str = "player_id") -> str | None:
    raw = (row.get(key) or "").strip()
    return raw or None


# --- the season's numbers ---------------------------------------------------

class SeasonStatcast:
    """Every Savant metric we use, keyed by MLBAM person id (as a string).

    Purely a data holder -- the percentile maths lives in ratings.py so the
    fetching and the grading can be reasoned about (and tested) separately.
    """

    def __init__(self, season: int):
        self.season = season
        self.batting: dict[str, dict] = {}
        self.pitching: dict[str, dict] = {}
        self.fielding: dict[str, dict] = {}
        self.catching: dict[str, dict] = {}
        self.running: dict[str, dict] = {}
        self.arsenal: dict[str, list[dict]] = {}
        # Which pulls actually succeeded. The card reports honestly on what is
        # missing instead of showing a blank ability with no explanation.
        self.sources: dict[str, bool] = {}

    def __repr__(self) -> str:  # debugging convenience
        return (f"<SeasonStatcast {self.season} bat={len(self.batting)} "
                f"pit={len(self.pitching)} fld={len(self.fielding)} "
                f"c={len(self.catching)} run={len(self.running)} "
                f"ars={len(self.arsenal)}>")


def _load_batting(sc: SeasonStatcast) -> None:
    rows = _rows("custom", {
        "year": sc.season, "type": "batter", "filter": "", "min": BATTER_MIN_PA,
        "selections": BATTER_SELECTIONS, "chart": "false",
        "x": "xba", "y": "xba", "r": "no", "chartType": "beeswarm",
    })
    for row in rows:
        pid = _pid(row)
        if not pid:
            continue
        avg, slg = _num(row, "batting_avg"), _num(row, "slg_percent")
        sc.batting[pid] = {
            "pa": _num(row, "pa"),
            "xba": _num(row, "xba"),
            "xslg": _num(row, "xslg"),
            "xwoba": _num(row, "xwoba"),
            "avg": avg,
            "slg": slg,
            "obp": _num(row, "on_base_percent"),
            "woba": _num(row, "woba"),
            # ISO is not a Savant column; it is SLG minus AVG by definition, so
            # this is derived from two real numbers rather than estimated.
            "iso": None if avg is None or slg is None else round(slg - avg, 3),
            "exitVelo": _num(row, "exit_velocity_avg"),
            "launchAngle": _num(row, "launch_angle_avg"),
            "barrelPct": _num(row, "barrel_batted_rate"),
            "hardHitPct": _num(row, "hard_hit_percent"),
            "kPct": _num(row, "k_percent"),
            "bbPct": _num(row, "bb_percent"),
            "sweetSpotPct": _num(row, "sweet_spot_percent"),
        }


def _load_pitching(sc: SeasonStatcast) -> None:
    rows = _rows("custom", {
        "year": sc.season, "type": "pitcher", "filter": "", "min": PITCHER_MIN_IP,
        "selections": PITCHER_SELECTIONS, "chart": "false",
        "x": "xera", "y": "xera", "r": "no", "chartType": "beeswarm",
    })
    for row in rows:
        pid = _pid(row)
        if not pid:
            continue
        sc.pitching[pid] = {
            "ip": _num(row, "p_formatted_ip"),
            "era": _num(row, "p_era"),
            "xera": _num(row, "xera"),
            "xba": _num(row, "xba"),
            "xwoba": _num(row, "xwoba"),
            "kPct": _num(row, "k_percent"),
            "bbPct": _num(row, "bb_percent"),
            "whiffPct": _num(row, "whiff_percent"),
            "swingPct": _num(row, "swing_percent"),
            "zonePct": _num(row, "in_zone_percent"),
            "edgePct": _num(row, "edge_percent"),
            "fastballVelo": _num(row, "fastball_avg_speed"),
            "barrelPct": _num(row, "barrel_batted_rate"),
            "hardHitPct": _num(row, "hard_hit_percent"),
        }


def _load_running(sc: SeasonStatcast) -> None:
    rows = _rows("sprint_speed", {
        "year": sc.season, "position": "", "team": "", "min": SPRINT_MIN_RUNS,
    })
    for row in rows:
        pid = _pid(row)
        if not pid:
            continue
        sc.running[pid] = {
            "sprintSpeed": _num(row, "sprint_speed"),
            "hpTo1b": _num(row, "hp_to_1b"),
            "bolts": _num(row, "bolts"),
            "competitiveRuns": _num(row, "competitive_runs"),
        }


def _load_fielding(sc: SeasonStatcast) -> None:
    rows = _rows("outs_above_average", {
        "type": "Fielder", "year": sc.season, "team": "", "pos": "",
        "min": FIELDING_MIN,
    })
    for row in rows:
        pid = _pid(row)
        if not pid:
            continue
        sc.fielding[pid] = {
            "oaa": _num(row, "outs_above_average"),
            "runsPrevented": _num(row, "fielding_runs_prevented"),
            # Kept because OAA is graded WITHIN a position -- a shortstop and a
            # first baseman do not get comparable chances. See ratings.py.
            "pos": (row.get("primary_pos_formatted") or "").strip() or None,
        }


def _load_catching(sc: SeasonStatcast) -> None:
    """Catcher Fielding Run Value: framing + blocking + throwing.

    Catchers are not on the OAA board, because catching is not a range skill --
    Savant grades it with three separate models and adds them up. This does the
    same, from the three published run values, so what lands on the card is a
    sum of real numbers rather than a stand-in for the OAA they do not have.

    Three quirks, all from probing the live boards:
      * The framing board names its id and pitch columns `id` and `pitches`;
        the other two use `player_id`. It is also the only one that reports
        workload, so it is what the sample gate reads.
      * Blocking and throwing are absent for a catcher nobody ran on or who
        never had a ball in the dirt. That is a genuine zero runs, not missing
        data, so they default to 0 -- but a missing FRAMING row means we have
        no idea how much he caught, and he is skipped.
      * The pools differ slightly (60 / 70 / 68), which is why this is a union
        keyed off framing rather than an inner join.
    """
    blocking: dict[str, float] = {}
    for row in _rows("catcher-blocking", {"year": sc.season, "team": "", "min": "1"}):
        pid, runs = _pid(row), _num(row, "catcher_blocking_runs")
        if pid and runs is not None:
            blocking[pid] = runs

    throwing: dict[str, float] = {}
    for row in _rows("catcher-throwing", {"year": sc.season, "team": "", "min": "1"}):
        pid, runs = _pid(row), _num(row, "catcher_stealing_runs")
        if pid and runs is not None:
            throwing[pid] = runs

    for row in _rows("catcher-framing", {"year": sc.season, "team": "", "min": "1"}):
        pid = _pid(row, "id")
        framing = _num(row, "rv_tot")
        pitches = _num(row, "pitches")
        if not pid or framing is None:
            continue
        if pitches is None or pitches < CATCHER_MIN_PITCHES:
            continue
        block = blocking.get(pid, 0.0)
        throw = throwing.get(pid, 0.0)
        sc.catching[pid] = {
            "framingRuns": round(framing, 1),
            "blockingRuns": round(block, 1),
            "throwingRuns": round(throw, 1),
            "runValue": round(framing + block + throw, 1),
            "pitches": pitches,
            "pos": "C",
        }


def _load_arsenal(sc: SeasonStatcast) -> None:
    """Per-pitch usage and results, with average velocity joined on.

    Two boards, because neither is complete on its own: pitch-arsenal-stats has
    usage/whiff/results per pitch but no velocity, and pitch-arsenals has
    velocity per pitch type but nothing else.
    """
    speeds: dict[str, dict[str, float]] = {}
    for row in _rows("pitch-arsenals", {
        "year": sc.season, "min": ARSENAL_MIN_PITCHES, "type": "avg_speed", "hand": "",
    }):
        # This board names the id column `pitcher`, not `player_id`.
        pid = _pid(row, "pitcher") or _pid(row)
        if not pid:
            continue
        per_pitch = {}
        for code in PITCH_NAMES:
            value = _num(row, f"{code.lower()}_avg_speed")
            if value is not None:
                per_pitch[code] = value
        speeds[pid] = per_pitch

    for row in _rows("pitch-arsenal-stats", {
        "type": "pitcher", "pitchType": "", "year": sc.season, "team": "", "min": "10",
    }):
        pid = _pid(row)
        code = (row.get("pitch_type") or "").strip().upper()
        if not pid or not code:
            continue
        sc.arsenal.setdefault(pid, []).append({
            "code": code,
            "name": (row.get("pitch_name") or PITCH_NAMES.get(code) or code).strip(),
            "usagePct": _num(row, "pitch_usage"),
            "pitches": _num(row, "pitches"),
            "velo": speeds.get(pid, {}).get(code),
            "whiffPct": _num(row, "whiff_percent"),
            "kPct": _num(row, "k_percent"),
            "putAwayPct": _num(row, "put_away"),
            "ba": _num(row, "ba"),
            "slg": _num(row, "slg"),
            "xba": _num(row, "est_ba"),
            "xwoba": _num(row, "est_woba"),
            "hardHitPct": _num(row, "hard_hit_percent"),
            "runValuePer100": _num(row, "run_value_per_100"),
        })

    # Most-thrown pitch first: that is the order a scouting report reads in.
    for pitches in sc.arsenal.values():
        pitches.sort(key=lambda p: p["usagePct"] or 0, reverse=True)


_LOADERS = (
    ("batting", _load_batting),
    ("pitching", _load_pitching),
    ("running", _load_running),
    ("fielding", _load_fielding),
    ("catching", _load_catching),
    ("arsenal", _load_arsenal),
)


def _build(season_year: int) -> SeasonStatcast:
    """Fetch every board. One failing board costs its own ratings, not the card.

    A player card that loses its Speed bar because the sprint-speed board timed
    out is still a useful card; one that 502s because of the same timeout is
    not. `sources` records what landed so the UI can say which ability is
    missing and why.
    """
    sc = SeasonStatcast(season_year)
    for name, load in _LOADERS:
        try:
            load(sc)
            sc.sources[name] = True
        except Exception as exc:
            sc.sources[name] = False
            sys.stderr.write(f"[statcast] {season_year} {name} board failed: "
                             f"{type(exc).__name__}: {exc}\n")
    return sc


def season(season_year: int) -> tuple[SeasonStatcast, float]:
    """Cached season, and the age in seconds of what is being returned.

    Held under a lock so that ten cards opened at once do not each start their
    own five-CSV download of the same season.
    """
    with _lock:
        hit = _cache.get(season_year)
        now = time.monotonic()
        if hit and now - hit[0] < SEASON_TTL:
            return hit[1], 0.0

        try:
            built = _build(season_year)
        except Exception as exc:
            if hit and now - hit[0] < SEASON_STALE_MAX:
                age = now - hit[0]
                sys.stderr.write(f"[statcast] {season_year} refresh failed "
                                 f"({type(exc).__name__}); serving cache "
                                 f"{age:.0f}s old\n")
                return hit[1], age
            raise

        # Every board failing means Savant is down, not that the league went
        # hitless. Keep the previous season's data rather than caching an empty
        # object for six hours.
        if hit and not any(built.sources.values()):
            age = now - hit[0]
            if age < SEASON_STALE_MAX:
                sys.stderr.write(f"[statcast] {season_year} all boards failed; "
                                 f"serving cache {age:.0f}s old\n")
                return hit[1], age

        _cache[season_year] = (now, built)
        return built, 0.0
