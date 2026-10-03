"""GUMBO -> frontend view models.

game_state.py answers "what just happened" (the event stream). This module
answers "what is true right now" (the snapshot the UI renders). Both read the
same feed; the poller emits both.

The shapes here deliberately mirror src/data/stubs.js field for field, so the
frontend renders live data and placeholder data through identical components and
can fall back to stubs when the backend isn't running.

Field paths were verified against real feeds (gamePk 822940) rather than assumed
-- including linescore.offense.{first,second,third}, which the prototype README
flagged as unconfirmed. Note that linescore.defense.{first,second,third} are
FIELDERS, not runners; only `offense` describes who is on base.
"""

from __future__ import annotations

from datetime import datetime

# result.eventType -> the `kind` the UI colour-codes on
_HIT_EVENTS = {"single", "double", "triple"}
_WALK_EVENTS = {"walk", "intent_walk", "hit_by_pitch", "catcher_interf"}
_K_EVENTS = {"strikeout", "strikeout_double_play", "strikeout_triple_play"}

_STATUS_MAP = {"Preview": "scheduled", "Live": "live", "Final": "final"}


# --- small helpers ----------------------------------------------------------

def _record(team: dict) -> str:
    rec = (team.get("record") or {}).get("leagueRecord") or team.get("leagueRecord") or {}
    wins, losses = rec.get("wins"), rec.get("losses")
    return f"{wins}-{losses}" if wins is not None and losses is not None else ""


def _local_time(iso_utc: str | None) -> str:
    """'2026-08-16T23:10:00Z' -> local '7:10 PM'.

    The prototype used strftime('%-I:%M %p'), which is glibc-only and raises on
    Windows -- every start time silently became 'TBD'. Strip the zero by hand
    instead so this works everywhere. The ISO string also goes out on the wire
    so the browser can format in the *viewer's* timezone.
    """
    if not iso_utc:
        return "TBD"
    try:
        dt = datetime.fromisoformat(iso_utc.replace("Z", "+00:00")).astimezone()
    except (ValueError, AttributeError):
        return "TBD"
    return dt.strftime("%I:%M %p").lstrip("0")


def _team_view(team: dict, runs=None) -> dict:
    return {
        "id": (team.get("abbreviation") or "").lower(),
        "abbr": team.get("abbreviation") or "?",
        "name": team.get("teamName") or team.get("name") or "?",
        "fullName": team.get("name") or "",
        "record": _record(team),
        "runs": runs,
    }


def _half(linescore: dict) -> str | None:
    state = (linescore.get("inningState") or linescore.get("inningHalf") or "").lower()
    if state.startswith("top"):
        return "top"
    if state.startswith("bot"):
        return "bottom"
    return "bottom" if linescore.get("isTopInning") is False else "top" if linescore.get("isTopInning") else None


def _base_runners(linescore: dict) -> dict:
    """Who is on base. Absent keys mean the base is empty."""
    off = linescore.get("offense") or {}

    def nm(base: str):
        p = off.get(base)
        return p.get("fullName") if isinstance(p, dict) else None

    return {"first": nm("first"), "second": nm("second"), "third": nm("third")}


def _id_str(value):
    """Person ids go out as strings — they key the frontend's player map."""
    return str(value) if value is not None else None


def _birthplace(bio: dict) -> str:
    """'Cordele, GA, USA' — state dropped for countries that do not use one."""
    parts = [bio.get("birthCity"), bio.get("birthStateProvince"), bio.get("birthCountry")]
    return ", ".join(p for p in parts if p)


def _num(v):
    """Numbers arrive as strings often enough to be worth normalising."""
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f.is_integer() else f


# --- scoreboard (schedule payload -> game list) -----------------------------

