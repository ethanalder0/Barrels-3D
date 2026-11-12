"""Offline logic check for ratings.py -- the v2 engine behind player cards.

No network: builds three seasons of SeasonStatcast by hand, from players whose
true talent is known, and asserts the rules that are easy to get subtly,
silently wrong. Every one of these corresponds to a decision documented at the
top of ratings.py.

    python ratingstest.py
"""

import math
import random

import projection
import ratings
import statcast


def approx(a, b, tol=0.51):
    return a is not None and abs(a - b) <= tol


# --- Ladder: the percentile definition itself -------------------------------

ladder = ratings.Ladder(range(100), lower_is_better=False)
assert len(ladder) == 100
assert approx(ladder.pct(0), 0.5), ladder.pct(0)
assert approx(ladder.pct(99), 99.5), ladder.pct(99)
assert approx(ladder.pct(50), 50.5), ladder.pct(50)
# Ties take the midpoint of the block they share, not the top of it.
assert approx(ratings.Ladder([5] * 30).pct(5), 50)
mixed = ratings.Ladder([1] * 10 + [2] * 10 + [3] * 10)
assert approx(mixed.pct(2), 50) and approx(mixed.pct(1), 16.7)
# Lower-is-better metrics are stored ascending and flipped on read.
era = ratings.Ladder(range(100), lower_is_better=True)
assert approx(era.pct(0), 99.5) and approx(era.pct(99), 0.5)
# A pool too small to mean anything grades nothing at all.
assert ratings.Ladder(range(ratings.MIN_POOL - 1)).pct(1) is None
assert ladder.pct(None) is None
print("Ladder percentiles, ties, polarity and guards OK")


# --- _blend: missing components are dropped, not defaulted ------------------

weights = {"a": 0.5, "b": 0.3, "c": 0.2}
assert approx(ratings._blend({"a": 80, "b": 80, "c": None}, weights), 80)
assert approx(ratings._blend({"a": 100, "b": 0, "c": None}, weights), 62.5)
assert ratings._blend({"a": None, "b": None, "c": None}, weights) is None
print("_blend renormalisation OK")


# --- The scale: percentile -> grade ------------------------------------------

assert ratings.grade_of(50) == 50
assert ratings.grade_of(84.13) == 60          # one standard deviation up
assert ratings.grade_of(15.87) == 40
assert ratings.grade_of(97.72) == 70
assert ratings.grade_of(99.9) == 80 and ratings.grade_of(100) == 80
assert ratings.grade_of(0) == 20
assert ratings.grade_of(70) == 55              # 55.2 rounds to the nearest 5
assert all(ratings.grade_of(p) % 5 == 0 for p in range(0, 101))
assert ratings.grade_of(None) is None
assert ratings.show_pct(0.2) == 1 and ratings.show_pct(99.8) == 99 and ratings.show_pct(42.4) == 42
print("grades: 50 + 10 z, rounded to 5, held to 20-80; percentiles shown 1-99 OK")


# --- A synthetic league -----------------------------------------------------
#
# Every player has a hidden true talent z ~ N(0, 1), the same for every skill,
# so the best player is the best at everything by construction. Each season
# he is observed with noise that shrinks with his sample, the way real rate
# stats behave. Ids 1000-1299 hit, 2000-2299 pitch.

RNG = random.Random(7)
N_HIT, N_PIT = 300, 300
TALENT = {str(1000 + i): RNG.gauss(0, 1) for i in range(N_HIT)}
TALENT.update({str(2000 + i): RNG.gauss(0, 1) for i in range(N_PIT)})
POS = ["1B", "2B", "3B", "SS", "LF", "CF", "RF"]


def obs(rng, base, spread, z, n, unit, sign=1):
    """True value base + sign*spread*z, observed over n with noise one spread per `unit`."""
    return base + sign * spread * z + spread * rng.gauss(0, 1) / math.sqrt(max(n, 1) / unit)


