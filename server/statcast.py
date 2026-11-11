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
  * `min` on the FIELDING board is ATTEMPTS. Set to 1 it sweeps in anyone who
    ever stood on the grass: Yordan Alvarez, a DH, picked up a -2 OAA from a
    handful of left-field innings and was once graded 25th percentile against
    88 full-time left fielders. Ratings v2 fetches everyone anyway -- it needs
    small samples in order to shrink them -- and guards that case in ratings.py
    instead: fielding is rated on a RATE, shrunk toward the position average,
    and not shown at all under FIELDING_SHOW_OUTS.
  * Every board is fetched down to a single PA / inning / throw. The `*_MIN_*`
    constants below are the REFERENCE POOL a percentile is measured against,
    not a gate on who can be rated.
  * Responses are UTF-8 with a BOM, and numeric columns arrive quoted and
    baseball-formatted (".227", "-3%"). Both are handled in `_rows` / `_num`.

Cached per season with the same stale-serving contract as the scoreboard: these
move once a day, and a Savant blip must not empty a player card.
"""

from __future__ import annotations

import csv
import io
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import mlb_api

BASE = "https://baseballsavant.mlb.com/leaderboard"
TIMEOUT = 40   # these are whole-league CSVs, not single records

SEASON_TTL = 6 * 3600.0         # a season leaderboard moves once a day
SEASON_STALE_MAX = 48 * 3600.0  # ...and we will serve a stale one this long
# A finished season does not move. Prior seasons are the ratings' prior and the
# year-to-year pair that measures how fast each stat settles; a week is plenty.
HISTORY_TTL = 7 * 24 * 3600.0

# Boards are fetched in parallel, but politely: Savant is one host serving
# whole-league CSVs, and two dozen simultaneous requests is how a client gets
# throttled.
FETCH_WORKERS = 6

# REFERENCE-POOL thresholds. These define who a percentile is measured
# against, not who can be rated: since ratings v2 every board is fetched down
# to a single PA / inning / throw, a small sample is shrunk toward its prior
# (ratings.py), and the pool below is what "72nd percentile" is relative to.
# Wide enough that everyone in a lineup or bullpen is in it, tight enough that a
# 12-plate-appearance call-up does not shape the scale.
BATTER_MIN_PA = 100
PITCHER_MIN_IP = 25
SPRINT_MIN_RUNS = 10
# Defensive outs played (innings x 3), from the fielding-run-value board. 300
# is a hundred innings: enough to have seen the ball at a position.
FIELDING_MIN_OUTS = 300
ARM_MIN_THROWS = 50
JUMP_MIN_PLAYS = 20
BASERUNNING_MIN_OPPS = 20
BAT_TRACKING_MIN_SWINGS = 100
# Pitches caught. The same small-sample logic: a third catcher with 80 pitches
# behind the plate has a run value indistinguishable from zero.
CATCHER_MIN_PITCHES = 500
ARSENAL_MIN_PITCHES = 100

# Savant's custom leaderboard is selection-driven: ask for the columns you want.
# The sample counts (pa, batted_ball, pitch_count) are what ratings.py shrinks
# each rate by. Every column below was confirmed to FILL IN on the live 2026
# board: an unknown selection still comes back as a column, just an empty one
# (`bip`, `swing_count` and `release_extension` all do), so a header check is
# not enough.
BATTER_SELECTIONS = (
    "pa,batted_ball,pitch_count,swing_percent,xba,xslg,xwoba,xwobacon,batting_avg,"
    "slg_percent,on_base_percent,woba,exit_velocity_avg,avg_best_speed,"
    "launch_angle_avg,barrel_batted_rate,hard_hit_percent,k_percent,bb_percent,"
    "sweet_spot_percent,oz_swing_percent,z_swing_percent,iz_contact_percent,"
    "whiff_percent,meatball_swing_percent,pull_percent,flyballs_percent,"
    "groundballs_percent"
)
PITCHER_SELECTIONS = (
    "p_formatted_ip,pitch_count,batted_ball,p_era,xera,xba,xwoba,xwobacon,k_percent,"
    "bb_percent,whiff_percent,swing_percent,in_zone_percent,edge_percent,"
    "oz_swing_percent,iz_contact_percent,fastball_avg_speed,arm_angle,"
    "barrel_batted_rate,hard_hit_percent,groundballs_percent,p_game,p_starting_p"
)

# The pitch-movement board is one request per pitch type. These are the types
# with enough pitchers to rank; a knuckleball has no league to compare against.
MOVEMENT_TYPES = ("FF", "SI", "FC", "SL", "ST", "SV", "CU", "KC", "CH", "FS")
MOVEMENT_MIN_PITCHES = 50

# pitch-arsenals reports velocity wide, one column per pitch type. The codes are
# Savant's own; anything not listed here simply has no velocity to join.
PITCH_NAMES = {
    "FF": "4-Seam", "SI": "Sinker", "FC": "Cutter", "SL": "Slider",
    "ST": "Sweeper", "SV": "Slurve", "CU": "Curveball", "KC": "Knuckle Curve",
    "CH": "Changeup", "FS": "Splitter", "KN": "Knuckleball", "FO": "Forkball",
}

_cache: dict[int, tuple[float, "SeasonStatcast"]] = {}
_lock = threading.Lock()
_history: dict[int, tuple[float, "SeasonStatcast"]] = {}
_history_lock = threading.Lock()


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
    # A few boards format rates for display ("-3%"); the number is the same.
    raw = (row.get(key) or "").strip().rstrip("%")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _name(row: dict) -> str | None:
    """Savant's "Witt Jr., Bobby" as "Bobby Witt Jr."."""
    raw = (row.get("last_name, first_name") or "").strip()
    if not raw:
        return None
    last, _, first = raw.partition(", ")
    return f"{first} {last}".strip() if first else last


