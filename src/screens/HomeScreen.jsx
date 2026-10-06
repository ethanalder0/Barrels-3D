import { useEffect, useState } from 'react';
import { useAppState } from '../state/AppState.jsx';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import { fetchLeaders } from '../data/liveClient.js';
import { teamVars } from '../data/teamStyle.js';
import { favoritesFirst, isFavoriteGame } from '../data/favorites.js';
import PlayerName from '../components/PlayerName.jsx';
import TeamLogo from '../components/TeamLogo.jsx';
import { IconChevron, IconStar } from '../components/Icons.jsx';

/* ---------------------------------------------------------------------------
   Landing screen.

   A LANDING PAGE, NOT A PITCH. This used to open with a paragraph of lede and
   three cards explaining what the app does — how the poller works, what the
   strike-zone plot is drawn from, that the replay engine is coming. Nobody who
   has just signed in needs any of that: they know what they opened, and it
   pushed the only thing they came for — today's games — below the fold.

   So everything above the leaderboards now answers one question, which is what
   a landing page is for: what is on right now, and how do I get into it.

     · a masthead — who is signed in, what day it is, and the two ways in
     · today's slate, as three counts, with live ones in the accent
     · the games themselves, as tiles, favourite clubs first

   The leaderboards below are unchanged. They are deliberately sabermetric
   (WAR, wRC+, wOBA, FIP, ERA-) rather than the usual batting-average-and-RBI
   set; see server/leaders.py for where they come from and why the sort has to
   be done ourselves.
--------------------------------------------------------------------------- */

/* How many tiles the landing page shows before deferring to the full
   schedule: two rows of three on a wide window. */
const TILE_LIMIT = 6;

const todayLabel = () =>
  new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export default function HomeScreen() {
  const { state, actions } = useAppState();
  const { games, mode, error } = useLiveData();

  const live = games.filter((g) => g.status === 'live');
  const upcoming = games.filter((g) => g.status === 'scheduled');
  const final = games.filter((g) => g.status === 'final');

  const mine = games.filter((g) => isFavoriteGame(g, state.favorites));

  /* Followed clubs first, then whatever else is live, then the rest of the
     day. One ordered list rather than a section each: three sections would
     leave the page half empty in the morning, when everything is 'scheduled'
     and nothing is live. */
  const tiles = favoritesFirst(
    [...live, ...games.filter((g) => g.status !== 'live')],
    state.favorites,
  ).slice(0, TILE_LIMIT);

  return (
    <div className="home">
      <section className="hero">
        <div className="hero__text">
          <span className="u-eyebrow">
            Welcome · {todayLabel()}
          </span>
          <h2 className="hero__title">Every at-bat, rebuilt in three dimensions</h2>
          <div className="hero__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => actions.navigate(live.length ? 'live' : 'games')}
            >
              {live.length ? 'Watch a live game' : 'Browse today’s games'}
              <IconChevron size={14} />
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => actions.navigate('games')}>
              Today’s schedule
            </button>
          </div>
        </div>

        <div className="hero__slate" aria-label="Today at a glance">
          <SlateStat value={live.length} label={live.length === 1 ? 'game live' : 'games live'} live />
          <SlateStat value={upcoming.length} label="still to start" />
          <SlateStat value={final.length} label="final" />
        </div>
      </section>

      {mode === 'demo' && (
        <p className="notice">
          Showing placeholder data — the live backend isn’t reachable
          {error ? ` (${error})` : ''}. Run <code>python server/app.py</code> for real games
          and league leaders.
        </p>
      )}

      {games.length > 0 && (
        <section className="todaygames" aria-label="Today’s games">
          <div className="page-head">
            <div>
              <h3 className="todaygames__title">
                {mine.length ? 'Your teams, and the rest of today' : 'Today around the league'}
              </h3>
              {mine.length > 0 && (
                <p>{`${mine.length} game${mine.length === 1 ? '' : 's'} with a team you follow`}</p>
              )}
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => actions.navigate('games')}
            >
              All {games.length} games
              <IconChevron size={13} />
            </button>
          </div>

          <div className="tilegrid">
            {tiles.map((game) => (
              <GameTile
                key={game.id}
                game={game}
                favorite={isFavoriteGame(game, state.favorites)}
                onSelect={() => actions.selectGame(game.id)}
              />
            ))}
          </div>
        </section>
      )}

      <Leaders demo={mode === 'demo'} />
    </div>
  );
}

