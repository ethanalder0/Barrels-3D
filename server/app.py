"""HTTP + SSE backend for the Barrels 3D frontend.

Stdlib only (plus `requests`, which the prototype already needed) so running the
backend stays `python server/app.py` with no extra install.

    GET /api/health
    GET /api/games?date=YYYY-MM-DD      today's scoreboard (date optional)
    GET /api/leaders?season=YYYY        advanced-stat league leaders
    GET /api/players                    everyone on a roster, for player search
    GET /api/players/summary?ids=1,2    overall and top rating, for search results
    GET /api/players/ratings            every player's ratings and every club's
                                        numbers, for the Players page. 202 while
                                        it is still being worked out.
    GET /api/player/<personId>          one player card: bio, season line,
                                        percentile ability ratings, season
                                        Statcast, and a pitcher's arsenal
    GET /api/game/<gamePk>              one snapshot, no streaming
    GET /api/stream/<gamePk>            Server-Sent Events: snapshot / play / status
        ?replay=1&speed=6               re-run a finished game as if it were live

Anything else is the built frontend from dist/, when there is one (see
static_files.py) -- which is how a deploy serves the whole site from this one
process. Locally there usually is not, and Vite serves the app instead.

SSE rather than WebSockets: the data only flows one way, EventSource reconnects
on its own, and it needs no dependency on either end.

    python server/app.py [--port 8787] [--host 127.0.0.1]

On a host that sets PORT (Heroku, and most like it) the port comes from there
and the server listens on every interface.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import game_statcast
import leaders as leaders_mod
import mlb_api
import projection
import ratings as ratings_mod
import static_files
from feed_hub import FeedHub, FeedLimitReached
from ratelimit import RequestLimiter, StreamLimiter, client_address

DEFAULT_PORT = 8787
HEARTBEAT_SECONDS = 15.0   # keeps proxies from closing an idle SSE connection
SCHEDULE_TTL = 30.0        # seconds before a cached scoreboard is refetched
SCHEDULE_STALE_MAX = 900.0  # ...and how long we will keep serving it if upstream is down

# Leaders move at most once a day, so they are cached far longer than the
# scoreboard -- and, like it, kept servable when upstream is down.
LEADERS_TTL = 600.0
LEADERS_STALE_MAX = 21600.0   # 6h

# The board is always BUILT at this depth and sliced per request, so the home
# page's top five and the full page's fifty come out of one cache entry and one
# set of upstream calls. Expanding a leaderboard costs nothing upstream.
LEADERS_DEPTH = 50
LEADERS_DEFAULT = 5

# The team list and the sabermetric board both move about as often as the
# leaders do, and both are now on the player-card path -- which a user can hit
# a dozen times while reading one box score.
TEAMS_TTL = 21600.0    # 6h; abbreviations change between seasons, not innings
SABER_TTL = 600.0

# Savant's per-game feed (bat speed, spin rate). Short-lived because a live game
# keeps adding swings; a blip upstream keeps serving the last good copy.
GAME_STATCAST_TTL = 20.0
GAME_STATCAST_STALE_MAX = 900.0

# A player card is a statsapi call per click, and the same leader gets clicked
# by everyone reading the home page. Ten minutes is far fresher than a season
# line moves.
PLAYER_TTL = 600.0
# Rosters change by the day at most; a search box does not need them fresher.
PLAYERS_TTL = 3600.0
# A page of search results. Each id is a rating to work out, so it stays small.
SUMMARY_MAX_IDS = 12
# The Players page's data. Rebuilt in the background at most this often, and the
# last good copy is served meanwhile. After a failure, wait before trying again.
BOARD_TTL = 3600.0
BOARD_RETRY = 60.0

# One game's snapshot, for a first paint. Short, because a live game moves; the
# point is only that a burst of visitors arriving together costs one fetch.
SNAPSHOT_TTL = 5.0

# Every cache below is keyed by something a visitor chooses -- a date, a game, a
# player -- so each is capped, or a crawler could grow it until memory runs out.
CACHE_MAX_ENTRIES = 500

# Replay speed is timecodes per tick. Past this a game is over in seconds and
# each tick is just more upstream fetches.
REPLAY_SPEED_RANGE = (1.0, 30.0)

# Seasons the backend will ask upstream about. Statcast starts in 2015.
FIRST_SEASON = 2015

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Only set when the API is called from a different origin. Same-origin in
# production and proxied by Vite in development, so normally unset.
CORS_ORIGIN = os.environ.get("CORS_ORIGIN", "")

LIMITER = RequestLimiter()
STREAMS = StreamLimiter()

HUB = FeedHub()
_schedule_cache: dict[str, tuple[float, list]] = {}
_leaders_cache: dict[int, tuple[float, dict]] = {}
_teams_cache: dict[int, tuple[float, dict]] = {}
_saber_cache: dict[int, tuple[float, dict]] = {}
_game_statcast_cache: dict[int, tuple[float, list]] = {}
_player_cache: dict[tuple[int, int], tuple[float, dict]] = {}
_players_cache: dict[int, tuple[float, list]] = {}
_snapshot_cache: dict[int, tuple[float, dict]] = {}


def _remember(cache: dict, key, value) -> None:
    """Store `value` as (now, value), dropping the oldest entries past the cap."""
    cache[key] = (time.monotonic(), value)
    if len(cache) > CACHE_MAX_ENTRIES:
        for old in sorted(cache, key=lambda k: cache[k][0])[: len(cache) - CACHE_MAX_ENTRIES]:
            del cache[old]


def _season(query) -> int:
    """The ?season= asked for, held to seasons that exist."""
    now = datetime.now().year
    season = int((query.get("season") or [now])[0])
    if not FIRST_SEASON <= season <= now + 1:
        raise ValueError("season out of range")
    return season


def _today() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d")


def _scoreboard(date_str: str):
    """Cached scoreboard, and the age of what we are returning.

    Two jobs. The obvious one is not fanning several tabs out into several
    upstream requests. The important one is the failure path: statsapi drops
    connections now and then, and previously any such blip raised straight
    through to a 502, at which point the UI dropped to placeholder data and the
    games "disappeared" until a later poll happened to succeed.

    Now a failed refresh falls back to the last good scoreboard for up to
    SCHEDULE_STALE_MAX. Slightly out-of-date games beat no games.
    """
    hit = _schedule_cache.get(date_str)
    now = time.monotonic()
    if hit and now - hit[0] < SCHEDULE_TTL:
        return hit[1], 0.0

    try:
        games = projection.scoreboard(mlb_api.get_schedule(date_str))
    except Exception as exc:
        if hit and now - hit[0] < SCHEDULE_STALE_MAX:
            age = now - hit[0]
            sys.stderr.write(
                "[scoreboard] %s refresh failed (%s); serving cache %.0fs old%s"
                % (date_str, type(exc).__name__, age, "\n"))
            return hit[1], age
        raise
    _remember(_schedule_cache, date_str, games)
    return games, 0.0


def _leaders(season: int):
    """Cached advanced-stat leaders, with the same stale-serving contract as the
    scoreboard: a blip upstream should not empty the home page."""
    hit = _leaders_cache.get(season)
    now = time.monotonic()
    if hit and now - hit[0] < LEADERS_TTL:
        return hit[1], 0.0

    try:
        data = leaders_mod.leaders(season, per_category=LEADERS_DEPTH)
    except Exception as exc:
        if hit and now - hit[0] < LEADERS_STALE_MAX:
            age = now - hit[0]
            sys.stderr.write("[leaders] %d refresh failed (%s); serving cache %.0fs old%s"
                             % (season, type(exc).__name__, age, "\n"))
            return hit[1], age
        raise
    _leaders_cache[season] = (now, data)
    return data, 0.0


def _slice_leaders(data: dict, per: int) -> dict:
    """The cached board, trimmed to `per` names per category.

    Copies down to the list being sliced and no further: the cached object is
    shared with every other request, so mutating it in place would let one
    caller's page size follow the next caller home.
    """
    return {
        **data,
        "perCategory": per,
        "maxPerCategory": LEADERS_DEPTH,
        "groups": [
            {**group, "categories": [
                {**cat, "leaders": (cat.get("leaders") or [])[:per]}
                for cat in group.get("categories") or []
            ]}
            for group in data.get("groups") or []
        ],
    }


def _teams(season: int) -> dict:
    """Cached team index. Opening a player card should not refetch all 30 clubs."""
    hit = _teams_cache.get(season)
    now = time.monotonic()
    if hit and now - hit[0] < TEAMS_TTL:
        return hit[1]
    teams = mlb_api.get_teams(season)
    _teams_cache[season] = (now, teams)
    return teams


def _sabermetrics(season: int) -> dict:
    """personId -> {war, wrcPlus, woba} or {war, fip, xfip, eraMinus}.

    These are the supporting numbers on the back of a card. Note the pool: the
    sabermetrics endpoint serves QUALIFIED players only and ignores a larger
    `limit`, so a reliever or a bench bat legitimately has no FIP here. The card
    shows a dash rather than filling the gap with something else.
    """
    hit = _saber_cache.get(season)
    now = time.monotonic()
    if hit and now - hit[0] < SABER_TTL:
        return hit[1]

    index: dict[str, dict] = {}
    try:
        for group, keys in (("hitting", ("war", "wRcPlus", "woba")),
                            ("pitching", ("war", "fip", "xfip", "eraMinus"))):
            for split in mlb_api.get_sabermetrics(group, keys[0], season, limit=250):
                pid = str(((split.get("player") or {}).get("id")) or "")
                stat = split.get("stat") or {}
                if not pid:
                    continue
                index.setdefault(pid, {}).update(
                    {k: stat.get(k) for k in keys if stat.get(k) is not None})
    except Exception as exc:
        # Supporting stats only: a failure here costs two lines on the back of
        # the card, so serve whatever we already had and carry on.
        sys.stderr.write(f"[sabermetrics] {season} failed ({type(exc).__name__}); "
                         f"{'serving cache' if hit else 'continuing without'}\n")
        return hit[1] if hit else {}

    _saber_cache[season] = (now, index)
    return index


def _game_statcast(game_pk: int):
    """Cached per-pitch bat speed / spin rate, and the age of what we return."""
    hit = _game_statcast_cache.get(game_pk)
    now = time.monotonic()
    if hit and now - hit[0] < GAME_STATCAST_TTL:
        return hit[1], 0.0

    try:
        rows = game_statcast.pitches(game_pk)
    except Exception as exc:
        if hit and now - hit[0] < GAME_STATCAST_STALE_MAX:
            age = now - hit[0]
            sys.stderr.write("[game-statcast] %d refresh failed (%s); serving cache %.0fs old\n"
                             % (game_pk, type(exc).__name__, age))
            return hit[1], age
        raise
    _remember(_game_statcast_cache, game_pk, rows)
    return rows, 0.0


def _roster_people(season: int) -> list[dict]:
    """Everyone on a roster this season, cached, and stale rather than absent."""
    hit = _players_cache.get(season)
    now = time.monotonic()
    if hit and now - hit[0] < PLAYERS_TTL:
        return hit[1]
    try:
        people = mlb_api.get_players(season)
    except Exception as exc:
        if hit:
            sys.stderr.write(f"[players] {season} failed ({type(exc).__name__}); serving cache\n")
            return hit[1]
        raise
    # Over the winter the new season has no rosters yet; last year's are the
    # answer, not an empty search box.
    if not people and season > FIRST_SEASON:
        return _roster_people(season - 1)
    _players_cache[season] = (now, people)
    return people


def _players(season: int) -> list[dict]:
    """The rows player search matches against. Playing time is added fresh each time."""
    return projection.player_index(_roster_people(season), _teams(season),
                                   ratings_mod.playing_time(season))


def _player_summaries(ids: list[str], season: int) -> dict:
    """Ratings for a page of search results. Hitter or pitcher is decided as the card does."""
    positions = {str(p.get("id")): (p.get("primaryPosition") or {}).get("abbreviation")
                 for p in _roster_people(season)}
    return ratings_mod.summaries({i: positions.get(i) == "P" for i in ids}, season)


class PlayerBoard:
    """The Players page's data for one season, built off the request thread.

    Rating everyone takes about 20 s of CPU, far too long for a request to wait
    on and more than one copy should ever be doing, so at most one build runs at
    a time. Requests get the last good copy straight away, or are told to come
    back. The body is encoded once, gzip included, because it goes out unchanged
    to everyone.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._built: dict[int, tuple[float, bytes, bytes]] = {}
        self._running: set[int] = set()
        self._failed: dict[int, float] = {}

    def get(self, season: int) -> tuple[bytes, bytes] | None:
        """(json, gzipped json), or None while the first build is still going."""
        now = time.monotonic()
        with self._lock:
            hit = self._built.get(season)
            due = (not hit or now - hit[0] >= BOARD_TTL) and season not in self._running
            if due and now - self._failed.get(season, -BOARD_RETRY) >= BOARD_RETRY:
                self._running.add(season)
                threading.Thread(target=self.build, args=(season,),
                                 name="player-board", daemon=True).start()
        return (hit[1], hit[2]) if hit else None

    def failed(self, season: int) -> bool:
        """The last build failed and there is nothing to serve in its place."""
        with self._lock:
            return (season in self._failed and season not in self._running
                    and season not in self._built)

    def build(self, season: int) -> None:
        try:
            payload = _build_player_board(season)
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            packed = gzip.compress(body, compresslevel=6)
            with self._lock:
                self._built[season] = (time.monotonic(), body, packed)
                self._failed.pop(season, None)
        except Exception as exc:
            sys.stderr.write(f"[players] board for {season} failed: {type(exc).__name__}: {exc}\n")
            with self._lock:
                self._failed[season] = time.monotonic()
        finally:
            with self._lock:
                self._running.discard(season)


