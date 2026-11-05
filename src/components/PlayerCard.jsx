import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppState } from '../state/AppState.jsx';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import { IconClose } from './Icons.jsx';
import { fetchPlayer } from '../data/liveClient.js';
import { teamVars } from '../data/teamStyle.js';
import PlayerCardFront from './PlayerCardFront.jsx';
import PlayerCardBack from './PlayerCardBack.jsx';
import { pushRecent } from '../data/playerSearch.js';
import { readScale, saveScale } from '../data/ratingScale.js';

/**
 * The player card: a flippable card in a modal, opened from any player name.
 *
 * Mounted once in App.jsx and driven by `state.playerCardId`, so it opens OVER
 * whatever the user is looking at. Nothing navigates, the live feed keeps
 * streaming behind the scrim, and closing puts focus back on the name that was
 * clicked — you come back exactly where you were in the game.
 *
 * COMPARISON. The back of a card lists its five most similar players. Picking
 * one opens that player's card to the RIGHT, and the first card slides left to
 * make room; the two wheels then carry each other's outline. Picking a match
 * from the right-hand card moves the chain along: that card slides to the left,
 * the original closes, and the new match opens on the right. So the screen
 * always holds the player you came from and the one you went to.
 *
 * The two slots are keyed by player id, so a card moving from right to left is
 * the SAME card, flipped the way it was — and a FLIP animation slides it there
 * rather than letting it jump. On a phone two cards do not fit side by side, so
 * only the right-hand one shows, with a way back to the left.
 *
 * Two data sources per card, deliberately layered so a card is never blank:
 *
 *   the snapshot   anyone in the current game arrives free with the live feed,
 *                  so the card paints instantly with name, team, bio and this
 *                  game's batted balls
 *   /api/player    season Statcast, ratings, similar players and (for a
 *                  pitcher) the arsenal, which the game feed does not carry
 */
