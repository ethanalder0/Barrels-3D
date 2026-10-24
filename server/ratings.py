"""Ability ratings for the player card: 0-100, and every one of them a percentile.

The scale is the point. "Power 72" only means something if it means "better than
72% of major-league hitters", so nothing here is a hand-tuned curve from a raw
stat to a grade -- every rating is a percentile rank against the actual 2026
population that statcast.py pulled, and the population is stated on the card.

    percentile(v) = 100 * (below + tied/2) / N

The tie half-credit is the standard percentile-rank definition. It matters more
than it looks: OAA is a small integer, so dozens of fielders share a value, and
counting ties as "beaten" would hand every one of them the top of the block.

COMPOSITES ARE RE-PERCENTILED. A weighted mean of percentiles is NOT itself a
percentile -- averaging pulls everything toward 50, so a blend of four 80th-
percentile skills would score in the low 70s and no player would ever look
elite. So a composite is scored for every player in the pool, and then that
score is percentile-ranked in turn. `overall`, `stuff` and `command` are all
true percentiles of their own distribution.

A HITTER'S OVERALL IS NOT THE AVERAGE OF HIS BARS. It is anchored on xwOBA,
because Contact and Power are two partial views of one swing and averaging them
misreads the hitters who are lopsided -- see the note on HITTER_WEIGHTS. The
bars still say what he does well; OVERALL says how much he is worth.

MISSING COMPONENTS ARE DROPPED, NEVER DEFAULTED. A designated hitter has no
fielding sample at all. Scoring that as 0 would call every DH the worst fielder
alive, and scoring it 50 would invent an average defender. Instead the ability
comes back null, the UI omits the bar, and the composite renormalises over the
weights it does have. A player missing a `required` component gets no composite
at all rather than a flattering partial one.

Catchers are the exception that used to fall into that hole. They are absent
from the OAA board because catching is not a range skill, so they are graded on
catcher Fielding Run Value -- framing plus blocking plus throwing, summed in
statcast.py from Savant's three published run values -- against other catchers.

    Hitter                              Pitcher
    ------------------------------      ---------------------------------
    CONTACT   xBA                       STUFF     whiff% / K% / velocity
    POWER     ISO (SLG - AVG)           COMMAND   BB% (inverted) / edge%
    SPEED     Sprint speed              VELOCITY  average fastball velocity
    FIELDING  OAA within position,      RUN PREV  xERA (inverted)
              run value for catchers
    OVERALL   xwOBA .70 / fielding .20  OVERALL   weighted, re-percentiled
              / speed .10, re-percentiled

Two honest gaps, stated here rather than papered over:

  * SIERA is not exposed by statsapi or by Baseball Savant -- it is a FanGraphs
    stat with no public API. RUN PREVENTION is built on xERA, which is a real
    Statcast metric measuring the same thing (expected run prevention on
    contact quality, strikeouts and walks) and is fetched, not estimated. FIP
    is shown alongside it on the back of the card when available. Implementing
    SIERA from its published regression would mean shipping coefficients we
    cannot verify against a reference value, which is exactly the sort of
    plausible-but-wrong number this file exists to avoid.
  * COMMAND has no public ground truth. The real models (Location+ and friends)
    are proprietary. Walk avoidance plus edge% -- the share of pitches on the
    black -- is the best proxy the public data supports, and the card labels it
    as a proxy rather than implying a scouted command grade.
"""

from __future__ import annotations

import sys
from bisect import bisect_left, bisect_right

import statcast

# --- composite weights ------------------------------------------------------
#
# Hitter OVERALL is anchored on xwOBA, NOT on the Contact and Power bars above
# it. The bars are two partial views of the same swing, and averaging them is
# not the same as measuring offence: a hitter can sit 95th in xBA and 12th in
# ISO -- a high-average, high-walk bat with little power -- and the blend reads
# that as mediocre when his actual run production is well above average. xwOBA
# weights every outcome by the runs it is really worth, so it answers "how much
# offence is this" in one number the way no pair of rate stats can.
#
# The remaining 30% splits the way value does: defence carries most of it,
# baserunning the smallest slice, matching the ordering of WAR's components.
#
# The cost, stated because it is a real one: OVERALL can no longer be derived
# from the four bars on the face of the card. `basis` says so, and the card
# surfaces it on the badge.
HITTER_WEIGHTS = {"bat": 0.70, "fielding": 0.20, "speed": 0.10}
HITTER_REQUIRED = ("bat",)

