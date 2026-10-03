"""Offline logic check for ratings.py — the percentile engine behind player cards.

No network: builds a SeasonStatcast by hand and asserts the grading rules that
are easy to get subtly, silently wrong. Every one of these corresponds to a
decision documented at the top of ratings.py.

    python ratingstest.py
"""

import ratings
import statcast


def approx(a, b, tol=0.51):
    return a is not None and abs(a - b) <= tol


# --- Ladder: the percentile definition itself -------------------------------

# A hundred distinct values, so each is worth one percentage point. With the
# tie half-credit the k-th of n sits at 100*(k-0.5)/n: 0.5, 1.5 ... 99.5.
ladder = ratings.Ladder(range(100), lower_is_better=False)
assert len(ladder) == 100
assert approx(ladder.pct(0), 0.5), ladder.pct(0)
assert approx(ladder.pct(99), 99.5), ladder.pct(99)
assert approx(ladder.pct(50), 50.5), ladder.pct(50)
print("Ladder percentile ladder OK")

# Ties take the midpoint of the block they share, not the top of it. This is
# the case OAA hits constantly, where dozens of fielders sit on the same
# integer -- counting ties as "beaten" would put every one of them at the top.
tied = ratings.Ladder([5] * 30)
assert approx(tied.pct(5), 50), tied.pct(5)
mixed = ratings.Ladder([1] * 10 + [2] * 10 + [3] * 10)
# The middle block spans 10-20 of 30, so its midpoint is 50.
assert approx(mixed.pct(2), 50), mixed.pct(2)
assert approx(mixed.pct(1), 16.7), mixed.pct(1)
print("Ladder tie handling OK")

# Lower-is-better metrics (xERA, BB%) are stored ascending like any other and
# flipped on read, so the best ERA is the top percentile.
era = ratings.Ladder(range(100), lower_is_better=True)
assert approx(era.pct(0), 99.5), era.pct(0)
assert approx(era.pct(99), 0.5), era.pct(99)
print("Ladder polarity inversion OK")

# A pool too small to mean anything grades nothing at all.
assert ratings.Ladder(range(ratings.MIN_POOL - 1)).pct(1) is None
assert ladder.pct(None) is None
print("Ladder small-pool and null guards OK")


# --- _blend: missing components are dropped, not defaulted ------------------

weights = {"a": 0.5, "b": 0.3, "c": 0.2}
assert approx(ratings._blend({"a": 100, "b": 100, "c": 100}, weights), 100)
# With 'c' absent the remaining weights renormalise over 0.8, so two identical
# components still average to their own value rather than being dragged toward
# zero by the missing one.
assert approx(ratings._blend({"a": 80, "b": 80, "c": None}, weights), 80)
assert approx(ratings._blend({"a": 100, "b": 0, "c": None}, weights), 62.5)
assert ratings._blend({"a": None, "b": None, "c": None}, weights) is None
print("_blend renormalisation OK")


# --- A synthetic season -----------------------------------------------------

