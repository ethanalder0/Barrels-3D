import { useMemo, useState } from 'react';
import {
  POSITIONS,
  PRESETS,
  TEAM_CATS,
  presetsFor,
  activePreset,
  catDefinition,
  catLabel,
  clubOrder,
  columnsFor,
  flipPatch,
  handPatch,
  isFiltered,
  isRoster,
  poolPatch,
  positionPatch,
  presetPatch,
  presetSummary,
  ratingPatch,
  scaleRange,
  thresholdOf,
  INITIAL_VIEW,
} from '../data/playerBoard.js';
import { groupStyle } from './RatingsWheel.jsx';
import { IconClose } from './Icons.jsx';

/* One-click starting points. Each prints exactly which filters it sets, so what
   it means is never a guess, and it switches off the moment you change one. */
const PRESETS_SHOWN = 6;

export function Presets({ board, view, scale, onChange, className = '', collapse = false }) {
  const [more, setMore] = useState(false);
  const summaries = useMemo(
    () => Object.fromEntries(PRESETS.map((p) => [p.id, presetSummary(board, p, scale)])),
    [board, scale],
  );
  const active = activePreset(view)?.id;
  // The hitters' or the pitchers', whichever list is showing.
  const list = presetsFor(view.pool);
  // A preset in use is never tucked away behind the button.
  const open = !collapse || more || list.findIndex((p) => p.id === active) >= PRESETS_SHOWN;
  const shown = open ? list : list.slice(0, PRESETS_SHOWN);
  const hidden = list.length - PRESETS_SHOWN;
  return (
    <>
    <ul className={`ppresets ${className}`}>
      {shown.map((preset) => (
        <li key={preset.id}>
          <button
            type="button"
            className="ppreset"
            aria-pressed={active === preset.id}
            onClick={() => onChange(presetPatch(preset))}
          >
            <span className="ppreset__top">
              <span className="ppreset__name">{preset.name}</span>
              <span className="ppreset__count">{summaries[preset.id].count}</span>
            </span>
            <span className="ppreset__def">{summaries[preset.id].definition}</span>
          </button>
        </li>
      ))}
    </ul>
    {collapse && hidden > 0 && (
      <button type="button" className="ppresets__more" aria-expanded={open} onClick={() => setMore(!open)}>
        {open ? 'Fewer presets' : `More presets (${hidden})`}
      </button>
    )}
    </>
  );
}