export default function PlayerCard() {
  const { state, actions } = useAppState();
  const { players } = useLiveData();
  const openId = state.playerCardId;

  // [left, right]: the card you are on, and the one you are comparing it with.
  const [slots, setSlots] = useState([openId ?? null, null]);
  useEffect(() => setSlots([openId ?? null, null]), [openId]);
  const [left, right] = slots;

  const [scale, setScale] = useState(readScale);
  const changeScale = useCallback((next) => {
    setScale(next);
    saveScale(next);
  }, []);

  const loaded = useLoadedPlayers(slots.filter(Boolean));
  const containerRef = useRef(null);
  const returnFocusTo = useRef(null);
  const isOpen = Boolean(left);

  const compareFrom = useCallback(
    (fromId, otherId) => {
      setSlots(([l, r]) => {
        const same = (x, y) => x != null && String(x) === String(y);
        if (!otherId || same(otherId, l) || same(otherId, r)) return [l, r];
        // From the left card: open (or replace) the right. From the right card:
        // it becomes the left, and the original closes.
        return fromId === l ? [l, otherId] : [r, otherId];
      });
    },
    [],
  );
  const closeRight = useCallback(() => setSlots(([l]) => [l, null]), []);

  useFlipAnimation(containerRef, slots);

  // Every card opened, however it was reached, is a "recent" for player search.
  useEffect(() => {
    if (left) pushRecent(left);
  }, [left]);
  useEffect(() => {
    if (right) pushRecent(right);
  }, [right]);

  useEffect(() => {
    if (!isOpen) return undefined;

    returnFocusTo.current = document.activeElement;
    containerRef.current?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        actions.closePlayer();
        return;
      }
      if (e.key !== 'Tab') return;

      // `:not([inert] *)` matters: each card's hidden face is still in the DOM.
      // The visibility check drops the card a phone has tucked away.
      const focusables = [
        ...(containerRef.current?.querySelectorAll(
          'button:not([inert] *), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter((el) => el.offsetParent !== null);
      if (!focusables.length) return;
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

  const ids = [left, right].filter(Boolean);
  const merged = Object.fromEntries(ids.map((id) => [id, mergePlayer(players[id], loaded[id])]));

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`playercard-name-${left}`}
    >
      <div className="modal__scrim" onClick={actions.closePlayer} />

      <div className="pcards" ref={containerRef} tabIndex={-1} data-count={ids.length}>
        {ids.map((id) => {
          const isLeft = id === left;
          const other = isLeft ? right : left;
          return (
            <CardSlot
              key={id}
              id={id}
              side={isLeft ? 'left' : 'right'}
              player={merged[id]}
              entry={loaded[id]}
              other={other ? merged[other] : null}
              comparingWith={isLeft ? right : null}
              units={state.settings.units}
              scale={scale}
              onScale={changeScale}
              onCompare={(otherId) => compareFrom(id, otherId)}
              onClose={isLeft ? actions.closePlayer : closeRight}
              onBack={isLeft ? null : closeRight}
            />
          );
        })}
      </div>
    </div>
  );
}

/** One card in its slot: its own face, its own loading state. */
function CardSlot({ id, side, player, entry, other, comparingWith, units, scale, onScale, onCompare, onClose, onBack }) {
  const [face, setFace] = useState('front');
  const flip = useCallback(() => setFace((f) => (f === 'front' ? 'back' : 'front')), []);
  const loadError = entry?.error ?? null;
  const loadingRatings = !entry?.data && !loadError;

  if (!player) {
    return (
      <div className="pcards__slot" data-id={id} data-side={side}>
        <div className="modal__card modal__card--slim">
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close player card">
            <IconClose />
          </button>
          <div className="panel__body">
            {loadError ? (
              <p className="atbats__empty">Couldn’t load this player: {loadError}</p>
            ) : (
              <>
                <div className="skeleton" style={{ height: 22, width: '55%' }} />
                <div className="skeleton" style={{ height: 14, width: '35%', marginTop: 10 }} />
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const showingBack = face === 'back';
  const compare = other?.ratings?.version === 2 ? other : null;

  return (
    <div className="pcards__slot" data-id={id} data-side={side}>
      {onBack && other && (
        <button type="button" className="pcards__back" onClick={onBack}>
          <span aria-hidden="true">←</span> Back to {other.name}
        </button>
      )}
      <div className="modal__card--player" style={teamVars(player.teamAbbr)}>
        <div className="pcard" data-face={face}>
          <div className="pcard__faces">
            <div className="pcard__face" inert={showingBack} aria-hidden={showingBack}>
              <PlayerCardFront
                player={player}
                nameId={`playercard-name-${id}`}
                loadingRatings={loadingRatings}
                scale={scale}
                onFlip={flip}
                onClose={onClose}
              />
            </div>

            <div className="pcard__face pcard__face--back" inert={!showingBack} aria-hidden={!showingBack}>
              <PlayerCardBack
                player={player}
                units={units}
                scale={scale}
                onScale={onScale}
                compare={compare}
                comparingWith={comparingWith}
                onCompare={onCompare}
                onFlip={flip}
                onClose={onClose}
              />
            </div>
          </div>
        </div>
        {loadError && !entry?.data && <p className="pcard__foothint">Season stats unavailable</p>}
      </div>
    </div>
  );
}

/**
 * /api/player for every card on screen, kept while it stays on screen.
 *
 * Kept by id rather than by slot, so a card that moves from right to left does
 * not fetch itself again — and a chain of comparisons only ever loads the card
 * that is new.
 */
function useLoadedPlayers(ids) {
  const [loaded, setLoaded] = useState({});
  const inFlight = useRef(new Map()); // id -> AbortController
  const key = ids.join(',');

  useEffect(() => {
    const wanted = new Set(key ? key.split(',') : []);
    // Cards that left the screen: stop their requests and drop their data.
    for (const [id, controller] of inFlight.current) {
      if (!wanted.has(id)) {
        controller.abort();
        inFlight.current.delete(id);
      }
    }
    setLoaded((prev) => {
      const kept = Object.fromEntries(Object.entries(prev).filter(([id]) => wanted.has(id)));
      return Object.keys(kept).length === Object.keys(prev).length ? prev : kept;
    });
    for (const id of wanted) {
      if (inFlight.current.has(id)) continue;
      const controller = new AbortController();
      inFlight.current.set(id, controller);
      fetchPlayer(id, { signal: controller.signal })
        .then((data) => setLoaded((p) => ({ ...p, [id]: { data } })))
        .catch((err) => {
          if (err.name === 'AbortError') return;
          inFlight.current.delete(id); // let a later open try again
          setLoaded((p) => ({ ...p, [id]: { error: err.message } }));
        });
    }
  }, [key]);

  // Closing the modal abandons everything still loading.
  useEffect(() => {
    const flights = inFlight.current;
    return () => {
      flights.forEach((c) => c.abort());
      flights.clear();
    };
  }, []);

  return loaded;
}

/* The merge. The fetched card is the season-wide truth and wins on everything
   it knows about; the snapshot wins on anything describing THIS game, which the
   season card has no view of and returns empty. Getting that order wrong
   silently wipes the spray chart of the batter you are watching. */
function mergePlayer(inGame, entry) {
  const fetched = entry?.data ?? null;
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
    catching: fetched.catching,
    sabermetrics: fetched.sabermetrics,
    birthplace: inGame.birthplace || fetched.birthplace,
    mlbDebut: inGame.mlbDebut || fetched.mlbDebut,
    teamAbbr: inGame.teamAbbr || fetched.teamAbbr,
    // `scope: 'season'` is what tells the back to drop the game-only blocks.
    // This player IS in a game, so it must not survive the merge.
    scope: undefined,
  };
}

/**
 * Slide cards to their new places instead of letting them jump.
 *
 * FLIP: remember where each card was, let the layout move it, then start it
 * back where it was and let a transition carry it to where it now is. A card
 * that is new has nowhere to come from, so it gets the rise-in animation
 * instead (CSS).
 */
function useFlipAnimation(containerRef, slots) {
  const last = useRef(new Map());
  const key = slots.join(',');

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const next = new Map();
    root.querySelectorAll('.pcards__slot').forEach((el) => {
      const id = el.dataset.id;
      const rect = el.getBoundingClientRect();
      next.set(id, rect);
      const before = last.current.get(id);
      if (!before || reduce) return;
      const dx = before.left - rect.left;
      if (Math.abs(dx) < 1) return;
      el.style.transition = 'none';
      el.style.transform = `translateX(${dx}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 0.42s cubic-bezier(0.22, 0.8, 0.3, 1)';
        el.style.transform = '';
      });
    });
    last.current = next;
  }, [containerRef, key]);

  // Forget positions when the modal closes, so the next open rises in fresh.
  useEffect(() => () => last.current.clear(), []);
}