# Pitcher OVERALL leans on the outcome rather than the inputs: preventing runs
# is the job. Velocity is deliberately small because it is already inside
# STUFF -- giving it a full share would count the same fastball twice.
PITCHER_WEIGHTS = {"stuff": 0.30, "command": 0.20, "runPrevention": 0.40, "velocity": 0.10}
PITCHER_REQUIRED = ("runPrevention",)

# STUFF: bat-missing first. Whiff rate is the purest per-pitch read on an
# arsenal, K% is the outcome it produces, velocity is the raw ingredient.
STUFF_WEIGHTS = {"whiff": 0.45, "k": 0.35, "velocity": 0.20}
# COMMAND: see the module note. Walks are the outcome of missing your spot;
# edge% is the closest public measure of hitting one on purpose. In-zone% is
# deliberately excluded -- a pitcher who grooves everything posts a high one.
COMMAND_WEIGHTS = {"walkAvoidance": 0.55, "edge": 0.45}

# A percentile drawn from a handful of players is noise dressed up as a number.
MIN_POOL = 25


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


def _grade(pct):
    """0-100 for display. Percentiles are continuous; cards show whole numbers."""
    return None if pct is None else int(round(pct))


# --- hitters ----------------------------------------------------------------

def _fielding_ladders(sc: statcast.SeasonStatcast) -> dict:
    """One OAA ladder per position, plus a league-wide fallback.

    OAA is a counting stat gated by opportunity, and opportunity is a function
    of where you stand: shortstops field far more balls in play than first
    basemen, so +4 OAA is a very different season at the two spots. Grading
    within the position is the only way the number compares like with like.
    Positions with too thin a pool fall back to the league ladder.
    """
    by_pos: dict[str, list] = {}
    every: list = []
    for row in sc.fielding.values():
        oaa = row.get("oaa")
        if oaa is None:
            continue
        every.append(oaa)
        if row.get("pos"):
            by_pos.setdefault(row["pos"], []).append(oaa)

    ladders = {pos: Ladder(v) for pos, v in by_pos.items() if len(v) >= MIN_POOL}
    ladders["__all__"] = Ladder(every)

    # Catchers are on none of the above: catching is not a range skill, so
    # Savant grades it with framing/blocking/throwing models instead and
    # statcast.py sums those into a run value. They get their own ladder, which
    # keeps the comparison inside the position exactly as the others are.
    ladders["C"] = Ladder(r.get("runValue") for r in sc.catching.values())
    return ladders