def scoreboard(schedule_payload: dict) -> list[dict]:
    """Flatten a schedule payload into the game-list shape the UI renders."""
    games: list[dict] = []
    for block in schedule_payload.get("dates", []) or []:
        for g in block.get("games", []) or []:
            teams = g.get("teams") or {}
            away_t = (teams.get("away") or {}).get("team") or {}
            home_t = (teams.get("home") or {}).get("team") or {}
            ls = g.get("linescore") or {}
            status = (g.get("status") or {}).get("abstractGameState")

            away = _team_view(away_t, (teams.get("away") or {}).get("score"))
            home = _team_view(home_t, (teams.get("home") or {}).get("score"))
            # Records live on the schedule's team wrapper, not the team object.
            away["record"] = _record(teams.get("away") or {}) or away["record"]
            home["record"] = _record(teams.get("home") or {}) or home["record"]

            # The hydrated schedule reports currentInning/inningState even for a
            # game hours from first pitch, which would have every upcoming card
            # claiming "Top 1 · 0 out". Only a live game has live state.
            state = None
            if status == "Live" and ls.get("currentInning") is not None:
                state = {
                    "inning": ls.get("currentInning"),
                    "half": _half(ls),
                    "inningState": ls.get("inningState"),
                    "scheduledInnings": ls.get("scheduledInnings") or 9,
                    "outs": ls.get("outs") or 0,
                    "balls": ls.get("balls") or 0,
                    "strikes": ls.get("strikes") or 0,
                }

            games.append({
                "id": str(g.get("gamePk")),
                "gamePk": g.get("gamePk"),
                "status": _STATUS_MAP.get(status, "scheduled"),
                "detailedStatus": (g.get("status") or {}).get("detailedState") or "",
                "startsAt": _local_time(g.get("gameDate")),
                "startsAtISO": g.get("gameDate"),
                "venue": (g.get("venue") or {}).get("name") or "",
                # "day" | "night", as MLB schedules it. The replay lights the
                # park to match unless Settings says otherwise.
                "dayNight": g.get("dayNight"),
                "away": away,
                "home": home,
                "state": state,
            })
    return games


# --- line score -------------------------------------------------------------

def _line_score(feed: dict, game_id: str) -> dict:
    ls = (feed.get("liveData") or {}).get("linescore") or {}
    scheduled = ls.get("scheduledInnings") or 9
    raw = ls.get("innings") or []

    innings = []
    for i in range(max(scheduled, len(raw))):
        entry = raw[i] if i < len(raw) else {}
        innings.append({
            "inning": entry.get("num", i + 1),
            "away": (entry.get("away") or {}).get("runs"),
            "home": (entry.get("home") or {}).get("runs"),
        })

    teams = ls.get("teams") or {}

    def totals(side: str) -> dict:
        t = teams.get(side) or {}
        return {"r": t.get("runs", 0), "h": t.get("hits", 0), "e": t.get("errors", 0)}

    return {"gameId": game_id, "innings": innings,
            "totals": {"away": totals("away"), "home": totals("home")}}


# --- box score --------------------------------------------------------------

def _batter_rows(side: dict) -> list[dict]:
    players = side.get("players") or {}
    # `battingOrder` is the current nine, `batters` is everyone who has appeared.
    # Lead with the order so the panel shows a full lineup from the first pitch
    # (0-for-0 rows and all) rather than filling in as players come to bat, then
    # append anyone who has appeared but is no longer in the order.
    order = side.get("battingOrder") or []
    appeared = side.get("batters") or []
    ids = list(order) + [pid for pid in appeared if pid not in order]

    rows = []
    seen = set()
    for pid in ids:
        if pid in seen:
            continue
        seen.add(pid)
        p = players.get(f"ID{pid}") or {}
        b = ((p.get("stats") or {}).get("batting")) or {}
        if not b:
            continue
        rows.append({
            "id": str(pid),
            "name": (p.get("person") or {}).get("fullName") or "?",
            "pos": (p.get("position") or {}).get("abbreviation") or "",
            "ab": b.get("atBats", 0),
            "r": b.get("runs", 0),
            "h": b.get("hits", 0),
            "rbi": b.get("rbi", 0),
            "bb": b.get("baseOnBalls", 0),
            "k": b.get("strikeOuts", 0),
            "avg": ((p.get("seasonStats") or {}).get("batting") or {}).get("avg", "—"),
        })
    return rows


def _pitcher_rows(side: dict) -> list[dict]:
    players = side.get("players") or {}
    rows = []
    for pid in side.get("pitchers") or []:
        p = players.get(f"ID{pid}") or {}
        s = ((p.get("stats") or {}).get("pitching")) or {}
        if not s:
            continue
        rows.append({
            "id": str(pid),
            "name": (p.get("person") or {}).get("fullName") or "?",
            "ip": s.get("inningsPitched", "0.0"),
            "h": s.get("hits", 0),
            "r": s.get("runs", 0),
            "er": s.get("earnedRuns", 0),
            "bb": s.get("baseOnBalls", 0),
            "k": s.get("strikeOuts", 0),
            "era": ((p.get("seasonStats") or {}).get("pitching") or {}).get("era", "—"),
        })
    return rows


