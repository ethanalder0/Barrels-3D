"""Live smoke test for the projection + poller layer.

selftest.py checks the event extractor offline. This one hits the real API and
asserts the things that actually broke during development, so they stay fixed:

  * schedule start times format (the %-I strftime bug is glibc-only)
  * a Preview game reports no live state (the hydrated schedule lies about it)
  * game_advisory pseudo-plays stay out of the at-bat list
  * every field the replay engine needs survives the projection
  * a finished GameFeed is replaced rather than reused in a terminal state

    python smoketest.py
"""

from __future__ import annotations

import sys
import time
from datetime import datetime, timedelta

import feed_hub
import mlb_api
import projection


def check(label: str, condition: bool, detail: str = "") -> bool:
    mark = "ok  " if condition else "FAIL"
    print(f"  [{mark}] {label}{f' — {detail}' if detail else ''}")
    return condition


def find_completed_game() -> int | None:
    """Walk back a few days for a Final game to project against."""
    for delta in range(1, 8):
        date = (datetime.now().astimezone() - timedelta(days=delta)).strftime("%Y-%m-%d")
        payload = mlb_api.get_schedule(date)
        for game in projection.scoreboard(payload):
            if game["status"] == "final":
                return game["gamePk"]
    return None


def main() -> int:
    failures = 0
    today = datetime.now().astimezone().strftime("%Y-%m-%d")

    print(f"\nscoreboard {today}")
    games = projection.scoreboard(mlb_api.get_schedule(today))
    failures += not check("schedule returns games", bool(games), f"{len(games)} games")

    if games:
        starts = [g["startsAt"] for g in games]
        failures += not check("start times formatted, not TBD",
                              all(s != "TBD" for s in starts), starts[0])
        failures += not check("abbreviations hydrated",
                              all(g["away"]["abbr"] != "?" for g in games),
                              f"{games[0]['away']['abbr']}@{games[0]['home']['abbr']}")
        preview = [g for g in games if g["status"] == "scheduled"]
        if preview:
            failures += not check("scheduled games carry no live state",
                                  all(g["state"] is None for g in preview),
                                  f"{len(preview)} scheduled")

    game_pk = find_completed_game()
    if game_pk is None:
        print("\nno completed game found in the last week — skipping projection checks")
        return failures

    print(f"\nsnapshot projection (gamePk {game_pk})")
    snap = projection.snapshot(mlb_api.get_live_feed(game_pk))

    failures += not check("game identity", bool(snap["game"]["away"]["abbr"]),
                          f"{snap['game']['away']['abbr']} @ {snap['game']['home']['abbr']}")
    failures += not check("line score has 9+ innings", len(snap["lineScore"]["innings"]) >= 9)
    failures += not check("run totals present",
                          snap["lineScore"]["totals"]["home"]["r"] is not None,
                          f"{snap['lineScore']['totals']['away']['r']}-"
                          f"{snap['lineScore']['totals']['home']['r']}")
    failures += not check("at-bats projected", len(snap["atBats"]) > 20,
                          f"{len(snap['atBats'])} at-bats")
    failures += not check("no game_advisory rows",
                          not any(a["eventType"] == "game_advisory" for a in snap["atBats"]))
    failures += not check("box score populated",
                          len(snap["boxScore"]["home"]["batters"]) >= 9,
                          f"{len(snap['boxScore']['home']['batters'])} batters")
    failures += not check("players carry season stats",
                          any(p["season"]["avg"] not in (None, "—") for p in snap["players"].values()),
                          f"{len(snap['players'])} players")
    failures += not check("pitchers flagged and given pitching stats",
                          any(p["isPitcher"] and p["seasonPitching"] for p in snap["players"].values()))

    # the replay engine's payload
    tracked = [a for a in snap["atBats"] if a["hasReplay"]]
    failures += not check("tracked batted balls present", bool(tracked),
                          f"{len(tracked)} of {len(snap['atBats'])}")
    if tracked:
        hit = tracked[0]["hit"]
        needed = ("launchSpeed", "launchAngle", "totalDistance", "trajectory")
        failures += not check("hit data complete",
                             all(hit.get(k) is not None for k in needed),
                             f"{hit['launchSpeed']} mph / {hit['launchAngle']}° / {hit['totalDistance']} ft")
        failures += not check("landing coordinates present",
                             hit["coordinates"]["x"] is not None,
                             f"({hit['coordinates']['x']}, {hit['coordinates']['y']})")
        last = tracked[0]["pitches"][-1] if tracked[0]["pitches"] else {}
        failures += not check("plate location + strike zone present",
                             last.get("plate", {}).get("z") is not None,
                             f"{last.get('type')} {last.get('velo')} mph")

    print("\nfeed lifecycle")
    hub = feed_hub.FeedHub()
    feed = hub.get(game_pk)
    q = feed.subscribe()
    kinds = []
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            kinds.append(q.get(timeout=5)["kind"])
        except Exception:
            break
        if "snapshot" in kinds and kinds.count("status") >= 2:
            break
    feed.unsubscribe(q)
    failures += not check("feed delivered a snapshot", "snapshot" in kinds, str(kinds[:6]))

    # A Final game's feed completes; the hub must hand out a fresh one next time
    # rather than a spent one parked in its terminal state.
    time.sleep(1.0)
    feed2 = hub.get(game_pk)
    failures += not check("completed feed is replaced, not reused", feed2 is not feed)
    hub.shutdown()

    print(f"\n{'all checks passed' if not failures else f'{failures} check(s) failed'}\n")
    return failures


if __name__ == "__main__":
    sys.exit(1 if main() else 0)
