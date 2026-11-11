"""Build the numbers behind the "How Overall works" page.

Rates every player with server/ratings.py, then lines the ratings up against
the season's results from MLB's stats API:

    Team Overall vs wins           Team Hitting vs runs scored
    Team Pitching vs runs allowed  hitter and pitcher Overall vs WAR

Output:
    src/data/ratingsReport.json    the points for each chart, each chart's best
                                   straight line, and the spread of each part
                                   of the hitter Overall

The page picks its outliers and quotes its numbers from this file, so a
rebuild is all a new season needs. WAR comes from statsapi's sabermetrics feed,
which covers qualified players only.

Rating the whole league takes a few minutes the first time (three seasons of
Savant boards, then 1,560 players).

    python scripts/build_ratings_report.py [--season 2026]
"""

from __future__ import annotations

import argparse
import json
import math
import statistics as st
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
sys.dont_write_bytecode = True

import app  # noqa: E402
import mlb_api  # noqa: E402
import projection  # noqa: E402
import ratings  # noqa: E402
import statcast  # noqa: E402

OUT = ROOT / "src" / "data" / "ratingsReport.json"

# Position groups for the hitter chart's check on positional bias.
POSITION_GROUPS = {"C": ("C",), "SS/CF": ("SS", "CF"), "2B/3B": ("2B", "3B"),
                   "LF/RF": ("LF", "RF"), "1B/DH": ("1B", "DH", "TWP")}


def pearson(xs, ys):
    mx, my = st.fmean(xs), st.fmean(ys)
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def fit(xs, ys) -> dict:
    """The best straight line, y = slope * x + intercept, and how well it fits."""
    mx, my = st.fmean(xs), st.fmean(ys)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    return {"n": len(xs), "r": round(pearson(xs, ys), 3),
            "slope": round(slope, 4), "intercept": round(my - slope * mx, 3)}


def get(path: str) -> dict:
    resp = mlb_api.session().get(f"{mlb_api.BASE}/v1{path}", timeout=mlb_api.TIMEOUT * 3)
    resp.raise_for_status()
    return resp.json()


def war_table(season: int, group: str) -> dict[str, dict]:
    splits = get(f"/stats?stats=sabermetrics&group={group}&season={season}&sportId=1&limit=300")
    return {str(s["player"]["id"]): {"name": s["player"].get("fullName"), "war": s["stat"].get("war")}
            for s in splits["stats"][0]["splits"] if s["stat"].get("war") is not None}


def standings(season: int, teams: dict) -> dict[str, dict]:
    out = {}
    payload = get(f"/standings?leagueId=103,104&season={season}&standingsTypes=regularSeason")
    for record in payload["records"]:
        for t in record["teamRecords"]:
            abbr = (teams.get(t["team"]["id"]) or {}).get("abbreviation")
            if abbr:
                out[abbr] = {"w": t["wins"], "l": t["losses"],
                             "rs": t.get("runsScored"), "ra": t.get("runsAllowed")}
    return out


def build(season: int) -> dict:
    sc, _ = statcast.season(season)
    hitters_model, pitchers_model = ratings._models_for(
        sc, statcast.history(season - 1), statcast.history(season - 2))

    # Every player on the club he is with now, as the site counts him.
    people = app._roster_people(season)
    teams = app._teams(season)
    rows = projection.board_rows(people, teams, mlb_api.get_current_teams([p["id"] for p in people]))
    board = ratings.player_board(rows, season)
    position = {row["id"]: row["pos"] for row in rows}

    # Clubs: Team Overall, Hitting and Pitching against the season's results.
    results = standings(season, teams)
    clubs = [{"team": t, "overall": v["overall"][0], "hitting": v["hitting"][0], "pitching": v["pitching"][0],
              **results[t]}
             for t, v in board["teams"].items() if v["overall"] and t in results]

    # A club's position players' Defense, weighted by playing time, for the
    # runs-allowed chart's note.
    played = ratings._time_played(sc)
    defense = {}
    for row in rows:
        if row["pos"] == "P" or not row["team"]:
            continue
        rated = hitters_model.rate(row["id"])
        weight = played.get(row["id"]) or 0
        if rated and rated.get("value") and weight > 0:
            defense.setdefault(row["team"], []).append((rated["value"]["defense"], weight))
    club_defense = {t: sum(v * w for v, w in xs) / sum(w for _, w in xs) for t, xs in defense.items()}

    # Qualified players: Overall against WAR.
    def players(group, model):
        out = []
        for pid, w in war_table(season, group).items():
            rated = model.rate(pid)
            pct = (rated or {}).get("overall", {}).get("pct")
            if pct is not None:
                out.append({"id": pid, "name": w["name"], "pos": position.get(pid), "overall": pct,
                            "war": round(w["war"], 1)})
        return out

    hitters = players("hitting", hitters_model)
    pitchers = players("pitching", pitchers_model)
    hitter_fit = fit([p["overall"] for p in hitters], [p["war"] for p in hitters])

    groups = {}
    for name, members in POSITION_GROUPS.items():
        res = [p["war"] - (hitter_fit["slope"] * p["overall"] + hitter_fit["intercept"])
               for p in hitters if p["pos"] in members]
        if res:
            groups[name] = {"n": len(res), "aboveLine": round(st.fmean(res), 2)}

    # The spread of each part of the hitter Overall, over every rated hitter.
    parts = {k: [] for k in ("bat", "defense", "fielding", "position", "legs")}
    for pid in hitters_model._overall_pool():
        rated = hitters_model.rate(pid)
        if rated and rated.get("value"):
            for k in parts:
                parts[k].append(rated["value"][k])

    return {
        "season": season,
        "built": date.today().isoformat(),
        "clubs": [{"team": c["team"], "overall": c["overall"], "hitting": c["hitting"],
                   "pitching": c["pitching"], "w": c["w"], "l": c["l"], "rs": c["rs"], "ra": c["ra"]}
                  for c in sorted(clubs, key=lambda c: c["team"])],
        "hitters": [{k: p[k] for k in ("name", "pos", "overall", "war")} for p in hitters],
        "pitchers": [{k: p[k] for k in ("name", "overall", "war")} for p in pitchers],
        "fits": {
            "wins": fit([c["overall"] for c in clubs], [c["w"] for c in clubs]),
            "runsScored": fit([c["hitting"] for c in clubs], [c["rs"] for c in clubs]),
            "runsAllowed": fit([c["pitching"] for c in clubs], [c["ra"] for c in clubs]),
            "hitters": hitter_fit,
            "pitchers": fit([p["overall"] for p in pitchers], [p["war"] for p in pitchers]),
        },
        "runDifferentialVsWins": round(pearson([c["rs"] - c["ra"] for c in clubs], [c["w"] for c in clubs]), 3),
        "defenseVsRunsAllowed": round(pearson([club_defense[c["team"]] for c in clubs if c["team"] in club_defense],
                                              [c["ra"] for c in clubs if c["team"] in club_defense]), 3),
        "positionGroups": groups,
        "hitterParts": {k: {"sd": round(st.pstdev(v), 1), "min": round(min(v), 1), "max": round(max(v), 1)}
                        for k, v in parts.items()},
        "ratedHitters": len(parts["bat"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--season", type=int, default=date.today().year)
    args = parser.parse_args()
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass
    report = build(args.season)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    fits = report["fits"]
    print(f"wrote {OUT.relative_to(ROOT)}: " + ", ".join(f"{k} r={v['r']}" for k, v in fits.items()))


if __name__ == "__main__":
    main()
