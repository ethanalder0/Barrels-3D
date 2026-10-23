import { useLiveData } from '../state/LiveDataProvider.jsx';
import PlayerName from './PlayerName.jsx';
import TeamLogo from './TeamLogo.jsx';

/**
 * The score band across the top of the live page, in three columns split by
 * ink rules: both clubs with their runs, the situation (half, bases, count),
 * and the line score. Everything comes from the current snapshot; `bases` is
 * the real `linescore.offense` runner set.
 */
export default function Scorebug() {
  const { game, lineScore, bases, matchup } = useLiveData();
  if (!game) return <BandSkeleton />;

  const st = game.state;
  const homeBatting = st?.half === 'bottom';

  return (
    <section className="scoreband" aria-label="Score">
      <div className="scoreband__teams">
        <TeamRow team={game.away} batting={st ? !homeBatting : false} />
        <TeamRow team={game.home} batting={st ? homeBatting : false} />
        {matchup?.batter && (
          <p className="scoreband__matchup">
            <span className="scoreband__kicker">At bat</span>
            <PlayerName playerId={matchup.batterId} name={matchup.batter} className="scoreband__who" />
            {matchup.pitcher && (
              <>
                <span className="scoreband__vs">vs</span>
                <PlayerName
                  playerId={matchup.pitcherId}
                  name={matchup.pitcher}
                  className="scoreband__who"
                />
              </>
            )}
            {matchup.onDeck && <span className="scoreband__deck">On deck · {matchup.onDeck}</span>}
          </p>
        )}
      </div>

      <div className="scoreband__state">
        {st ? (
          <>
            <div className="scoreband__inning">
              <span aria-hidden="true">{st.half === 'top' ? '▲' : '▼'}</span>{' '}
              {st.half === 'top' ? 'Top' : 'Bot'} {ordinal(st.inning)}
            </div>
            <Diamond bases={bases} />
            <div className="count">
              <span className="count__label">B</span>
              <Pips total={3} on={st.balls} />
              <span className="count__label">S</span>
              <Pips total={2} on={st.strikes} />
              <span className="count__label">O</span>
              <Pips total={3} on={st.outs} variant="out" />
            </div>
          </>
        ) : (
          <div className="scoreband__idle">
            <p className="scoreband__inning">{game.status === 'final' ? 'Final' : game.startsAt}</p>
            {game.detailedStatus && <p className="scoreband__detail">{game.detailedStatus}</p>}
          </div>
        )}
      </div>

      <div className="scoreband__line">
        <LineScore game={game} lineScore={lineScore} />
      </div>
    </section>
  );
}

function BandSkeleton() {
  return (
    <section className="scoreband" aria-label="Score" aria-busy="true">
      <div className="scoreband__teams">
        <div className="skeleton" style={{ height: 56 }} />
        <div className="skeleton" style={{ height: 56 }} />
      </div>
    </section>
  );
}

function TeamRow({ team, batting }) {
  return (
    <div className="scoreteam" data-batting={batting}>
      <TeamLogo abbr={team.abbr} size={48} />
      <div className="scoreteam__id">
        <span className="scoreteam__name">{team.name}</span>
        {team.record && <span className="scoreteam__record u-num">{team.record}</span>}
        {batting && <span className="scoreteam__bat">At bat</span>}
      </div>
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

  // Runner names when we have them — a diamond that can say who is on is
  // strictly more useful to a screen reader than "runners on first and third".
  const named = ['first', 'second', 'third']
    .filter((b) => bases?.[b])
    .map((b) => `${bases[b]} on ${b}`)
    .join(', ');

  return (
    <div className="diamond" role="img" aria-label={named || 'Bases empty'} title={named || 'Bases empty'}>
      <span className="diamond__base diamond__base--second" data-occupied={occupied.second} />
      <span className="diamond__base diamond__base--third" data-occupied={occupied.third} />
      <span className="diamond__base diamond__base--first" data-occupied={occupied.first} />
    </div>
  );
}

function LineScore({ game, lineScore }) {
  const innings = lineScore?.innings?.length
    ? lineScore.innings
    : Array.from({ length: 9 }, (_, i) => ({ inning: i + 1, away: null, home: null }));
  const totals = lineScore?.totals ?? {
    away: { r: '–', h: '–', e: '–' },
    home: { r: '–', h: '–', e: '–' },
  };

  // The half-inning being played, lit in red. Nothing is lit once it's over.
  const st = game.status === 'live' ? game.state : null;
  const current = st ? { inning: st.inning, side: st.half === 'top' ? 'away' : 'home' } : null;

  return (
    <table className="linescore">
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
          <th scope="col" className="total total--first">R</th>
          <th scope="col" className="total">H</th>
          <th scope="col" className="total">E</th>
        </tr>
      </thead>
      <tbody>
        {['away', 'home'].map((side) => (
          <tr key={side}>
            <th scope="row">{game[side].abbr}</th>
            {innings.map((i) => (
              <td
                key={i.inning}
                data-current={current?.inning === i.inning && current.side === side ? true : undefined}
              >
                {i[side] ?? ''}
              </td>
            ))}
            <td className="total total--first">{totals[side].r}</td>
            <td className="total">{totals[side].h}</td>
            <td className="total">{totals[side].e}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