def _box_score(feed: dict) -> dict:
    box = (feed.get("liveData") or {}).get("boxscore") or {}
    teams = box.get("teams") or {}
    out = {}
    for side in ("away", "home"):
        s = teams.get(side) or {}
        out[side] = {"batters": _batter_rows(s), "pitchers": _pitcher_rows(s)}
    return out


# --- at-bats ----------------------------------------------------------------

def _kind(result: dict) -> str:
    et = (result.get("eventType") or "").lower()
    if et == "home_run":
        return "hr"
    if et in _HIT_EVENTS:
        return "hit"
    if et in _WALK_EVENTS:
        return "bb"
    if et in _K_EVENTS:
        return "k"
    if result.get("isOut"):
        return "out"
    return "other"


# --- plate location ---------------------------------------------------------
#
# pX / pZ are the ball's position in FEET as it crosses the front of home plate.
# The sign convention was established empirically rather than assumed (see
# TEST 1/2 below), because getting it backwards silently mislabels every pitch:
#
#   * 9 of 9 hit-by-pitches to right-handed batters had pX < 0 (mean -2.00 ft).
#     A HBP is by definition on the batter's own side, and a RHB stands on the
#     third-base side -- so negative pX is the third-base side.
#   * GUMBO's own 3x3 `zone` grid agrees: zones 1/4/7 average pX -0.53 ft and
#     zones 3/6/9 average +0.51 ft.
#
# That is the catcher's view: looking out toward the mound, negative is to the
# left, and a right-handed batter stands to the left of the plate. Plotting pX
# straight onto a left-to-right axis therefore matches MLB's own zone numbering.
#
# The zone is always 17 inches wide (strikeZoneWidth is 17.0 in every pitch we
# have seen), so the half-width is 0.708 ft. Top and bottom are per batter, per
# pitch: 3.21 / 1.62 ft on average, ranging 2.95-3.54 and 1.49-1.79.

ZONE_HALF_WIDTH_FT = 17.0 / 2 / 12     # 0.708
BALL_RADIUS_FT = 2.9 / 2 / 12          # 0.121 -- a pitch is a strike if any part
                                       # of the ball clips the zone, which is why
                                       # called strikes reach |pX| ~ 0.83 ft
MIDDLE_BAND_FT = 0.25

# details.call.code -> what actually happened
_CALL_OUTCOMES = {
    "B": "ball", "*B": "ball", "I": "ball", "P": "ball", "V": "ball",
    "C": "called",
    "S": "swinging", "W": "swinging", "T": "swinging", "Q": "swinging", "M": "swinging",
    "F": "foul", "L": "foul", "R": "foul", "O": "foul",
    "X": "inplay", "D": "inplay", "E": "inplay",
    "H": "hbp",
}


def _plate_side(px, bat_side) -> str | None:
    """Inside / away relative to the batter (see the convention note above)."""
    if px is None or bat_side not in ("L", "R"):
        return None
    if abs(px) < MIDDLE_BAND_FT:
        return "middle"
    batter_stands_negative = bat_side == "R"
    return "inside" if (px < 0) == batter_stands_negative else "away"


def _plate_height(pz, top, bot) -> str | None:
    if pz is None or top is None or bot is None or top <= bot:
        return None
    if pz > top:
        return "above"
    if pz < bot:
        return "below"
    rel = (pz - bot) / (top - bot)
    return "up" if rel > 0.66 else "down" if rel < 0.33 else "middle"


def _zone_label(height, side) -> str:
    if height == "above":
        return "Above the zone"
    if height == "below":
        return "Below the zone"
    if height is None:
        return ""
    vertical = {"up": "Up", "down": "Low", "middle": "Middle"}[height]
    if side in (None, "middle"):
        return f"{vertical}, middle"
    return f"{vertical} and {'in' if side == 'inside' else 'away'}"


