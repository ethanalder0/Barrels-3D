import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import { fetchPlayerSummaries, loadPlayerIndex } from '../data/liveClient.js';
import {
  atThePlate,
  liveStatus,
  matchPlayers,
  prepareIndex,
  readRecent,
} from '../data/playerSearch.js';
import { readScale } from '../data/ratingScale.js';
import PlayerHeadshot from './PlayerHeadshot.jsx';
import { IconClose, IconSearch } from './Icons.jsx';

/* Ratings already fetched this page load. They move once a day at most, and a
   person narrowing a name asks for the same players again and again. */
const summaries = new Map();
const SUMMARY_DEBOUNCE_MS = 120;
const LIMIT = 8;

/**
 * Find a player by name.
 *
 * One component with two homes: the app header, where picking opens his card,
 * and the back of a card, where picking opens him alongside for comparison.
 *
 *   variant="header"  a dropdown under the box; on a phone, an icon that opens
 *                     the box across the top of the screen. `/` focuses it.
 *                     Before anything is typed it offers who is at the plate
 *                     in live games and who you looked at recently.
 *   variant="card"    the results push the card's content down rather than
 *                     floating: a card's back scrolls, and a dropdown would be
 *                     clipped by it.
 *
 * It is a combobox: focus stays in the box, arrows move the highlight, Enter
 * opens, Shift+Enter jumps to his live game, Escape clears.
 */
