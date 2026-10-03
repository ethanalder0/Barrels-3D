import { useEffect, useId, useRef, useState } from 'react';
import { useAppState } from '../state/AppState.jsx';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import { IconChevron } from './Icons.jsx';
import TeamLogo from './TeamLogo.jsx';

const ORDER = { live: 0, scheduled: 1, final: 2 };

/**
 * The game switcher in the app bar: the current matchup as a button, and the
 * day's scoreboard as a compact menu under it. Picking a game goes straight to
 * it; the full games screen (other dates, bigger cards) is the last item.
 */
export default function GameMenu() {
  const { state, actions } = useAppState();
  const { game, games } = useLiveData();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const menuId = useId();

  const sorted = [...games].sort((a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3));

  // Close on a click anywhere else, or on Escape (returning focus to the button).
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Opening puts focus on the current game, so arrows start from there.
  useEffect(() => {
    if (!open) return;
    const items = [...(listRef.current?.querySelectorAll('[role="menuitem"]') ?? [])];
    (items.find((el) => el.dataset.current === 'true') ?? items[0])?.focus();
  }, [open]);

  const onMenuKey = (e) => {
    const items = [...listRef.current.querySelectorAll('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    const go = (n) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  };

  const pick = (id) => {
    setOpen(false);
    actions.selectGame(id);
  };

  if (!game) return null;

  return (
    <div className="gamemenu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="appbar__game"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        title="Switch game"
      >
        <span>{game.away.abbr}</span>
        <span className="sep">@</span>
        <span>{game.home.abbr}</span>
        {game.state && game.status !== 'final' && (
          <span className="appbar__inning u-num">
            {game.state.half === 'top' ? '▲' : '▼'}
            {game.state.inning}
          </span>
        )}
        <span className="gamemenu__chev" data-open={open}>
          <IconChevron dir="down" size={14} />
        </span>
      </button>

      {open && (
        <div className="gamemenu__pop" id={menuId} role="menu" aria-label="Games" ref={listRef} onKeyDown={onMenuKey}>
          {sorted.length === 0 ? (
            <p className="gamemenu__empty">No games on this date.</p>
          ) : (
            <ul className="gamemenu__list">
              {sorted.map((g) => (
                <li key={g.id} role="none">
                  <GameRow
                    game={g}
                    current={g.id === (state.selectedGameId ?? game.id)}
                    onPick={() => pick(g.id)}
                  />
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            role="menuitem"
            className="gamemenu__all"
            onClick={() => {
              setOpen(false);
              actions.navigate('games');
            }}
          >
            All games &amp; other dates
            <IconChevron size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function GameRow({ game, current, onPick }) {
  const st = game.state;
  // The feed reports 0-0 for games that have not started; that is not a score.
  const started = game.status !== 'scheduled' && game.away.runs != null && game.home.runs != null;
  const status =
    game.status === 'live' && st
      ? `${st.half === 'top' ? '▲' : '▼'}${st.inning}`
      : game.status === 'final'
        ? 'Final'
        : game.startsAt;

  return (
    <button
      type="button"
      role="menuitem"
      className="gamemenu__item"
      data-current={current}
      aria-current={current || undefined}
      onClick={onPick}
    >
      <span className="gamemenu__teams">
        {['away', 'home'].map((side) => (
          <span className="gamemenu__team" key={side}>
            <TeamLogo abbr={game[side].abbr} size={16} />
            <span className="gamemenu__abbr">{game[side].abbr}</span>
            {started && <span className="gamemenu__runs u-num">{game[side].runs}</span>}
          </span>
        ))}
      </span>
      <span className="gamemenu__status u-num" data-status={game.status}>
        {game.status === 'live' && <span className="gamemenu__dot" aria-hidden="true" />}
        {status}
      </span>
    </button>
  );
}
