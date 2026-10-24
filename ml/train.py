"""Train and evaluate the batted-ball outcome model.

    python ml/train.py            # cross-validate on 2023-25, write ml/reports/
    python ml/train.py --final    # also: refit on 2023-25, score 2026 once

Predicts, for a ball in play, the probability of each of five outcomes: out,
single, double, triple, home run (xOut%, x1B%, x2B%, x3B%, xHR%). The derived
xBA is the four hit probabilities summed.

VALIDATION. Leave-one-season-out over 2023, 2024 and 2025: train on two
seasons, score the third, three times. Splitting by season keeps games, parks
and weeks from leaking between train and test, and the three scores give a
mean and a spread rather than one number. Two of the folds train on a later
season than they test on; for the physics of a batted ball that matters little,
but it is not how the model is used, so 2026 stays untouched as a forward test
and is only scored with --final, once a model has been chosen.

MODELS, simplest first, so every number has something to be compared against:

    prior     league outcome rates, ignoring the ball entirely: the floor
    bins      outcome rates in exit-velocity x launch-angle cells, roughly how
              Savant's own xBA is built
    logistic  multinomial logistic regression on polynomial terms
    lgbm      gradient-boosted trees (LightGBM), the main model

INPUTS: exit velocity, launch angle, pulled spray angle, batter side. Bunts are
left out (a different skill). hit_distance_sc is never an input: it is measured
partly from where the ball ended up and so gives the result away. Savant's xBA
is never an input either; it is the benchmark.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import PolynomialFeatures, StandardScaler

ML = Path(__file__).resolve().parent
DATA = ML / "data" / "bip.parquet"
REPORTS = ML / "reports"
MODELS = ML / "models"

CLASSES = ["out", "1B", "2B", "3B", "HR"]
HITS = slice(1, 5)  # columns of the probability matrix that are hits
CV_SEASONS = [2023, 2024, 2025]
TEST_SEASON = 2026
FEATURES = ["launch_speed", "launch_angle", "spray_pull", "bats_left"]
SEED = 7

LGBM_PARAMS = {
    "objective": "multiclass",
    "num_class": len(CLASSES),
    "learning_rate": 0.05,
    "num_leaves": 63,
    "min_data_in_leaf": 200,
    "lambda_l2": 1.0,
    "verbosity": -1,
    "seed": SEED,
}
MAX_ROUNDS = 3000
EARLY_STOP = 100


# --- data ---------------------------------------------------------------------

def load() -> pd.DataFrame:
    bip = pd.read_parquet(DATA)
    bip = bip[~bip["is_bunt"]].copy()
    bip["bats_left"] = (bip["stand"] == "L").astype(np.int8)
    bip["y"] = pd.Categorical(bip["outcome"], categories=CLASSES).codes.astype(np.int8)
    return bip.reset_index(drop=True)


# --- models -------------------------------------------------------------------
# Each takes (train, fit_rows) and returns a function: frame -> (n, 5) probs.

def fit_prior(train: pd.DataFrame):
    rates = np.bincount(train["y"], minlength=len(CLASSES)) / len(train)
    return lambda df: np.tile(rates, (len(df), 1))


EV_EDGES = np.arange(30, 125, 2.0)  # mph
LA_EDGES = np.arange(-90, 92, 2.0)  # degrees
BIN_SMOOTHING = 20  # pseudo-balls of the league rates mixed into every cell


def fit_bins(train: pd.DataFrame):
    """Outcome rates per 2 mph x 2 degree cell, shrunk toward league rates.

    The shrinkage is what keeps a cell with three balls in it from predicting
    a 0% or 100% anything: each cell starts with BIN_SMOOTHING balls' worth of
    the league mix and its own balls move it from there.
    """
    prior = np.bincount(train["y"], minlength=len(CLASSES)) / len(train)
    width = len(LA_EDGES) + 1  # np.digitize returns 0..len(edges)
    cell = lambda df: np.digitize(df["launch_speed"], EV_EDGES) * width + np.digitize(
        df["launch_angle"], LA_EDGES
    )
    counts = np.zeros(((len(EV_EDGES) + 1) * width, len(CLASSES)))
    np.add.at(counts, (cell(train), train["y"].to_numpy()), 1)
    table = counts + BIN_SMOOTHING * prior
    table /= table.sum(axis=1, keepdims=True)
    return lambda df: table[cell(df)]


def _logit_matrix(df: pd.DataFrame) -> np.ndarray:
    # Spray is missing for ~0.04% of balls: fill with dead center and say so.
    spray = df["spray_pull"].fillna(0.0).to_numpy()
    return np.column_stack(
        [df["launch_speed"], df["launch_angle"], spray, df["bats_left"], df["spray_pull"].isna()]
    ).astype(float)


def fit_logistic(train: pd.DataFrame):
    """Multinomial logistic regression on degree-4 polynomial terms.

    A straight logistic fit cannot bend the way launch angle does (outs at 50
    degrees and at -10, hits in between), so the inputs get polynomial terms.
    """
    model = make_pipeline(
        StandardScaler(),
        PolynomialFeatures(degree=4, include_bias=False),
        StandardScaler(),
        LogisticRegression(max_iter=400, C=1.0),
    )
    model.fit(_logit_matrix(train), train["y"])
    return lambda df: model.predict_proba(_logit_matrix(df))


def fit_lgbm(train: pd.DataFrame, rounds: int | None = None):
    """LightGBM multiclass. Early-stopped on a held-out tenth of the training
    games (never the test season), unless `rounds` is given (the final refit).
    """
    if rounds is None:
        rng = np.random.default_rng(SEED)
        games = train["game_pk"].unique()
        held = set(rng.choice(games, size=len(games) // 10, replace=False))
        mask = train["game_pk"].isin(held).to_numpy()
        fit, stop = train[~mask], train[mask]
        booster = lgb.train(
            LGBM_PARAMS,
            lgb.Dataset(fit[FEATURES], fit["y"]),
            num_boost_round=MAX_ROUNDS,
            valid_sets=[lgb.Dataset(stop[FEATURES], stop["y"])],
            callbacks=[lgb.early_stopping(EARLY_STOP, verbose=False)],
        )
    else:
        booster = lgb.train(LGBM_PARAMS, lgb.Dataset(train[FEATURES], train["y"]), num_boost_round=rounds)
    predict = lambda df: booster.predict(df[FEATURES], num_iteration=booster.best_iteration or None)
    predict.booster = booster
    return predict


MODELS_TO_RUN = {
    "prior": fit_prior,
    "bins": fit_bins,
    "logistic": fit_logistic,
    "lgbm": fit_lgbm,
}


# --- metrics ------------------------------------------------------------------

def binary_log_loss(y_hit: np.ndarray, p_hit: np.ndarray) -> float:
    p = np.clip(p_hit, 1e-6, 1 - 1e-6)
    return float(-np.mean(y_hit * np.log(p) + (1 - y_hit) * np.log(1 - p)))


def score(y: np.ndarray, probs: np.ndarray, savant_xba: np.ndarray) -> dict:
    onehot = np.eye(len(CLASSES))[y]
    y_hit = (y > 0).astype(float)
    p_hit = probs[:, HITS].sum(axis=1)
    out = {
        "log_loss": float(log_loss(y, probs, labels=range(len(CLASSES)))),
        "brier": float(np.mean(np.sum((probs - onehot) ** 2, axis=1))),
        "hit_log_loss": binary_log_loss(y_hit, p_hit),
    }
    # Predicted vs actual count per outcome: 1.00 means the model expects as
    # many doubles (say) as there were.
    for i, c in enumerate(CLASSES):
        out[f"ratio_{c}"] = float(probs[:, i].sum() / max(onehot[:, i].sum(), 1))
    # The head-to-head with Savant, on the balls Savant has an xBA for.
    has = ~np.isnan(savant_xba)
    out["hit_log_loss_ours_vs_savant_rows"] = binary_log_loss(y_hit[has], p_hit[has])
    out["hit_log_loss_savant"] = binary_log_loss(y_hit[has], savant_xba[has])
    return out


def calibration_table(y: np.ndarray, probs: np.ndarray, bins: int = 15) -> list[dict]:
    """Per class: mean predicted vs observed rate in equal-count bins."""
    rows = []
    for i, c in enumerate(CLASSES):
        p = probs[:, i]
        order = np.argsort(p)
        for chunk in np.array_split(order, bins):
            rows.append(
                {"class": c, "predicted": float(p[chunk].mean()), "observed": float((y[chunk] == i).mean()), "n": len(chunk)}
            )
    return rows


def plot_calibration(table: list[dict], path: Path, title: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    df = pd.DataFrame(table)
    fig, axes = plt.subplots(1, len(CLASSES), figsize=(4 * len(CLASSES), 4))
    for ax, c in zip(axes, CLASSES):
        d = df[df["class"] == c]
        top = max(d["predicted"].max(), d["observed"].max()) * 1.05
        ax.plot([0, top], [0, top], color="#999", lw=1, ls="--")
        ax.plot(d["predicted"], d["observed"], marker="o", color="#c23a22")
        ax.set_title(c)
        ax.set_xlabel("predicted")
        ax.set_xlim(0, top)
        ax.set_ylim(0, top)
    axes[0].set_ylabel("observed")
    fig.suptitle(title)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


# --- cross-validation ----------------------------------------------------------

def cross_validate(bip: pd.DataFrame) -> dict:
    folds = []
    oof = {name: np.zeros((len(bip), len(CLASSES))) for name in MODELS_TO_RUN}
    in_cv = bip["season"].isin(CV_SEASONS).to_numpy()
    best_rounds = []

    for test_season in CV_SEASONS:
        train_seasons = [s for s in CV_SEASONS if s != test_season]
        train = bip[bip["season"].isin(train_seasons)]
        test_mask = (bip["season"] == test_season).to_numpy()
        test = bip[test_mask]
        print(f"\nfold: train {train_seasons} ({len(train):,})  test {test_season} ({len(test):,})")

        for name, fit in MODELS_TO_RUN.items():
            t0 = time.time()
            predict = fit(train)
            probs = predict(test)
            oof[name][test_mask] = probs
            s = score(test["y"].to_numpy(), probs, test["estimated_ba_using_speedangle"].to_numpy(float))
            s.update({"model": name, "test_season": test_season, "seconds": round(time.time() - t0, 1)})
            if name == "lgbm":
                s["rounds"] = predict.booster.best_iteration
                best_rounds.append(predict.booster.best_iteration)
            folds.append(s)
            print(f"  {name:<9} log loss {s['log_loss']:.4f}  brier {s['brier']:.4f}  "
                  f"hit LL {s['hit_log_loss']:.4f}  ({s['seconds']}s)")

    folds_df = pd.DataFrame(folds)
    summary = summarize(folds_df)

    cv = bip[in_cv]
    for name in MODELS_TO_RUN:
        if name in ("lgbm", "logistic"):
            table = calibration_table(cv["y"].to_numpy(), oof[name][in_cv])
            plot_calibration(table, REPORTS / f"calibration_{name}_cv.png",
                             f"{name}: out-of-fold calibration, 2023-25")
    return {"folds": folds_df, "summary": summary, "best_rounds": best_rounds}


def summarize(folds: pd.DataFrame) -> pd.DataFrame:
    metrics = [c for c in folds.columns if c not in ("model", "test_season", "seconds", "rounds")]
    agg = folds.groupby("model", sort=False)[metrics].agg(["mean", "std"])
    return agg


def print_summary(summary: pd.DataFrame) -> None:
    print("\ncross-validated, mean ± std over the three seasons")
    cols = ["log_loss", "brier", "hit_log_loss"]
    print(f"  {'model':<9} " + "  ".join(f"{c:>20}" for c in cols))
    for model, row in summary.iterrows():
        cells = "  ".join(f"{row[(c, 'mean')]:.4f} ± {row[(c, 'std')]:.4f}".rjust(20) for c in cols)
        print(f"  {model:<9} {cells}")

    print("\npredicted ÷ actual count per outcome (1.00 is perfect), mean over folds")
    print(f"  {'model':<9} " + "  ".join(f"{c:>6}" for c in CLASSES))
    for model, row in summary.iterrows():
        print(f"  {model:<9} " + "  ".join(f"{row[(f'ratio_{c}', 'mean')]:6.3f}" for c in CLASSES))

    print("\nhit / no-hit log loss on the balls Savant scores (lower is better)")
    savant = summary[("hit_log_loss_savant", "mean")].iloc[0]
    print(f"  {'savant xBA':<11} {savant:.4f}")
    for model, row in summary.iterrows():
        print(f"  {model:<11} {row[('hit_log_loss_ours_vs_savant_rows', 'mean')]:.4f}")


# --- the one-time forward test ------------------------------------------------------

def final_test(bip: pd.DataFrame, rounds: int) -> dict:
    train = bip[bip["season"].isin(CV_SEASONS)]
    test = bip[bip["season"] == TEST_SEASON]
    print(f"\nfinal: refit lgbm on 2023-25 ({len(train):,}) for {rounds} rounds, "
          f"score {TEST_SEASON} ({len(test):,})")
    predict = fit_lgbm(train, rounds=rounds)
    probs = predict(test)
    s = score(test["y"].to_numpy(), probs, test["estimated_ba_using_speedangle"].to_numpy(float))
    plot_calibration(calibration_table(test["y"].to_numpy(), probs),
                     REPORTS / "calibration_lgbm_2026.png", f"lgbm: calibration on {TEST_SEASON}")
    MODELS.mkdir(parents=True, exist_ok=True)
    predict.booster.save_model(str(MODELS / "outcome_lgbm.txt"))
    for k in ("log_loss", "brier", "hit_log_loss", "hit_log_loss_ours_vs_savant_rows", "hit_log_loss_savant"):
        print(f"  {k:<34} {s[k]:.4f}")
    print("  predicted ÷ actual: " + "  ".join(f"{c} {s[f'ratio_{c}']:.3f}" for c in CLASSES))
    return s


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--final", action="store_true", help=f"also refit and score {TEST_SEASON} once")
    args = ap.parse_args()

    REPORTS.mkdir(parents=True, exist_ok=True)
    bip = load()
    print(f"{len(bip):,} balls in play (bunts excluded), seasons {sorted(bip['season'].unique())}")

    cv = cross_validate(bip)
    print_summary(cv["summary"])
    cv["folds"].to_csv(REPORTS / "cv_folds.csv", index=False)
    rounds = int(np.mean(cv["best_rounds"]))
    report = {
        "features": FEATURES,
        "classes": CLASSES,
        "cv_seasons": CV_SEASONS,
        "lgbm_params": LGBM_PARAMS,
        "lgbm_rounds_per_fold": cv["best_rounds"],
        "summary": {
            model: {f"{m}_{stat}": float(v) for (m, stat), v in row.items()}
            for model, row in cv["summary"].iterrows()
        },
    }
    if args.final:
        report["final_test"] = {"season": TEST_SEASON, "rounds": rounds, **final_test(bip, rounds)}
    (REPORTS / "metrics.json").write_text(json.dumps(report, indent=2))
    print(f"\nwrote {REPORTS.relative_to(ML.parent)}/metrics.json, cv_folds.csv and calibration plots")
    return 0


if __name__ == "__main__":
    sys.exit(main())
