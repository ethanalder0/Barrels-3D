"""Ability ratings for the player card, v2: true-talent percentiles and 20-80 grades.

Every attribute on the card answers one question from at most three Statcast
inputs with published weights (see HITTER_ATTRIBUTES / PITCHER_ATTRIBUTES).
Each one goes through the same five steps:

  1. ADJUST every input for sample size. The player's number is blended with a
     prior, weighted by how much data he has:

         estimate = (n0*x0 + 0.6*n1*x1 + 0.3*n2*x2 + k*mu) / (n0 + 0.6*n1 + 0.3*n2 + k)

     x0..x2 are this season and the two before, n0..n2 their samples in the
     stat's own unit (PA, balls in play, swings, pitches, throws, outs), mu the
     league average this season and k how slowly the stat settles. A star with
     30 April plate appearances leans on his last two seasons; a rookie with no
     history leans on the league. That is what makes the number "true talent"
     rather than "this season so far".

  2. RANK each adjusted input against the reference pool -- the players over
     statcast.py's *_MIN_* thresholds, their numbers adjusted the same way --
     as a percentile:  percentile(v) = 100 * (below + tied/2) / N.

  3. COMBINE the inputs with the attribute's weights, then RANK THE COMBINED
     SCORE AGAIN against everyone else's. A weighted mean of percentiles is not
     itself a percentile -- averaging pulls toward 50, so a blend of four
     80th-percentile inputs would read in the low 70s and nobody would look
     elite. Re-ranking makes every attribute a true percentile of its own.

  4. GRADE it: 50 + 10 * (standard-normal value of the percentile), rounded to
     5 and held to 20-80. Grades come only from percentiles, never from a raw
     stat, so a 60 is always about the 84th percentile whatever the stat's
     shape. Percentiles are shown 1-99: nothing measured is the best possible.

  5. BAND it. Each adjusted input carries its own uncertainty, so the player's
     whole tree -- inputs, attributes, overall -- is redrawn DRAWS times and the
     middle 80% of the results is the band. An attribute is not shown when its
     band is wider than HIDE_BAND_WIDTH points, or when less than
     MIN_RELIABILITY of the estimate is his own data -- n / (n + k), averaged
     over its inputs. The second rule is needed because blending inputs whose
     noise is independent narrows a band on its own: two coin-flip inputs
     average to something that looks more certain than either. "Not enough
     data yet" is the honest answer, and the card says that rather than
     printing a guess.

WHERE k COMES FROM. Measured from our own data, per input: the same players'
numbers in the last two complete seasons are correlated, and a correlation r at
a typical sample n says how much of the spread is skill. Then

    k = n * (1 - r) / r          tau^2 (spread of true talent) = r * var

which is the standard reliability identity. Year-to-year change (aging, a new
swing) lowers r a little and so shrinks a little harder; that is the safe
direction. Physical measurements -- sprint speed, bat speed, arm strength,
velocity -- come out with tiny k on their own, which is right. Without two prior
seasons it falls back to "half reliable at the pool's typical sample", and the
payload says so.

MISSING INPUTS ARE DROPPED, NEVER DEFAULTED. A designated hitter has no
fielding sample, so he has no fielding attributes and his overall renormalises
over what he does have. Scoring the glove 0 would call every DH the worst
fielder alive; scoring it 50 would invent an average defender.

FIELDING IS RANKED WITHIN POSITION. A shortstop and a first baseman do not get
comparable chances, so Range is ranked within position, Arm within infield or
outfield, Jump among outfielders, and catchers on framing, blocking and
throwing against other catchers. A position with too thin a pool falls back to
its infield/outfield group.

OVERALL IS THE VALUE LAYER, NOT THE AVERAGE OF THE SLICES. A hitter's is
anchored on xwOBA (what his bat is worth in runs) plus his fielding and running
groups; a pitcher's on xERA plus the skills that drive it. Velocity and
arsenal depth are deliberately left out of the pitcher's: they are ingredients
of his whiffs and weak contact, which are already in it. Stuff is in at a
modest weight, because it predicts next season's run value as well as this
season's results do.

Two honest gaps, stated here rather than papered over:

  * COMMAND has no public ground truth. Location models are proprietary; walk
    avoidance plus edge% is the best proxy the public data supports, and the
    card labels it as a proxy.
  * Savant's swing/take run value board (the cleanest swing-decision measure)
    returned no rows when probed, so Swing Decisions is built from chase rate,
    walk rate and swings at meatballs instead.
"""

from __future__ import annotations

import math
import random
import statistics
import sys
import zlib
from bisect import bisect_left, bisect_right
from statistics import NormalDist

import statcast
import stuff_model

# --- the scale --------------------------------------------------------------

# A percentile drawn from a handful of players is noise dressed up as a number.
MIN_POOL = 25
# Prior seasons' weight relative to this one (which is 1). Judgement, not fit:
# last season still describes most of a player, the one before less so.
PRIOR_WEIGHTS = (0.6, 0.3)
DRAWS = 200
# True-talent draws each pool player adds to the ladders. See Model.
POOL_DRAWS = 8
BAND = (0.10, 0.90)          # the middle 80%
# Percentile points. 50 was the first choice and is too strict for baseball:
# one season of most stats is noisy enough that a full-time regular's Overall
# band is ~49 points wide at the median (2026 data), so 50 hid half the league.
# At 75, regulars show essentially everything and what disappears is the small
# samples -- the call-up's Range, the reliever's Arsenal Depth -- which is the
# job. A player with no information at all draws the whole population, an
# 80-point band, so he is always hidden.
HIDE_BAND_WIDTH = 75
# Share of an estimate that has to be his own data (n / (n + k)) to be shown.
MIN_RELIABILITY = 0.20
# Fielding is not shown at all under this many defensive outs (50 innings): a
# DH's handful of left-field innings is not a glove to rate. See statcast.py.
FIELDING_SHOW_OUTS = 150
SHOW_PCT = (1, 99)

# Similar players (Model.similar). How many are listed; the least a pair must
# share to be compared at all -- an absolute floor and a share of the target's
# own attributes; and the ridge added to the correlation matrix before it is
# inverted, so two near-duplicate attributes cannot dominate the distance.
SIMILAR_COUNT = 5
SIM_MIN_SHARED = 5
SIM_MIN_OVERLAP = 0.7
SIM_RIDGE = 0.05

_NORMAL = NormalDist()


def grade_of(pct):
    """Percentile -> 20-80 scouting grade, rounded to 5."""
    if pct is None:
        return None
    p = min(max(pct, 0.1), 99.9) / 100.0
    g = 50 + 10 * _NORMAL.inv_cdf(p)
    return int(max(20, min(80, 5 * round(g / 5))))


def show_pct(pct):
    return None if pct is None else int(round(min(max(pct, SHOW_PCT[0]), SHOW_PCT[1])))


def _invert(m):
    """Gauss-Jordan inverse of a small square matrix. The server has no numpy."""
    n = len(m)
    a = [row[:] + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(m)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(a[r][col]))
        a[col], a[pivot] = a[pivot], a[col]
        p = a[col][col]
        if abs(p) < 1e-12:
            raise ValueError("singular matrix")
        a[col] = [v / p for v in a[col]]
        for r in range(n):
            if r != col and a[r][col]:
                f = a[r][col]
                a[r] = [v - f * w for v, w in zip(a[r], a[col])]
    return [row[n:] for row in a]


