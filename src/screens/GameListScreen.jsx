import { useAppState } from '../state/AppState.jsx';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import { teamVars } from '../data/teamStyle.js';
import { favoritesFirst, isFavoriteGame } from '../data/favorites.js';
import { localISODay } from '../data/liveClient.js';
import TeamLogo from '../components/TeamLogo.jsx';
import { IconStar } from '../components/Icons.jsx';

const SECTIONS = [
  { id: 'live', label: 'In progress' },
  { id: 'scheduled', label: 'Upcoming' },
  { id: 'final', label: 'Final' },
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

/** Game picker — the UI equivalent of the prototype's interactive game_picker. */
export default function GameListScreen() {
  const { state, actions } = useAppState();
  const { games, mode, error, stale } = useLiveData();

  // `scoreboardDate` is null for today, so the app needs no date to open.
  const date = state.scoreboardDate ?? todayISO();
  const isToday = date === todayISO();

  const heading = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  /* Going forward from today would only ever show an empty board, so the
     control stops there rather than offering days that cannot have games. */
  const goto = (next) => actions.setScoreboardDate(next === todayISO() ? null : next);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>{isToday ? "Today's games" : 'Games'}</h2>
          <p>
            {heading}
            {mode === 'demo' && ' · placeholder data (backend not reachable)'}
            {mode === 'live' && stale != null && (
              <>
                {' · '}
                <span className="stale-note">
                  cached {formatAge(stale)} ago — live feed unreachable
                </span>
              </>
            )}
          </p>
        </div>
        <div className="datebar">
          <button
            type="button"
            className="datebar__step"
            onClick={() => goto(shiftDay(date, -1))}
            aria-label="Previous day"
          >
            ‹
          </button>
          <input
            type="date"
            className="datebar__input"
            value={date}
            max={todayISO()}
            onChange={(e) => e.target.value && goto(e.target.value)}
            aria-label="Scoreboard date"
          />
          <button
            type="button"
            className="datebar__step"
            onClick={() => goto(shiftDay(date, 1))}
            disabled={isToday}
            aria-label="Next day"
          >
            ›
          </button>
          {!isToday && (
            <button type="button" className="datebar__today" onClick={() => goto(todayISO())}>
              Today
            </button>
          )}
          <span className="chip">{games.length} games</span>
        </div>
      </div>

      {mode === 'demo' && error && (
        <p className="notice">
          Live feed unavailable — <code>{error}</code>. Start the backend with{' '}
          <code>python server/app.py</code> to stream real games.
        </p>
      )}

      {games.length === 0 && (
        <p className="atbats__empty">
          No games on {heading}.
          {!isToday && ' Try another date.'}
        </p>
      )}

      {SECTIONS.map((section) => {
        /* Favourites to the top of each section rather than into a section of
           their own: the live/upcoming/final split is what you scan the page
           by, and lifting a followed club out of it would hide a game of
           theirs that is already over. */
        const list = favoritesFirst(
          games.filter((g) => g.status === section.id),
          state.favorites,
        );
        if (!list.length) return null;

        return (
          <section className="gamelist__section" key={section.id}>
            <h3 className="u-eyebrow">{section.label}</h3>
            <div className="gamegrid">
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
          </section>
        );
      })}
    </div>
  );
}

function formatAge(seconds) {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)}m`;
}

function GameCard({ game, current, favorite, onSelect }) {
  const awayVars = teamVars(game.away.abbr);
  const homeVars = teamVars(game.home.abbr);
  const st = game.state;
  const awayRuns = game.away.runs ?? 0;
  const homeRuns = game.home.runs ?? 0;
  const decided = game.away.runs != null && game.home.runs != null && awayRuns !== homeRuns;

  return (
    <button
      type="button"
      className="gamecard"
      aria-current={current}
      data-favorite={favorite || undefined}
      onClick={onSelect}
      style={{ ...teamVars(game.away.abbr), '--away': awayVars['--team'], '--home': homeVars['--team'] }}
    >
      {/* Both clubs read along the top edge — the card is about a matchup. */}
      <span className="gamecard__edge" aria-hidden="true" />
      <div className="gamecard__head">
        {game.status === 'live' ? (
          <span className="chip chip--live chip--dot">Live</span>
        ) : (
          <span className="chip">{game.status === 'final' ? 'Final' : game.startsAt}</span>
        )}
        <span className="gamecard__venue">{game.venue}</span>
        {favorite && (
          <span className="gamecard__fav" title="One of your teams">
            <IconStar size={13} filled />
          </span>
        )}
      </div>

      <div className="gamecard__teams">
        {['away', 'home'].map((side) => (
          <div
            className="gamecard__row"
            key={side}
            data-leading={decided ? (side === 'away' ? awayRuns > homeRuns : homeRuns > awayRuns) : false}
          >
            <TeamLogo abbr={game[side].abbr} size={22} />
            <span className="scoreteam__name">{game[side].name}</span>
            <span className="gamecard__runs">{game[side].runs ?? '–'}</span>
          </div>
        ))}
      </div>

      <div className="gamecard__foot">
        <span>
          {st
            ? `${st.half === 'top' ? 'Top' : 'Bot'} ${st.inning} · ${st.outs} out`
            : game.detailedStatus || (game.status === 'final' ? 'Completed' : `First pitch ${game.startsAt}`)}
        </span>
        <span className="gamecard__cta">{current ? 'Watching' : 'Open ›'}</span>
      </div>
    </button>
  );
}
