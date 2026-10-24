import { useEffect, useState } from 'react';
import { useAppState } from '../state/AppState.jsx';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import { favoritesFirst, isFavoriteGame } from '../data/favorites.js';
import { fetchGames, localISODay } from '../data/liveClient.js';
import { teamFor } from '../data/teamStyle.js';
import TeamLogo from '../components/TeamLogo.jsx';
import { loserOf } from '../data/gameStatus.js';

/* Three columns, always in this order, so the page is scanned the same way
   every day: what is on, what is coming, what is done. */
const SECTIONS = [
  { id: 'live', label: 'Live now', none: 'Nothing in progress.' },
  { id: 'scheduled', label: 'Upcoming', none: 'Nothing still to start.' },
  { id: 'final', label: 'Final', none: 'Nothing finished yet.' },
];

/* Local calendar days, not UTC ones. `toISOString()` is a day out for anyone
   west of Greenwich after their evening games start, which is exactly when
   somebody would be looking up yesterday's scores. */
const isoDay = localISODay;
const todayISO = () => isoDay(new Date());

function shiftDay(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDay(new Date(y, m - 1, d + delta));
}

const dayOf = (iso, opts) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, opts);

/** The scoreboard for any day: three columns of game cards, or an empty day. */
export default function GameListScreen() {
  const { state, actions } = useAppState();
  const { games, mode, error, stale } = useLiveData();

  // `scoreboardDate` is null for today, so the app needs no date to open.
  const date = state.scoreboardDate ?? todayISO();
  const isToday = date === todayISO();
  const heading = dayOf(date, { weekday: 'long', month: 'long', day: 'numeric' });

  /* Going forward from today would only ever show an empty board, so the
     control stops there rather than offering days that cannot have games. */
  const goto = (next) => actions.setScoreboardDate(next === todayISO() ? null : next);

  return (
    <div className="games">
      <header className="page-head">
        <div>
          <h1>Games</h1>
          <p className="page-head__deck">
            {heading}
            {mode === 'demo' && ' · placeholder data (backend not reachable)'}
            {mode === 'live' && stale != null && (
              <>
                {' · '}
                <span className="stale-note">cached {formatAge(stale)} ago, live feed unreachable</span>
              </>
            )}
          </p>
        </div>

        <div className="page-head__aside">
          <div className="datebox">
            <button
              type="button"
              className="datebox__step"
              onClick={() => goto(shiftDay(date, -1))}
              aria-label="Previous day"
            >
              ‹
            </button>
            <input
              type="date"
              className="datebox__input"
              value={date}
              max={todayISO()}
              onChange={(e) => e.target.value && goto(e.target.value)}
              aria-label="Scoreboard date"
            />
            <button
              type="button"
              className="datebox__step"
              onClick={() => goto(shiftDay(date, 1))}
              disabled={isToday}
              aria-label="Next day"
            >
              ›
            </button>
            <button
              type="button"
              className="datebox__today"
              aria-pressed={isToday}
              onClick={() => goto(todayISO())}
            >
              Today
            </button>
          </div>
          <span className="games__count" data-none={games.length === 0 || undefined}>
            {games.length} game{games.length === 1 ? '' : 's'}
          </span>
        </div>
      </header>

      {mode === 'demo' && error && (
        <p className="notice">
          Live feed unavailable: <code>{error}</code>. Start the backend with{' '}
          <code>python server/app.py</code> to stream real games.
        </p>
      )}

      {games.length === 0 ? (
        <EmptyDay date={date} isToday={isToday} onGoto={goto} demo={mode === 'demo'} />
      ) : (
        <div className="games__columns">
          {SECTIONS.map((section) => {
            /* Favourites to the top of each column rather than into a column
               of their own: the live/upcoming/final split is what you scan the
               page by, and lifting a followed club out of it would hide a game
               of theirs that is already over. */
            const list = favoritesFirst(
              games.filter((g) => g.status === section.id),
              state.favorites,
            );

            return (
              <section className="games__col" key={section.id} aria-label={section.label}>
                <h2 className="games__colhead">
                  <span>{section.label}</span>
                  <span className="games__rule" aria-hidden="true" />
                  <span className="u-num">{list.length}</span>
                </h2>
                {list.length === 0 ? (
                  <p className="games__none">{section.none}</p>
                ) : (
                  <div className="games__stack">
                    {list.map((game) => (
                      <GameCard
                        key={game.id}
                        game={game}
                        current={game.id === state.selectedGameId}
                        favorite={isFavoriteGame(game, state.favorites)}
                        onSelect={() => actions.selectGame(game.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatAge(seconds) {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)}m`;
}

const ACTION = { live: 'Watch', scheduled: 'Preview', final: 'Replay' };

function GameCard({ game, current, favorite, onSelect }) {
  const st = game.state;
  const loser = loserOf(game);
  const started = game.status !== 'scheduled';

  const status =
    game.status === 'live' && st
      ? `${st.half === 'top' ? '▲' : '▼'} ${st.half === 'top' ? 'Top' : 'Bot'} ${st.inning}`
      : game.status === 'final'
        ? 'Final'
        : game.startsAt;

  let detail;
  if (st) {
    detail = `${st.outs ?? 0} out${st.outs === 1 ? '' : 's'}`;
    // "In Progress" says nothing the column head hasn't; a delay does.
    if (game.detailedStatus && game.detailedStatus !== 'In Progress') detail += ` · ${game.detailedStatus}`;
  } else {
    detail =
      game.detailedStatus || (game.status === 'final' ? 'Completed' : `First pitch ${game.startsAt}`);
  }

  return (
    <button
      type="button"
      className="gcard"
      aria-current={current}
      data-status={game.status}
      onClick={onSelect}
    >
      {/* Both clubs along the top edge — the card is about a matchup. */}
      <span className="gcard__bar" aria-hidden="true">
        <span style={{ background: teamFor(game.away.abbr)?.primary }} />
        <span style={{ background: teamFor(game.home.abbr)?.primary }} />
      </span>

      <span className="gcard__head">
        <span className="gcard__status">
          {favorite && (
            <span className="gcard__fav" aria-label="One of your teams">
              ★{' '}
            </span>
          )}
          {status}
        </span>
        <span className="gcard__venue">{game.venue}</span>
      </span>

      <span className="gcard__teams">
        {['away', 'home'].map((side) => (
          <span className="gcard__row" key={side} data-lost={loser === side || undefined}>
            <TeamLogo abbr={game[side].abbr} size={34} />
            <span className="gcard__name">{game[side].name}</span>
            <span className="gcard__runs u-num">{started ? (game[side].runs ?? '–') : ''}</span>
          </span>
        ))}
      </span>

      <span className="gcard__foot">
        <span className="gcard__detail">{detail}</span>
        {current ? (
          <span className="gcard__cta gcard__cta--on">Watching</span>
        ) : (
          <span className="gcard__cta">
            {ACTION[game.status] ?? 'Open'} <span aria-hidden="true">→</span>
          </span>
        )}
      </span>
    </button>
  );
}

/* --- An empty day ------------------------------------------------------------ */

/* How far to look for the nearest day with games. Two months covers the All-
   Star break and the gap after the World Series without hunting forever. */
const LOOKBACK_DAYS = 60;
const PROBE_BATCH = 10;

/**
 * Nearest earlier day that had games, and the next day after this one (up to
 * today) that does — so an empty board offers a way out instead of a dead end.
 * Probed against the same scoreboard endpoint the page uses, a batch of days
 * at a time, nearest first.
 */
function useNearbyGameDays(date, isToday, enabled) {
  const [found, setFound] = useState({ date: null, prev: undefined, next: undefined });

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    setFound({ date, prev: undefined, next: undefined });

    const hasGames = (iso) =>
      fetchGames({ date: iso, signal: controller.signal })
        .then((r) => r.games.length > 0)
        .catch(() => false);

    // Days in one direction, nearest first, stopping at the first with games.
    const search = async (step, limit) => {
      for (let start = 1; start <= limit; start += PROBE_BATCH) {
        const days = [];
        for (let i = start; i < start + PROBE_BATCH && i <= limit; i++) {
          days.push(shiftDay(date, step * i));
        }
        const hits = await Promise.all(days.map(hasGames));
        if (cancelled) return null;
        const at = hits.indexOf(true);
        if (at >= 0) return days[at];
      }
      return null;
    };

    // Forward only as far as today: the board offers nothing past it.
    const ahead = isToday
      ? 0
      : Math.round((new Date(`${todayISO()}T12:00`) - new Date(`${date}T12:00`)) / 864e5);
    search(-1, LOOKBACK_DAYS).then((prev) => !cancelled && setFound((f) => ({ ...f, date, prev })));
    search(1, ahead).then((next) => !cancelled && setFound((f) => ({ ...f, date, next })));

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [date, isToday, enabled]);

  return found.date === date ? found : { prev: undefined, next: undefined };
}

function EmptyDay({ date, isToday, onGoto, demo }) {
  const { prev, next } = useNearbyGameDays(date, isToday, !demo);
  const short = (iso) => dayOf(iso, { month: 'short', day: 'numeric' });

  return (
    <section className="emptyday">
      <div>
        <p className="u-kicker">No games scheduled</p>
        <h2 className="emptyday__title">The diamond’s dark {isToday ? 'tonight' : 'that day'}.</h2>
        <p className="emptyday__text">
          Nothing was on the schedule for {dayOf(date, { weekday: 'long', month: 'long', day: 'numeric' })}.
          Every replay from the season is still here, so step back to the last day with baseball.
        </p>
      </div>

      <div className="emptyday__links">
        <button
          type="button"
          className="emptyday__link"
          disabled={!prev}
          onClick={() => prev && onGoto(prev)}
        >
          <span>Jump to last game day</span>
          <span className="u-num">
            {prev ? `${short(prev)} →` : prev === undefined && !demo ? 'Looking…' : '—'}
          </span>
        </button>
        {!isToday && (
          <button
            type="button"
            className="emptyday__link"
            disabled={!next}
            onClick={() => next && onGoto(next)}
          >
            <span>Next game day</span>
            <span className="u-num">
              {next ? `${short(next)} →` : next === undefined && !demo ? 'Looking…' : '—'}
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