# --- percentile machinery ---------------------------------------------------

class Ladder:
    """A sorted population of one metric, and where a value falls in it."""

    __slots__ = ("values", "lower_is_better")

    def __init__(self, values, lower_is_better: bool = False):
        self.values = sorted(v for v in values if v is not None)
        self.lower_is_better = lower_is_better

    def __len__(self) -> int:
        return len(self.values)

    def pct(self, value):
        """Percentile rank of `value`, 0-100, or None if it cannot be placed."""
        if value is None or len(self.values) < MIN_POOL:
            return None
        below = bisect_left(self.values, value)
        tied = bisect_right(self.values, value) - below
        rank = 100.0 * (below + tied / 2.0) / len(self.values)
        # For ERA-like metrics the ladder is built ascending like any other and
        # flipped here, so one code path handles both polarities.
        return 100.0 - rank if self.lower_is_better else rank


def _blend(parts: dict, weights: dict):
    """Weighted mean over whichever components are present, renormalised.

    Returns None when nothing is available. The renormalisation is what keeps a
    missing component from silently acting like a zero.
    """
    total = 0.0
    weight = 0.0
    for key, w in weights.items():
        value = parts.get(key)
        if value is None:
            continue
        total += value * w
        weight += w
    return None if weight <= 0 else total / weight


# --- positions --------------------------------------------------------------

INFIELD = {"1B", "2B", "3B", "SS"}
OUTFIELD = {"LF", "CF", "RF"}
# The arm-strength board names positions in words.
_ARM_POS = {
    "First Baseman": "1B", "Second Baseman": "2B", "Third Baseman": "3B",
    "Shortstop": "SS", "Left Fielder": "LF", "Center Fielder": "CF",
    "Right Fielder": "RF", "Catcher": "C",
}
# A catcher who also plays first is graded as a catcher once he has caught this
# much -- enough that framing, not a few innings at first, is his job.
CATCHER_ROLE_PITCHES = 300


# A regular fields ~6 defensive outs per plate appearance (2026 median 5.9,
# tenth percentile 4.1). Under 2 he is a DH who sometimes plays the field --
# Yordan Alvarez's 0.84 -- and his card is a DH's.
DH_OUTS_PER_PA = 2.0
DH_MIN_PA = 100


def position_of(sc: statcast.SeasonStatcast, pid: str):
    """His fielding position this season, or None for a DH / pitcher."""
    catching = sc.catching.get(pid)
    if catching and (catching.get("pitches") or 0) >= CATCHER_ROLE_PITCHES:
        return "C"
    pa = (sc.batting.get(pid) or {}).get("pa") or 0
    outs = (sc.frv.get(pid) or {}).get("outs") or 0
    if pa >= DH_MIN_PA and outs < DH_OUTS_PER_PA * pa:
        return None
    pos = (sc.fielding.get(pid) or {}).get("pos")
    if pos in INFIELD or pos in OUTFIELD:
        return pos
    arm_pos = _ARM_POS.get((sc.arm.get(pid) or {}).get("pos") or "")
    if arm_pos:
        return arm_pos
    if catching:
        return "C"
    return None


def role_of(pos):
    if pos == "C":
        return "C"
    if pos in OUTFIELD:
        return "OF"
    if pos in INFIELD:
        return "IF"
    return "DH"


# --- derived per-season inputs ----------------------------------------------

# STUFF replaced MOVEMENT. Movement was "break against the league's average
# pitch of the same type", and over the 2026 pool it correlated about 0.13 with
# a pitcher's run value -- after its vertical sign was fixed; before, it was
# negative. Elite arms rate average on it because what makes them elite is
# velocity, arm angle and how their pitches play off their own fastball, none of
# which it saw. Stuff is a trained model of all of that (ml/stuff_train.py,
# server/stuff_model.py): 0.45 against run value and 0.49 against whiff rate in
# a forward test on 2026, and as good a guide to NEXT season's run value as
# this season's own results.

# A pitch counts toward Arsenal Depth from this share of his mix.
MIX_MIN = 0.10


def _derived(sc: statcast.SeasonStatcast) -> dict:
    """Stuff and Arsenal Depth, which need more than one board row to compute."""
    cached = getattr(sc, "_derived", None)
    if cached is not None:
        return cached

    stuff: dict[str, tuple[float, float]] = {}
    for pid, pitches in sc.movement.items():
        arm = (sc.pitching.get(pid) or {}).get("armAngle")
        got = stuff_model.arsenal_stuff(pitches, arm)
        if got is not None:
            stuff[pid] = got

    # League run value per 100 by pitch type, pitch-weighted: the bar a pitch
    # has to clear to count as above average for its kind.
    league: dict[str, float] = {}
    sums: dict[str, list[float]] = {}
    for pitches in sc.arsenal.values():
        for p in pitches:
            rv, count = p.get("runValuePer100"), p.get("pitches") or 0
            if rv is None or not count:
                continue
            s = sums.setdefault(p["code"], [0.0, 0.0])
            s[0] += rv * count
            s[1] += count
    league = {code: s[0] / s[1] for code, s in sums.items() if s[1] > 0}

    depth: dict[str, tuple[float, float]] = {}
    for pid, pitches in sc.arsenal.items():
        used = [p for p in pitches if (p.get("usagePct") or 0) >= MIX_MIN * 100]
        share_total = sum(p["usagePct"] for p in used)
        if not used or share_total <= 0:
            continue
        mix = [p["usagePct"] / share_total for p in used]
        variety = math.exp(-sum(m * math.log(m) for m in mix))   # effective pitches
        good = sum(m for m, p in zip(mix, used)
                   if p.get("runValuePer100") is not None and p["code"] in league
                   and p["runValuePer100"] > league[p["code"]])
        depth[pid] = (variety * good, sum(p.get("pitches") or 0 for p in pitches))

    sc._derived = {"stuff": stuff, "depth": depth}
    return sc._derived


# --- inputs -----------------------------------------------------------------

def _field(board: str, value: str, sample: str):
    """(value, n) from one board row, or None if either is missing."""
    def get(sc, pid):
        row = getattr(sc, board).get(pid)
        if not row:
            return None
        v, n = row.get(value), row.get(sample)
        return None if v is None or not n else (v, n)
    return get


def _per(board: str, runs: str, sample_board: str, sample: str, scale: float):
    """A run value turned into a rate: runs per `scale` units of opportunity."""
    def get(sc, pid):
        row, base = getattr(sc, board).get(pid), getattr(sc, sample_board).get(pid)
        if not row or not base:
            return None
        v, n = row.get(runs), base.get(sample)
        return None if v is None or not n else (v / n * scale, n)
    return get


def _derived_input(name: str):
    def get(sc, pid):
        hit = _derived(sc)[name].get(pid)
        return None if not hit or not hit[1] else hit
    return get