function Choice({ label, value, options, onPick, className = '', small = false }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={small ? `pchoice pchoice--small ${className}` : `pchoice ${className}`}
    >
      {options.map(([key, text]) => (
        <button key={key} type="button" aria-pressed={value === key} onClick={() => onPick(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/* A threshold on one rating. The red run of the track is the part that passes,
   so "at least" and "at most" read without a word, and the tick is average. */
function RatingSlider({ attr, filter, scale, onDrag, onFlip }) {
  const [lo, hi] = scaleRange(scale);
  const value = filter ? thresholdOf(filter, scale) : lo;
  const at = ((value - lo) / (hi - lo)) * 100;
  const avg = ((50 - lo) / (hi - lo)) * 100;
  const atMost = filter?.op === 'max';
  return (
    <div className="pslider" data-active={Boolean(filter)} title={attr.question}>
      <div className="pslider__head">
        <label className="pslider__label" htmlFor={`pslider-${attr.key}`}>
          {attr.label}
        </label>
        {filter && (
          <button
            type="button"
            className="pslider__op"
            onClick={onFlip}
            aria-label={`${attr.label}: switch between at least and at most`}
          >
            {atMost ? 'at most' : 'at least'}
          </button>
        )}
        <span className="pslider__value">{filter ? (atMost ? `≤${value}` : `${value}+`) : '—'}</span>
      </div>
      <div className="pslider__rail">
        <span className="pslider__track" />
        <span className="pslider__avg" style={{ left: `${avg}%` }} />
        {filter && (
          <span
            className="pslider__fill"
            style={atMost ? { left: 0, width: `${at}%` } : { left: `${at}%`, right: 0 }}
          />
        )}
        <input
          id={`pslider-${attr.key}`}
          type="range"
          min={lo}
          max={hi}
          step={5}
          value={value}
          onChange={(e) => onDrag(e.target.value)}
        />
      </div>
    </div>
  );
}

/* The rail's two jobs. On the page's filters it sets who is listed; on the team
   leaderboard it picks what the clubs are ranked by. */
export function TeamCategories({ board, view, scale, onChange }) {
  const groups = [
    { key: 'team', name: 'Team', cats: TEAM_CATS },
    ...['hitting', 'running', 'fielding', 'pitching'].map((group) => ({
      key: group,
      name: `${groupStyle(group).name} ratings`,
      cats: Object.values(board.meta).filter((a) => a.group === group).map((a) => a.key),
    })),
  ];
  return (
    <div className="pcats">
      <p className="u-kicker pcats__head">Rank clubs by</p>
      {groups.map((group) => (
        <div key={group.key} className="pcats__group" data-group={group.key}>
          <p className="pcats__name">{group.name}</p>
          {group.cats.map((cat) => (
            <button
              key={cat}
              type="button"
              className="pcats__item"
              aria-pressed={view.cat === cat}
              title={catDefinition(board, cat)}
              onClick={() => onChange({ view: 'teams', cat })}
            >
              <span>{catLabel(board, cat)}</span>
              {/* Who leads each board, before you open it. */}
              <span className="pcats__leader">{clubOrder(board, cat, scale)[0]}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function PlayersFilters({ board, view, scale, onChange, open, onClose, resultCount }) {
  const roster = isRoster(view);
  const pool = view.pool ?? 'hitters';
  const filters = Object.fromEntries(view.ratings.map((f) => [f.key, f]));

  const groups = [];
  columnsFor(board, pool, view.pos).forEach((key) => {
    const attr = board.meta[key];
    const last = groups[groups.length - 1];
    if (last?.group === attr.group) last.attrs.push(attr);
    else groups.push({ group: attr.group, attrs: [attr] });
  });

  return (
    <aside
      className="prail"
      data-open={open}
      aria-label="Filters"
      onKeyDown={(e) => {
        if (open && e.key === 'Escape') onClose();
      }}
    >
      <div className="prail__sheethead">
        <h2>Filters</h2>
        <button type="button" className="prail__close" aria-label="Close filters" onClick={onClose}>
          <IconClose size={14} />
        </button>
      </div>

      <section className="prail__section prail__section--presets">
        <p className="u-kicker prail__kicker">Start from</p>
        <Presets board={board} view={view} scale={scale} onChange={onChange} collapse />
      </section>

      <section className="prail__section">
        <div className="prail__head">
          <p className="u-kicker prail__kicker">Filters</p>
          {isFiltered(view) && (
            <button type="button" className="prail__clear" onClick={() => onChange(INITIAL_VIEW)}>
              Clear all
            </button>
          )}
        </div>

        <Choice
          label="Hitters or pitchers"
          value={view.pool}
          options={[['hitters', 'Hitters'], ['pitchers', 'Pitchers']]}
          onPick={(next) => onChange(poolPatch(board, view, next))}
          className="pchoice--pool"
        />

        {pool === 'hitters' && (
          <div role="group" aria-label="Position" className="ppositions">
            {POSITIONS.map((pos) => (
              <button
                key={pos}
                type="button"
                aria-pressed={!roster && view.pos === pos}
                onClick={() => onChange(positionPatch(board, view, pos))}
              >
                {pos}
              </button>
            ))}
          </div>
        )}

        <div className="phands">
          {pool === 'hitters' && (
            <div className="phands__row">
              <span>Bats</span>
              <Choice
                small
                label="Bats"
                value={view.bats}
                options={[['Any', 'Any'], ['L', 'L'], ['R', 'R'], ['S', 'S']]}
                onPick={(next) => onChange(handPatch(view, 'bats', next))}
              />
            </div>
          )}
          <div className="phands__row">
            <span>Throws</span>
            <Choice
              small
              label="Throws"
              value={view.throws}
              options={[['Any', 'Any'], ['L', 'L'], ['R', 'R']]}
              onPick={(next) => onChange(handPatch(view, 'throws', next))}
            />
          </div>
        </div>
      </section>

      <section className="prail__section prail__section--ratings">
        {groups.map(({ group, attrs }) => (
          <div key={group} className="prail__group" data-group={group}>
            <p className="prail__groupname">{groupStyle(group).name}</p>
            {attrs.map((attr) => (
              <RatingSlider
                key={attr.key}
                attr={attr}
                filter={filters[attr.key]}
                scale={scale}
                onDrag={(raw) => onChange(ratingPatch(view, attr.key, raw, scale))}
                onFlip={() => onChange(flipPatch(view, attr.key))}
              />
            ))}
          </div>
        ))}
      </section>

      <button type="button" className="prail__show" onClick={onClose}>
        Show {resultCount} {resultCount === 1 ? 'player' : 'players'}
      </button>
    </aside>
  );
}
