/* ---------------------------------------------------------------------------
   Client for the Python backend (server/app.py).

   Two transports:
     fetchGames()/fetchSnapshot() — plain REST, used for the game list and for a
       first paint before the stream warms up
     openGameStream()             — EventSource; the backend pushes a fresh
       `snapshot` on every poll plus one `play` per new pitch / completed at-bat

   EventSource reconnects on its own, so there is no retry logic here — we just
   surface the connection state so the UI can say so.
--------------------------------------------------------------------------- */

const API = '/api';

async function getJSON(path, { signal } = {}) {
  const res = await fetch(`${API}${path}`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
  }
  return res.json();
}

export function fetchHealth(opts) {
  return getJSON('/health', opts);
}

/**
 * Today's scoreboard.
 *
 * Returns the staleness flags too: when statsapi is unreachable the backend
 * serves its last good board rather than failing, and says so.
 */
export async function fetchGames({ date, signal } = {}) {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  const payload = await getJSON(`/games${qs}`, { signal });
  return {
    games: payload.games ?? [],
    stale: Boolean(payload.stale),
    ageSeconds: payload.ageSeconds ?? 0,
  };
}

/**
 * Advanced-stat league leaders. Cached hard on the backend (10 min) because
 * these move once a day at most.
 *
 * `per` is names per category — the home page's boards show five, the full
 * page asks for fifty. The backend builds at the larger depth either way and
 * slices, so expanding a board costs no extra upstream work.
 */
export async function fetchLeaders({ season, per, signal } = {}) {
  const params = new URLSearchParams();
  if (season) params.set('season', season);
  if (per) params.set('per', String(per));
  const qs = params.toString();
  return getJSON(`/leaders${qs ? `?${qs}` : ''}`, { signal });
}

/** One player card for someone outside the current game (e.g. a league leader). */
export function fetchPlayer(personId, { season, signal } = {}) {
  const qs = season ? `?season=${encodeURIComponent(season)}` : '';
  return getJSON(`/player/${personId}${qs}`, { signal });
}

export function fetchSnapshot(gamePk, opts) {
  return getJSON(`/game/${gamePk}`, opts);
}

/**
 * Per-pitch bat speed and spin rate for one game, from Baseball Savant — the
 * two numbers the statsapi feed does not carry. Rows are keyed by at-bat index
 * and pitch number: `{ pitches: [{ ab, n, batSpeed, spinRate }] }`.
 */
export function fetchGameStatcast(gamePk, opts) {
  return getJSON(`/game/${gamePk}/statcast`, opts);
}

/**
 * Subscribe to one game.
 *
 * @param {number|string} gamePk
 * @param {object} handlers   { onSnapshot, onPlay, onStatus, onError }
 * @param {object} [options]  { replay: boolean, speed: number }
 * @returns {() => void}      unsubscribe
 */
export function openGameStream(gamePk, handlers = {}, options = {}) {
  const params = new URLSearchParams();
  if (options.replay) {
    params.set('replay', '1');
    if (options.speed) params.set('speed', String(options.speed));
  }
  const qs = params.toString();
  const source = new EventSource(`${API}/stream/${gamePk}${qs ? `?${qs}` : ''}`);

  const parse = (fn) => (event) => {
    if (!fn) return;
    try {
      fn(JSON.parse(event.data));
    } catch (err) {
      handlers.onError?.(err);
    }
  };

  source.addEventListener('snapshot', parse(handlers.onSnapshot));
  source.addEventListener('play', parse(handlers.onPlay));
  source.addEventListener('status', parse(handlers.onStatus));

  source.onopen = () => handlers.onStatus?.({ state: 'open' });
  // EventSource fires `error` on every disconnect and then retries by itself;
  // report it as a transient state rather than a failure.
  source.onerror = () => handlers.onStatus?.({ state: 'reconnecting' });

  return () => {
    source.close();
  };
}

/**
 * URL options, all optional:
 *   ?replay=1        re-run a completed game as though it were live
 *   &speed=8         replay timecodes consumed per tick (higher = faster)
 *   &gamePk=822940   stream this game specifically, even from another date
 *   &date=2026-08-16 browse another day's scoreboard
 */
export function readReplayOptions(search = window.location.search) {
  const params = new URLSearchParams(search);
  const replay = ['1', 'true', 'yes'].includes((params.get('replay') || '').toLowerCase());
  const speed = Number(params.get('speed')) || 6;
  const gamePk = params.get('gamePk') || params.get('game') || null;
  const date = params.get('date') || null;
  return { replay, speed, gamePk, date };
}