export default function PlayerSearch({
  variant = 'header',
  label = 'Search players',
  placeholder = 'Search players',
  accept = null,
  scale: scaleProp = null,
  suggestions = false,
  onPick,
  onJump = null,
}) {
  const { games } = useLiveData();
  const uid = useId();
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false); // phone: the box is showing
  const [active, setActive] = useState(0);
  const [index, setIndex] = useState(null);
  const [failed, setFailed] = useState(false);
  const [, bump] = useState(0);
  // The header has no card to take the scale from; it reads the saved choice
  // whenever the box is opened, so a toggle on a card carries over.
  const [savedScale, setSavedScale] = useState(readScale);
  const scale = scaleProp ?? savedScale;

  const load = useCallback(() => {
    setFailed(false);
    loadPlayerIndex()
      .then((rows) => setIndex((prev) => prev ?? prepareIndex(rows)))
      .catch(() => setFailed(true));
  }, []);

  const onFocus = () => {
    setOpen(true);
    setSavedScale(readScale());
    if (!index) load();
  };

  const typed = query.trim().length > 0;

  /* Groups, in display order. With nothing typed: live batters, then recents.
     A person shows once, in the first group that has him. */
  const groups = useMemo(() => {
    if (!index) return [];
    if (typed) {
      const hits = matchPlayers(index, query, { limit: LIMIT, accept });
      return hits.length ? [{ key: 'results', title: null, players: hits }] : [];
    }
    if (!suggestions) return [];
    const byId = new Map(index.map((p) => [String(p.id), p]));
    const plate = atThePlate(index, games);
    const seen = new Set(plate.map((p) => String(p.id)));
    const recent = readRecent()
      .filter((id) => !seen.has(id))
      .map((id) => byId.get(id))
      .filter(Boolean);
    return [
      plate.length ? { key: 'plate', title: 'At the plate', players: plate.slice(0, LIMIT) } : null,
      recent.length ? { key: 'recent', title: 'Recently viewed', players: recent } : null,
    ].filter(Boolean);
    // `open` is here so recents are re-read each time the box is opened.
  }, [index, typed, query, accept, suggestions, games, open]);

  const rows = useMemo(() => groups.flatMap((g) => g.players), [groups]);
  const idsKey = rows.map((p) => p.id).join(',');

  useEffect(() => setActive(0), [query]);

  // Ratings for whatever is on screen: only what is not already known, and not
  // until typing pauses.
  useEffect(() => {
    if (!open || !idsKey) return undefined;
    const missing = idsKey.split(',').filter((id) => !summaries.has(id));
    if (!missing.length) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchPlayerSummaries(missing, { signal: controller.signal })
        .then((got) => {
          missing.forEach((id) => summaries.set(id, got[id] ?? null));
          bump((n) => n + 1);
        })
        .catch(() => {
          /* the row simply shows no rating; the name still opens the card */
        });
    }, SUMMARY_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [idsKey, open]);

  const close = useCallback(() => {
    setOpen(false);
    setExpanded(false);
    setQuery('');
  }, []);

  /* Blur before handing over: the card puts focus back where it found it when
     it closes, and focus landing back in this box would pop the list open. */
  const pick = (player) => {
    inputRef.current?.blur();
    close();
    onPick?.(String(player.id));
  };

  const jump = (status) => {
    inputRef.current?.blur();
    close();
    onJump?.(status.gameId);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (open || query) {
        // Stopped here so a search inside a card does not close the card too.
        e.stopPropagation();
        close();
        inputRef.current?.blur();
      }
      return;
    }
    if (!rows.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % rows.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + rows.length) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const player = rows[active];
      if (!player) return;
      const status = onJump ? liveStatus(player, games) : null;
      if (e.shiftKey && status) jump(status);
      else pick(player);
    }
  };

  // Tabbing or clicking away closes the list. What was typed goes with it on a
  // phone, where the box itself is going away.
  const onBlur = (e) => {
    if (rootRef.current?.contains(e.relatedTarget)) return;
    setOpen(false);
    setExpanded(false);
  };

  /* `/` from anywhere on the page, as on most sites with a search box. Not
     while typing in something else, and not over an open card -- the card has
     its own box, and Tab is trapped inside it. */
  useEffect(() => {
    if (variant !== 'header') return undefined;
    const onSlash = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('.modal')) return;
      e.preventDefault();
      // Only a phone has a box to expand; elsewhere it is already showing.
      if (window.matchMedia('(max-width: 640px)').matches) setExpanded(true);
      else inputRef.current?.focus();
    };
    window.addEventListener('keydown', onSlash);
    return () => window.removeEventListener('keydown', onSlash);
  }, [variant]);

  // On a phone the box does not exist until the icon opens it, so focus follows.
  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const listId = `${uid}-list`;
  const showList = open && (typed || groups.length > 0 || failed);
  let at = -1;

  return (
    <div
      className={`psearch psearch--${variant}`}
      ref={rootRef}
      data-expanded={expanded}
      onBlur={onBlur}
    >
      {variant === 'header' && (
        <button
          type="button"
          className="psearch__icon"
          aria-label={label}
          onClick={() => setExpanded(true)}
        >
          <IconSearch size={17} />
        </button>
      )}

      <div className="psearch__box">
        <span className="psearch__glass" aria-hidden="true">
          <IconSearch size={14} />
        </span>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          className="psearch__input"
          aria-label={label}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && rows[active] ? `${uid}-o${active}` : undefined}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
        />
        {variant === 'header' && !query && (
          <kbd className="psearch__hint" aria-hidden="true">
            /
          </kbd>
        )}
        {(query || expanded) && (
          <button
            type="button"
            className="psearch__clear"
            aria-label={query ? 'Clear search' : 'Close search'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (query) {
                setQuery('');
                inputRef.current?.focus();
              } else {
                close();
              }
            }}
          >
            <IconClose size={11} />
          </button>
        )}
      </div>

      {showList && (
        <div className="psearch__panel">
          {failed && <p className="psearch__note">Search needs the live backend. Try again in a moment.</p>}
          {!failed && !index && <p className="psearch__note">Loading players…</p>}
          {!failed && index && typed && rows.length === 0 && (
            <p className="psearch__note">No player matches “{query.trim()}”.</p>
          )}
          <ul className="psearch__list" id={listId} role="listbox" aria-label={label}>
            {groups.map((group) => (
              <li key={group.key} role="presentation">
                {group.title && <p className="psearch__group">{group.title}</p>}
                <ul role="presentation">
                  {group.players.map((player) => {
                    at += 1;
                    const i = at;
                    return (
                      <Result
                        key={player.id}
                        id={`${uid}-o${i}`}
                        player={player}
                        scale={scale}
                        active={i === active}
                        status={onJump ? liveStatus(player, games) : null}
                        onHover={() => setActive(i)}
                        onPick={() => pick(player)}
                        onJump={jump}
                      />
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* One result: who he is, what he rates, and whether he is on right now. The
   numbers are the ones his card will show (server: ratings.summaries). */
function Result({ id, player, scale, active, status, onHover, onPick, onJump }) {
  const summary = summaries.get(String(player.id));
  const grade = scale === 'grade';
  const overall = grade ? summary?.overall?.grade : summary?.overall?.pct;
  const top = summary?.top;
  const topValue = grade ? top?.grade : top?.pct;

  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      className="psearch__row"
      data-active={active}
      onMouseEnter={onHover}
      // Keep focus in the box, so the list is still there for the click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
    >
      <PlayerHeadshot
        playerId={player.id}
        name={player.name}
        teamAbbr={player.team}
        size={34}
        variant="spot"
        className="psearch__shot"
      />
      <span className="psearch__who">
        <span className="psearch__name">{player.name}</span>
        <span className="psearch__meta">
          {[player.pos, player.team].filter(Boolean).join(' · ')}
          {top && topValue != null && (
            <span className="psearch__top">
              {' '}
              · {top.label} {topValue}
            </span>
          )}
        </span>
        {status && (
          <button
            type="button"
            className="psearch__live"
            data-kind={status.kind}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onJump(status);
            }}
          >
            {status.label} <span aria-hidden="true">→</span>
          </button>
        )}
      </span>
      {overall != null && (
        <span className="psearch__ovr" aria-label={`Overall ${overall}`}>
          {overall}
        </span>
      )}
    </li>
  );
}
