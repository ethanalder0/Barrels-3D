import { useEffect, useState } from 'react';
import { useAppState } from '../state/AppState.jsx';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import { fetchLeaders } from '../data/liveClient.js';
import { favoritesFirst, isFavoriteGame } from '../data/favorites.js';
import { loserOf, statusLine } from '../data/gameStatus.js';
import PlayerName from '../components/PlayerName.jsx';
import TeamLogo from '../components/TeamLogo.jsx';

/* ---------------------------------------------------------------------------
   Landing screen.

   A LANDING PAGE, NOT A PITCH. Everything above the leaderboards answers one
   question, which is what a landing page is for: what is on right now, and
   how do I get into it.

     · the masthead — what day it is, and the way in
     · today's slate, as three counts in a ruled box beside it
     · a ticker of the games themselves, favourite clubs first

   The leaderboards below are deliberately sabermetric (WAR, wRC+, wOBA, FIP,
   ERA-) rather than the usual batting-average-and-RBI set; see
   server/leaders.py for where they come from and why the sort has to be done
   ourselves.
--------------------------------------------------------------------------- */

/* How many games the ticker shows before deferring to the full schedule: one
   row of six on a wide window. */
const TICKER_LIMIT = 6;

const todayLabel = () =>
  new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export default function HomeScreen() {
  const { state, actions } = useAppState();
  const { games, mode, error } = useLiveData();

  const live = games.filter((g) => g.status === 'live');
  const upcoming = games.filter((g) => g.status === 'scheduled');
  const final = games.filter((g) => g.status === 'final');

  /* Followed clubs first, then whatever else is live, then the rest of the
     day. One ordered list rather than a section each: three sections would
     leave the page half empty in the morning, when nothing is live yet. */
  const ticker = favoritesFirst(
    [...live, ...games.filter((g) => g.status !== 'live')],
    state.favorites,
  ).slice(0, TICKER_LIMIT);

  return (
    <div className="home">
      <section className="hero">
        <div className="hero__text">
          <span className="u-kicker">Welcome · {todayLabel()}</span>
          <h1 className="hero__title">
            Every <span className="u-nowrap">at-bat</span>, rebuilt in <em>three dimensions.</em>
          </h1>
          <button
            type="button"
            className="btn btn--primary hero__cta"
            onClick={() => actions.navigate(live.length ? 'live' : 'games')}
          >
            {live.length ? 'Watch a live game' : 'Browse today’s games'}
            <span aria-hidden="true">→</span>
          </button>
        </div>

        <div className="slatebox" aria-label="Today at a glance">
          <div className="slatebox__head">
            <span>Today’s slate</span>
            <span>
              {games.length} game{games.length === 1 ? '' : 's'}
            </span>
          </div>
          <SlateStat value={live.length} label={live.length === 1 ? 'Game live' : 'Games live'} />
          <SlateStat value={upcoming.length} label="Still to start" />
          <SlateStat value={final.length} label="Final" />
        </div>
      </section>

      {mode === 'demo' && (
        <p className="notice">
          Showing placeholder data — the live backend isn’t reachable
          {error ? ` (${error})` : ''}. Run <code>python server/app.py</code> for real games
          and league leaders.
        </p>
      )}

      {ticker.length > 0 && (
        <div className="ticker" aria-label="Today’s games">
          {ticker.map((game) => (
            <TickerGame
              key={game.id}
              game={game}
              favorite={isFavoriteGame(game, state.favorites)}
              onSelect={() => actions.selectGame(game.id)}
            />
          ))}
        </div>
      )}

      <Leaders demo={mode === 'demo'} />
    </div>
  );
}

function SlateStat({ value, label }) {
  return (
    <div className="slatebox__row">
      <span className="slatebox__value u-num">{value}</span>
      <span className="slatebox__label">{label}</span>
    </div>
  );
}

/* --- Today's games ------------------------------------------------------- */