class HitterModel:
    """Every hitter ladder for one season, built once and reused per card."""

    def __init__(self, sc: statcast.SeasonStatcast):
        self.sc = sc
        bats = sc.batting
        self.contact = Ladder(r.get("xba") for r in bats.values())
        self.power = Ladder(r.get("iso") for r in bats.values())
        self.speed = Ladder(r.get("sprintSpeed") for r in sc.running.values())
        self.fielding = _fielding_ladders(sc)
        # Not shown as a bar; this is what OVERALL is built on. See the note on
        # HITTER_WEIGHTS for why offence is measured here rather than by
        # averaging the Contact and Power bars.
        self.bat = Ladder(r.get("xwoba") for r in bats.values())

        # Score the whole population, then rank the scores. See the module note
        # on why the composite cannot just be the weighted mean.
        scores = []
        self._raw: dict[str, float] = {}
        for pid in bats:
            parts = self._overall_parts(pid)
            if any(parts.get(k) is None for k in HITTER_REQUIRED):
                continue
            raw = _blend(parts, HITTER_WEIGHTS)
            if raw is None:
                continue
            self._raw[pid] = raw
            scores.append(raw)
        self.overall = Ladder(scores)

    def _defense(self, pid: str):
        """(percentile, basis) for a player's glove, whichever model covers him.

        Catchers first: they are graded on run value against other catchers.
        Everyone else on OAA against their own position. A designated hitter
        matches neither and comes back (None, None), which is the honest answer
        rather than a zero.
        """
        catching = self.sc.catching.get(pid)
        if catching and catching.get("runValue") is not None:
            return self.fielding["C"].pct(catching["runValue"]), "Fielding run value vs C"

        row = self.sc.fielding.get(pid)
        if not row or row.get("oaa") is None:
            return None, None
        pos = row.get("pos") or ""
        ladder = self.fielding.get(pos) or self.fielding["__all__"]
        return ladder.pct(row["oaa"]), f"OAA vs {pos}" if pos else "OAA"

    def _parts(self, pid: str) -> dict:
        """The four abilities the card draws as bars."""
        bat = self.sc.batting.get(pid) or {}
        run = self.sc.running.get(pid) or {}
        return {
            "contact": self.contact.pct(bat.get("xba")),
            "power": self.power.pct(bat.get("iso")),
            "speed": self.speed.pct(run.get("sprintSpeed")),
            "fielding": self._defense(pid)[0],
        }

    def _overall_parts(self, pid: str) -> dict:
        """What OVERALL is scored from -- deliberately not the same four."""
        bat = self.sc.batting.get(pid) or {}
        run = self.sc.running.get(pid) or {}
        return {
            "bat": self.bat.pct(bat.get("xwoba")),
            "fielding": self._defense(pid)[0],
            "speed": self.speed.pct(run.get("sprintSpeed")),
        }

    def rate(self, pid: str) -> dict | None:
        if pid not in self.sc.batting:
            return None
        parts = self._parts(pid)
        raw = self._raw.get(pid)
        _, defense_basis = self._defense(pid)
        # Which ladder actually graded him, so `pool` reports the real
        # comparison group rather than whichever one happens to be handy.
        if self.sc.catching.get(pid):
            defense_pool = self.fielding["C"]
        else:
            pos = (self.sc.fielding.get(pid) or {}).get("pos") or ""
            defense_pool = self.fielding.get(pos) or self.fielding["__all__"]

        return {
            "kind": "hitter",
            "contact": _grade(parts["contact"]),
            "power": _grade(parts["power"]),
            "speed": _grade(parts["speed"]),
            "fielding": _grade(parts["fielding"]),
            "overall": _grade(self.overall.pct(raw)) if raw is not None else None,
            "basis": {
                "contact": "xBA",
                "power": "ISO",
                "speed": "Sprint speed",
                "fielding": defense_basis or "No fielding sample",
                # Named rather than called a "composite", because it is not the
                # average of the bars above it and the card should not imply so.
                "overall": "xwOBA, fielding, speed",
            },
            "pool": {
                "contact": len(self.contact),
                "power": len(self.power),
                "speed": len(self.speed),
                "fielding": len(defense_pool),
                "overall": len(self.overall),
            },
        }


# --- pitchers ---------------------------------------------------------------