BOARD = PlayerBoard()


def _build_player_board(season: int) -> dict:
    people = _roster_people(season)
    try:
        clubs = mlb_api.get_current_teams([p.get("id") for p in people if p.get("id")])
    except Exception as exc:
        sys.stderr.write(f"[players] current teams failed ({type(exc).__name__}); "
                         "using the season list\n")
        clubs = None
    rows = projection.board_rows(people, _teams(season), clubs)
    board = ratings_mod.player_board(rows, season)
    # Over the winter the new season has rosters but nothing to rate them on.
    if not any(row["r"] for row in board["players"]) and season > FIRST_SEASON:
        return ratings_mod.player_board(rows, season - 1)
    return board


def _warm(season: int) -> None:
    """Have everything ready before the first visitor asks: card ratings, then the page."""
    ratings_mod.warm(season)
    BOARD.get(season)


def _player(person_id: int, season: int) -> dict | None:
    """One player card, cached. None if statsapi has no such player."""
    key = (person_id, season)
    hit = _player_cache.get(key)
    if hit and time.monotonic() - hit[0] < PLAYER_TTL:
        return hit[1]

    person = mlb_api.get_person(person_id, season)
    if not person:
        return None
    card = projection.player_card(person, _teams(season))
    # Ability ratings, season Statcast and (for pitchers) the pitch arsenal.
    # profile() never raises: if Savant is unreachable the card keeps its bio
    # and season line and says why the bars are missing, rather than the whole
    # request failing.
    card.update(ratings_mod.profile(person_id, card["isPitcher"], season))
    card["sabermetrics"] = _sabermetrics(season).get(str(person_id))
    _remember(_player_cache, key, card)
    return card


