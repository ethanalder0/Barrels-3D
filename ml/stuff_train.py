"""Train and evaluate the Stuff model: what a pitch is worth from its physics alone.

    python ml/stuff_train.py            # fit on 2023-24, choose on 2025, write ml/reports/
    python ml/stuff_train.py --final    # also: refit on 2023-25, score 2026 once, save the model

Predicts each pitch's expected run value (Savant's delta_run_exp, batting side's
view: lower is better for the pitcher) from its speed, shape and release, and
the same against the pitcher's own primary fastball. A pitcher-pitch's Stuff is
the mean of those predictions over his pitches of that type; a pitcher's is
the usage-weighted mean over his arsenal. Location is never an input -- that is
command.

MODELS, simplest first, so every number has something to compare against:

    mean        the league's average run value for the pitch type: the floor
    velo        velocity and pitch type only
    movement    the card's current Movement idea, rebuilt from pitch data:
                break against the average pitch of the type, direction set by hand
    live        LightGBM on what the server can recompute from Savant's season
                boards: velocity, horizontal and induced vertical break, arm
                angle, and the gaps to his own primary fastball
    full        live plus extension, spin and release point -- in the pitch
                data, on no season board, so not shippable today; it measures
                what leaving them out costs

VALIDATION is at the level the card uses, not per pitch (a single pitch's run
value is almost pure noise):

    same season   correlation of a pitcher-pitch's Stuff with its own run value
                  per 100 and whiff rate, 200+ pitches
    next season   correlation of Stuff in season S with ACTUAL run value in
                  S+1, against the same for actual run value in S. This is the
                  point of a stuff model: it should know next year better than
                  this year's results do, because results are noisy and physics
                  is not.
    pitcher       the same two, usage-weighted per pitcher, 1000+ pitches

2026 stays untouched until --final, as in train.py.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

ML = Path(__file__).resolve().parent
DATA = ML / "data" / "stuff.parquet"
REPORTS = ML / "reports"
MODELS = ML / "models"

FIT, CHOOSE, TEST = [2023, 2024], 2025, 2026
LIVE = ["pitch_type", "velo", "hb", "ivb", "arm_angle", "velo_gap", "hb_gap", "ivb_gap"]
FULL = LIVE + ["extension", "spin", "rel_side", "rel_height"]
SEED = 7
PARAMS = {
    "objective": "regression",
    "learning_rate": 0.05,
    "num_leaves": 63,
    # A pitch's run value is mostly noise; leaves need thousands of pitches
    # before their mean says anything.
    "min_data_in_leaf": 2000,
    "lambda_l2": 5.0,
    "feature_fraction": 0.9,
    "verbosity": -1,
    "seed": SEED,
}
MAX_ROUNDS, EARLY_STOP = 4000, 150
MIN_PITCH_TYPE, MIN_PITCHER = 200, 1000

# The card's hand-set Movement directions, (horizontal, vertical), vertical +
# meaning more ride -- copied from server/ratings.py MOVEMENT_AXES after the
# sign fix, so the baseline is the formula the card actually ships.
MOVEMENT_AXES = {
    "FF": (0.3, 0.7), "SI": (0.6, -0.4), "FC": (0.5, 0.5), "SL": (0.6, -0.4),
    "ST": (0.8, -0.2), "SV": (0.5, -0.5), "CU": (0.3, -0.7),
    "CH": (0.5, -0.5), "FS": (0.4, -0.6),
}
NAMES = ["Cease", "Skubal", "Misiorowski", "Schlittler", "Skenes", "Sale", "Crochet",
         "Hader", "Duran", "Webb", "Valdez", "Gausman"]


# --- models: each returns a function frame -> predicted run value per pitch ----

def fit_mean(train):
    by = train.groupby("pitch_type", observed=True)["rv"].mean()
    return lambda df: df["pitch_type"].map(by).astype(float).to_numpy()


def fit_lgbm(train, choose, features, rounds=None):
    ds = lgb.Dataset(train[features], train["rv"], categorical_feature=["pitch_type"], free_raw_data=False)
    if rounds is None:
        val = lgb.Dataset(choose[features], choose["rv"], reference=ds)
        booster = lgb.train(PARAMS, ds, MAX_ROUNDS, valid_sets=[val],
                            callbacks=[lgb.early_stopping(EARLY_STOP, verbose=False)])
    else:
        booster = lgb.train(PARAMS, ds, rounds)
    return booster


def fit_movement(train):
    """Break against the type's league average, in league SDs, on the card's axes.

    Higher is better, so it is negated to sit on the run-value scale (lower
    better) with everything else; only its ranking matters for correlation.
    """
    stats = train.groupby("pitch_type", observed=True)[["hb", "ivb"]].agg(["mean", "std"])

    def predict(df):
        t = df["pitch_type"].astype(str)
        mh = t.map(stats[("hb", "mean")]).astype(float); sh = t.map(stats[("hb", "std")]).astype(float)
        mv = t.map(stats[("ivb", "mean")]).astype(float); sv = t.map(stats[("ivb", "std")]).astype(float)
        wx = t.map({k: v[0] for k, v in MOVEMENT_AXES.items()}).astype(float)
        wz = t.map({k: v[1] for k, v in MOVEMENT_AXES.items()}).astype(float)
        # Horizontal "more break" is distance from zero in the pitch's own direction.
        more_h = (df["hb"].abs() - mh.abs()) / sh
        more_v = (df["ivb"] - mv) / sv
        return -(wx * more_h + wz * more_v).to_numpy()
    return predict


# --- evaluation --------------------------------------------------------------

def aggregate(df, pred):
    d = df.assign(pred=pred)
    g = d.groupby(["season", "pitcher", "pitch_type"], observed=True).agg(
        name=("name", "first"), n=("rv", "size"), rv=("rv", "mean"), stuff=("pred", "mean"),
        whiffs=("whiff", "sum"), swings=("swing", "sum"),
    ).reset_index()
    g["whiff_pct"] = g["whiffs"] / g["swings"].replace(0, np.nan)
    for c in ("rv", "stuff"):
        g[c] *= 100   # per 100 pitches
    return g


def by_pitcher(g):
    p = g.assign(w_rv=g["rv"] * g["n"], w_stuff=g["stuff"] * g["n"]).groupby(
        ["season", "pitcher"]).agg(name=("name", "first"), n=("n", "sum"), w_rv=("w_rv", "sum"),
                                    w_stuff=("w_stuff", "sum"), whiffs=("whiffs", "sum"),
                                    swings=("swings", "sum")).reset_index()
    p["rv"] = p["w_rv"] / p["n"]
    p["stuff"] = p["w_stuff"] / p["n"]
    p["whiff_pct"] = p["whiffs"] / p["swings"].replace(0, np.nan)
    return p


def corr(a, b):
    m = a.notna() & b.notna()
    return round(float(np.corrcoef(a[m], b[m])[0, 1]), 3) if m.sum() > 10 else None


def evaluate(g, season):
    """Signs flipped where needed so that every number reads 'higher = Stuff agrees'."""
    pt = g[(g["season"] == season) & (g["n"] >= MIN_PITCH_TYPE)]
    out = {
        "pitch_rv": corr(-pt["stuff"], -pt["rv"]),
        "pitch_whiff": corr(-pt["stuff"], pt["whiff_pct"]),
    }
    nxt = g[(g["season"] == season + 1) & (g["n"] >= MIN_PITCH_TYPE)]
    pair = pt.merge(nxt, on=["pitcher", "pitch_type"], suffixes=("", "_next"))
    out["pitch_next_rv_from_stuff"] = corr(-pair["stuff"], -pair["rv_next"])
    out["pitch_next_rv_from_rv"] = corr(-pair["rv"], -pair["rv_next"])
    out["pitch_next_whiff_from_stuff"] = corr(-pair["stuff"], pair["whiff_pct_next"])
    out["pitch_pairs"] = len(pair)

    p = by_pitcher(g)
    ps = p[(p["season"] == season) & (p["n"] >= MIN_PITCHER)]
    out["pitcher_rv"] = corr(-ps["stuff"], -ps["rv"])
    out["pitcher_whiff"] = corr(-ps["stuff"], ps["whiff_pct"])
    pn = p[(p["season"] == season + 1) & (p["n"] >= MIN_PITCHER)]
    pp = ps.merge(pn, on="pitcher", suffixes=("", "_next"))
    out["pitcher_next_rv_from_stuff"] = corr(-pp["stuff"], -pp["rv_next"])
    out["pitcher_next_rv_from_rv"] = corr(-pp["rv"], -pp["rv_next"])
    out["pitcher_pairs"] = len(pp)
    return out


def percentiles(g, season, names):
    p = by_pitcher(g)
    p = p[(p["season"] == season) & (p["n"] >= MIN_PITCHER)].copy()
    p["pct"] = (-p["stuff"]).rank(pct=True) * 100
    rows = {}
    for n in names:
        hit = p[p["name"].str.contains(n, case=False, na=False)]
        if len(hit):
            rows[hit.iloc[0]["name"]] = round(float(hit.iloc[0]["pct"]))
    return rows


def run(df, fit_seasons, eval_season, final_rounds=None):
    train = df[df["season"].isin(fit_seasons)]
    choose = df[df["season"] == CHOOSE]
    scored = df[df["season"].isin([eval_season, eval_season + 1])] if eval_season + 1 in df["season"].unique() \
        else df[df["season"] == eval_season]
    models, report, pcts, rounds = {}, {}, {}, {}
    models["mean"] = fit_mean(train)
    models["movement"] = fit_movement(train)
    for name, feats in (("velo", ["pitch_type", "velo"]), ("live", LIVE), ("full", FULL)):
        booster = fit_lgbm(train, choose, feats, (final_rounds or {}).get(name))
        rounds[name] = booster.best_iteration or booster.current_iteration()
        models[name] = (lambda b, f: lambda d: b.predict(d[f], num_iteration=b.best_iteration or None))(booster, feats)
        if name == "live":
            models["_live_booster"] = booster
    for name, predict in models.items():
        if name.startswith("_"):
            continue
        g = aggregate(scored, predict(scored))
        report[name] = evaluate(g, eval_season)
        pcts[name] = percentiles(g, eval_season, NAMES)
    return report, pcts, rounds, models


def fidelity(df, models, season):
    """The server will only have season AVERAGES per pitch type. How close is the
    model run on those averages to the mean of its per-pitch predictions?"""
    d = df[df["season"] == season]
    booster = models["_live_booster"]
    per_pitch = aggregate(d, booster.predict(d[LIVE], num_iteration=booster.best_iteration or None))
    means = d.groupby(["pitcher", "pitch_type"], observed=True)[LIVE[1:]].mean().reset_index()
    means = means.merge(per_pitch[["pitcher", "pitch_type", "stuff", "n"]], on=["pitcher", "pitch_type"])
    means = means[means["n"] >= MIN_PITCH_TYPE]
    at_mean = booster.predict(means[LIVE], num_iteration=booster.best_iteration or None) * 100
    return corr(pd.Series(at_mean), means["stuff"].reset_index(drop=True))


def print_table(report, title):
    cols = ["pitch_rv", "pitch_whiff", "pitch_next_rv_from_stuff", "pitch_next_rv_from_rv",
            "pitcher_rv", "pitcher_whiff", "pitcher_next_rv_from_stuff", "pitcher_next_rv_from_rv"]
    heads = ["pitch RV", "pitch whiff", "pitch next RV", "(RV->next)", "pitcher RV",
             "pitcher whiff", "pitcher next RV", "(RV->next)"]
    print(f"\n{title}")
    print("   " + f"{'model':10}" + "".join(f"{h:>15}" for h in heads))
    for name, r in report.items():
        print("   " + f"{name:10}" + "".join(f"{str(r.get(c)):>15}" for c in cols))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--final", action="store_true")
    args = parser.parse_args()
    df = pd.read_parquet(DATA)
    REPORTS.mkdir(exist_ok=True)

    report, pcts, rounds, models = run(df, FIT, CHOOSE)
    print_table(report, f"fit {FIT}, evaluated on {CHOOSE} (next season = {CHOOSE + 1})")
    print("   rounds chosen on", CHOOSE, rounds)
    print(f"   live model on season averages vs mean of per-pitch predictions: r = {fidelity(df, models, CHOOSE)}")
    out = {"choose": {"report": report, "percentiles": pcts, "rounds": rounds}}

    if args.final:
        final, fpcts, _, fmodels = run(df, FIT + [CHOOSE], TEST, final_rounds=rounds)
        print_table(final, f"FINAL: refit {FIT + [CHOOSE]}, scored once on {TEST}")
        print(f"   live model on season averages vs per-pitch mean: r = {fidelity(df, fmodels, TEST)}")
        out["final"] = {"report": final, "percentiles": fpcts}
        MODELS.mkdir(exist_ok=True)
        fmodels["_live_booster"].save_model(str(MODELS / "stuff_lgbm.txt"))
        print(f"   saved {MODELS.relative_to(ML.parent) / 'stuff_lgbm.txt'}")
        print("\n   named pitchers, Stuff percentile among 1000+ pitch arms in", TEST)
        for name in ("movement", "live", "full"):
            print(f"   {name:9} " + "  ".join(f"{k.split(',')[0]} {v}" for k, v in fpcts[name].items()))

    (REPORTS / "stuff_metrics.json").write_text(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
