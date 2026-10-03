"""Per-pitch Statcast for one game, from Baseball Savant's game feed.

The statsapi live feed (GUMBO) carries pitch speed, exit velocity and distance,
but not bat speed or spin rate. Savant's `/gf` endpoint -- the one behind its
own game pages -- has both, per pitch, and updates while the game is on.

Every Savant row carries the same play_id GUMBO does, and `ab_number` /
`pitch_number` line up with GUMBO's `atBatIndex + 1` / `pitchNumber` (checked
276 of 276 on a full game). So nothing here needs names or teams: each value is
keyed to the at-bat and pitch it belongs to, and the UI joins it onto the
at-bats it already has. That is what lets a game-leader row open the replay of
the swing it is ranking.
"""

from __future__ import annotations

import mlb_api

URL = "https://baseballsavant.mlb.com/gf"


def _num(value):
    """Savant mixes numbers and numeric strings ("91.0") in the same feed."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def pitches(game_pk: int) -> list[dict]:
    """[{ab, n, batSpeed, spinRate}], one row per pitch that has either value.

    `ab` is GUMBO's atBatIndex (0-based), `n` the pitch number within it.
    """
    resp = mlb_api.session().get(URL, params={"game_pk": game_pk}, timeout=mlb_api.TIMEOUT)
    resp.raise_for_status()
    payload = resp.json()

    seen: set[str] = set()
    out: list[dict] = []
    # team_home / team_away split the game's pitches by side; together they are
    # every pitch. play_id guards against a pitch appearing in both.
    for row in (payload.get("team_home") or []) + (payload.get("team_away") or []):
        play_id = row.get("play_id")
        if play_id in seen:
            continue
        seen.add(play_id)

        ab = row.get("ab_number")
        n = row.get("pitch_number")
        if ab is None or n is None:
            continue
        bat_speed = _num(row.get("batSpeed"))
        spin = _num(row.get("spin_rate"))
        if bat_speed is None and spin is None:
            continue
        out.append({"ab": int(ab) - 1, "n": int(n), "batSpeed": bat_speed, "spinRate": spin})
    return out