def _bip_or_pitches(field: str):
    """A pitcher's contact stat, sampled on balls in play where the board has them."""
    def get(sc, pid):
        row = sc.pitching.get(pid)
        if not row or row.get(field) is None:
            return None
        n = row.get("bip") or row.get("pitches")
        return None if not n else (row[field], n)
    return get


def _min(board: str, sample: str, threshold: float):
    def member(sc, pid):
        return ((getattr(sc, board).get(pid) or {}).get(sample) or 0) >= threshold
    return member


_hitter_pool = _min("batting", "pa", statcast.BATTER_MIN_PA)
_pitcher_pool = _min("pitching", "ip", statcast.PITCHER_MIN_IP)
_catcher_pool = _min("catching", "pitches", statcast.CATCHER_MIN_PITCHES)


def _scope_position(sc, pid):
    pos = position_of(sc, pid)
    return pos if pos and pos != "C" else None


def _scope_group(sc, pid):
    role = role_of(position_of(sc, pid))
    return role if role in ("IF", "OF") else None


def _scope_of(sc, pid):
    return "OF" if role_of(position_of(sc, pid)) == "OF" else None


def _scope_c(sc, pid):
    return "C" if position_of(sc, pid) == "C" else None


class Input:
    """One Statcast number: how to read it, who it is ranked against, its polarity."""

    __slots__ = ("key", "label", "get", "pool", "lower", "scope")

    def __init__(self, key, label, get, pool, lower=False, scope=None):
        self.key, self.label, self.get, self.pool = key, label, get, pool
        self.lower = lower
        # scope(sc, pid) -> ladder key, or None when the input does not apply
        # to him at all (Jump for an infielder). None means "the whole pool".
        self.scope = scope


HITTER_INPUTS = {i.key: i for i in (
    Input("batSpeed", "Bat speed", _field("batTracking", "batSpeed", "swings"),
          _min("batTracking", "swings", statcast.BAT_TRACKING_MIN_SWINGS)),
    Input("bestSpeed", "Best-half exit velo", _field("batting", "bestSpeed", "bip"), _hitter_pool),
    Input("barrel", "Barrel%", _field("batting", "barrelPct", "bip"), _hitter_pool),
    Input("iso", "ISO", _field("batting", "iso", "pa"), _hitter_pool),
    Input("xwobacon", "xwOBAcon", _field("batting", "xwobacon", "bip"), _hitter_pool),
    Input("squaredUp", "Squared-up%", _field("batTracking", "squaredUpPerContact", "contacts"),
          _min("batTracking", "swings", statcast.BAT_TRACKING_MIN_SWINGS)),
    Input("sweetSpot", "Sweet-spot%", _field("batting", "sweetSpotPct", "bip"), _hitter_pool),
    Input("zoneContact", "Zone contact%", _field("batting", "zoneContactPct", "swings"), _hitter_pool),
    Input("whiff", "Whiff%", _field("batting", "whiffPct", "swings"), _hitter_pool, lower=True),
    Input("k", "K%", _field("batting", "kPct", "pa"), _hitter_pool, lower=True),
    Input("chase", "Chase%", _field("batting", "chasePct", "pitches"), _hitter_pool, lower=True),
    Input("bb", "BB%", _field("batting", "bbPct", "pa"), _hitter_pool),
    Input("meatball", "Meatball swing%", _field("batting", "meatballSwingPct", "pitches"), _hitter_pool),
    Input("xwoba", "xwOBA", _field("batting", "xwoba", "pa"), _hitter_pool),
    Input("sprint", "Sprint speed", _field("running", "sprintSpeed", "competitiveRuns"),
          _min("running", "competitiveRuns", statcast.SPRINT_MIN_RUNS)),
    Input("baserunning", "Baserunning runs / 100 opp.",
          _per("baserunning", "runs", "baserunning", "opportunities", 100.0),
          _min("baserunning", "opportunities", statcast.BASERUNNING_MIN_OPPS)),
    Input("range", "Range runs / 1000 outs", _per("frv", "rangeRuns", "frv", "outs", 1000.0),
          _min("frv", "outs", statcast.FIELDING_MIN_OUTS), scope=_scope_position),
    Input("armStrength", "Arm strength", _field("arm", "armStrength", "throws"),
          _min("arm", "throws", statcast.ARM_MIN_THROWS), scope=_scope_group),
    Input("armRuns", "Arm runs / 1000 outs", _per("frv", "armRuns", "frv", "outs", 1000.0),
          _min("frv", "outs", statcast.FIELDING_MIN_OUTS), scope=_scope_group),
    Input("jump", "Jump (ft vs avg)", _field("jump", "jumpFeet", "plays"),
          _min("jump", "plays", statcast.JUMP_MIN_PLAYS), scope=_scope_of),
    Input("framing", "Framing runs / 1000 pitches",
          _per("catching", "framingRuns", "catching", "pitches", 1000.0), _catcher_pool, scope=_scope_c),
    Input("blocking", "Blocking runs / 1000 pitches",
          _per("catching", "blockingRuns", "catching", "pitches", 1000.0), _catcher_pool, scope=_scope_c),
    Input("throwingRuns", "Throwing runs / 1000 pitches",
          _per("catching", "throwingRuns", "catching", "pitches", 1000.0), _catcher_pool, scope=_scope_c),
    Input("popTime", "Pop time", _field("poptime", "popTime", "attempts"),
          _min("poptime", "attempts", 5), lower=True, scope=_scope_c),
)}

PITCHER_INPUTS = {i.key: i for i in (
    Input("fbVelo", "Fastball velo", _field("pitching", "fastballVelo", "pitches"), _pitcher_pool),
    # Runs per 100 pitches, batting side: lower is better.
    Input("stuff", "Stuff model, runs / 100 pitches", _derived_input("stuff"), _pitcher_pool, lower=True),
    Input("whiff", "Whiff%", _field("pitching", "whiffPct", "pitches"), _pitcher_pool),
    Input("zoneContact", "Zone contact% allowed", _field("pitching", "zoneContactPct", "pitches"),
          _pitcher_pool, lower=True),
    Input("k", "K%", _field("pitching", "kPct", "pitches"), _pitcher_pool),
    Input("chase", "Chase% induced", _field("pitching", "chasePct", "pitches"), _pitcher_pool),
    Input("bb", "BB%", _field("pitching", "bbPct", "pitches"), _pitcher_pool, lower=True),
    Input("edge", "Edge%", _field("pitching", "edgePct", "pitches"), _pitcher_pool),
    Input("xwobacon", "xwOBAcon allowed", _bip_or_pitches("xwobacon"), _pitcher_pool, lower=True),
    Input("barrel", "Barrel% allowed", _bip_or_pitches("barrelPct"), _pitcher_pool, lower=True),
    Input("gb", "Ground-ball%", _bip_or_pitches("groundBallPct"), _pitcher_pool),
    Input("depth", "Effective pitches x share above average", _derived_input("depth"), _pitcher_pool),
    Input("xera", "xERA", _field("pitching", "xera", "pitches"), _pitcher_pool, lower=True),
)}


# --- attributes -------------------------------------------------------------