def _snapshot(game_pk: int) -> dict:
    """One game's current state, cached for a few seconds."""
    hit = _snapshot_cache.get(game_pk)
    if hit and time.monotonic() - hit[0] < SNAPSHOT_TTL:
        return hit[1]
    snap = projection.snapshot(mlb_api.get_live_feed(game_pk))
    _remember(_snapshot_cache, game_pk, snap)
    return snap


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "barrels3d/0.1"

    # --- plumbing ----------------------------------------------------------

    def log_message(self, fmt, *args):  # quieter than the default one-line-per-request
        if self.path.startswith("/api/stream"):
            sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")

    def _cors(self) -> None:
        # Same origin in production, proxied by Vite in development: neither
        # needs this. It is only for calling the API from somewhere else, and
        # then only from the one origin named in CORS_ORIGIN -- never "*", which
        # would let any site on the internet use this server's MLB quota.
        if CORS_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", CORS_ORIGIN)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Vary", "Origin")

    def _json(self, payload, status: int = 200, headers: dict | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _encoded_json(self, plain: bytes, packed: bytes) -> None:
        """A body already encoded once, gzipped for whoever accepts that."""
        gzipped = "gzip" in self.headers.get("Accept-Encoding", "")
        body = packed if gzipped else plain
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Vary", "Accept-Encoding")
        if gzipped:
            self.send_header("Content-Encoding", "gzip")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _slow_down(self, why: str) -> None:
        self._json({"error": why}, status=429, headers={"Retry-After": "10"})

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    # --- routes ------------------------------------------------------------

    def do_HEAD(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/") or not static_files.serve(self, parsed.path, head_only=True):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        query = parse_qs(parsed.query)

        # Not the API: the site itself, if there is a build to serve.
        if not parsed.path.startswith("/api/"):
            if static_files.serve(self, parsed.path):
                return None
            return self._json({"error": "not found", "path": path}, status=404)

        if path != "/api/health" and not LIMITER.allow(client_address(self)):
            return self._slow_down("too many requests")

        try:
            if path == "/api/health":
                return self._json({"ok": True, "service": "barrels-3d", "time": _today()})

            if path == "/api/games":
                # The browser always says which day it means (its own -- see
                # liveClient.js); today on the server's clock is only a fallback.
                date_str = (query.get("date") or [_today()])[0]
                if not _DATE.match(date_str):
                    return self._json({"error": "date must be YYYY-MM-DD"}, status=400)
                games, age = _scoreboard(date_str)
                payload = {"date": date_str, "games": games}
                if age:
                    # Tell the client it is looking at a cached board rather
                    # than pretending everything is current.
                    payload["stale"] = True
                    payload["ageSeconds"] = round(age)
                return self._json(payload)

            if path == "/api/leaders":
                season = _season(query)
                # ?per=50 opens a category's full board. Clamped rather than
                # rejected: an out-of-range page size is not worth a 400.
                per = int((query.get("per") or [LEADERS_DEFAULT])[0])
                per = max(1, min(per, LEADERS_DEPTH))
                data, age = _leaders(season)
                payload = _slice_leaders(data, per)
                if age:
                    payload["stale"] = True
                    payload["ageSeconds"] = round(age)
                return self._json(payload)

            if path == "/api/players":
                return self._json({"players": _players(_season(query))})

            if path == "/api/players/summary":
                ids = [i for i in (query.get("ids") or [""])[0].split(",") if i.isdigit()]
                if not ids or len(ids) > SUMMARY_MAX_IDS:
                    return self._json({"error": f"ids must be 1-{SUMMARY_MAX_IDS} player ids"}, status=400)
                return self._json({"summaries": _player_summaries(ids, _season(query))})

            if path == "/api/players/ratings":
                season = _season(query)
                ready = BOARD.get(season)
                if ready:
                    return self._encoded_json(*ready)
                if BOARD.failed(season):
                    return self._json({"error": "ratings are unavailable right now"}, status=503,
                                      headers={"Retry-After": "60"})
                return self._json({"building": True}, status=202, headers={"Retry-After": "3"})

            if path.startswith("/api/player/"):
                person_id = int(path.rsplit("/", 1)[1])
                card = _player(person_id, _season(query))
                if not card:
                    return self._json({"error": "player not found"}, status=404)
                return self._json(card)

            # /api/game/<pk>/statcast -- matched before the bare /api/game/<pk>.
            if path.startswith("/api/game/") and path.endswith("/statcast"):
                game_pk = int(path.split("/")[3])
                rows, age = _game_statcast(game_pk)
                payload = {"gamePk": game_pk, "pitches": rows}
                if age:
                    payload["stale"] = True
                    payload["ageSeconds"] = round(age)
                return self._json(payload)

            if path.startswith("/api/game/"):
                game_pk = int(path.rsplit("/", 1)[1])
                return self._json(_snapshot(game_pk))

            if path.startswith("/api/stream/"):
                game_pk = int(path.rsplit("/", 1)[1])
                replay = (query.get("replay") or ["0"])[0] in ("1", "true", "yes")
                speed = float((query.get("speed") or ["6"])[0])
                speed = max(REPLAY_SPEED_RANGE[0], min(speed, REPLAY_SPEED_RANGE[1]))
                return self._stream(game_pk, replay, speed)

            return self._json({"error": "not found", "path": path}, status=404)

        except ValueError:
            return self._json({"error": "bad request"}, status=400)
        except Exception as exc:
            return self._json({"error": f"{type(exc).__name__}: {exc}"}, status=502)

    # --- SSE ---------------------------------------------------------------

    def _stream(self, game_pk: int, replay: bool, speed: float) -> None:
        addr = client_address(self)
        if not STREAMS.acquire(addr):
            return self._slow_down("too many open streams")
        try:
            feed = HUB.get(game_pk, replay=replay, speed=speed)
        except FeedLimitReached:
            STREAMS.release(addr)
            return self._json({"error": "server busy"}, status=503, headers={"Retry-After": "30"})
        q = feed.subscribe()

        # Everything after subscribe() is inside the try, headers included: a
        # browser that leaves before they are written must still give back its
        # subscription and its stream slot.
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-transform")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self._cors()
            self.end_headers()

            last_beat = time.monotonic()
            while True:
                try:
                    message = q.get(timeout=1.0)
                except Exception:
                    message = None

                if message is not None:
                    frame = (f"event: {message['kind']}\n"
                             f"data: {json.dumps(message['data'], ensure_ascii=False)}\n\n")
                    self.wfile.write(frame.encode("utf-8"))
                    self.wfile.flush()
                    last_beat = time.monotonic()
                elif time.monotonic() - last_beat > HEARTBEAT_SECONDS:
                    self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
                    last_beat = time.monotonic()

        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass  # browser navigated away or closed the tab
        finally:
            feed.unsubscribe(q)
            STREAMS.release(addr)


# Errors that just mean "the browser went away" — a tab closed, a navigation, a
# Vite hot reload dropping an SSE connection. Normal and constant for a server
# that holds long-lived streams open.
_DISCONNECTS = (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, TimeoutError)


class Server(ThreadingHTTPServer):
    """ThreadingHTTPServer that does not shout about client disconnects.

    socketserver's default handle_error() prints a full traceback for any
    exception escaping a handler. When a browser drops an SSE connection, the
    next keep-alive read raises ConnectionAbortedError (WinError 10053) *after*
    our streaming loop has already returned cleanly, so the stack trace was
    unavoidable from inside the handler and buried real errors in noise.
    """

    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, _DISCONNECTS):
            return  # expected; nothing went wrong on our side
        super().handle_error(request, client_address)


def main() -> None:
    # Player names carry accents; a cp1252 console would otherwise crash logging.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass

    # A host that hands us PORT expects us on every interface; locally, stay on
    # loopback so the dev backend is not reachable from the rest of the network.
    env_port = os.environ.get("PORT")
    parser = argparse.ArgumentParser(description="Barrels 3D live backend")
    parser.add_argument("--port", type=int, default=int(env_port or DEFAULT_PORT))
    parser.add_argument("--host", default=os.environ.get("HOST") or ("0.0.0.0" if env_port else "127.0.0.1"))
    args = parser.parse_args()

    server = Server((args.host, args.port), Handler)
    # Player-card ratings need three seasons of Savant boards; fetch them now
    # rather than on the first card someone opens.
    threading.Thread(target=_warm, args=(datetime.now().year,),
                     name="ratings-warm", daemon=True).start()
    print(f"Barrels 3D backend on http://{args.host}:{args.port}")
    if static_files.available():
        print(f"  serving the built site from {static_files.ROOT}")
    print("  GET /api/games")
    print("  GET /api/leaders")
    print("  GET /api/game/<gamePk>")
    print("  GET /api/game/<gamePk>/statcast")
    print("  GET /api/stream/<gamePk>[?replay=1&speed=6]")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
    finally:
        HUB.shutdown()
        server.shutdown()


if __name__ == "__main__":
    main()
