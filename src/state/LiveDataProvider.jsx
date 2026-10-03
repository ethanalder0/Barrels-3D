import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchGames, fetchSnapshot, openGameStream, readReplayOptions } from '../data/liveClient.js';
import {
  atBats as stubAtBats,
  boxScoreBatters,
  boxScorePitchers,
  games as stubGames,
  getGame as getStubGame,
  lineScore as stubLineScore,
  players as stubPlayers,
} from '../data/stubs.js';
import { useAppState } from './AppState.jsx';

/* ---------------------------------------------------------------------------
   Owns the connection to the Python backend and hands the shell a single shape
   whether the data is live or stubbed.

   The backend's projection (server/projection.py) emits the same field names as
   stubs.js, so `mode: 'demo'` is a genuine fallback rather than a second code
   path — every component below renders one shape.

   Replay mode: add ?replay=1 (optionally &speed=8) to the frontend URL to
   re-run a completed game as though it were live. Useful when nothing is on.
--------------------------------------------------------------------------- */

const GAMES_REFRESH_MS = 30_000;
const MAX_PLAYS = 40;

const LiveDataContext = createContext(null);

/** stubs.js in the shape a backend snapshot arrives in. */
function demoSnapshot(gameId) {
  const game = getStubGame(gameId);
  return {
    game,
    lineScore: stubLineScore,
    bases: { first: 'A. Whitfield', second: null, third: 'M. Boone' },
    matchup: { batter: 'R. Nakamura', onDeck: 'J. Castellanos', pitcher: 'K. Feldman' },
    boxScore: {
      home: { batters: boxScoreBatters, pitchers: boxScorePitchers },
      away: { batters: boxScoreBatters, pitchers: boxScorePitchers },
    },
    atBats: stubAtBats,
    players: stubPlayers,
    meta: { demo: true },
  };
}