def _pitch_view(event: dict, bat_side: str | None = None) -> dict:
    details = event.get("details") or {}
    ptype = details.get("type") or {}
    pd = event.get("pitchData") or {}
    coords = pd.get("coordinates") or {}

    px, pz = coords.get("pX"), coords.get("pZ")
    top, bot = pd.get("strikeZoneTop"), pd.get("strikeZoneBottom")
    height = _plate_height(pz, top, bot)
    side = _plate_side(px, bat_side)
    call_code = (details.get("call") or {}).get("code")

    return {
        "number": event.get("pitchNumber"),
        "type": ptype.get("description") or "Pitch",
        "code": ptype.get("code"),
        "velo": _num(pd.get("startSpeed")),
        "zone": _zone_label(height, side),
        "zoneNumber": pd.get("zone"),
        "height": height,
        "side": side,
        "call": (details.get("call") or {}).get("description") or details.get("description"),
        "callCode": call_code,
        "outcome": _CALL_OUTCOMES.get(call_code, "other"),
        "isInPlay": bool(details.get("isInPlay")),
        "isStrike": bool(details.get("isStrike")),
        "isBall": bool(details.get("isBall")),
        # Raw plate coordinates + strike-zone bounds, in feet. The strike-zone
        # plot and the replay engine both read these.
        "plate": {
            "x": px, "z": pz,
            "szTop": top, "szBottom": bot,
            "halfWidth": ZONE_HALF_WIDTH_FT,
            "ballRadius": BALL_RADIUS_FT,
        },
    }


def _hit_view(event: dict) -> dict | None:
    hd = event.get("hitData")
    if not hd:
        return None
    coords = hd.get("coordinates") or {}
    return {
        "launchSpeed": _num(hd.get("launchSpeed")),
        "launchAngle": _num(hd.get("launchAngle")),
        "totalDistance": _num(hd.get("totalDistance")),
        "trajectory": hd.get("trajectory"),
        "hardness": hd.get("hardness"),
        "location": hd.get("location"),
        "coordinates": {"x": coords.get("coordX"), "y": coords.get("coordY")},
    }


_BASES = {"1B": "first", "2B": "second", "3B": "third"}


def _situations(merged: dict[int, dict]) -> dict[int, dict]:
    """The game as it stood around each at-bat's replayed (final) pitch.

    A replay of an old play should not sit under a scorebug reading "Final".
    For each at-bat this returns two snapshots -- score, outs, count, runners:

        before  just before the final pitch: the state the at-bat started in,
                plus anything that happened DURING it (a stolen base, a wild
                pitch, a pickoff), so a homer after a double steal is shown
                with runners on second and third, not first and second
        after   once the play is over, straight from the feed's own numbers

    Walked in at-bat order, carrying score, outs and runners from one to the
    next. GUMBO gives each play's end state (`result.*Score`, `count`,
    `matchup.postOn*`) but nothing about how it began, so "before" is the
    previous play's "after" -- reset to empty bases and no outs at each new
    half-inning -- with this play's earlier runner movements applied.
    """
    out: dict[int, dict] = {}
    score = {"away": 0, "home": 0}
    outs = 0
    bases: dict[str, str | None] = {"first": None, "second": None, "third": None}
    half_key = None

    for idx in sorted(merged):
        play = merged[idx]
        result = play.get("result") or {}
        if (result.get("eventType") or "") == "game_advisory":
            continue
        about = play.get("about") or {}
        half = (about.get("halfInning") or "").lower()
        batting = "away" if half == "top" else "home"
        if (half, about.get("inning")) != half_key:
            half_key = (half, about.get("inning"))
            outs = 0
            bases = {"first": None, "second": None, "third": None}

        events = play.get("playEvents") or []
        pitch_at = [i for i, e in enumerate(events) if e.get("isPitch") or e.get("type") == "pitch"]
        # No pitch at all (an automatic intentional walk): nothing is replayed,
        # so "before" is simply how the at-bat began.
        final = pitch_at[-1] if pitch_at else 0

        # Runner movements before the final pitch, applied one event at a time.
        # Clear every starting base in the event before filling any end base:
        # a double steal lists 1B->2B and 2B->3B in no promised order, and
        # applying them one by one can wipe the runner who just arrived.
        early: dict[int, list[dict]] = {}
        for r in play.get("runners") or []:
            at = (r.get("details") or {}).get("playIndex")
            if at is not None and at < final:
                early.setdefault(at, []).append(r)
        for at in sorted(early):
            moves = early[at]
            for r in moves:
                start = _BASES.get((r.get("movement") or {}).get("start"))
                if start:
                    bases[start] = None
            for r in moves:
                mv = r.get("movement") or {}
                name = ((r.get("details") or {}).get("runner") or {}).get("fullName")
                if mv.get("isOut"):
                    outs += 1
                elif mv.get("end") == "score":
                    score[batting] += 1
                elif _BASES.get(mv.get("end")):
                    bases[_BASES[mv["end"]]] = name

        count_before = (events[final - 1].get("count") or {}) if 0 < final <= len(events) else {}
        before = {
            **score,
            "outs": min(outs, 3),
            "balls": count_before.get("balls", 0) if final > 0 else 0,
            "strikes": count_before.get("strikes", 0) if final > 0 else 0,
            "bases": dict(bases),
        }

        count = play.get("count") or {}
        matchup = play.get("matchup") or {}
        after_outs = count.get("outs", outs)
        score = {
            "away": result.get("awayScore", score["away"]),
            "home": result.get("homeScore", score["home"]),
        }
        # The inning is over at three outs; whoever was left on is not "on".
        bases = {"first": None, "second": None, "third": None} if after_outs >= 3 else {
            b: (matchup.get(f"postOn{b.capitalize()}") or {}).get("fullName")
            for b in ("first", "second", "third")
        }
        outs = after_outs
        out[idx] = {
            "before": before,
            "after": {
                **score,
                "outs": min(after_outs, 3),
                # The feed's count after strike three is "2-3", and after ball
                # four "4-1". A scorebug never shows either: strike three is
                # the out going up, not a third strike on the count.
                "balls": min(count.get("balls", 0), 3),
                "strikes": min(count.get("strikes", 0), 2),
                "bases": dict(bases),
            },
        }
    return out


