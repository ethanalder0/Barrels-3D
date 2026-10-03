import { useLiveData } from '../state/LiveDataProvider.jsx';
import { teamVars } from '../data/teamStyle.js';
import PlayerName from './PlayerName.jsx';
import TeamLogo from './TeamLogo.jsx';

/**
 * Live scorebug + line score. Everything here comes from the current snapshot;
 * `bases` is the real `linescore.offense` runner set.
 */
export default function Scorebug() {
  const { game, lineScore, bases, matchup } = useLiveData();
  if (!game) return <PanelSkeleton />;

  const st = game.state;
  const homeBatting = st?.half === 'bottom';

  return (
    <section className="panel" aria-label="Score">
      <div className="scorebug">
        <div className="scorebug__teams">
          <TeamRow team={game.away} batting={st ? !homeBatting : false} />
          <TeamRow team={game.home} batting={st ? homeBatting : false} />
          {matchup?.batter && (
            <p className="scorebug__matchup">
              <span className="u-eyebrow">At bat</span>{' '}
              <PlayerName playerId={matchup.batterId} name={matchup.batter} />
              {matchup.pitcher && (
                <>
                  {' '}
                  <span className="atbat__vs">vs</span>{' '}
                  <PlayerName playerId={matchup.pitcherId} name={matchup.pitcher} />
                </>
              )}
            </p>
          )}
        </div>

        <div className="scorebug__state">
          {st ? (
            <>
              <div className="scorebug__inning">
                <span className="scorebug__half" aria-hidden="true">
                  {st.half === 'top' ? '▲' : '▼'}
                </span>
                <span>
                  {st.half === 'top' ? 'Top' : 'Bot'} {ordinal(st.inning)}
                </span>
              </div>

              <Diamond bases={bases} />

              <div className="count">
                <div className="count__group">
                  <span className="count__label">B</span>
                  <Pips total={3} on={st.balls} />
                </div>
                <div className="count__group">
                  <span className="count__label">S</span>
                  <Pips total={2} on={st.strikes} />
                </div>
                <div className="count__group">
                  <span className="count__label">O</span>
                  <Pips total={3} on={st.outs} variant="out" />
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <p className="u-eyebrow">{game.status === 'final' ? 'Final' : game.startsAt}</p>
              {game.detailedStatus && (
                <p className="scorebug__detail">{game.detailedStatus}</p>
              )}
            </div>
          )}
        </div>

        <LineScore game={game} lineScore={lineScore} />
      </div>
    </section>
  );
}

function PanelSkeleton() {
  return (
    <section className="panel" aria-label="Score" aria-busy="true">
      <div className="scorebug">
        <div className="scorebug__teams">
          <div className="skeleton" style={{ height: 42 }} />
          <div className="skeleton" style={{ height: 42 }} />
        </div>
      </div>
    </section>
  );
}

function TeamRow({ team, batting }) {
  // The batting side gets the club wash instead of the generic accent, so the
  // row that matters is also the row wearing the team's colour.
  return (
    <div className="scoreteam" data-batting={batting} style={teamVars(team.abbr)}>
      <TeamLogo abbr={team.abbr} size={26} className="scoreteam__logo" />
      <span className="scoreteam__abbr">{team.abbr}</span>
      <span className="scoreteam__name">
        {team.name}
        {team.record && <span className="scoreteam__record">{team.record}</span>}
      </span>
      <span className="scoreteam__runs u-num">{team.runs ?? '–'}</span>
    </div>
  );
}

function Pips({ total, on, variant }) {
  const lit = Math.min(on ?? 0, total);
  return (
    <span className="pips" role="img" aria-label={`${lit} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={variant === 'out' ? 'pip pip--out' : 'pip'} data-on={i < lit} />
      ))}
    </span>
  );
}

function Diamond({ bases }) {
  const occupied = {
    first: Boolean(bases?.first),
    second: Boolean(bases?.second),
    third: Boolean(bases?.third),
  };
  const on = Object.entries(occupied)
    .filter(([, v]) => v)
    .map(([b]) => b);

  // Runner names when we have them — a scorebug diamond that can say who is on
  // is strictly more useful to a screen reader than "runners on first and third".
  const named = ['first', 'second', 'third']
    .filter((b) => bases?.[b])
    .map((b) => `${bases[b]} on ${b}`)
    .join(', ');

  return (
    <div className="diamond" role="img" aria-label={named || 'Bases empty'} title={named || 'Bases empty'}>
      <span className="diamond__base diamond__base--second" data-occupied={occupied.second} />
      <span className="diamond__base diamond__base--third" data-occupied={occupied.third} />
      <span className="diamond__base diamond__base--first" data-occupied={occupied.first} />
      <span className="diamond__home" />
      <span className="u-visually-hidden">{on.length ? `Runners on ${on.join(', ')}` : 'Bases empty'}</span>
    </div>
  );
}

function LineScore({ game, lineScore }) {
  const innings = lineScore?.innings ?? Array.from({ length: 9 }, (_, i) => ({
    inning: i + 1,
    away: null,
    home: null,
  }));
  const totals = lineScore?.totals ?? {
    away: { r: '–', h: '–', e: '–' },
    home: { r: '–', h: '–', e: '–' },
  };

  return (
    <div className="linescore">
      <table>
        <caption className="u-visually-hidden">Line score by inning</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="u-visually-hidden">Team</span>
            </th>
            {innings.map((i) => (
              <th key={i.inning} scope="col">
                {i.inning}
              </th>
            ))}
            <th scope="col" className="total">R</th>
            <th scope="col" className="total">H</th>
            <th scope="col" className="total">E</th>
          </tr>
        </thead>
        <tbody>
          {['away', 'home'].map((side) => (
            <tr key={side}>
              <th scope="row">{game[side].abbr}</th>
              {innings.map((i) => (
                <td key={i.inning} className={i[side] == null ? 'empty' : undefined}>
                  {i[side] ?? '·'}
                </td>
              ))}
              <td className="total">{totals[side].r}</td>
              <td className="total">{totals[side].h}</td>
              <td className="total">{totals[side].e}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
