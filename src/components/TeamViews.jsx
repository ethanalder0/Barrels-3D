import { teamFor } from '../data/teamStyle.js';
import {
  DIVISIONS,
  TEAM_CATS,
  catDefinition,
  catLabel,
  clubOrder,
  divisionOf,
  fixed1,
  ordinal,
  rankOf,
  rosterSections,
  strengths,
  teamPatch,
  teamValue,
} from '../data/playerBoard.js';
import PlayersTable from './PlayersTable.jsx';
import { groupStyle } from './RatingsWheel.jsx';
import TeamLogo from './TeamLogo.jsx';

/* All thirty marks, by division, across the top of the page. Picking one is how
   you answer "who's on this team?"; with other filters set it is one more. */
export function TeamStrip({ view, onChange }) {
  const teamsOpen = view.view === 'teams';
  return (
    <section className="pteams" aria-label="Browse by team">
      <div className="pteams__head">
        <p className="u-kicker">Browse by team</p>
        <button
          type="button"
          className="pteams__board"
          aria-pressed={teamsOpen}
          onClick={() => onChange({ view: teamsOpen ? 'players' : 'teams' })}
        >
          Team leaderboard <span aria-hidden="true">→</span>
        </button>
      </div>
      <div className="pteams__divisions">
        {DIVISIONS.map((division) => (
          <div key={division.name} className="pteams__division">
            <p className="pteams__divname">{division.name}</p>
            <div className="pteams__marks">
              {division.teams.map((abbr) => {
                const on = view.team === abbr;
                return (
                  <button
                    key={abbr}
                    type="button"
                    className="pteams__mark"
                    data-dim={!teamsOpen && Boolean(view.team) && !on}
                    aria-pressed={on}
                    aria-label={`Browse the ${teamFor(abbr)?.fullName ?? abbr} roster`}
                    title={teamFor(abbr)?.fullName}
                    onClick={() => onChange(teamPatch(view, abbr))}
                  >
                    <TeamLogo abbr={abbr} size={30} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* A club's page: its overall split into the two halves it averages, where it
   ranks on every rating, then who is on it. */
export function TeamRoster({ board, view, scale, onChange, onSort }) {
  const abbr = view.team;
  const team = teamFor(abbr);
  const stats = board.teams[abbr];
  const club = board.players.filter((p) => p.team === abbr);
  const pitchers = club.filter((p) => p.isPitcher).length;
  const sections = rosterSections(board, abbr, view.sort, view.pt);
  const leading = strengths(board, abbr, scale);
  const label = (key) => board.meta[key]?.label ?? key;

  const score = (cat, title, sub) => {
    const rank = rankOf(board, abbr, cat, scale);
    return (
      <button
        key={cat}
        type="button"
        className="pscore"
        data-lead={cat === 'overall'}
        aria-label={`${title} ${fixed1(teamValue(board, abbr, cat, scale))}. See the leaderboard.`}
        onClick={() => onChange({ view: 'teams', cat })}
      >
        <span className="pscore__label">{title}</span>
        <span className="pscore__value">{fixed1(teamValue(board, abbr, cat, scale))}</span>
        <span className="pscore__rank">{rank ? `${ordinal(rank)} of ${clubOrder(board, cat, scale).length}` : 'Not ranked'}</span>
        <span className="pscore__sub">{sub}</span>
      </button>
    );
  };

  return (
    <>
      <div className="pmast">
        <span className="pmast__bar" style={{ background: team?.primary }} />
        <div className="pmast__row">
          <TeamLogo abbr={abbr} size={64} className="pmast__logo" />
          <div className="pmast__who">
            <p className="u-kicker">
              {divisionOf(abbr)} · {club.length - pitchers} hitters · {pitchers} pitchers
            </p>
            <h2 className="pmast__name">{team?.fullName ?? abbr}</h2>
          </div>
          <button type="button" className="pmast__all" onClick={() => onChange(teamPatch(view, abbr))}>
            All players <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>

      <div className="pscores">
        {score('overall', 'Team Overall', 'Hitting and Pitching, averaged')}
        {score('hitting', 'Hitting', `${stats?.hitters ?? 0} rated hitters, by plate appearances`)}
        {score('pitching', 'Pitching', `${stats?.pitchers ?? 0} rated pitchers, by batters faced`)}
      </div>
      <p className="pscores__formula">
        {fixed1(teamValue(board, abbr, 'overall', scale))} = ({fixed1(teamValue(board, abbr, 'hitting', scale))} +{' '}
        {fixed1(teamValue(board, abbr, 'pitching', scale))}) ÷ 2
      </p>
      {leading && (
        <p className="pmast__deck">
          Ranks highest in {label(leading.best.key)} ({ordinal(leading.best.rank)}) and lowest in{' '}
          {label(leading.worst.key)} ({ordinal(leading.worst.rank)}).
        </p>
      )}

      <h3 className="psection__title">Team ratings</h3>
      <div className="pranks">
        {['hitting', 'running', 'fielding', 'pitching'].map((group) => (
          <div key={group} className="pranks__group" data-group={group}>
            <p className="pranks__name">{groupStyle(group).name}</p>
            {Object.values(board.meta)
              .filter((a) => a.group === group)
              .map((attr) => {
                const rank = rankOf(board, abbr, attr.key, scale);
                return (
                  <button
                    key={attr.key}
                    type="button"
                    className="prank"
                    title={catDefinition(board, attr.key)}
                    data-top={rank != null && rank <= 5}
                    aria-label={`${attr.label}: ${rank ? `${ordinal(rank)}` : 'not ranked'}. See the leaderboard.`}
                    onClick={() => onChange({ view: 'teams', cat: attr.key })}
                  >
                    <span className="prank__label">{attr.label}</span>
                    <span className="prank__value">{fixed1(teamValue(board, abbr, attr.key, scale))}</span>
                    <span className="prank__rank">{rank ? ordinal(rank) : '—'}</span>
                    {rank && <span className="pbar" style={{ width: `${((31 - rank) / 30) * 100}%` }} />}
                  </button>
                );
              })}
          </div>
        ))}
      </div>
      <p className="pfoot">The red bar is the club’s rank: full width is first.</p>

      {sections.map((section) => (
        <section key={section.title} className="psection">
          <h3 className="psection__title">
            {section.title} <span className="psection__count">{section.rows.length}</span>
          </h3>
          <PlayersTable
            board={board}
            keys={section.keys}
            rows={section.rows}
            view={view}
            scale={scale}
            onSort={onSort}
          />
        </section>
      ))}
    </>
  );
}

/* All thirty clubs, one number at a time, with Overall, Hitting and Pitching
   always beside it. A ranked list, like the league leaders. */
export function TeamBoard({ board, view, scale, onChange }) {
  const cat = view.cat;
  const order = clubOrder(board, cat, scale);
  const leader = teamValue(board, order[0], cat, scale);
  const columns = TEAM_CATS.includes(cat) ? TEAM_CATS : [cat, ...TEAM_CATS];
  const grid = { '--columns': columns.length };
  const everyCat = [...TEAM_CATS, ...Object.keys(board.meta)];

  return (
    <>
      <p className="u-kicker pboard__kicker">Team leaderboard · {board.season}</p>
      <h2 className="psentence">
        Clubs ranked by <em className="psentence__term">{catLabel(board, cat)}</em>
      </h2>
      <p className="pboard__def">{catDefinition(board, cat)}</p>

      <div role="group" aria-label="Rank clubs by" className="pboard__chips">
        {everyCat.map((c) => (
          <button key={c} type="button" aria-pressed={c === cat} onClick={() => onChange({ cat: c })}>
            {catLabel(board, c)}
          </button>
        ))}
      </div>

      <div className="pboard__head" style={grid}>
        <span className="pboard__rankhead">#</span>
        <span>Club</span>
        {columns.map((c) => (
          <button key={c} type="button" data-on={c === cat} aria-pressed={c === cat} onClick={() => onChange({ cat: c })}>
            {c === 'overall' ? 'Overall' : catLabel(board, c)}
          </button>
        ))}
      </div>
      <ol className="pboard__list">
        {order.map((abbr, i) => {
          const team = teamFor(abbr);
          const value = teamValue(board, abbr, cat, scale);
          return (
            <li key={abbr}>
              <button
                type="button"
                className="pboard__row"
                style={grid}
                data-here={view.team === abbr}
                aria-label={`${ordinal(i + 1)}, ${team?.fullName ?? abbr}, ${fixed1(value)}. Open the roster.`}
                onClick={() => onChange(teamPatch({ ...view, view: 'teams' }, abbr))}
              >
                <span className="pboard__rank">{i + 1}</span>
                <span className="pboard__club">
                  <TeamLogo abbr={abbr} size={34} />
                  <span className="pboard__clubtext">
                    <span className="pboard__name">{team?.fullName ?? abbr}</span>
                    <span className="pboard__div">{divisionOf(abbr)}</span>
                    <span className="pboard__line">
                      {cat === 'overall'
                        ? `Hitting ${fixed1(teamValue(board, abbr, 'hitting', scale))} · Pitching ${fixed1(teamValue(board, abbr, 'pitching', scale))}`
                        : `Overall ${fixed1(teamValue(board, abbr, 'overall', scale))}`}
                    </span>
                  </span>
                </span>
                {columns.map((c) => (
                  <span key={c} className="pboard__cell" data-on={c === cat}>
                    {fixed1(teamValue(board, abbr, c, scale))}
                  </span>
                ))}
                <span className="pbar" style={{ width: `${(value / leader) * 100}%` }} />
              </button>
            </li>
          );
        })}
      </ol>
      <p className="pfoot">
        Bars run against the leader. Clubs show one decimal because these are averages, not one player’s rating. Open
        a club to see who is behind the number.
      </p>
    </>
  );
}