def _at_bats(feed: dict) -> list[dict]:
    """Every at-bat, newest first. The in-progress one is flagged `live`."""
    plays = (feed.get("liveData") or {}).get("plays") or {}

    merged: dict[int, dict] = {}
    for p in plays.get("allPlays") or []:
        idx = p.get("atBatIndex")
        if idx is not None:
            merged[idx] = p
    cur = plays.get("currentPlay")
    cur_index = cur.get("atBatIndex") if cur else None
    if cur and cur_index is not None:
        merged[cur_index] = cur

    situations = _situations(merged)
    out = []
    for idx in sorted(merged, reverse=True):
        play = merged[idx]
        about = play.get("about") or {}
        result = play.get("result") or {}
        matchup = play.get("matchup") or {}
        events = play.get("playEvents") or []

        # GUMBO files advisories (status changes, delays, replay reviews) as
        # plays with an atBatIndex. They are not at-bats -- before first pitch
        # the only "play" in the feed is a "Status Change - Pre-Game" advisory,
        # which would otherwise head the at-bat list.
        if (result.get("eventType") or "") == "game_advisory":
            continue

        bat_side = (matchup.get("batSide") or {}).get("code")
        pitches = [_pitch_view(e, bat_side) for e in events
                   if e.get("isPitch") or e.get("type") == "pitch"]
        hit = next((_hit_view(e) for e in reversed(events) if e.get("hitData")), None)
        complete = bool(about.get("isComplete"))
        half = (about.get("halfInning") or "").lower()

        out.append({
            "id": f"ab-{idx}",
            "atBatIndex": idx,
            "inningLabel": f"{'T' if half == 'top' else 'B'}{about.get('inning', '?')}",
            "inning": about.get("inning"),
            "half": half or None,
            "batterId": str((matchup.get("batter") or {}).get("id") or ""),
            "batter": (matchup.get("batter") or {}).get("fullName") or "?",
            "pitcherId": str((matchup.get("pitcher") or {}).get("id") or ""),
            "pitcher": (matchup.get("pitcher") or {}).get("fullName") or "?",
            "batSide": (matchup.get("batSide") or {}).get("code"),
            "pitchHand": (matchup.get("pitchHand") or {}).get("code"),
            # An in-progress play's `result` is not an outcome yet -- mid-at-bat
            # it can transiently hold things like "Batter Timeout", which would
            # otherwise read as the result of the at-bat. Trust `result` only
            # once the play is complete; until then show the count.
            "result": (result.get("event") or "—") if complete else "At bat",
            "eventType": result.get("eventType") if complete else None,
            "kind": _kind(result) if complete else "live",
            "detail": (result.get("description") or result.get("event") or "—") if complete
                      else _in_progress_detail(play),
            "rbi": result.get("rbi") or 0,
            "isScoringPlay": bool(about.get("isScoringPlay")),
            # Flattened batted-ball metrics the UI shows directly.
            "exitVelo": hit.get("launchSpeed") if hit else None,
            "launchAngle": hit.get("launchAngle") if hit else None,
            "distance": hit.get("totalDistance") if hit else None,
            "pitch": pitches[-1] if pitches else {"type": "—", "velo": None, "zone": ""},
            "pitches": pitches,
            "hit": hit,
            # A replay needs a batted ball with landing coordinates to rebuild.
            "hasReplay": bool(hit and hit.get("coordinates", {}).get("x") is not None),
            "live": complete is False and idx == cur_index,
            # Score, outs, count and runners just before the replayed pitch and
            # once the play is over -- what the replay HUD shows for a picked play.
            "situation": situations.get(idx),
        })
    return out