def _swings(row: dict):
    pitches, rate = _num(row, "pitch_count"), _num(row, "swing_percent")
    return None if pitches is None or rate is None else round(pitches * rate / 100.0)


def _season_range(season: int) -> dict:
    """The catcher blocking and throwing boards take a season RANGE, in snake case.

    Given `year` they ignore it and return the current season -- which went
    unnoticed while only the current season was ever asked for.
    """
    return {"season_start": season, "season_end": season, "team": "", "min": "1"}


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
        # Ratings v2 boards. Each keyed by MLBAM id like the rest.
        self.batTracking: dict[str, dict] = {}
        self.arm: dict[str, dict] = {}
        self.baserunning: dict[str, dict] = {}
        self.jump: dict[str, dict] = {}
        self.poptime: dict[str, dict] = {}
        self.frv: dict[str, dict] = {}
        # pid -> pitch code -> {usage, pitches, diffX, diffZ}
        self.movement: dict[str, dict[str, dict]] = {}
        # Which pulls actually succeeded. The card reports honestly on what is
        # missing instead of showing a blank ability with no explanation.
        self.sources: dict[str, bool] = {}

    def __repr__(self) -> str:  # debugging convenience
        return (f"<SeasonStatcast {self.season} bat={len(self.batting)} "
                f"pit={len(self.pitching)} fld={len(self.fielding)} "
                f"c={len(self.catching)} run={len(self.running)} "
                f"ars={len(self.arsenal)} bt={len(self.batTracking)} "
                f"arm={len(self.arm)} br={len(self.baserunning)} "
                f"jump={len(self.jump)} pop={len(self.poptime)} "
                f"frv={len(self.frv)} mov={len(self.movement)}>")