def season(year, pa_of=None, skip=()):
    rng = random.Random(year)
    sc = statcast.SeasonStatcast(year)
    for i in range(N_HIT):
        pid = str(1000 + i)
        if pid in skip:
            continue
        z = TALENT[pid]
        pa = (pa_of or {}).get(pid, 550)
        bip, pitches = pa * 0.68, pa * 3.9
        swings = pitches * 0.47
        sc.batting[pid] = {
            "name": f"Hitter {pid}", "pa": pa, "bip": bip, "pitches": pitches, "swings": swings,
            "xwoba": obs(rng, .320, .030, z, pa, 250),
            "xwobacon": obs(rng, .370, .035, z, bip, 100),
            "iso": obs(rng, .160, .045, z, pa, 300),
            "bestSpeed": obs(rng, 100, 2.5, z, bip, 50),
            "barrelPct": obs(rng, 8, 3.5, z, bip, 100),
            "sweetSpotPct": obs(rng, 33, 4, z, bip, 400),
            "zoneContactPct": obs(rng, 82, 5, z, swings, 230),
            "whiffPct": obs(rng, 25, 5, z, swings, 165, sign=-1),
            "kPct": obs(rng, 22, 5, z, pa, 150, sign=-1),
            "chasePct": obs(rng, 28, 5, z, pitches, 350, sign=-1),
            "bbPct": obs(rng, 8.5, 2.5, z, pa, 240),
            "meatballSwingPct": obs(rng, 75, 6, z, pitches, 1200),
            "pullPct": 40 + 6 * rng.gauss(0, 1),
            "flyBallPct": 25 + 5 * rng.gauss(0, 1),
            "groundBallPct": 43 + 6 * rng.gauss(0, 1),
        }
        sc.batTracking[pid] = {"swings": swings, "contacts": swings * 0.76,
                               "batSpeed": obs(rng, 72, 2.5, z, swings, 50),
                               "squaredUpPerContact": obs(rng, .25, .04, z, swings, 290)}
        sc.running[pid] = {"sprintSpeed": obs(rng, 27, 1.2, z, 40, 9), "competitiveRuns": 40}
        sc.baserunning[pid] = {"runs": obs(rng, 0, 2, z, 80, 35) * 0.8, "opportunities": 80}

        # Ids 1270-1299 are catchers, 1240-1269 designated hitters, the rest
        # field one of seven positions in rotation. Id 1239 has barely played
        # the field: his glove is not to be rated.
        if i >= 270:
            caught = 4000
            sc.catching[pid] = {"framingRuns": obs(rng, 0, 4, z, caught, 3500),
                                "blockingRuns": obs(rng, 0, 1, z, caught, 9000),
                                "throwingRuns": obs(rng, 0, 1.5, z, caught, 4400),
                                "pitches": caught, "pos": "C"}
            sc.poptime[pid] = {"attempts": 40, "popTime": obs(rng, 1.95, .05, z, 40, 10, sign=-1)}
        elif i < 240:
            pos = POS[i % len(POS)]
            outs = 60 if i == 239 else 3000
            sc.fielding[pid] = {"oaa": 0, "pos": pos}
            sc.frv[pid] = {"outs": outs, "rangeRuns": obs(rng, 0, 6, z, outs, 3300) * outs / 1000,
                           "armRuns": obs(rng, 0, 1, z, outs, 4000) * outs / 1000}
            sc.arm[pid] = {"throws": 150, "armStrength": obs(rng, 85, 4, z, 150, 45), "pos": None}
            if pos in ratings.OUTFIELD:
                sc.jump[pid] = {"plays": 70, "jumpFeet": obs(rng, 0, 1.2, z, 70, 19)}

    for i in range(N_PIT):
        pid = str(2000 + i)
        z = TALENT[pid]
        pitches, bip = 2000, 400
        sc.pitching[pid] = {
            "name": f"Pitcher {pid}", "ip": 100, "pitches": pitches, "bip": bip, "games": 25,
            "starts": 25 if i % 2 else 0,
            "fastballVelo": obs(rng, 94, 2, z, pitches, 80), "armAngle": 45.0,
            "whiffPct": obs(rng, 25, 5, z, pitches, 450),
            "zoneContactPct": obs(rng, 82, 4, z, pitches, 520, sign=-1),
            "kPct": obs(rng, 22, 5, z, pitches, 550),
            "chasePct": obs(rng, 29, 3, z, pitches, 900),
            "bbPct": obs(rng, 8.5, 2, z, pitches, 1000, sign=-1),
            "edgePct": obs(rng, 40, 2, z, pitches, 2500),
            "xwobacon": obs(rng, .370, .03, z, bip, 640, sign=-1),
            "barrelPct": obs(rng, 8, 2, z, bip, 740, sign=-1),
            "groundBallPct": obs(rng, 43, 6, z, bip, 70),
            "xera": obs(rng, 4.2, .7, z, pitches, 1400, sign=-1),
        }
        sc.movement[pid] = {
            # Better arms throw harder with more ride, and a harder slider.
            # Stuff is the real exported model, so these are real inputs.
            "FF": {"pitches": 1000, "usage": .5, "velo": obs(rng, 94, 2, z, 1000, 80),
                   "breakX": 7 + rng.gauss(0, 1), "ivb": obs(rng, 16, 2, z, 1000, 80)},
            "SL": {"pitches": 600, "usage": .3, "velo": obs(rng, 86, 2, z, 600, 80),
                   "breakX": 4 + rng.gauss(0, 1), "ivb": 1 + rng.gauss(0, 1)},
        }
        sc.arsenal[pid] = [
            {"code": "FF", "usagePct": 50, "pitches": 1000, "runValuePer100": obs(rng, 0, 1, z, 1000, 4000)},
            {"code": "SL", "usagePct": 30, "pitches": 600, "runValuePer100": obs(rng, 0, 1, z, 600, 4000)},
            {"code": "CH", "usagePct": 20, "pitches": 400, "runValuePer100": obs(rng, 0, 1, z, 400, 4000)},
        ]
    sc.sources = {name: True for name, _ in statcast._LOADERS}
    return sc


