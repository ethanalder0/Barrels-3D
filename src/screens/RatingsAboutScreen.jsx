import { useAppState } from '../state/AppState.jsx';
import report from '../data/ratingsReport.json';
import { furthest, listed, padded, sharePct, signed } from '../data/ratingsReport.js';
import { teamFor } from '../data/teamStyle.js';
import Scatter from '../components/Scatter.jsx';
import { IconChevron } from '../components/Icons.jsx';

/* ---------------------------------------------------------------------------
   How Overall works: how the number is built, then how it lines up with the
   season's wins, runs and WAR.

   Every figure comes from ratingsReport.json (scripts/build_ratings_report.py),
   including which clubs and players the text names as furthest from the line,
   so a rebuild for a new season needs no edits here.
--------------------------------------------------------------------------- */

const POSITION_RUNS = [
  ['C', 12.5], ['SS', 7.5], ['2B', 2.5], ['3B', 2.5], ['CF', 2.5],
  ['LF', -7.5], ['RF', -7.5], ['1B', -12.5], ['DH', -17.5],
];
const PITCHER_WEIGHTS = [
  ['Run prevention (xERA)', 40], ['Bat-Missing', 20], ['Command', 15],
  ['Contact Management', 10], ['Stuff', 10], ['Chase', 5],
];
const PREMIUM = ['C', 'SS', 'CF', '2B', '3B'];
const GROUP_NAMES = {
  C: 'catchers',
  'SS/CF': 'shortstops and center fielders',
  '2B/3B': 'second and third basemen',
  'LF/RF': 'corner outfielders',
  '1B/DH': 'first basemen and DHs',
};

const club = (abbr) => teamFor(abbr)?.name ?? abbr;
const r2 = (r) => Math.abs(r).toFixed(2);
// A WAR with a true minus when it is negative, and no plus sign.
const war = (n) => n.toFixed(1).replace('-', '−');

