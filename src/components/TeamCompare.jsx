import { useAppState } from '../state/AppState.jsx';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import TeamLogo from './TeamLogo.jsx';

/**
 * The two lineups side by side: a tally of team batting stats, away on the
 * left and home on the right, each row with a split bar meeting in the middle.
 *
 * Each half of the bar is that side's value against the larger of the two, so
 * the leader's half always runs the full width and the other is in proportion.
 * The side doing better on a stat takes the red: the higher number usually,
 * the lower one where fewer is better (strikeouts). A level stat lights
 * neither side.
 *
 * Everything comes from the snapshot's `teamStats` (server/projection.py), so
 * it is the same for a live game and for one being watched back.
 */
const ROWS = [
  { id: 'hits', label: 'Hits', value: (t) => t.hits },
  { id: 'xbh', label: 'Extra-base hits', value: (t) => t.xbh },
  { id: 'walks', label: 'Walks', value: (t) => t.walks },
  { id: 'k', label: 'Strikeouts', value: (t) => t.strikeOuts, lowerIsBetter: true },
  {
    id: 'risp',
    label: 'With RISP',
    // Compared by average, shown as hits-for-at-bats the way a box score does.
    value: (t) => (t.risp && t.risp.ab ? t.risp.h / t.risp.ab : null),
    show: (t) => (t.risp ? `${t.risp.h}-${t.risp.ab}` : '—'),
  },
  { id: 'hard', label: 'Hard-hit balls', value: (t) => t.hardHit },
  {
    id: 'ev',
    label: 'Avg exit velo',
    value: (t) => t.avgExitVelo,
    show: (t, metric) =>
      t.avgExitVelo == null ? '—' : (metric ? t.avgExitVelo * 1.60934 : t.avgExitVelo).toFixed(1),
  },
  { id: 'sb', label: 'Stolen bases', value: (t) => t.stolenBases },
];

export default function TeamCompare() {
  const { state } = useAppState();
  const { game, teamStats } = useLiveData();
  if (!game) return null;

  const metric = state.settings.units === 'metric';
  const started = game.status !== 'scheduled';

  return (
    <section className="panel teamcompare" aria-label="Team comparison">
      <div className="panel__head">
        <div className="panel__title">
          <h3>Team comparison</h3>
        </div>
      </div>

      <div className="teamcompare__teams" aria-hidden="true">
        <span className="teamcompare__team">
          <TeamLogo abbr={game.away.abbr} size={24} />
          {game.away.abbr}
        </span>
        <span className="teamcompare__team">
          {game.home.abbr}
          <TeamLogo abbr={game.home.abbr} size={24} />
        </span>
      </div>

      {!teamStats || !started ? (
        <p className="teamcompare__empty">
          {started ? 'Team totals aren’t available for this game.' : 'Team totals start with first pitch.'}
        </p>
      ) : (
        <dl className="teamcompare__list">
          {ROWS.map((row) => (
            <CompareRow
              key={row.id}
              row={row}
              away={teamStats.away}
              home={teamStats.home}
              awayAbbr={game.away.abbr}
              homeAbbr={game.home.abbr}
              metric={metric}
            />
          ))}
        </dl>
      )}
    </section>
  );
}

function CompareRow({ row, away, home, awayAbbr, homeAbbr, metric }) {
  const a = row.value(away);
  const h = row.value(home);
  const max = Math.max(a ?? 0, h ?? 0);
  const share = (v) => (max > 0 && v != null ? Math.max(0, v) / max : 0);

  let better = null;
  if (a != null && h != null && a !== h) {
    better = (row.lowerIsBetter ? a < h : a > h) ? 'away' : 'home';
  }

  const show = (t, v) => (row.show ? row.show(t, metric) : (v ?? '—'));

  return (
    <div className="cmp" data-better={better ?? undefined}>
      <dt className="cmp__label">{row.label}</dt>
      <dd className="cmp__value cmp__value--away u-num" aria-label={`${awayAbbr} ${show(away, a)}`}>
        {show(away, a)}
      </dd>
      <dd className="cmp__value cmp__value--home u-num" aria-label={`${homeAbbr} ${show(home, h)}`}>
        {show(home, h)}
      </dd>
      <span className="cmp__bar" aria-hidden="true">
        <span className="cmp__half cmp__half--away">
          <span style={{ width: `${share(a) * 100}%` }} />
        </span>
        <span className="cmp__half cmp__half--home">
          <span style={{ width: `${share(h) * 100}%` }} />
        </span>
      </span>
    </div>
  );
}