function TickerGame({ game, favorite, onSelect }) {
  const [status, detail] = statusLine(game);
  const loser = loserOf(game);

  return (
    <button
      type="button"
      className="ticker__game"
      data-live={game.status === 'live' || undefined}
      onClick={onSelect}
      title={`${game.away.name} at ${game.home.name}`}
    >
      <span className="ticker__status">
        <span>
          {favorite && (
            <span className="ticker__fav" aria-label="One of your teams">
              ★{' '}
            </span>
          )}
          {status}
        </span>
        <span>{detail}</span>
      </span>
      {['away', 'home'].map((side) => (
        <span className="ticker__team" key={side} data-lost={loser === side || undefined}>
          <TeamLogo abbr={game[side].abbr} size={18} />
          <span className="ticker__abbr">{game[side].abbr}</span>
          <span className="ticker__runs u-num">
            {game.status === 'scheduled' ? '' : (game[side].runs ?? '–')}
          </span>
        </span>
      ))}
    </button>
  );
}

/* --- League leaders ------------------------------------------------------ */

function Leaders({ demo }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (demo) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    fetchLeaders({ signal: controller.signal })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled && err.name !== 'AbortError') setError(err.message);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [demo]);

  return (
    <section className="leaders" aria-label="League leaders">
      <div className="leaders__head">
        <h2>League leaders</h2>
        <p className="leaders__deck">
          {data
            ? `${data.season} season · qualified players only`
            : 'Advanced statistics, qualified players only'}
          {data?.stale && <span className="stale-note"> · cached, live feed unreachable</span>}
        </p>
        <span className="chip leaders__chip">Advanced</span>
      </div>

      {demo && <p className="leaders__empty">League leaders need the live backend.</p>}
      {!demo && error && <p className="notice">Couldn’t load leaders — <code>{error}</code></p>}
      {!demo && !error && !data && <LeaderSkeleton />}

      {data && (
        <div className="leaders__grid">
          {data.groups.map((group) => [
            <h3 className="leaders__group" key={`${group.id}-label`}>
              {group.label}
            </h3>,
            ...group.categories.map((cat) => (
              <LeaderBoard key={`${group.id}-${cat.id}`} groupId={group.id} category={cat} />
            )),
          ])}
        </div>
      )}
    </section>
  );
}

/**
 * How far along its row a leader's bar runs: the value against the best on
 * the board. Inverted where lower is better (FIP, ERA-), so the leader's bar
 * is always the full row and everyone else's is shorter.
 */
function barWidth(value, best, lowerIsBetter) {
  if (!Number.isFinite(value) || !Number.isFinite(best) || value <= 0 || best <= 0) return 0;
  return Math.min(1, lowerIsBetter ? best / value : value / best);
}

function LeaderBoard({ groupId, category }) {
  const { actions } = useAppState();
  const values = category.leaders.map((r) => r.value);
  const best = category.lowerIsBetter ? Math.min(...values) : Math.max(...values);

  return (
    <article className="board">
      <header className="board__head">
        <h4 className="board__stat">{category.label}</h4>
        <p className="board__desc">{category.description}</p>
      </header>
      <ol className="board__list">
        {category.leaders.map((row) => (
          <li className="board__row" key={`${row.rank}-${row.playerId}`}>
            <span className="board__rank u-num">{row.rank}</span>
            <TeamLogo abbr={row.teamAbbr} size={28} />
            <PlayerName
              playerId={row.playerId}
              name={row.name}
              className="board__name"
              title={row.teamName ? `${row.name} — ${row.teamName}` : row.name}
            />
            <span className="board__value u-num">{row.display}</span>
            <span
              className="board__bar"
              aria-hidden="true"
              style={{ width: `${barWidth(row.value, best, category.lowerIsBetter) * 100}%` }}
            />
          </li>
        ))}
      </ol>

      {/* Five names is a landing page; fifty is somewhere to explore. The full
          board is a page rather than an expand-in-place, because at fifty rows
          three of these side by side stop being scannable. */}
      <button
        type="button"
        className="board__more"
        onClick={() => actions.openLeaderboard(groupId, category.id)}
      >
        See top 50 <span aria-hidden="true">→</span>
      </button>
    </article>
  );
}

function LeaderSkeleton() {
  return (
    <div className="leaders__grid" aria-busy="true">
      <span className="leaders__group" />
      {[0, 1, 2].map((i) => (
        <div className="board" key={i}>
          <div className="skeleton" style={{ height: 30, width: '40%', margin: '14px 0' }} />
          {[0, 1, 2, 3, 4].map((r) => (
            <div className="skeleton" key={r} style={{ height: 18, margin: '16px 0' }} />
          ))}
        </div>
      ))}
    </div>
  );
}