def _in_progress_detail(play: dict) -> str:
    count = play.get("count") or {}
    balls, strikes = count.get("balls"), count.get("strikes")
    if balls is None or strikes is None:
        return "At bat"
    return f"{balls}-{strikes} count, {count.get('outs', 0)} out"


# --- players ----------------------------------------------------------------

def _players(feed: dict, at_bats: list[dict]) -> dict:
    """Player cards: real season stats, plus batted-ball metrics from THIS game.

    Season Statcast aggregates (barrel rate and friends) are not in the feed, so
    rather than invent them we aggregate this game's batted balls and the UI
    labels that block "this game".
    """
    game_data = feed.get("gameData") or {}
    bios = game_data.get("players") or {}
    box_teams = ((feed.get("liveData") or {}).get("boxscore") or {}).get("teams") or {}
    # The BOXSCORE team object carries only id/link/name -- no abbreviation, so
    # the club mark on a player card has to come from gameData.teams instead.
    gd_teams = game_data.get("teams") or {}

    # this game's batted balls per batter
    batted: dict[str, list[dict]] = {}
    for ab in at_bats:
        if ab["hit"] and ab["batterId"]:
            batted.setdefault(ab["batterId"], []).append(ab["hit"])

    out: dict[str, dict] = {}
    for side in ("away", "home"):
        team = box_teams.get(side) or {}
        gd_team = gd_teams.get(side) or {}
        team_name = (gd_team.get("teamName")
                     or (team.get("team") or {}).get("teamName")
                     or (team.get("team") or {}).get("name") or "")
        team_abbr = gd_team.get("abbreviation")
        for key, p in (team.get("players") or {}).items():
            pid = str((p.get("person") or {}).get("id") or key.removeprefix("ID"))
            bio = bios.get(f"ID{pid}") or {}
            season = ((p.get("seasonStats") or {}).get("batting")) or {}
            season_pitching = ((p.get("seasonStats") or {}).get("pitching")) or {}
            game_pitching = ((p.get("stats") or {}).get("pitching")) or {}
            position = p.get("position") or {}
            # position.code '1' is the pitcher slot. A pitcher's .000 batting
            # line is noise, so the card shows their pitching numbers instead.
            is_pitcher = position.get("code") == "1" or position.get("abbreviation") == "P"
            hits = batted.get(pid) or []
            speeds = [h["launchSpeed"] for h in hits if h.get("launchSpeed") is not None]
            dists = [h["totalDistance"] for h in hits if h.get("totalDistance") is not None]

            out[pid] = {
                "id": pid,
                "name": (p.get("person") or {}).get("fullName") or "?",
                "number": p.get("jerseyNumber") or bio.get("primaryNumber") or "—",
                "pos": ((p.get("position") or {}).get("name")
                        or (bio.get("primaryPosition") or {}).get("name") or ""),
                "posAbbr": ((p.get("position") or {}).get("abbreviation")
                            or (bio.get("primaryPosition") or {}).get("abbreviation") or ""),
                "bats": (bio.get("batSide") or {}).get("code") or "—",
                "throws": (bio.get("pitchHand") or {}).get("code") or "—",
                "team": team_name,
                "teamAbbr": team_abbr,
                "height": bio.get("height") or "—",
                "weight": f"{bio['weight']} lb" if bio.get("weight") else "—",
                "age": bio.get("currentAge") or "—",
                "birthplace": _birthplace(bio),
                "mlbDebut": bio.get("mlbDebutDate"),
                "isPitcher": is_pitcher,
                "season": {
                    "avg": season.get("avg", "—"),
                    "obp": season.get("obp", "—"),
                    "slg": season.get("slg", "—"),
                    "ops": season.get("ops", "—"),
                    "hr": season.get("homeRuns", 0),
                    "rbi": season.get("rbi", 0),
                    "sb": season.get("stolenBases", 0),
                },
                "seasonPitching": {
                    "era": season_pitching.get("era", "—"),
                    "record": (f"{season_pitching['wins']}-{season_pitching['losses']}"
                               if season_pitching.get("wins") is not None else "—"),
                    "ip": season_pitching.get("inningsPitched", "—"),
                    "k": season_pitching.get("strikeOuts", 0),
                    "bb": season_pitching.get("baseOnBalls", 0),
                    "whip": season_pitching.get("whip", "—"),
                    "sv": season_pitching.get("saves", 0),
                } if is_pitcher else None,
                "gamePitching": {
                    "ip": game_pitching.get("inningsPitched", "0.0"),
                    "h": game_pitching.get("hits", 0),
                    "r": game_pitching.get("runs", 0),
                    "er": game_pitching.get("earnedRuns", 0),
                    "bb": game_pitching.get("baseOnBalls", 0),
                    "k": game_pitching.get("strikeOuts", 0),
                    "pitches": (game_pitching.get("numberOfPitches")
                                or game_pitching.get("pitchesThrown") or 0),
                } if is_pitcher and game_pitching else None,
                "batted": {
                    "battedBalls": len(hits),
                    "avgExitVelo": round(sum(speeds) / len(speeds), 1) if speeds else None,
                    "hardHitPct": (round(100 * sum(1 for s in speeds if s >= 95) / len(speeds), 1)
                                   if speeds else None),
                    "maxDistance": max(dists) if dists else None,
                },
                "spray": [
                    {"x": h["coordinates"]["x"], "y": h["coordinates"]["y"],
                     "ev": h.get("launchSpeed"), "traj": h.get("trajectory")}
                    for h in hits if h.get("coordinates", {}).get("x") is not None
                ],
            }
    return out


