"""Per-visitor limits, so one browser cannot turn the backend against MLB.

Every API call can end up as an upstream request to statsapi or Savant, and on
a public host anyone can make them. Left open, one script looping over player
ids -- or opening a stream to every gamePk it can think of -- is a stream of
requests to MLB from OUR address, and the likely end of that is the server's
IP being blocked, which takes the site down for everyone.

Two limits, both deliberately loose. Normal use is a scoreboard refresh every
30 s, a Statcast refresh every 30 s while a game is live, and a click here and
there; the numbers below are an order of magnitude past that, because a school
or office network puts a lot of real visitors behind one address.

  RequestLimiter   a token bucket per client address for plain API requests
  StreamLimiter    how many live streams one address may hold open at once

The address is the socket's peer, or -- behind a proxy that says so, like the
Heroku router -- the last hop in X-Forwarded-For, which is the one the proxy
itself appended and the only one a client cannot forge. See client_address().
"""

from __future__ import annotations

import os
import threading
import time

# Bucket size and refill. 120 requests at once, then two a second.
BURST = 120
REFILL_PER_SECOND = 2.0

# Concurrent live streams per address: several tabs, not a crawler.
STREAMS_PER_CLIENT = 6

# Buckets idle this long are forgotten, so the table cannot grow without bound.
IDLE_SECONDS = 600.0

# Set by the deploy (see Dockerfile). Off locally, where there is no proxy and
# trusting the header would let any client pick its own address.
TRUST_PROXY = os.environ.get("TRUST_PROXY", "").lower() in ("1", "true", "yes")


def client_address(handler) -> str:
    """The visitor's address, as far as it can be trusted."""
    if TRUST_PROXY:
        forwarded = handler.headers.get("X-Forwarded-For", "")
        hops = [h.strip() for h in forwarded.split(",") if h.strip()]
        if hops:
            return hops[-1]
    return handler.client_address[0]


class RequestLimiter:
    """A token bucket per client address."""

    def __init__(self, burst: int = BURST, rate: float = REFILL_PER_SECOND):
        self.burst = burst
        self.rate = rate
        self._buckets: dict[str, tuple[float, float]] = {}  # addr -> (tokens, at)
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def allow(self, addr: str) -> bool:
        now = time.monotonic()
        with self._lock:
            tokens, at = self._buckets.get(addr, (float(self.burst), now))
            tokens = min(self.burst, tokens + (now - at) * self.rate)
            allowed = tokens >= 1.0
            self._buckets[addr] = (tokens - 1.0 if allowed else tokens, now)
            self._sweep(now)
            return allowed

    def _sweep(self, now: float) -> None:
        if now - self._last_sweep < IDLE_SECONDS:
            return
        self._last_sweep = now
        cutoff = now - IDLE_SECONDS
        for addr in [a for a, (_, at) in self._buckets.items() if at < cutoff]:
            del self._buckets[addr]


class StreamLimiter:
    """Counts open streams per client address."""

    def __init__(self, per_client: int = STREAMS_PER_CLIENT):
        self.per_client = per_client
        self._open: dict[str, int] = {}
        self._lock = threading.Lock()

    def acquire(self, addr: str) -> bool:
        with self._lock:
            n = self._open.get(addr, 0)
            if n >= self.per_client:
                return False
            self._open[addr] = n + 1
            return True

    def release(self, addr: str) -> None:
        with self._lock:
            n = self._open.get(addr, 0) - 1
            if n > 0:
                self._open[addr] = n
            else:
                self._open.pop(addr, None)