export function LiveDataProvider({ children }) {
  const { state, actions } = useAppState();
  const replayOptions = useMemo(() => readReplayOptions(), []);

  const [mode, setMode] = useState('connecting'); // 'connecting' | 'live' | 'demo'
  const [connection, setConnection] = useState('connecting');
  const [games, setGames] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [plays, setPlays] = useState([]);
  const [error, setError] = useState(null);

  const hydratedRef = useRef(false);
  // Have we ever had real data? Decides whether a failure is worth falling
  // back to placeholders over.
  const hadLiveRef = useRef(false);
  const [stale, setStale] = useState(null);

  // --- scoreboard --------------------------------------------------------
  // Nothing is fetched until sign-in: no point polling MLB while the splash is
  // up, and it keeps the landing screen free of network work.
  const scoreboardDate = state.scoreboardDate;

  useEffect(() => {
    if (!state.authed) return undefined;

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      try {
        const payload = await fetchGames({ date: scoreboardDate, signal: controller.signal });
        if (cancelled) return;
        setGames(payload.games);
        setMode('live');
        setError(null);
        setStale(payload.stale ? payload.ageSeconds : null);
        hadLiveRef.current = true;
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return;
        setError(err.message);

        // Only fall back to placeholders if we have NEVER had real data — that
        // means the backend isn't running. Once real games are on screen, a
        // transient upstream blip must not replace them with fictional teams;
        // the previous board stays up until a later poll succeeds.
        if (!hadLiveRef.current) {
          setGames(stubGames);
          setMode('demo');
          setConnection('offline');
        }
      }
    };

    load();
    const timer = setInterval(load, GAMES_REFRESH_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [state.authed, scoreboardDate]);

  /* A new day needs a new default game. Without this the one-shot hydration
     below stays latched from the first load and the games screen shows one
     date while the scorebug still holds a game from another. */
  useEffect(() => {
    hydratedRef.current = false;
    setSnapshot(null);
    setPlays([]);
  }, [scoreboardDate]);

  // Point the app at a real gamePk once the scoreboard lands: prefer the game
  // named in the URL, then anything live, then the next one scheduled.
  useEffect(() => {
    if (mode !== 'live' || hydratedRef.current || !games?.length) return;
    hydratedRef.current = true;

    const requested = replayOptions.gamePk && games.find((g) => g.id === String(replayOptions.gamePk));
    const target =
      requested ||
      games.find((g) => g.status === 'live') ||
      /* On a past date nothing is live and nothing is upcoming, so prefer a
         completed game — it is the only kind that carries tracked at-bats. */
      games.find((g) => g.status === 'final') ||
      games.find((g) => g.status === 'scheduled') ||
      games[0];

    if (target && target.id !== state.selectedGameId) actions.hydrateGame(target.id);
  }, [mode, games, replayOptions.gamePk, state.selectedGameId, actions]);

  // --- one game's stream --------------------------------------------------
  // An explicit ?gamePk wins outright: it may name a game from another date,
  // which by definition won't be in the scoreboard we just loaded. The snapshot
  // carries its own game object, so the UI still has everything it needs.
  const selectedGame = useMemo(
    () => games?.find((g) => g.id === state.selectedGameId) ?? null,
    [games, state.selectedGameId],
  );

  const gamePk = useMemo(() => {
    if (replayOptions.gamePk) return Number(replayOptions.gamePk);
    return selectedGame?.gamePk ?? null;
  }, [replayOptions.gamePk, selectedGame]);

  /* A finished game is fetched once over REST rather than streamed. There is
     nothing to push — the backend stops polling a game the moment it goes
     Final — so a subscription would be an open connection waiting on events
     that can never arrive. One snapshot carries the whole game's at-bats,
     which is all the replay engine wants from a game that is already over.
     An explicit ?gamePk still streams, because that is how replay mode
     re-runs a completed game as though it were live. */
  const completed = !replayOptions.gamePk && selectedGame?.status === 'final';

  useEffect(() => {
    if (!state.authed || mode !== 'live' || !gamePk || !completed) return undefined;

    let cancelled = false;
    const controller = new AbortController();
    setConnection('connecting');
    setPlays([]);

    fetchSnapshot(gamePk, { signal: controller.signal })
      .then((snap) => {
        if (cancelled) return;
        setSnapshot(snap);
        setError(null);
        setConnection('complete');
      })
      .catch((err) => {
        if (cancelled || err.name === 'AbortError') return;
        setError(err.message);
        setConnection('error');
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [state.authed, mode, gamePk, completed]);

  useEffect(() => {
    if (!state.authed || mode !== 'live' || !gamePk || completed) return undefined;

    setConnection('connecting');
    setPlays([]);

    const close = openGameStream(
      gamePk,
      {
        onSnapshot: (snap) => {
          setSnapshot(snap);
          setError(null);
        },
        onPlay: (play) => {
          setPlays((prev) => [play, ...prev].slice(0, MAX_PLAYS));
        },
        onStatus: (status) => {
          setConnection(status.state ?? 'unknown');
          if (status.error) setError(status.error);
        },
        onError: (err) => setError(err.message),
      },
      { replay: replayOptions.replay, speed: replayOptions.speed },
    );

    return () => {
      close();
      setConnection('closed');
    };
  }, [state.authed, mode, gamePk, completed, replayOptions.replay, replayOptions.speed]);

  // --- resolve what the UI reads ----------------------------------------
  const resolved = useMemo(() => {
    if (mode === 'live' && snapshot) return snapshot;
    if (mode === 'demo') return demoSnapshot(state.selectedGameId);
    return null; // still connecting; components show a loading state
  }, [mode, snapshot, state.selectedGameId]);

  // Keep the selection valid: follow the newest at-bat, or fall back to it if
  // the selected one vanished (game change, replay rewind).
  const atBats = resolved?.atBats ?? [];
  useEffect(() => {
    if (!atBats.length) return;
    const exists = atBats.some((ab) => ab.id === state.selectedAtBatId);
    const newest = atBats[0];
    if (!exists) {
      actions.selectAtBat(newest.id, { auto: true });
    } else if (state.followLatest && state.selectedAtBatId !== newest.id) {
      actions.selectAtBat(newest.id, { auto: true });
    }
  }, [atBats, state.selectedAtBatId, state.followLatest, actions]);

  const value = useMemo(() => {
    const list = games ?? [];
    const game =
      resolved?.game ?? list.find((g) => g.id === state.selectedGameId) ?? null;

    return {
      mode,
      connection,
      error,
      replay: replayOptions,
      stale,
      games: list,
      game,
      lineScore: resolved?.lineScore ?? null,
      bases: resolved?.bases ?? { first: null, second: null, third: null },
      matchup: resolved?.matchup ?? {},
      boxScore: resolved?.boxScore ?? { home: { batters: [], pitchers: [] }, away: { batters: [], pitchers: [] } },
      atBats: resolved?.atBats ?? [],
      players: resolved?.players ?? {},
      plays,
      ready: Boolean(resolved),
    };
  }, [mode, connection, error, replayOptions, stale, games, resolved, plays, state.selectedGameId]);

  return <LiveDataContext.Provider value={value}>{children}</LiveDataContext.Provider>;
}

export function useLiveData() {
  const ctx = useContext(LiveDataContext);
  if (!ctx) throw new Error('useLiveData must be used inside <LiveDataProvider>');
  return ctx;
}