def best_and_worst(ids):
    ranked = sorted(ids, key=lambda p: TALENT[p])
    return ranked[-1], ranked[0]


# Id 1005 is a call-up: 25 PA this season and no history at all.
CALLUP = "1005"
cur = season(2026, pa_of={CALLUP: 25, "1239": 80})
prev1 = season(2025, skip={CALLUP})
prev2 = season(2024, skip={CALLUP})
H, P = ratings._models_for(cur, prev1, prev2)


# --- k is measured, and it is the right size --------------------------------

# The synthetic noise is one spread per `unit`, which makes the true k exactly
# that unit. The year-to-year fit must recover it to within sampling error --
# 300 players is not many, so "within a factor of two" is the honest test.
for key, true_k in (("xwoba", 250), ("chase", 350), ("sprint", 9), ("bb", 240)):
    s = H.settle[key]
    assert s.source == "year-to-year", (key, s.source)
    assert true_k / 2 < s.k < true_k * 2, (key, s.k, true_k)
assert P.settle["whiff"].source == "year-to-year"
print("k fitted from the year-to-year pair, near its true value OK",
      {k: round(H.settle[k].k) for k in ("xwoba", "chase", "sprint", "bb")})

# Without two prior seasons there is no pair, and the model says so.
alone_h, _ = ratings.HitterModel(cur), None
assert alone_h.settle["xwoba"].source == "fallback"
print("no prior seasons -> fallback k, flagged OK")


# --- step 1: small samples lean on their prior -------------------------------

callup = H.post["xwoba"][CALLUP]
mu = H.mu["xwoba"][None]
raw = cur.batting[CALLUP]["xwoba"]
assert abs(callup.mean - mu) < abs(raw - mu), "a 25-PA call-up must be pulled toward the league"
assert callup.neff == 25
regular = next(p for p in H.post["xwoba"] if p != CALLUP)
assert H.post["xwoba"][regular].sd < callup.sd, "more data, less uncertainty"

# A veteran in a slump: 25 PA this year, but two full seasons behind him. He
# must lean on HIS history, not on the league.
vet = max((p for p in TALENT if p.startswith("1") and int(p) < 1240), key=TALENT.get)
slump = season(2026, pa_of={vet: 25})
slump.batting[vet]["xwoba"] = 0.150      # an awful April
SH, _ = ratings._models_for(slump, prev1, prev2)
assert SH.post["xwoba"][vet].mean > SH.mu["xwoba"][None] + 0.02, \
    "a star's slow start must not erase two seasons of evidence"
ratings._models.clear()
H, P = ratings._models_for(cur, prev1, prev2)
print("small samples shrink toward the league, veterans toward their own history OK")


# --- steps 2-5 on whole players ----------------------------------------------

hitters = [p for p in TALENT if p.startswith("1") and p != CALLUP and int(p) < 1240]
top_id, bottom_id = best_and_worst(hitters)
top, bottom = H.rate(top_id), H.rate(bottom_id)
assert top["version"] == 2 and top["kind"] == "hitter"
by = lambda r: {a["key"]: a for a in r["attributes"]}
for key in ("rawPower", "gamePower", "batToBall", "swingDecisions", "speed"):
    assert by(top)[key]["pct"] > 80, (key, by(top)[key])
    assert by(bottom)[key]["pct"] < 20, (key, by(bottom)[key])
assert top["overall"]["pct"] > 90 > 10 > bottom["overall"]["pct"]
print("best and worst true talent land at the ends OK",
      top["overall"]["pct"], bottom["overall"]["pct"])

# Every shown number is a whole number inside its scale, with a band around it.
for r in (top, bottom, P.rate("2001")):
    for a in r["attributes"] + [r["overall"]]:
        if a["hidden"]:
            continue
        assert isinstance(a["pct"], int) and 1 <= a["pct"] <= 99, a
        assert a["grade"] % 5 == 0 and 20 <= a["grade"] <= 80, a
        assert a["lo"] <= a["pct"] <= a["hi"], a
        assert a["gradeLo"] <= a["grade"] <= a["gradeHi"], a
print("percentiles 1-99, grades 20-80, bands enclose the rating OK")

# The same card twice is the same card: bands are seeded per player.
assert H.rate(top_id) == top
print("ratings are deterministic OK")

# A call-up with 25 PA and no history gets far wider bands than a regular on
# everything that settles slowly...
cu = by(H.rate(CALLUP))
reg = by(H.rate(hitters[10]))
for key in ("consistency", "gamePower", "swingDecisions"):
    if not cu[key]["hidden"]:
        assert cu[key]["hi"] - cu[key]["lo"] > reg[key]["hi"] - reg[key]["lo"], key