class Attribute:
    __slots__ = ("key", "label", "group", "weights", "question", "roles")

    def __init__(self, key, label, group, weights, question, roles=None):
        self.key, self.label, self.group = key, label, group
        self.weights, self.question = weights, question
        # Fielding roles this attribute is shown for; None = everyone.
        self.roles = roles


HITTER_ATTRIBUTES = (
    Attribute("rawPower", "Raw Power", "hitting", {"batSpeed": .5, "bestSpeed": .5},
              "How hard can he hit it?"),
    Attribute("gamePower", "Game Power", "hitting", {"barrel": .65, "iso": .35},
              "How often does power turn into damage?"),
    Attribute("contactQuality", "Contact Quality", "hitting", {"xwobacon": 1.0},
              "What is each ball in play worth?"),
    Attribute("consistency", "Contact Consistency", "hitting", {"squaredUp": .5, "sweetSpot": .5},
              "Does he square it up at a useful angle?"),
    Attribute("batToBall", "Bat-to-Ball", "hitting", {"zoneContact": .5, "whiff": .3, "k": .2},
              "Does he avoid swinging and missing?"),
    Attribute("swingDecisions", "Swing Decisions", "hitting", {"chase": .5, "bb": .3, "meatball": .2},
              "Does he swing at the right pitches?"),
    Attribute("speed", "Speed", "running", {"sprint": 1.0}, "How fast is he?"),
    Attribute("baserunning", "Baserunning", "running", {"baserunning": 1.0},
              "Does he create value on the bases?"),
    Attribute("range", "Range", "fielding", {"range": 1.0},
              "How much ground does he cover, for his position?", roles={"IF", "OF"}),
    Attribute("arm", "Arm", "fielding", {"armStrength": .5, "armRuns": .5},
              "How strong and how useful is his arm?", roles={"IF", "OF"}),
    Attribute("jump", "Jump", "fielding", {"jump": 1.0},
              "How quickly does he get going on a fly ball?", roles={"OF"}),
    Attribute("framing", "Framing", "fielding", {"framing": 1.0},
              "Does he steal strikes?", roles={"C"}),
    Attribute("blocking", "Blocking", "fielding", {"blocking": 1.0},
              "Does he keep balls in the dirt in front of him?", roles={"C"}),
    Attribute("throwing", "Throwing", "fielding", {"popTime": .5, "throwingRuns": .5},
              "Does he control the running game?", roles={"C"}),
)

PITCHER_ATTRIBUTES = (
    # Extension was meant to be a quarter of this; no Savant board fills it in.
    Attribute("velocity", "Velocity", "pitching", {"fbVelo": 1.0},
              "How hard does he throw?"),
    Attribute("stuff", "Stuff", "pitching", {"stuff": 1.0},
              "How good are his pitches on velocity, shape and release alone?"),
    Attribute("batMissing", "Bat-Missing", "pitching", {"whiff": .5, "zoneContact": .3, "k": .2},
              "Does he get whiffs?"),
    Attribute("chase", "Chase", "pitching", {"chase": 1.0},
              "Do hitters swing at his pitches outside the zone?"),
    Attribute("command", "Command", "pitching", {"bb": .55, "edge": .45},
              "Does he hit his spots? (A proxy: walks and edge%.)"),
    Attribute("contactManagement", "Contact Management", "pitching",
              {"xwobacon": .5, "barrel": .3, "gb": .2}, "Is the contact against him weak?"),
    Attribute("depth", "Arsenal Depth", "pitching", {"depth": 1.0},
              "How many good pitches does he have?"),
)

GROUPS = {
    "hitting": "Hitting", "running": "Baserunning", "fielding": "Fielding",
    "pitching": "Pitching",
}

# How a fielding role's attributes add up to one glove, for OVERALL.
FIELDING_WEIGHTS = {
    "IF": {"range": .6, "arm": .4},
    "OF": {"range": .5, "arm": .25, "jump": .25},
    "C": {"framing": .6, "blocking": .2, "throwing": .2},
}
RUNNING_WEIGHTS = {"speed": .5, "baserunning": .5}
# Hitter OVERALL: the bat's run value carries most of it, defence most of the
# rest, baserunning the smallest slice, matching the ordering of WAR's parts.
HITTER_WEIGHTS = {"bat": .70, "fielding": .20, "running": .10}
HITTER_REQUIRED = ("bat",)
# Pitcher OVERALL leans on the outcome: preventing runs is the job.
# Stuff gets a modest share: it overlaps Bat-Missing, but it is the one input
# that knows next season as well as this season's results do.
PITCHER_WEIGHTS = {"runPrevention": .40, "batMissing": .20, "command": .15,
                   "contactManagement": .10, "stuff": .10, "chase": .05}
PITCHER_REQUIRED = ("runPrevention",)

# The four on the face of the card. Fielding's slot goes to the first fielding
# attribute his role has, or to Swing Decisions for a DH.
HITTER_HEADLINE = ("gamePower", "batToBall", "speed")
PITCHER_HEADLINE = ("stuff", "batMissing", "command", "contactManagement")


# --- sample-size model ------------------------------------------------------

class Settle:
    """How fast one input settles: k, the spread of true talent, and how we know."""

    __slots__ = ("k", "tau2", "source", "r", "pairs")

    def __init__(self, k, tau2, source, r=None, pairs=0):
        self.k, self.tau2, self.source, self.r, self.pairs = k, tau2, source, r, pairs


def fit_settle(inp: Input, older, newer, current) -> Settle:
    """k and tau^2 for one input, from the year-to-year correlation.

    `older` / `newer` are the two most recent complete seasons. Falls back to
    "half reliable at the pool's typical sample" when there is no usable pair.
    """
    xs, ys, ns = [], [], []
    if older is not None and newer is not None:
        for pid in newer_pool(inp, newer):
            if not inp.pool(older, pid):
                continue
            a, b = inp.get(older, pid), inp.get(newer, pid)
            if a is None or b is None:
                continue
            xs.append(a[0])
            ys.append(b[0])
            ns.append(math.sqrt(a[1] * b[1]))
    if len(xs) >= MIN_POOL:
        try:
            r = statistics.correlation(xs, ys)
        except statistics.StatisticsError:
            r = None
        if r is not None and r > 0.02:
            r = min(r, 0.98)
            n_typ = statistics.median(ns)
            var = statistics.pvariance(xs + ys)
            return Settle(n_typ * (1 - r) / r, r * var, "year-to-year", round(r, 3), len(xs))

    values = [inp.get(current, pid) for pid in newer_pool(inp, current)]
    values = [v for v in values if v is not None]
    if len(values) < 2:
        return Settle(1.0, 0.0, "none")
    n_typ = statistics.median(v[1] for v in values)
    var = statistics.pvariance([v[0] for v in values])
    return Settle(n_typ, 0.5 * var, "fallback")


def newer_pool(inp: Input, sc) -> list[str]:
    """Everyone in this input's reference pool in season `sc`."""
    if sc is None:
        return []
    board_ids = set(sc.batting) | set(sc.pitching) | set(sc.catching) | set(sc.frv) \
        | set(sc.arm) | set(sc.jump) | set(sc.poptime) | set(sc.running) | set(sc.baserunning) \
        | set(sc.batTracking)
    return [pid for pid in board_ids if inp.pool(sc, pid)]