def fake_season(year=2026, n=200):
    """A league where player i is the i-th best at everything, by construction.

    Values are spread linearly so the expected percentile of any player is
    known in advance, which is what makes the assertions below meaningful.
    """
    sc = statcast.SeasonStatcast(year)
    for i in range(n):
        pid = str(1000 + i)
        sc.batting[pid] = {
            "pa": 400,
            "xba": 0.200 + i * 0.001,
            "avg": 0.200 + i * 0.001,
            "slg": 0.350 + i * 0.002,
            "iso": round(0.150 + i * 0.001, 3),
            "xslg": 0.400, "obp": 0.320, "woba": 0.320,
            # Spread, because OVERALL is anchored on this one -- a constant
            # here would flatten every composite to the 50th percentile.
            "xwoba": round(0.280 + i * 0.001, 3),
            "exitVelo": 88.0, "launchAngle": 12.0, "barrelPct": 7.0,
            "hardHitPct": 40.0, "kPct": 22.0, "bbPct": 8.0, "sweetSpotPct": 33.0,
        }
        sc.running[pid] = {"sprintSpeed": 25.0 + i * 0.02, "hpTo1b": 4.4,
                           "bolts": 1, "competitiveRuns": 50}
        sc.pitching[pid] = {
            "ip": 100.0, "era": 4.00,
            # Descending, so pitcher 0 has the WORST xERA and pitcher n-1 the best.
            "xera": 6.00 - i * 0.01,
            "kPct": 15.0 + i * 0.05, "bbPct": 12.0 - i * 0.02,
            "whiffPct": 18.0 + i * 0.06, "edgePct": 38.0 + i * 0.02,
            "fastballVelo": 89.0 + i * 0.03,
            "xba": 0.250, "xwoba": 0.310, "swingPct": 47.0, "zonePct": 48.0,
            "barrelPct": 7.0, "hardHitPct": 38.0,
        }
    # Fielders only: a designated hitter is deliberately absent below.
    for i in range(120):
        sc.fielding[str(1000 + i)] = {
            "oaa": i - 60, "runsPrevented": i - 60,
            "pos": "SS" if i % 2 else "CF",
        }
    # Catchers: on no OAA board, graded on run value against each other. Ids
    # 1120-1179 double as catchers so they are in the batting pool too.
    for i in range(60):
        sc.catching[str(1120 + i)] = {
            "framingRuns": i * 0.2 - 6, "blockingRuns": 0.0, "throwingRuns": 0.0,
            "runValue": round(i * 0.2 - 6, 1), "pitches": 4000, "pos": "C",
        }
    sc.sources = {k: True for k in ("batting", "pitching", "running", "fielding",
                                    "catching", "arsenal")}
    return sc


sc = fake_season()
hitters, pitchers = ratings._models_for(sc)

best, worst, middle = "1199", "1000", "1100"

top = hitters.rate(best)
bottom = hitters.rate(worst)
assert top["contact"] >= 99 and top["power"] >= 99, top
assert bottom["contact"] <= 1 and bottom["power"] <= 1, bottom
middle_val = hitters.rate(middle)["overall"]
assert bottom["overall"] < middle_val < top["overall"], (bottom["overall"], middle_val, top["overall"])
print("hitter ability ordering OK", {k: top[k] for k in ("contact", "power", "speed", "overall")})

# OAA is graded WITHIN a position: the fake league's shortstops and centre
# fielders are interleaved, so a player's fielding percentile must reflect his
# own position's ladder rather than the league-wide one.
assert "SS" in hitters.fielding or "CF" in hitters.fielding, hitters.fielding.keys()
assert hitters.rate("1000")["basis"]["fielding"].startswith("OAA vs "), hitters.rate("1000")["basis"]
print("fielding graded within position OK")

# Catchers are graded on run value against other catchers, not on OAA they do
# not have. Id 1179 is the best of the fake catcher pool, 1120 the worst.
best_c, worst_c = hitters.rate("1179"), hitters.rate("1120")
assert best_c["basis"]["fielding"].startswith("Fielding run value"), best_c["basis"]
assert best_c["pool"]["fielding"] == 60, best_c["pool"]
assert best_c["fielding"] >= 99, best_c
assert worst_c["fielding"] <= 1, worst_c
print("catchers graded on run value OK", best_c["fielding"], worst_c["fielding"])

# The designated hitter: in the batting pool, on neither defensive board.
dh = hitters.rate("1190")
assert dh["fielding"] is None, "a player with no fielding sample must not be graded"
assert dh["basis"]["fielding"] == "No fielding sample", dh["basis"]
assert dh["overall"] is not None, "...but must still get an overall from what he has"
assert dh["contact"] is not None and dh["power"] is not None
print("missing fielding dropped, overall survives OK")

# The regression this guards, and the reason Yordan Alvarez read 89 instead of
# 99: a DH's composite must be his real components renormalised over the weight
# they carry between them, NOT those components scaled down with a silent zero
# standing in for the glove.
dh_parts = hitters._overall_parts("1190")
assert dh_parts["fielding"] is None
w = ratings.HITTER_WEIGHTS
renormalised = ((w["bat"] * dh_parts["bat"] + w["speed"] * dh_parts["speed"])
                / (w["bat"] + w["speed"]))
