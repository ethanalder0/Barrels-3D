import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '../state/AppState.jsx';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import { fetchGameStatcast } from '../data/liveClient.js';
import {
  DEFAULT_LEADER_CATEGORY,
  GAME_LEADER_VISIBLE,
  LEADER_CATEGORIES,
  gameLeaders,
} from '../data/gameLeaders.js';
import { teamVars } from '../data/teamStyle.js';
import { IconChevron } from './Icons.jsx';
import TeamLogo from './TeamLogo.jsx';
import { scrollReplayIntoView } from './ReplayViewport.jsx';

const STATCAST_REFRESH_MS = 30_000;

/**
 * This game's best: hardest hit, fastest swing, hardest thrown. One row per
 * player (their best event), and each row replays the play it came from.
 *
 * Bat speed and spin rate come from Savant, fetched only while one of those
 * boards is open and refreshed while the game is live.
 *
 * A row starts its replay, so it also scrolls the replay back into view.
 */
export default function GameLeaders() {
  const { state, actions } = useAppState();
  const { atBats, game, mode } = useLiveData();
  const [categoryId, setCategoryId] = useState(DEFAULT_LEADER_CATEGORY);
  const category = LEADER_CATEGORIES.find((c) => c.id === categoryId) ?? LEADER_CATEGORIES[0];
  const statcast = useGameStatcast(category.statcast && mode === 'live' ? game : null);

  const rows = useMemo(
    () => gameLeaders(category.id, { atBats, statcast: statcast.pitches, game }),
    [category.id, atBats, statcast.pitches, game],
  );

  const metric = state.settings.units === 'metric';
  const groups = [...new Set(LEADER_CATEGORIES.map((c) => c.group))];
  const listRef = useVisibleRows(GAME_LEADER_VISIBLE, rows);

  return (
    <section className="panel gameleaders" aria-label="Game leaders">
      <div className="panel__head">
        <div className="panel__title">
          <h3>Game leaders</h3>
        </div>

        <label className="select select--sm">
          <span className="u-visually-hidden">Stat category</span>
          <select
            className="select__input"
            value={category.id}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {groups.map((group) => (
              <optgroup key={group} label={group}>
                {LEADER_CATEGORIES.filter((c) => c.group === group).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="select__chevron" aria-hidden="true">
            <IconChevron dir="down" size={12} />
          </span>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="gameleaders__empty">{emptyMessage(category, mode, statcast.status)}</p>
      ) : (
        <ol className="gameleaders__list" ref={listRef}>
          {rows.map((row) => {
            const { value, unit } = format(row.value, category.unit, metric);
            return (
              <li key={`${row.playerId || row.name}`} style={teamVars(row.team)}>
                <button
                  type="button"
                  className="gameleaders__row"
                  aria-current={row.ab.id === state.selectedAtBatId}
                  onClick={() => {
                    actions.selectAtBat(row.ab.id);
                    scrollReplayIntoView();
                  }}
                  title={`Replay: ${row.ab.detail ?? row.context}`}
                >
                  <span className="gameleaders__rank u-num">{row.rank}</span>
                  <TeamLogo abbr={row.team} size={30} />
                  <span className="gameleaders__who">
                    <span className="gameleaders__name">{row.name}</span>
                    <span className="gameleaders__context">
                      {row.context} · {row.ab.inningLabel}
                    </span>
                  </span>
                  <span className="gameleaders__value u-num">
                    {value}
                    <small>{unit}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * Size a list to show exactly `count` of its rows and scroll for the rest.
 *
 * Measured rather than set in CSS, because a row's height depends on the type
 * scale and on whether its context line wraps. Re-measured when the rows
 * change and when the list is resized.
 */
function useVisibleRows(count, rows) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return undefined;
    const fit = () => {
      const items = [...list.children].slice(0, count);
      const height = items.reduce((sum, li) => sum + li.getBoundingClientRect().height, 0);
      list.style.maxHeight = list.children.length > count && height ? `${height}px` : '';
    };
    fit();
    /* The rows as well as the list: a row grows when the web fonts land, and
       the list itself does not change size when its max-height is holding it,
       so watching only the list left the fifth row clipped. */
    const observer = new ResizeObserver(fit);
    observer.observe(list);
    [...list.children].slice(0, count).forEach((li) => observer.observe(li));
    return () => observer.disconnect();
  }, [count, rows]);
  return ref;
}

function format(v, kind, metric) {
  if (kind === 'speed') {
    return { value: (metric ? v * 1.60934 : v).toFixed(1), unit: metric ? 'km/h' : 'mph' };
  }
  if (kind === 'distance') {
    return { value: String(Math.round(metric ? v * 0.3048 : v)), unit: metric ? 'm' : 'ft' };
  }
  return { value: Math.round(v).toLocaleString(), unit: 'rpm' };
}

function emptyMessage(category, mode, status) {
  if (category.statcast) {
    if (mode === 'demo') return `${category.label} needs the live backend.`;
    if (status === 'loading' || status === 'idle') return `Loading ${category.label.toLowerCase()}…`;
    if (status === 'error') return `${category.label} isn’t available for this game right now.`;
    return `No ${category.label.toLowerCase()} tracked yet.`;
  }
  return category.id === 'pitchVelo' ? 'No pitches tracked yet.' : 'No batted balls tracked yet.';
}

/**
 * Savant's per-pitch rows for a game. Fetched once for a finished game, every
 * STATCAST_REFRESH_MS while one is live. Pass null to fetch nothing.
 */
function useGameStatcast(game) {
  const gamePk = game?.gamePk ?? null;
  const live = game?.status === 'live';
  const [data, setData] = useState({ gamePk: null, pitches: null, status: 'idle' });

  useEffect(() => {
    if (!gamePk) return undefined;
    let cancelled = false;
    const controller = new AbortController();

    const load = () =>
      fetchGameStatcast(gamePk, { signal: controller.signal })
        .then((payload) => {
          if (!cancelled) setData({ gamePk, pitches: payload.pitches ?? [], status: 'ok' });
        })
        .catch((err) => {
          if (cancelled || err.name === 'AbortError') return;
          // Keep the last good rows through a failed refresh.
          setData((prev) =>
            prev.gamePk === gamePk && prev.pitches ? prev : { gamePk, pitches: null, status: 'error' },
          );
        });

    setData((prev) => (prev.gamePk === gamePk ? prev : { gamePk, pitches: null, status: 'loading' }));
    load();
    const timer = live ? setInterval(load, STATCAST_REFRESH_MS) : null;
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [gamePk, live]);

  // Rows from a previous game must never rank this one's players.
  return data.gamePk === gamePk ? data : { gamePk, pitches: null, status: gamePk ? 'loading' : 'idle' };
}