# --- the snapshot the UI renders -------------------------------------------

def snapshot(feed: dict) -> dict:
    """Full current-state projection of one game."""
    game_data = feed.get("gameData") or {}
    live = feed.get("liveData") or {}
    ls = live.get("linescore") or {}
    teams = game_data.get("teams") or {}
    status = (game_data.get("status") or {}).get("abstractGameState")
    game_pk = feed.get("gamePk")
    game_id = str(game_pk)

    ls_teams = ls.get("teams") or {}
    away = _team_view(teams.get("away") or {}, (ls_teams.get("away") or {}).get("runs"))
    home = _team_view(teams.get("home") or {}, (ls_teams.get("home") or {}).get("runs"))

    state = None
    if ls.get("currentInning") is not None and status != "Preview":
        state = {
            "inning": ls.get("currentInning"),
            "half": _half(ls),
            # "Top" | "Middle" | "Bottom" | "End". Middle and End are the
            # breaks between halves: the feed switches to them in the same
            # update as the third out, and back to Top/Bottom when the next
            # batter steps in. `half` alone cannot say this -- it stays on
            # the half that just finished.
            "inningState": ls.get("inningState"),
            "scheduledInnings": ls.get("scheduledInnings") or 9,
            "outs": ls.get("outs") or 0,
            "balls": ls.get("balls") or 0,
            "strikes": ls.get("strikes") or 0,
        }

    at_bats = _at_bats(feed)
    offense = ls.get("offense") or {}
    defense = ls.get("defense") or {}

    return {
        "game": {
            "id": game_id,
            "gamePk": game_pk,
            "status": _STATUS_MAP.get(status, "scheduled"),
            "detailedStatus": (game_data.get("status") or {}).get("detailedState") or "",
            "startsAt": _local_time((game_data.get("datetime") or {}).get("dateTime")),
            "startsAtISO": (game_data.get("datetime") or {}).get("dateTime"),
            "venue": (game_data.get("venue") or {}).get("name") or "",
            "dayNight": (game_data.get("datetime") or {}).get("dayNight"),
            "away": away,
            "home": home,
            "state": state,
        },
        "lineScore": _line_score(feed, game_id),
        "bases": _base_runners(ls),
        # Ids alongside the names so the scorebug's "X vs Y" line can open a
        # player card, same as every other player name in the app.
        "matchup": {
            "batter": (offense.get("batter") or {}).get("fullName"),
            "batterId": _id_str((offense.get("batter") or {}).get("id")),
            "onDeck": (offense.get("onDeck") or {}).get("fullName"),
            "onDeckId": _id_str((offense.get("onDeck") or {}).get("id")),
            "pitcher": (defense.get("pitcher") or {}).get("fullName"),
            "pitcherId": _id_str((defense.get("pitcher") or {}).get("id")),
        },
        "boxScore": _box_score(feed),
        "atBats": at_bats,
        "players": _players(feed, at_bats),
        "meta": {
            "timecode": (feed.get("metaData") or {}).get("timeStamp"),
            "atBatCount": len(at_bats),
        },
    }