# ...and a cup of coffee -- two PA, no history -- is hidden where the stat
# settles slowly, with the reason, rather than printed as a confident guess.
COFFEE = "1006"
tiny = season(2026, pa_of={COFFEE: 2})
for s in (prev1, prev2):
    s.batting.pop(COFFEE, None)
    s.batTracking.pop(COFFEE, None)
ratings._models.clear()
TH, _ = ratings._models_for(tiny, prev1, prev2)
cup = by(TH.rate(COFFEE))
assert cup["consistency"]["hidden"] == "Not enough data yet", cup["consistency"]
assert cup["swingDecisions"]["hidden"] == "Not enough data yet", cup["swingDecisions"]
assert TH.rate(COFFEE)["overall"]["hidden"] == "Not enough data yet"
prev1, prev2 = season(2025, skip={CALLUP}), season(2024, skip={CALLUP})
ratings._models.clear()
H, P = ratings._models_for(cur, prev1, prev2)
print("small samples get wide bands, and no-information ones are hidden OK")


# --- fielding is per position, and only for fielders -------------------------

ss = next(p for p in hitters if cur.fielding[p]["pos"] == "SS")
cf = next(p for p in hitters if cur.fielding[p]["pos"] == "CF")
assert {"range", "arm"} <= set(by(H.rate(ss))) and "jump" not in by(H.rate(ss))
assert {"range", "arm", "jump"} <= set(by(H.rate(cf)))
assert H.rate(ss)["role"] == "IF" and H.rate(cf)["role"] == "OF"
assert H.rate(ss)["headline"][-1] == "range"
# Range is ranked among shortstops, not the whole league.
assert H.attr_ladders["range"].get("SS") is not None
print("infield / outfield attributes, ranked within position OK")

catcher = H.rate("1280")
assert catcher["role"] == "C" and catcher["position"] == "C"
assert {"framing", "blocking", "throwing"} <= set(by(catcher))
assert "range" not in by(catcher)
assert catcher["headline"][-1] == "framing"
print("catchers get framing, blocking and throwing OK")

dh = H.rate("1250")
assert dh["role"] == "DH"
assert not any(a["group"] == "fielding" for a in dh["attributes"])
assert dh["overall"]["pct"] is not None, "a DH still gets an overall from what he has"
assert dh["headline"][-1] == "swingDecisions"
print("a DH has no fielding attributes and still gets an overall OK")

# A bench player, 80 PA and 60 defensive outs: his glove is shown as not
# rateable, and not counted.
thin = by(H.rate("1239"))
assert thin["range"]["hidden"] == "Not enough innings in the field", thin["range"]
assert H._low_glove("1239")
print("fewer than FIELDING_SHOW_OUTS outs: fielding hidden and uncounted OK")

# The Yordan Alvarez case: a full-time bat who plays some left field. Under
# DH_OUTS_PER_PA defensive outs per PA he is a DH, not a bad left fielder.
yordan = "1003"
cur.frv[yordan]["outs"] = 400            # 550 PA, 400 outs: 0.7 per PA
ratings._models.clear()
YH, _ = ratings._models_for(cur, prev1, prev2)
y = YH.rate(yordan)
assert y["role"] == "DH" and y["position"] is None, (y["role"], y["position"])
assert not any(a["group"] == "fielding" for a in y["attributes"])
cur.frv[yordan]["outs"] = 3000
ratings._models.clear()
H, P = ratings._models_for(cur, prev1, prev2)
print("a bat who rarely fields is a DH, not a poor fielder OK")


# --- overall is the value layer, anchored on xwOBA ----------------------------

