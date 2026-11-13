import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '../state/AppState.jsx';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import { loadPlayerBoard } from '../data/liveClient.js';
import {
  PAGE_SIZE,
  activePreset,
  columnsFor,
  isFiltered,
  isRoster,
  loosenings,
  prepareBoard,
  search,
  sentenceOf,
  sortPlayers,
  subjectOf,
} from '../data/playerBoard.js';
import { readScale, saveScale } from '../data/ratingScale.js';
import { teamFor } from '../data/teamStyle.js';
import PlayersFilters, { Presets, TeamCategories } from '../components/PlayersFilters.jsx';
import PlayersTable from '../components/PlayersTable.jsx';
import { TeamBoard, TeamRoster, TeamStrip } from '../components/TeamViews.jsx';

/* ---------------------------------------------------------------------------
   Find players by what they can do, or browse and rank the clubs.

   The server sends everyone's ratings once and this page does the filtering.
   Rating the whole league takes the server a while after it restarts, so the
   first load may wait (loadPlayerBoard keeps asking).

   What is being shown lives in the app store, not here, so leaving for a live
   game and coming back finds the same filters. The scale is the card's own
   saved toggle: flip it on either and the other follows.
--------------------------------------------------------------------------- */

export default function PlayersScreen() {
  const { state, actions } = useAppState();
  const { mode } = useLiveData();
  const view = state.playersView;
  const change = actions.setPlayersView;

  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [scale, setScale] = useState(readScale);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    if (mode === 'demo') return undefined;
    let cancelled = false;
    setError(null);
    loadPlayerBoard()
      .then((got) => !cancelled && setPayload(got))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [mode, attempt]);

  // The card has its own toggle. Pick up whatever it was left on.
  const cardOpen = Boolean(state.playerCardId);
  useEffect(() => {
    if (!cardOpen) setScale(readScale());
  }, [cardOpen]);

  const pickScale = (next) => {
    setScale(next);
    saveScale(next);
  };

  const board = useMemo(() => (payload ? prepareBoard(payload) : null), [payload]);

  const onSort = useCallback(
    (key) => {
      const same = view.sort.key === key;
      change({ sort: { key, dir: same ? -view.sort.dir : key === 'name' ? 1 : -1 } });
    },
    [change, view.sort],
  );

  // Moving between a list, a roster and the leaderboard starts at the top.
  const where = `${view.view}|${isRoster(view) ? view.team : ''}|${view.cat}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else window.scrollTo(0, 0);
  }, [where]);

  const found = useMemo(() => (board ? search(board, view, scale) : null), [board, view, scale]);

  // A shared link can name a rating this page has no column for (a typo, or
  // Framing with every position). Drop it rather than filter on nothing.
  useEffect(() => {
    if (!board || view.view === 'teams') return;
    const keys = columnsFor(board, view.pool ?? 'hitters', view.pos);
    const kept = view.ratings.filter((f) => keys.includes(f.key));
    if (kept.length !== view.ratings.length) change({ ratings: kept });
  }, [board, view.view, view.pool, view.pos, view.ratings, change]);

  const [copied, setCopied] = useState(false);
  const copyLink = () => {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    navigator.clipboard?.writeText(window.location.href).then(done, () => window.prompt?.('Copy this link', window.location.href));
  };

  return (
    <div className="players">
      <div className="page-head">
        <div>
          <h1>Players</h1>
          <p className="page-head__deck">Every rated big leaguer, found by what he can do.</p>
          <button type="button" className="players__how" onClick={() => actions.navigate('ratings')}>
            How Overall works <span aria-hidden="true">→</span>
          </button>
        </div>
        <div className="page-head__aside players__aside">
          {board && <span className="players__season">{board.season} season</span>}
          <button type="button" className="players__copy" onClick={copyLink} aria-live="polite">
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <div className="segmented" role="group" aria-label="Rating scale">
            <button type="button" aria-pressed={scale === 'pct'} onClick={() => pickScale('pct')}>
              Percentile
            </button>
            <button type="button" aria-pressed={scale === 'grade'} onClick={() => pickScale('grade')}>
              20–80
            </button>
          </div>
        </div>
      </div>

      {mode === 'demo' && <p className="atbats__empty">The Players page needs the live backend.</p>}
      {mode !== 'demo' && error && (
        <p className="notice">
          Couldn’t load the ratings: <code>{error}</code>{' '}
          <button type="button" className="players__retry" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </p>
      )}
      {mode !== 'demo' && !error && !board && <Loading />}

      {board && (
        <>
          <TeamStrip view={view} onChange={change} />
          {view.view !== 'teams' && (
            <Presets board={board} view={view} scale={scale} onChange={change} className="ppresets--strip" />
          )}

          <div className="players__body">
            {view.view === 'teams' ? (
              <aside className="prail prail--teams" aria-label="Rank clubs by">
                <TeamCategories board={board} view={view} scale={scale} onChange={change} />
              </aside>
            ) : (
              <PlayersFilters
                board={board}
                view={view}
                scale={scale}
                onChange={change}
                open={sheet}
                onClose={() => setSheet(false)}
                resultCount={found.matches.length}
              />
            )}

            <div className="players__main">
              {view.view === 'teams' && <TeamBoard board={board} view={view} scale={scale} onChange={change} />}
              {isRoster(view) && <SheetButton view={view} onOpen={() => setSheet(true)} />}
              {isRoster(view) && (
                <TeamRoster board={board} view={view} scale={scale} onChange={change} onSort={onSort} />
              )}
              {view.view !== 'teams' && !isRoster(view) && (
                <Results
                  board={board}
                  view={view}
                  scale={scale}
                  found={found}
                  onChange={change}
                  onSort={onSort}
                  onOpenFilters={() => setSheet(true)}
                />
              )}
              {view.view !== 'teams' && <Legend scale={scale} pitchers={view.pool === 'pitchers'} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SheetButton({ view, onOpen }) {
  return (
    <button type="button" className="presults__filters presults__filters--roster" onClick={onOpen}>
      Filters{view.ratings.length ? ` · ${view.ratings.length}` : ''}
    </button>
  );
}

function Results({ board, view, scale, found, onChange, onSort, onOpenFilters }) {
  const team = teamFor(view.team);
  const pool = view.pool ?? 'hitters';
  const preset = activePreset(view);
  const parts = sentenceOf(board, view, scale, team?.name ?? view.team);
  const keys = columnsFor(board, pool, view.pos);

  const shown = view.includeThin ? [...found.matches, ...found.thin] : found.matches;
  const sorted = useMemo(() => sortPlayers(shown, view.sort), [shown, view.sort]);
  const left = sorted.length - view.limit;
  const none = sorted.length === 0;
  const ways = none ? loosenings(board, view, scale) : [];

  const sortChoices = ['ovr', ...view.ratings.map((f) => f.key)];
  const currentSort = sortChoices.includes(view.sort.key) ? view.sort.key : 'ovr';
  const sortName = currentSort === 'ovr' ? 'Overall' : board.meta[currentSort]?.label;

  return (
    <>
      <div className="presults__head">
        <div className="presults__said">
          <p className="u-kicker">
            {preset ? `Preset · ${preset.name}` : isFiltered(view) ? 'Your filters' : 'Sorted by overall'}
          </p>
          <h2 className="psentence" aria-live="polite">
            {parts.map((part, i) =>
              part.filter ? (
                <button
                  key={part.filter.key}
                  type="button"
                  className="psentence__term"
                  title="Remove this filter"
                  aria-label={`Remove the filter ${part.text}`}
                  onClick={() => onChange({ ratings: view.ratings.filter((f) => f.key !== part.filter.key) })}
                >
                  {part.text}
                </button>
              ) : (
                <span key={i}>{part.text}</span>
              ),
            )}
          </h2>
        </div>
        <div className="presults__count">
          <span className="presults__n">{found.matches.length}</span>
          <span className="presults__of">
            of {found.baseCount} <span className="presults__ofnoun">{subjectOf(view, team?.name ?? view.team)}</span>
          </span>
        </div>
      </div>

      <div className="presults__tools">
        <button type="button" className="presults__filters" onClick={onOpenFilters}>
          Filters{view.ratings.length ? ` · ${view.ratings.length}` : ''}
        </button>
        <button
          type="button"
          className="presults__sort"
          onClick={() => {
            const next = sortChoices[(sortChoices.indexOf(currentSort) + 1) % sortChoices.length];
            onChange({ sort: { key: next, dir: -1 } });
          }}
        >
          Sort: {sortName}
        </button>
      </div>

      {none && (
        <div className="pempty">
          <p className="u-kicker">Nobody fits</p>
          <p className="pempty__line">Loosen one thing and see who comes back.</p>
          {ways.map((way) => (
            <button key={way.label} type="button" className="pempty__way" onClick={() => onChange(way.patch)}>
              <span>{way.label}</span>
              <span className="pempty__count">
                {way.count} {way.count === 1 ? 'player' : 'players'} <span aria-hidden="true">→</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {!none && (
        <PlayersTable
          board={board}
          keys={keys}
          rows={sorted.slice(0, view.limit)}
          view={view}
          scale={scale}
          onSort={onSort}
        />
      )}

      {left > 0 && (
        <button type="button" className="presults__more" onClick={() => onChange({ limit: view.limit + PAGE_SIZE })}>
          Show {Math.min(left, PAGE_SIZE)} more
        </button>
      )}

      {/* Who a filter could not judge, rather than quietly dropping them. */}
      {found.thin.length > 0 && !none && (
        <p className="presults__thin">
          {found.thin.length} {view.includeThin ? (found.thin.length === 1 ? 'is' : 'are') : found.thin.length === 1 ? 'more has' : 'more have'}{' '}
          {view.includeThin ? 'shown without enough data to judge on these ratings.' : 'too little data to judge on these ratings.'}{' '}
          <button type="button" onClick={() => onChange({ includeThin: !view.includeThin })}>
            {view.includeThin ? 'Hide' : found.thin.length === 1 ? 'Show him' : 'Show them'}
          </button>
        </p>
      )}
    </>
  );
}

function Legend({ scale, pitchers }) {
  return (
    <div className="plegend">
      <span className="plegend__key" data-group="hitting">{pitchers ? 'Pitching' : 'Hitting'}</span>
      {!pitchers && <span className="plegend__key" data-group="running">Running</span>}
      {!pitchers && <span className="plegend__key" data-group="fielding">Fielding</span>}
      <span className="plegend__key" data-group="empty">Too little data</span>
      <span>
        The ring on each wheel is league average.{' '}
        {scale === 'grade' ? 'Grades run 20 to 80, and 50 is average.' : 'Percentiles run 0 to 100 against every rated player.'}
      </span>
    </div>
  );
}

function Loading() {
  return (
    <div className="players__loading" aria-busy="true">
      <p className="players__wait">Working out ratings for the whole league. This can take a moment after a restart.</p>
      {Array.from({ length: 8 }, (_, i) => (
        <div className="skeleton" key={i} style={{ height: 52, marginBottom: 8 }} />
      ))}
    </div>
  );
}