# --- standalone player card -------------------------------------------------

def player_card(person: dict, teams: dict | None = None) -> dict:
    """A player card for someone outside the current game.

    Same shape `_players` produces from the box score, so PlayerCard.jsx renders
    it without branching. The batted-ball block and spray chart come from a
    specific game's tracked contact, so they are empty here -- the card already
    handles that case.
    """
    stats = {blk.get("group", {}).get("displayName"): blk for blk in person.get("stats") or []}

    def line(group: str) -> dict:
        splits = (stats.get(group) or {}).get("splits") or []
        return (splits[0].get("stat") if splits else {}) or {}

    batting = line("hitting")
    pitching = line("pitching")
    position = person.get("primaryPosition") or {}
    is_pitcher = position.get("code") == "1" or position.get("abbreviation") == "P"

    team = person.get("currentTeam") or {}
    # currentTeam omits the abbreviation, which is what the UI keys logos off.
    resolved = (teams or {}).get(team.get("id")) or {}

    return {
        "id": str(person.get("id") or ""),
        "name": person.get("fullName") or "?",
        "number": person.get("primaryNumber") or "—",
        "pos": position.get("name") or "",
        "posAbbr": position.get("abbreviation") or "",
        "bats": (person.get("batSide") or {}).get("code") or "—",
        "throws": (person.get("pitchHand") or {}).get("code") or "—",
        "team": resolved.get("teamName") or team.get("name") or "",
        "teamAbbr": resolved.get("abbreviation"),
        "height": person.get("height") or "—",
        "weight": f"{person['weight']} lb" if person.get("weight") else "—",
        "age": person.get("currentAge") or "—",
        "birthplace": _birthplace(person),
        "mlbDebut": person.get("mlbDebutDate"),
        "isPitcher": is_pitcher,
        "season": {
            "avg": batting.get("avg", "—"),
            "obp": batting.get("obp", "—"),
            "slg": batting.get("slg", "—"),
            "ops": batting.get("ops", "—"),
            "hr": batting.get("homeRuns", 0),
            "rbi": batting.get("rbi", 0),
            "sb": batting.get("stolenBases", 0),
        },
        "seasonPitching": {
            "era": pitching.get("era", "—"),
            "record": (f"{pitching['wins']}-{pitching['losses']}"
                       if pitching.get("wins") is not None else "—"),
            "ip": pitching.get("inningsPitched", "—"),
            "k": pitching.get("strikeOuts", 0),
            "bb": pitching.get("baseOnBalls", 0),
            "whip": pitching.get("whip", "—"),
            "sv": pitching.get("saves", 0),
        } if is_pitcher else None,
        "gamePitching": None,
        "batted": {"battedBalls": 0, "avgExitVelo": None, "hardHitPct": None, "maxDistance": None},
        "spray": [],
        "scope": "season",   # tells the UI this card has no game context
    }
