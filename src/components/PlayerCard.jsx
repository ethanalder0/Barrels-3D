import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '../state/AppState.jsx';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import { IconClose } from './Icons.jsx';
import { fetchPlayer } from '../data/liveClient.js';
import { teamVars } from '../data/teamStyle.js';
import PlayerCardFront from './PlayerCardFront.jsx';
import PlayerCardBack from './PlayerCardBack.jsx';

/**
 * The player card: a flippable card in a modal, opened from any player name.
 *
 * Mounted once in App.jsx and driven entirely by `state.playerCardId`, so it
 * opens OVER whatever the user is looking at. Nothing navigates, the live feed
 * keeps streaming behind the scrim, and closing puts focus back on the name
 * that was clicked — you come back exactly where you were in the game.
 *
 * Two data sources, deliberately layered so the card is never blank:
 *
 *   the snapshot   anyone in the current game arrives free with the live feed,
 *                  so the card paints instantly with name, team, bio and this
 *                  game's batted balls
 *   /api/player    season Statcast, ability ratings and (for a pitcher) the
 *                  arsenal, which the game feed does not carry. Fetched on
 *                  open and merged in when it lands; the bars show a shimmer
 *                  until then rather than holding the whole card back
 *
 * A player with no game behind them — a league leader tapped on the home page
 * — has only the second source, and waits on it.
 */
export default function PlayerCard() {
  const { state, actions } = useAppState();
  const { players } = useLiveData();
  const playerId = state.playerCardId;
  const inGame = playerId ? players[playerId] ?? null : null;

  const [fetched, setFetched] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [face, setFace] = useState('front');

  const cardRef = useRef(null);
  const returnFocusTo = useRef(null);
  const isOpen = Boolean(playerId);

  // Always fetch: the snapshot has no season Statcast, so even a player who is
  // standing at the plate needs this for their ratings.
  useEffect(() => {
    setFetched(null);
    setLoadError(null);
    setFace('front');
    if (!playerId) return undefined;

    const controller = new AbortController();
    let cancelled = false;
    fetchPlayer(playerId, { signal: controller.signal })
      .then((p) => !cancelled && setFetched(p))
      .catch((err) => !cancelled && err.name !== 'AbortError' && setLoadError(err.message));
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [playerId]);

  /* The merge. `fetched` is the season-wide truth and wins on everything it
     knows about; `inGame` wins on anything describing THIS game, which the
     season card has no view of and returns empty. Getting that order wrong
     silently wipes the spray chart of the batter you are watching. */
  const player = useMemo(() => {
    if (!inGame) return fetched;
    if (!fetched) return inGame;
    return {
      ...fetched,
      ...inGame,
      ratings: fetched.ratings,
      ratingsNote: fetched.ratingsNote,
      ratingsSeason: fetched.ratingsSeason,
      statcast: fetched.statcast,
      arsenal: fetched.arsenal,
      running: fetched.running,
      fielding: fetched.fielding,
      sabermetrics: fetched.sabermetrics,
      birthplace: inGame.birthplace || fetched.birthplace,
      mlbDebut: inGame.mlbDebut || fetched.mlbDebut,
      teamAbbr: inGame.teamAbbr || fetched.teamAbbr,
      // `scope: 'season'` is what tells the back to drop the game-only blocks.
      // This player IS in a game, so it must not survive the merge.
      scope: undefined,
    };
  }, [inGame, fetched]);

  const loadingRatings = Boolean(playerId) && !fetched && !loadError;
  const waiting = Boolean(playerId) && !player && !loadError;
  const flip = useCallback(() => setFace((f) => (f === 'front' ? 'back' : 'front')), []);

  useEffect(() => {
    if (!isOpen) return undefined;

    returnFocusTo.current = document.activeElement;
    cardRef.current?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        actions.closePlayer();
        return;
      }
      if (e.key !== 'Tab') return;

      // `:not([inert] *)` matters here: the hidden face of the card is still in
      // the DOM, and without it Tab would cycle through controls nobody can see.
      const focusables = cardRef.current?.querySelectorAll(
        'button:not([inert] *), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      returnFocusTo.current?.focus?.();
    };
  }, [isOpen, actions]);

  if (!isOpen) return null;

  if (!player) {
    return (
      <div className="modal" role="dialog" aria-modal="true" aria-label="Player">
        <div className="modal__scrim" onClick={actions.closePlayer} />
        <div className="modal__card modal__card--slim" ref={cardRef} tabIndex={-1}>
          <button
            type="button"
            className="modal__close"
            onClick={actions.closePlayer}
            aria-label="Close player card"
          >
            <IconClose />
          </button>
          <div className="panel__body">
            {waiting ? (
              <>
                <div className="skeleton" style={{ height: 22, width: '55%' }} />
                <div className="skeleton" style={{ height: 14, width: '35%', marginTop: 10 }} />
              </>
            ) : (
              <p className="atbats__empty">Couldn’t load this player — {loadError}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const showingBack = face === 'back';

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="playercard-name">
      <div className="modal__scrim" onClick={actions.closePlayer} />

      {/* No modal chrome around the card any more: the close control lives on
          each face, where the design puts it, so what sits on the scrim is the
          card and nothing else. */}
      <div
        className="modal__card--player"
        ref={cardRef}
        tabIndex={-1}
        style={teamVars(player.teamAbbr)}
      >
        <div className="pcard" data-face={face}>
          <div className="pcard__faces">
            <div className="pcard__face" inert={showingBack} aria-hidden={showingBack}>
              <PlayerCardFront
                player={player}
                loadingRatings={loadingRatings}
                onFlip={flip}
                onClose={actions.closePlayer}
              />
            </div>

            <div
              className="pcard__face pcard__face--back"
              inert={!showingBack}
              aria-hidden={!showingBack}
            >
              <PlayerCardBack
                player={player}
                units={state.settings.units}
                onFlip={flip}
                onClose={actions.closePlayer}
              />
            </div>
          </div>
        </div>

        {loadError && !fetched && <p className="pcard__foothint">Season stats unavailable</p>}
      </div>
    </div>
  );
}
