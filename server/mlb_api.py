"""Thin HTTP client for the MLB Stats API.

Vendored from the live_score prototype and extended for the web backend:
  - get_schedule() takes a hydrate list (we need team abbreviations + linescore)
  - get_live_feed() takes an optional timecode (historical snapshot / replay mode)
  - get_timestamps() lists a game's snapshot timecodes

No auth required. This module knows nothing about baseball semantics -- it just
fetches JSON.
"""

from __future__ import annotations

import threading

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE = "https://statsapi.mlb.com/api"
TIMEOUT = 10  # seconds per request

# statsapi drops connections now and then (WinError 10054). With the default
# adapter that is max_retries=0, so a single blip surfaced as a 502 and the
# scoreboard vanished from the UI until the next poll. Retry transient failures
# with backoff instead: 0.4s, 0.8s, 1.6s.
RETRY = Retry(
    total=3,
    connect=3,
    read=3,
    status=3,
    backoff_factor=0.4,
    status_forcelist=(429, 500, 502, 503, 504),
    allowed_methods=frozenset(["GET"]),   # every call here is a GET
    raise_on_status=False,
)

# One Session per thread. requests.Session is not thread-safe, and this server
# runs a poll thread per game feed plus a thread per HTTP request, all of which
# were previously sharing one Session and one 10-connection pool.
_local = threading.local()


def session() -> requests.Session:
    """The calling thread's Session, created on first use."""
    existing = getattr(_local, "session", None)
    if existing is not None:
        return existing

    s = requests.Session()
    s.headers.update({"User-Agent": "barrels-3d/0.1"})
    adapter = HTTPAdapter(max_retries=RETRY, pool_connections=4, pool_maxsize=4)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    _local.session = s
    return s

# Without hydration the schedule payload omits team abbreviations, which the
# scoreboard needs, and the linescore, which lets us show inning/count without
# fetching a full feed per game.
SCHEDULE_HYDRATE = "team,linescore"


def get_schedule(date_str: str, hydrate: str | None = SCHEDULE_HYDRATE) -> dict:
    """Return the raw schedule payload for a YYYY-MM-DD date (MLB, sportId=1)."""
    url = f"{BASE}/v1/schedule"
    params = {"sportId": 1, "date": date_str}
    if hydrate:
        params["hydrate"] = hydrate
    resp = session().get(url, params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def get_live_feed(game_pk: int, timecode: str | None = None) -> dict:
    """Return the GUMBO live feed for a game.

    With `timecode` (YYYYMMDD_HHMMSS) the API returns the feed *as of* that
    moment instead of the latest state -- which is how replay mode re-runs a
    finished game as though it were happening now.
    """
    url = f"{BASE}/v1.1/game/{game_pk}/feed/live"
    params = {"timecode": timecode} if timecode else None
    resp = session().get(url, params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def get_timestamps(game_pk: int) -> list[str]:
    """Every snapshot timecode recorded for a game, oldest first."""
    url = f"{BASE}/v1.1/game/{game_pk}/feed/live/timestamps"
    resp = session().get(url, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def get_sabermetrics(group: str, sort_stat: str, season: int, limit: int = 10) -> list[dict]:
    """Season sabermetric leaders for one stat.

    `stats=sabermetrics` is a different beast from the leagueLeaders endpoint:
    it is the only place statsapi exposes WAR, wOBA and wRC+ for hitters and
    WAR, FIP, xFIP and ERA- for pitchers. The plain leader categories top out at
    OPS and WHIP.

    Two behaviours worth knowing, both checked against the live API rather than
    assumed:

      * `sortStat` does NOT sort consistently. `war` and `eraMinus` come back
        descending while `fip` and `xfip` come back ascending, so for a
        lower-is-better stat like ERA- the "leaders" are the worst qualified
        pitchers. leaders.py re-sorts by each stat's own polarity; do not rely
        on the order this returns.
      * The pool is already qualified. A 200-row request returns 54 pitchers,
        every one of them 135+ innings, so there is no risk of a two-inning
        reliever topping a rate leaderboard.
    """
    url = f"{BASE}/v1/stats"
    params = {
        "stats": "sabermetrics",
        "group": group,
        "season": season,
        "sportId": 1,
        "limit": limit,
        "sortStat": sort_stat,
    }
    resp = session().get(url, params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    stats = resp.json().get("stats") or []
    return (stats[0].get("splits") if stats else []) or []


def get_teams(season: int | None = None) -> dict:
    """Team id -> team record. The stats splits name a team but omit its
    abbreviation, which is what the UI keys logos and colours off."""
    url = f"{BASE}/v1/teams"
    params = {"sportId": 1}
    if season:
        params["season"] = season
    resp = session().get(url, params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    return {t["id"]: t for t in resp.json().get("teams", [])}


def get_person(person_id: int, season: int) -> dict | None:
    """One player with their season line, for the player card.

    The box score already carries everyone in the current game; this covers
    everyone else -- a league leader tapped from the home page, for instance.
    """
    url = f"{BASE}/v1/people/{person_id}"
    params = {
        "hydrate": f"stats(group=[hitting,pitching],type=[season],season={season}),currentTeam",
    }
    resp = session().get(url, params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    people = resp.json().get("people") or []
    return people[0] if people else None
