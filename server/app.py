"""HTTP + SSE backend for the Barrels 3D frontend.

Stdlib only (plus `requests`, which the prototype already needed) so running the
backend stays `python server/app.py` with no extra install.

    GET /api/health
    GET /api/games?date=YYYY-MM-DD      today's scoreboard (date optional)
    GET /api/leaders?season=YYYY        advanced-stat league leaders
    GET /api/player/<personId>          one player card: bio, season line,
                                        percentile ability ratings, season
                                        Statcast, and a pitcher's arsenal
    GET /api/game/<gamePk>              one snapshot, no streaming
    GET /api/stream/<gamePk>            Server-Sent Events: snapshot / play / status
        ?replay=1&speed=6               re-run a finished game as if it were live

SSE rather than WebSockets: the data only flows one way, EventSource reconnects
on its own, and it needs no dependency on either end.

    python server/app.py [--port 8787]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import game_statcast
import leaders as leaders_mod
import mlb_api
import projection
import ratings as ratings_mod
from feed_hub import FeedHub

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

HUB = FeedHub()
_schedule_cache: dict[str, tuple[float, list]] = {}
_leaders_cache: dict[int, tuple[float, dict]] = {}
_teams_cache: dict[int, tuple[float, dict]] = {}
_saber_cache: dict[int, tuple[float, dict]] = {}
_game_statcast_cache: dict[int, tuple[float, list]] = {}


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
    _schedule_cache[date_str] = (now, games)
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
    _game_statcast_cache[game_pk] = (now, rows)
    return rows, 0.0


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "barrels3d/0.1"

    # --- plumbing ----------------------------------------------------------

    def log_message(self, fmt, *args):  # quieter than the default one-line-per-request
        if self.path.startswith("/api/stream"):
            sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")

    def _cors(self) -> None:
        # The Vite dev server proxies /api, so this is only a fallback for
        # hitting the backend directly from a different origin.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, payload, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    # --- routes ------------------------------------------------------------

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        query = parse_qs(parsed.query)

        try:
            if path == "/api/health":
                return self._json({"ok": True, "service": "barrels-3d", "time": _today()})

            if path == "/api/games":
                date_str = (query.get("date") or [_today()])[0]
                games, age = _scoreboard(date_str)
                payload = {"date": date_str, "games": games}
                if age:
                    # Tell the client it is looking at a cached board rather
                    # than pretending everything is current.
                    payload["stale"] = True
                    payload["ageSeconds"] = round(age)
                return self._json(payload)

            if path == "/api/leaders":
                season = int((query.get("season") or [datetime.now().year])[0])
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

            if path.startswith("/api/player/"):
                person_id = int(path.rsplit("/", 1)[1])
                season = int((query.get("season") or [datetime.now().year])[0])
                person = mlb_api.get_person(person_id, season)
                if not person:
                    return self._json({"error": "player not found"}, status=404)

                card = projection.player_card(person, _teams(season))
                # Ability ratings, season Statcast and (for pitchers) the pitch
                # arsenal. profile() never raises: if Savant is unreachable the
                # card keeps its bio and season line and says why the bars are
                # missing, rather than the whole request failing.
                card.update(ratings_mod.profile(person_id, card["isPitcher"], season))
                card["sabermetrics"] = _sabermetrics(season).get(str(person_id))
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
                feed = mlb_api.get_live_feed(game_pk)
                return self._json(projection.snapshot(feed))

            if path.startswith("/api/stream/"):
                game_pk = int(path.rsplit("/", 1)[1])
                replay = (query.get("replay") or ["0"])[0] in ("1", "true", "yes")
                speed = float((query.get("speed") or ["6"])[0])
                return self._stream(game_pk, replay, speed)

            return self._json({"error": "not found", "path": path}, status=404)

        except ValueError:
            return self._json({"error": "bad gamePk"}, status=400)
        except Exception as exc:
            return self._json({"error": f"{type(exc).__name__}: {exc}"}, status=502)

    # --- SSE ---------------------------------------------------------------

    def _stream(self, game_pk: int, replay: bool, speed: float) -> None:
        feed = HUB.get(game_pk, replay=replay, speed=speed)
        q = feed.subscribe()

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self._cors()
        self.end_headers()

        last_beat = time.monotonic()
        try:
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

    parser = argparse.ArgumentParser(description="Barrels 3D live backend")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    server = Server((args.host, args.port), Handler)
    print(f"Barrels 3D backend on http://{args.host}:{args.port}")
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
