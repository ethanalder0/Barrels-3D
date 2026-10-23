import { useEffect, useMemo, useRef } from 'react';
import { useAppState } from '../state/AppState.jsx';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import { IconChevron, IconPlay } from './Icons.jsx';
import { scrollReplayIntoView } from './ReplayViewport.jsx';

/**
 * Pick any play of the game to replay.
 *
 * A native select rather than a custom listbox: a full game is seventy-odd
 * plays, and the platform picker scrolls, type-searches and works on a phone
 * without any of that being rebuilt here. Plays are grouped by half-inning,
 * newest first, each reading "Result | Batter vs Pitcher".
 *
 * Picking a play turns off follow-live, same as choosing one anywhere else;
 * the replay banner offers it back. It also scrolls the replay back into view,
 * because the replay starts the moment you pick and this panel sits below it.
 *
 * Highlights play the whole list, from the first pitch of the game to now, one
 * after another (ReplayViewport runs them). For catching up on a game you
 * joined late, or watching back one that is over.
 *
 * Under the picker, the same plays as a running play-by-play: a scannable
 * column of the game where the select is a way to jump. Clicking a row is the
 * same as picking it above. The list holds its height and scrolls, keeping the
 * selected row in view as plays are stepped through.
 */
export default function ActionReplay() {
  const { state, actions } = useAppState();
  const { atBats, mode, connection } = useLiveData();

  const groups = useMemo(() => {
    const out = [];
    for (const ab of atBats) {
      const label = halfLabel(ab);
      const last = out[out.length - 1];
      if (last && last.label === label) last.plays.push(ab);
      else out.push({ label, plays: [ab] });
    }
    return out;
  }, [atBats]);

  const index = atBats.findIndex((ab) => ab.id === state.selectedAtBatId);
  const selected = atBats[index] ?? null;
  // Newest first, so "earlier" is further down the list.
  const earlier = index >= 0 ? atBats[index + 1] : null;
  const later = index > 0 ? atBats[index - 1] : null;

  const play = (id) => {
    actions.selectAtBat(id);
    scrollReplayIntoView();
  };

  // Keep the selected row in view inside the list, without moving the page.
  const listRef = useRef(null);
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector('[aria-current="true"]');
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 2 + row.offsetHeight / 2;
    }
  }, [state.selectedAtBatId]);

  const highlights = state.highlights != null;
  const toggleHighlights = () => {
    if (highlights) {
      actions.stopHighlights();
      return;
    }
    actions.startHighlights(atBats[atBats.length - 1].id); // newest first: the last is the first
    scrollReplayIntoView();
  };

  return (
    <section className="panel panel--boxed actionreplay" aria-label="Action replay">
      <div className="panel__head">
        <div className="panel__title">
          <h3>Action Replay</h3>
          {atBats.length > 0 && <span className="chip chip--count">{atBats.length}</span>}
        </div>

        {atBats.length > 0 && (
          <div className="actionreplay__steps">
            <button
              type="button"
              className="btn btn--primary btn--sm actionreplay__highlights"
              onClick={toggleHighlights}
              aria-pressed={highlights}
              title={
                highlights
                  ? 'Stop the highlights here'
                  : 'Play every play of the game in order, from the first inning to now'
              }
            >
              <IconPlay stop={highlights} />
              {highlights ? 'Stop' : 'Highlights'}
            </button>
            <button
              type="button"
              className="actionreplay__step"
              onClick={() => earlier && play(earlier.id)}
              disabled={!earlier}
              aria-label="Previous play"
              title="Previous play"
            >
              <IconChevron dir="left" size={14} />
            </button>
            <button
              type="button"
              className="actionreplay__step"
              onClick={() => later && play(later.id)}
              disabled={!later}
              aria-label="Next play"
              title="Next play"
            >
              <IconChevron dir="right" size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="panel__body actionreplay__body">
        {atBats.length === 0 ? (
          <p className="actionreplay__empty">
            {mode === 'connecting' || connection === 'connecting'
              ? 'Connecting to the feed…'
              : 'No plays yet — waiting for first pitch.'}
          </p>
        ) : (
          <>
            <label className="select">
              <span className="u-visually-hidden">Play to replay</span>
              <select
                className="select__input"
                value={selected?.id ?? ''}
                onChange={(e) => play(e.target.value)}
              >
                {groups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.plays.map((ab) => (
                      <option key={ab.id} value={ab.id}>
                        {playName(ab)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="select__chevron" aria-hidden="true">
                <IconChevron dir="down" size={14} />
              </span>
            </label>

            {selected && (
              <p className="actionreplay__detail">
                <span className="actionreplay__inning u-num">{selected.inningLabel}</span>
                {selected.detail}
              </p>
            )}
          </>
        )}
      </div>

      {atBats.length > 0 && (
        <ol className="pbp" ref={listRef} aria-label="Play-by-play">
          {atBats.map((ab) => (
            <li key={ab.id}>
              <button
                type="button"
                className="pbp__row"
                aria-current={ab.id === selected?.id}
                onClick={() => play(ab.id)}
              >
                <span className="pbp__inning u-num">{ab.inningLabel}</span>
                <span className="pbp__play">
                  {resultOf(ab)} · <span className="pbp__who">{ab.batter}</span>
                </span>
                <span className="pbp__ev u-num">{ab.exitVelo != null ? ab.exitVelo.toFixed(1) : ''}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** "Strikeout | Nick Gonzales vs Kyle Harrison" */
export function playName(ab) {
  return `${resultOf(ab)} | ${ab.batter} vs ${ab.pitcher}`;
}

function resultOf(ab) {
  return ab.live ? 'At bat' : ab.result && ab.result !== '—' ? ab.result : 'Play';
}

function halfLabel(ab) {
  const top = ab.half ? ab.half === 'top' : ab.inningLabel?.startsWith('T');
  const inning = ab.inning ?? ab.inningLabel?.slice(1) ?? '?';
  return `${top ? 'Top' : 'Bottom'} ${inning}`;
}