def _load_batting(sc: SeasonStatcast) -> None:
    # min=1: everyone with a plate appearance. Who is in the PERCENTILE pool is
    # decided in ratings.py by BATTER_MIN_PA; a call-up is still rated, shrunk.
    rows = _rows("custom", {
        "year": sc.season, "type": "batter", "filter": "", "min": 1,
        "selections": BATTER_SELECTIONS, "chart": "false",
        "x": "xba", "y": "xba", "r": "no", "chartType": "beeswarm",
    })
    for row in rows:
        pid = _pid(row)
        if not pid:
            continue
        avg, slg = _num(row, "batting_avg"), _num(row, "slg_percent")
        sc.batting[pid] = {
            "name": _name(row),
            "pa": _num(row, "pa"),
            "bip": _num(row, "batted_ball"),
            "pitches": _num(row, "pitch_count"),
            # The board has no swing count that fills in; pitches seen times
            # swing rate is the same number.
            "swings": _swings(row),
            "xba": _num(row, "xba"),
            "xslg": _num(row, "xslg"),
            "xwoba": _num(row, "xwoba"),
            "xwobacon": _num(row, "xwobacon"),
            "avg": avg,
            "slg": slg,
            "obp": _num(row, "on_base_percent"),
            "woba": _num(row, "woba"),
            # ISO is not a Savant column; it is SLG minus AVG by definition, so
            # this is derived from two real numbers rather than estimated.
            "iso": None if avg is None or slg is None else round(slg - avg, 3),
            "exitVelo": _num(row, "exit_velocity_avg"),
            # Savant's "best speed": the average of his hardest-hit half.
            "bestSpeed": _num(row, "avg_best_speed"),
            "launchAngle": _num(row, "launch_angle_avg"),
            "barrelPct": _num(row, "barrel_batted_rate"),
            "hardHitPct": _num(row, "hard_hit_percent"),
            "kPct": _num(row, "k_percent"),
            "bbPct": _num(row, "bb_percent"),
            "sweetSpotPct": _num(row, "sweet_spot_percent"),
            "chasePct": _num(row, "oz_swing_percent"),
            "zoneSwingPct": _num(row, "z_swing_percent"),
            "zoneContactPct": _num(row, "iz_contact_percent"),
            "whiffPct": _num(row, "whiff_percent"),
            "meatballSwingPct": _num(row, "meatball_swing_percent"),
            "pullPct": _num(row, "pull_percent"),
            "flyBallPct": _num(row, "flyballs_percent"),
            "groundBallPct": _num(row, "groundballs_percent"),
        }


def _load_pitching(sc: SeasonStatcast) -> None:
    rows = _rows("custom", {
        "year": sc.season, "type": "pitcher", "filter": "", "min": 1,
        "selections": PITCHER_SELECTIONS, "chart": "false",
        "x": "xera", "y": "xera", "r": "no", "chartType": "beeswarm",
    })
    for row in rows:
        pid = _pid(row)
        if not pid:
            continue
        sc.pitching[pid] = {
            "name": _name(row),
            "ip": _num(row, "p_formatted_ip"),
            "pitches": _num(row, "pitch_count"),
            "bip": _num(row, "batted_ball"),
            "games": _num(row, "p_game"),
            # `p_gs` is accepted and left empty; `p_starting_p` is the one that fills.
            "starts": _num(row, "p_starting_p"),
            "era": _num(row, "p_era"),
            "xera": _num(row, "xera"),
            "xba": _num(row, "xba"),
            "xwoba": _num(row, "xwoba"),
            "xwobacon": _num(row, "xwobacon"),
            "kPct": _num(row, "k_percent"),
            "bbPct": _num(row, "bb_percent"),
            "whiffPct": _num(row, "whiff_percent"),
            "swingPct": _num(row, "swing_percent"),
            "zonePct": _num(row, "in_zone_percent"),
            "edgePct": _num(row, "edge_percent"),
            "chasePct": _num(row, "oz_swing_percent"),
            "zoneContactPct": _num(row, "iz_contact_percent"),
            "fastballVelo": _num(row, "fastball_avg_speed"),
            "armAngle": _num(row, "arm_angle"),
            "barrelPct": _num(row, "barrel_batted_rate"),
            "hardHitPct": _num(row, "hard_hit_percent"),
            "groundBallPct": _num(row, "groundballs_percent"),
        }


