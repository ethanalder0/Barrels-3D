"""One poller per game, many browser subscribers.

This is the "promote the emit loop to a real pub/sub seam" item from the
prototype's Next list. live_poller.py printed to stdout; GameFeed pushes the
same events onto per-subscriber queues instead, so several browser tabs share a
single upstream poll.

Each tick broadcasts:
  snapshot -> projection.snapshot(feed), the whole current state
  play     -> one message per new pitch / completed at-bat, straight from
              game_state.extract_new_events (unchanged prototype logic)
  status   -> connection/poll state, so the UI can show "Live" vs "Reconnecting"

Polling is state-aware (the other Next item): fast while a game is live, lazy
before first pitch, and it stops entirely once a game goes Final.

Replay mode walks a finished game's timecode list instead of fetching the latest
snapshot, which re-runs a real game as though it were happening now. That is how
you exercise the whole pipeline when nothing is live.
"""

from __future__ import annotations

import queue
import threading
import time
import traceback

import game_state
import mlb_api
import projection

LIVE_INTERVAL = 8.0       # seconds between polls while a game is in progress
PREGAME_INTERVAL = 45.0   # before first pitch nothing changes fast
ERROR_BACKOFF = 15.0
IDLE_GRACE = 60.0         # keep a feed warm this long after the last unsubscribe
MAX_QUEUE = 256           # a stalled subscriber gets dropped, not unbounded


class GameFeed:
    """Polls one gamePk and fans results out to subscriber queues."""

    def __init__(self, game_pk: int, replay: bool = False, speed: float = 6.0):
        self.game_pk = game_pk
        self.replay = replay
        self.speed = max(1.0, speed)

        self._subs: set[queue.Queue] = set()
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

        self._snapshot: dict | None = None
        self._status: dict = {"state": "starting", "gamePk": game_pk, "replay": replay}
        self._last_unsub_at = time.monotonic()

        # prototype change-detection sets, carried across polls
        self._seen_events: set = set()
        self._seen_results: set = set()

        # replay bookkeeping
        self._timestamps: list[str] = []
        self._tc_index = 0

    # --- subscription ------------------------------------------------------

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=MAX_QUEUE)
        with self._lock:
            self._subs.add(q)
            # Bring the newcomer up to date immediately rather than making it
            # wait for the next poll.
            if self._snapshot:
                q.put_nowait({"kind": "snapshot", "data": self._snapshot})
            q.put_nowait({"kind": "status", "data": self._status})
        self.start()
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            self._subs.discard(q)
            self._last_unsub_at = time.monotonic()

    @property
    def subscriber_count(self) -> int:
        with self._lock:
            return len(self._subs)

    def _broadcast(self, kind: str, data) -> None:
        message = {"kind": kind, "data": data}
        with self._lock:
            dead = []
            for q in self._subs:
                try:
                    q.put_nowait(message)
                except queue.Full:
                    dead.append(q)
            for q in dead:
                self._subs.discard(q)

    def _set_status(self, state: str, **extra) -> None:
        self._status = {"state": state, "gamePk": self.game_pk, "replay": self.replay, **extra}
        self._broadcast("status", self._status)

    # --- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._run, name=f"feed-{self.game_pk}", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def snapshot(self) -> dict | None:
        return self._snapshot

    # --- the poll loop -----------------------------------------------------

    def _fetch(self) -> dict:
        if not self.replay:
            return mlb_api.get_live_feed(self.game_pk)

        if not self._timestamps:
            self._timestamps = mlb_api.get_timestamps(self.game_pk)
        if not self._timestamps:
            raise RuntimeError("no timecodes available for replay")

        # Advance through the game's recorded snapshots; `speed` timecodes per
        # tick means a 3-hour game replays in minutes.
        self._tc_index = min(self._tc_index + int(self.speed), len(self._timestamps) - 1)
        tc = self._timestamps[self._tc_index]
        return mlb_api.get_live_feed(self.game_pk, timecode=tc)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                feed = self._fetch()
            except Exception as exc:
                self._set_status("error", error=f"{type(exc).__name__}: {exc}")
                if self._stop.wait(ERROR_BACKOFF):
                    break
                continue

            try:
                # The event stream: unchanged prototype extractor.
                events = game_state.extract_new_events(
                    feed, self.game_pk, self._seen_events, self._seen_results)

                # The snapshot: everything the UI renders right now.
                snap = projection.snapshot(feed)
                self._snapshot = snap
                self._broadcast("snapshot", snap)
                for ev in events:
                    self._broadcast("play", ev)
            except Exception:
                self._set_status("error", error="projection failed")
                traceback.print_exc()
                if self._stop.wait(ERROR_BACKOFF):
                    break
                continue

            status = snap["game"]["status"]
            replay_done = self.replay and self._tc_index >= len(self._timestamps) - 1

            if status == "final" or replay_done:
                self._set_status("complete", detail=snap["game"]["detailedStatus"])
                break

            self._set_status("live" if status == "live" else "waiting",
                             detail=snap["game"]["detailedStatus"])

            interval = self._interval(status)
            if self._stop.wait(interval):
                break

            # No listeners for a while -> stop burning requests.
            if self.subscriber_count == 0 and \
                    time.monotonic() - self._last_unsub_at > IDLE_GRACE:
                break

        # Mark the feed dead so FeedHub replaces it instead of handing out a
        # terminal one. Without this a finished feed keeps its spent state --
        # seen-event sets full, replay cursor parked at the last timecode -- and
        # the next subscriber gets "here is the final score, complete" the
        # instant it connects, with no way to restart a replay.
        self._stop.set()
        self._set_status("stopped")

    def _interval(self, status: str) -> float:
        if self.replay:
            return 1.0
        return LIVE_INTERVAL if status == "live" else PREGAME_INTERVAL


class FeedHub:
    """Keeps one GameFeed per (gamePk, mode) and hands out subscriptions."""

    def __init__(self):
        self._feeds: dict[tuple[int, bool], GameFeed] = {}
        self._lock = threading.Lock()

    def get(self, game_pk: int, replay: bool = False, speed: float = 6.0) -> GameFeed:
        key = (game_pk, replay)
        with self._lock:
            feed = self._feeds.get(key)
            if feed is None or feed._stop.is_set():
                feed = GameFeed(game_pk, replay=replay, speed=speed)
                self._feeds[key] = feed
            return feed

    def shutdown(self) -> None:
        with self._lock:
            for feed in self._feeds.values():
                feed.stop()
