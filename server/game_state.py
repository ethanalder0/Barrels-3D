"""State extractor.

Turns a GUMBO feed snapshot into a list of *new* flat event dicts -- one per
previously-unseen pitch, plus one per newly-completed at-bat. The poller keeps
two "seen" sets across polls so we never emit the same thing twice, which is
what lets us fetch the whole feed each time yet only surface what changed.

Two emit shapes:
  {"type": "pitch",       ...}   one per pitch (carries hit data when in play)
  {"type": "play_result", ...}   one per completed at-bat
"""

from __future__ import annotations


# --- small field pluckers (all None-safe) -----------------------------------

def _player_name(play: dict, side: str) -> str | None:
    return (play.get("matchup", {}) or {}).get(side, {}).get("fullName")


def _count(event: dict, play: dict) -> dict:
    c = event.get("count") or play.get("count") or {}
    return {"balls": c.get("balls"), "strikes": c.get("strikes"), "outs": c.get("outs")}


def _pitch(event: dict) -> dict:
    details = event.get("details", {}) or {}
    ptype = details.get("type", {}) or {}
    return {
        "type": ptype.get("description"),          # "Slider"
        "code": ptype.get("code"),                 # "SL"
        "speed": (event.get("pitchData", {}) or {}).get("startSpeed"),  # mph
        "call": (details.get("call", {}) or {}).get("description"),
        "description": details.get("description"),
    }


def _hit(event: dict) -> dict | None:
    hd = event.get("hitData")
    if not hd:
        return None
    coords = hd.get("coordinates", {}) or {}
    return {
        "launch_speed": hd.get("launchSpeed"),
        "launch_angle": hd.get("launchAngle"),
        "total_distance": hd.get("totalDistance"),
        "trajectory": hd.get("trajectory"),
        "coordinates": {"x": coords.get("coordX"), "y": coords.get("coordY")},
    }


def _runners(linescore: dict) -> dict:
    off = (linescore or {}).get("offense", {}) or {}

    def nm(base: str) -> str | None:
        p = off.get(base)
        return p.get("fullName") if isinstance(p, dict) else None

    return {"first": nm("first"), "second": nm("second"), "third": nm("third")}


def _score(linescore: dict) -> dict:
    teams = (linescore or {}).get("teams", {}) or {}
    return {"away": teams.get("away", {}).get("runs"),
            "home": teams.get("home", {}).get("runs")}


def _half_inning(play: dict) -> tuple[str | None, int | None]:
    about = play.get("about", {}) or {}
    return about.get("halfInning"), about.get("inning")


# --- play merging -----------------------------------------------------------

def _merged_plays(plays: dict) -> dict:
    """Key plays by atBatIndex. currentPlay overrides allPlays for its index.

    Polling every 10-15s means several plays can complete between polls, so we
    reconcile allPlays (completed) with currentPlay (in progress) rather than
    trusting either alone.
    """
    merged: dict[int, dict] = {}
    for p in plays.get("allPlays", []) or []:
        idx = p.get("atBatIndex")
        if idx is not None:
            merged[idx] = p
    cur = plays.get("currentPlay")
    if cur and cur.get("atBatIndex") is not None:
        merged[cur["atBatIndex"]] = cur
    return merged


# --- the one function the poller calls --------------------------------------

def extract_new_events(feed: dict, game_pk: int,
                       seen_events: set, seen_results: set) -> list[dict]:
    """Return new event dicts and mark them seen (mutates the two sets).

    seen_events  : {(at_bat_index, event_index), ...}
    seen_results : {at_bat_index, ...}
    """
    live = feed.get("liveData", {}) or {}
    linescore = live.get("linescore", {}) or {}

    runners = _runners(linescore)
    score = _score(linescore)

    out: list[dict] = []
    merged = _merged_plays(live.get("plays", {}) or {})

    for ab_index in sorted(merged):
        play = merged[ab_index]
        half, inning = _half_inning(play)
        batter = _player_name(play, "batter")
        pitcher = _player_name(play, "pitcher")

        for event in play.get("playEvents", []) or []:
            e_index = event.get("index")
            if e_index is None:
                continue
            key = (ab_index, e_index)
            if key in seen_events:
                continue
            seen_events.add(key)

            # Non-pitch actions (mound visits, pickoffs, subs) are marked seen
            # but not emitted into the pitch stream.
            if not (event.get("isPitch") or event.get("type") == "pitch"):
                continue

            out.append({
                "type": "pitch",
                "game_pk": game_pk,
                "inning": inning,
                "half": half,
                "at_bat_index": ab_index,
                "event_index": e_index,
                "count": _count(event, play),
                "batter": batter,
                "pitcher": pitcher,
                "pitch": _pitch(event),
                "hit": _hit(event),
                "runners": runners,
                "score": score,
            })

        about = play.get("about", {}) or {}
        result = play.get("result", {}) or {}
        if about.get("isComplete") and result.get("event") and ab_index not in seen_results:
            seen_results.add(ab_index)
            out.append({
                "type": "play_result",
                "game_pk": game_pk,
                "inning": inning,
                "half": half,
                "at_bat_index": ab_index,
                "event": result.get("event"),           # "Home Run"
                "description": result.get("description"),
                "rbi": result.get("rbi"),
                "batter": batter,
                "pitcher": pitcher,
                "count": play.get("count", {}),
                "runners": runners,
                "score": score,
            })

    return out