export default function RatingsAboutScreen() {
  const { actions } = useAppState();
  const { fits, clubs, hitters, pitchers, hitterParts: parts } = report;

  const wins = furthest(clubs, fits.wins, (c) => c.overall, (c) => c.w);
  const scored = furthest(clubs, fits.runsScored, (c) => c.hitting, (c) => c.rs);
  const allowed = furthest(clubs, fits.runsAllowed, (c) => c.pitching, (c) => c.ra, 2);
  const bats = furthest(hitters, fits.hitters, (p) => p.overall, (p) => p.war);
  const topArms = pitchers.slice().sort((a, b) => b.war - a.war).slice(0, 4);

  const flagged = (rows) => new Set([...rows.above, ...rows.below]);
  const winsFlagged = flagged(wins);
  const scoredFlagged = flagged(scored);
  const allowedFlagged = flagged(allowed);
  const batsFlagged = flagged(bats);

  const clubPoints = (getX, getY, flags, tip) =>
    clubs.map((c) => ({
      id: c.team,
      x: getX(c),
      y: getY(c),
      label: c.team,
      keyLabel: flags.has(c) ? c.team : undefined,
      tip: tip(c),
    }));

  const groups = Object.entries(report.positionGroups);
  const widestGroup = Math.max(...groups.map(([, g]) => Math.abs(g.aboveLine)));

  return (
    <div className="about">
      <div className="page-head">
        <div>
          <button type="button" className="btn btn--ghost btn--sm backlink" onClick={() => actions.navigate('players')}>
            <span className="backlink__icon" aria-hidden="true">
              <IconChevron size={13} dir="left" />
            </span>
            Players
          </button>
          <h1 className="about__title">How Overall works</h1>
          <p className="page-head__deck">How the number is calculated, and how it lines up with wins, runs and WAR.</p>
        </div>
        <div className="page-head__aside">
          <span className="about__season">{report.season} season</span>
        </div>
      </div>

      <div className="about__facts" aria-label="Correlations at a glance">
        <Fact r={fits.wins.r} label="Team Overall vs wins" sub={`${fits.wins.n} clubs`} />
        <Fact r={fits.runsScored.r} label="Team Hitting vs runs scored" sub={`${fits.runsScored.n} clubs`} />
        <Fact r={fits.hitters.r} label="Hitter Overall vs WAR" sub={`${fits.hitters.n} qualified`} />
        <Fact r={fits.pitchers.r} label="Pitcher Overall vs WAR" sub={`${fits.pitchers.n} qualified`} />
      </div>
      <p className="about__text">
        Each number is a correlation, r: 1 means a perfect straight-line match and 0 means none. Squared, it is the
        share of the spread it explains, so {r2(fits.wins.r)} explains about {sharePct(fits.wins.r)}% of the spread in
        wins.
      </p>

      <section className="about__section">
        <h2 className="about__h2">How Overall is calculated</h2>
        <p className="about__text">
          Overall is an estimate of talent, not a summary of one season. Every Statcast input blends three seasons with
          the league average before it is used. Each season counts by how much data it holds:
        </p>
        <p className="about__formula">
          estimate = (n₀·this season + 0.6·n₁·last season + 0.3·n₂·the season before + k·league average) ÷ (n₀ + 0.6·n₁ +
          0.3·n₂ + k)
        </p>
        <p className="about__text">
          The <i>n</i>s are sample sizes in each stat’s own unit: plate appearances, balls in play, outs in the field.{' '}
          <i>k</i> is how slowly that stat settles, measured from how well it repeats year to year. A stat that settles
          fast, like sprint speed, barely moves toward average; one that settles slowly leans harder on history and the
          league. A star with a short season leans on his last two years, and a rookie with no history leans on the
          league. Each estimate is redrawn 200 times from its uncertainty, and the card shows the middle result.
        </p>

        <h3 className="about__h3">Hitters: Bat + Defense + Legs</h3>
        <p className="about__text">
          A hitter’s Overall is three parts added up in runs over a full season, the way WAR adds its parts. The total is
          then ranked as a percentile among every rated hitter, {report.ratedHitters} of them this season. The back of
          each player card shows his three parts.
        </p>
        <div className="about__tablewrap">
          <table className="about__table">
            <thead>
              <tr>
                <th>Part</th>
                <th>What goes in</th>
                <th className="about__num">Typical spread</th>
                <th className="about__num">Range</th>
              </tr>
            </thead>
            <tbody>
              <PartRow name="Bat" part={parts.bat} strong>
                xwOBA above the league, over 688 plate appearances, at 1.24 runs per point of wOBA
              </PartRow>
              <PartRow name="Defense" part={parts.defense} strong>
                Glove plus position
              </PartRow>
              <PartRow name="Glove" part={parts.fielding} sub>
                Statcast fielding run value over a full season: range and arm for everyone, and framing, blocking and
                throwing for catchers. Counted only for the share of his time in the field
              </PartRow>
              <PartRow name="Position" part={parts.position} sub>
                The positional adjustment below, split by his defensive outs at each position
              </PartRow>
              <PartRow name="Legs" part={parts.legs} strong>
                Sprint speed and baserunning, half each
              </PartRow>
            </tbody>
          </table>
        </div>
        <p className="about__text">
          The positional adjustment is FanGraphs’ runs per 162 games for where a player plays, before he makes a single
          play there:
        </p>
        <div className="about__tablewrap">
          <table className="about__table about__table--grid">
            <thead>
              <tr>
                {POSITION_RUNS.map(([pos]) => (
                  <th key={pos}>{pos}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {POSITION_RUNS.map(([pos, runs]) => (
                  <td key={pos}>{signed(runs)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="about__text">
          The glove and the position measure different things, so Defense needs both. The glove is measured in runs
          against others at the same position, so a great shortstop counts for more than a great first baseman: more of
          the game comes his way. But an average shortstop scores 0, the same as an average first baseman, even though
          most first basemen could not play shortstop at all. The positional credit pays for that.
        </p>
        <p className="about__text">
          A DH has no glove to measure, so he counts as an average fielder, and the DH adjustment charges him for not
          playing the field, as in WAR. A catcher is rated over a catcher’s season: nobody catches 162 games, so for the
          time a player spends catching, his glove and his positional credit count over 125 games, about the most any
          catcher has caught in recent seasons.
        </p>
        <p className="about__text">
          The hitting attributes on the card, such as Raw Power, Contact Quality and Bat-to-Ball, describe how a player
          hits. xwOBA measures what that is worth, so it is the one that goes into Overall.
        </p>

        <h3 className="about__h3">Pitchers: a weighted blend</h3>
        <div className="about__tablewrap about__tablewrap--narrow">
          <table className="about__table">
            <tbody>
              {PITCHER_WEIGHTS.map(([name, weight]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="about__num">{weight}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="about__text">
          A pitcher’s attributes are each a percentile, blended with these weights and ranked again as a percentile
          among every rated pitcher.
        </p>

        <h3 className="about__h3">Teams</h3>
        <p className="about__text">
          Team Hitting is the average Overall of a club’s rated position players, weighted by plate appearances. Team
          Pitching is the same for its pitchers, weighted by batters faced. Team Overall is the average of the two. Each
          player counts for the club he is on now.
        </p>
      </section>

      <section className="about__section">
        <h2 className="about__h2">Team Overall and wins</h2>
        <Chart
          fit={fits.wins}
          keyItems={[['dot', 'A club']]}
          label={`Scatterplot of Team Overall against ${report.season} wins for every club`}
          points={clubPoints((c) => c.overall, (c) => c.w, winsFlagged, (c) =>
            `${club(c.team)}: Overall ${c.overall.toFixed(1)}, ${c.w}-${c.l}`)}
          x={padded(clubs.map((c) => c.overall))}
          y={padded(clubs.map((c) => c.w))}
          xLabel="Team Overall"
          yLabel="Wins"
          table={{
            head: ['Club', 'Team Overall', 'Record'],
            rows: clubs.slice().sort((a, b) => b.overall - a.overall)
              .map((c) => [club(c.team), c.overall.toFixed(1), `${c.w}-${c.l}`]),
          }}
        />
        <p className="about__text">
          Each point of Team Overall is worth about {fits.wins.slope.toFixed(1)} wins, and Team Overall explains about{' '}
          {sharePct(fits.wins.r)}% of the spread in wins. For scale, a club’s actual run differential explains{' '}
          {sharePct(report.runDifferentialVsWins)}% (r = {r2(report.runDifferentialVsWins)}). Overall measures talent,
          and a season’s wins also depend on sequencing and luck.
        </p>
        <p className="about__text">
          Furthest above the line: {listed(wins.above.map((c) => `the ${club(c.team)} (${c.w} wins at ${c.overall.toFixed(1)})`))}.
          Furthest below: {listed(wins.below.map((c) => `the ${club(c.team)} (${c.w} at ${c.overall.toFixed(1)})`))}.
        </p>
      </section>

      <section className="about__section">
        <h2 className="about__h2">Team run production</h2>
        <Chart
          fit={fits.runsScored}
          keyItems={[['dot', 'A club']]}
          label={`Scatterplot of Team Hitting against ${report.season} runs scored for every club`}
          points={clubPoints((c) => c.hitting, (c) => c.rs, scoredFlagged, (c) =>
            `${club(c.team)}: Hitting ${c.hitting.toFixed(1)}, ${c.rs} runs scored`)}
          x={padded(clubs.map((c) => c.hitting))}
          y={padded(clubs.map((c) => c.rs))}
          xLabel="Team Hitting"
          yLabel="Runs scored"
          table={{
            head: ['Club', 'Team Hitting', 'Runs scored'],
            rows: clubs.slice().sort((a, b) => b.hitting - a.hitting)
              .map((c) => [club(c.team), c.hitting.toFixed(1), c.rs]),
          }}
        />
        <p className="about__text">
          Team Hitting against runs scored: r = {r2(fits.runsScored.r)}, about {fits.runsScored.slope.toFixed(1)} runs per
          point. Furthest above the line:{' '}
          {listed(scored.above.map((c) => `the ${club(c.team)} (${c.rs} runs at ${c.hitting.toFixed(1)})`))}. Furthest
          below: {listed(scored.below.map((c) => `the ${club(c.team)} (${c.rs} at ${c.hitting.toFixed(1)})`))}.
        </p>
        <p className="about__text">
          Overall is built from Statcast measures of each batted ball and pitch, which do not depend on the park, while
          runs do. Runs also depend on sequencing and on where a season’s batted balls happened to land.
        </p>
        <Chart
          fit={fits.runsAllowed}
          keyItems={[['dot', 'A club']]}
          label={`Scatterplot of Team Pitching against ${report.season} runs allowed for every club`}
          points={clubPoints((c) => c.pitching, (c) => c.ra, allowedFlagged, (c) =>
            `${club(c.team)}: Pitching ${c.pitching.toFixed(1)}, ${c.ra} runs allowed`)}
          x={padded(clubs.map((c) => c.pitching))}
          y={padded(clubs.map((c) => c.ra))}
          xLabel="Team Pitching"
          yLabel="Runs allowed"
          table={{
            head: ['Club', 'Team Pitching', 'Runs allowed'],
            rows: clubs.slice().sort((a, b) => b.pitching - a.pitching)
              .map((c) => [club(c.team), c.pitching.toFixed(1), c.ra]),
          }}
        />
        <p className="about__text">
          Team Pitching against runs allowed: r = {r2(fits.runsAllowed.r)}, about{' '}
          {Math.abs(fits.runsAllowed.slope).toFixed(1)} fewer runs allowed per point. More runs than the line expects:{' '}
          {listed(allowed.above.map((c) => `the ${club(c.team)} (${c.ra} at ${c.pitching.toFixed(1)})`))}. Fewer:{' '}
          {listed(allowed.below.map((c) => `the ${club(c.team)} (${c.ra} at ${c.pitching.toFixed(1)})`))}. A club’s
          defense shows up here as well: the average Defense of its position players lines up with fewer runs allowed
          too (r = {report.defenseVsRunsAllowed.toFixed(2)}).
        </p>
      </section>

      <section className="about__section">
        <h2 className="about__h2">Hitter Overall and WAR</h2>
        <Chart
          fit={fits.hitters}
          keyItems={[['dot', 'C, SS, CF, 2B, 3B'], ['alt', '1B, LF, RF, DH'], ['line', 'Best straight line']]}
          label={`Scatterplot of hitter Overall against ${report.season} WAR for qualified hitters`}
          points={hitters.map((p, i) => ({
            id: `${p.name}-${i}`,
            x: p.overall,
            y: p.war,
            alt: !PREMIUM.includes(p.pos),
            keyLabel: batsFlagged.has(p) ? p.name : undefined,
            tip: `${p.name}${p.pos ? ` (${p.pos})` : ''}: Overall ${p.overall}, ${war(p.war)} WAR`,
          }))}
          x={[0, 100]}
          y={padded(hitters.map((p) => p.war))}
          xLabel="Overall"
          yLabel="WAR"
          table={{
            head: ['Player', 'Pos', 'Overall', 'WAR'],
            rows: hitters.slice().sort((a, b) => b.overall - a.overall || b.war - a.war)
              .map((p) => [p.name, p.pos ?? '—', p.overall, war(p.war)]),
          }}
        />
        <p className="about__text">
          Qualified hitters track WAR at r = {r2(fits.hitters.r)}, about {sharePct(fits.hitters.r)}% of the spread. The two
          kinds of point mix on both sides of the line: by position group, every group sits within{' '}
          {widestGroup.toFixed(2)} WAR of it on average (
          {groups.map(([name, g]) => `${GROUP_NAMES[name]} ${signed(g.aboveLine, 2)}`).join(', ')}).
        </p>
        <p className="about__text">
          Furthest above the line:{' '}
          {listed(bats.above.map((p) => `${p.name} (${war(p.war)} WAR at ${p.overall})`))}. Furthest below:{' '}
          {listed(bats.below.map((p) => `${p.name} (${war(p.war)} at ${p.overall})`))}. WAR is one season’s results
          and Overall is a three-season estimate of skill, so a breakout or a slump shows up in WAR first.
        </p>
      </section>

      <section className="about__section">
        <h2 className="about__h2">Pitcher Overall and WAR</h2>
        <Chart
          fit={fits.pitchers}
          keyItems={[['dot', 'A qualified starter']]}
          label={`Scatterplot of pitcher Overall against ${report.season} WAR for qualified pitchers`}
          points={pitchers.map((p, i) => ({
            id: `${p.name}-${i}`,
            x: p.overall,
            y: p.war,
            keyLabel: topArms.includes(p) ? p.name : undefined,
            tip: `${p.name}: Overall ${p.overall}, ${war(p.war)} WAR`,
          }))}
          x={[0, 100]}
          y={padded(pitchers.map((p) => p.war))}
          xLabel="Overall"
          yLabel="WAR"
          table={{
            head: ['Pitcher', 'Overall', 'WAR'],
            rows: pitchers.slice().sort((a, b) => b.overall - a.overall || b.war - a.war)
              .map((p) => [p.name, p.overall, war(p.war)]),
          }}
        />
        <p className="about__text">
          Qualified pitchers track WAR at r = {r2(fits.pitchers.r)}, about {sharePct(fits.pitchers.r)}% of the spread. A
          pitcher’s value is mostly run prevention, which is 40% of his Overall, with whiffs, command and contact quality
          behind it.
        </p>
      </section>

      <p className="about__foot">
        Ratings from Statcast; wins, runs and WAR from MLB’s stats API, as of {report.built}. WAR is the sabermetrics feed
        MLB publishes for qualified players only: hitters with 3.1 plate appearances per team game and starters with an
        inning per team game. Runs are not park-adjusted.
      </p>
    </div>
  );
}

function Fact({ r, label, sub }) {
  return (
    <div className="about__fact">
      <span className="about__factvalue">{r2(r)}</span>
      <span className="about__factlabel">{label}</span>
      <span className="about__factsub">{sub}</span>
    </div>
  );
}

function PartRow({ name, part, strong = false, sub = false, children }) {
  return (
    <tr data-sub={sub}>
      <td>{strong ? <b>{name}</b> : name}</td>
      <td>{children}</td>
      <td className="about__num">±{part.sd.toFixed(1)} runs</td>
      <td className="about__num">
        {signed(part.min)} to {signed(part.max)}
      </td>
    </tr>
  );
}

/* A chart, its key, and its numbers in a table for anyone who cannot read a
   scatterplot: a screen reader, or someone who wants the exact figures. */
function Chart({ points, fit, x, y, xLabel, yLabel, label, keyItems, table }) {
  const hasLine = keyItems.some(([kind]) => kind === 'line');
  const items = hasLine ? keyItems : [...keyItems, ['line', 'Best straight line']];
  return (
    <figure className="about__figure">
      <Scatter points={points} fit={fit} x={x} y={y} xLabel={xLabel} yLabel={yLabel} label={label} />
      <figcaption className="about__key">
        {items.map(([kind, text]) => (
          <span key={text} className="about__keyitem" data-kind={kind}>
            {text}
          </span>
        ))}
        <span className="about__keystat">
          r = {Math.abs(fit.r).toFixed(2)} · n = {fit.n}
        </span>
      </figcaption>
      <details className="about__data">
        <summary>Show the numbers</summary>
        <div className="about__tablewrap about__tablewrap--data">
          <table className="about__table">
            <thead>
              <tr>
                {table.head.map((h, i) => (
                  <th key={h} className={i > 0 ? 'about__num' : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className={j > 0 ? 'about__num' : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