class Posterior:
    __slots__ = ("mean", "sd", "n0", "neff")

    def __init__(self, mean, sd, n0, neff):
        self.mean, self.sd, self.n0, self.neff = mean, sd, n0, neff


# --- the model --------------------------------------------------------------

def _rng(*parts) -> random.Random:
    """A seeded generator, so a card shows the same band every time it opens."""
    return random.Random(zlib.crc32(":".join(map(str, parts)).encode()))


class Model:
    """Every ladder for one side of the ball in one season, built once per data refresh.

    WHAT A PERCENTILE IS RANKED AGAINST. Not the pool's adjusted averages:
    shrinking squeezes those toward the middle, so a plausible true value drawn
    for one player would be ranked against a population narrower than true
    talent really is, and every band would come out too wide. Instead each pool
    player contributes POOL_DRAWS draws of his own true talent, and that cloud
    -- which has the spread of true talent itself -- is the ladder. A player's
    rating is then the MEDIAN of his own DRAWS ranked against it, and his band
    the middle 80%, so the number and the band are one calculation.
    """

    def __init__(self, kind, inputs, attributes, sc, prev1=None, prev2=None):
        self.kind = kind
        self.inputs = inputs
        self.attributes = attributes
        self.sc, self.prev = sc, (prev1, prev2)
        self.settle = {key: fit_settle(inp, prev2, prev1, sc) for key, inp in inputs.items()}
        self._roles = {}
        self._rated = {}

        # League average per input and scope, over this season's pool.
        self.mu: dict[str, dict] = {}
        for key, inp in inputs.items():
            by_scope: dict = {}
            for pid in newer_pool(inp, sc):
                got = inp.get(sc, pid)
                if got is None:
                    continue
                scope = self._scope(inp, pid)
                by_scope.setdefault(scope, []).append(got[0])
                if scope is not None:
                    by_scope.setdefault(None, []).append(got[0])
            self.mu[key] = {s: statistics.fmean(v) for s, v in by_scope.items() if v}

        # Step 1 for everyone with this season's data.
        self.post: dict[str, dict[str, Posterior]] = {}
        for key, inp in inputs.items():
            posts = {}
            for pid in self._everyone():
                p = self._posterior(inp, key, pid)
                if p is not None:
                    posts[pid] = p
            self.post[key] = posts

        # The true-talent cloud, stage by stage: inputs, then attributes (which
        # need the input ladders), then overall (which needs the attributes').
        pool_draws = {}
        for pid in self._everyone():
            rng = _rng("pool", sc.season, kind, pid)
            pool_draws[pid] = [self._draw_inputs(pid, rng) for _ in range(POOL_DRAWS)]

        self.ladders: dict[str, dict] = {}
        for key, inp in inputs.items():
            by_scope = {}
            for pid in newer_pool(inp, sc):
                if pid not in self.post[key] or pid not in pool_draws:
                    continue
                values = [d[key] for d in pool_draws[pid] if d.get(key) is not None]
                by_scope.setdefault(self._scope(inp, pid), []).extend(values)
            self.ladders[key] = {s: Ladder(v, inp.lower) for s, v in by_scope.items()}
            self.ladders[key]["__group__"] = Ladder(
                [x for v in by_scope.values() for x in v], inp.lower)

        self.attr_ladders: dict[str, dict] = {}
        for attr in attributes:
            by_scope = {}
            for pid in self._attr_pool(attr):
                if pid not in pool_draws:
                    continue
                for d in pool_draws[pid]:
                    raw = self._attr_raw(attr, self._input_pcts(pid, d, attr.weights))
                    if raw is not None:
                        by_scope.setdefault(self._attr_scope(attr, pid), []).append(raw)
            self.attr_ladders[attr.key] = {s: Ladder(v) for s, v in by_scope.items()}
            self.attr_ladders[attr.key]["__group__"] = Ladder(
                [x for v in by_scope.values() for x in v])

        scores = []
        for pid in self._overall_pool():
            for d in pool_draws.get(pid, []):
                raw = self._tree(pid, d)[1]
                if raw is not None:
                    scores.append(raw)
        self.overall = Ladder(scores)

    # -- membership and scope ------------------------------------------------

    def _everyone(self):
        sc = self.sc
        return set(sc.pitching) if self.kind == "pitcher" else \
            set(sc.batting) | set(sc.catching) | set(sc.frv) | set(sc.running)

    def _overall_pool(self):
        pool = _pitcher_pool if self.kind == "pitcher" else _hitter_pool
        return [pid for pid in self._everyone() if pool(self.sc, pid)]

    def _role(self, pid):
        if pid not in self._roles:
            self._roles[pid] = role_of(position_of(self.sc, pid))
        return self._roles[pid]

    def _scope(self, inp, pid):
        return inp.scope(self.sc, pid) if inp.scope else None

    def _attr_scope(self, attr, pid):
        return self._scope(self.inputs[next(iter(attr.weights))], pid)

    def _attr_pool(self, attr):
        return newer_pool(self.inputs[next(iter(attr.weights))], self.sc)

    def _low_glove(self, pid) -> bool:
        """An infielder or outfielder with too few defensive outs to rate."""
        if self.kind != "hitter" or self._role(pid) not in ("IF", "OF"):
            return False
        return ((self.sc.frv.get(pid) or {}).get("outs") or 0) < FIELDING_SHOW_OUTS

    def applies(self, attr, pid) -> bool:
        return attr.roles is None or self._role(pid) in attr.roles

    # -- step 1: adjust ------------------------------------------------------

    def _posterior(self, inp, key, pid):
        if inp.scope and inp.scope(self.sc, pid) is None:
            return None
        cur = inp.get(self.sc, pid)
        if cur is None:
            return None
        settle = self.settle[key]
        mu_by = self.mu.get(key) or {}
        mu = mu_by.get(self._scope(inp, pid), mu_by.get(None))
        if mu is None:
            return None
        num = cur[1] * cur[0] + settle.k * mu
        den = cur[1] + settle.k
        for weight, prev in zip(PRIOR_WEIGHTS, self.prev):
            if prev is None:
                continue
            past = inp.get(prev, pid)
            if past is not None:
                num += weight * past[1] * past[0]
                den += weight * past[1]
        sd = math.sqrt(max(settle.tau2, 0.0) * settle.k / den) if den > 0 else 0.0
        return Posterior(num / den, sd, cur[1], den - settle.k)

    def _draw_inputs(self, pid, rng):
        """One plausible set of true values for every input he has."""
        out = {}
        for key in self.inputs:
            p = self.post[key].get(pid)
            if p is not None:
                out[key] = rng.gauss(p.mean, p.sd) if p.sd > 0 else p.mean
        return out

    # -- steps 2 and 3: rank, combine, re-rank -------------------------------

    def _input_pct(self, key, pid, value):
        if value is None:
            return None
        ladders = self.ladders.get(key) or {}
        ladder = ladders.get(self._scope(self.inputs[key], pid))
        if ladder is None or len(ladder) < MIN_POOL:
            ladder = ladders.get("__group__")
        return ladder.pct(value) if ladder is not None else None

    def _input_pcts(self, pid, drawn, keys):
        return {k: self._input_pct(k, pid, drawn.get(k)) for k in keys}

    @staticmethod
    def _attr_raw(attr, pcts):
        return _blend(pcts, attr.weights)

    def _attr_pct(self, attr, pid, raw):
        if raw is None:
            return None
        ladders = self.attr_ladders.get(attr.key) or {}
        ladder = ladders.get(self._attr_scope(attr, pid))
        if ladder is None or len(ladder) < MIN_POOL:
            ladder = ladders.get("__group__")
        return ladder.pct(raw) if ladder is not None else None

    def _tree(self, pid, drawn):
        """One draw, all the way up: attribute percentiles and the overall's raw score."""
        attr_pcts = {}
        for attr in self.attributes:
            if self.applies(attr, pid):
                raw = self._attr_raw(attr, self._input_pcts(pid, drawn, attr.weights))
                attr_pcts[attr.key] = self._attr_pct(attr, pid, raw)
        anchor = self._input_pct(self._anchor_key(), pid, drawn.get(self._anchor_key()))
        return attr_pcts, self._overall_raw(pid, attr_pcts, anchor)

    def _overall_raw(self, pid, attr_pcts, anchor):
        """The value layer: the anchor's percentile plus the groups that add to it."""
        if self.kind == "pitcher":
            parts = {"runPrevention": anchor,
                     **{k: attr_pcts.get(k) for k in PITCHER_WEIGHTS if k != "runPrevention"}}
            if any(parts.get(k) is None for k in PITCHER_REQUIRED):
                return None
            return _blend(parts, PITCHER_WEIGHTS)

        role = self._role(pid)
        fielding = _blend(attr_pcts, FIELDING_WEIGHTS[role]) if role in FIELDING_WEIGHTS else None
        if self._low_glove(pid):
            fielding = None   # not shown, so not counted either
        parts = {"bat": anchor, "fielding": fielding,
                 "running": _blend(attr_pcts, RUNNING_WEIGHTS)}
        if any(parts.get(k) is None for k in HITTER_REQUIRED):
            return None
        return _blend(parts, HITTER_WEIGHTS)

    def _anchor_key(self):
        return "xera" if self.kind == "pitcher" else "xwoba"

    # -- steps 4 and 5: grade and band ---------------------------------------

    def _draws(self, pid):
        """Percentile of every attribute and of overall, DRAWS times over."""
        rng = _rng("card", self.sc.season, self.kind, pid)
        out: dict[str, list] = {"overall": []}
        for _ in range(DRAWS):
            attr_pcts, raw = self._tree(pid, self._draw_inputs(pid, rng))
            for key, pct in attr_pcts.items():
                if pct is not None:
                    out.setdefault(key, []).append(pct)
            o = self.overall.pct(raw) if raw is not None else None
            if o is not None:
                out["overall"].append(o)
        return out

    def reliability(self, pid, weights) -> float | None:
        """How much of the estimate is his own data: n / (n + k), weight-averaged.

        n is his effective sample (this season plus the weighted priors). 1 is
        "all evidence", 0 is "all league average".
        """
        parts = {}
        for key in weights:
            p = self.post[key].get(pid)
            if p is not None:
                k = self.settle[key].k
                parts[key] = p.neff / (p.neff + k) if p.neff + k > 0 else 0.0
        return _blend(parts, weights)

    @staticmethod
    def _score(samples, hidden=None, reliability=None):
        if hidden is None and len(samples) < DRAWS // 2:
            hidden = "No data"
        if hidden is None:
            s = sorted(samples)
            mid = s[len(s) // 2]
            lo, hi = s[int(BAND[0] * (len(s) - 1))], s[int(BAND[1] * (len(s) - 1))]
            if hi - lo > HIDE_BAND_WIDTH or (reliability is not None and reliability < MIN_RELIABILITY):
                hidden = "Not enough data yet"
        if hidden:
            return {"pct": None, "grade": None, "lo": None, "hi": None,
                    "gradeLo": None, "gradeHi": None, "hidden": hidden,
                    "reliability": None if reliability is None else round(reliability, 2)}
        return {
            "pct": show_pct(mid), "grade": grade_of(mid),
            "lo": show_pct(lo), "hi": show_pct(hi),
            "gradeLo": grade_of(lo), "gradeHi": grade_of(hi),
            "hidden": None,
            "reliability": None if reliability is None else round(reliability, 2),
        }

    # -- the payload ---------------------------------------------------------

    def rate(self, pid: str) -> dict | None:
        """His full ratings, worked out once per data refresh.

        A card rates six players (himself and five matches) and a search result
        wants the same number the card will show, so this is shared. Treat the
        result as read-only.
        """
        if pid not in self._rated:
            self._rated[pid] = self._rate(pid)
        return self._rated[pid]

    def _rate(self, pid: str) -> dict | None:
        attrs = [a for a in self.attributes if self.applies(a, pid)]
        anchor = self.post[self._anchor_key()].get(pid)
        if anchor is None and not any(self.post[k].get(pid) for a in attrs for k in a.weights):
            return None

        draws = self._draws(pid)
        pos = position_of(self.sc, pid) if self.kind == "hitter" else "P"
        role = self._role(pid) if self.kind == "hitter" else "P"
        low_glove = self._low_glove(pid)

        attributes = []
        for a in attrs:
            hidden = "Not enough innings in the field" if a.group == "fielding" and low_glove else None
            pool = self.attr_ladders.get(a.key, {})
            ladder = pool.get(self._attr_scope(a, pid))
            if ladder is None or len(ladder) < MIN_POOL:
                ladder = pool.get("__group__")
            attributes.append({
                "key": a.key, "label": a.label, "group": a.group,
                "question": a.question,
                "basis": " · ".join(f"{self.inputs[k].label} {round(w * 100)}%"
                                    for k, w in a.weights.items()),
                # Players, not draws: the ladder holds POOL_DRAWS per player.
                "pool": (len(ladder) // POOL_DRAWS) if ladder is not None else 0,
                **self._score(draws.get(a.key, []), hidden, self.reliability(pid, a.weights)),
            })

        overall = self._score(draws["overall"], None,
                              self.reliability(pid, {self._anchor_key(): 1.0}))
        overall["pool"] = len(self.overall) // POOL_DRAWS
        overall["basis"] = ("xERA, bat-missing, command, stuff, contact management, chase"
                            if self.kind == "pitcher" else "xwOBA, fielding, baserunning")

        present = {x["key"] for x in attributes}
        if self.kind == "pitcher":
            headline = [k for k in PITCHER_HEADLINE if k in present]
        else:
            glove = next((x["key"] for x in attributes if x["group"] == "fielding"), None)
            headline = list(HITTER_HEADLINE) + [glove or "swingDecisions"]

        return {
            "kind": self.kind,
            "version": 2,
            "position": pos,
            "role": role,
            "overall": overall,
            "attributes": attributes,
            "groups": [{"key": g, "label": GROUPS[g]}
                       for g in dict.fromkeys(x["group"] for x in attributes)],
            "headline": headline,
            "tags": self._tags(pid),
            "priorSeasons": [p.season for p in self.prev if p is not None],
            "sample": {"n": anchor.n0 if anchor else None,
                       "unit": "pitches" if self.kind == "pitcher" else "PA"},
        }

    # -- similar players ------------------------------------------------------
    #
    # STRICTLY THE CLOSEST RATINGS. Nothing else -- no team, age, handedness or
    # reputation -- goes into who matches whom. Three decisions make "closest"
    # mean what it should:
    #
    #   GRADE SPACE. Each attribute is compared as standard deviations from
    #   average (the 20-80 grade before rounding), not in percentile points.
    #   Percentiles squash the ends: 95 against 99 is a real gap in talent and
    #   45 against 55 a small one, and percentile points say the opposite.
    #
    #   EACH SKILL COUNTED ONCE. Raw Power, Game Power and Contact Quality move
    #   together; plain distance would make "similar" mean "similar power". The
    #   distance is Mahalanobis -- measured against how the attributes vary
    #   together across the league -- so correlated attributes share their
    #   weight instead of tripling it.
    #
    #   WHAT THEY SHARE. Players are compared on the attributes both have, and
    #   fielding only between players in the same fielding role: a shortstop's
    #   Range is not a catcher's Framing, and a DH has none. So a DH's closest
    #   match can be a shortstop who hits like him, compared on the bat alone.
    #   The distance is per attribute compared, so a 7-attribute match and a
    #   10-attribute one are on the same scale, and a pair has to share most of
    #   the target's attributes to count at all.
    #
    # Hidden ratings ("not enough data") are left out of both vectors, and a
    # candidate needs a shown Overall to be listed.

    def _vector(self, pid):
        """{attribute: z} from his point estimates, without the ratings he would not show."""
        means = {k: p[pid].mean for k, p in self.post.items() if pid in p}
        if not means:
            return None
        attr_pcts, raw = self._tree(pid, means)
        low_glove = self._low_glove(pid)
        vec = {}
        for attr in self.attributes:
            pct = attr_pcts.get(attr.key)
            if pct is None or (attr.group == "fielding" and low_glove):
                continue
            rel = self.reliability(pid, attr.weights)
            if rel is not None and rel < MIN_RELIABILITY:
                continue
            vec[attr.key] = _NORMAL.inv_cdf(min(max(pct, SHOW_PCT[0]), SHOW_PCT[1]) / 100.0)
        return vec, raw

    def _similarity_index(self):
        """Every listable player's vector, and the league's correlation of attributes."""
        if getattr(self, "_sim", None) is not None:
            return self._sim
        vectors = {}
        for pid in self._overall_pool():
            got = self._vector(pid)
            if got is None or got[1] is None:
                continue
            anchor_rel = self.reliability(pid, {self._anchor_key(): 1.0})
            if anchor_rel is not None and anchor_rel < MIN_RELIABILITY:
                continue
            vectors[pid] = got[0]
        keys = [a.key for a in self.attributes]
        corr = {}
        for i, a in enumerate(keys):
            for b in keys[i:]:
                pairs = [(v[a], v[b]) for v in vectors.values() if a in v and b in v]
                if a == b:
                    corr[(a, b)] = 1.0
                    continue
                r = 0.0
                if len(pairs) >= MIN_POOL:
                    try:
                        r = statistics.correlation(*zip(*pairs))
                    except statistics.StatisticsError:
                        r = 0.0
                corr[(a, b)] = corr[(b, a)] = r
        self._sim = {"vectors": vectors, "corr": corr, "inverse": {}}
        return self._sim

    def _inverse(self, dims):
        """The inverse correlation matrix over these attributes, cached per set."""
        sim = self._similarity_index()
        hit = sim["inverse"].get(dims)
        if hit is None:
            # A little ridge keeps a near-duplicate pair from blowing the inverse up.
            m = [[sim["corr"][(a, b)] + (SIM_RIDGE if a == b else 0.0) for b in dims] for a in dims]
            hit = sim["inverse"][dims] = _invert(m)
        return hit

    def _distance(self, target, other, same_role):
        dims = tuple(sorted(k for k in target if k in other
                            and (same_role or self._group_of(k) != "fielding")))
        if len(dims) < max(SIM_MIN_SHARED, SIM_MIN_OVERLAP * len(target)):
            return None, dims
        inv = self._inverse(dims)
        d = [target[k] - other[k] for k in dims]
        d2 = sum(d[i] * inv[i][j] * d[j] for i in range(len(d)) for j in range(len(d)))
        return math.sqrt(max(d2, 0.0) / len(dims)), dims

    def _group_of(self, key):
        return next(a.group for a in self.attributes if a.key == key)

    def similar(self, pid, n=SIMILAR_COUNT):
        """The n closest players by rating, with what makes them alike and different."""
        got = self._vector(pid)
        if got is None or not got[0]:
            return []
        target = got[0]
        role = self._role(pid) if self.kind == "hitter" else "P"
        sim = self._similarity_index()
        scored = []
        for cid, vec in sim["vectors"].items():
            if cid == pid:
                continue
            same_role = self.kind == "pitcher" or self._role(cid) == role
            dist, dims = self._distance(target, vec, same_role)
            if dist is not None:
                scored.append((dist, cid, dims))
        scored.sort()

        labels = {a.key: a.label for a in self.attributes}
        mine = {a["key"]: a for a in (self.rate(pid) or {}).get("attributes", [])}
        board = self.sc.pitching if self.kind == "pitcher" else self.sc.batting
        out = []
        for dist, cid, dims in scored[:n]:
            theirs_rate = self.rate(cid) or {}
            theirs = {a["key"]: a for a in theirs_rate.get("attributes", [])}
            vec = sim["vectors"][cid]
            # Alike: close on attributes that are notable, so "both average at
            # everything" does not crowd out "both elite at power".
            alike = sorted(dims, key=lambda k: abs(target[k] - vec[k]) - 0.5 * (abs(target[k]) + abs(vec[k])) / 2)
            differ = max(dims, key=lambda k: abs(target[k] - vec[k]))
            out.append({
                "id": int(cid) if cid.isdigit() else cid,
                "name": (board.get(cid) or {}).get("name"),
                "position": theirs_rate.get("position"),
                "role": theirs_rate.get("role"),
                "similarity": int(round(100 * math.exp(-dist * dist / 2))),
                "compared": len(dims),
                "overall": {k: (theirs_rate.get("overall") or {}).get(k) for k in ("pct", "grade")},
                "alike": [{"key": k, "label": labels[k]} for k in alike[:3]],
                "differs": {
                    "key": differ, "label": labels[differ],
                    "mine": {k: (mine.get(differ) or {}).get(k) for k in ("pct", "grade")},
                    "theirs": {k: (theirs.get(differ) or {}).get(k) for k in ("pct", "grade")},
                },
            })
        return out

    def _tags(self, pid):
        """Descriptions, not ratings: neither end of these is better."""
        sc, tags = self.sc, []
        if self.kind == "hitter":
            row = sc.batting.get(pid) or {}
            if (row.get("pa") or 0) < statcast.BATTER_MIN_PA:
                return tags
            for field, high, low in (("pullPct", "Pull hitter", "Uses the whole field"),
                                     ("flyBallPct", "Fly-ball hitter", None),
                                     ("groundBallPct", "Ground-ball hitter", None)):
                ladder = Ladder(r.get(field) for p, r in sc.batting.items() if _hitter_pool(sc, p))
                pct = ladder.pct(row.get(field))
                if pct is None:
                    continue
                if pct >= 80:
                    tags.append(high)
                elif low and pct <= 20:
                    tags.append(low)
        else:
            row = sc.pitching.get(pid) or {}
            games, starts = row.get("games") or 0, row.get("starts") or 0
            if games:
                tags.append("Starter" if starts / games >= 0.5 else "Reliever")
            ladder = Ladder(r.get("groundBallPct") for p, r in sc.pitching.items()
                            if _pitcher_pool(sc, p))
            pct = ladder.pct(row.get("groundBallPct"))
            if pct is not None and pct >= 80:
                tags.append("Ground-ball pitcher")
        return tags


class HitterModel(Model):
    def __init__(self, sc, prev1=None, prev2=None):
        super().__init__("hitter", HITTER_INPUTS, HITTER_ATTRIBUTES, sc, prev1, prev2)


class PitcherModel(Model):
    def __init__(self, sc, prev1=None, prev2=None):
        super().__init__("pitcher", PITCHER_INPUTS, PITCHER_ATTRIBUTES, sc, prev1, prev2)


# --- season models, cached alongside the data they are built from -----------

_models: dict[int, tuple[tuple, HitterModel, PitcherModel]] = {}


def _models_for(sc: statcast.SeasonStatcast, prev1=None, prev2=None):
    """Ladders for a season, rebuilt only when the underlying data changes.

    Keyed on the identity of the SeasonStatcast objects: statcast.season() and
    statcast.history() hand back the same instances until their caches expire,
    so a new object is exactly the signal that the ladders need rebuilding.
    """
    ident = (id(sc), id(prev1), id(prev2))
    hit = _models.get(sc.season)
    if hit and hit[0] == ident:
        return hit[1], hit[2]
    built = (ident, HitterModel(sc, prev1, prev2), PitcherModel(sc, prev1, prev2))
    _models[sc.season] = built
    return built[1], built[2]


def warm(season_year: int) -> None:
    """Fetch a season and its two priors, and build the models, ahead of the first card.

    Three seasons of boards take ~20 s cold. Run in a background thread at
    startup so the first player card after a deploy does not pay for it.
    Never raises: a failure here just means the first card does the work.
    """
    try:
        sc, _ = statcast.season(season_year)
        _models_for(sc, statcast.history(season_year - 1), statcast.history(season_year - 2))
    except Exception as exc:
        sys.stderr.write(f"[ratings] warm-up for {season_year} failed: "
                         f"{type(exc).__name__}: {exc}\n")


# --- the public shape -------------------------------------------------------

def playing_time(season_year: int) -> dict[str, float]:
    """PA, or batters faced for a pitcher, from a season ALREADY loaded. Never fetches.

    Player search uses it to order players who share a name. It must not make a
    search wait on three seasons of Savant boards, so before they have landed it
    is simply empty and the order falls back to alphabetical.
    """
    hit = statcast._cache.get(season_year)
    if not hit:
        return {}
    sc = hit[1]
    out = {pid: r.get("pa") or 0 for pid, r in sc.batting.items()}
    for pid, r in sc.pitching.items():
        # Pitches over ~3.9 per batter: the same unit as a hitter's PA.
        out[pid] = max(out.get(pid, 0), round((r.get("pitches") or 0) / 3.9))
    return out


def summaries(people: dict[str, bool], season_year: int) -> dict[str, dict | None]:
    """{id: is_pitcher} -> the few numbers a search result shows, for each.

    The same numbers his card will show, since they come from the same rate().
    A player with no ratings comes back None. Never raises, like profile().
    """
    try:
        sc, _ = statcast.season(season_year)
        hitters, pitchers = _models_for(sc, statcast.history(season_year - 1),
                                        statcast.history(season_year - 2))
    except Exception as exc:
        sys.stderr.write(f"[ratings] summaries for {season_year} unavailable: "
                         f"{type(exc).__name__}: {exc}\n")
        return {pid: None for pid in people}

    out: dict[str, dict | None] = {}
    for pid, is_pitcher in people.items():
        rated = (pitchers if is_pitcher else hitters).rate(pid)
        if not rated:
            out[pid] = None
            continue
        shown = [a for a in rated["attributes"] if a.get("pct") is not None]
        top = max(shown, key=lambda a: a["pct"]) if shown else None
        overall = rated["overall"]
        out[pid] = {
            "overall": {"pct": overall.get("pct"), "grade": overall.get("grade")},
            "top": top and {k: top[k] for k in ("key", "label", "pct", "grade")},
        }
    return out


def _unavailable(reason: str) -> dict:
    return {"ratings": None, "statcast": None, "arsenal": None,
            "ratingsNote": reason, "ratingsSeason": None}


def profile(person_id, is_pitcher: bool, season_year: int) -> dict:
    """Ratings + season Statcast + arsenal for one player, ready to merge onto a card.

    Never raises. Savant being unreachable must cost the card its ratings, not
    the whole card -- the bio and the season line come from statsapi and are
    unaffected. The reason travels with the payload so the UI can say what is
    missing instead of showing an empty chart.
    """
    pid = str(person_id)
    try:
        sc, age = statcast.season(season_year)
    except Exception as exc:
        sys.stderr.write(f"[ratings] season {season_year} unavailable: "
                         f"{type(exc).__name__}: {exc}\n")
        return _unavailable("Season Statcast data is unavailable right now.")

    # Prior seasons are the prior and the year-to-year pair. Without them the
    # ratings still work, shrinking toward the league instead.
    prev1 = statcast.history(season_year - 1)
    prev2 = statcast.history(season_year - 2)
    hitters, pitchers = _models_for(sc, prev1, prev2)

    model = pitchers if is_pitcher else hitters
    if is_pitcher:
        ratings = pitchers.rate(pid)
        metrics = sc.pitching.get(pid)
        arsenal = sc.arsenal.get(pid)
    else:
        ratings = hitters.rate(pid)
        metrics = sc.batting.get(pid)
        arsenal = None

    note = None
    if ratings is None:
        note = f"No {season_year} Statcast data for this player yet."
    elif age:
        note = f"Statcast data cached {round(age / 3600)}h ago."

    if ratings is not None:
        # A copy: rate() is shared, and the matches belong to this card only.
        ratings = {**ratings, "similar": model.similar(pid)}

    payload = {
        "ratings": ratings,
        "statcast": metrics,
        "arsenal": arsenal,
        "ratingsSeason": season_year,
        "ratingsNote": note,
    }

    # A hitter's speed and glove are worth showing on the back even when the
    # bat has no rating, and they live on different boards.
    if not is_pitcher:
        payload["running"] = sc.running.get(pid)
        payload["fielding"] = sc.fielding.get(pid)
        payload["catching"] = sc.catching.get(pid)

    return payload