assert abs(ratings._blend(dh_parts, w) - renormalised) < 1e-9
# ...and a zero-filled glove would have cost him real points, which is the bug.
zeroed = dict(dh_parts, fielding=0)
assert ratings._blend(zeroed, w) < ratings._blend(dh_parts, w)
print("a DH is not penalised for a glove he cannot have OK")

# OVERALL is anchored on xwOBA, deliberately NOT on the Contact and Power bars.
# The lopsided hitter is the whole reason: give him a top-decile xwOBA with a
# bottom-decile ISO and his overall must follow the xwOBA, not the average of
# two bars that disagree.
lopsided = dict(sc.batting["1150"])
# Top of the xwOBA and xBA ranges, bottom of the ISO range: a high-average bat
# who walks and does not slug -- exactly the shape the bars misread.
lopsided.update(xwoba=0.4785, iso=0.050, xba=0.398)
sc.batting["1150"] = lopsided
rebuilt = ratings.HitterModel(sc)
bars = rebuilt._parts("1150")
assert bars["power"] <= 5, bars           # ISO says light-hitting
assert bars["contact"] >= 95, bars        # xBA says elite
overall_parts = rebuilt._overall_parts("1150")
assert overall_parts["bat"] >= 95, overall_parts

rated = rebuilt.rate("1150")
# Averaging the two offensive bars would land him near the middle. Anchoring on
# xwOBA has to put him far above that -- this gap IS the change.
naive_bars = (bars["contact"] + bars["power"]) / 2
assert rated["overall"] > naive_bars + 25, (rated["overall"], naive_bars)
assert rated["basis"]["overall"] == "xwOBA, fielding, speed"
print(f"overall follows xwOBA ({rated['overall']}), not the bar average "
      f"({naive_bars:.0f}) OK")

# Someone outside the pool entirely gets nothing rather than a flattering guess.
assert hitters.rate("999999") is None
assert pitchers.rate("999999") is None
print("unrated players return None OK")


# --- Composites are re-percentiled, not averaged ----------------------------

# The whole point: a pitcher at the 90th percentile in every component must
# land near the 90th overall, not regress toward 50 the way a plain weighted
# mean of percentiles would.
p90 = str(1000 + int(200 * 0.9))
r90 = pitchers.rate(p90)
assert r90["stuff"] >= 85, r90
assert r90["overall"] >= 85, r90
top_p = pitchers.rate(best)
assert top_p["runPrevention"] >= 99, top_p
assert top_p["overall"] >= 99, top_p
# Pitcher 1000 has the worst xERA AND the worst everything else.
assert pitchers.rate(worst)["overall"] <= 1, pitchers.rate(worst)
print("composite re-percentiling OK", {k: r90[k] for k in ("stuff", "command", "overall")})

# Every rating that exists is a whole number inside the scale.
for rate_fn, pid in ((hitters.rate, best), (pitchers.rate, best),
                     (hitters.rate, worst), (pitchers.rate, worst)):
    for key, value in rate_fn(pid).items():
        if key in ("kind", "basis", "pool") or value is None:
            continue
        assert isinstance(value, int) and 0 <= value <= 100, (key, value)
print("ratings are integers within 0-100 OK")


# --- profile(): a Savant outage costs the bars, never the card --------------

def explode(_year):
    raise RuntimeError("savant unreachable")


original = statcast.season
try:
    statcast.season = explode
    payload = ratings.profile(1000, is_pitcher=False, season_year=2026)
    assert payload["ratings"] is None and payload["statcast"] is None
    assert payload["ratingsNote"], "an outage must explain itself"
finally:
    statcast.season = original
print("profile() survives a Statcast outage OK")

# And the under-the-threshold path names the threshold rather than going quiet.
statcast._cache[2026] = (float("inf"), sc)   # far-future stamp: always a cache hit
try:
    payload = ratings.profile(999999, is_pitcher=False, season_year=2026)
    assert payload["ratings"] is None
    assert "plate appearances" in payload["ratingsNote"], payload["ratingsNote"]
    payload = ratings.profile(999999, is_pitcher=True, season_year=2026)
    assert "innings" in payload["ratingsNote"], payload["ratingsNote"]
finally:
    statcast._cache.pop(2026, None)
print("unrated players get a stated reason OK")

print("\nAll assertions passed.")