function SlateStat({ value, label, live }) {
  return (
    <div className="slate">
      <span className={`slate__value u-num${live && value > 0 ? ' slate__value--live' : ''}`}>{value}</span>
      <span className="slate__label">{label}</span>
    </div>
  );
}

/* --- Today's games ------------------------------------------------------- */

/**
 * One game, compact: both clubs with their runs, and the single line of status
 * that matters — the inning while it is on, first pitch before it, Final after.
 * The whole tile opens the game, which is what this page is for.
 */
function GameTile({ game, favorite, onSelect }) {
  const st = game.state;
  const awayRuns = game.away.runs ?? 0;
  const homeRuns = game.home.runs ?? 0;
  // Only bold a winner once there is one: level, or unplayed, is not leading.
  const decided = game.away.runs != null && game.home.runs != null && awayRuns !== homeRuns;

  return (
    <button
      type="button"
      className="tile"
      data-favorite={favorite || undefined}
      onClick={onSelect}
      style={teamVars(game.home.abbr)}
    >
      <span className="tile__head">
        {game.status === 'live' ? (
          <span className="chip chip--live chip--dot">
            {st ? `${st.half === 'top' ? 'Top' : 'Bot'} ${st.inning}` : 'Live'}
          </span>
        ) : (
          <span className="chip">{game.status === 'final' ? 'Final' : game.startsAt}</span>
        )}
        {favorite && (
          <span className="tile__fav" title="One of your teams">
            <IconStar size={12} filled />
          </span>
        )}
      </span>

      {['away', 'home'].map((side) => (
        <span
          className="tile__row"
          key={side}
          data-leading={
            decided ? (side === 'away' ? awayRuns > homeRuns : homeRuns > awayRuns) : false
          }
        >
          <TeamLogo abbr={game[side].abbr} size={20} />
          <span className="tile__team">{game[side].name}</span>
          <span className="tile__runs u-num">{game[side].runs ?? '–'}</span>
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
      <div className="page-head">
        <div>
          <h3 className="leaders__title">League leaders</h3>
          <p>
            {data
              ? `${data.season} season · qualified players only`
              : 'Advanced statistics, qualified players only'}
            {data?.stale && <span className="stale-note"> · cached, live feed unreachable</span>}
          </p>
        </div>
        <span className="chip">Advanced</span>
      </div>

      {demo && <p className="atbats__empty">League leaders need the live backend.</p>}
      {!demo && error && <p className="notice">Couldn’t load leaders — <code>{error}</code></p>}
      {!demo && !error && !data && <LeaderSkeleton />}

      {data?.groups.map((group) => (
        <div className="leaders__group" key={group.id}>
          <h4 className="u-eyebrow">{group.label}</h4>
          <div className="leaders__grid">
            {group.categories.map((cat) => (
              <LeaderBoard key={cat.id} groupId={group.id} category={cat} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function LeaderBoard({ groupId, category }) {
  const { actions } = useAppState();

  return (
    <article className="board">
      <header className="board__head">
        <h5 className="board__stat">{category.label}</h5>
        <p className="board__desc">{category.description}</p>
      </header>
      <ol className="board__list">
        {category.leaders.map((row) => (
          <li className="board__row" key={`${row.rank}-${row.playerId}`} style={teamVars(row.teamAbbr)}>
            <span className="board__rank u-num">{row.rank}</span>
            <TeamLogo abbr={row.teamAbbr} size={18} />
            <PlayerName
              playerId={row.playerId}
              name={row.name}
              className="board__name"
              title={row.teamName ? `${row.name} — ${row.teamName}` : row.name}
            />
            <span className="board__value u-num">{row.display}</span>
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
        See top 50
        <IconChevron size={13} />
      </button>
    </article>
  );
}

function LeaderSkeleton() {
  return (
    <div className="leaders__grid" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div className="board" key={i}>
          <div className="skeleton" style={{ height: 18, width: '40%', margin: 'var(--s-4)' }} />
          {[0, 1, 2, 3, 4].map((r) => (
            <div className="skeleton" key={r} style={{ height: 14, margin: '10px var(--s-4)' }} />
          ))}
        </div>
      ))}
    </div>
  );
}
