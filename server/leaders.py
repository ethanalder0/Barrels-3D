"""League leaders in advanced statistics.

Deliberately sabermetric rather than the usual back-of-the-baseball-card set.
statsapi's `leagueLeaders` categories stop at OPS and WHIP; the `sabermetrics`
stat group is the only place it exposes the numbers below, and they are the ones
that actually describe a season:

  hitting
    WAR    wins above replacement -- one number for total value
    wRC+   park- and league-adjusted offence, 100 = league average
    wOBA   one weighted rate for everything a hitter does at the plate

  pitching
    WAR    same idea, pitcher side
    FIP    fielding independent pitching: strikeouts, walks and homers only,
           so the defence behind them is not credited or blamed
    ERA-   park- and league-adjusted run prevention, 100 = average, lower better

Values arrive as long floats (war 8.65609) and are formatted here rather than in
the UI, so the display rule for each stat lives next to its definition.
"""

from __future__ import annotations

import mlb_api

# id, label, the statsapi sortStat key, a one-line gloss, and how to render it.
CATEGORIES = {
    "hitting": [
        ("war", "WAR", "war", "Wins above replacement", "decimal1"),
        ("wrcPlus", "wRC+", "wRcPlus", "Park-adjusted offence, 100 = average", "integer"),
        ("woba", "wOBA", "woba", "Weighted on-base average", "rate3"),
    ],
    "pitching": [
        ("war", "WAR", "war", "Wins above replacement", "decimal1"),
        ("fip", "FIP", "fip", "Fielding independent pitching", "decimal2"),
        ("eraMinus", "ERA-", "eraMinus", "Park-adjusted run prevention, lower is better", "integer"),
    ],
}

GROUP_LABELS = {"hitting": "Hitting", "pitching": "Pitching"}

# Lower is better for these. This drives the actual sort (see _rows) as well as
# a note in the UI, so nobody reads the board upside down.
LOWER_IS_BETTER = {"fip", "eraMinus"}


def _format(value, style: str) -> str:
    if value is None:
        return "—"
    if style == "integer":
        return str(int(round(value)))
    if style == "decimal1":
        return f"{value:.1f}"
    if style == "decimal2":
        return f"{value:.2f}"
    if style == "rate3":
        # Baseball convention: .398, not 0.398.
        text = f"{value:.3f}"
        return text[1:] if text.startswith("0.") else text
    return str(value)


def _rows(splits: list[dict], stat_key: str, style: str, teams: dict,
          limit: int, lower_is_better: bool) -> list[dict]:
    """Sort by the stat's own polarity, then take the top `limit`.

    We do NOT trust the order statsapi returns. It is inconsistent between
    stats: `fip` and `xfip` come back ascending (best first) but `eraMinus`
    comes back descending, which silently produced an "ERA- leaders" board of
    131, 121, 111 -- the three *worst* qualified pitchers, since 100 is average
    and lower is better. Sorting here makes the direction explicit per stat.
    """
    scored = [(s, (s.get("stat") or {}).get(stat_key)) for s in splits]
    scored = [(s, v) for s, v in scored if v is not None]
    scored.sort(key=lambda pair: pair[1], reverse=not lower_is_better)

    rows = []
    for i, (split, value) in enumerate(scored[:limit]):
        player = split.get("player") or {}
        team_id = (split.get("team") or {}).get("id")
        team = teams.get(team_id) or {}
        rows.append({
            "rank": i + 1,
            "playerId": str(player.get("id") or ""),
            "name": player.get("fullName") or "?",
            "teamId": team_id,
            # The abbreviation is what the UI keys logos and colours off, and
            # the stats split does not carry it -- hence the teams lookup.
            "teamAbbr": team.get("abbreviation"),
            "teamName": team.get("teamName") or (split.get("team") or {}).get("name"),
            "value": round(value, 4),
            "display": _format(value, style),
        })
    return rows


def leaders(season: int, per_category: int = 5) -> dict:
    """Every configured category, ready to render."""
    teams = mlb_api.get_teams(season)

    groups = []
    for group_id, categories in CATEGORIES.items():
        built = []
        for cat_id, label, sort_stat, blurb, style in categories:
            lower = cat_id in LOWER_IS_BETTER
            # Pull the whole qualified pool (54 pitchers / 137 hitters) so the
            # sort below sees every candidate, not just the slice statsapi
            # happened to order first.
            splits = mlb_api.get_sabermetrics(group_id, sort_stat, season, limit=250)
            built.append({
                "id": cat_id,
                "label": label,
                "description": blurb,
                "lowerIsBetter": lower,
                "leaders": _rows(splits, sort_stat, style, teams, per_category, lower),
            })
        groups.append({"id": group_id, "label": GROUP_LABELS[group_id], "categories": built})

    return {"season": season, "groups": groups, "qualifiedOnly": True}