def _load_running(sc: SeasonStatcast) -> None:
    rows = _rows("sprint_speed", {
        "year": sc.season, "position": "", "team": "", "min": 1,
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
        "type": "Fielder", "year": sc.season, "team": "", "pos": "", "min": 1,
    })
    for row in rows:
        pid = _pid(row)
        if not pid:
            continue
        sc.fielding[pid] = {
            "oaa": _num(row, "outs_above_average"),
            "runsPrevented": _num(row, "fielding_runs_prevented"),
            # Success rate added, in whole percentage points as Savant rounds
            # it. Shown on the card; too coarse to rate on, so Range uses range
            # run value per defensive out from the fielding-run-value board.
            "successRateAdded": _num(row, "diff_success_rate_formatted"),
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
    for row in _rows("catcher-blocking", _season_range(sc.season)):
        pid, runs = _pid(row), _num(row, "catcher_blocking_runs")
        if pid and runs is not None:
            blocking[pid] = runs

    throwing: dict[str, float] = {}
    for row in _rows("catcher-throwing", _season_range(sc.season)):
        pid, runs = _pid(row), _num(row, "catcher_stealing_runs")
        if pid and runs is not None:
            throwing[pid] = runs

    for row in _rows("catcher-framing", {
        "seasonStart": sc.season, "seasonEnd": sc.season, "type": "catcher", "team": "", "min": "1",
    }):
        pid = _pid(row, "id")
        framing = _num(row, "rv_tot")
        pitches = _num(row, "pitches")
        if not pid or framing is None or not pitches:
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


def _load_bat_tracking(sc: SeasonStatcast) -> None:
    """Bat speed and squared-up rate. Tracked since 2023; earlier years are empty.

    The board names its id column `id`. minSwings=1 for the same reason as the
    custom board: the percentile pool is cut in ratings.py, not here.
    """
    for row in _rows("bat-tracking", {
        "type": "batter", "seasonStart": sc.season, "seasonEnd": sc.season, "minSwings": 1,
    }):
        pid = _pid(row, "id")
        if not pid:
            continue
        sc.batTracking[pid] = {
            "swings": _num(row, "swings_competitive"),
            "contacts": _num(row, "contact"),
            "batSpeed": _num(row, "avg_bat_speed"),
            "squaredUpPerContact": _num(row, "squared_up_per_bat_contact"),
            "swingLength": _num(row, "swing_length"),
        }


def _load_arm(sc: SeasonStatcast) -> None:
    for row in _rows("arm-strength", {
        "type": "player", "year": sc.season, "minThrows": 1, "pos": "", "team": "",
    }):
        pid = _pid(row)
        if not pid:
            continue
        sc.arm[pid] = {
            "throws": _num(row, "total_throws"),
            "armStrength": _num(row, "arm_overall"),
            "maxArmStrength": _num(row, "max_arm_strength"),
            "pos": (row.get("primary_position_name") or "").strip() or None,
        }


def _load_baserunning(sc: SeasonStatcast) -> None:
    """Baserunning run value: extra bases taken, plus steals and caught stealing."""
    for row in _rows("baserunning-run-value", {
        "game_type": "Regular", "season_start": sc.season, "season_end": sc.season,
        "sortColumn": "runner_runs_tot", "split": "no", "n": 0, "team": "",
        "type": "Run", "with_team_only": 1,
    }):
        pid = _pid(row)
        if not pid:
            continue
        # Opportunities: every time he was on base when a ball moved runners,
        # plus every time he could have stolen. The run value is shared out
        # over these so Baserunning is a rate.
        moved = _num(row, "N_runner_moved") or 0.0
        steals = _num(row, "N_runner_moved_SBX") or 0.0
        sc.baserunning[pid] = {
            "runs": _num(row, "runner_runs_tot"),
            "extraBaseRuns": _num(row, "runner_runs_XB"),
            "stealRuns": _num(row, "runner_runs_SBX"),
            "opportunities": moved + steals or None,
        }


def _load_jump(sc: SeasonStatcast) -> None:
    """Outfield jump: feet covered vs league average in the first three seconds."""
    for row in _rows("outfield_jump", {"year": sc.season, "min": 1}):
        pid = _pid(row, "resp_fielder_id")
        if not pid:
            continue
        sc.jump[pid] = {
            "plays": _num(row, "n"),
            # Savant's "bootup" distance is the whole jump: reaction, burst and
            # route together, relative to league average.
            "jumpFeet": _num(row, "rel_league_bootup_distance"),
            "reaction": _num(row, "rel_league_reaction_distance"),
            "burst": _num(row, "rel_league_burst_distance"),
            "route": _num(row, "rel_league_routing_distance"),
        }


def _load_poptime(sc: SeasonStatcast) -> None:
    for row in _rows("poptime", {"year": sc.season, "team": "", "min2b": 1, "min3b": 0}):
        pid = _pid(row, "entity_id")
        if not pid:
            continue
        sc.poptime[pid] = {
            "attempts": _num(row, "pop_2b_sba_count"),
            "popTime": _num(row, "pop_2b_sba"),
            "armStrength": _num(row, "maxeff_arm_2b_3b_sba"),
        }


_POSITION_NUMBERS = {2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF"}


def _load_frv(sc: SeasonStatcast) -> None:
    """Fielding run value, by component. Arm runs and defensive outs live here."""
    for row in _rows("fielding-run-value", {
        "gameType": "Regular", "seasonStart": sc.season, "seasonEnd": sc.season,
        "type": "fielder", "position": "", "minInnings": 0, "minResults": 1,
    }):
        pid = _pid(row, "id")
        if not pid:
            continue
        sc.frv[pid] = {
            "outs": _num(row, "outs_total"),
            "totalRuns": _num(row, "total_runs"),
            "rangeRuns": _num(row, "range_runs"),
            "armRuns": _num(row, "arm_runs"),
            "framingRuns": _num(row, "framing_runs"),
            "blockingRuns": _num(row, "blocking_runs"),
            "throwingRuns": _num(row, "throwing_runs"),
            # Defensive outs at each position (Savant numbers them 2 C .. 9 RF),
            # which is what a positional adjustment is prorated by.
            "outsByPos": {pos: _num(row, f"outs_{n}") or 0 for n, pos in _POSITION_NUMBERS.items()},
        }


def _load_movement(sc: SeasonStatcast) -> None:
    """Each pitch's break against the league average for its type.

    Speed, horizontal break (unsigned) and induced vertical break per pitch
    type are the season averages the Stuff model runs on (stuff_model.py).
    `diff_x` / `diff_z` are Savant's own comparison against the average pitch
    of that type and are signed differently: diff_x is inches MORE horizontal
    break, diff_z inches LESS drop (more ride). They are kept for the card, not
    rated: "breaks more than its type" turned out to say almost nothing about
    how good a pitch is (see ml/stuff_train.py).
    """
    for code in MOVEMENT_TYPES:
        for row in _rows("pitch-movement", {
            "year": sc.season, "team": "", "min": MOVEMENT_MIN_PITCHES, "pitch_type": code,
            "hand": "", "x": "pitcher_break_x", "z": "pitcher_break_z",
        }):
            pid = _pid(row, "pitcher_id")
            if not pid:
                continue
            sc.movement.setdefault(pid, {})[code] = {
                "pitches": _num(row, "pitches_thrown"),
                "usage": _num(row, "pitch_per"),
                "velo": _num(row, "avg_speed"),
                # A MAGNITUDE: this board drops the sign. stuff_model.py puts
                # the arm/glove side back by pitch type.
                "breakX": _num(row, "pitcher_break_x"),
                "ivb": _num(row, "pitcher_break_z_induced"),
                "diffX": _num(row, "diff_x"),
                "diffZ": _num(row, "diff_z"),
            }


_LOADERS = (
    ("batting", _load_batting),
    ("pitching", _load_pitching),
    ("running", _load_running),
    ("fielding", _load_fielding),
    ("catching", _load_catching),
    ("arsenal", _load_arsenal),
    ("batTracking", _load_bat_tracking),
    ("arm", _load_arm),
    ("baserunning", _load_baserunning),
    ("jump", _load_jump),
    ("poptime", _load_poptime),
    ("frv", _load_frv),
    ("movement", _load_movement),
)


def _build(season_year: int) -> SeasonStatcast:
    """Fetch every board. One failing board costs its own ratings, not the card.

    A player card that loses its Speed bar because the sprint-speed board timed
    out is still a useful card; one that 502s because of the same timeout is
    not. `sources` records what landed so the UI can say which ability is
    missing and why.

    Boards load in parallel. Each loader writes only its own dict on `sc`, so
    there is nothing shared to lock; the HTTP sessions are thread-local.
    """
    sc = SeasonStatcast(season_year)

    def run(item):
        name, load = item
        try:
            load(sc)
            return name, True
        except Exception as exc:
            sys.stderr.write(f"[statcast] {season_year} {name} board failed: "
                             f"{type(exc).__name__}: {exc}\n")
            return name, False

    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
        for name, ok in pool.map(run, _LOADERS):
            sc.sources[name] = ok
    return sc


def history(season_year: int) -> SeasonStatcast | None:
    """A past season, cached for a week. None if it could not be fetched at all.

    Used for two things only: a player's prior seasons (the prior his current
    numbers are shrunk toward) and the year-to-year pair that measures how fast
    each stat settles. Neither is worth failing a card over, so this never
    raises -- ratings.py falls back to the league average without it.
    """
    with _history_lock:
        hit = _history.get(season_year)
        now = time.monotonic()
        if hit and now - hit[0] < HISTORY_TTL:
            return hit[1]
        try:
            built = _build(season_year)
        except Exception as exc:
            sys.stderr.write(f"[statcast] history {season_year} failed: "
                             f"{type(exc).__name__}: {exc}\n")
            return hit[1] if hit else None
        if not any(built.sources.values()):
            return hit[1] if hit else None
        _history[season_year] = (now, built)
        return built


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