class PitcherModel:
    """Every pitcher ladder for one season, built once and reused per card."""

    def __init__(self, sc: statcast.SeasonStatcast):
        self.sc = sc
        pit = sc.pitching
        self.whiff = Ladder(r.get("whiffPct") for r in pit.values())
        self.k = Ladder(r.get("kPct") for r in pit.values())
        self.velocity = Ladder(r.get("fastballVelo") for r in pit.values())
        self.walk = Ladder((r.get("bbPct") for r in pit.values()), lower_is_better=True)
        self.edge = Ladder(r.get("edgePct") for r in pit.values())
        self.runPrevention = Ladder((r.get("xera") for r in pit.values()),
                                    lower_is_better=True)

        # STUFF and COMMAND are blends, so they get the same re-percentile
        # treatment as OVERALL -- otherwise a pitcher who is 90th percentile in
        # both whiff and K would show a STUFF in the seventies.
        self._stuff_raw: dict[str, float] = {}
        self._command_raw: dict[str, float] = {}
        for pid in pit:
            stuff = _blend(self._stuff_parts(pid), STUFF_WEIGHTS)
            if stuff is not None:
                self._stuff_raw[pid] = stuff
            command = _blend(self._command_parts(pid), COMMAND_WEIGHTS)
            if command is not None:
                self._command_raw[pid] = command
        self.stuff = Ladder(self._stuff_raw.values())
        self.command = Ladder(self._command_raw.values())

        self._raw: dict[str, float] = {}
        scores = []
        for pid in pit:
            parts = self._parts(pid)
            if any(parts.get(k) is None for k in PITCHER_REQUIRED):
                continue
            raw = _blend(parts, PITCHER_WEIGHTS)
            if raw is None:
                continue
            self._raw[pid] = raw
            scores.append(raw)
        self.overall = Ladder(scores)

    def _stuff_parts(self, pid: str) -> dict:
        row = self.sc.pitching.get(pid) or {}
        return {
            "whiff": self.whiff.pct(row.get("whiffPct")),
            "k": self.k.pct(row.get("kPct")),
            "velocity": self.velocity.pct(row.get("fastballVelo")),
        }

    def _command_parts(self, pid: str) -> dict:
        row = self.sc.pitching.get(pid) or {}
        return {
            "walkAvoidance": self.walk.pct(row.get("bbPct")),
            "edge": self.edge.pct(row.get("edgePct")),
        }

    def _parts(self, pid: str) -> dict:
        row = self.sc.pitching.get(pid) or {}
        return {
            "stuff": self.stuff.pct(self._stuff_raw.get(pid)),
            "command": self.command.pct(self._command_raw.get(pid)),
            "velocity": self.velocity.pct(row.get("fastballVelo")),
            "runPrevention": self.runPrevention.pct(row.get("xera")),
        }

    def rate(self, pid: str) -> dict | None:
        if pid not in self.sc.pitching:
            return None
        parts = self._parts(pid)
        raw = self._raw.get(pid)
        return {
            "kind": "pitcher",
            "stuff": _grade(parts["stuff"]),
            "command": _grade(parts["command"]),
            "velocity": _grade(parts["velocity"]),
            "runPrevention": _grade(parts["runPrevention"]),
            "overall": _grade(self.overall.pct(raw)) if raw is not None else None,
            "basis": {
                "stuff": "Whiff%, K%, velocity",
                "command": "BB% and edge% (proxy)",
                "velocity": "Average fastball",
                "runPrevention": "xERA",
                "overall": "Weighted composite",
            },
            "pool": {
                "stuff": len(self.stuff),
                "command": len(self.command),
                "velocity": len(self.velocity),
                "runPrevention": len(self.runPrevention),
                "overall": len(self.overall),
            },
        }


# --- season models, cached alongside the data they are built from -----------

_models: dict[int, tuple[int, HitterModel, PitcherModel]] = {}


def _models_for(sc: statcast.SeasonStatcast):
    """Ladders for a season, rebuilt only when the underlying data changes.

    Keyed on the identity of the SeasonStatcast object: statcast.season() hands
    back the same instance until its cache expires, so a new object is exactly
    the signal that the ladders need rebuilding.
    """
    hit = _models.get(sc.season)
    if hit and hit[0] == id(sc):
        return hit[1], hit[2]
    built = (id(sc), HitterModel(sc), PitcherModel(sc))
    _models[sc.season] = built
    return built[1], built[2]


# --- the public shape -------------------------------------------------------

def _unavailable(reason: str) -> dict:
    return {"ratings": None, "statcast": None, "arsenal": None,
            "ratingsNote": reason, "ratingsSeason": None}


def profile(person_id, is_pitcher: bool, season_year: int) -> dict:
    """Ratings + season Statcast + arsenal for one player, ready to merge onto a card.

    Never raises. Savant being unreachable must cost the card its ability bars,
    not the whole card -- the bio and the season line come from statsapi and are
    unaffected. The reason travels with the payload so the UI can say what is
    missing instead of showing four empty bars.
    """
    pid = str(person_id)
    try:
        sc, age = statcast.season(season_year)
    except Exception as exc:
        sys.stderr.write(f"[ratings] season {season_year} unavailable: "
                         f"{type(exc).__name__}: {exc}\n")
        return _unavailable("Season Statcast data is unavailable right now.")

    hitters, pitchers = _models_for(sc)

    if is_pitcher:
        ratings = pitchers.rate(pid)
        metrics = sc.pitching.get(pid)
        arsenal = sc.arsenal.get(pid)
        threshold = f"{statcast.PITCHER_MIN_IP} innings"
    else:
        ratings = hitters.rate(pid)
        metrics = sc.batting.get(pid)
        arsenal = None
        threshold = f"{statcast.BATTER_MIN_PA} plate appearances"

    note = None
    if ratings is None:
        note = (f"No {season_year} ratings: under the {threshold} needed to be "
                f"ranked against the league.")
    elif age:
        note = f"Statcast data cached {round(age / 3600)}h ago."

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