# Give a mid-table hitter an elite xwOBA and nothing else: his overall must
# follow the xwOBA, because that is what his bat is worth.
lopsided = sorted(hitters, key=TALENT.get)[len(hitters) // 2]
odd = season(2026, pa_of={CALLUP: 25})
for s in (odd, prev1, prev2):
    s.batting[lopsided]["xwoba"] = 0.420
ratings._models.clear()
OH, _ = ratings._models_for(odd, prev1, prev2)
o = OH.rate(lopsided)
assert o["overall"]["pct"] > 85, o["overall"]
assert by(o)["gamePower"]["pct"] < 80, "the slices did not change, only the anchor"
for s in (prev1, prev2):     # leave the shared priors as they were
    s.batting[lopsided]["xwoba"] = season(s.season, skip={CALLUP}).batting[lopsided]["xwoba"]
ratings._models.clear()
print("overall follows xwOBA, not the average of the slices OK", o["overall"]["pct"])


# --- pitchers ----------------------------------------------------------------

pitchers = [p for p in TALENT if p.startswith("2")]
ptop, pbottom = best_and_worst(pitchers)
H, P = ratings._models_for(cur, prev1, prev2)
pt, pb = P.rate(ptop), P.rate(pbottom)
assert pt["kind"] == "pitcher" and pt["role"] == "P"
assert set(pt["headline"]) == {"stuff", "batMissing", "command", "contactManagement"}
for key in ("velocity", "stuff", "batMissing"):
    assert by(pt)[key]["pct"] > 80 and by(pb)[key]["pct"] < 20, key
assert pt["overall"]["pct"] > 85 > 15 > pb["overall"]["pct"]
assert ("Starter" in pt["tags"]) != ("Reliever" in pt["tags"])
print("pitcher attributes and overall order by true talent OK",
      pt["overall"]["pct"], pb["overall"]["pct"])

# Stuff is the trained model: on the same pitcher, a harder fastball with more
# ride must come out better (fewer runs per 100), and a changeup that looks
# like his fastball but arrives much slower must beat one thrown nearly as hard.
import stuff_model  # noqa: E402

base = {"FF": {"velo": 94, "breakX": 7, "ivb": 15, "pitches": 1000}}
better = {"FF": {"velo": 98, "breakX": 7, "ivb": 19, "pitches": 1000}}
assert stuff_model.arsenal_stuff(better, 45)[0] < stuff_model.arsenal_stuff(base, 45)[0]
fb = {"velo": 96, "breakX": 8, "ivb": 17, "pitches": 1000}
slow_ch = {"FF": fb, "CH": {"velo": 85, "breakX": 15, "ivb": 6, "pitches": 400}}
hard_ch = {"FF": fb, "CH": {"velo": 92, "breakX": 15, "ivb": 6, "pitches": 400}}
assert stuff_model.run_value("CH", 85, 15, 6, 45, -11, 7, -11) < stuff_model.run_value("CH", 92, 15, 6, 45, -4, 7, -11)
assert stuff_model.arsenal_stuff(slow_ch, 45)[0] < stuff_model.arsenal_stuff(hard_ch, 45)[0]
# The board's unsigned break is put back on the right side by type.
assert stuff_model.ARM_SIDE >= {"FF", "SI", "CH"} and "SL" not in stuff_model.ARM_SIDE
assert stuff_model.run_value("KC", 82, 5, -12, 45) == stuff_model.run_value("CU", 82, 5, -12, 45)
print("stuff: velocity, ride and fastball separation move it the right way OK")

assert H.rate("999999") is None and P.rate("999999") is None
print("players with no data return None OK")


# --- similar players -----------------------------------------------------------

import copy  # noqa: E402

ratings._models.clear()
H, P = ratings._models_for(cur, prev1, prev2)
target = hitters[40]
sims = H.similar(target)
assert len(sims) == ratings.SIMILAR_COUNT, len(sims)
assert all(str(s["id"]) != target for s in sims), "a player is never his own match"
assert [s["similarity"] for s in sims] == sorted((s["similarity"] for s in sims), reverse=True)
assert all(s["name"] and 0 <= s["similarity"] <= 100 for s in sims)
assert all(len(s["alike"]) == 3 and s["differs"]["key"] for s in sims)
assert all(str(s["id"]).startswith("1") for s in sims), "hitters only match hitters"
assert all(str(s["id"]).startswith("2") for s in P.similar("2010")), "pitchers only match pitchers"
print("similar: five, sorted, never himself, never across hitter/pitcher OK")

# A planted twin -- the same player under another id in every season, every
# board -- must be the closest match, and very close.
TWIN = "1999"
for s in (cur, prev1, prev2):
    for board in ("batting", "batTracking", "running", "baserunning", "fielding", "frv", "arm", "jump"):
        rows = getattr(s, board)
        if target in rows:
            rows[TWIN] = copy.deepcopy(rows[target])
ratings._models.clear()
H, P = ratings._models_for(cur, prev1, prev2)
first = H.similar(target)[0]
assert str(first["id"]) == TWIN, first
assert first["similarity"] >= 95, first
print(f"a planted twin is the top match ({first['similarity']}) OK")
for s in (cur, prev1, prev2):
    for board in ("batting", "batTracking", "running", "baserunning", "fielding", "frv", "arm", "jump"):
        getattr(s, board).pop(TWIN, None)

# Option 1: a DH can match anyone, but only on what they share -- the bat and
# the legs. Fielders matched with each other may also share the glove.
ratings._models.clear()
H, P = ratings._models_for(cur, prev1, prev2)
hit_and_run = {a.key for a in ratings.HITTER_ATTRIBUTES if a.group != "fielding"}
dh_vec = H._vector("1250")[0]
for s in H.similar("1250"):
    dist, dims = H._distance(dh_vec, H._similarity_index()["vectors"][str(s["id"])], False)
    assert set(dims) <= hit_and_run, dims
ss_vec = H._vector(ss)[0]
cf_vec = H._vector(cf)[0]
_, dims = H._distance(ss_vec, cf_vec, H._role(ss) == H._role(cf))
assert not {"range", "arm", "jump"} & set(dims), "fielding is only compared within a role"
print("fielding compared only within a role; a DH is matched on the bat OK")

# Correlated attributes share their weight: duplicating a dimension's signal in
# two perfectly correlated attributes must not double its pull.
m = [[1.0, 0.99], [0.99, 1.0]]
inv = ratings._invert([[m[i][j] + (ratings.SIM_RIDGE if i == j else 0) for j in range(2)] for i in range(2)])
d = [1.0, 1.0]
mahal = sum(d[i] * inv[i][j] * d[j] for i in range(2) for j in range(2))
assert mahal < 1.2, f"two copies of one gap counted as {mahal:.2f}, not ~1"
print("Mahalanobis distance counts a duplicated skill about once OK", round(mahal, 2))


# --- profile(): a Savant outage costs the ratings, never the card ------------

def explode(_year):
    raise RuntimeError("savant unreachable")


original_season, original_history = statcast.season, statcast.history
try:
    statcast.season = explode
    payload = ratings.profile(1000, is_pitcher=False, season_year=2026)
    assert payload["ratings"] is None and payload["statcast"] is None
    assert payload["ratingsNote"], "an outage must explain itself"
    assert ratings.summaries({"1000": False}, 2026) == {"1000": None}

    statcast.season = lambda year: (cur, 0.0)
    statcast.history = lambda year: {2025: prev1, 2024: prev2}.get(year)
    ratings._models.clear()
    payload = ratings.profile(int(top_id), is_pitcher=False, season_year=2026)
    assert payload["ratings"]["overall"]["pct"] == top["overall"]["pct"]
    assert payload["ratings"]["priorSeasons"] == [2025, 2024]
    assert len(payload["ratings"]["similar"]) == ratings.SIMILAR_COUNT
    # The matches belong to that card: the shared rate() must not pick them up.
    assert "similar" not in ratings._models[2026][1].rate(top_id)

    # Search results show the numbers the card will show, for hitters and
    # pitchers alike, and a player with no data is None rather than an error.
    got = ratings.summaries({top_id: False, ptop: True, "999999": False}, 2026)
    assert got[top_id]["overall"]["pct"] == top["overall"]["pct"], got[top_id]
    best_attr = max((a for a in top["attributes"] if a["pct"] is not None), key=lambda a: a["pct"])
    assert got[top_id]["top"]["pct"] == best_attr["pct"]
    assert got[ptop]["overall"]["pct"] == pt["overall"]["pct"], got[ptop]
    assert got["999999"] is None

    # The Players page shows the numbers the card will show, and keeps "hidden"
    # (too little data) apart from "not rated at his position".
    board = ratings.player_board(
        [{"id": top_id, "name": "Top", "team": "SEA", "pos": "SS", "bats": "R", "throws": "R"},
         {"id": ptop, "name": "Ace", "team": "SEA", "pos": "P", "bats": "R", "throws": "R"},
         {"id": "999999", "name": "Nobody", "team": "SEA", "pos": "SS", "bats": "L", "throws": "R"}],
        2026)
    row = board["players"][0]
    assert row["kind"] == "hitter" and row["ovr"] == [top["overall"]["pct"], top["overall"]["grade"]]
    keys = [a["key"] for a in board["attributes"]["hitter"]]
    assert len(row["r"]) == len(keys), "one entry per attribute, in the listed order"
    for attr in top["attributes"]:
        entry = row["r"][keys.index(attr["key"])]
        assert entry == ([attr["pct"], attr["grade"]] if attr["pct"] is not None else None), attr["key"]
    rated = {a["key"] for a in top["attributes"]}
    assert all(row["r"][i] == 0 for i, k in enumerate(keys) if k not in rated), "not rated is 0"
    assert board["players"][1]["kind"] == "pitcher"
    assert board["players"][1]["ovr"] == [pt["overall"]["pct"], pt["overall"]["grade"]]
    nobody = board["players"][2]
    assert nobody["ovr"] is None and nobody["r"] == [], "no data still lists him, unrated"
    assert ratings.playing_time(2026) == {}, "nothing in the Savant cache here, and it must not fetch"
    payload = ratings.profile(999999, is_pitcher=True, season_year=2026)
    assert payload["ratings"] is None and "No 2026" in payload["ratingsNote"]

    # Priors unavailable: still rated, shrinking toward the league instead.
    statcast.history = lambda year: None
    ratings._models.clear()
    assert ratings.summaries({top_id: False}, 2026)[top_id]["overall"]["pct"] is not None
    payload = ratings.profile(int(top_id), is_pitcher=False, season_year=2026)
    assert payload["ratings"]["priorSeasons"] == []
    assert payload["ratings"]["overall"]["pct"] is not None
finally:
    statcast.season, statcast.history = original_season, original_history
    ratings._models.clear()
print("profile() survives outages and missing history, and explains itself OK")


# --- the positional adjustment ------------------------------------------------
class _Season:
    def __init__(self, batting, frv):
        self.batting, self.frv = batting, frv


full = ratings.SEASON_PA
model = ratings.HitterModel.__new__(ratings.HitterModel)
model._positions = {}
model.prev = (None, None)
model.sc = _Season(
    {"ss": {"pa": full}, "util": {"pa": full}, "half": {"pa": full}, "dh": {"pa": full},
     "c": {"pa": full // 2}, "old": {"pa": 0}},
    {"ss": {"outsByPos": {"SS": ratings.SEASON_OUTS}},
     "util": {"outsByPos": {"SS": ratings.SEASON_OUTS / 2, "RF": ratings.SEASON_OUTS / 2}},
     "half": {"outsByPos": {"1B": ratings.SEASON_OUTS / 2}},
     "c": {"outsByPos": {"C": ratings.SEASON_OUTS / 2}}})
model.prev = (_Season({"old": {"pa": 400}}, {"old": {"outsByPos": {"CF": ratings.OUTS_PER_PA * 400}}}), None)
near = lambda a, b: abs(a - b) < 1e-9  # noqa: E731
assert near(model.position_runs("ss"), 7.5), "a full-time shortstop gets the shortstop's"
assert near(model.position_runs("util"), (7.5 - 7.5) / 2), "split by where he played"
assert near(model.position_runs("half"), (-12.5 - 17.5) / 2), "the time he did not field is DH time"
assert near(model.position_runs("dh"), -17.5), "no outs at all is a DH"
assert near(model.position_runs("c"), 12.5 * ratings.CATCHER_GAMES / 162),     "half a season, all of it behind the plate: a catcher, on a catcher's workload"
assert near(model.position_runs("old"), 2.5), "no PA this season: where he played last season"
print("the positional adjustment is prorated by defensive outs, with the rest as DH OK")

# --- overall is Bat + Defense + Legs, in runs ---------------------------------
model.mu = {"xwoba": {None: 0.310}}
model._bat_runs_sd = 16.0
v = model.value_parts("ss", 0.310 + 0.031, 15 / ratings.SEASON_OUTS * 1000, 50)
assert near(v["bat"], 0.031 * ratings.SEASON_PA / ratings.WOBA_SCALE), v
assert near(v["fielding"], 15.0) and near(v["position"], 7.5) and near(v["defense"], 22.5), v
assert abs(v["legs"]) < 1e-9, "an average runner adds nothing"
elite = model.value_parts("dh", 0.430, None, 50)["bat"]
great = model.value_parts("dh", 0.390, None, 50)["bat"]
assert near(elite - great, 0.040 * ratings.SEASON_PA / ratings.WOBA_SCALE), \
    "no ceiling: the best bat keeps all of its lead"
dh = model.value_parts("dh", 0.310, None, 50)
assert near(dh["fielding"], 0) and near(dh["defense"], -17.5), "a DH: an average glove, charged by position"
# The same fielding runs are worth the same at any position; the position is
# what differs, and it does not touch the bat.
c = model.value_parts("c", 0.350, 10 / ratings.SEASON_OUTS * 1000, 50)
first = model.value_parts("half", 0.350, 10 / ratings.SEASON_OUTS * 1000, 50)
assert near(c["bat"], first["bat"]) and c["defense"] > first["defense"]
# A catcher's glove counts over a catcher's season, not 162 games behind the plate.
assert near(c["fielding"], 10.0 * ratings.CATCHER_GAMES / 162), c
ss = model.value_parts("ss", 0.350, 10 / ratings.SEASON_OUTS * 1000, 50)
assert near(ss["fielding"], 10.0), "every other position keeps the full season"
half = model.value_parts("half", 0.310, 10 / ratings.SEASON_OUTS * 1000, 50)
assert near(half["fielding"], 5.0), "half a season in the field: half a season of glove"
model.kind = "hitter"
raw = model._overall_raw("ss", {}, 50.0, {"xwoba": 0.341, "fieldRuns": 15 / ratings.SEASON_OUTS * 1000})
v = model.value_parts("ss", 0.341, 15 / ratings.SEASON_OUTS * 1000, None)
assert near(raw, ratings.BAT_WEIGHT * v["bat"] + v["defense"] + v["legs"]), (raw, v)
assert ratings.BAT_WEIGHT > 1, "the bat leans a little: it is the more reliable skill"
print("overall is bat + defense + legs in runs, with no ceiling on the bat OK")

# --- team numbers: plain arithmetic on hand-made rows ------------------------
attrs = {"hitter": [{"key": "speed"}, {"key": "range"}], "pitcher": [{"key": "stuff"}]}


def _row(pid, team, kind, ovr, r):
    return {"id": pid, "team": team, "kind": kind, "ovr": ovr, "r": r}


rows = [
    _row("1", "SEA", "hitter", [80, 60], [[90, 65], None]),   # hidden Range: not counted
    _row("2", "SEA", "hitter", [40, 45], [[50, 50], [70, 55]]),
    _row("3", "SEA", "hitter", [99, 80], [[99, 80], [99, 80]]),  # never played: no weight
    _row("4", "SEA", "hitter", None, [[10, 30], 0]),          # no overall, still has a Speed
    _row("5", "SEA", "pitcher", [60, 55], [[70, 55]]),
    _row("6", "SEA", "pitcher", [20, 40], [[30, 45]]),
    _row("7", None, "hitter", [99, 80], [[99, 80], 0]),       # no club: in nobody's numbers
    _row("8", "TEX", "hitter", [50, 50], [[50, 50], 0]),      # no pitchers: no Overall
]
played = {"1": 300, "2": 100, "4": 100, "5": 150, "6": 50, "7": 600, "8": 500}
got = ratings.team_numbers(rows, played, attrs)
assert set(got) == {"SEA", "TEX"}, got
sea = got["SEA"]
assert sea["hitting"] == [70.0, 56.2], sea["hitting"]    # (80*300 + 40*100) / 400
assert sea["pitching"] == [50.0, 51.2], sea["pitching"]  # (60*150 + 20*50) / 200
assert sea["overall"] == [60.0, 53.7], sea["overall"]    # the two halves, evenly
assert sea["hitters"] == 2 and sea["pitchers"] == 2, "only rated players who have played"
# Speed: (90*300 + 50*100 + 10*100) / 500. Range: only the one who has it showing.
assert sea["ratings"]["speed"] == [66.0, 55.0, 3], sea["ratings"]["speed"]
assert sea["ratings"]["range"] == [70.0, 55.0, 1], sea["ratings"]["range"]
assert sea["ratings"]["stuff"] == [60.0, 52.5, 2], sea["ratings"]["stuff"]
assert got["TEX"]["hitting"] == [50.0, 50.0] and got["TEX"]["overall"] is None
print("team numbers are weighted by playing time and average the two halves OK")

# --- who plays for whom ------------------------------------------------------
teams = {136: {"abbreviation": "SEA"}, 147: {"abbreviation": "NYY"}}
people = [
    {"id": 1, "fullName": "Stays", "currentTeam": {"id": 136}, "primaryPosition": {"abbreviation": "C"},
     "batSide": {"code": "S"}, "pitchHand": {"code": "R"}},
    {"id": 2, "fullName": "Sent down", "currentTeam": {"id": 136}, "primaryPosition": {"abbreviation": "P"}},
    {"id": 3, "fullName": "Moved", "currentTeam": {"id": 136}},
    {"id": 4, "fullName": "Unlisted", "currentTeam": {"id": 136}},
]
got = projection.board_rows(people, teams, {"1": 136, "2": 531, "3": 147})
assert [r["team"] for r in got] == ["SEA", None, "NYY", None], "the card's club, not the season list's"
assert got[0]["bats"] == "S" and got[0]["throws"] == "R" and got[0]["pos"] == "C"
assert got[1]["bats"] is None
assert [r["team"] for r in projection.board_rows(people, teams, None)] == ["SEA"] * 4
print("a player's club comes from his own record, as on his card OK")

# --- the Players page's build: off the request thread, one at a time ----------
import gzip  # noqa: E402
import json  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402

import app  # noqa: E402

release = threading.Event()
builds = []


def _slow_build(season):
    builds.append(season)
    if not release.wait(5):
        raise AssertionError("never released")
    if len(builds) == 2:
        raise RuntimeError("Savant is down")
    return {"season": season, "players": ["é"]}


def _settle(board, season):
    for _ in range(200):
        with board._lock:
            if season not in board._running:
                return
        time.sleep(0.01)
    raise AssertionError("the build never finished")


original_build = app._build_player_board
app._build_player_board = _slow_build
try:
    board = app.PlayerBoard()
    assert board.get(2026) is None, "the first request is told to come back, not made to wait"
    assert board.get(2026) is None and not board.failed(2026)
    release.set()
    _settle(board, 2026)
    assert builds == [2026], "two requests, one build"
    plain, packed = board.get(2026)
    assert json.loads(plain) == {"season": 2026, "players": ["é"]}
    assert gzip.decompress(packed) == plain

    # Past its time, the old copy is served while a new one is built. When that
    # build fails, the old copy stays: a Savant outage must not empty the page.
    with board._lock:
        at, *rest = board._built[2026]
        board._built[2026] = (at - app.BOARD_TTL - 1, *rest)
    release.clear()
    assert board.get(2026) == (plain, packed)
    release.set()
    _settle(board, 2026)
    assert builds == [2026, 2026]
    assert board.get(2026) == (plain, packed) and not board.failed(2026)

    # Nothing to fall back on: say so, and do not retry on every request.
    builds[:] = [2025]
    assert board.get(2025) is None
    _settle(board, 2025)
    assert board.failed(2025)
    assert board.get(2025) is None and builds == [2025, 2025], "waits before trying again"
finally:
    app._build_player_board = original_build
print("the Players page builds in the background and keeps its last good copy OK")

print("\nAll assertions passed.")
