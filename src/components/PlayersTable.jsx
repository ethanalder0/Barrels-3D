import { useAppState } from '../state/AppState.jsx';
import { isRegular, keyline, overallOf, scoreOf, thresholdOf } from '../data/playerBoard.js';
import MiniWheel from './MiniWheel.jsx';
import { SHORT_LABELS, groupStyle } from './RatingsWheel.jsx';
import TeamLogo from './TeamLogo.jsx';

/* Headers sit in a 60px column. "Power" alone would not say which one, and the
   soft hyphens let the two long words break where a reader expects. */
const COLUMN_LABELS = {
  gamePower: 'Game power',
  consistency: 'Consis­tency',
  baserunning: 'Base­running',
};

const columnLabel = (key) => COLUMN_LABELS[key] ?? SHORT_LABELS[key] ?? key;

/* The same four tiers as the rest of the ratings: press red reads as elite. */
function tierOf(pct) {
  if (pct == null) return 'none';
  if (pct >= 80) return 'elite';
  if (pct >= 60) return 'good';
  if (pct >= 40) return 'avg';
  return 'low';
}

/** Runs of neighbouring columns in one group, for the header above them. */
function columnGroups(board, keys) {
  const groups = [];
  keys.forEach((key) => {
    const group = board.meta[key]?.group;
    const last = groups[groups.length - 1];
    if (last?.group === group) last.span += 1;
    else groups.push({ group, span: 1 });
  });
  return groups;
}

/**
 * Players and their ratings. Columns are the ratings that apply here; the ones
 * being filtered on are tinted and print their limit. The whole row opens the
 * card for a mouse, and the name is the real button for everyone else.
 *
 * On a phone CSS folds each row to its wheel, name and overall, and the
 * `keyline` underneath carries only the numbers that were asked about.
 */
export default function PlayersTable({ board, keys, rows, view, scale, onSort }) {
  const { actions } = useAppState();
  const filters = Object.fromEntries(view.ratings.map((f) => [f.key, f]));
  const narrow = keys.length <= 8;
  const pitchers = rows.length > 0 && rows.every((p) => p.isPitcher);

  const SortHeader = ({ sortKey, label, title, className = '' }) => {
    const sorted = view.sort.key === sortKey;
    const filter = filters[sortKey];
    return (
      <th
        scope="col"
        className={`ptable__th ${className}`}
        data-on={Boolean(filter)}
        data-sorted={sorted}
        aria-sort={sorted ? (view.sort.dir < 0 ? 'descending' : 'ascending') : 'none'}
      >
        <button type="button" title={title} onClick={() => onSort(sortKey)}>
          <span>
            {label}
            {sorted && <span className="ptable__arrow" aria-hidden="true">{view.sort.dir < 0 ? ' ▼' : ' ▲'}</span>}
          </span>
          {filter && (
            <span className="ptable__limit">
              {filter.op === 'max' ? '≤' : '≥'}
              {thresholdOf(filter, scale)}
            </span>
          )}
        </button>
      </th>
    );
  };

  return (
    <div className="ptable-wrap">
      <table className="ptable" data-narrow={narrow}>
        <thead>
          <tr className="ptable__groups">
            <th colSpan={3} aria-hidden="true" className="ptable__groupblank" />
            {columnGroups(board, keys).map(({ group, span }, i) => (
              <th key={`${group}-${i}`} colSpan={span} scope="colgroup" data-group={group}>
                {groupStyle(group).name}
              </th>
            ))}
          </tr>
          <tr>
            <SortHeader sortKey="name" label="Player" title="Player name" className="ptable__th--who" />
            <SortHeader sortKey="ovr" label="OVR" title="Overall" />
            <SortHeader
              sortKey="pt"
              label={pitchers ? 'BF' : 'PA'}
              title={pitchers ? 'Batters faced this season' : 'Plate appearances this season'}
              className="ptable__th--pt"
            />
            {keys.map((key) => (
              <SortHeader
                key={key}
                sortKey={key}
                label={columnLabel(key)}
                title={`${board.meta[key]?.label}: ${board.meta[key]?.question}`}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((player) => {
            const overall = overallOf(player, scale);
            return (
              <tr key={player.id} className="ptable__row" onClick={() => actions.openPlayer(player.id)}>
                <td className="ptable__who">
                  <MiniWheel attributes={player.attrs} scale={scale} />
                  <span className="ptable__id">
                    <button type="button" className="ptable__name">
                      {player.name}
                    </button>
                    <span className="ptable__meta">
                      {player.team && <TeamLogo abbr={player.team} size={14} />}
                      {[player.team, player.pos, `${player.bats ?? '—'}/${player.throws ?? '—'}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span className="ptable__keyline">{keyline(board, player, view, scale)}</span>
                  </span>
                </td>
                <td className="ptable__ovr" data-empty={overall == null}>
                  {overall ?? '—'}
                </td>
                <td className="ptable__pt" data-regular={isRegular(board, player)}>
                  {player.pt || '—'}
                </td>
                {keys.map((key) => {
                  const pct = scoreOf(player, key, 'pct');
                  return (
                    <td key={key} className="ptable__score" data-tier={tierOf(pct)} data-on={Boolean(filters[key])}>
                      {scoreOf(player, key, scale) ?? '—'}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
